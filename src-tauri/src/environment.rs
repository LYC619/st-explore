use serde::Serialize;
use std::{fs, path::Path};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    pub status: &'static str,
    pub nominal_path: String,
    pub resolved_path: Option<String>,
    pub package_identity: Option<String>,
    pub log_available: bool,
}

#[cfg(windows)]
fn package_identity() -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" { fn GetCurrentPackageFullName(length: *mut u32, name: *mut u16) -> i32; }
    let mut length = 0u32;
    // ERROR_INSUFFICIENT_BUFFER means this process has a package identity.
    if unsafe { GetCurrentPackageFullName(&mut length, std::ptr::null_mut()) } != 122 || length == 0 { return None; }
    let mut buffer = vec![0u16; length as usize];
    if unsafe { GetCurrentPackageFullName(&mut length, buffer.as_mut_ptr()) } != 0 { return None; }
    Some(String::from_utf16_lossy(&buffer[..length.saturating_sub(1) as usize]))
}
#[cfg(not(windows))]
fn package_identity() -> Option<String> { None }

fn normalized(value: &str) -> String { value.trim_start_matches(r"\\?\").replace('\\', "/").to_lowercase() }
pub fn inspect(config_dir: &Path, log_available: bool) -> EnvironmentInfo {
    // canonicalize resolves the directory through a Windows file handle, including redirection.
    let resolved = fs::canonicalize(config_dir).ok().map(|p| p.to_string_lossy().into_owned());
    let nominal = config_dir.to_string_lossy().into_owned();
    let package = package_identity();
    let redirected_path = resolved.as_ref().is_some_and(|p| normalized(p) != normalized(&nominal));
    // Current STE packages are ordinary desktop executables; a package identity is inherited.
    let redirected_package = package.is_some();
    let status = if redirected_path || redirected_package { "redirected" } else if resolved.is_some() { "normal" } else { "unknown" };
    EnvironmentInfo { status, nominal_path: nominal, resolved_path: resolved, package_identity: package, log_available }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_directory_does_not_claim_a_resolved_path() {
        let value=inspect(&std::env::temp_dir().join("ste-environment-synthetic-absent"),false);
        assert!(value.resolved_path.is_none()); assert!(!value.log_available);
    }
}
