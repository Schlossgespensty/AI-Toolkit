//! Coordinate extraction per cache directory. Parallel windows can share a
//! completed result instead of decoding and rewriting the same sprites twice.
use super::Result;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub fn extract<T>(directory: &Path, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let directory = fs::canonicalize(directory).map_err(|e| e.to_string())?;
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let lock = {
        let mut locks = LOCKS
            .get_or_init(Mutex::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        locks.retain(|_, value| value.strong_count() > 0);
        let entry = locks.entry(directory).or_default();
        if let Some(lock) = entry.upgrade() {
            lock
        } else {
            let lock = Arc::new(Mutex::new(()));
            *entry = Arc::downgrade(&lock);
            lock
        }
    };
    // Registration and acquisition are separate from filesystem work so other
    // installations and asset kinds continue loading in parallel.
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    operation()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn simultaneous_requests_reuse_a_completed_extraction() {
        let directory =
            std::env::temp_dir().join(format!("toolkit-concurrent-cache-{}", std::process::id()));
        let count = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    extract(&directory, || {
                        let output = directory.join("ready");
                        if !output.exists() {
                            count.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(std::time::Duration::from_millis(5));
                            fs::write(output, b"complete").map_err(|e| e.to_string())?;
                        }
                        Ok(())
                    })
                    .unwrap()
                });
            }
        });
        assert_eq!(count.load(Ordering::SeqCst), 1);
        fs::remove_file(directory.join("ready")).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
