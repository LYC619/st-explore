//! Local diagnostics accept typed fields, never raw errors, request/response bodies or configuration values.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Write, path::PathBuf, sync::{Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
pub const LOG_FILES: usize = 3;
const WINDOW: Duration = Duration::from_secs(5);
static LOGGER: OnceLock<Mutex<LogStore>> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind { Startup, Environment, Config, Vault, Command, Import, Writeback, FrontendError, Model, Lock }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub event: EventKind,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub elapsed_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub attempt: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub status: Option<u16>,
}

pub fn event(kind: EventKind, operation: &str) -> Event {
    Event { event: kind, operation: operation.into(), category: None, path: None, source: None, host: None, model: None, key: None, elapsed_ms: None, count: None, attempt: None, status: None }
}

pub fn short_hash(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes()))[..12].to_string() }

pub fn redact_path(value: &str) -> String {
    value.replace('\\', "/").split('/').filter(|p| !p.is_empty()).map(|part| {
        if ["角色", "故事", "记录", "附件", "世界书", "预设", "正则", ".ste", "retained"].contains(&part) { return part.to_string(); }
        let extension = part.rsplit_once('.').map(|(_, ext)| ext).filter(|ext| ["json", "jsonl", "png", "jpg", "webp", "txt", "md", "html", "js", "css", "zip"].contains(ext));
        format!("#{}{}", short_hash(part), extension.map(|ext| format!(".{ext}")).unwrap_or_default())
    }).collect::<Vec<_>>().join("/")
}

fn known_operation(value: &str) -> &str {
    match value {
        "start" | "end" | "open" | "switch" | "close" | "ready" | "failed" | "error" | "rejection" | "render" | "route" | "request" | "parse" | "waiting" | "timeout" | "cleanup" | "redirected" | "normal" | "unknown" |
        "vault_list_dir" | "vault_read_text" | "vault_write_text" | "vault_read_binary" | "vault_fingerprint" | "vault_write_binary" | "vault_remove_file" | "vault_trash_file" | "vault_open_path" | "vault_remove_empty_dir" | "vault_rename" | "vault_mkdir" | "vault_stat" | "vault_read_abs_text" | "pick_chat_file" | "save_text_export" | "save_binary_export" | "vault_write_abs_text" | "vault_write_abs_binary" | "vault_pick_authorized_directory" | "config_get" | "config_set" | "config_repair" | "prepare_st_backup_import" | "cleanup_st_backup_import" => value,
        _ => "other",
    }
}
fn known_category(value: &str) -> &str {
    match value {
        "permission" | "rate_limit" | "service" | "network" | "timeout" | "invalid_request" | "blocked" | "empty" | "truncated" | "interrupted" | "parse" | "cancelled" | "syntax" | "type" | "range" | "reference" | "error" | "config_invalid" | "io" | "unknown" => value,
        _ => "unknown",
    }
}
pub fn sanitize(mut value: Event) -> Event {
    value.operation = known_operation(&value.operation).into();
    value.category = value.category.map(|s| known_category(&s).into());
    value.path = value.path.map(|s| redact_path(&s));
    // Host/model/source identifiers can contain user-controlled text. Hash the entire value.
    value.source = value.source.map(|s| short_hash(&s));
    value.host = value.host.map(|s| short_hash(&s));
    value.model = value.model.map(|s| short_hash(&s));
    value.key = value.key.map(|s| if ["stRoot", "vaultRoot", "vaultRegistry", "apiProfiles", "apiActiveProfile", "apiProfilesByVault", "apiScopeByVault"].contains(&s.as_str()) {s} else {"other".into()});
    value
}

pub fn error_category(error: &str) -> &'static str {
    if error.contains("STE_CONFIG_LOCK_TIMEOUT") { "timeout" }
    else if error.contains("STE_CONFIG_INVALID") { "config_invalid" }
    else if error.contains("拒绝") || error.contains("权限") { "permission" }
    else { "io" }
}

