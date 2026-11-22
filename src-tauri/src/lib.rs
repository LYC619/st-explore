use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

mod st_backup_import;
mod st_import_cleanup;
mod diagnostics;
mod environment;
mod library_lease;

/// 文件库(FileVault)的 Rust 侧原语：列目录/读写文本与二进制/删除/改名 + 应用配置读写。
/// 策略与映射逻辑全部在 TS 层（src/lib/vault/），这里保持薄且可单测。
/// 铁律：删除类命令只删调用方点名的单个文件/空目录，绝不递归删——"不认识的文件永不删改"。

#[derive(Default)]
struct AuthorizedRootSet {
    roots: HashSet<PathBuf>,
    persistent: HashSet<PathBuf>,
    temporary: HashSet<PathBuf>,
    writable: HashSet<PathBuf>,
    sources: HashSet<PathBuf>,
    exports: HashSet<PathBuf>,
    library_locks: HashMap<PathBuf, library_lease::LibraryLease>,
}

#[derive(Default)]
struct AuthorizedRoots {
    state: Mutex<AuthorizedRootSet>,
}

impl AuthorizedRoots {
    fn canonical_directory(root: &Path) -> Result<PathBuf, String> {
        let metadata = fs::metadata(root)
            .map_err(|e| format!("授权目录不存在或无法访问 {}: {e}", root.display()))?;
        if !metadata.is_dir() {
            return Err(format!("授权路径不是文件夹: {}", root.display()));
        }
        fs::canonicalize(root).map_err(|e| format!("解析授权目录失败 {}: {e}", root.display()))
    }

    fn authorize_inner(&self, root: &Path, persistent: bool) -> Result<PathBuf, String> {
        let canonical = Self::canonical_directory(root)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        state.roots.insert(canonical.clone());
        state.writable.insert(canonical.clone());
        if persistent {
            state.persistent.insert(canonical.clone());
        }
        Ok(canonical)
    }

    fn authorize(&self, root: &Path) -> Result<PathBuf, String> {
        self.authorize_inner(root, false)
    }

    fn authorize_export(&self, root: &Path) -> Result<PathBuf, String> {
        let canonical = Self::canonical_directory(root)?;
        let mut state = self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
        let is_library = state.writable.contains(&canonical) && !state.sources.contains(&canonical)
            && !state.exports.contains(&canonical);
        state.roots.insert(canonical.clone());
        state.writable.insert(canonical.clone());
        // Exporting into an existing library must not drop its library role,
        // process lease, or protection against an overlapping source selection.
        if !is_library { state.exports.insert(canonical.clone()); }
        Ok(canonical)
    }

    fn authorize_source(&self, root: &Path, persistent: bool) -> Result<PathBuf, String> {
        self.authorize_source_inner(root, persistent, false)
    }

    fn authorize_source_inner(&self, root: &Path, persistent: bool, protect_libraries: bool) -> Result<PathBuf, String> {
        let canonical = Self::canonical_directory(root)?;
        let mut state = self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
        // A picker grant precedes source scanning and may be abandoned. Reject
        // conflicting roles before changing any existing library permission.
        if protect_libraries && state.writable.iter().any(|library| !state.sources.contains(library)
            && !state.exports.contains(library) && (canonical.starts_with(library) || library.starts_with(&canonical))) {
            return Err("所选来源目录与已授权的STE文件库重叠，请选择独立的ST来源目录".into());
        }
        state.roots.insert(canonical.clone());
        if persistent { state.persistent.insert(canonical.clone()); }
        state.writable.remove(&canonical);
        state.sources.insert(canonical.clone());
        Ok(canonical)
    }

    fn authorize_selected_source(&self, root: &Path, persistent: bool) -> Result<PathBuf, String> {
        self.authorize_source_inner(root, persistent, true)
    }

    fn authorize_temporary(&self, root: &Path) -> Result<PathBuf, String> {
        let canonical = self.authorize_source(root, false)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        state.temporary.insert(canonical.clone());
        Ok(canonical)
    }

    fn cleanup_temporary(
        &self,
        root: &Path,
        remove: impl FnOnce(&Path) -> Result<(), std::io::Error>,
    ) -> Result<(), String> {
        let canonical = fs::canonicalize(root)
            .map_err(|e| format!("解析临时导入目录失败 {}: {e}", root.display()))?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        if !state.temporary.contains(&canonical) {
            return Err(format!("拒绝清理非本次导入的临时目录: {}", root.display()));
        }
        remove(&canonical)
            .map_err(|e| format!("清理临时导入目录失败 {}: {e}", canonical.display()))?;
        state.temporary.remove(&canonical);
        state.roots.remove(&canonical);
        state.sources.remove(&canonical);
        state.writable.remove(&canonical);
        Ok(())
    }

    fn authorize_persistent(&self, root: &Path) -> Result<PathBuf, String> {
        let canonical = self.authorize_inner(root, true)?;
        self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?.exports.remove(&canonical);
        Ok(canonical)
    }

    fn persistent_roots(&self) -> Result<Vec<PathBuf>, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        let mut roots = state.persistent.iter().cloned().collect::<Vec<_>>();
        roots.sort();
        Ok(roots)
    }

    fn resolve_root(&self, root: &str) -> Result<PathBuf, String> {
        let canonical =
            fs::canonicalize(root).map_err(|e| format!("读取根目录失败 {root}: {e}"))?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        if state.roots.contains(&canonical) {
            if state.writable.contains(&canonical) && !state.sources.contains(&canonical) && !state.exports.contains(&canonical)
                && !state.library_locks.contains_key(&canonical) {
                let lock = acquire_library_lock(&canonical)?;
                state.library_locks.insert(canonical.clone(), lock);
            }
            Ok(canonical)
        } else {
            Err(format!("拒绝访问未授权目录: {root}"))
        }
    }

    fn ensure_contains(&self, path: &Path) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件访问授权状态已损坏".to_string())?;
        if state.roots.iter().any(|root| path.starts_with(root)) {
            let vaults = state.writable.iter().filter(|root| path.starts_with(root)
                && !state.sources.contains(*root) && !state.exports.contains(*root)).cloned().collect::<Vec<_>>();
            for root in vaults {
                if !state.library_locks.contains_key(&root) {
                    state.library_locks.insert(root.clone(), acquire_library_lock(&root)?);
                }
            }
            Ok(())
        } else {
            Err(format!("拒绝访问未授权路径: {}", path.display()))
        }
    }

    fn ensure_writable(&self, path: &Path) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
        if state.sources.iter().any(|root| path.starts_with(root) || root.starts_with(path)) {
            return Err("ST来源和临时导入目录只允许读取；聊天写回请使用专用入口".into());
        }
        if !state.writable.iter().any(|root| path.starts_with(root)) {
            return Err("目录没有写入授权，请重新选择文件库或导出目录".into());
        }
        let vault = state.writable.iter().filter(|root| path.starts_with(root) && !state.exports.contains(*root))
            .max_by_key(|root| root.components().count()).cloned();
        if let Some(root) = vault {
            if !state.library_locks.contains_key(&root) {
                state.library_locks.insert(root.clone(), acquire_library_lock(&root)?);
            }
        }
        Ok(())
    }

    fn has_grant(&self, path: &Path, source: bool) -> Result<bool, String> {
        let canonical = match fs::canonicalize(path) { Ok(path) => path, Err(_) => return Ok(false) };
        let state = self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
        Ok(if source { state.sources.contains(&canonical) && !state.temporary.contains(&canonical) }
            else { state.writable.contains(&canonical) && !state.sources.contains(&canonical) && !state.exports.contains(&canonical) })
    }

    fn revoke(&self, path: &Path) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
        let removed = state.roots.iter().filter(|root| same_root(root, path)).cloned().collect::<Vec<_>>();
        for canonical in removed {
            state.roots.remove(&canonical); state.persistent.remove(&canonical);
            state.writable.remove(&canonical); state.sources.remove(&canonical);
            state.exports.remove(&canonical); state.library_locks.remove(&canonical);
        }
        Ok(())
    }
}

/// Hold one OS lease for a library throughout this process's use, including
/// recovery and reads. A second STE process cannot recover an in-flight journal.
fn acquire_library_lock(root: &Path) -> Result<library_lease::LibraryLease, String> {
    library_lease::acquire(root)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DirEntryInfo {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
}

fn list_dir_impl(path: &Path) -> Result<Vec<DirEntryInfo>, String> {
    let mut out = Vec::new();
    let entries =
        fs::read_dir(path).map_err(|e| format!("读取目录失败 {}: {e}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        let is_symlink = meta.file_type().is_symlink();
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok());
        out.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: !is_symlink && meta.is_dir(),
            is_symlink,
            size: if is_symlink || meta.is_dir() {
                0
            } else {
                meta.len()
            },
            modified_at,
        });
    }
    out.sort_by(|a, b| (b.is_dir, a.name.to_lowercase()).cmp(&(a.is_dir, b.name.to_lowercase())));
    Ok(out)
}

fn read_text_impl(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("读取文件失败 {}: {e}", path.display()))
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("目标路径没有父目录: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("目标路径没有文件名: {}", path.display()))?
        .to_string_lossy();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("生成临时文件名失败: {e}"))?
        .as_nanos();

    for attempt in 0..32 {
        let tmp = parent.join(format!(
            ".{file_name}.ste-tmp-{}-{nonce}-{attempt}",
            std::process::id()
        ));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
        {
            Ok(file) => file,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("创建临时文件失败 {}: {err}", tmp.display())),
        };
        if let Err(err) = file.write_all(bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&tmp);
            return Err(format!("写入失败 {}: {err}", tmp.display()));
        }
        drop(file);
        if let Err(err) = fs::rename(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("替换失败 {}: {err}", path.display()));
        }
        return Ok(());
    }
    Err(format!("无法创建唯一临时文件: {}", path.display()))
}

fn read_binary_impl(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败 {}: {e}", path.display()))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn write_binary_impl(path: &Path, b64: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    write_bytes_atomic(path, &bytes)
}

fn fs_mutation_error(code: &str, path: &Path, detail: impl std::fmt::Display) -> String {
    serde_json::json!({
        "code": code,
        "path": path.to_string_lossy(),
        "message": detail.to_string(),
    })
    .to_string()
}

fn fs_io_mutation_error(path: &Path, error: std::io::Error) -> String {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "not-found",
        std::io::ErrorKind::PermissionDenied => "permission-denied",
        _ => "io",
    };
    fs_mutation_error(code, path, error)
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn with_regular_file(
    path: &Path,
    operation: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| fs_io_mutation_error(path, e))?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(fs_mutation_error("unsafe-path", path, "link or reparse point"));
    }
    if !metadata.is_file() {
        return Err(fs_mutation_error("not-file", path, "ordinary file required"));
    }
    operation(path)
}

/// 只删单个文件；目录走 remove_empty_dir_impl，永不递归删。
fn remove_file_impl(path: &Path) -> Result<(), String> {
    with_regular_file(path, |target| {
        fs::remove_file(target).map_err(|e| fs_io_mutation_error(target, e))
    })
}

fn trash_file_impl(path: &Path) -> Result<(), String> {
    with_regular_file(path, |target| {
        trash::delete(target).map_err(|e| fs_mutation_error("io", target, e))
    })
}

