//! Reclaim only old, recognisable import workspaces whose owning process has exited.
use std::{
    fs,
    path::Path,
    time::{Duration, SystemTime},
};

const PREFIX: &str = "ste-st-import-";
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn owner_pid(name: &str) -> Option<u32> {
    let (pid, nonce) = name.strip_prefix(PREFIX)?.split_once('-')?;
    if !pid.bytes().all(|c| c.is_ascii_digit()) || !nonce.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let parsed_pid = pid.parse::<u32>().ok()?;
    let parsed_nonce = nonce.parse::<u128>().ok()?;
    (parsed_pid > 0
        && parsed_nonce > 0
        && parsed_pid.to_string() == pid
        && parsed_nonce.to_string() == nonce)
        .then_some(parsed_pid)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// If access is denied or the process status is uncertain, preserve the directory.
#[cfg(windows)]
fn process_is_gone(pid: u32) -> bool {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn GetLastError() -> u32;
    }
    // SYNCHRONIZE allows an exit-status wait without reading another process's memory.
    let handle = unsafe { OpenProcess(0x00100000, 0, pid) };
    if handle.is_null() {
        return unsafe { GetLastError() } == 87;
    }
    let exited = unsafe { WaitForSingleObject(handle, 0) } == 0;
    unsafe {
        CloseHandle(handle);
    }
    exited
}

#[cfg(unix)]
fn process_is_gone(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // Signal 0 checks existence without delivering a signal. ESRCH is the only safe deletion case.
    (unsafe { kill(pid, 0) }) != 0 && std::io::Error::last_os_error().raw_os_error() == Some(3)
}

#[cfg(not(any(windows, unix)))]
fn process_is_gone(_pid: u32) -> bool {
    false
}

/// A nested reparse point is also grounds to preserve the entire candidate.
fn plain_tree(root: &Path, depth: usize, remaining: &mut usize) -> std::io::Result<bool> {
    if depth > 32 || *remaining == 0 {
        return Ok(false);
    }
    *remaining -= 1;
    let metadata = fs::symlink_metadata(root)?;
    if is_link(&metadata) {
        return Ok(false);
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(root)? {
            if !plain_tree(&entry?.path(), depth + 1, remaining)? {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn report_cleanup_failure(path: &Path) {
    let mut event = crate::diagnostics::event(crate::diagnostics::EventKind::Import, "cleanup");
    event.category = Some("io".into());
    event.path = Some(path.to_string_lossy().into_owned());
    crate::diagnostics::record(event);
}

fn cleanup_in(temp_root: &Path, now: SystemTime, gone: impl Fn(u32) -> bool) -> usize {
    let Ok(metadata) = fs::symlink_metadata(temp_root) else {
        return 0;
    };
    if !metadata.is_dir() || is_link(&metadata) {
        return 0;
    }
    let Ok(entries) = fs::read_dir(temp_root) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(owner_pid) else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        let old = metadata
            .modified()
            .ok()
            .and_then(|time| now.duration_since(time).ok())
            .is_some_and(|age| age > MAX_AGE);
        if !old || !gone(pid) {
            continue;
        }
        match plain_tree(&path, 0, &mut 200_000) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(_) => {
                report_cleanup_failure(&path);
                continue;
            }
        }
        // Recheck after inspection. remove_dir_all itself does not follow symlinks.
        if !gone(pid)
            || fs::symlink_metadata(&path)
                .map(|m| is_link(&m))
                .unwrap_or(true)
        {
            continue;
        }
        if fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        } else {
            report_cleanup_failure(&path);
        }
    }
    removed
}

pub fn cleanup_stale_imports() {
    let count = cleanup_in(&std::env::temp_dir(), SystemTime::now(), process_is_gone);
    let mut event = crate::diagnostics::event(crate::diagnostics::EventKind::Import, "cleanup");
    event.count = Some(count as u64);
    crate::diagnostics::record(event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ste-import-cleanup-synthetic-{}-{nonce}-{label}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[cfg(windows)]
    fn directory_link(target: &Path, link: &Path) {
        use std::os::windows::process::CommandExt;
        // Junctions exercise the Windows reparse-point boundary without requiring symlink privilege.
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "synthetic junction creation failed"
        );
    }

    #[cfg(unix)]
    fn directory_link(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[test]
    fn only_exact_generated_names_are_candidates() {
        assert_eq!(owner_pid("ste-st-import-123-456"), Some(123));
        for name in [
            "ste-st-import-test-123-456",
            "ste-st-import-0-456",
            "ste-st-import-123-0",
            "ste-st-import-0123-456",
            "ste-st-import-123-456-old",
            "ste-st-import-123-",
            "ste-st-import-123-+456",
            "ste-st-import-4294967296-456",
        ] {
            assert_eq!(owner_pid(name), None);
        }
        assert!(!process_is_gone(std::process::id()));
    }

    #[test]
    fn only_old_directories_with_a_dead_owner_are_removed() {
        let root = test_root("age");
        let old = root.join("ste-st-import-11-123");
        let live = root.join("ste-st-import-12-123");
        let unrelated = root.join("ste-st-import-test-11-123");
        for dir in [&old, &live, &unrelated] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("synthetic.txt"), "synthetic").unwrap();
        }
        assert_eq!(
            cleanup_in(&root, SystemTime::now(), |_| true),
            0,
            "fresh workspaces are never removed"
        );
        assert_eq!(
            cleanup_in(
                &root,
                SystemTime::now() + Duration::from_secs(25 * 3600),
                |pid| pid != 12
            ),
            1
        );
        assert!(!old.exists());
        assert!(live.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn symlink_candidates_and_nested_links_preserve_their_targets() {
        let root = test_root("link");
        let outside = root.join("synthetic-target");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "synthetic").unwrap();
        let linked = root.join("ste-st-import-11-123");
        let nested = root.join("ste-st-import-12-123");
        fs::create_dir_all(&nested).unwrap();
        directory_link(&outside, &linked);
        directory_link(&outside, &nested.join("link"));
        assert_eq!(
            cleanup_in(
                &root,
                SystemTime::now() + Duration::from_secs(25 * 3600),
                |_| true
            ),
            0
        );
        assert_eq!(
            fs::read_to_string(outside.join("keep.txt")).unwrap(),
            "synthetic"
        );
        assert!(linked.exists());
        assert!(nested.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn inaccessible_candidate_is_preserved_without_stopping_other_cleanup() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = test_root("locked");
        let locked = root.join("ste-st-import-11-123");
        let removable = root.join("ste-st-import-12-123");
        for dir in [&locked, &removable] {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("synthetic.txt"), "synthetic").unwrap();
        }
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(locked.join("synthetic.txt"))
            .unwrap();
        let now = SystemTime::now() + Duration::from_secs(25 * 3600);
        assert_eq!(cleanup_in(&root, now, |_| true), 1);
        assert!(locked.exists());
        assert!(!removable.exists());
        drop(held);
        assert_eq!(cleanup_in(&root, now, |_| true), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
