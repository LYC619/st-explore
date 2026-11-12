use crate::AuthorizedRoots;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use zip::ZipArchive;

const MAX_FILES: usize = 200_000;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// 绝对上限放宽后，真正拦 zip bomb 的是膨胀率：解压总量 / 压缩总量。
/// 纯文本 JSONL 压缩到 20 倍左右很常见，200 倍留足余量；炸弹动辄上万倍。
const MAX_EXPANSION_RATIO: u64 = 200;
/// 小包不看膨胀率——几 KB 的包比出上千倍也炸不了盘。
const EXPANSION_RATIO_FLOOR: u64 = 64 * 1024 * 1024;
const MAX_DEPTH: usize = 32;
const MAX_PATH_BYTES: usize = 512;
const TEMP_PREFIX: &str = "ste-st-import-";
/// 上限是 20 万条目，逐条发事件会把 IPC 打满、反过来拖慢解压。
/// 按总量取步长，全程最多 ~200 条消息，进度条够顺了。
const PROGRESS_MESSAGES: usize = 200;

/// 解压阶段进度。分两段：先全量校验中央目录，再逐条解压落盘。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtractProgress {
    /// "validate" | "extract"
    pub stage: &'static str,
    pub done: usize,
    pub total: usize,
    pub label: String,
}

/// One native preparation owns cancellation across all windows: idle / running / cancelled.
#[derive(Default)]
pub struct ImportCancel(AtomicU8);

struct ImportRun<'a>(&'a ImportCancel);

impl Drop for ImportRun<'_> {
    fn drop(&mut self) {
        self.0.0.store(0, Ordering::SeqCst);
    }
}

impl ImportCancel {
    fn begin(&self) -> Result<ImportRun<'_>, String> {
        self.0.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "上一次备份准备尚未结束，请稍后重试".to_string())?;
        Ok(ImportRun(self))
    }

    fn request(&self) {
        let _ = self.0.compare_exchange(1, 2, Ordering::SeqCst, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed) == 2
    }
}

/// 区分「用户取消」和「真的失败」：取消不该在前端弹错误提示。
#[derive(Debug)]
enum PrepareError {
    Cancelled,
    Failed(String),
}

impl From<String> for PrepareError {
    fn from(value: String) -> Self {
        PrepareError::Failed(value)
    }
}

/// 进度上报 + 取消查询。单测只关心校验逻辑，用 `Reporter::silent()` 跑。
struct Reporter<'a> {
    channel: Option<&'a Channel<ExtractProgress>>,
    cancel: Option<&'a ImportCancel>,
}

impl<'a> Reporter<'a> {
    #[cfg(test)]
    fn silent() -> Self {
        Self {
            channel: None,
            cancel: None,
        }
    }

    fn new(channel: &'a Channel<ExtractProgress>, cancel: &'a ImportCancel) -> Self {
        Self {
            channel: Some(channel),
            cancel: Some(cancel),
        }
    }

    fn check(&self) -> Result<(), PrepareError> {
        match self.cancel {
            Some(flag) if flag.is_cancelled() => Err(PrepareError::Cancelled),
            _ => Ok(()),
        }
    }

    fn send(&self, stage: &'static str, done: usize, total: usize, label: &str) {
        if let Some(channel) = self.channel {
            // 发送失败 = 前端已经不听了（窗口关了/页面刷新），不该让解压跟着失败。
            let _ = channel.send(ExtractProgress {
                stage,
                done,
                total,
                label: label.to_string(),
            });
        }
    }
}

/// 首条、末条和每隔 step 条上报一次。
fn should_report(index: usize, total: usize) -> bool {
    let step = (total / PROGRESS_MESSAGES).max(1);
    index == 0 || index + 1 == total || index.is_multiple_of(step)
}


#[derive(Serialize, Debug, PartialEq)]
pub struct PreparedSTBackup {
    pub root: String,
    pub display_name: String,
    /// 解压时跳过的 secrets.json 数量（ST 备份默认带一个）。给前端做提示用。
    pub skipped_secrets: usize,
}

fn nonce() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| format!("生成临时导入目录名失败: {error}"))
}