/// 只删空目录；非空时静默保留（返回 false）——里面可能有用户自己放的文件。
/// 目录本来就不存在同样返回 false：删除要幂等，否则调用方「顺手清理可能存在的子目录」
/// 会在子目录从未创建时炸掉整个删除流程（明明文件已经删干净了却报失败）。
fn remove_empty_dir_impl(path: &Path) -> Result<bool, String> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(true),
        Err(e) => {
            let already_done = e.kind() == std::io::ErrorKind::NotFound
                || e.raw_os_error() == Some(145) // Windows: ERROR_DIR_NOT_EMPTY
                || e.kind() == std::io::ErrorKind::DirectoryNotEmpty;
            if already_done {
                Ok(false)
            } else {
                Err(format!("删除目录失败 {}: {e}", path.display()))
            }
        }
    }
}

fn rename_impl(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() {
        return Err(format!("目标已存在，拒绝覆盖: {}", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    fs::rename(from, to).map_err(|e| format!("改名失败 {} → {}: {e}", from.display(), to.display()))
}

#[derive(Serialize, Debug, PartialEq)]
pub struct StatInfo {
    pub exists: bool,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
}

fn stat_impl(path: &Path) -> StatInfo {
    match fs::metadata(path) {
        Ok(m) => StatInfo {
            exists: true,
            is_dir: m.is_dir(),
            size: m.len(),
            modified_at: m.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64),
        },
        Err(_) => StatInfo {
            exists: false,
            is_dir: false,
            size: 0,
            modified_at: None,
        },
    }
}

// ---- 应用配置（系统配置目录，不进库文件夹；7.6 的 API Key 也走这里）----

fn config_file(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

/// 读改写全程持有的跨进程排他锁，随返回的句柄释放。
///
/// 两个 STE 进程（免安装版 + 安装版、或没关掉的旧窗口）各自读到同一份旧配置再写回，
/// 后写的会吞掉先写的那个键。config.json 本身靠改名替换，锁它等于锁一个马上被换掉的文件，
/// 所以锁旁边一个固定文件。
fn lock_config(config_dir: &Path) -> Result<fs::File, String> {
    lock_config_with_timeout(config_dir, std::time::Duration::from_secs(5))
}

fn lock_config_with_timeout(config_dir: &Path, timeout: std::time::Duration) -> Result<fs::File, String> {
    fs::create_dir_all(config_dir)
        .map_err(|e| format!("创建配置目录失败 {}: {e}", config_dir.display()))?;
    let path = config_dir.join(".config.lock");
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| format!("打开配置锁失败 {}: {e}", path.display()))?;
    let waited = std::time::Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => break,
            Err(fs::TryLockError::WouldBlock) => {
                let elapsed = waited.elapsed();
                if elapsed >= timeout {
                    let mut event = diagnostics::event(diagnostics::EventKind::Lock, "timeout");
                    event.category = Some("timeout".into());
                    event.elapsed_ms = Some(elapsed.as_millis() as u64);
                    diagnostics::record(event);
                    return Err("STE_CONFIG_LOCK_TIMEOUT:另一个 STE 窗口正在写配置，请稍后再试".into());
                }
                std::thread::sleep((timeout - elapsed).min(std::time::Duration::from_millis(50)));
            }
            Err(fs::TryLockError::Error(error)) => return Err(format!("等待配置锁失败 {}: {error}", path.display())),
        }
    }
    if waited.elapsed() >= std::time::Duration::from_secs(1) {
        let mut event = diagnostics::event(diagnostics::EventKind::Lock, "waiting");
        event.elapsed_ms = Some(waited.elapsed().as_millis() as u64);
        diagnostics::record(event);
    }
    Ok(file)
}

const CONFIG_INVALID_PREFIX: &str = "STE_CONFIG_INVALID:";

fn read_config_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取配置文件失败 {}: {e}", path.display()))?;
    String::from_utf8(bytes)
        .map_err(|e| format!("{CONFIG_INVALID_PREFIX}配置文件不是有效 UTF-8: {e}"))
}

fn parse_config_object(text: &str) -> Result<serde_json::Value, String> {
    let value = serde_json::from_str::<serde_json::Value>(text)
        .map_err(|e| format!("{CONFIG_INVALID_PREFIX}配置文件损坏: {e}"))?;
    if !value.is_object() {
        return Err(format!("{CONFIG_INVALID_PREFIX}配置文件根不是对象"));
    }
    Ok(value)
}

fn config_get_impl(config_dir: &Path, key: &str) -> Result<Option<serde_json::Value>, String> {
    let file = config_file(config_dir);
    if !file.exists() {
        return Ok(None);
    }
    let text = read_config_text(&file)?;
    let map = parse_config_object(&text)?;
    Ok(map.get(key).cloned())
}

/// 前端实际会写的全部配置键。白名单之外一律拒绝。
///
/// 理由是纵深防御：配置派生的根目录每次启动都参与授权（见 restore_authorized_roots），
/// 所以能任意写 config.json 就等于能写 `vaultRoot: "C:\\"`，重启后拿到持久全盘读写。
/// 目前 webview 里没有已知注入点（全仓无 dangerouslySetInnerHTML），这条是备而不用。
/// 新增配置项时要同步加到这里，否则写入会在客户端上直接失败。
const CONFIG_WRITABLE_KEYS: [&str; 7] = [
    "stRoot",             // ST 根目录
    "vaultRoot",          // 当前库根目录
    "vaultRegistry",      // 多库注册表
    "apiProfiles",        // API 提供商配置（镜像自 localStorage）：共享槽
    "apiActiveProfile",   // 当前启用的配置档 id：共享槽
    "apiProfilesByVault", // 按库独立的 API 配置槽 { 库id: { profiles, active } }
    "apiScopeByVault",    // 每个库用共享还是独立配置 { 库id: "shared" | "vault" }
];

#[cfg(test)]
fn config_set_impl(config_dir: &Path, key: &str, value: serde_json::Value) -> Result<(), String> {
    if !CONFIG_WRITABLE_KEYS.contains(&key) {
        return Err(format!("拒绝写入未知配置项: {key}"));
    }
    let _lock = lock_config(config_dir)?;
    config_set_unlocked(config_dir, key, value)
}

fn config_set_unlocked(config_dir: &Path, key: &str, value: serde_json::Value) -> Result<(), String> {
    let file = config_file(config_dir);
    let mut map = if file.exists() {
        parse_config_object(&read_config_text(&file)?)?
    } else {
        serde_json::json!({})
    };
    map.as_object_mut()
        .ok_or_else(|| format!("{CONFIG_INVALID_PREFIX}配置文件根不是对象"))?
        .insert(key.to_string(), value);
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    write_bytes_atomic(&file, text.as_bytes())
}

fn config_repair_impl(config_dir: &Path) -> Result<Option<PathBuf>, String> {
    let file = config_file(config_dir);
    if !file.exists() {
        return Ok(None);
    }
    let _lock = lock_config(config_dir)?;
    let original =
        fs::read(&file).map_err(|e| format!("读取配置文件失败 {}: {e}", file.display()))?;
    if std::str::from_utf8(&original)
        .ok()
        .and_then(|text| parse_config_object(text).ok())
        .is_some()
    {
        return Ok(None);
    }

    fs::create_dir_all(config_dir)
        .map_err(|e| format!("创建配置目录失败 {}: {e}", config_dir.display()))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("生成配置备份名失败: {e}"))?
        .as_millis();
    let mut backup = None;
    for attempt in 0..32 {
        let candidate = config_dir.join(format!("config.invalid-{nonce}-{attempt}.json"));
        let mut output = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("创建配置备份失败 {}: {err}", candidate.display())),
        };
        output
            .write_all(&original)
            .and_then(|_| output.sync_all())
            .map_err(|e| format!("写入配置备份失败 {}: {e}", candidate.display()))?;
        backup = Some(candidate);
        break;
    }
    let backup = backup.ok_or_else(|| "无法创建唯一的配置备份文件".to_string())?;
    write_bytes_atomic(&file, b"{}")?;
    Ok(Some(backup))
}

// ---- Tauri 命令层（薄封装）----

fn rooted_path_from_canonical(mut resolved: PathBuf, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\\')
        || relative.contains(':')
        || relative.contains('\0')
        || relative.chars().any(|c| c.is_control())
    {
        return Err(fs_mutation_error("unsafe-path", Path::new(relative), "invalid relative path separator"));
    }
    let rel = Path::new(relative);
    if rel.is_absolute()
        || relative.split('/').any(|part| part == "." || part == "..")
        || rel
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(fs_mutation_error("unsafe-path", rel, "path must stay within the authorized root"));
    }

    for part in rel.components() {
        let Component::Normal(name) = part else {
            return Err(fs_mutation_error("unsafe-path", rel, "path must stay within the authorized root"));
        };
        resolved.push(name);
        match fs::symlink_metadata(&resolved) {
            Ok(meta) if meta.file_type().is_symlink() || is_reparse_point(&meta) => {
                return Err(fs_mutation_error("unsafe-path", &resolved, "link or reparse point"));
            }
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(fs_io_mutation_error(&resolved, err)),
        }
    }
    Ok(resolved)
}

fn authorized_mutation_path(
    roots: &AuthorizedRoots,
    root: &str,
    relative: &str,
) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err(fs_mutation_error("unsafe-path", Path::new(relative), "file path required"));
    }
    let canonical = roots
        .resolve_root(root)
        .map_err(|error| fs_mutation_error("unsafe-path", Path::new(root), error))?;
    let target = rooted_path_from_canonical(canonical, relative)?;
    roots.ensure_writable(&target)?;
    Ok(target)
}

fn authorized_writable_path(roots: &AuthorizedRoots, root: &str, relative: &str) -> Result<PathBuf, String> {
    let target = authorized_rooted_path(roots, root, relative)?;
    roots.ensure_writable(&target)?;
    Ok(target)
}

#[cfg(test)]
fn rooted_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(root).map_err(|e| format!("读取根目录失败 {root}: {e}"))?;
    rooted_path_from_canonical(canonical, relative)
}

fn authorized_rooted_path(
    roots: &AuthorizedRoots,
    root: &str,
    relative: &str,
) -> Result<PathBuf, String> {
    rooted_path_from_canonical(roots.resolve_root(root)?, relative)
}

fn authorized_read_absolute_path(roots: &AuthorizedRoots, path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    validate_absolute_ancestors(requested)?;
    if !requested.is_absolute() {
        return Err(format!("绝对路径无效: {path}"));
    }
    let metadata =
        fs::symlink_metadata(requested).map_err(|e| format!("读取文件路径失败 {path}: {e}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("拒绝访问符号链接: {path}"));
    }
    let canonical =
        fs::canonicalize(requested).map_err(|e| format!("解析文件路径失败 {path}: {e}"))?;
    roots.ensure_contains(&canonical)?;
    Ok(canonical)
}

fn authorized_write_absolute_path(roots: &AuthorizedRoots, path: &str) -> Result<PathBuf, String> {
    let target = authorized_absolute_target(roots, path)?;
    roots.ensure_writable(&target)?;
    Ok(target)
}

fn validate_absolute_ancestors(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err("必须使用不含跳转的绝对路径".into());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() || is_reparse_point(&meta) => return Err("绝对路径含链接或重解析点".into()),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("无法核验绝对路径".into()),
        }
    }
    Ok(())
}

