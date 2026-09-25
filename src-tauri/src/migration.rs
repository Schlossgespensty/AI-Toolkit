//! One-time import of the Electron editor's local preferences. The original
//! database is never opened by LevelDB: recovery runs on a private copy only.
use crate::storage::{self, Result};
use rusty_leveldb::{LdbIterator, Options, DB};
use serde_json::{Map, Value};
use std::{fs, path::Path};

fn chrome_string(bytes: &[u8]) -> Option<String> {
    match bytes.split_first()? {
        (1, data) => Some(data.iter().map(|b| char::from(*b)).collect()),
        (0, data) if data.len() % 2 == 0 => String::from_utf16(
            &data
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        )
        .ok(),
        _ => None,
    }
}
fn read_copy(source: &Path, copy: &Path) -> Result<Value> {
    fs::create_dir(copy).map_err(crate::error::Error::diagnostic)?;
    for entry in fs::read_dir(source).map_err(crate::error::Error::diagnostic)? {
        let entry = entry.map_err(crate::error::Error::diagnostic)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry
            .file_type()
            .map_err(crate::error::Error::diagnostic)?
            .is_file()
            && (name == "CURRENT"
                || name.starts_with("MANIFEST-")
                || name.ends_with(".ldb")
                || name.ends_with(".log"))
        {
            fs::copy(entry.path(), copy.join(name.as_ref()))
                .map_err(crate::error::Error::diagnostic)?;
        }
    }
    let options = Options {
        create_if_missing: false,
        paranoid_checks: true,
        reuse_logs: false,
        ..Options::default()
    };
    let mut db = DB::open(copy, options).map_err(crate::error::Error::diagnostic)?;
    let mut iter = db.new_iter().map_err(crate::error::Error::diagnostic)?;
    let mut values = Map::new();
    while let Some((key, value)) = iter.next() {
        let Some(key) = key.strip_prefix(b"_file://\0").and_then(chrome_string) else {
            continue;
        };
        if let Some(value) = chrome_string(&value) {
            values.insert(key, Value::String(value));
        }
    }
    Ok(Value::Object(values))
}
pub fn load(user_data: &Path) -> Result<Value> {
    let saved = user_data.join("electron-preferences.json");
    if saved.exists() {
        return storage::read_json(saved);
    }
    let source = user_data.join("Local Storage/leveldb");
    if !source.join("CURRENT").is_file() {
        return Ok(Value::Object(Map::new()));
    }
    let copy = user_data.join(format!(
        "migration-read-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let values = read_copy(&source, &copy);
    // Only remove our absolute, verified temporary child, never the source DB.
    if let (Ok(base), Ok(target)) = (dunce::canonicalize(user_data), dunce::canonicalize(&copy)) {
        if target.parent() == Some(base.as_path())
            && target
                .file_name()
                .is_some_and(|s| s.to_string_lossy().starts_with("migration-read-"))
        {
            let _ = fs::remove_dir_all(target);
        }
    }
    let values = values?;
    storage::atomic_write(
        &saved,
        &serde_json::to_vec(&values).map_err(crate::error::Error::diagnostic)?,
    )?;
    Ok(values)
}
pub fn initialization(user_data: &Path) -> String {
    match load(user_data) {
        Ok(values)=>format!("if(window.top===window){{try{{if(!localStorage.getItem('toolkit.nativeMigration.v1')){{for(const[k,v]of Object.entries({values})){{if(localStorage.getItem(k)===null)localStorage.setItem(k,v);}}localStorage.setItem('toolkit.nativeMigration.v1','1');}}}}catch(error){{console.warn('Preference migration:',error);}}}}"),
        Err(error)=>{eprintln!("Preference migration deferred: {error}");String::new()},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chromium_strings_preserve_unicode() {
        assert_eq!(chrome_string(&[1, b'a', 0xfc]), Some("aü".into()));
        assert_eq!(
            chrome_string(&[0, 0x60, 0x4f, 0x7d, 0x59]),
            Some("你好".into())
        );
        assert_eq!(chrome_string(&[0, 1]), None);
    }
    #[test]
    fn migration_reads_a_copy_and_preserves_original_files() {
        let root =
            std::env::temp_dir().join(format!("toolkit-migration-test-{}", std::process::id()));
        let source = root.join("Local Storage/leveldb");
        fs::create_dir_all(&source).unwrap();
        {
            let mut db = DB::open(&source, Options::default()).unwrap();
            db.put(
                b"_file://\0\x01aiv.lastProject.v1",
                b"\x01{\"aiRoot\":\"unchanged\"}",
            )
            .unwrap();
            db.flush().unwrap();
        }
        let before: Vec<_> = fs::read_dir(&source)
            .unwrap()
            .map(|e| {
                let p = e.unwrap().path();
                (p.clone(), fs::read(p).unwrap())
            })
            .collect();
        let values = load(&root).unwrap();
        assert_eq!(values["aiv.lastProject.v1"], "{\"aiRoot\":\"unchanged\"}");
        for (p, bytes) in before {
            assert_eq!(fs::read(p).unwrap(), bytes);
        }
        let target = dunce::canonicalize(&root).unwrap();
        let base = dunce::canonicalize(std::env::temp_dir()).unwrap();
        assert_eq!(target.parent(), Some(base.as_path()));
        fs::remove_dir_all(target).unwrap();
    }
}