fn safe_entry_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.len() > MAX_PATH_BYTES {
        return Err(format!("压缩包路径过长或为空: {name:?}"));
    }
    if name.contains('\\') || name.starts_with('/') || name.contains(':') || name.contains('\0') {
        return Err(format!("压缩包包含不安全路径: {name}"));
    }
    let path = Path::new(name);
    let mut depth = 0usize;
    for part in path.components() {
        match part {
            Component::Normal(_) => depth += 1,
            _ => return Err(format!("压缩包包含不安全路径: {name}")),
        }
    }
    if depth == 0 || depth > MAX_DEPTH {
        return Err(format!("压缩包路径层级超限: {name}"));
    }
    Ok(path.to_path_buf())
}

/// ST 自己导出的备份**默认就带 secrets.json**，所以这里绝不能拒收整个包 ——
/// 那等于把所有云端 ST 用户挡在门外。做法是解压时直接跳过它：密钥文件不落盘，
/// 后面就没有任何环节能读到它，安全性和拒收是一样的。
fn is_sensitive_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("secrets.json"))
}

fn is_supported_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized.starts_with("characters/")
        || normalized.starts_with("chats/")
        || normalized.starts_with("worlds/")
        || normalized.starts_with("OpenAI Settings/")
        || normalized == "settings.json"
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建临时导入目录失败 {}: {error}", parent.display()))?;
    }
    Ok(())
}

fn copy_entry<R: Read>(mut input: R, destination: &Path) -> Result<(), String> {
    ensure_parent(destination)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("写入临时导入文件失败 {}: {error}", destination.display()))?;
    io::copy(&mut input, &mut output)
        .map_err(|error| format!("解压临时导入文件失败 {}: {error}", destination.display()))?;
    output
        .flush()
        .map_err(|error| format!("刷新临时导入文件失败 {}: {error}", destination.display()))
}

fn validate_archive<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    reporter: &Reporter<'_>,
) -> Result<(), PrepareError> {
    let mut total = 0u64;
    let mut packed = 0u64;
    let mut supported = false;
    let count = archive.len();
    let mut diagnostic = crate::diagnostics::event(crate::diagnostics::EventKind::Import, "start");
    diagnostic.count = Some(count as u64);
    crate::diagnostics::record(diagnostic);
    for index in 0..count {
        reporter.check()?;
        if index >= MAX_FILES {
            return Err(format!("压缩包文件数量超过上限 {MAX_FILES}").into());
        }
        let file = archive
            .by_index(index)
            .map_err(|error| format!("读取压缩包目录失败: {error}"))?;
        let path = safe_entry_path(file.name())?;
        if file.is_symlink() {
            return Err(format!("压缩包包含符号链接: {}", file.name()).into());
        }
        if is_sensitive_path(&path) {
            // 跳过，不计入体积也不算「有效内容」——它根本不会被解出来。
        } else if !file.is_dir() {
            if file.size() > MAX_ENTRY_BYTES {
                return Err(format!("单个压缩包文件超过上限: {}", file.name()).into());
            }
            total = total
                .checked_add(file.size())
                .ok_or_else(|| "压缩包解压大小溢出".to_string())?;
            packed = packed.saturating_add(file.compressed_size());
            if total > MAX_TOTAL_BYTES {
                return Err(format!(
                    "压缩包解压总大小超过上限 {} GiB",
                    MAX_TOTAL_BYTES / 1024 / 1024 / 1024
                )
                .into());
            }
            supported |= is_supported_path(&path);
        }
        if should_report(index, count) {
            reporter.send("validate", index + 1, count, file.name());
        }
    }
    if total > EXPANSION_RATIO_FLOOR && total / packed.max(1) > MAX_EXPANSION_RATIO {
        return Err(format!(
            "压缩包解压后膨胀 {} 倍，超过 {MAX_EXPANSION_RATIO} 倍上限，已按可疑压缩炸弹拒绝",
            total / packed.max(1)
        )
        .into());
    }
    if !supported {
        return Err("不是有效的 SillyTavern 数据包：未发现 characters、chats、worlds 或支持的预设"
            .to_string()
            .into());
    }
    Ok(())
}