fn authorized_absolute_target(roots: &AuthorizedRoots, path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    validate_absolute_ancestors(requested)?;
    if !requested.is_absolute() {
        return Err(format!("绝对路径无效: {path}"));
    }
    if let Ok(metadata) = fs::symlink_metadata(requested) {
        if metadata.file_type().is_symlink() {
            return Err(format!("拒绝写入符号链接: {path}"));
        }
    }
    let parent = requested
        .parent()
        .ok_or_else(|| format!("目标路径没有父目录: {path}"))?;
    let file_name = requested
        .file_name()
        .ok_or_else(|| format!("目标路径没有文件名: {path}"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|e| format!("解析目标父目录失败 {}: {e}", parent.display()))?;
    roots.ensure_contains(&canonical_parent)?;
    Ok(canonical_parent.join(file_name))
}

fn authorized_writeback_path(roots: &AuthorizedRoots, path: &str) -> Result<PathBuf, String> {
    let target = authorized_absolute_target(roots, path)?;
    if target.extension().and_then(|s| s.to_str()).is_none_or(|s| !s.eq_ignore_ascii_case("jsonl")) {
        return Err("ST写回仅允许JSONL聊天文件".into());
    }
    let state = roots.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())?;
    if !state.sources.iter().any(|root| target.starts_with(root) && !state.temporary.contains(root))
        || state.temporary.iter().any(|root| target.starts_with(root)) {
        return Err("写回目标不在已授权的ST来源目录".into());
    }
    Ok(target)
}

fn config_roots(config: &serde_json::Value) -> Vec<(PathBuf, bool)> {
    let mut paths = Vec::new();
    for (key, source) in [("vaultRoot", false), ("stRoot", true)] {
        if let Some(path) = config.get(key).and_then(serde_json::Value::as_str).filter(|p| !p.is_empty()) {
            paths.push((PathBuf::from(path), source));
        }
    }
    if let Some(vaults) = config.get("vaultRegistry").and_then(|r| r.get("vaults")).and_then(serde_json::Value::as_array) {
        paths.extend(vaults.iter().filter_map(|v| v.get("path").and_then(serde_json::Value::as_str).map(|p| (PathBuf::from(p), false))));
    }
    paths
}

fn restore_configured_roots(roots: &AuthorizedRoots, config_dir: &Path) -> Result<(), String> {
    let path = config_file(config_dir);
    if !path.exists() { return Ok(()); }
    for (path, source) in config_roots(&parse_config_object(&read_config_text(&path)?)?) {
        if path.is_dir() {
            if source { roots.authorize_source(&path, true)?; } else { roots.authorize_persistent(&path)?; }
        }
    }
    Ok(())
}

fn same_root(left: &Path, right: &Path) -> bool {
    if let (Ok(left), Ok(right)) = (fs::canonicalize(left), fs::canonicalize(right)) { return left == right; }
    let normalize = |path: &Path| {
        let value = simplified_for_frontend(path).replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(windows) { value.to_lowercase() } else { value }
    };
    normalize(left) == normalize(right)
}

fn config_set_authorized(roots: &AuthorizedRoots, config_dir: &Path, key: &str, value: serde_json::Value) -> Result<(), String> {
    if !CONFIG_WRITABLE_KEYS.contains(&key) { return Err(format!("拒绝写入未知配置项: {key}")); }
    let _lock = lock_config(config_dir)?;
    if !["vaultRoot", "stRoot", "vaultRegistry"].contains(&key) { return config_set_unlocked(config_dir, key, value); }
    let file = config_file(config_dir);
    let previous = if file.exists() { parse_config_object(&read_config_text(&file)?)? } else { serde_json::json!({}) };
    let before = config_roots(&previous);
    let mut next = previous;
    next.as_object_mut().ok_or("配置不是对象")?.insert(key.to_string(), value.clone());
    let after = config_roots(&next);
    for (path, source) in &after {
        // Existing configured offline drives remain selectable. New paths and
        // privilege changes require an exact grant from the native picker.
        let existing = before.iter().any(|(old, role)| role == source && same_root(path, old));
        if !existing && !roots.has_grant(path, *source)? { return Err("新增目录必须先通过系统目录选择器授权".into()); }
    }
    config_set_unlocked(config_dir, key, value)?;
    for (path, source) in before {
        if !after.iter().any(|(next, role)| *role == source && same_root(&path, next)) { roots.revoke(&path)?; }
    }
    restore_configured_roots(roots, config_dir)?;
    persist_authorized_roots(roots, config_dir)
}

fn authorization_file(config_dir: &Path) -> PathBuf {
    config_dir.join("authorized-roots.json")
}

fn persist_authorized_roots(roots: &AuthorizedRoots, config_dir: &Path) -> Result<(), String> {
    let paths = roots
        .persistent_roots()?
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "roots": paths,
    }))
    .map_err(|e| format!("序列化文件访问授权失败: {e}"))?;
    write_bytes_atomic(&authorization_file(config_dir), text.as_bytes())
}

fn restore_authorized_roots(roots: &AuthorizedRoots, config_dir: &Path) -> Result<(), String> {
    // Current configured roots define continuing access. Historical picker
    // grants must not resurrect a library that the user removed.
    // Configuration writes are checked against native picker grants above;
    // existing/legacy config also preserves disconnected drives for reconnect.
    restore_configured_roots(roots, config_dir)?;
    persist_authorized_roots(roots, config_dir)
}

