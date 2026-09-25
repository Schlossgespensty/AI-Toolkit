//! Finishes updates applied by the already-shipped Electron installer. Its ASAR
//! requirement is served by real native resources, not an Electron runtime shim.
use crate::{storage, updates};
use asar::{AsarReader, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

type Result<T> = std::result::Result<T, String>;
const ASAR: &str = "resources/app.asar";
const EXE: &str = "AI Toolkit.exe";
const RECEIPT: &str = ".toolkit-release.json";
const JOURNAL: &str = "native-migration.json";
const MAX_ASAR: u64 = 64 * 1024 * 1024;
pub(crate) struct Startup(pub(crate) Arc<Mutex<Option<Pending>>>);

pub(crate) fn ready(app: &tauri::AppHandle) -> storage::Result<()> {
    use tauri::Manager;
    let state = app.state::<Startup>();
    let mut pending = state.0.lock().map_err(crate::error::Error::diagnostic)?;
    if let Some(migration) = pending.as_ref() {
        if let Err(error) = migration.commit() {
            let migration = pending.take();
            drop(pending);
            crate::startup_failed(&error, migration.as_ref());
            app.exit(1);
            return Err(crate::error::Error::diagnostic(error));
        }
        pending.take();
    }
    Ok(())
}

pub(crate) fn watch_startup(app: &tauri::AppHandle) {
    use tauri::Manager;
    let pending = app.state::<Startup>().0.clone();
    if !pending.lock().is_ok_and(|state| state.is_some()) {
        return;
    }
    let app = app.clone();
    // Only a pending first migration gets this one-shot deadline. Normal editor
    // launches have no watchdog, polling, or recurring renderer work.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let migration = pending.lock().ok().and_then(|mut state| state.take());
        if let Some(migration) = migration {
            crate::startup_failed(
                "The editor window did not finish loading within one minute.",
                Some(&migration),
            );
            app.exit(1);
        }
    });
}