/// 返回被跳过的密钥文件数量，用来在选择弹窗上如实告诉用户「这个没读」。
fn extract_archive<R: Read + Seek>(
    mut archive: ZipArchive<R>,
    root: &Path,
    reporter: &Reporter<'_>,
) -> Result<usize, PrepareError> {
    let count = archive.len();
    let mut skipped_secrets = 0usize;
    for index in 0..count {
        reporter.check()?;
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取压缩包条目失败: {error}"))?;
        let relative = safe_entry_path(file.name())?;
        if is_sensitive_path(&relative) {
            // 唯一一处真正的防线：不写到磁盘上，扫描阶段自然也就无从读起。
            skipped_secrets += 1;
        } else {
            let target = root.join(relative);
            if file.is_dir() {
                fs::create_dir_all(&target).map_err(|error| {
                    format!("创建临时导入目录失败 {}: {error}", target.display())
                })?;
            } else {
                copy_entry(&mut file, &target)?;
            }
        }
        if should_report(index, count) {
            reporter.send("extract", index + 1, count, file.name());
        }
    }
    let mut diagnostic = crate::diagnostics::event(crate::diagnostics::EventKind::Import, "end");
    diagnostic.count = Some(count as u64);
    crate::diagnostics::record(diagnostic);
    Ok(skipped_secrets)
}