struct Pending { event: Event, last: Instant, suppressed: u64 }
struct LogStore { dir: PathBuf, limit: u64, pending: HashMap<String, Pending> }
impl LogStore {
    fn new(dir: PathBuf, limit: u64) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        fs::OpenOptions::new().create(true).append(true).open(dir.join("ste.log"))?;
        Ok(Self { dir, limit, pending: HashMap::new() })
    }
    fn append(&self, event: &Event, repeat: u64) -> std::io::Result<()> {
        let line = serde_json::to_vec(&serde_json::json!({"time":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),"repeat":repeat,"data":event}))?;
        self.write_line(&line)
    }
    fn write_line(&self, line: &[u8]) -> std::io::Result<()> {
        // Multiple STE windows share a directory. Never block application work on logging.
        let lock = fs::OpenOptions::new().create(true).truncate(false).write(true).open(self.dir.join(".diagnostics.lock"))?;
        if lock.try_lock().is_err() { return Ok(()); }
        let size = line.len() as u64 + 1;
        if size > self.limit { return Ok(()); }
        let current = self.dir.join("ste.log");
        if fs::metadata(&current)?.len() + size > self.limit {
            let oldest = self.dir.join("ste.2.log");
            if oldest.exists() { fs::remove_file(oldest)?; }
            let previous = self.dir.join("ste.1.log");
            if previous.exists() { fs::rename(&previous, self.dir.join("ste.2.log"))?; }
            fs::rename(&current, previous)?;
        }
        let mut file = fs::OpenOptions::new().create(true).append(true).open(current)?;
        file.write_all(line)?; file.write_all(b"\n")?; file.flush()
    }
    fn record(&mut self, value: Event, now: Instant) -> std::io::Result<()> {
        self.flush(now, false)?;
        let value = sanitize(value);
        let key = format!("{:?}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}", value.event, value.operation, value.category, value.path, value.source, value.status, value.attempt, value.key, value.host, value.model);
        if let Some(existing) = self.pending.get_mut(&key) {
            existing.suppressed += 1;
            return Ok(());
        }
        self.append(&value, 1)?;
        if self.pending.len() >= 128 { self.flush(now, true)?; }
        self.pending.insert(key, Pending {event:value,last:now,suppressed:0});
        Ok(())
    }
    fn flush(&mut self, now: Instant, all: bool) -> std::io::Result<()> {
        let expired: Vec<_> = self.pending.iter().filter(|(_, p)| all || now.duration_since(p.last) >= WINDOW).map(|(k,_)| k.clone()).collect();
        for key in expired {
            if let Some(p) = self.pending.remove(&key) { if p.suppressed > 0 { self.append(&p.event, p.suppressed)?; } }
        }
        Ok(())
    }
}

pub fn initialize(dir: PathBuf) -> std::io::Result<()> {
    let _ = LOGGER.set(Mutex::new(LogStore::new(dir, MAX_LOG_BYTES)?));
    Ok(())
}
pub fn record(value: Event) { if let Some(store) = LOGGER.get() { if let Ok(mut store) = store.lock() { let _ = store.record(value, Instant::now()); } } }
pub fn flush() { if let Some(store) = LOGGER.get() { if let Ok(mut store) = store.lock() { let _ = store.flush(Instant::now(), true); } } }
pub fn startup(identifier: &str) {
    // Build metadata is generated from package/git fields, not user configuration.
    let info: serde_json::Value = serde_json::from_str(env!("STE_BUILD_INFO_JSON")).unwrap_or_default();
    let mut start = event(EventKind::Startup, "start");
    start.source = Some(format!("{}|{}|{}", identifier, std::env::consts::OS, info));
    record(start);
    if let Some(store) = LOGGER.get() { if let Ok(store) = store.lock() {
        let known = serde_json::json!({"identifier":identifier,"platform":std::env::consts::OS,"version":info.get("version"),"commit":info.get("commit"),"dirty":info.get("dirty"),"builtAt":info.get("builtAt"),"logFileCount":LOG_FILES});
        // Only immutable application metadata enters this fixed startup line.
        if let Ok(line) = serde_json::to_vec(&known) { let _ = store.write_line(&line); }
    } }
}

