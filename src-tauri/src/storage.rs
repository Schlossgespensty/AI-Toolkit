use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager};

static WRITES: Mutex<()> = Mutex::new(());
static SERIAL: AtomicU64 = AtomicU64::new(0);
pub type Result<T> = std::result::Result<T, crate::error::Error>;

#[derive(Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct DocumentResult {
    pub path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

pub fn user_data(app: &AppHandle) -> Result<PathBuf> {
    // Preserve the existing Electron settings and project history on migration.
    let directory = std::env::var_os("AI_TOOLKIT_USER_DATA")
        .map(PathBuf::from)
        .unwrap_or(
            app.path()
                .config_dir()
                .map_err(crate::error::Error::diagnostic)?
                .join("AI Toolkit"),
        );
    fs::create_dir_all(&directory).map_err(crate::error::Error::diagnostic)?;
    Ok(directory)
}
pub fn read_json(path: impl AsRef<Path>) -> Result<Value> {
    let source = fs::read_to_string(path).map_err(crate::error::Error::diagnostic)?;
    serde_json::from_str(source.trim_start_matches('\u{feff}'))
        .map_err(crate::error::Error::diagnostic)
}
/// Match the existing configuration contract: only item definitions receive
/// newly introduced fields. User values and unknown extension fields survive.
pub fn merge_configuration(name: &str, mut defaults: Value, configured: Value) -> Value {
    if name != "aiv_constants.json" {
        return configured;
    }
    if let (Some(base), Some(items)) = (defaults.as_object_mut(), configured.as_object()) {
        for (id, item) in items {
            match (
                base.get_mut(id).and_then(Value::as_object_mut),
                item.as_object(),
            ) {
                (Some(default), Some(custom)) => default.extend(custom.clone()),
                _ => {
                    base.insert(id.clone(), item.clone());
                }
            }
        }
    }
    defaults
}
pub fn settings(app: &AppHandle) -> Result<Value> {
    let file = user_data(app)?.join("settings.json");
    if !file.exists() {
        return Ok(json!({}));
    }
    read_json(file)
}
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| crate::error::Error::new("invalid_destination"))?;
    fs::create_dir_all(parent).map_err(crate::error::Error::diagnostic)?;
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".toolkit-{}-{serial}.tmp", std::process::id()));
    let result = (|| {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(crate::error::Error::diagnostic)?;
        file.write_all(data)
            .and_then(|_| file.sync_all())
            .map_err(crate::error::Error::diagnostic)?;
        drop(file);
        // Windows rename cannot overwrite; use a rollback file for the small replacement window.
        let backup = parent.join(format!(".toolkit-{}-{serial}.bak", std::process::id()));
        if path.exists() {
            fs::rename(path, &backup).map_err(crate::error::Error::diagnostic)?;
        }
        if let Err(e) = fs::rename(&temporary, path) {
            if backup.exists() {
                let _ = fs::rename(&backup, path);
            }
            return Err(crate::error::Error::diagnostic(e));
        }
        if backup.exists() {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    })();
    if temporary.exists() {
        let _ = fs::remove_file(temporary);
    }
    result
}
pub fn update_settings(app: &AppHandle, key: &str, value: Value) -> Result<Value> {
    let _lock = WRITES.lock().map_err(crate::error::Error::diagnostic)?;
    let mut current = settings(app)?;
    current
        .as_object_mut()
        .ok_or_else(|| crate::error::Error::new("invalid_settings_document"))?
        .insert(key.into(), value);
    atomic_write(
        &user_data(app)?.join("settings.json"),
        &serde_json::to_vec_pretty(&current).map_err(crate::error::Error::diagnostic)?,
    )?;
    Ok(current)
}
pub fn installation(app: &AppHandle) -> Result<PathBuf> {
    let value = settings(app)?;
    let root = value["ucpInstallation"]
        .as_str()
        .ok_or_else(|| crate::error::Error::new("choose_the_stronghold_crusader_installation"))?;
    normalize_installation(Path::new(root))
}
pub fn normalize_installation(path: &Path) -> Result<PathBuf> {
    let mut root = path.to_path_buf();
    if root
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("plugins"))
    {
        root.pop();
    }
    if root
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("ucp"))
    {
        root.pop();
    }
    if !root.join("ucp/plugins").is_dir() {
        return Err(crate::error::Error::new(
            "expected_a_ucp_installation_containing_ucp_plugins",
        ));
    }
    dunce::canonicalize(root).map_err(crate::error::Error::diagnostic)
}
pub fn within(root: &Path, path: &Path) -> Result<PathBuf> {
    let base = dunce::canonicalize(root).map_err(crate::error::Error::diagnostic)?;
    let resolved = dunce::canonicalize(path).map_err(crate::error::Error::diagnostic)?;
    if !resolved.starts_with(&base) {
        return Err(crate::error::Error::new(
            "path_is_outside_the_selected_project",
        ));
    }
    Ok(resolved)
}
pub fn safe_name(name: &str) -> Result<&str> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':']) {
        return Err(crate::error::Error::new("invalid_filename"));
    }
    Ok(name)
}
pub fn resource(app: &AppHandle, relative: &str) -> Result<PathBuf> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(crate::error::Error::diagnostic)?
        .join(relative);
    if bundled.exists() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(relative);
        if source.exists() {
            return Ok(source);
        }
    }
    Err(crate::error::Error::with_arguments(
        "missing_resource",
        json!({"path":relative}),
    ))
}
/// Started straight from the portable ZIP, Windows extracts only the
/// executable. Maps, building textures and troop previews would then fail one
/// by one without explanation, so startup stops with a clear message instead.
pub fn require_resources(app: &AppHandle) -> std::result::Result<(), String> {
    for relative in ["config", "assets/aiv/iso/verzeichnis.json"] {
        if resource(app, relative).is_err() {
            return Err(format!(
                "AI Toolkit is missing files that belong next to the program ({relative}).\n\n\
                 If you opened AI Toolkit directly from the downloaded ZIP, extract the whole \
                 ZIP first (right-click, Extract All) and start AI Toolkit.exe from the \
                 extracted folder."
            ));
        }
    }
    Ok(())
}
pub fn data_url(path: &Path) -> Result<String> {
    let mime = match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "wav" => "audio/wav",
        _ => "image/png",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(fs::read(path).map_err(crate::error::Error::diagnostic)?)
    ))
}
pub fn read_document(path: &Path, castle: bool) -> Result<DocumentResult> {
    let extension = path.extension().and_then(|v| v.to_str()).unwrap_or("");
    let mut result = DocumentResult {
        path: path.to_path_buf(),
        ..Default::default()
    };
    if castle && extension.eq_ignore_ascii_case("aiv") {
        result.source = Some("aiv".into());
        result.source_base64 =
            Some(STANDARD.encode(fs::read(path).map_err(crate::error::Error::diagnostic)?));
    } else if castle {
        result.source = Some("aivjson".into());
        result.document = Some(read_json(path)?);
    } else {
        result.content = Some(fs::read_to_string(path).map_err(crate::error::Error::diagnostic)?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_envelopes_preserve_source_bytes_content_and_unknown_json() {
        let root =
            std::env::temp_dir().join(format!("toolkit-document-contract-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let classic = root.join("castle.aiv");
        fs::write(&classic, [0, 42, 255]).unwrap();
        assert_eq!(
            json!(read_document(&classic, true).unwrap()),
            json!({"path":classic,"source":"aiv","sourceBase64":"ACr/"})
        );
        let content = "{\n \"unknown-plugin\": {\"large\":18446744073709551615,\"data\":[null,false,\"فارسی\"]}\n}\n";
        let json_path = root.join("castle.aivjson");
        fs::write(&json_path, content).unwrap();
        assert_eq!(
            json!(read_document(&json_path, true).unwrap()),
            json!({"path":json_path,"source":"aivjson","document":serde_json::from_str::<Value>(content).unwrap()})
        );
        assert_eq!(
            json!(read_document(&json_path, false).unwrap()),
            json!({"path":json_path,"content":content})
        );
        fs::remove_file(classic).unwrap();
        fs::remove_file(json_path).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn custom_item_configuration_preserves_existing_contract() {
        let defaults =
            json!({"25":{"name":"Wall","size":1,"placement":"wall"},"500":{"name":"New"}});
        let custom = json!({"25":{"name":"Custom Wall","size":2,"extension":{"keep":true}},"999":{"name":"Custom item"}});
        let merged = merge_configuration("aiv_constants.json", defaults, custom.clone());
        assert_eq!(
            merged["25"],
            json!({"name":"Custom Wall","size":2,"placement":"wall","extension":{"keep":true}})
        );
        assert_eq!(merged["999"], custom["999"]);
        assert_eq!(merged["500"]["name"], "New");
        assert_eq!(
            merge_configuration("custom.json", json!({"default":true}), custom.clone()),
            custom
        );
    }
    #[test]
    fn names_do_not_escape() {
        for name in ["../evil", "C:\\evil", "a/b", "..", ""] {
            assert!(safe_name(name).is_err());
        }
        assert!(safe_name("Castle.aiv").is_ok());
    }
    #[test]
    fn atomic_replacement() {
        let dir = std::env::temp_dir().join(format!("toolkit-write-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("value.json");
        atomic_write(&p, b"first").unwrap();
        atomic_write(&p, b"second").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second");
        fs::remove_file(p).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