fn finish_preparation(
    outcome: Result<PreparedSTBackup, PrepareError>,
    temp_root: Option<&Path>,
    cleanup: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<Option<PreparedSTBackup>, String> {
    match outcome {
        Ok(prepared) => Ok(Some(prepared)),
        Err(error) => {
            let message = match error {
                PrepareError::Cancelled => None,
                PrepareError::Failed(message) => Some(message),
            };
            if let Some(root) = temp_root {
                cleanup(root).map_err(|error| format!(
                    "STE_ST_IMPORT_CLEANUP_FAILED: {}；清理临时导入目录失败 {}: {error}",
                    message.as_deref().unwrap_or("导入已取消"), root.display(),
                ))?;
            }
            match message {
                Some(message) => Err(message),
                None => Ok(None),
            }
        }
    }
}

/// 必须是 `async fn`：见 `crate::dialog_for` 上的说明，同步 command 调 `blocking_pick_*`
/// 必然死锁。顺带把解压也挪离主线程，大包解压期间窗口保持响应。
///
/// 取消走 `cancel_st_backup_import` 置旗标，本函数在校验/解压的每一条上查一次。
/// 取消和「用户在文件对话框点了取消」一样返回 `Ok(None)`，前端两种都是静默收场。
#[tauri::command]
pub async fn prepare_st_backup_import(
    app: tauri::AppHandle,
    roots: tauri::State<'_, AuthorizedRoots>,
    cancel: tauri::State<'_, ImportCancel>,
    on_progress: Channel<ExtractProgress>,
) -> Result<Option<PreparedSTBackup>, String> {
    crate::diagnostics::command_async("prepare_st_backup_import", None, async {
    let _run = cancel.begin()?;
    let Some(selected) = crate::dialog_for(&app)
        .set_title("选择 SillyTavern 导出包")
        .add_filter("SillyTavern ZIP", &["zip"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    if cancel.is_cancelled() {
        return Ok(None);
    }
    let reporter = Reporter::new(&on_progress, &cancel);

    let zip_path = selected
        .into_path()
        .map_err(|error| format!("选择结果不是本机文件: {error}"))?;
    let display_name = zip_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("SillyTavern 导出包")
        .to_string();

    let mut temp_root: Option<PathBuf> = None;
    let outcome = (|| {
        let file = File::open(&zip_path)
            .map_err(|error| format!("打开导出包失败 {}: {error}", zip_path.display()))?;
        let mut archive =
            ZipArchive::new(file).map_err(|error| format!("不是有效的 ZIP 文件: {error}"))?;
        validate_archive(&mut archive, &reporter)?;

        let root =
            std::env::temp_dir().join(format!("{TEMP_PREFIX}{}-{}", std::process::id(), nonce()?));
        fs::create_dir_all(&root)
            .map_err(|error| format!("创建临时导入目录失败 {}: {error}", root.display()))?;
        temp_root = Some(root.clone());

        let file = File::open(&zip_path)
            .map_err(|error| format!("重新打开导出包失败 {}: {error}", zip_path.display()))?;
        let archive = ZipArchive::new(file).map_err(|error| format!("读取导出包失败: {error}"))?;
        let skipped_secrets = extract_archive(archive, &root, &reporter)?;
        reporter.check()?;
        let canonical = roots.authorize_temporary(&root)?;
        Ok(PreparedSTBackup {
            root: canonical.to_string_lossy().into_owned(),
            display_name,
            skipped_secrets,
        })
    })();

    finish_preparation(outcome, temp_root.as_deref(), |root| fs::remove_dir_all(root))
    }).await
}

/// 请求中断正在进行的解压。同步 command 是故意的：它只做一次原子写，必须立刻返回，
/// 不能排在解压后面（解压跑在异步运行时的 worker 上，主线程是空的）。
#[tauri::command]
pub fn cancel_st_backup_import(cancel: tauri::State<'_, ImportCancel>) {
    cancel.request();
}


#[tauri::command]
pub fn cleanup_st_backup_import(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
) -> Result<(), String> {
    crate::diagnostics::command("cleanup_st_backup_import", Some(root.clone()), || {
        roots.cleanup_temporary(Path::new(&root), |path| fs::remove_dir_all(path))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn zip_with(entries: &[(&str, &[u8])]) -> ZipArchive<Cursor<Vec<u8>>> {
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut bytes);
            for (name, content) in entries {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(content).unwrap();
            }
            writer.finish().unwrap();
        }
        ZipArchive::new(Cursor::new(bytes.into_inner())).unwrap()
    }

    /// 取出失败原因；测试里断言的都是「真失败」，撞上取消要立刻炸出来。
    fn failure(error: PrepareError) -> String {
        match error {
            PrepareError::Failed(message) => message,
            PrepareError::Cancelled => panic!("期望校验失败，实际返回了取消"),
        }
    }

    #[test]
    fn rejects_traversal_and_absolute_zip_paths() {
        for path in [
            "../outside.txt",
            "/outside.txt",
            "C:outside.txt",
            "dir\\file.txt",
        ] {
            assert!(
                safe_entry_path(path).is_err(),
                "path should be rejected: {path}"
            );
        }
        assert_eq!(
            safe_entry_path("characters/A.png").unwrap(),
            PathBuf::from("characters/A.png")
        );
    }

    #[test]
    fn requires_supported_content() {
        let mut unsupported = zip_with(&[("notes/readme.txt", b"no ST data")]);
        assert!(validate_archive(&mut unsupported, &Reporter::silent()).is_err());

        // secrets.json 单独一个不算有效内容：它会被跳过，等于包里啥也没有。
        let mut only_secrets = zip_with(&[("secrets.json", b"{}")]);
        assert!(validate_archive(&mut only_secrets, &Reporter::silent()).is_err());
    }

    /// ST 导出的备份默认就带 secrets.json。收下整个包，但那一条不落盘。
    #[test]
    fn accepts_package_with_secrets_but_never_extracts_it() {
        let mut archive = zip_with(&[("secrets.json", b"{}"), ("characters/A.png", b"png")]);
        assert!(validate_archive(&mut archive, &Reporter::silent()).is_ok());

        let temp = std::env::temp_dir().join(format!(
            "{TEMP_PREFIX}test-{}-{}",
            std::process::id(),
            nonce().unwrap()
        ));
        fs::create_dir_all(&temp).unwrap();
        let archive = zip_with(&[
            ("secrets.json", b"{\"api_key\":\"leak\"}"),
            ("SECRETS.JSON", b"{}"),
            ("characters/A.png", b"png"),
        ]);
        let skipped = extract_archive(archive, &temp, &Reporter::silent()).unwrap();
        assert_eq!(skipped, 2, "大小写变体也要跳过");
        assert!(temp.join("characters/A.png").exists());
        assert!(!temp.join("secrets.json").exists());
        assert!(!temp.join("SECRETS.JSON").exists());
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn accepts_supported_package_with_safe_limits() {
        let mut archive = zip_with(&[
            ("characters/A.png", b"png"),
            ("chats/A/main.jsonl", b"{}\n"),
            ("settings.json", b"{\"extensions\":{\"regex\":[]}}"),
        ]);
        assert!(validate_archive(&mut archive, &Reporter::silent()).is_ok());
    }

    #[test]
    fn rejects_high_expansion_ratio_above_floor() {
        // 全零负载压缩比上万倍：绝对上限放宽后就靠这条拦住压缩炸弹
        let zeros = vec![0u8; (EXPANSION_RATIO_FLOOR + 1024 * 1024) as usize];
        let mut bomb = zip_with(&[("chats/A/main.jsonl", zeros.as_slice())]);
        let error = failure(
            validate_archive(&mut bomb, &Reporter::silent()).expect_err("高膨胀率必须被拒绝"),
        );
        assert!(error.contains("压缩炸弹"), "unexpected error: {error}");
    }

    #[test]
    fn cancel_flag_stops_validation_and_extraction() {
        let cancelled = ImportCancel::default();
        let _run = cancelled.begin().unwrap();
        cancelled.request();
        let reporter = Reporter {
            channel: None,
            cancel: Some(&cancelled),
        };

        // 这个包本身完全合法，唯一让它停下来的只能是取消旗标。
        let mut archive = zip_with(&[("characters/A.png", b"png"), ("chats/A/main.jsonl", b"{}\n")]);
        assert!(matches!(
            validate_archive(&mut archive, &reporter),
            Err(PrepareError::Cancelled)
        ));

        let temp = std::env::temp_dir().join(format!(
            "{TEMP_PREFIX}test-{}-{}",
            std::process::id(),
            nonce().unwrap()
        ));
        fs::create_dir_all(&temp).unwrap();
        let archive = zip_with(&[("characters/A.png", b"png")]);
        assert!(matches!(
            extract_archive(archive, &temp, &reporter),
            Err(PrepareError::Cancelled)
        ));
        // 取消发生在写第一条之前，临时目录应该还是空的。
        assert_eq!(fs::read_dir(&temp).unwrap().count(), 0);
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn preparation_is_exclusive_and_retry_does_not_inherit_cancellation() {
        let flag = ImportCancel::default();
        let run = flag.begin().unwrap();
        flag.request();
        assert!(flag.is_cancelled());
        assert!(flag.begin().is_err());
        assert!(flag.is_cancelled(), "a rejected retry must not clear cancellation");
        drop(run);
        let _retry = flag.begin().unwrap();
        assert!(!flag.is_cancelled());
    }

    #[test]
    fn failed_cleanup_is_reported_even_when_preparation_was_cancelled() {
        for error in [PrepareError::Cancelled, PrepareError::Failed("bad archive".into())] {
            let failure = finish_preparation(Err(error), Some(Path::new("synthetic-temp")), |_| {
                Err(io::Error::new(io::ErrorKind::PermissionDenied, "file is locked"))
            }).unwrap_err();
            assert!(failure.starts_with("STE_ST_IMPORT_CLEANUP_FAILED:"));
            assert!(failure.contains("synthetic-temp"));
            assert!(failure.contains("file is locked"));
        }
        assert_eq!(finish_preparation(Err(PrepareError::Cancelled), Some(Path::new("synthetic-temp")), |_| Ok(())).unwrap(), None);
    }

    #[test]
    fn progress_is_throttled_for_huge_archives() {
        // 20 万条目逐条发事件会把 IPC 打满，这里守住「消息数被步长压住」。
        let total = 200_000;
        let reported = (0..total).filter(|index| should_report(*index, total)).count();
        assert!(
            reported <= PROGRESS_MESSAGES + 2,
            "20 万条目上报了 {reported} 次，节流没生效"
        );
        // 小包每条都报，进度条才不会一动不动。
        assert!((0..7).all(|index| should_report(index, 7)));
        // 首末两条必须报到，否则进度条起步为空、结束不满。
        assert!(should_report(0, total));
        assert!(should_report(total - 1, total));
    }
}