#[tauri::command]
fn vault_list_dir(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<Vec<DirEntryInfo>, String> {
    diagnostics::command("vault_list_dir", Some(path.clone()), || {
        let path = authorized_rooted_path(&roots, &root, &path)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        list_dir_impl(&path)
    })
}

#[tauri::command]
fn vault_read_text(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<String, String> {
    diagnostics::command("vault_read_text", Some(path.clone()), || {
        read_text_impl(&authorized_rooted_path(&roots, &root, &path)?)
    })
}

#[tauri::command]
fn vault_write_text(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    diagnostics::command("vault_write_text", Some(path.clone()), || {
        write_bytes_atomic(
            &authorized_writable_path(&roots, &root, &path)?,
            content.as_bytes(),
        )
    })
}

#[tauri::command]
fn vault_read_binary(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<String, String> {
    diagnostics::command("vault_read_binary", Some(path.clone()), || {
        read_binary_impl(&authorized_rooted_path(&roots, &root, &path)?)
    })
}

/// Hash bytes in bounded native memory. No base64 or file body crosses IPC.
fn fingerprint_impl(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|_| "文件校验读取失败".to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "文件校验读取失败".to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[tauri::command]
async fn vault_fingerprint(roots: tauri::State<'_, AuthorizedRoots>, root: String, path: String) -> Result<String, String> {
    diagnostics::command_async("vault_fingerprint", Some(path.clone()), async {
        let target = authorized_rooted_path(&roots, &root, &path)?;
        tauri::async_runtime::spawn_blocking(move || fingerprint_impl(&target)).await.map_err(|_| "文件校验任务失败".to_string())?
    }).await
}

#[tauri::command]
fn vault_write_binary(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
    base64: String,
) -> Result<(), String> {
    diagnostics::command("vault_write_binary", Some(path.clone()), || {
        write_binary_impl(&authorized_writable_path(&roots, &root, &path)?, &base64)
    })
}

#[tauri::command]
fn vault_remove_file(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<(), String> {
    diagnostics::command("vault_remove_file", Some(path.clone()), || {
        remove_file_impl(&authorized_mutation_path(&roots, &root, &path)?)
    })
}

/// 送进系统回收站而不是抹掉。给用户主动删自己文件的场景用（立绘等），
/// 删错了还能从回收站捞回来；程序自己维护的中间文件仍走 vault_remove_file。
#[tauri::command]
fn vault_trash_file(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<(), String> {
    diagnostics::command("vault_trash_file", Some(path.clone()), || {
        trash_file_impl(&authorized_mutation_path(&roots, &root, &path)?)
    })
}

/// 把库内文件交给系统默认程序（reveal=true 则在文件管理器里定位）。
/// 0830 反馈条目 6：关联文件里的 html、视频这些，客户端内预览不了就得能外部打开。
///
/// 授权走 authorized_rooted_path，和读写删同一条闸——插件的静态 scope 在这里没用，
/// 库根是用户运行时选的，写不进 capabilities 白名单。
#[tauri::command]
fn vault_open_path(
    app: tauri::AppHandle,
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
    reveal: bool,
) -> Result<(), String> {
    diagnostics::command("vault_open_path", Some(path.clone()), || {
        use tauri_plugin_opener::OpenerExt;
        let target = authorized_rooted_path(&roots, &root, &path)?;
        if !target.is_file() && !target.is_dir() {
            return Err(format!("文件或文件夹不存在: {}", target.display()));
        }
        if reveal {
            app.opener()
                .reveal_item_in_dir(&target)
                .map_err(|e| format!("在文件管理器中显示失败 {}: {e}", target.display()))
        } else {
            validate_external_open(&target)?;
            // with 传 None = 系统默认关联程序；不指定程序名，免得替用户挑
            app.opener()
                .open_path(target.to_string_lossy(), None::<&str>)
                .map_err(|e| format!("调用外部程序失败 {}: {e}", target.display()))
        }
    })
}

/// Unknown formats remain available through reveal, never through shell execution.
fn validate_external_open(path: &Path) -> Result<(), String> {
    if path.is_dir() { return Ok(()); }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "ico" | "tif" | "tiff"
        | "mp3" | "wav" | "ogg" | "flac" | "m4a" | "aac" | "opus"
        | "mp4" | "webm" | "mkv" | "mov" | "avi" | "m4v"
        | "pdf" | "txt" | "md" | "json" | "jsonl" | "csv" | "log" | "html" | "htm" | "svg") {
        Ok(())
    } else {
        Err(fs_mutation_error("unsafe-path", path, "此文件类型不能直接打开，请使用“在文件管理器中显示”后自行确认"))
    }
}

#[tauri::command]
fn vault_remove_empty_dir(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<bool, String> {
    diagnostics::command("vault_remove_empty_dir", Some(path.clone()), || {
        remove_empty_dir_impl(&authorized_writable_path(&roots, &root, &path)?)
    })
}

#[tauri::command]
fn vault_rename(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    diagnostics::command("vault_rename", Some(from.clone()), || {
        if from.is_empty() || to.is_empty() || from == ".ste-control" || to == ".ste-control" { return Err("不能移动库根或库控制目录".into()); }
        rename_impl(
            &authorized_writable_path(&roots, &root, &from)?,
            &authorized_writable_path(&roots, &root, &to)?,
        )
    })
}

#[tauri::command]
fn vault_mkdir(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<(), String> {
    diagnostics::command("vault_mkdir", Some(path.clone()), || {
        let path = authorized_writable_path(&roots, &root, &path)?;
        fs::create_dir_all(&path).map_err(|e| format!("创建目录失败 {}: {e}", path.display()))
    })
}

#[tauri::command]
fn vault_stat(
    roots: tauri::State<'_, AuthorizedRoots>,
    root: String,
    path: String,
) -> Result<StatInfo, String> {
    diagnostics::command("vault_stat", Some(path.clone()), || {
        Ok(stat_impl(&authorized_rooted_path(&roots, &root, &path)?))
    })
}

#[tauri::command]
fn vault_read_abs_text(
    roots: tauri::State<'_, AuthorizedRoots>,
    path: String,
) -> Result<String, String> {
    diagnostics::command("vault_read_abs_text", Some(path.clone()), || {
        read_text_impl(&authorized_read_absolute_path(&roots, &path)?)
    })
}

#[derive(Serialize, Debug)]
struct PickedChatFile {
    name: String,
    base64: String,
}

/// 原生选择器读入上限。这条路径要同时驻留原始字节、base64 文本、IPC 副本与前端
/// atob 结果，峰值内存约为文件体积的四到五倍，所以先按体积挡住再读盘。
/// 需要支持更大的档案时应改成分片/流式读取，而不是抬高这个常量。
const MAX_PICKED_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn read_picked_file_impl(path: &Path, max_bytes: u64) -> Result<PickedChatFile, String> {
    let size = fs::metadata(path)
        .map_err(|e| format!("读取文件信息失败 {}: {e}", path.display()))?
        .len();
    if size > max_bytes {
        return Err(format!(
            "文件过大：{:.1} MB，上限 {} MB。请先在 SillyTavern 侧拆分或精简后再导入。",
            size as f64 / (1024.0 * 1024.0),
            max_bytes / (1024 * 1024)
        ));
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("导入文件")
        .to_string();
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败 {}: {e}", path.display()))?;
    Ok(PickedChatFile {
        name,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// 给系统文件对话框挂上主窗口做属主：对话框随主窗口模态、定位跟着主窗口走，
/// 不再作为孤立顶层窗口弹在屏幕上（0826 反馈 2）。
/// 注意：对话框的**尺寸**由 Windows 自己按 ComDlg32 的历史记录还原，
/// 应用侧无法指定，这里只能保证属主关系正确。
///
/// 调用方必须是 `async fn` command：同步 command 跑在主线程，而 `blocking_pick_*`
/// 要靠事件循环转起来才能等到对话框关闭，在主线程上调用会直接互锁成"未响应"。
/// 交给前端的路径去掉 `\\?\` verbatim 前缀。`fs::canonicalize` 一定带这个前缀，
/// 原样传出去前端会显示成 `//?/D:/...`，还会让同一文件夹算出两个库 id。
/// 授权集合内部仍存 canonical 形式，回传的路径进来时会重新 canonicalize，能对上。
///
/// 只处理盘符形式；`\\?\UNC\server\share` 剥掉前缀就不合法了，保持原样。
pub fn simplified_for_frontend(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => text.into_owned(),
    }
}

/// 给系统文件对话框挂上主窗口做属主：对话框随主窗口模态、定位跟着主窗口走，
/// 不再作为孤立顶层窗口弹在屏幕上（0826 反馈 2）。
/// 注意：对话框的**尺寸**由 Windows 自己按 ComDlg32 的历史记录还原，应用侧无法指定，
/// 这里只能保证属主关系正确。
///
/// **用到本构建器的 command 必须是 `async fn`。** 同步 command 跑在主线程，而
/// `blocking_pick_*` 的实现是「把创建对话框投递给主线程 + 阻塞当前线程等结果」
/// （见 tauri-plugin-dialog 的 `blocking_fn!` 与 `desktop::pick_file`），在主线程上
/// 调用等于自己等自己，对话框永远不会被创建 —— 表现为点按钮后选择框不弹、整个窗口
/// 无响应。已经踩过两次：210b122（pick_chat_file）、本次（prepare_st_backup_import）。
fn dialog_for(app: &tauri::AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let builder = app.dialog().file();
    match app.get_webview_window("main") {
        Some(window) => builder.set_parent(&window),
        None => builder,
    }
}

#[tauri::command]
async fn pick_chat_file(app: tauri::AppHandle) -> Result<Option<PickedChatFile>, String> {
    diagnostics::command_async("pick_chat_file", None, async {
        let Some(selected) = dialog_for(&app)
            .set_title("选择聊天或角色卡文件")
            .add_filter("聊天与角色卡", &["jsonl", "json", "txt", "png"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| format!("选择结果不是本机文件: {e}"))?;
        read_picked_file_impl(&path, MAX_PICKED_FILE_BYTES).map(Some)
    }).await
}

// The path comes only from the native save dialog, never from a frontend argument.
// Writing this one file does not grant later access to its surrounding directory.
fn write_selected_text_export(selected: Option<PathBuf>, content: &str) -> Result<bool, String> {
    write_selected_export(selected, content.as_bytes())
}

fn write_selected_export(selected: Option<PathBuf>, content: &[u8]) -> Result<bool, String> {
    let Some(path) = selected else {
        return Ok(false);
    };
    if !path.is_absolute() {
        return Err("导出位置不是本机绝对路径".to_string());
    }
    validate_absolute_ancestors(&path)?;
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("请选择普通文件，不能覆盖符号链接".to_string());
    }
    write_bytes_atomic(&path, content)?;
    Ok(true)
}

fn text_export_label(extension: &str) -> Result<&'static str, String> {
    match extension {
        "json" => Ok("JSON 文件"),
        "jsonl" => Ok("SillyTavern 聊天文件"),
        "ste-play" => Ok("STE 完整故事包"),
        "md" => Ok("Markdown 文件"),
        _ => Err("不支持的导出文件格式".to_string()),
    }
}

fn binary_export_label(extension: &str) -> Result<&'static str, String> {
    match extension {
        "png" => Ok("PNG 角色卡"),
        "ste-reading" => Ok("STE 阅读包"),
        "ste-world" => Ok("STE 世界包"),
        "zip" => Ok("ZIP 文件"),
        _ => Err("不支持的导出文件格式".to_string()),
    }
}

#[tauri::command]
async fn save_text_export(
    app: tauri::AppHandle,
    file_name: String,
    extension: String,
    content: String,
) -> Result<bool, String> {
    diagnostics::command_async("save_text_export", None, async {
        let label = text_export_label(&extension)?;
        let selected = dialog_for(&app)
            .set_title(format!("导出{label}"))
            .set_file_name(file_name)
            .add_filter(label, &[extension.as_str()])
            .blocking_save_file()
            .map(|file| {
                file.into_path()
                    .map_err(|error| format!("导出位置不是本机文件: {error}"))
            })
            .transpose()?;
        write_selected_text_export(selected, &content)
    }).await
}

#[tauri::command]
async fn save_binary_export(
    app: tauri::AppHandle,
    file_name: String,
    extension: String,
    base64: String,
) -> Result<bool, String> {
    diagnostics::command_async("save_binary_export", None, async {
        let label = binary_export_label(&extension)?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&base64)
            .map_err(|error| format!("导出内容编码无效: {error}"))?;
        let selected = dialog_for(&app)
            .set_title(format!("导出{label}"))
            .set_file_name(file_name)
            .add_filter(label, &[extension.as_str()])
            .blocking_save_file()
            .map(|file| file.into_path().map_err(|error| format!("导出位置不是本机文件: {error}")))
            .transpose()?;
        write_selected_export(selected, &bytes)
    }).await
}

#[tauri::command]
fn vault_write_abs_text(
    roots: tauri::State<'_, AuthorizedRoots>,
    path: String,
    content: String,
) -> Result<(), String> {
    diagnostics::command("vault_write_abs_text", Some(path.clone()), || {
        write_bytes_atomic(
            &authorized_writeback_path(&roots, &path)?,
            content.as_bytes(),
        )
    })
}

/// 按绝对路径写二进制（阅读包导出用）。
/// 与 vault_write_abs_text 同一条授权路径，只是载荷走 base64——
/// 阅读包是 zip，塞不进 String。
#[tauri::command]
fn vault_write_abs_binary(
    roots: tauri::State<'_, AuthorizedRoots>,
    path: String,
    base64: String,
) -> Result<(), String> {
    diagnostics::command("vault_write_abs_binary", Some(path.clone()), || {
        write_binary_impl(&authorized_write_absolute_path(&roots, &path)?, &base64)
    })
}

#[tauri::command]
async fn vault_pick_authorized_directory(
    app: tauri::AppHandle,
    roots: tauri::State<'_, AuthorizedRoots>,
    title: String,
    persistent: bool,
    purpose: String,
) -> Result<Option<String>, String> {
    diagnostics::command_async("vault_pick_authorized_directory", None, async {
        if !["vault", "source", "export"].contains(&purpose.as_str()) { return Err("未知目录用途".into()); }
        let Some(selected) = dialog_for(&app).set_title(title).blocking_pick_folder() else {
            return Ok(None);
        };
        let selected = selected
            .into_path()
            .map_err(|e| format!("目录选择结果不是本机路径: {e}"))?;
        let canonical = if purpose == "source" {
            roots.authorize_selected_source(&selected, persistent)?
        } else if persistent {
            let canonical = roots.authorize_persistent(&selected)?;
            persist_authorized_roots(&roots, &app_config_dir(&app)?)?;
            canonical
        } else if purpose == "export" {
            roots.authorize_export(&selected)?
        } else {
            roots.authorize(&selected)?
        };
        Ok(Some(simplified_for_frontend(&canonical)))
    }).await
}

fn app_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("取配置目录失败: {e}"))
}

#[tauri::command]
fn config_get(app: tauri::AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    diagnostics::command("config_get", None, || {
        let value = config_get_impl(&app_config_dir(&app)?, &key)?;
        diagnostics::config_result(&key, value.as_ref().map(diagnostics::value_count).unwrap_or(0), false);
        Ok(value)
    })
}

#[tauri::command]
fn config_set(app: tauri::AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    diagnostics::command("config_set", None, || {
        let count = diagnostics::value_count(&value);
        config_set_authorized(&app.state::<AuthorizedRoots>(), &app_config_dir(&app)?, &key, value)?;
        diagnostics::config_result(&key, count, true);
        Ok(())
    })
}

#[tauri::command]
fn config_repair(app: tauri::AppHandle) -> Result<Option<String>, String> {
    diagnostics::command("config_repair", None, || {
        let directory = app_config_dir(&app)?;
        let backup = config_repair_impl(&directory)?;
        if backup.is_some() {
            let roots = app.state::<AuthorizedRoots>();
            *roots.state.lock().map_err(|_| "文件访问授权状态已损坏".to_string())? = AuthorizedRootSet::default();
            persist_authorized_roots(&roots, &directory)?;
        }
        Ok(backup.map(|path| path.to_string_lossy().into_owned()))
    })
}

#[tauri::command]
fn write_diagnostic_event(event: diagnostics::Event) {
    diagnostics::record(event);
}

#[tauri::command]
fn get_environment_info(info: tauri::State<'_, environment::EnvironmentInfo>) -> environment::EnvironmentInfo {
    info.inner().clone()
}

#[tauri::command]
fn open_log_directory(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|_| "无法确定日志文件夹".to_string())?;
    if !dir.is_dir() { return Err("日志文件夹尚未创建".into()); }
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|_| "无法打开日志文件夹".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let mut log_available = false;
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Ok(log_dir) = app.path().app_log_dir() {
                log_available = diagnostics::initialize(log_dir).is_ok();
                diagnostics::startup(&app.config().identifier);
            }
            let roots = AuthorizedRoots::default();
            if let Ok(config_dir) = app.path().app_config_dir() {
                let _ = fs::create_dir_all(&config_dir);
                let info = environment::inspect(&config_dir, log_available);
                diagnostics::record(diagnostics::event(diagnostics::EventKind::Environment, info.status));
                app.manage(info);
                if let Err(error) = restore_authorized_roots(&roots, &config_dir) {
                    let mut event = diagnostics::event(diagnostics::EventKind::Config, "failed");
                    event.category = Some(diagnostics::error_category(&error).into());
                    diagnostics::record(event);
                }
            } else {
                app.manage(environment::EnvironmentInfo {status:"unknown",nominal_path:String::new(),resolved_path:None,package_identity:None,log_available});
            }
            app.manage(roots);
            app.manage(st_backup_import::ImportCancel::default());
            std::thread::spawn(st_import_cleanup::cleanup_stale_imports);
            if let Some(main_cfg) = app.config().app.windows.first() {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    let app_handle = app.handle().clone();
                    let seq = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
                    let blank_url: tauri::Url = "about:blank".parse().expect("valid about:blank url");
                    tauri::WebviewWindowBuilder::from_config(app, main_cfg)?
                        .on_new_window(move |url, features| {
                            let allowed = url.as_str() == "about:blank"
                                || url.scheme() == "tauri"
                                || url.host_str() == Some("tauri.localhost")
                                || (cfg!(dev) && url.host_str() == Some("localhost"));
                            if !allowed {
                                return tauri::webview::NewWindowResponse::Deny;
                            }
                            let id = seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                            let label = format!("tavern-detached-{id}");
                            let builder = tauri::WebviewWindowBuilder::new(
                                &app_handle,
                                label,
                                tauri::WebviewUrl::External(blank_url.clone()),
                            )
                            .window_features(features)
                            .title("ST Explorer · 独立酒馆对话")
                            .min_inner_size(720.0, 560.0)
                            .resizable(true)
                            .decorations(true)
                            .on_document_title_changed(|window, title| {
                                let _ = window.set_title(&title);
                            });
                            match builder.build() {
                                Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                                Err(_) => tauri::webview::NewWindowResponse::Deny,
                            }
                        })
                        .build()?;
                }
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    tauri::WebviewWindowBuilder::from_config(app, main_cfg)?.build()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_diagnostic_event,
            get_environment_info,
            open_log_directory,
            vault_list_dir,
            vault_read_text,
            vault_write_text,
            vault_read_binary,
            vault_fingerprint,
            vault_write_binary,
            vault_remove_file,
            vault_trash_file,
            vault_open_path,
            vault_remove_empty_dir,
            vault_rename,
            vault_mkdir,
            vault_stat,
            vault_read_abs_text,
            pick_chat_file,
            save_text_export,
            save_binary_export,
            vault_write_abs_text,
            vault_write_abs_binary,
            vault_pick_authorized_directory,
            config_get,
            config_set,
            config_repair,
            st_backup_import::prepare_st_backup_import,
            st_backup_import::cancel_st_backup_import,
            st_backup_import::cleanup_st_backup_import
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = &event
        {
            if label == "main" {
                for (win_label, win) in app_handle.webview_windows() {
                    if win_label.starts_with("tavern-detached-") {
                        let _ = win.destroy();
                    }
                }
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            diagnostics::record(diagnostics::event(diagnostics::EventKind::Vault, "close"));
            diagnostics::flush();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ste-vault-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn external_open_rejects_scripts_shortcuts_and_unknown_formats() {
        for extension in ["exe", "msi", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
            "hta", "scr", "pif", "com", "lnk", "url", "reg", "dll", "cpl", "jar", "unknown", ""] {
            let path = PathBuf::from(format!("synthetic.{extension}"));
            let error = validate_external_open(&path).unwrap_err();
            assert_eq!(mutation_code(&error), "unsafe-path");
            assert!(error.contains("文件管理器"));
        }
        assert!(validate_external_open(Path::new("synthetic.PDF.exe")).is_err());
        assert!(validate_external_open(Path::new("synthetic.CMD")).is_err());
        for name in ["synthetic.PNG", "synthetic.pdf", "synthetic.mp4", "synthetic.html", "synthetic.jsonl", "synthetic.md"] {
            assert!(validate_external_open(Path::new(name)).is_ok(), "{name}");
        }
        let directory = temp_root("external-open-directory");
        assert!(validate_external_open(&directory).is_ok());
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn write_then_read_roundtrip() {
        let root = temp_root("rw");
        let file = root.join("角色").join("档案.json");
        write_bytes_atomic(&file, "{\"名字\":\"赫敏\"}".as_bytes()).unwrap();
        assert_eq!(read_text_impl(&file).unwrap(), "{\"名字\":\"赫敏\"}");
        write_bytes_atomic(&file, b"v2").unwrap();
        assert_eq!(read_text_impl(&file).unwrap(), "v2");
        assert!(!file.with_extension("ste-tmp").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn fingerprint_streams_raw_bytes_and_survives_rename() {
        use sha2::{Digest, Sha256};
        let root = temp_root("fingerprint");
        let file = root.join("original.bin");
        let bytes = vec![217_u8; 200_003];
        fs::write(&file, &bytes).unwrap();
        let expected = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(fingerprint_impl(&file).unwrap(), expected);
        let moved = root.join("retained.bin");
        rename_impl(&file, &moved).unwrap();
        assert_eq!(fingerprint_impl(&moved).unwrap(), expected);
        assert!(!file.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_dir_dirs_first_with_size() {
        let root = temp_root("ls");
        fs::create_dir_all(root.join("故事")).unwrap();
        fs::write(root.join("聊天.jsonl"), "abc").unwrap();
        let entries = list_dir_impl(&root).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "故事");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "聊天.jsonl");
        assert_eq!(entries[1].size, 3);
        assert!(entries[1].modified_at.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_dir_marks_symlink_without_following_it() {
        let root = temp_root("symlink");
        let outside = temp_root("symlink-outside");
        fs::write(outside.join("secret.txt"), "outside").unwrap();
        let link = root.join("outside-link");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let entries = list_dir_impl(&root).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_symlink);
        assert!(!entries[0].is_dir);
        assert_eq!(entries[0].size, 0);
        let _ = fs::remove_file(&link);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn rooted_path_rejects_traversal_and_backslash() {
        let root = temp_root("rooted-traversal");
        assert!(rooted_path(root.to_str().unwrap(), "../outside.txt").is_err());
        assert!(rooted_path(root.to_str().unwrap(), "safe\\..\\outside.txt").is_err());
        assert_eq!(
            rooted_path(root.to_str().unwrap(), "safe/file.txt").unwrap(),
            fs::canonicalize(&root)
                .unwrap()
                .join("safe")
                .join("file.txt")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rooted_path_rechecks_symlink_after_scan() {
        let root = temp_root("rooted-symlink");
        let outside = temp_root("rooted-symlink-outside");
        let outside_file = outside.join("secret.txt");
        fs::write(&outside_file, "outside").unwrap();
        let link = root.join("selected.txt");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&outside_file, &link).is_err() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        assert!(rooted_path(root.to_str().unwrap(), "selected.txt").is_err());
        let _ = fs::remove_file(&link);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn atomic_write_does_not_follow_precreated_temp_link() {
        let root = temp_root("atomic-temp-link");
        let outside = temp_root("atomic-temp-link-outside");
        let outside_file = outside.join("secret.txt");
        fs::write(&outside_file, "outside").unwrap();
        let target = root.join("item.json");
        let legacy_temp = target.with_extension("ste-tmp");

        fs::hard_link(&outside_file, &legacy_temp).unwrap();

        write_bytes_atomic(&target, b"inside").unwrap();
        assert_eq!(fs::read_to_string(&outside_file).unwrap(), "outside");
        assert_eq!(fs::read_to_string(&target).unwrap(), "inside");
        let _ = fs::remove_file(&legacy_temp);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn read_missing_file_reports_path() {
        let err = read_text_impl(Path::new("Z:/不存在/x.txt")).unwrap_err();
        assert!(err.contains("不存在"));
    }

    #[test]
    fn file_mutations_reject_directories_and_report_not_file() {
        let root = temp_root("mutation-directory");
        let error = remove_file_impl(&root).unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["code"], "not-file");
        assert!(trash_file_impl(&root).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn file_mutations_report_missing_without_touching_parent() {
        let root = temp_root("mutation-missing");
        let target = root.join("missing.txt");
        let error = remove_file_impl(&target).unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["code"], "not-found");
        assert!(root.exists());
        let _ = fs::remove_dir_all(&root);
    }

    fn mutation_code(error: &str) -> String {
        serde_json::from_str::<serde_json::Value>(error).expect("structured mutation error")["code"]
            .as_str().unwrap().to_owned()
    }

    #[test]
    #[cfg(windows)]
    fn rooted_mutations_preserve_existing_trailing_dots_and_spaces() {
        let root = temp_root("existing-name-suffixes");
        let roots = AuthorizedRoots::default();
        roots.authorize(&root).unwrap();
        let canonical = roots.resolve_root(root.to_str().unwrap()).unwrap();
        assert!(canonical.to_string_lossy().starts_with(r"\\?\"));
        let names = ["package", "package.", "package ", "package.."];
        for (index, name) in names.iter().enumerate() {
            let relative = format!("attachments/{name}/data.txt{name}");
            let target = authorized_mutation_path(&roots, root.to_str().unwrap(), &relative).unwrap();
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, [index as u8]).unwrap();
        }
        let listed = list_dir_impl(&canonical.join("attachments")).unwrap();
        for name in names { assert!(listed.iter().any(|entry| entry.name == name && !entry.is_symlink)); }
        for (index, name) in names.iter().enumerate() {
            let relative = format!("attachments/{name}/data.txt{name}");
            let from = authorized_mutation_path(&roots, root.to_str().unwrap(), &relative).unwrap();
            let to = authorized_mutation_path(&roots, root.to_str().unwrap(), &format!("retained/{relative}")).unwrap();
            assert_eq!(fs::read(&from).unwrap(), [index as u8]);
            rename_impl(&from, &to).unwrap();
            assert!(!from.exists());
            assert_eq!(fs::read(&to).unwrap(), [index as u8]);
            rename_impl(&to, &from).unwrap();
            assert_eq!(fs::read(&from).unwrap(), [index as u8]);
        }
        // Exact paths remain under the canonical root and never alias a sibling.
        assert!(authorized_mutation_path(&roots, root.to_str().unwrap(), "attachments/../outside").is_err());
        fs::remove_dir_all(canonical).unwrap();
    }

    #[test]
    fn file_mutations_validate_before_entering_operation() {
        let root = temp_root("mutation-operation");
        fs::create_dir(root.join("empty")).unwrap();
        fs::create_dir(root.join("occupied")).unwrap();
        fs::write(root.join("occupied/keep.txt"), b"keep").unwrap();
        fs::write(root.join("ordinary.txt"), b"ordinary").unwrap();
        let calls = std::cell::Cell::new(0);
        for (name, expected) in [("empty", "not-file"), ("occupied", "not-file"), ("missing", "not-found")] {
            let error = with_regular_file(&root.join(name), |_| {
                calls.set(calls.get() + 1);
                Ok(())
            }).unwrap_err();
            assert_eq!(mutation_code(&error), expected);
        }
        assert_eq!(calls.get(), 0);
        with_regular_file(&root.join("ordinary.txt"), |_| {
            calls.set(calls.get() + 1);
            Ok(())
        }).unwrap();
        assert_eq!(calls.get(), 1);
        remove_file_impl(&root.join("ordinary.txt")).unwrap();
        assert!(!root.join("ordinary.txt").exists());
        assert_eq!(fs::read(root.join("occupied/keep.txt")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_mutations_reject_unsafe_paths_and_preserve_io_codes() {
        let root = temp_root("mutation-path-codes");
        let roots = AuthorizedRoots::default();
        roots.authorize(&root).unwrap();
        let calls = std::cell::Cell::new(0);
        for relative in ["", "../outside", "/absolute", "C:/absolute", "safe\\file", "a/./file", "a\0file"] {
            let result = authorized_mutation_path(&roots, root.to_str().unwrap(), relative)
                .and_then(|path| with_regular_file(&path, |_| { calls.set(calls.get() + 1); Ok(()) }));
            assert_eq!(mutation_code(&result.unwrap_err()), "unsafe-path", "{relative:?}");
        }
        assert_eq!(calls.get(), 0);
        assert!(authorized_rooted_path(&roots, root.to_str().unwrap(), "").is_ok());
        let missing = authorized_mutation_path(&roots, root.to_str().unwrap(), "missing").unwrap();
        assert_eq!(mutation_code(&remove_file_impl(&missing).unwrap_err()), "not-found");
        // An oversized component reliably produces a non-NotFound IO error on supported filesystems.
        let oversized = "a".repeat(300);
        let error = authorized_mutation_path(&roots, root.to_str().unwrap(), &oversized).unwrap_err();
        assert_eq!(mutation_code(&error), "io");
        for (kind, expected) in [
            (std::io::ErrorKind::NotFound, "not-found"),
            (std::io::ErrorKind::PermissionDenied, "permission-denied"),
            (std::io::ErrorKind::Other, "io"),
        ] {
            assert_eq!(mutation_code(&fs_io_mutation_error(&root, std::io::Error::from(kind))), expected);
        }
        fs::remove_dir_all(&root).unwrap();
        let error = authorized_mutation_path(&roots, root.to_str().unwrap(), "file").unwrap_err();
        assert_eq!(mutation_code(&error), "unsafe-path");
    }

    #[test]
    #[cfg_attr(windows, ignore = "requires Windows symlink privilege; run explicitly with --ignored on a capable host")]
    fn file_mutations_reject_file_and_ancestor_links() {
        let root = temp_root("mutation-links");
        let outside = temp_root("mutation-links-outside");
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("parent-link")).unwrap();
            std::os::unix::fs::symlink(outside.join("keep.txt"), root.join("file-link")).unwrap();
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(&outside, root.join("parent-link"))
                .expect("Windows symlink fixture unavailable: enable Developer Mode or grant symlink privilege; coverage NOT accepted");
            std::os::windows::fs::symlink_file(outside.join("keep.txt"), root.join("file-link"))
                .expect("Windows file-symlink fixture unavailable; coverage NOT accepted");
        }
        let roots = AuthorizedRoots::default();
        roots.authorize(&root).unwrap();
        let calls = std::cell::Cell::new(0);
        for relative in ["parent-link/keep.txt", "file-link"] {
            let result = authorized_mutation_path(&roots, root.to_str().unwrap(), relative)
                .and_then(|path| with_regular_file(&path, |_| { calls.set(calls.get() + 1); Ok(()) }));
            assert_eq!(mutation_code(&result.unwrap_err()), "unsafe-path");
        }
        assert_eq!(mutation_code(&with_regular_file(&root.join("file-link"), |_| {
            calls.set(calls.get() + 1); Ok(())
        }).unwrap_err()), "unsafe-path");
        assert_eq!(calls.get(), 0);
        assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn file_mutations_reject_junction_ancestors_without_entering_operation() {
        let root = temp_root("mutation-junction");
        let outside = temp_root("mutation-junction-outside");
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let link = root.join("junction");
        let created = std::process::Command::new("cmd").args(["/C", "mklink", "/J"])
            .arg(&link).arg(&outside).output().unwrap();
        assert!(created.status.success(), "Junction fixture unavailable; coverage NOT accepted: {}", String::from_utf8_lossy(&created.stderr));
        let roots = AuthorizedRoots::default();
        roots.authorize(&root).unwrap();
        let calls = std::cell::Cell::new(0);
        let result = authorized_mutation_path(&roots, root.to_str().unwrap(), "junction/keep.txt")
            .and_then(|path| with_regular_file(&path, |_| { calls.set(calls.get() + 1); Ok(()) }));
        assert_eq!(mutation_code(&result.unwrap_err()), "unsafe-path");
        assert_eq!(calls.get(), 0);
        assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");
        fs::remove_dir(&link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn file_mutations_reject_non_symlink_reparse_ancestors() {
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn DeviceIoControl(handle: *mut c_void, code: u32, input: *const c_void, input_len: u32,
                output: *mut c_void, output_len: u32, returned: *mut u32, overlapped: *mut c_void) -> i32;
        }
        let root = temp_root("mutation-reparse");
        let directory = root.join("opaque");
        fs::create_dir(&directory).unwrap();
        let handle = fs::OpenOptions::new().access_mode(0x40000000)
            .custom_flags(0x02200000).open(&directory).unwrap();
        // A non-Microsoft, non-name-surrogate tag is a reparse point, but not a symlink.
        let mut buffer = [0u8; 24];
        buffer[..4].copy_from_slice(&0x42u32.to_le_bytes());
        buffer[8..].copy_from_slice(&[0x12; 16]);
        let mut returned = 0;
        let result = unsafe { DeviceIoControl(handle.as_raw_handle(), 0x900A4, buffer.as_ptr().cast(),
            buffer.len() as u32, std::ptr::null_mut(), 0, &mut returned, std::ptr::null_mut()) };
        assert_ne!(result, 0, "Non-symlink reparse fixture unavailable; coverage NOT accepted: {}", std::io::Error::last_os_error());
        drop(handle);
        let metadata = fs::symlink_metadata(&directory).unwrap();
        assert!(is_reparse_point(&metadata));
        assert!(!metadata.file_type().is_symlink());
        let roots = AuthorizedRoots::default();
        roots.authorize(&root).unwrap();
        let resolved = authorized_mutation_path(&roots, root.to_str().unwrap(), "opaque/child");
        let direct = rooted_path_from_canonical(fs::canonicalize(&root).unwrap(), "opaque");
        fs::remove_dir(&directory).unwrap();
        drop(roots);
        fs::remove_dir(&root).unwrap();
        assert_eq!(mutation_code(&direct.unwrap_err()), "unsafe-path");
        assert_eq!(mutation_code(&resolved.unwrap_err()), "unsafe-path");
    }

    #[test]
    fn temporary_cleanup_retains_authorization_on_failure_and_allows_retry() {
        let root = temp_root("cleanup-retry");
        let roots = AuthorizedRoots::default();
        let canonical = roots.authorize_temporary(&root).unwrap();
        let calls = std::cell::Cell::new(0);
        let error = roots.cleanup_temporary(&root, |target| {
            assert_eq!(target, canonical);
            calls.set(calls.get() + 1);
            Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "cleanup failure"))
        }).unwrap_err();
        assert!(error.contains("cleanup failure"));
        assert_eq!(roots.resolve_root(root.to_str().unwrap()).unwrap(), canonical);
        assert!(roots.state.lock().unwrap().temporary.contains(&canonical));
        roots.cleanup_temporary(&root, |target| {
            calls.set(calls.get() + 1);
            fs::remove_dir_all(target)
        }).unwrap();
        assert_eq!(calls.get(), 2);
        assert!(!root.exists());
        let state = roots.state.lock().unwrap();
        assert!(!state.temporary.contains(&canonical));
        assert!(!state.roots.contains(&canonical));
    }

    #[test]
    fn temporary_cleanup_rejects_unauthorized_targets_before_operation() {
        let root = temp_root("cleanup-unauthorized");
        let roots = AuthorizedRoots::default();
        let calls = std::cell::Cell::new(0);
        for authorized in [false, true] {
            if authorized { roots.authorize(&root).unwrap(); }
            assert!(roots.cleanup_temporary(&root, |_| {
                calls.set(calls.get() + 1);
                Ok(())
            }).is_err());
        }
        assert_eq!(calls.get(), 0);
        assert!(root.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn binary_roundtrip_base64() {
        let root = temp_root("bin");
        let file = root.join("卡片.png");
        let payload = base64::engine::general_purpose::STANDARD.encode([0x89, 0x50, 0x4e, 0x47]);
        write_binary_impl(&file, &payload).unwrap();
        assert_eq!(read_binary_impl(&file).unwrap(), payload);
        assert!(write_binary_impl(&file, "not-base64!!!").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn picked_file_guards_size_before_reading() {
        let root = temp_root("pick");
        let file = root.join("聊天.jsonl");
        fs::write(&file, b"{\"mes\":\"hi\"}").unwrap();

        let picked = read_picked_file_impl(&file, MAX_PICKED_FILE_BYTES).unwrap();
        assert_eq!(picked.name, "聊天.jsonl");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(picked.base64)
                .unwrap(),
            b"{\"mes\":\"hi\"}"
        );

        // 超限在读盘前就返回错误，且提示里带上体积
        let err = read_picked_file_impl(&file, 4).unwrap_err();
        assert!(err.contains("文件过大"), "实际错误: {err}");

        assert!(read_picked_file_impl(&root.join("不存在.jsonl"), MAX_PICKED_FILE_BYTES).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_formats_are_explicitly_allowlisted() {
        for extension in ["json", "jsonl", "ste-play", "md"] {
            assert!(text_export_label(extension).is_ok());
        }
        for extension in ["exe", "../json", "PNG", ""] {
            assert!(text_export_label(extension).is_err());
        }
        assert!(binary_export_label("png").is_ok());
        assert!(binary_export_label("ste-reading").is_ok());
        assert!(binary_export_label("zip").is_ok());
        assert!(binary_export_label("json").is_err());
    }

    #[test]
    fn selected_binary_export_preserves_bytes_and_cancel_does_not_write() {
        let root = temp_root("selected-binary-export");
        let target = root.join("卡.png");
        let bytes = [137, 80, 78, 71, 0, 255];
        assert!(write_selected_export(Some(target.clone()), &bytes).unwrap());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert!(!write_selected_export(None, b"cancelled").unwrap());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert!(write_selected_export(Some(PathBuf::from("relative.png")), &bytes).is_err());
        assert!(write_selected_export(Some(root.clone()), &bytes).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selected_text_export_writes_outside_vault_without_granting_directory_access() {
        let root = temp_root("selected-text-export");
        let target = root.join("恢复.jsonl");
        let roots = AuthorizedRoots::default();
        assert!(authorized_write_absolute_path(&roots, target.to_str().unwrap()).is_err());
        assert!(write_selected_text_export(Some(target.clone()), "当前编辑与输入").unwrap());
        assert_eq!(read_text_impl(&target).unwrap(), "当前编辑与输入");
        assert!(authorized_write_absolute_path(&roots, target.to_str().unwrap()).is_err());
        assert!(!write_selected_text_export(None, "取消时不能改文件").unwrap());
        assert_eq!(read_text_impl(&target).unwrap(), "当前编辑与输入");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn selected_text_export_surfaces_write_failure_and_keeps_existing_content() {
        let root = temp_root("failed-text-export");
        let target = root.join("existing-directory.jsonl");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("保留.txt"), "既有文件").unwrap();
        assert!(write_selected_text_export(Some(target.clone()), "不能覆盖目录").is_err());
        assert_eq!(read_text_impl(&target.join("保留.txt")).unwrap(), "既有文件");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        assert!(write_selected_text_export(Some(PathBuf::from("relative.jsonl")), "拒绝相对路径").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_dir_keeps_non_empty() {
        let root = temp_root("rm");
        let dir = root.join("赫敏");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("用户自己放的.txt"), "x").unwrap();
        // 非空目录：不删、不报错，返回 false
        assert_eq!(remove_empty_dir_impl(&dir).unwrap(), false);
        assert!(dir.join("用户自己放的.txt").exists());
        remove_file_impl(&dir.join("用户自己放的.txt")).unwrap();
        assert_eq!(remove_empty_dir_impl(&dir).unwrap(), true);
        assert!(!dir.exists());
        // 不存在的目录：幂等，不报错（删角色卡时「故事」子目录可能从未创建过）
        assert_eq!(remove_empty_dir_impl(&dir).unwrap(), false);
        assert_eq!(remove_empty_dir_impl(&root.join("从未存在")).unwrap(), false);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_refuses_overwrite() {
        let root = temp_root("mv");
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();
        assert!(rename_impl(&root.join("a.txt"), &root.join("b.txt")).is_err());
        rename_impl(&root.join("a.txt"), &root.join("c.txt")).unwrap();
        assert_eq!(read_text_impl(&root.join("c.txt")).unwrap(), "a");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_get_set_roundtrip() {
        let root = temp_root("cfg");
        assert_eq!(config_get_impl(&root, "vaultRoot").unwrap(), None);
        config_set_impl(&root, "vaultRoot", serde_json::json!("D:/我的STE库")).unwrap();
        config_set_impl(&root, "stRoot", serde_json::json!("D:/SillyTavern")).unwrap();
        assert_eq!(
            config_get_impl(&root, "vaultRoot").unwrap(),
            Some(serde_json::json!("D:/我的STE库"))
        );
        assert_eq!(
            config_get_impl(&root, "stRoot").unwrap(),
            Some(serde_json::json!("D:/SillyTavern"))
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_set_accepts_exactly_the_keys_the_frontend_writes() {
        let root = temp_root("cfg-allowlist");
        // 这几个键在前端各有唯一写入点；少一个就是某个功能在客户端上静默失效。
        // 故意重复列一遍而不是遍历 CONFIG_WRITABLE_KEYS：遍历常量只能证明它自己一致，
        // 这里要钉的是「前端真的会写这些」——加了新键就必须回来同步这份清单。
        for key in [
            "stRoot",
            "vaultRoot",
            "vaultRegistry",
            "apiProfiles",
            "apiActiveProfile",
            "apiProfilesByVault",
            "apiScopeByVault",
        ] {
            config_set_impl(&root, key, serde_json::json!("v"))
                .unwrap_or_else(|e| panic!("{key} 应当可写: {e}"));
            assert_eq!(
                config_get_impl(&root, key).unwrap(),
                Some(serde_json::json!("v"))
            );
            assert!(
                CONFIG_WRITABLE_KEYS.contains(&key),
                "{key} 不在白名单里，上面那句本该失败"
            );
        }
        // 「恰好」是双向的：白名单里也不该有前端根本不写、白放开的键。
        assert_eq!(CONFIG_WRITABLE_KEYS.len(), 7, "白名单增删后请同步上面的清单");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_set_keeps_every_key_under_concurrent_writers() {
        let root = temp_root("cfg-concurrent");
        // 每个线程反复写自己的键：没有锁时，一个线程按旧快照写回会把别的键改回旧值或抹掉。
        let writers: Vec<_> = CONFIG_WRITABLE_KEYS
            .iter()
            .map(|key| {
                let root = root.clone();
                std::thread::spawn(move || {
                    for round in 0..40 {
                        config_set_impl(&root, key, serde_json::json!(round)).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        for key in CONFIG_WRITABLE_KEYS {
            assert_eq!(config_get_impl(&root, key).unwrap(), Some(serde_json::json!(39)), "{key} 丢了最后一次写入");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_lock_times_out_without_mutation_and_can_retry_after_release() {
        let root = temp_root("cfg-lock-timeout");
        config_set_impl(&root, "vaultRoot", serde_json::json!("synthetic-root")).unwrap();
        let before = fs::read(config_file(&root)).unwrap();
        let held = lock_config(&root).unwrap();
        let started = std::time::Instant::now();
        let error = lock_config_with_timeout(&root, std::time::Duration::from_millis(100)).unwrap_err();
        assert!(error.starts_with("STE_CONFIG_LOCK_TIMEOUT:"));
        assert!(started.elapsed() >= std::time::Duration::from_millis(100));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        assert_eq!(fs::read(config_file(&root)).unwrap(), before);
        drop(held);
        config_set_impl(&root, "vaultRoot", serde_json::json!("synthetic-next")).unwrap();
        assert_eq!(config_get_impl(&root, "vaultRoot").unwrap(), Some(serde_json::json!("synthetic-next")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn config_set_rejects_keys_outside_the_allowlist() {
        let root = temp_root("cfg-unknown-key");
        config_set_impl(&root, "vaultRoot", serde_json::json!("D:/库")).unwrap();
        let before = fs::read_to_string(config_file(&root)).unwrap();

        // 注入脚本写任意键 → 拒绝；配置文件一个字节都不动，已有的库根不受影响
        assert!(config_set_impl(&root, "other", serde_json::json!(42)).is_err());
        assert!(config_set_impl(&root, "VaultRoot", serde_json::json!("C:/")).is_err());
        assert!(config_set_impl(&root, "", serde_json::json!("C:/")).is_err());

        assert_eq!(fs::read_to_string(config_file(&root)).unwrap(), before);
        assert_eq!(config_get_impl(&root, "other").unwrap(), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_set_refuses_to_overwrite_corrupt_config() {
        let root = temp_root("cfg-corrupt");
        let file = config_file(&root);
        fs::write(&file, "{ not valid json").unwrap();

        let result = config_set_impl(
            &root,
            "vaultRegistry",
            serde_json::json!({
                "version": 1,
            }),
        );

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ not valid json");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_get_rejects_non_object_root() {
        let root = temp_root("cfg-non-object");
        let file = config_file(&root);
        fs::write(&file, "[]").unwrap();

        let result = config_get_impl(&root, "vaultRoot");

        assert!(result.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_get_rejects_non_utf8_config_as_invalid_config() {
        let root = temp_root("cfg-non-utf8");
        let file = config_file(&root);
        fs::write(&file, [0xff_u8, 0xfe_u8, 0x00_u8]).unwrap();

        let result = config_get_impl(&root, "vaultRoot").unwrap_err();

        assert!(result.starts_with(CONFIG_INVALID_PREFIX));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_repair_backs_up_and_resets_invalid_file() {
        let root = temp_root("cfg-repair");
        let file = config_file(&root);
        fs::write(&file, "{ broken json").unwrap();

        let backup = config_repair_impl(&root).unwrap().unwrap();

        assert_eq!(fs::read_to_string(&backup).unwrap(), "{ broken json");
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
        assert_eq!(config_get_impl(&root, "vaultRoot").unwrap(), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_repair_handles_non_object_root_and_leaves_valid_config_alone() {
        let root = temp_root("cfg-repair-root");
        let file = config_file(&root);
        fs::write(&file, "[]").unwrap();

        let backup = config_repair_impl(&root).unwrap().unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), "[]");
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");

        config_set_impl(&root, "vaultRoot", serde_json::json!("D:/vault")).unwrap();
        let valid = fs::read_to_string(&file).unwrap();
        assert_eq!(config_repair_impl(&root).unwrap(), None);
        assert_eq!(fs::read_to_string(&file).unwrap(), valid);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn authorized_roots_reject_unregistered_relative_roots() {
        let allowed = temp_root("authorized-relative");
        let denied = temp_root("unauthorized-relative");
        let roots = AuthorizedRoots::default();

        roots.authorize(&allowed).unwrap();

        assert_eq!(
            authorized_rooted_path(&roots, allowed.to_str().unwrap(), "故事/item.json").unwrap(),
            fs::canonicalize(&allowed)
                .unwrap()
                .join("故事")
                .join("item.json")
        );
        let error =
            authorized_rooted_path(&roots, denied.to_str().unwrap(), "secret.txt").unwrap_err();
        assert!(error.contains("未授权"));
        let _ = fs::remove_dir_all(&allowed);
        let _ = fs::remove_dir_all(&denied);
    }

    #[test]
    fn absolute_text_paths_must_stay_under_an_authorized_root() {
        let allowed = temp_root("authorized-absolute");
        let denied = temp_root("unauthorized-absolute");
        let roots = AuthorizedRoots::default();
        roots.authorize(&allowed).unwrap();
        let allowed_file = allowed.join("chat.jsonl");
        let denied_file = denied.join("secret.txt");
        fs::write(&allowed_file, "allowed").unwrap();
        fs::write(&denied_file, "denied").unwrap();

        assert_eq!(
            authorized_read_absolute_path(&roots, allowed_file.to_str().unwrap()).unwrap(),
            fs::canonicalize(&allowed_file).unwrap()
        );
        assert!(authorized_read_absolute_path(&roots, denied_file.to_str().unwrap()).is_err());
        assert_eq!(
            authorized_write_absolute_path(&roots, allowed.join("new.jsonl").to_str().unwrap())
                .unwrap(),
            fs::canonicalize(&allowed).unwrap().join("new.jsonl")
        );
        assert!(
            authorized_write_absolute_path(&roots, denied.join("new.txt").to_str().unwrap())
                .is_err()
        );
        let _ = fs::remove_dir_all(&allowed);
        let _ = fs::remove_dir_all(&denied);
    }

    #[test]
    fn configured_vault_and_st_roots_are_restored_without_authorizing_missing_paths() {
        let config_dir = temp_root("authorized-config");
        let active_vault = temp_root("authorized-config-vault");
        let registered_vault = temp_root("authorized-config-registered");
        let st_root = temp_root("authorized-config-st");
        let missing = config_dir.join("missing");
        config_set_impl(&config_dir, "vaultRoot", serde_json::json!(active_vault)).unwrap();
        config_set_impl(&config_dir, "stRoot", serde_json::json!(st_root)).unwrap();
        config_set_impl(
            &config_dir,
            "vaultRegistry",
            serde_json::json!({
                "version": 1,
                "activeId": "registered",
                "vaults": [
                    { "id": "registered", "path": registered_vault },
                    { "id": "missing", "path": missing }
                ]
            }),
        )
        .unwrap();
        let roots = AuthorizedRoots::default();

        restore_configured_roots(&roots, &config_dir).unwrap();

        assert!(authorized_rooted_path(&roots, active_vault.to_str().unwrap(), "").is_ok());
        assert!(authorized_rooted_path(&roots, registered_vault.to_str().unwrap(), "").is_ok());
        assert!(authorized_rooted_path(&roots, st_root.to_str().unwrap(), "").is_ok());
        assert!(authorized_rooted_path(&roots, missing.to_str().unwrap(), "").is_err());
        let _ = fs::remove_dir_all(&config_dir);
        let _ = fs::remove_dir_all(&active_vault);
        let _ = fs::remove_dir_all(&registered_vault);
        let _ = fs::remove_dir_all(&st_root);
    }

    #[test]
    fn only_current_configured_roots_are_restored_on_every_start() {
        let config_dir = temp_root("authorized-migration");
        let migrated = temp_root("authorized-migration-original");
        let injected_later = temp_root("authorized-migration-injected");
        config_set_impl(&config_dir, "vaultRoot", serde_json::json!(migrated)).unwrap();
        let first_boot = AuthorizedRoots::default();

        restore_authorized_roots(&first_boot, &config_dir).unwrap();

        assert!(authorized_rooted_path(&first_boot, migrated.to_str().unwrap(), "").is_ok());
        assert!(authorization_file(&config_dir).exists());

        config_set_impl(&config_dir, "vaultRoot", serde_json::json!(injected_later)).unwrap();
        let second_boot = AuthorizedRoots::default();
        restore_authorized_roots(&second_boot, &config_dir).unwrap();

        assert!(authorized_rooted_path(&second_boot, migrated.to_str().unwrap(), "").is_err());
        assert!(authorized_rooted_path(&second_boot, injected_later.to_str().unwrap(), "").is_ok());
        let _ = fs::remove_dir_all(&config_dir);
        let _ = fs::remove_dir_all(&migrated);
        let _ = fs::remove_dir_all(&injected_later);
    }

    #[test]
    fn source_and_temporary_roots_are_read_only_even_under_a_writable_parent() {
        let parent = temp_root("purpose-parent");
        let source = parent.join("st");
        let temporary = parent.join("temporary");
        fs::create_dir_all(&source).unwrap(); fs::create_dir_all(&temporary).unwrap();
        let roots = AuthorizedRoots::default();
        roots.authorize(&parent).unwrap();
        roots.authorize_source(&source, true).unwrap();
        roots.authorize_temporary(&temporary).unwrap();
        assert!(authorized_rooted_path(&roots, source.to_str().unwrap(), "").is_ok());
        for root in [&source, &temporary] {
            assert!(authorized_writable_path(&roots, root.to_str().unwrap(), "data.json").is_err());
            assert!(authorized_mutation_path(&roots, root.to_str().unwrap(), "data.json").is_err());
            assert!(authorized_write_absolute_path(&roots, root.join("data.json").to_str().unwrap()).is_err());
        }
        assert!(authorized_writable_path(&roots, parent.to_str().unwrap(), "st/data.json").is_err());
        assert!(authorized_writable_path(&roots, parent.to_str().unwrap(), "temporary/data.json").is_err());
        assert!(authorized_writable_path(&roots, parent.to_str().unwrap(), "own/data.json").is_ok());
        assert!(authorized_writeback_path(&roots, source.join("chat.jsonl").to_str().unwrap()).is_ok());
        assert!(authorized_writeback_path(&roots, source.join("data.json").to_str().unwrap()).is_err());
        assert!(authorized_writeback_path(&roots, temporary.join("chat.jsonl").to_str().unwrap()).is_err());
        assert!(authorized_writeback_path(&roots, parent.join("chat.jsonl").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn export_selection_preserves_existing_library_role() {
        let parent = temp_root("export-existing-library");
        let vault = parent.join("library");
        let export = parent.join("export");
        fs::create_dir_all(&vault).unwrap(); fs::create_dir_all(&export).unwrap();
        let roots = AuthorizedRoots::default();
        roots.authorize_persistent(&vault).unwrap();
        roots.authorize_export(&vault).unwrap();
        assert!(roots.has_grant(&vault, false).unwrap());
        assert!(roots.authorize_selected_source(&vault, true).is_err());
        assert!(authorized_writable_path(&roots, vault.to_str().unwrap(), "synthetic.json").is_ok());
        roots.authorize_export(&export).unwrap();
        assert!(!roots.has_grant(&export, false).unwrap());
        assert!(authorized_writable_path(&roots, export.to_str().unwrap(), "synthetic.json").is_ok());
        drop(roots); let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn selecting_source_cannot_change_an_overlapping_library_grant() {
        let parent = temp_root("source-picker-library");
        let vault = parent.join("library");
        let child = vault.join("child");
        let source = parent.join("source");
        fs::create_dir_all(&child).unwrap(); fs::create_dir_all(&source).unwrap();
        let roots = AuthorizedRoots::default();
        roots.authorize_persistent(&vault).unwrap();
        let target = fs::canonicalize(&vault).unwrap().join("synthetic.json");
        assert!(roots.ensure_writable(&target).is_ok());
        for selected in [&vault, &parent, &child] {
            assert!(roots.authorize_selected_source(selected, true).is_err());
            assert!(roots.has_grant(&vault, false).unwrap());
            assert!(!roots.has_grant(selected, true).unwrap());
            assert!(roots.ensure_writable(&target).is_ok());
        }
        roots.authorize_persistent(&vault).unwrap();
        assert!(roots.ensure_writable(&target).is_ok());
        roots.authorize_selected_source(&source, true).unwrap();
        assert!(roots.has_grant(&source, true).unwrap());
        assert!(roots.ensure_writable(&fs::canonicalize(&source).unwrap().join("synthetic.json")).is_err());
        assert!(authorized_writeback_path(&roots, source.join("chat.jsonl").to_str().unwrap()).is_ok());
        drop(roots); let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn a_second_library_owner_cannot_read_or_recover_until_the_first_releases() {
        let root = temp_root("library-lease");
        let first = AuthorizedRoots::default(); let second = AuthorizedRoots::default();
        first.authorize(&root).unwrap(); second.authorize(&root).unwrap();
        assert!(authorized_rooted_path(&first, root.to_str().unwrap(), "").is_ok());
        assert!(authorized_rooted_path(&second, root.to_str().unwrap(), "").unwrap_err().contains("STE_LIBRARY_IN_USE"));
        assert!(authorized_write_absolute_path(&second, root.join("file.txt").to_str().unwrap()).is_err());
        // Compatibility checks must never add files to a newer-format library.
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::write(root.join("file.txt"), "synthetic").unwrap();
        assert!(authorized_read_absolute_path(&second, root.join("file.txt").to_str().unwrap()).unwrap_err().contains("STE_LIBRARY_IN_USE"));
        drop(first);
        assert!(authorized_rooted_path(&second, root.to_str().unwrap(), "").is_ok());
        drop(second); let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_offline_configuration_can_be_saved_without_a_new_picker_grant() {
        let config = temp_root("offline-config-save");
        let offline = config.join("disconnected");
        config_set_impl(&config, "vaultRoot", serde_json::json!(offline)).unwrap();
        let roots = AuthorizedRoots::default();
        restore_authorized_roots(&roots, &config).unwrap();
        config_set_authorized(&roots, &config, "vaultRegistry", serde_json::json!({"vaults":[{"id":"old", "path":offline}]})).unwrap();
        fs::create_dir(&offline).unwrap();
        let restarted = AuthorizedRoots::default(); restore_authorized_roots(&restarted, &config).unwrap();
        assert!(authorized_rooted_path(&restarted, offline.to_str().unwrap(), "").is_ok());
        drop(restarted); let _ = fs::remove_dir_all(config);
    }

    #[test]
    fn root_configuration_requires_matching_picker_grants_and_revokes_removed_libraries() {
        let config = temp_root("purpose-config");
        let vault = temp_root("purpose-vault");
        let source = temp_root("purpose-source");
        let export = temp_root("purpose-export");
        let roots = AuthorizedRoots::default();
        assert!(config_set_authorized(&roots, &config, "vaultRoot", serde_json::json!(vault)).is_err());
        roots.authorize_source(&source, true).unwrap();
        roots.authorize_export(&export).unwrap();
        for path in [&source, &export] {
            assert!(config_set_authorized(&roots, &config, "vaultRoot", serde_json::json!(path)).is_err());
        }
        config_set_authorized(&roots, &config, "stRoot", serde_json::json!(source)).unwrap();
        roots.authorize_persistent(&vault).unwrap();
        config_set_authorized(&roots, &config, "vaultRegistry", serde_json::json!({"vaults":[{"id":"v", "path":vault}]})).unwrap();
        config_set_authorized(&roots, &config, "vaultRegistry", serde_json::json!({"vaults":[]})).unwrap();
        assert!(authorized_rooted_path(&roots, vault.to_str().unwrap(), "").is_err());
        let reopened = AuthorizedRoots::default();
        restore_authorized_roots(&reopened, &config).unwrap();
        assert!(authorized_rooted_path(&reopened, vault.to_str().unwrap(), "").is_err());
        assert!(authorized_writable_path(&reopened, source.to_str().unwrap(), "file").is_err());
        for path in [config, vault, source, export] { let _ = fs::remove_dir_all(path); }
    }

    #[cfg(windows)]
    #[test]
    fn absolute_paths_reject_an_ancestor_junction_even_when_its_target_is_authorized() {
        let root = temp_root("absolute-ancestor");
        let target = root.join("target"); let link = root.join("link");
        fs::create_dir(&target).unwrap(); fs::write(target.join("chat.jsonl"), "{}").unwrap();
        let output = std::process::Command::new("cmd").args(["/C", "mklink", "/J"])
            .arg(&link).arg(&target).output().unwrap();
        assert!(output.status.success());
        let roots = AuthorizedRoots::default(); roots.authorize_source(&root, true).unwrap();
        let requested = link.join("chat.jsonl");
        assert!(authorized_read_absolute_path(&roots, requested.to_str().unwrap()).is_err());
        assert!(authorized_writeback_path(&roots, requested.to_str().unwrap()).is_err());
        assert!(write_selected_export(Some(requested), b"changed").is_err());
        assert_eq!(fs::read_to_string(target.join("chat.jsonl")).unwrap(), "{}");
        fs::remove_dir(link).unwrap(); let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupted_authorization_file_falls_back_to_configured_roots() {
        let config_dir = temp_root("authorized-corrupt");
        let configured = temp_root("authorized-corrupt-configured");
        fs::write(authorization_file(&config_dir), "{not valid json").unwrap();
        config_set_impl(&config_dir, "vaultRoot", serde_json::json!(configured)).unwrap();

        let roots = AuthorizedRoots::default();
        restore_authorized_roots(&roots, &config_dir).unwrap();

        assert!(authorized_rooted_path(&roots, configured.to_str().unwrap(), "").is_ok());
        let persisted: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(authorization_file(&config_dir)).unwrap(),
        ).unwrap();
        assert_eq!(persisted["roots"], serde_json::json!([fs::canonicalize(&configured).unwrap()]));
        drop(roots);
        let restarted = AuthorizedRoots::default();
        restore_authorized_roots(&restarted, &config_dir).unwrap();
        assert!(authorized_rooted_path(&restarted, configured.to_str().unwrap(), "").is_ok());
        let _ = fs::remove_dir_all(&config_dir);
        let _ = fs::remove_dir_all(&configured);
    }

    #[test]
    fn configured_root_that_returns_after_startup_is_authorized_and_persisted() {
        let config_dir = temp_root("authorized-reconnect");
        let reconnecting = config_dir.join("offline-vault");
        config_set_impl(&config_dir, "vaultRoot", serde_json::json!(reconnecting)).unwrap();

        let first_boot = AuthorizedRoots::default();
        restore_authorized_roots(&first_boot, &config_dir).unwrap();
        assert!(authorized_rooted_path(&first_boot, reconnecting.to_str().unwrap(), "").is_err());

        fs::create_dir_all(&reconnecting).unwrap();
        let second_boot = AuthorizedRoots::default();
        restore_authorized_roots(&second_boot, &config_dir).unwrap();
        assert!(authorized_rooted_path(&second_boot, reconnecting.to_str().unwrap(), "").is_ok());
        let persisted: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(authorization_file(&config_dir)).unwrap(),
        ).unwrap();
        assert_eq!(persisted["roots"], serde_json::json!([fs::canonicalize(&reconnecting).unwrap()]));
        drop(second_boot);
        let restarted = AuthorizedRoots::default();
        restore_authorized_roots(&restarted, &config_dir).unwrap();
        assert!(authorized_rooted_path(&restarted, reconnecting.to_str().unwrap(), "").is_ok());
        let _ = fs::remove_dir_all(&config_dir);
    }
}