pub fn command<T>(name: &str, path: Option<String>, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let started = Instant::now();
    operation_event(name, path.clone(), "start", None);
    let result = run();
    command_result(name, path, started, result.as_ref().err()); result
}
pub async fn command_async<T>(name: &str, path: Option<String>, run: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    let started = Instant::now();
    operation_event(name, path.clone(), "start", None);
    let result = run.await;
    command_result(name, path, started, result.as_ref().err()); result
}
fn command_result(name: &str, path: Option<String>, started: Instant, error: Option<&String>) {
    operation_event(name, path.clone(), "end", Some(started.elapsed().as_millis() as u64));
    if let Some(error) = error {
        let mut value = event(EventKind::Command, name);
        value.category = Some(error_category(error).into()); value.path = path;
        value.elapsed_ms = Some(started.elapsed().as_millis() as u64); record(value);
    }
}

fn operation_event(name: &str, path: Option<String>, phase: &str, elapsed: Option<u64>) {
    let kind=match name {"prepare_st_backup_import"=>EventKind::Import,"vault_write_abs_text"|"vault_write_abs_binary"=>EventKind::Writeback,_=>return};
    let mut value=event(kind,phase);value.path=path;value.elapsed_ms=elapsed;value.count=Some(1);record(value);
}
pub fn config_result(key: &str, count: u64, writing: bool) {
    let mut value=event(EventKind::Config,if writing {"config_set"} else {"config_get"});
    value.key=Some(key.into());value.count=Some(count);record(value);
}
pub fn value_count(value: &serde_json::Value) -> u64 {
    if let Some(array)=value.as_array(){array.len() as u64}else if let Some(object)=value.as_object(){object.len() as u64}else{u64::from(!value.is_null())}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf { let path = std::env::temp_dir().join(format!("ste-diagnostics-test-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())); fs::create_dir(&path).unwrap(); path }
    #[test]
    fn never_serializes_private_text_or_keys_in_any_string_field() {
        let secret = "Bearer sk-SYNTHETIC-SECRET private-card-example";
        let mut value = event(EventKind::FrontendError, secret);
        value.category=Some(secret.into());value.path=Some(format!("C:/vault/角色/{secret}/private-story.json"));value.source=Some(secret.into());value.host=Some(secret.into());value.model=Some(secret.into());value.key=Some(secret.into());
        let output=serde_json::to_string(&sanitize(value)).unwrap();
        for sensitive in ["Bearer", "sk-SYNTHETIC", "private-card-example", "private-story", "C:"] {assert!(!output.contains(sensitive));}
        assert!(output.contains("角色")); assert!(output.contains(".json"));
        assert_eq!(redact_path("角色/example.json"),redact_path("角色/example.json"));
    }
    #[test]
    fn caps_three_files_and_counts_suppressed_duplicates() {
        let dir=fixture();let mut store=LogStore::new(dir.clone(),512).unwrap();let now=Instant::now();
        let value=event(EventKind::FrontendError,"error");
        for _ in 0..4 {store.record(value.clone(),now).unwrap();}
        assert_eq!(fs::read_to_string(dir.join("ste.log")).unwrap().lines().count(),1);
        store.flush(now+WINDOW,true).unwrap();
        assert!(fs::read_to_string(dir.join("ste.log")).unwrap().contains("\"repeat\":3"));
        for n in 0..40 {let mut e=value.clone();e.source=Some(n.to_string());store.record(e,now+WINDOW).unwrap();}
        let files=fs::read_dir(&dir).unwrap().map(Result::unwrap).collect::<Vec<_>>();
        assert!(files.iter().filter(|file|file.path().extension().is_some_and(|ext|ext=="log")).count()<=LOG_FILES);assert!(files.iter().all(|file|file.metadata().unwrap().len()<=512));
        for file in files {fs::remove_file(file.path()).unwrap();}fs::remove_dir(dir).unwrap();
    }
}
