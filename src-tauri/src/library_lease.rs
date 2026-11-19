//! Process-lifetime library exclusion without changing the inspected library.
use std::path::Path;
use sha2::{Digest, Sha256};

const IN_USE: &str = "STE_LIBRARY_IN_USE:这个文件库正在另一个STE窗口中使用，请先关闭那个窗口";

#[cfg(windows)]
pub struct LibraryLease(isize);

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *const std::ffi::c_void, owner: i32, name: *const u16) -> *mut std::ffi::c_void;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    fn GetLastError() -> u32;
}

#[cfg(windows)]
impl Drop for LibraryLease {
    fn drop(&mut self) { unsafe { CloseHandle(self.0 as *mut std::ffi::c_void); } }
}

#[cfg(not(windows))]
pub struct LibraryLease { _file: std::fs::File }

pub fn acquire(root: &Path) -> Result<LibraryLease, String> {
    let identity = root.to_string_lossy().into_owned();
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
    #[cfg(windows)]
    {
        // Object existence is the lease. No thread-affine mutex ownership is used.
        // Global namespace coordinates separate Windows sessions as well as windows.
        let name: Vec<u16> = format!("Global\\STE.Library.{key}").encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        let error = unsafe { GetLastError() };
        if handle.is_null() { return Err(format!("无法取得库访问锁（系统错误 {error}）")); }
        let lease = LibraryLease(handle as isize);
        if error == 183 { return Err(IN_USE.into()); }
        Ok(lease)
    }
    #[cfg(not(windows))]
    {
        let directory = std::env::temp_dir().join("ste-library-leases");
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建库访问锁".to_string())?;
        let file = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(directory.join(key)).map_err(|_| "无法打开库访问锁".to_string())?;
        file.try_lock().map_err(|_| IN_USE.to_string())?;
        Ok(LibraryLease { _file: file })
    }
}