fn read_archive(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > MAX_ASAR {
        return Err("Migration archive exceeds its size limit.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_ASAR + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_ASAR {
        return Err("Migration archive exceeds its size limit.".into());
    }
    Ok(bytes)
}
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(path: &Path) -> Result<String> {
    updates::hash_file(path).map_err(err)
}
fn hash_is(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_value(storage::read_json(path).map_err(err)?).map_err(err)
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    storage::atomic_write(path, &serde_json::to_vec(value).map_err(err)?).map_err(err)
}
fn supplement_paths() -> BTreeMap<String, String> {
    serde_json::from_str::<Value>(include_str!("../../scripts/manifests/native-package.json"))
        .unwrap()["files"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(path, source)| (path.clone(), source.as_str().unwrap().into()))
        .collect()
}
fn legacy_path(path: &str) -> bool {
    // Keep recovery within the original installer's shipped write scope.
    static ALLOWED: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"\A(?:\.toolkit-release\.json|AI Toolkit\.exe|[a-zA-Z0-9_.-]+\.(?:dll|pak|bin|dat)|vk_swiftshader_icd\.json|LICENSE[\w.-]*\.(?:txt|html)|resources/app\.asar|resources/elevate\.exe|locales/[\w-]+\.pak|config/[\w-]+\.json)\z").unwrap()
    });
    ALLOWED.is_match(path)
}
fn contained(root: &Path, name: &str) -> Result<PathBuf> {
    updates::contained_path(root, name).map_err(err)
}
#[derive(Clone, Debug, Deserialize, Serialize)]
struct LegacyFile {
    file: String,
    sha256: String,
    previous: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
struct ResourceChange {
    path: String,
    sha256: String,
    previous: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Pending {
    root: PathBuf,
    stage: PathBuf,
    receipt: Value,
    manifest_hash: String,
    resources: Vec<ResourceChange>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capsule {
    schema_version: u32,
    runtime: String,
    executable: CapsuleFile,
    files: Vec<CapsuleFile>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapsuleFile {
    path: String,
    sha256: String,
}

fn valid_receipt(receipt: &Value) -> bool {
    receipt.get("exeSha256").is_none()
        && receipt["asarSha256"].as_str().is_some_and(hash_is)
        && receipt["repo"].as_str().is_some_and(|repo| {
            regex::Regex::new(r"\A[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+\z")
                .unwrap()
                .is_match(repo)
        })
        && ["key", "tag"]
            .iter()
            .all(|key| receipt[key].as_str().is_some_and(|s| !s.is_empty()))
}
fn legacy_manifest(stage: &Path, root: &Path, manifest_hash: &str) -> Result<Vec<LegacyFile>> {
    if hash(&stage.join("manifest.json"))? != manifest_hash
        || hash(&root.join("installed-release.json"))? != manifest_hash
    {
        return Err("The Electron update manifest changed; recovery was not attempted.".into());
    }
    let mut entries: Vec<LegacyFile> = read_json(&stage.join("manifest.json"))?;
    let mut seen = HashSet::new();
    for entry in &mut entries {
        if !legacy_path(&entry.file)
            || !seen.insert(entry.file.to_lowercase())
            || !hash_is(&entry.sha256)
            || entry.previous.as_deref().is_some_and(|s| !hash_is(s))
        {
            return Err("Invalid Electron update manifest.".into());
        }
        contained(root, &entry.file)?;
        if let Some(previous) = &entry.previous {
            let backup = contained(stage, &format!("backup/{}", entry.file))?;
            if !hash(&backup)?.eq_ignore_ascii_case(previous) {
                return Err("The previous editor backup failed verification.".into());
            }
        }
        entry.sha256.make_ascii_lowercase();
        if let Some(previous) = &mut entry.previous {
            previous.make_ascii_lowercase();
        }
    }
    if entries.len() > 2002
        || ![EXE, ASAR, RECEIPT]
            .iter()
            .all(|path| entries.iter().any(|e| e.file == *path))
        || !entries
            .iter()
            .any(|e| e.file == EXE && e.previous.is_some())
    {
        return Err("Incomplete Electron update recovery manifest.".into());
    }
    Ok(entries)
}

/// This is also used before Tauri exists, so it does not depend on AppHandle.
fn user_data() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("AI_TOOLKIT_USER_DATA") {
        return Ok(PathBuf::from(path));
    }
    std::env::var_os("APPDATA")
        .map(|p| PathBuf::from(p).join("AI Toolkit"))
        .ok_or_else(|| "Cannot locate the previous editor's update cache.".into())
}
pub(crate) fn detect() -> Result<Option<Pending>> {
    #[cfg(not(windows))]
    {
        return Ok(None);
    }
    #[cfg(windows)]
    {
        detect_at(&std::env::current_exe().map_err(err)?, &user_data()?)
    }
}
fn detect_at(exe: &Path, data: &Path) -> Result<Option<Pending>> {
    let root =
        fs::canonicalize(exe.parent().ok_or("Missing installation directory.")?).map_err(err)?;
    let receipt: Value = match read_json(&root.join(RECEIPT)) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    if !valid_receipt(&receipt) {
        return Ok(None);
    }
    // Manual extraction over an old editor is not an old-updater transaction.
    let installed: Vec<LegacyFile> = match read_json(&root.join("installed-release.json")) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let actual_exe = hash(exe)?;
    if !installed
        .iter()
        .any(|e| e.file == EXE && e.sha256.eq_ignore_ascii_case(&actual_exe))
    {
        return Ok(None);
    }
    let manifest_hash = hash(&root.join("installed-release.json"))?;
    let cache = data.join("release-updates");
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(&cache) {
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().starts_with("release-")
                || !entry.file_type().map_err(err)?.is_dir()
            {
                continue;
            }
            let stage = fs::canonicalize(entry.path()).map_err(err)?;
            if stage.parent() != Some(fs::canonicalize(&cache).map_err(err)?.as_path()) {
                continue;
            }
            if hash(&stage.join("manifest.json")).ok().as_deref() != Some(manifest_hash.as_str()) {
                continue;
            }
            let release: Value = match read_json(&stage.join("release.json")) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if ["repo", "key", "tag"]
                .iter()
                .any(|key| release[key] != receipt[key])
            {
                continue;
            }
            candidates.push(stage);
        }
    }
    if candidates.len() != 1 {
        return Err("Cannot uniquely identify the previous editor's backup. The migration was stopped; keep the release-updates cache for recovery.".into());
    }
    let stage = candidates.remove(0);
    let entries = legacy_manifest(&stage, &root, &manifest_hash)?;
    let receipt_entry = entries.iter().find(|e| e.file == RECEIPT).unwrap();
    let asar_entry = entries.iter().find(|e| e.file == ASAR).unwrap();
    if hash(&root.join(RECEIPT))? != receipt_entry.sha256
        || !receipt["asarSha256"]
            .as_str()
            .unwrap()
            .eq_ignore_ascii_case(&asar_entry.sha256)
    {
        return Err("The installed release receipt changed after the verified update.".into());
    }
    for path in [EXE, ASAR] {
        let entry = entries.iter().find(|e| e.file == path).unwrap();
        if !hash(&stage.join("incoming").join(path))?.eq_ignore_ascii_case(&entry.sha256) {
            return Err("The verified update staging files changed.".into());
        }
    }
    // Resume a journal after interruption without replacing its original backups.
    if stage.join(JOURNAL).is_file() {
        let pending: Pending = read_json(&stage.join(JOURNAL))?;
        if pending.root != root
            || pending.stage != stage
            || pending.manifest_hash != manifest_hash
            || pending.receipt != receipt
        {
            return Err("The native migration journal does not match this installation.".into());
        }
        pending.validate_resources()?;
        return Ok(Some(pending));
    }
    Ok(Some(Pending {
        root,
        stage,
        receipt,
        manifest_hash,
        resources: Vec::new(),
    }))
}

fn archive_files(bytes: &[u8], exe_hash: &str) -> Result<BTreeMap<String, Vec<u8>>> {
    // Bound allocations and offsets before passing the format to the standard
    // ASAR reader, whose header API otherwise trusts its length fields.
    if bytes.len() < 16 || bytes.len() > 64 * 1024 * 1024 {
        return Err("Invalid migration ASAR size.".into());
    }
    let header_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let json_size = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if json_size > 1024 * 1024
        || json_size.checked_add(16).is_none_or(|n| n > bytes.len())
        || header_size.checked_add(8).is_none_or(|n| n > bytes.len())
    {
        return Err("Invalid migration ASAR header.".into());
    }
    let (header, offset) = Header::read(&mut &bytes[..]).map_err(err)?;
    fn bounds(header: &Header, offset: usize, length: usize, depth: usize) -> Result<()> {
        if depth > 8 {
            return Err("Migration archive nesting is excessive.".into());
        }
        match header {
            Header::File(file) => match file.location() {
                asar::header::FileLocation::Offset { offset: start }
                    if offset
                        .checked_add(start)
                        .and_then(|n| n.checked_add(file.size()))
                        .is_some_and(|end| end <= length) =>
                {
                    Ok(())
                }
                _ => Err("Migration archive contains an unpacked or invalid file.".into()),
            },
            Header::Directory { files } => {
                if files.len() > 32 {
                    return Err("Too many migration archive files.".into());
                }
                for (name, child) in files {
                    if name.is_empty()
                        || name == "."
                        || name == ".."
                        || name.contains(['/', '\\', ':'])
                    {
                        return Err("Invalid migration archive path.".into());
                    }
                    bounds(child, offset, length, depth + 1)?;
                }
                Ok(())
            }
            Header::Link { .. } => Err("Migration archive links are not supported.".into()),
        }
    }
    bounds(&header, offset, bytes.len(), 0)?;
    let reader = AsarReader::new_from_header(header, offset, bytes, None).map_err(err)?;
    let manifest = reader
        .files()
        .get(Path::new("migration.json"))
        .ok_or("Missing native migration manifest.")?;
    let capsule: Capsule = serde_json::from_slice(manifest.data()).map_err(err)?;
    let expected = supplement_paths();
    if capsule.schema_version != 1
        || capsule.runtime != "tauri"
        || capsule.executable.path != EXE
        || !capsule.executable.sha256.eq_ignore_ascii_case(exe_hash)
        || capsule.files.len() != expected.len()
        || reader.files().len() != expected.len() + 1
    {
        return Err("The migration archive does not belong to this native executable.".into());
    }
    let mut output = BTreeMap::new();
    for entry in capsule.files {
        if !expected.contains_key(&entry.path)
            || output.contains_key(&entry.path)
            || !hash_is(&entry.sha256)
        {
            return Err("Unexpected migration resource.".into());
        }
        let file = reader
            .files()
            .get(Path::new(&entry.path))
            .ok_or("Missing native migration resource.")?;
        if !sha(file.data()).eq_ignore_ascii_case(&entry.sha256) {
            return Err("Native migration resource checksum failed.".into());
        }
        output.insert(entry.path, file.data().to_vec());
    }
    Ok(output)
}

impl Pending {
    fn validate_resources(&self) -> Result<()> {
        let expected = supplement_paths();
        let mut seen = HashSet::new();
        for resource in &self.resources {
            if !expected.contains_key(&resource.path)
                || !seen.insert(&resource.path)
                || !hash_is(&resource.sha256)
                || resource.previous.as_deref().is_some_and(|s| !hash_is(s))
            {
                return Err("Invalid migration recovery journal.".into());
            }
            contained(&self.root, &resource.path)?;
            if let Some(previous) = &resource.previous {
                if hash(&contained(
                    &self.stage,
                    &format!("native-resource-backup/{}", resource.path),
                )?)? != *previous
                {
                    return Err("Native resource recovery backup changed.".into());
                }
            }
        }
        Ok(())
    }
    pub(crate) fn prepare(&mut self) -> Result<()> {
        let bytes = read_archive(&contained(&self.root, ASAR)?)?;
        if !sha(&bytes).eq_ignore_ascii_case(self.receipt["asarSha256"].as_str().unwrap_or("")) {
            return Err("The installed migration archive failed receipt verification.".into());
        }
        let resources = archive_files(&bytes, &hash(&self.root.join(EXE))?)?;
        self.validate_resources()?;
        for (path, bytes) in resources {
            let destination = contained(&self.root, &path)?;
            let expected = sha(&bytes);
            if hash(&destination).ok().as_deref() == Some(expected.as_str()) {
                continue;
            }
            if let Some(change) = self.resources.iter().find(|r| r.path == path) {
                let current = hash(&destination).ok();
                if current != change.previous {
                    return Err("A migration resource changed after preparation.".into());
                }
            } else {
                let previous = if destination.exists() {
                    let backup = contained(&self.stage, &format!("native-resource-backup/{path}"))?;
                    fs::create_dir_all(backup.parent().unwrap()).map_err(err)?;
                    fs::copy(&destination, &backup).map_err(err)?;
                    Some(hash(&backup)?)
                } else {
                    None
                };
                self.resources.push(ResourceChange {
                    path: path.clone(),
                    sha256: expected,
                    previous,
                });
                // Write ahead: every materialized file already has recovery data.
                write_json(&contained(&self.stage, JOURNAL)?, self)?;
            }
            storage::atomic_write(&destination, &bytes).map_err(err)?;
        }
        write_json(&contained(&self.stage, JOURNAL)?, self)
    }
    /// Called only after the main renderer's Ready request shows its window.
    pub(crate) fn commit(&self) -> Result<()> {
        let bytes = read_archive(&contained(&self.root, ASAR)?)?;
        let exe_hash = hash(&self.root.join(EXE))?;
        if !sha(&bytes).eq_ignore_ascii_case(self.receipt["asarSha256"].as_str().unwrap_or("")) {
            return Err("Migration archive changed during startup.".into());
        }
        for (path, bytes) in archive_files(&bytes, &exe_hash)? {
            if hash(&contained(&self.root, &path)?)? != sha(&bytes) {
                return Err("Native resource changed during startup.".into());
            }
        }
        let mut receipt = self.receipt.clone();
        receipt["exeSha256"] = json!(exe_hash);
        write_json(&contained(&self.root, RECEIPT)?, &receipt)
    }
    pub(crate) fn launch_recovery(&self) -> Result<()> {
        self.validate_resources()?;
        write_json(&contained(&self.stage, JOURNAL)?, self)?;
        let helper = contained(&self.stage, "native-recovery.exe")?;
        fs::copy(std::env::current_exe().map_err(err)?, &helper).map_err(err)?;
        let mut command = std::process::Command::new(&helper);
        command
            .arg("--rollback-legacy")
            .arg(&self.stage)
            .env_remove("ELECTRON_RUN_AS_NODE");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command.spawn().map_err(err)?;
        Ok(())
    }
}

/// Recovery uses the normal updater's executable acquisition, writes, and
/// transaction rollback. This is only an adapter for the old manifest format.
fn restore(
    pending: &Pending,
    acquire: impl FnOnce(&Path, &Path) -> storage::Result<()>,
) -> Result<PathBuf> {
    let root = fs::canonicalize(&pending.root).map_err(err)?;
    if root != pending.root {
        return Err("The recovery installation path changed.".into());
    }
    let entries = legacy_manifest(&pending.stage, &root, &pending.manifest_hash)?;
    pending.validate_resources()?;
    let exe_entry = entries.iter().find(|e| e.file == EXE).unwrap();
    let exe = contained(&root, EXE)?;
    let current = if exe.try_exists().map_err(err)? {
        Some(hash(&exe)?)
    } else {
        None
    };
    if current
        .as_ref()
        .is_some_and(|hash| hash != &exe_entry.sha256 && Some(hash) != exe_entry.previous.as_ref())
    {
        return Err("The installed executable changed; recovery was stopped.".into());
    }
    let recovery_backup = contained(
        &pending.stage,
        &format!(
            "native-recovery-backup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(err)?
                .as_nanos()
        ),
    )?;
    fs::create_dir(&recovery_backup).map_err(err)?;
    let saved_exe = recovery_backup.join(EXE);
    if current.as_deref() == Some(exe_entry.sha256.as_str()) {
        acquire(&exe, &saved_exe).map_err(err)?;
    } else if current.is_some() {
        fs::copy(&exe, &saved_exe).map_err(err)?;
    }
    let mut changes = vec![updates::Change {
        destination: exe.clone(),
        backup: saved_exe,
        existed: current.is_some(),
    }];
    let operation = (|| -> storage::Result<()> {
        let mut targets: Vec<_> = pending
            .resources
            .iter()
            .map(|r| {
                (
                    r.path.clone(),
                    r.previous.clone(),
                    pending.stage.join("native-resource-backup").join(&r.path),
                    Some(r.sha256.clone()),
                )
            })
            .collect();
        targets.extend(entries.iter().map(|e| {
            (
                e.file.clone(),
                e.previous.clone(),
                pending.stage.join("backup").join(&e.file),
                if e.file.starts_with("config/") {
                    Some(e.sha256.clone())
                } else {
                    None
                },
            )
        }));
        // Restore the old executable only after its application and config. A
        // retry also accepts the verified old hash or an interrupted missing EXE.
        targets.sort_by_key(|(path, _, _, _)| path == EXE);
        for (path, previous, source, expected) in targets {
            let destination = contained(&root, &path).map_err(crate::error::Error::diagnostic)?;
            if expected.is_some() && destination.exists() {
                let current = hash(&destination).map_err(crate::error::Error::diagnostic)?;
                // Never undo user edits made after an interrupted migration.
                if Some(&current) != expected.as_ref() && Some(&current) != previous.as_ref() {
                    continue;
                }
            }
            if let Some(previous) = previous {
                let bytes = fs::read(&source).map_err(crate::error::Error::diagnostic)?;
                if !sha(&bytes).eq_ignore_ascii_case(&previous) {
                    return Err(crate::error::Error::diagnostic("Recovery source changed."));
                }
                if path == EXE {
                    storage::atomic_write(&destination, &bytes)?;
                } else {
                    updates::record_write(
                        &destination,
                        &recovery_backup.join(&path),
                        &bytes,
                        &mut changes,
                    )?;
                }
            } else if destination.exists() {
                let backup = recovery_backup.join(&path);
                fs::create_dir_all(backup.parent().unwrap())
                    .map_err(crate::error::Error::diagnostic)?;
                fs::copy(&destination, &backup).map_err(crate::error::Error::diagnostic)?;
                changes.push(updates::Change {
                    destination: destination.clone(),
                    backup,
                    existed: true,
                });
                fs::remove_file(destination).map_err(crate::error::Error::diagnostic)?;
            }
        }
        Ok(())
    })();
    if let Err(error) = operation {
        return match updates::rollback(&changes) {
            Ok(()) => Err(err(error)),
            Err(rollback) => Err(format!("{error}; {rollback}")),
        };
    }
    Ok(exe)
}
pub(crate) fn recover(stage: &Path) -> Result<()> {
    let stage = fs::canonicalize(stage).map_err(err)?;
    let cache = fs::canonicalize(user_data()?.join("release-updates")).map_err(err)?;
    if stage.parent() != Some(cache.as_path())
        || !stage
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("release-"))
    {
        return Err("Invalid legacy recovery stage.".into());
    }
    let pending: Pending = read_json(&stage.join(JOURNAL))?;
    if pending.stage != stage {
        return Err("Legacy recovery stage changed.".into());
    }
    let exe = restore(&pending, updates::acquire_closed_executable)?;
    std::process::Command::new(exe)
        .current_dir(&pending.root)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .spawn()
        .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SERIAL: AtomicUsize = AtomicUsize::new(0);
    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        data: PathBuf,
        stage: PathBuf,
        resources: BTreeMap<String, Vec<u8>>,
    }
    fn write(path: &Path, bytes: impl AsRef<[u8]>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn capsule(
        resources: &BTreeMap<String, Vec<u8>>,
        edit: impl FnOnce(&mut Value, &mut BTreeMap<String, Vec<u8>>),
    ) -> Vec<u8> {
        let mut files = resources.clone();
        let mut manifest = json!({"schemaVersion":1,"runtime":"tauri","executable":{"path":EXE,"sha256":sha(b"native executable")},
            "files":files.iter().map(|(path,bytes)|json!({"path":path,"sha256":sha(bytes)})).collect::<Vec<_>>()});
        edit(&mut manifest, &mut files);
        files.insert(
            "migration.json".into(),
            serde_json::to_vec(&manifest).unwrap(),
        );
        let mut writer = asar::AsarWriter::new();
        for (path, bytes) in files {
            writer.write_file(path, &bytes, false).unwrap();
        }
        let mut archive = Vec::new();
        writer.finalize(&mut archive).unwrap();
        archive
    }
    impl Fixture {
        fn new(edit: impl FnOnce(&mut Value, &mut BTreeMap<String, Vec<u8>>)) -> Self {
            let base = std::env::temp_dir().join(format!(
                "toolkit-legacy-migration-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&base).unwrap();
            let base = fs::canonicalize(base).unwrap();
            let root = base.join("live");
            let data = base.join("user-data");
            let stage = data.join("release-updates/release-fixture");
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(&stage).unwrap();
            let resources: BTreeMap<_, _> = supplement_paths()
                .keys()
                .map(|path| {
                    (
                        path.clone(),
                        format!("native resource: {path}").into_bytes(),
                    )
                })
                .collect();
            let archive = capsule(&resources, edit);
            let old_receipt = serde_json::to_vec(&json!({"repo":"Krarilotus/AI-Toolkit","key":"old-build","tag":"snapshot-old","asarSha256":sha(b"electron application")})).unwrap();
            let receipt = json!({"repo":"Krarilotus/AI-Toolkit","key":"new-build","tag":"snapshot-native","asarSha256":sha(&archive)});
            let files = [
                (
                    EXE,
                    b"native executable".to_vec(),
                    Some(b"electron executable".to_vec()),
                ),
                (ASAR, archive, Some(b"electron application".to_vec())),
                (
                    RECEIPT,
                    serde_json::to_vec(&receipt).unwrap(),
                    Some(old_receipt),
                ),
                (
                    "config/template.json",
                    b"new defaults".to_vec(),
                    Some(b"old defaults".to_vec()),
                ),
                ("config/introduced.json", b"new file".to_vec(), None),
            ];
            let mut manifest = Vec::new();
            for (path, bytes, previous) in files {
                write(&root.join(path), &bytes);
                write(&stage.join("incoming").join(path), &bytes);
                if let Some(old) = &previous {
                    write(&stage.join("backup").join(path), old);
                }
                // Windows PowerShell Get-FileHash uses uppercase hex strings.
                manifest.push(LegacyFile {
                    file: path.into(),
                    sha256: sha(&bytes).to_uppercase(),
                    previous: previous.map(|b| sha(&b).to_uppercase()),
                });
            }
            write_json(&stage.join("manifest.json"), &manifest).unwrap();
            fs::copy(
                stage.join("manifest.json"),
                root.join("installed-release.json"),
            )
            .unwrap();
            write_json(
                &stage.join("release.json"),
                &json!({"repo":receipt["repo"],"key":receipt["key"],"tag":receipt["tag"]}),
            )
            .unwrap();
            write(&root.join("config/custom.json"), b"user configuration");
            write(&root.join("project.json"), b"user project");
            write(&root.join("README.txt"), b"old readme");
            Self {
                base,
                root,
                data,
                stage,
                resources,
            }
        }
        fn pending(&self) -> Pending {
            detect_at(&self.root.join(EXE), &self.data)
                .unwrap()
                .unwrap()
        }
        fn restore(&self, pending: &Pending) -> Result<PathBuf> {
            restore(pending, |exe, backup| {
                fs::rename(exe, backup).map_err(crate::error::Error::diagnostic)
            })
        }
        fn assert_original(&self) {
            assert_eq!(
                fs::read(self.root.join(EXE)).unwrap(),
                b"electron executable"
            );
            assert_eq!(
                fs::read(self.root.join(ASAR)).unwrap(),
                b"electron application"
            );
            assert_eq!(
                fs::read(self.root.join("config/template.json")).unwrap(),
                b"old defaults"
            );
            assert!(!self.root.join("config/introduced.json").exists());
            assert_eq!(
                fs::read(self.root.join("config/custom.json")).unwrap(),
                b"user configuration"
            );
            assert_eq!(
                fs::read(self.root.join("project.json")).unwrap(),
                b"user project"
            );
            assert_eq!(
                read_json::<Value>(&self.root.join(RECEIPT)).unwrap()["key"],
                "old-build"
            );
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            if self.base.parent() == Some(temp.as_path())
                && self
                    .base
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("toolkit-legacy-migration-")
            {
                let _ = fs::remove_dir_all(&self.base);
            }
        }
    }
    #[test]
    fn verified_legacy_install_hydrates_actual_resources_and_commits_native_identity() {
        let fixture = Fixture::new(|_, _| {});
        let mut pending = fixture.pending();
        pending.prepare().unwrap();
        let receipt: Value = read_json(&fixture.root.join(RECEIPT)).unwrap();
        assert!(
            receipt.get("exeSha256").is_none(),
            "preparation must not declare successful startup"
        );
        for (path, bytes) in &fixture.resources {
            assert_eq!(fs::read(fixture.root.join(path)).unwrap(), *bytes);
        }
        pending.commit().unwrap();
        let receipt: Value = read_json(&fixture.root.join(RECEIPT)).unwrap();
        assert_eq!(receipt["exeSha256"], sha(b"native executable"));
        assert_eq!(receipt["key"], "new-build");
        assert!(detect_at(&fixture.root.join(EXE), &fixture.data)
            .unwrap()
            .is_none());
        assert_eq!(
            fs::read(fixture.root.join("config/custom.json")).unwrap(),
            b"user configuration"
        );
    }
    #[test]
    fn prerequisite_failure_restores_electron_and_original_resources_transactionally() {
        let fixture = Fixture::new(|_, _| {});
        let mut pending = fixture.pending();
        pending.prepare().unwrap();
        fixture.restore(&pending).unwrap();
        fixture.assert_original();
        assert_eq!(
            fs::read(fixture.root.join("README.txt")).unwrap(),
            b"old readme"
        );
        assert!(!fixture.root.join("THIRD_PARTY_NOTICES.txt").exists());
        assert!(!fixture
            .root
            .join("assets/aiv/iso/verzeichnis.json")
            .exists());
    }
    #[test]
    fn interrupted_migration_resumes_journal_without_replacing_original_backups() {
        let fixture = Fixture::new(|_, _| {});
        let mut pending = fixture.pending();
        pending.prepare().unwrap();
        let original = fs::read(fixture.stage.join("native-resource-backup/README.txt")).unwrap();
        let mut resumed = fixture.pending();
        resumed.prepare().unwrap();
        assert_eq!(
            fs::read(fixture.stage.join("native-resource-backup/README.txt")).unwrap(),
            original
        );
        fixture.restore(&resumed).unwrap();
        fixture.assert_original();
        assert_eq!(
            fs::read(fixture.root.join("README.txt")).unwrap(),
            b"old readme"
        );
    }
    #[test]
    fn missing_resource_rejects_archive_before_hydration_and_keeps_recovery_available() {
        let fixture = Fixture::new(|_, files| {
            files.remove("assets/aiv/iso/verzeichnis.json");
        });
        let mut pending = fixture.pending();
        assert!(pending.prepare().is_err());
        assert_eq!(
            fs::read(fixture.root.join("README.txt")).unwrap(),
            b"old readme"
        );
        fixture.restore(&pending).unwrap();
        fixture.assert_original();
    }
    #[test]
    fn corrupted_installed_archive_can_restore_verified_previous_editor() {
        let fixture = Fixture::new(|_, _| {});
        write(&fixture.root.join(ASAR), b"corrupt installed archive");
        let mut pending = fixture.pending();
        assert!(pending
            .prepare()
            .unwrap_err()
            .contains("receipt verification"));
        fixture.restore(&pending).unwrap();
        fixture.assert_original();
    }
    #[test]
    fn capsule_must_bind_the_actual_executable_and_exact_resources() {
        for edit in [0, 1, 2] {
            let fixture = Fixture::new(|manifest, files| match edit {
                0 => manifest["executable"]["sha256"] = json!("a".repeat(64)),
                1 => {
                    manifest["files"][0]["path"] = json!("config/custom.json");
                }
                _ => {
                    files.insert("README.txt".into(), b"wrong resource content".to_vec());
                }
            });
            assert!(fixture.pending().prepare().is_err());
            assert_eq!(
                fs::read(fixture.root.join("README.txt")).unwrap(),
                b"old readme"
            );
        }
    }
    #[test]
    fn altered_or_ambiguous_backups_are_never_used_for_recovery() {
        let fixture = Fixture::new(|_, _| {});
        write(&fixture.stage.join("backup").join(EXE), b"altered backup");
        assert!(detect_at(&fixture.root.join(EXE), &fixture.data).is_err());
        assert_eq!(
            fs::read(fixture.root.join(EXE)).unwrap(),
            b"native executable"
        );
        let fixture = Fixture::new(|_, _| {});
        let duplicate = fixture.data.join("release-updates/release-duplicate");
        fs::create_dir(&duplicate).unwrap();
        for file in ["manifest.json", "release.json"] {
            fs::copy(fixture.stage.join(file), duplicate.join(file)).unwrap();
        }
        assert!(detect_at(&fixture.root.join(EXE), &fixture.data)
            .unwrap_err()
            .contains("uniquely"));
    }
    #[test]
    fn recovery_preserves_configuration_edited_after_an_interruption() {
        let fixture = Fixture::new(|_, _| {});
        let pending = fixture.pending();
        write(
            &fixture.root.join("config/template.json"),
            b"new user change",
        );
        write(
            &fixture.root.join("config/introduced.json"),
            b"customized new file",
        );
        fixture.restore(&pending).unwrap();
        assert_eq!(
            fs::read(fixture.root.join("config/template.json")).unwrap(),
            b"new user change"
        );
        assert_eq!(
            fs::read(fixture.root.join("config/introduced.json")).unwrap(),
            b"customized new file"
        );
    }
    #[test]
    fn failed_restore_rolls_back_its_own_partial_writes() {
        let fixture = Fixture::new(|_, _| {});
        let pending = fixture.pending();
        let result = restore(&pending, |exe, backup| {
            fs::rename(exe, backup).unwrap();
            write(
                &fixture.stage.join("backup").join(ASAR),
                b"changed after validation",
            );
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read(fixture.root.join(EXE)).unwrap(),
            b"native executable"
        );
        assert_eq!(
            read_json::<Value>(&fixture.root.join(RECEIPT)).unwrap()["key"],
            "new-build"
        );
    }
    #[test]
    fn malformed_asar_lengths_fail_before_allocating_or_reading_files() {
        let mut bytes = vec![0; 16];
        bytes[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(archive_files(&bytes, &"a".repeat(64)).is_err());
    }
    #[test]
    fn altered_receipt_cannot_attest_to_a_replaced_archive() {
        let fixture = Fixture::new(|_, _| {});
        let mut receipt: Value = read_json(&fixture.root.join(RECEIPT)).unwrap();
        receipt["asarSha256"] = json!("a".repeat(64));
        write_json(&fixture.root.join(RECEIPT), &receipt).unwrap();
        assert!(detect_at(&fixture.root.join(EXE), &fixture.data)
            .unwrap_err()
            .contains("receipt changed"));
    }
    #[test]
    fn oversized_live_archive_fails_before_reading_its_contents() {
        let fixture = Fixture::new(|_, _| {});
        let mut pending = fixture.pending();
        fs::OpenOptions::new()
            .write(true)
            .open(fixture.root.join(ASAR))
            .unwrap()
            .set_len(MAX_ASAR + 1)
            .unwrap();
        assert!(pending.prepare().unwrap_err().contains("size limit"));
        fixture.restore(&pending).unwrap();
        fixture.assert_original();
    }
    #[test]
    fn recovery_can_retry_with_a_known_old_or_interrupted_missing_executable() {
        for missing in [false, true] {
            let fixture = Fixture::new(|_, _| {});
            let pending = fixture.pending();
            if missing {
                fs::remove_file(fixture.root.join(EXE)).unwrap();
            } else {
                write(&fixture.root.join(EXE), b"electron executable");
            }
            restore(&pending, |_, _| {
                panic!("No native executable needs acquisition")
            })
            .unwrap();
            fixture.assert_original();
            restore(&pending, |_, _| {
                panic!("Already-restored executable should be retained")
            })
            .unwrap();
            fixture.assert_original();
        }
    }
    #[test]
    fn backup_directory_links_cannot_redirect_resource_writes_outside_stage() {
        let fixture = Fixture::new(|_, _| {});
        let outside = fixture.base.join("outside");
        fs::create_dir(&outside).unwrap();
        write(&outside.join("README.txt"), b"outside file");
        let link = fixture.stage.join("native-resource-backup");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let result = std::process::Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let mut pending = fixture.pending();
        assert!(pending.prepare().is_err());
        assert_eq!(
            fs::read(outside.join("README.txt")).unwrap(),
            b"outside file"
        );
        assert_eq!(
            fs::read(fixture.root.join("README.txt")).unwrap(),
            b"old readme"
        );
    }
}
