//! Release identity and verified portable updates. The helper is this executable,
//! copied outside the install folder so a running image is never overwritten.
mod package_policy;
pub(crate) mod responses;
use crate::storage::{self, Result};
use package_policy::{allowed, canonical_executable, executable_name, is_configuration};
use responses::{PreparedUpdate, ReleaseAsset, ReleaseInfo, UpdateSources, UpdateStatus};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
const OFFICIAL: &str = "Schlossgespensty/AI-Toolkit";
#[derive(Default)]
pub struct Updates {
    cache: Mutex<HashMap<String, (u64, Value)>>,
    prepared: Mutex<Option<PathBuf>>,
}
fn seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn sha(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
fn stage_stream(reader: &mut impl Read, target: &Path, expected: u64) -> Result<String> {
    use std::io::Write;
    fs::create_dir_all(
        target
            .parent()
            .ok_or_else(|| crate::error::Error::new("invalid_staging_path"))?,
    )
    .map_err(crate::error::Error::diagnostic)?;
    let mut file = fs::File::create(target).map_err(crate::error::Error::diagnostic)?;
    let mut digest = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 81920];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(crate::error::Error::diagnostic)?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > expected {
            return Err(crate::error::Error::new("unexpected_download_size"));
        }
        digest.update(&buffer[..count]);
        file.write_all(&buffer[..count])
            .map_err(crate::error::Error::diagnostic)?;
    }
    if bytes != expected {
        return Err(crate::error::Error::new("incomplete_download"));
    }
    file.sync_all().map_err(crate::error::Error::diagnostic)?;
    Ok(format!("{digest:x}", digest = digest.finalize()))
}
fn same_configuration(existing: &[u8], defaults: &[u8]) -> bool {
    match (
        serde_json::from_slice::<Value>(existing),
        serde_json::from_slice::<Value>(defaults),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}
fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("AI-Toolkit-native-updater")
        .timeout(Duration::from_secs(30))
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .build()
        .map_err(crate::error::Error::diagnostic)
}
fn repository(value: &str) -> Result<&str> {
    if regex::Regex::new(r"^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$")
        .unwrap()
        .is_match(value)
    {
        Ok(value)
    } else {
        Err(crate::error::Error::new("invalid_github_repository"))
    }
}
fn api(url: &str) -> Result<Value> {
    client()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(crate::error::Error::diagnostic)?
        .json()
        .map_err(crate::error::Error::diagnostic)
}
fn pages(repo: &str, endpoint: &str) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for page in 1..=20 {
        let result = api(&format!(
            "https://api.github.com/repos/{repo}/{endpoint}?per_page=100&page={page}"
        ))?;
        let entries = result
            .as_array()
            .ok_or_else(|| crate::error::Error::new("invalid_github_response"))?;
        out.extend(entries.clone());
        if entries.len() < 100 {
            return Ok(out);
        }
    }
    Err(crate::error::Error::new("too_many_github_results"))
}
fn validate(repo: &str) -> Result<String> {
    repository(repo)?;
    if repo.eq_ignore_ascii_case(OFFICIAL) {
        return Ok(OFFICIAL.into());
    }
    let info = api(&format!("https://api.github.com/repos/{repo}"))?;
    let source = info["source"]["full_name"]
        .as_str()
        .or(info["parent"]["full_name"].as_str())
        .unwrap_or("");
    if info["fork"] != true || !source.eq_ignore_ascii_case(OFFICIAL) {
        return Err(crate::error::Error::new(
            "choose_a_fork_of_the_official_ai_toolkit",
        ));
    }
    Ok(info["full_name"].as_str().unwrap_or(repo).into())
}
fn selected(app: &AppHandle) -> String {
    storage::read_json(
        storage::user_data(app)
            .unwrap_or_default()
            .join("update-source.json"),
    )
    .ok()
    .and_then(|v| v["repo"].as_str().map(String::from))
    .unwrap_or(OFFICIAL.into())
}
fn asset(release: &Value) -> Option<ReleaseAsset> {
    platform_asset(release, std::env::consts::OS, std::env::consts::ARCH)
}
fn platform_asset(release: &Value, os: &str, arch: &str) -> Option<ReleaseAsset> {
    // This transaction installs Windows portable releases. Other platforms
    // must never be offered a ZIP merely because its filename is similar.
    if os != "windows" {
        return None;
    }
    let entries = release["assets"].as_array()?;
    let mut matching: Vec<_> = entries
        .iter()
        .filter_map(|v| {
            let name = v["name"].as_str().unwrap_or("").to_ascii_lowercase();
            if !(name.starts_with("ai-toolkit") || name.starts_with("ai toolkit"))
                || !name.ends_with(".zip")
                || ["linux", "mac", "darwin", "osx", "symbols", "debug"]
                    .iter()
                    .any(|v| name.contains(v))
            {
                return None;
            }
            let arm = name.contains("arm64") || name.contains("aarch64");
            let x86 = name.contains("ia32") || (name.contains("x86") && !name.contains("x86_64"));
            let compatible = match arch {
                "x86_64" => !arm && !x86,
                "aarch64" => arm,
                "x86" => x86,
                _ => false,
            };
            if !compatible {
                return None;
            }
            // Prefer an explicitly named Windows portable build over the old
            // generic official ZIP; equally specific alternatives are ambiguous.
            Some((
                if name.contains("windows") || name.contains("win32") || name.contains("win64") {
                    2
                } else {
                    1
                },
                v,
            ))
        })
        .collect();
    matching.sort_by_key(|(rank, _)| std::cmp::Reverse(*rank));
    if matching.is_empty() || matching.get(1).is_some_and(|v| v.0 == matching[0].0) {
        return None;
    }
    let a = matching[0].1;
    let digest = a["digest"].as_str()?.strip_prefix("sha256:")?;
    if digest.len() != 64
        || !digest.bytes().all(|b| b.is_ascii_hexdigit())
        || a["size"].as_u64()? == 0
        || a["size"].as_u64()? > 600000000
        || a["id"].as_u64().is_none()
    {
        return None;
    }
    Some(ReleaseAsset {
        id: a["id"].as_u64()?,
        url: a["browser_download_url"].as_str().map(String::from),
        size: a["size"].as_u64()?,
        sha256: digest.to_ascii_lowercase(),
    })
}
fn receipt() -> Option<Value> {
    let exe = std::env::current_exe().ok()?;
    read_receipt(&exe)
}
fn read_receipt(exe: &Path) -> Option<Value> {
    let value = storage::read_json(exe.parent()?.join(".toolkit-release.json")).ok()?;
    repository(value["repo"].as_str()?).ok()?;
    if value["key"].as_str()?.is_empty() || value["tag"].as_str()?.is_empty() {
        return None;
    }
    let hash = value["exeSha256"].as_str()?;
    if hash_file(exe).ok()? != hash.to_ascii_lowercase() {
        return None;
    }
    // An Electron receipt attests to both its launcher and actual application.
    if let Some(hash) = value["asarSha256"].as_str() {
        if hash_file(&exe.parent()?.join("resources/app.asar")).ok()? != hash.to_ascii_lowercase() {
            return None;
        }
    }
    Some(value)
}
fn is_current(
    installed: Option<&Value>,
    key: Option<&str>,
    repo: &str,
    tag: &Value,
    compiled_tag: &str,
    compiled_repo: &str,
) -> bool {
    if let Some(installed) = installed {
        return key.is_some() && installed["key"].as_str() == key;
    }
    !compiled_tag.is_empty() && tag == compiled_tag && repo.eq_ignore_ascii_case(compiled_repo)
}
pub(crate) fn hash_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(crate::error::Error::diagnostic)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 81920];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(crate::error::Error::diagnostic)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn check_repo(app: &AppHandle, repo: &str, force: bool) -> Result<Value> {
    let state = app.state::<Updates>();
    let now = seconds();
    if !force {
        if let Some((time, value)) = state
            .cache
            .lock()
            .map_err(crate::error::Error::diagnostic)?
            .get(&repo.to_lowercase())
        {
            if now / 3600 == time / 3600 {
                return Ok(value.clone());
            }
        }
    }
    let repo = validate(repo)?;
    let experimental = !repo.eq_ignore_ascii_case(OFFICIAL);
    let stable = if experimental {
        check_repo(app, OFFICIAL, force)?
    } else {
        Value::Null
    };
    if experimental && !stable["publishedAt"].is_string() {
        return Err(crate::error::Error::new(
            "no_eligible_snapshot_newer_than_the_official_release",
        ));
    }
    let mut releases = pages(&repo, "releases")?;
    releases.retain(|r| {
        r["draft"] != true
            && (experimental || r["prerelease"] != true)
            && r["published_at"].is_string()
    });
    releases.sort_by(|a, b| {
        b["published_at"]
            .as_str()
            .cmp(&a["published_at"].as_str())
            .then_with(|| b["id"].as_u64().cmp(&a["id"].as_u64()))
    });
    let release = if experimental {
        releases.iter().find(|r| {
            r["published_at"].as_str() > stable["publishedAt"].as_str() && asset(r).is_some()
        })
    } else {
        releases.first()
    };
    let result = if let Some(release) = release {
        let a = asset(release);
        let key = a.as_ref().map(|a| {
            format!(
                "{}:{}:{}:{}",
                repo.to_lowercase(),
                release["id"],
                a.id,
                a.sha256
            )
        });
        let installed = receipt();
        let compiled = option_env!("AI_TOOLKIT_RELEASE_TAG").unwrap_or("");
        let current = is_current(
            installed.as_ref(),
            key.as_deref(),
            &repo,
            &release["tag_name"],
            compiled,
            option_env!("AI_TOOLKIT_RELEASE_REPO").unwrap_or(""),
        );
        let release = ReleaseInfo {
            repo: repo.clone(),
            experimental,
            key,
            latest: release["tag_name"].as_str().map(String::from),
            published_at: release["published_at"].as_str().map(String::from),
            installed: installed
                .map(|i| {
                    format!(
                        "{} {}",
                        i["repo"].as_str().unwrap_or(""),
                        i["tag"].as_str().unwrap_or("")
                    )
                })
                .unwrap_or_else(|| compiled.into()),
            url: release["html_url"].as_str().map(String::from),
            asset: a,
        };
        json!(if release.asset.is_none() {
            UpdateStatus::Unsupported { release }
        } else if current {
            UpdateStatus::Current { release }
        } else {
            UpdateStatus::Available { release }
        })
    } else {
        json!(UpdateStatus::Empty {
            repo: repo.clone(),
            experimental
        })
    };
    state
        .cache
        .lock()
        .map_err(crate::error::Error::diagnostic)?
        .insert(repo.to_lowercase(), (now, result.clone()));
    Ok(result)
}
pub fn check(app: &AppHandle, force: bool) -> Value {
    let repo = selected(app);
    check_repo(app, &repo, force).unwrap_or_else(|error| json!(UpdateStatus::Error { repo, error }))
}
fn source_repos(
    selected: &str,
    forks: &[Value],
    mut check: impl FnMut(&str) -> Result<Value>,
) -> Vec<String> {
    let mut repos = vec![OFFICIAL.to_string()];
    for repo in
        std::iter::once(selected).chain(forks.iter().filter_map(|fork| fork["full_name"].as_str()))
    {
        if repos.iter().any(|known| known.eq_ignore_ascii_case(repo)) {
            continue;
        }
        let eligible = match check(repo) {
            Ok(value) => value["status"] == "available" || value["status"] == "current",
            // An unavailable API cannot establish that the user's source has
            // become ineligible. Keep it selected so the next check can retry.
            Err(_) => repo.eq_ignore_ascii_case(selected),
        };
        if eligible {
            repos.push(repo.into());
        }
    }
    repos
}
pub fn sources(app: &AppHandle) -> Result<Value> {
    let selected = selected(app);
    let repos = source_repos(&selected, &pages(OFFICIAL, "forks")?, |repo| {
        check_repo(app, repo, false)
    });
    Ok(json!(UpdateSources { selected, repos }))
}
pub fn select(app: &AppHandle, repo: &str) -> Result<Value> {
    let repo = validate(repo)?;
    if !repo.eq_ignore_ascii_case(OFFICIAL) {
        let available = check_repo(app, &repo, true)?;
        if available["status"] != "available" && available["status"] != "current" {
            return Err(crate::error::Error::new(
                "no_eligible_snapshot_newer_than_the_official_release",
            ));
        }
    }
    storage::atomic_write(
        &storage::user_data(app)?.join("update-source.json"),
        &serde_json::to_vec(&json!({"repo":repo})).unwrap(),
    )?;
    app.emit("update-source-changed", &repo)
        .map_err(crate::error::Error::diagnostic)?;
    Ok(json!(repo))
}
fn require_single_window(app: &AppHandle) -> Result<()> {
    if app.webview_windows().len() != 1 {
        return Err(crate::error::Error::new(
            "close_other_editor_windows_before_updating",
        ));
    }
    Ok(())
}
pub fn prepare(app: &AppHandle, key: &str) -> Result<Value> {
    require_single_window(app)?;
    let release = check(app, true);
    if release["status"] != "available" || release["key"] != key {
        return Err(crate::error::Error::new(
            "the_selected_release_changed_check_again",
        ));
    }
    let stage = storage::user_data(app)?
        .join("release-updates")
        .join(format!("native-{}", seconds()));
    fs::create_dir_all(&stage).map_err(crate::error::Error::diagnostic)?;
    let url = release["asset"]["url"]
        .as_str()
        .ok_or_else(|| crate::error::Error::new("missing_release_url"))?;
    if !url.starts_with("https://github.com/") {
        return Err(crate::error::Error::new("invalid_release_url"));
    }
    let mut response = client()?
        .get(url)
        .timeout(Duration::from_secs(300))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(crate::error::Error::diagnostic)?;
    let archive_path = stage.join("release.zip");
    let digest = stage_stream(
        &mut response,
        &archive_path,
        release["asset"]["size"]
            .as_u64()
            .ok_or_else(|| crate::error::Error::new("missing_release_size"))?,
    )?;
    if digest != release["asset"]["sha256"].as_str().unwrap_or("") {
        return Err(crate::error::Error::new("release_checksum_mismatch"));
    }
    let mut archive = zip::ZipArchive::new(
        fs::File::open(archive_path).map_err(crate::error::Error::diagnostic)?,
    )
    .map_err(crate::error::Error::diagnostic)?;
    let executables: Vec<_> = archive
        .file_names()
        .filter(|name| name.rsplit('/').next().is_some_and(executable_name))
        .map(String::from)
        .collect();
    if executables.len() != 1 {
        return Err(crate::error::Error::new(
            "expected_one_ai_toolkit_executable",
        ));
    }
    let executable = &executables[0];
    let prefix = executable
        .rfind('/')
        .map(|i| &executable[..=i])
        .unwrap_or("");
    let mut manifest = Vec::new();
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(crate::error::Error::diagnostic)?;
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| crate::error::Error::new("invalid_archive_path"))?
            .to_path_buf();
        let enclosed = enclosed.to_string_lossy().replace('\\', "/");
        let Some(path) = enclosed.strip_prefix(prefix) else {
            continue;
        };
        let path = if &enclosed == executable {
            canonical_executable()
        } else {
            path
        }
        .to_string();
        if !allowed(&path) {
            continue;
        }
        let relative = Path::new(&path);
        if !seen.insert(path.to_lowercase()) {
            return Err(crate::error::Error::with_arguments(
                "unexpected_package_entry",
                json!({"path":path}),
            ));
        }
        total += entry.size();
        if total > 1800000000 || manifest.len() > 3000 {
            return Err(crate::error::Error::new("release_exceeds_size_limits"));
        }
        let destination = stage.join("incoming").join(&relative);
        let expected = entry.size();
        let digest = stage_stream(&mut entry, &destination, expected)?;
        let mut item = json!({"path":path,"sha256":digest});
        if is_configuration(&path) {
            let exe = std::env::current_exe().map_err(crate::error::Error::diagnostic)?;
            let installed = exe
                .parent()
                .ok_or_else(|| crate::error::Error::new("invalid_executable_path"))?
                .join(&relative);
            if installed.exists() {
                let current = fs::read(installed).map_err(crate::error::Error::diagnostic)?;
                let untouched = app
                    .asset_resolver()
                    .get(path.clone())
                    .is_some_and(|a| same_configuration(&current, &a.bytes));
                item["preserve"] = json!(!untouched);
                item["expectedSha256"] = json!(sha(&current));
            } else {
                item["expectedSha256"] = Value::Null;
            }
        }
        manifest.push(item);
    }
    if !seen.contains(&canonical_executable().to_lowercase()) {
        return Err(crate::error::Error::new(
            "release_does_not_contain_ai_toolkit_exe",
        ));
    }
    let exe = std::env::current_exe().map_err(crate::error::Error::diagnostic)?;
    let root = exe
        .parent()
        .ok_or_else(|| crate::error::Error::new("invalid_executable_path"))?;
    storage::atomic_write(
        &stage.join("install.json"),
        &serde_json::to_vec(
            &json!({"root":root,"executable":exe.file_name().and_then(|v|v.to_str()),"manifest":manifest,"release":release,"pid":std::process::id()}),
        )
        .unwrap(),
    )?;
    *app.state::<Updates>()
        .prepared
        .lock()
        .map_err(crate::error::Error::diagnostic)? = Some(stage);
    Ok(json!(PreparedUpdate {
        version: release["latest"].as_str().map(String::from),
        key: key.into()
    }))
}
pub fn install(app: &AppHandle) -> Result<Value> {
    // Another document may have been opened while the download was running.
    // Never terminate an editor whose unsaved changes were not confirmed.
    require_single_window(app)?;
    let stage = app
        .state::<Updates>()
        .prepared
        .lock()
        .map_err(crate::error::Error::diagnostic)?
        .clone()
        .ok_or_else(|| crate::error::Error::new("download_the_release_first"))?;
    let helper = stage.join("toolkit-update.exe");
    fs::copy(
        std::env::current_exe().map_err(crate::error::Error::diagnostic)?,
        &helper,
    )
    .map_err(crate::error::Error::diagnostic)?;
    let mut command = std::process::Command::new(&helper);
    command.arg("--apply-update").arg(&stage);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(crate::error::Error::diagnostic)?;
    app.exit(0);
    Ok(json!(true))
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallFile {
    path: String,
    sha256: String,
    #[serde(default)]
    preserve: bool,
    expected_sha256: Option<String>,
}
#[derive(serde::Deserialize)]
struct ReleaseIdentity {
    repo: String,
    latest: String,
    key: String,
}
#[derive(serde::Deserialize)]
struct InstallPlan {
    root: PathBuf,
    #[serde(default = "default_executable")]
    executable: String,
    manifest: Vec<InstallFile>,
    release: ReleaseIdentity,
}
fn default_executable() -> String {
    canonical_executable().into()
}
pub(crate) fn contained_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let result = root.join(relative);
    let existing = result
        .ancestors()
        .find(|p| p.exists())
        .ok_or_else(|| crate::error::Error::new("invalid_destination"))?;
    if !fs::canonicalize(existing)
        .map_err(crate::error::Error::diagnostic)?
        .starts_with(root)
    {
        return Err(crate::error::Error::new("invalid_package_path"));
    }
    Ok(result)
}
impl InstallPlan {
    fn executable_path(&self) -> Result<PathBuf> {
        if !self.root.is_absolute() || !executable_name(&self.executable) {
            return Err(crate::error::Error::new("invalid_installation_root"));
        }
        let root = fs::canonicalize(&self.root).map_err(crate::error::Error::diagnostic)?;
        contained_path(&root, &self.executable)
    }
}
pub(crate) struct Change {
    pub(crate) destination: PathBuf,
    pub(crate) backup: PathBuf,
    pub(crate) existed: bool,
}
pub(crate) fn record_write(
    destination: &Path,
    backup: &Path,
    bytes: &[u8],
    changes: &mut Vec<Change>,
) -> Result<()> {
    let existed = destination.exists();
    if existed {
        if let Some(parent) = backup.parent() {
            fs::create_dir_all(parent).map_err(crate::error::Error::diagnostic)?;
        }
        fs::copy(destination, backup).map_err(crate::error::Error::diagnostic)?;
    }
    changes.push(Change {
        destination: destination.to_path_buf(),
        backup: backup.to_path_buf(),
        existed,
    });
    storage::atomic_write(destination, bytes)
}
pub(crate) fn rollback(changes: &[Change]) -> Result<()> {
    let mut errors = Vec::new();
    for change in changes.iter().rev() {
        let result = if change.existed {
            fs::copy(&change.backup, &change.destination).map(|_| ())
        } else {
            fs::remove_file(&change.destination).or_else(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(e)
                }
            })
        };
        if let Err(error) = result {
            errors.push(format!("{}: {error}", change.destination.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(crate::error::Error::diagnostic(format!(
            "Update rollback: {}",
            errors.join("; ")
        )))
    }
}
/// File transaction only: no process creation or UI. The caller supplies how to
/// acquire the executable after the editor exits; tests use ordinary file moves.
fn apply_transaction(
    stage: &Path,
    plan: &InstallPlan,
    acquire: impl FnOnce(&Path, &Path) -> Result<()>,
) -> Result<PathBuf> {
    let exe = plan.executable_path()?;
    let root = exe
        .parent()
        .ok_or_else(|| crate::error::Error::new("invalid_installation_root"))?;
    let incoming =
        fs::canonicalize(stage.join("incoming")).map_err(crate::error::Error::diagnostic)?;
    repository(&plan.release.repo)?;
    if plan.release.key.is_empty() || plan.release.latest.is_empty() || plan.manifest.is_empty() {
        return Err(crate::error::Error::new("missing_install_manifest"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    for item in &plan.manifest {
        if !allowed(&item.path)
            || !seen.insert(item.path.to_lowercase())
            || (executable_name(&item.path)
                && (item.path != canonical_executable() || item.preserve))
            || (item.preserve && !is_configuration(&item.path))
        {
            return Err(crate::error::Error::new("invalid_manifest_path"));
        }
        if item.path == ".toolkit-release.json" {
            continue;
        }
        let source = contained_path(&incoming, &item.path)?;
        total += fs::metadata(&source)
            .map_err(crate::error::Error::diagnostic)?
            .len();
        if total > 1_800_000_000 || plan.manifest.len() > 3000 {
            return Err(crate::error::Error::new("release_exceeds_size_limits"));
        }
        if hash_file(&source)? != item.sha256 {
            return Err(crate::error::Error::new("staged_update_changed"));
        }
        contained_path(
            root,
            if item.path == canonical_executable() {
                &plan.executable
            } else {
                &item.path
            },
        )?;
    }
    if !seen.contains(&canonical_executable().to_lowercase()) {
        return Err(crate::error::Error::new(
            "release_does_not_contain_ai_toolkit_exe",
        ));
    }
    let backup = stage.join("backup");
    fs::create_dir_all(&backup).map_err(crate::error::Error::diagnostic)?;
    let saved_exe = backup.join(canonical_executable());
    if saved_exe.exists() {
        return Err(crate::error::Error::new("staged_update_changed"));
    }
    acquire(&exe, &saved_exe)?;
    let mut changes = vec![Change {
        destination: exe.clone(),
        backup: saved_exe,
        existed: true,
    }];
    let result = (|| {
        for item in &plan.manifest {
            if item.path == ".toolkit-release.json" || item.preserve {
                continue;
            }
            let destination = if item.path == canonical_executable() {
                exe.clone()
            } else {
                root.join(&item.path)
            };
            if is_configuration(&item.path) {
                let current = fs::read(&destination).ok().map(|v| sha(&v));
                if current.as_deref() != item.expected_sha256.as_deref() {
                    continue;
                }
            }
            let bytes =
                fs::read(incoming.join(&item.path)).map_err(crate::error::Error::diagnostic)?;
            if sha(&bytes) != item.sha256 {
                return Err(crate::error::Error::new("staged_update_changed"));
            }
            if item.path == canonical_executable() {
                storage::atomic_write(&destination, &bytes)?;
            } else {
                record_write(&destination, &backup.join(&item.path), &bytes, &mut changes)?;
            }
        }
        let mut record = json!({"repo":plan.release.repo,"tag":plan.release.latest,"key":plan.release.key,"exeSha256":hash_file(&exe)?});
        if seen.contains("resources/app.asar") {
            record["asarSha256"] = json!(hash_file(&root.join("resources/app.asar"))?);
        }
        record_write(
            &root.join(".toolkit-release.json"),
            &backup.join(".toolkit-release.json"),
            &serde_json::to_vec(&record).map_err(crate::error::Error::diagnostic)?,
            &mut changes,
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        if let Err(rollback_error) = rollback(&changes) {
            return Err(crate::error::Error::diagnostic(format!(
                "{error}; {rollback_error}"
            )));
        }
        return Err(error);
    }
    Ok(exe)
}
pub(crate) fn acquire_closed_executable(exe: &Path, backup: &Path) -> Result<()> {
    // Never terminate another process. Only proceed after Windows releases the
    // actual installed filename, which can differ between NSIS and portable ZIP.
    // Stage/userData and the installed application can live on different drives;
    // acquire the image by renaming beside it, then copy into the rollback stage.
    let local_backup = exe.with_file_name(format!(".toolkit-previous-{}.exe", std::process::id()));
    if local_backup.exists() {
        return Err(crate::error::Error::new("staged_update_changed"));
    }
    for _ in 0..120 {
        if fs::rename(exe, &local_backup).is_ok() {
            let copied =
                fs::copy(&local_backup, backup).and_then(|_| fs::remove_file(&local_backup));
            if let Err(error) = copied {
                if let Err(restore_error) = fs::rename(&local_backup, exe) {
                    return Err(crate::error::Error::diagnostic(format!(
                        "{error}; executable restoration: {restore_error}; backup: {}",
                        local_backup.display()
                    )));
                }
                return Err(crate::error::Error::diagnostic(error));
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(crate::error::Error::new(
        "editor_did_not_close_no_files_were_replaced",
    ))
}
pub fn apply_update(stage: &Path) -> Result<()> {
    let plan: InstallPlan = serde_json::from_value(storage::read_json(stage.join("install.json"))?)
        .map_err(crate::error::Error::diagnostic)?;
    let exe = plan.executable_path()?;
    let result = apply_transaction(stage, &plan, acquire_closed_executable);
    if exe.is_file() {
        let restarted = std::process::Command::new(&exe)
            .current_dir(&plan.root)
            .env_remove("ELECTRON_RUN_AS_NODE")
            .spawn();
        if result.is_ok() {
            restarted.map_err(crate::error::Error::diagnostic)?;
        }
    }
    result.map(|_| ())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_discovery_preserves_selected_repo_on_transient_errors_only() {
        let selected = "Krarilotus/AI-Toolkit";
        let forks = json!([
            {"full_name":"krarilotus/ai-toolkit"},
            {"full_name":"Other/AI-Toolkit"},
            {"full_name":"Current/AI-Toolkit"}
        ]);
        let mut checked = Vec::new();
        let repos = source_repos(selected, forks.as_array().unwrap(), |repo| {
            checked.push(repo.to_string());
            if repo.starts_with("Current/") {
                Ok(json!({"status":"current"}))
            } else {
                Err(crate::error::Error::diagnostic(
                    "GitHub HTTP 403 rate limit",
                ))
            }
        });
        assert_eq!(repos, [OFFICIAL, selected, "Current/AI-Toolkit"]);
        assert_eq!(
            checked,
            [selected, "Other/AI-Toolkit", "Current/AI-Toolkit"]
        );
        // Custom sources need not appear in the upstream fork listing.
        assert_eq!(
            source_repos(selected, &[], |_| Err(crate::error::Error::diagnostic(
                "offline"
            ))),
            [OFFICIAL, selected]
        );
    }

    #[test]
    fn source_discovery_still_falls_back_for_confirmed_ineligible_snapshots() {
        for status in ["empty", "unsupported"] {
            assert_eq!(
                source_repos("Krarilotus/AI-Toolkit", &[], |_| Ok(
                    json!({"status":status})
                )),
                [OFFICIAL]
            );
        }
        assert_eq!(
            source_repos("Krarilotus/AI-Toolkit", &[], |_| Ok(
                json!({"status":"available"})
            )),
            [OFFICIAL, "Krarilotus/AI-Toolkit"]
        );
    }

    struct Fixture {
        directory: PathBuf,
        root: PathBuf,
        stage: PathBuf,
    }
    impl Fixture {
        fn new(executable: &str) -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let directory = std::env::temp_dir().join(format!(
                "toolkit-transaction-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let root = directory.join("installed");
            let stage = directory.join("stage");
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(stage.join("incoming")).unwrap();
            fs::write(root.join(executable), b"previous executable").unwrap();
            Self {
                directory,
                root,
                stage,
            }
        }
        fn incoming(&self, path: &str, bytes: &[u8]) -> Value {
            let file = self.stage.join("incoming").join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, bytes).unwrap();
            json!({"path":path,"sha256":sha(bytes)})
        }
        fn plan(&self, executable: &str, manifest: Vec<Value>) -> InstallPlan {
            serde_json::from_value(json!({"root":self.root,"executable":executable,"manifest":manifest,"release":{"repo":"Krarilotus/AI-Toolkit","latest":"snapshot-test","key":"new-release-key"}})).unwrap()
        }
        fn apply(&self, plan: &InstallPlan) -> Result<PathBuf> {
            apply_transaction(&self.stage, plan, |exe, backup| {
                fs::rename(exe, backup).map_err(crate::error::Error::diagnostic)
            })
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn windows_asset_selection_ignores_other_platforms_and_prefers_explicit_portable() {
        let entry = |id, name| json!({"id":id,"name":name,"size":100,"digest":format!("sha256:{}","a".repeat(64)),"browser_download_url":"https://github.com/test/Toolkit/releases/download/1/a.zip"});
        let release = json!({"assets":[entry(1,"AI-toolkit-1.zip"),entry(2,"AI-Toolkit-1-linux-x64.zip"),entry(3,"AI-Toolkit-1-macos-arm64.zip"),entry(4,"AI-Toolkit-1-windows-x64.zip")]});
        assert_eq!(platform_asset(&release, "windows", "x86_64").unwrap().id, 4);
        assert!(platform_asset(&release, "linux", "x86_64").is_none());
        assert!(platform_asset(&release, "windows", "aarch64").is_none());
        let legacy = json!({"assets":[entry(1,"AI-toolkit-0.7.3.zip")]});
        assert!(platform_asset(&legacy, "windows", "x86_64").is_some());
        for name in [
            "AI-Toolkit-mac-x64.zip",
            "AI-Toolkit-windows-arm64.zip",
            "AI-Toolkit-windows-x86.zip",
        ] {
            assert!(
                platform_asset(&json!({"assets":[entry(1,name)]}), "windows", "x86_64").is_none()
            );
        }
        let ambiguous = json!({"assets":[entry(1,"AI-Toolkit-native-windows-x64.zip"),entry(2,"AI-Toolkit-electron-windows-x64.zip")]});
        assert!(platform_asset(&ambiguous, "windows", "x86_64").is_none());
    }
    #[test]
    fn verified_receipt_takes_priority_over_compiled_tag() {
        let receipt = json!({"key":"old-asset"});
        assert!(!is_current(
            Some(&receipt),
            Some("replacement-asset"),
            OFFICIAL,
            &json!("1.0"),
            "1.0",
            OFFICIAL
        ));
        assert!(is_current(
            Some(&receipt),
            Some("old-asset"),
            OFFICIAL,
            &json!("1.0"),
            "",
            ""
        ));
        assert!(is_current(
            None,
            Some("asset"),
            OFFICIAL,
            &json!("1.0"),
            "1.0",
            OFFICIAL
        ));
        assert!(!is_current(
            None,
            Some("asset"),
            OFFICIAL,
            &json!("1.0"),
            "1.0",
            "Krarilotus/AI-Toolkit"
        ));
    }
    #[test]
    fn native_transaction_preserves_custom_and_post_download_configuration() {
        let f = Fixture::new("ai-toolkit.exe");
        fs::create_dir_all(f.root.join("config")).unwrap();
        fs::write(f.root.join("config/default.json"), b"old default").unwrap();
        fs::write(f.root.join("config/custom.json"), b"custom values").unwrap();
        fs::write(f.root.join("config/edited.json"), b"edited after download").unwrap();
        fs::write(
            f.root.join("config/created.json"),
            b"created after download",
        )
        .unwrap();
        fs::write(f.root.join("settings.json"), b"user settings untouched").unwrap();
        fs::create_dir_all(f.root.join("config/custom-pack")).unwrap();
        fs::write(
            f.root.join("config/custom-pack/note.txt"),
            b"unknown nested file",
        )
        .unwrap();
        fs::write(f.root.join("config/unknown.json"), b"unknown user defaults").unwrap();
        let mut manifest = vec![f.incoming("AI Toolkit.exe", b"new native executable")];
        for (name, expected, preserve) in [
            ("default", Some(sha(b"old default")), false),
            ("custom", Some(sha(b"custom values")), true),
            ("edited", Some(sha(b"before download")), false),
            ("created", None, false),
            ("deleted", Some(sha(b"deleted after download")), false),
            ("new", None, false),
        ] {
            let mut item = f.incoming(&format!("config/{name}.json"), b"new defaults");
            item["expectedSha256"] = json!(expected);
            item["preserve"] = json!(preserve);
            manifest.push(item);
        }
        let plan = f.plan("ai-toolkit.exe", manifest);
        let exe = f.apply(&plan).unwrap();
        assert_eq!(fs::read(&exe).unwrap(), b"new native executable");
        for (name, expected) in [
            ("default", "new defaults"),
            ("custom", "custom values"),
            ("edited", "edited after download"),
            ("created", "created after download"),
            ("new", "new defaults"),
        ] {
            assert_eq!(
                fs::read(f.root.join(format!("config/{name}.json"))).unwrap(),
                expected.as_bytes()
            );
        }
        assert_eq!(
            fs::read(f.root.join("settings.json")).unwrap(),
            b"user settings untouched"
        );
        assert!(!f.root.join("AI Toolkit.exe").exists());
        assert!(!f.root.join("config/deleted.json").exists());
        assert_eq!(
            fs::read(f.root.join("config/custom-pack/note.txt")).unwrap(),
            b"unknown nested file"
        );
        assert_eq!(
            fs::read(f.root.join("config/unknown.json")).unwrap(),
            b"unknown user defaults"
        );
        let receipt = read_receipt(&exe).unwrap();
        assert_eq!(receipt["key"], "new-release-key");
        assert!(receipt.get("asarSha256").is_none());
    }
    #[test]
    fn electron_transaction_receipt_attests_to_the_actual_application() {
        let f = Fixture::new("AI Toolkit.exe");
        let plan = f.plan(
            "AI Toolkit.exe",
            vec![
                f.incoming("AI Toolkit.exe", b"electron launcher"),
                f.incoming("resources/app.asar", b"electron application"),
                f.incoming("locales/de.pak", b"locale"),
            ],
        );
        let exe = f.apply(&plan).unwrap();
        let receipt = read_receipt(&exe).unwrap();
        assert_eq!(receipt["asarSha256"], sha(b"electron application"));
        fs::write(f.root.join("resources/app.asar"), b"different application").unwrap();
        assert!(read_receipt(&exe).is_none());
    }
    #[test]
    fn changed_staged_hash_is_rejected_before_any_installed_file_moves() {
        let f = Fixture::new("AI Toolkit.exe");
        let item = f.incoming("AI Toolkit.exe", b"verified executable");
        fs::write(
            f.stage.join("incoming/AI Toolkit.exe"),
            b"changed after verification",
        )
        .unwrap();
        let plan = f.plan("AI Toolkit.exe", vec![item]);
        assert!(f.apply(&plan).is_err());
        assert_eq!(
            fs::read(f.root.join("AI Toolkit.exe")).unwrap(),
            b"previous executable"
        );
        assert!(!f.stage.join("backup/AI Toolkit.exe").exists());
        assert!(!f.root.join(".toolkit-release.json").exists());
    }
    #[test]
    fn executable_acquisition_uses_a_local_move_and_restores_on_backup_failure() {
        let f = Fixture::new("AI Toolkit.exe");
        let exe = f.root.join("AI Toolkit.exe");
        let blocked = f.stage.join("blocked");
        fs::create_dir(&blocked).unwrap();
        assert!(acquire_closed_executable(&exe, &blocked).is_err());
        assert_eq!(fs::read(&exe).unwrap(), b"previous executable");
        let backup = f.stage.join("previous.exe");
        acquire_closed_executable(&exe, &backup).unwrap();
        assert!(!exe.exists());
        assert_eq!(fs::read(&backup).unwrap(), b"previous executable");
        assert!(!f
            .root
            .join(format!(".toolkit-previous-{}.exe", std::process::id()))
            .exists());
    }
    #[test]
    fn failed_replacement_rolls_back_executable_changed_and_new_files() {
        let f = Fixture::new("AI Toolkit.exe");
        fs::write(f.root.join("README.txt"), b"previous readme").unwrap();
        fs::write(f.root.join(".toolkit-release.json"), b"previous receipt").unwrap();
        // An existing directory where a later file belongs produces a real I/O
        // failure after earlier files have already been installed.
        fs::create_dir(f.root.join("blocked.dll")).unwrap();
        let plan = f.plan(
            "AI Toolkit.exe",
            vec![
                f.incoming("AI Toolkit.exe", b"new exe"),
                f.incoming("README.txt", b"new readme"),
                f.incoming("new.dll", b"new file"),
                f.incoming("blocked.dll", b"blocked"),
            ],
        );
        assert!(f.apply(&plan).is_err());
        assert_eq!(
            fs::read(f.root.join("AI Toolkit.exe")).unwrap(),
            b"previous executable"
        );
        assert_eq!(
            fs::read(f.root.join("README.txt")).unwrap(),
            b"previous readme"
        );
        assert_eq!(
            fs::read(f.root.join(".toolkit-release.json")).unwrap(),
            b"previous receipt"
        );
        assert!(!f.root.join("new.dll").exists());
    }
    #[test]
    fn formatting_does_not_make_default_config_custom() {
        assert!(same_configuration(
            br#"{ "size": 1, "name": "Wall" }"#,
            br#"{"name":"Wall","size":1}"#
        ));
        assert!(!same_configuration(br#"{"size":2}"#, br#"{"size":1}"#));
        assert!(!same_configuration(b"invalid", b"invalid"));
    }
    #[test]
    fn repository_and_package_contract_are_explicit() {
        assert!(repository(OFFICIAL).is_ok());
        assert!(repository("Krarilotus/AI-Toolkit").is_ok());
        for value in ["../AI-Toolkit", "https://github.com/a/b", "a/b/extra"] {
            assert!(repository(value).is_err());
        }
        // Run the same accepted/rejected paths as the JavaScript ZIP builder.
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/package-paths.json")).unwrap();
        for case in cases {
            let name = case["path"].as_str().unwrap();
            assert_eq!(
                allowed(name),
                case["update"].as_bool().unwrap(),
                "updater: {name:?}"
            );
            assert_eq!(
                is_configuration(name),
                case["configuration"].as_bool().unwrap(),
                "configuration: {name:?}"
            );
        }
    }
    #[test]
    fn staging_is_bounded_and_checks_every_byte() {
        let root = std::env::temp_dir().join(format!("toolkit-stream-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("payload");
        assert_eq!(
            stage_stream(&mut &b"payload"[..], &file, 7).unwrap(),
            sha(b"payload")
        );
        assert!(stage_stream(&mut &b"too long"[..], &file, 2).is_err());
        assert!(stage_stream(&mut &b"short"[..], &file, 10).is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
