use crate::{
    library,
    storage::{self, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
mod contracts;
mod responses;
use contracts::{FileDialog, GameRequest, Request};
use responses::{ImageSelection, InterfaceSettings, Skins};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct Session {
    pub approved_close: Mutex<HashSet<String>>,
    pub protected: Mutex<HashSet<String>>,
    documents: Mutex<DocumentDelivery>,
}
/// Readiness and pending content form one state transition. Keeping them under
/// one mutex prevents a new window's ready signal from passing a queued file.
#[derive(Default)]
struct DocumentDelivery {
    ready: HashSet<String>,
    pending: HashMap<String, Value>,
}
impl DocumentDelivery {
    fn mark_ready(&mut self, label: &str) -> Option<Value> {
        self.ready.insert(label.into());
        self.pending.remove(label)
    }
    fn queue(&mut self, label: &str, payload: Value) -> Option<Value> {
        if self.ready.contains(label) {
            Some(payload)
        } else {
            self.pending.insert(label.into(), payload);
            None
        }
    }
}
fn interface_settings(app: &AppHandle) -> Result<Value> {
    let s = storage::settings(app)?;
    Ok(json!(InterfaceSettings {
        theme: s["theme"].as_str().unwrap_or("default").into(),
        language: s["language"].as_str().unwrap_or("system").into(),
    }))
}
fn configuration(app: &AppHandle, name: &str) -> Result<Value> {
    storage::safe_name(name)?;
    // Embedded defaults are immutable. External config is intentionally editable.
    let asset = app
        .asset_resolver()
        .get(format!("config/{name}"))
        .ok_or_else(|| crate::error::Error::new("unknown_configuration_file"))?;
    let defaults: Value =
        serde_json::from_slice(&asset.bytes).map_err(crate::error::Error::diagnostic)?;
    let custom = std::env::current_exe()
        .map_err(crate::error::Error::diagnostic)?
        .parent()
        .unwrap()
        .join("config")
        .join(name);
    if custom.exists() {
        return Ok(storage::merge_configuration(
            name,
            defaults,
            storage::read_json(custom)?,
        ));
    }
    Ok(defaults)
}
fn pick(app: &AppHandle, window: &WebviewWindow, payload: &FileDialog) -> Result<Value> {
    // Modal ownership is required, not optional: edits behind Save As would
    // otherwise diverge from the document captured before the picker opened.
    let mut dialog = app.dialog().file().set_parent(window);
    if let Some(title) = payload.title.as_deref() {
        dialog = dialog.set_title(title);
    }
    if let Some(default) = payload.default_path.as_deref() {
        let path = Path::new(default);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        } else {
            if let Some(p) = path.parent() {
                dialog = dialog.set_directory(p);
            }
            if let Some(n) = path.file_name() {
                dialog = dialog.set_file_name(n.to_string_lossy());
            }
        }
    }
    for filter in payload.filters.as_deref().unwrap_or_default() {
        let extensions: Vec<_> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    let selected = if payload.directory == Some(true) {
        dialog.blocking_pick_folder()
    } else if payload.save == Some(true) {
        dialog.blocking_save_file()
    } else {
        dialog.blocking_pick_file()
    };
    Ok(selected
        .and_then(|p| p.into_path().ok())
        .map(|p| json!(p))
        .unwrap_or(Value::Null))
}
fn skin_path(app: &AppHandle, id: u32) -> Result<PathBuf> {
    if id > 100000 {
        return Err(crate::error::Error::new("invalid_item_type"));
    }
    let folder = storage::user_data(app)?.join("aiv-skins");
    fs::create_dir_all(&folder).map_err(crate::error::Error::diagnostic)?;
    Ok(folder.join(format!("{id}.png")))
}
fn image_selection(app: &AppHandle, window: &WebviewWindow, payload: &FileDialog) -> Result<Value> {
    let choice = pick(app, window, payload)?;
    let Some(path) = choice.as_str() else {
        return Ok(Value::Null);
    };
    let file = Path::new(path);
    if fs::metadata(file)
        .map_err(crate::error::Error::diagnostic)?
        .len()
        > 128 * 1024 * 1024
    {
        return Err(crate::error::Error::new("selected_image_exceeds_128_mb"));
    }
    Ok(json!(ImageSelection {
        file_name: file
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: file.to_path_buf(),
        data_url: storage::data_url(file)?,
    }))
}

#[tauri::command]
pub async fn desktop_request(
    app: AppHandle,
    window: WebviewWindow,
    request: Request,
) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || handle(&app, &window, request))
        .await
        .map_err(crate::error::Error::diagnostic)?
}
fn library_request<T: Serialize>(
    payload: T,
    handler: impl FnOnce(&Value) -> Result<Value>,
) -> Result<Value> {
    let value = serde_json::to_value(payload).map_err(crate::error::Error::diagnostic)?;
    handler(&value)
}
fn set_interface_setting(app: &AppHandle, key: &str, value: &str) -> Result<Value> {
    let theme = key == "theme";
    if theme
        && !matches!(value, "default" | "ucp")
        && !crate::themes::discover(&storage::user_data(app)?.join("themes"))?
            .iter()
            .any(|pack| pack.id == value)
    {
        return Err(crate::error::Error::new("unknown_theme"));
    }
    if !theme
        && !matches!(
            value,
            "system" | "en" | "de" | "fr" | "ru" | "hu" | "tr" | "zh-CN" | "es" | "fa"
        )
    {
        return Err(crate::error::Error::new("unknown_language"));
    }
    storage::update_settings(app, key, json!(value))?;
    let settings = interface_settings(app)?;
    app.emit(
        if theme {
            "theme-changed"
        } else {
            "language-changed"
        },
        if theme {
            json!(value)
        } else {
            settings.clone()
        },
    )
    .map_err(crate::error::Error::diagnostic)?;
    Ok(settings)
}
fn handle(app: &AppHandle, window: &WebviewWindow, request: Request) -> Result<Value> {
    match request {
        Request::DocumentReady => {
            let state = app.state::<Session>();
            let pending = state
                .documents
                .lock()
                .map_err(crate::error::Error::diagnostic)?
                .mark_ready(window.label());
            if let Some(payload) = pending {
                window
                    .emit_to(window.label(), "load-file", payload)
                    .map_err(crate::error::Error::diagnostic)?;
            }
            Ok(Value::Null)
        }
        Request::ProtectClose => {
            app.state::<Session>()
                .protected
                .lock()
                .map_err(crate::error::Error::diagnostic)?
                .insert(window.label().into());
            Ok(Value::Null)
        }
        Request::CheckUpdate { force } => Ok(crate::updates::check(app, force)),
        Request::UpdateSources => crate::updates::sources(app),
        Request::SetUpdateSource { repo } => crate::updates::select(app, &repo),
        Request::PrepareUpdate { key } => crate::updates::prepare(app, &key),
        Request::InstallUpdate => crate::updates::install(app),
        Request::InterfaceSettings => interface_settings(app),
        Request::Confirm {
            title,
            message,
            choices,
            values,
        } => {
            use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogResult};
            let label = |i: usize| choices.get(i).cloned().unwrap_or_default();
            let response = app
                .dialog()
                .message(message)
                .parent(window)
                .title(title)
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    label(0),
                    label(1),
                    label(2),
                ))
                .blocking_show_with_result();
            let index = match response {
                MessageDialogResult::Yes => 0,
                MessageDialogResult::No => 1,
                MessageDialogResult::Custom(s) => choices.iter().position(|v| v == &s).unwrap_or(2),
                _ => 2,
            };
            Ok(json!(values.get(index).cloned().flatten()))
        }
        Request::ListThemes => Ok(json!(crate::themes::discover(
            &storage::user_data(app)?.join("themes")
        )?)),
        Request::SetTheme { theme } => set_interface_setting(app, "theme", &theme),
        Request::SetLanguage { language } => set_interface_setting(app, "language", &language),
        Request::LoadConfig { file } => configuration(app, &file),
        Request::Installation => Ok(storage::installation(app)
            .ok()
            .map(|p| json!(p))
            .unwrap_or(Value::Null)),
        Request::ChooseInstallation(dialog) => {
            let choice = pick(app, window, &dialog)?;
            if let Some(value) = choice.as_str() {
                let root = storage::normalize_installation(Path::new(value))?;
                storage::update_settings(app, "ucpInstallation", json!(root))?;
                Ok(json!(root))
            } else {
                Ok(Value::Null)
            }
        }
        Request::PickPath(dialog) => pick(app, window, &dialog),
        Request::ReadDocument { path, castle } => {
            Ok(json!(storage::read_document(Path::new(&path), castle)?))
        }
        Request::ReadBytes { path } => Ok(json!(
            STANDARD.encode(fs::read(path).map_err(crate::error::Error::diagnostic)?)
        )),
        Request::WriteFile {
            path,
            content,
            base64,
        } => {
            let bytes = if let Some(encoded) = base64 {
                STANDARD
                    .decode(encoded)
                    .map_err(crate::error::Error::diagnostic)?
            } else {
                content
                    .ok_or_else(|| {
                        crate::error::Error::with_arguments(
                            "missing_argument",
                            json!({"name":"content"}),
                        )
                    })?
                    .into_bytes()
            };
            storage::atomic_write(Path::new(&path), &bytes)?;
            Ok(json!(path))
        }
        Request::ScanLibrary { game_root } => library::scan(Path::new(&game_root)),
        Request::ReadProject(p) => library_request(p, library::read_project),
        Request::ReplaceCharacter(p) => library_request(p, library::replace_character),
        Request::CloneAi(p) => library_request(p, |p| library::create(p, true)),
        Request::CreateAi(p) => library_request(p, |p| library::create(p, false)),
        Request::UpdateAi(p) => library_request(p, library::update),
        Request::CastleDestination(p) => library_request(p, library::castle_destination),
        Request::AddCastle(p) => library_request(p, library::add_castle),
        Request::ReplacePortrait(p) => library_request(p, library::replace_portrait),
        Request::UpdateMapping(p) => library_request(p, library::update_mapping),
        Request::ReadMedia(p) => {
            let mut media = library_request(p, library::resolve_media)?;
            if media["kind"] != "speech" {
                return Err(crate::error::Error::new(
                    "use_open_externally_for_bink_video",
                ));
            }
            if media["size"].as_u64().unwrap_or(0) > 128 * 1024 * 1024 {
                return Err(crate::error::Error::new("media_exceeds_playback_limit"));
            }
            media["dataUrl"] = json!(storage::data_url(Path::new(library::text(
                &media, "filePath"
            )))?);
            Ok(media)
        }
        Request::ReplaceMedia(p) => {
            let media_request =
                serde_json::to_value(p.media).map_err(crate::error::Error::diagnostic)?;
            let media = library::resolve_media(&media_request)?;
            let choice = pick(app, window, &p.dialog)?;
            if let Some(source) = choice.as_str() {
                let dest = Path::new(library::text(&media, "filePath"));
                let extension = |path: &Path| {
                    path.extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase()
                };
                if extension(Path::new(source)) != extension(dest) {
                    return Err(crate::error::Error::new(
                        "the_media_file_type_does_not_match",
                    ));
                }
                storage::atomic_write(
                    dest,
                    &fs::read(source).map_err(crate::error::Error::diagnostic)?,
                )?;
                library::resolve_media(&media_request)
            } else {
                Ok(Value::Null)
            }
        }
        Request::OpenMedia(p) => {
            let media = library_request(p, library::resolve_media)?;
            let path = library::text(&media, "filePath");
            app.opener()
                .open_path(path, None::<&str>)
                .map_err(crate::error::Error::diagnostic)?;
            Ok(json!(path))
        }
        Request::OpenPath {
            game_root,
            target_path,
        } => {
            let root = storage::normalize_installation(Path::new(&game_root))?;
            let plugins = root.join("ucp/plugins");
            let requested = target_path.as_deref().filter(|path| !path.is_empty());
            let target = storage::within(&plugins, requested.map(Path::new).unwrap_or(&plugins))?;
            app.opener()
                .open_path(target.to_string_lossy(), None::<&str>)
                .map_err(crate::error::Error::diagnostic)?;
            Ok(json!(target))
        }
        Request::LoadSkins => {
            let mut result = Skins::default();
            let dir = storage::user_data(app)?.join("aiv-skins");
            if dir.exists() {
                for entry in fs::read_dir(dir)
                    .map_err(crate::error::Error::diagnostic)?
                    .flatten()
                {
                    let file = entry.path();
                    let stem = file.file_stem().and_then(|n| n.to_str()).unwrap_or("");
                    if stem.parse::<u32>().is_ok()
                        && file
                            .extension()
                            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
                    {
                        result.skins.insert(stem.into(), storage::data_url(&file)?);
                        result.custom_skin_types.push(stem.into());
                    }
                }
            }
            Ok(json!(result))
        }
        Request::ChooseSkin { item_type, dialog } => {
            let selected = pick(app, window, &dialog)?;
            if let Some(source) = selected.as_str() {
                let target = skin_path(app, item_type)?;
                let bytes = fs::read(source).map_err(crate::error::Error::diagnostic)?;
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    return Err(crate::error::Error::new("invalid_png"));
                }
                storage::atomic_write(&target, &bytes)?;
                Ok(json!(storage::data_url(&target)?))
            } else {
                Ok(Value::Null)
            }
        }
        Request::RemoveSkin { item_type } => {
            let path = skin_path(app, item_type)?;
            if path.exists() {
                fs::remove_file(path).map_err(crate::error::Error::diagnostic)?;
            }
            Ok(json!(true))
        }
        Request::OpenSkins => {
            let folder = storage::user_data(app)?.join("aiv-skins");
            fs::create_dir_all(&folder).map_err(crate::error::Error::diagnostic)?;
            app.opener()
                .open_path(folder.to_string_lossy(), None::<&str>)
                .map_err(crate::error::Error::diagnostic)?;
            Ok(json!(folder))
        }
        Request::ChooseBackground(dialog) => image_selection(app, window, &dialog),
        Request::SavePicture { png, dialog } => {
            let choice = pick(app, window, &dialog)?;
            if let Some(path) = choice.as_str() {
                let data = png
                    .strip_prefix("data:image/png;base64,")
                    .ok_or_else(|| crate::error::Error::new("invalid_png"))?;
                let bytes = STANDARD
                    .decode(data)
                    .map_err(crate::error::Error::diagnostic)?;
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    return Err(crate::error::Error::new("invalid_png"));
                }
                storage::atomic_write(Path::new(path), &bytes)?;
                Ok(json!(path))
            } else {
                Ok(Value::Null)
            }
        }
        Request::DeveloperTools => {
            window.open_devtools();
            Ok(Value::Null)
        }
        Request::Ready => {
            window.show().map_err(crate::error::Error::diagnostic)?;
            if window.label() == "main" {
                crate::legacy_update::ready(app)?;
            }
            Ok(json!(true))
        }
        Request::ConfirmClose => {
            app.state::<Session>()
                .approved_close
                .lock()
                .map_err(crate::error::Error::diagnostic)?
                .insert(window.label().into());
            window.close().map_err(crate::error::Error::diagnostic)?;
            Ok(json!(true))
        }
        Request::NewWindow => {
            let window =
                crate::windows::create(app, false).map_err(crate::error::Error::diagnostic)?;
            Ok(json!(window.label()))
        }
    }
}

#[tauri::command]
pub fn queue_document(app: AppHandle, label: String, payload: Value) -> Result<()> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| crate::error::Error::new("editor_window_not_found"))?;
    let state = app.state::<Session>();
    let ready = state
        .documents
        .lock()
        .map_err(crate::error::Error::diagnostic)?
        .queue(&label, payload);
    if let Some(payload) = ready {
        window
            .emit_to(window.label(), "load-file", payload)
            .map_err(crate::error::Error::diagnostic)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_new_window_receives_its_document_once_in_either_readiness_order() {
        let payload = json!({"path":"Castle.aiv", "sourceBytes":[0,1,2,255]});
        for ready_first in [false, true] {
            let mut delivery = DocumentDelivery::default();
            let mut emitted = Vec::new();
            delivery.queue("other-window", json!({"path":"Other.aiv"}));
            if ready_first {
                emitted.extend(delivery.mark_ready("editor"));
            }
            emitted.extend(delivery.queue("editor", payload.clone()));
            emitted.extend(delivery.mark_ready("editor"));
            emitted.extend(delivery.mark_ready("editor"));
            assert_eq!(emitted, [payload.clone()]);
            assert_eq!(
                delivery.mark_ready("other-window").unwrap()["path"],
                "Other.aiv"
            );
        }
    }
}

#[tauri::command]
pub async fn game_request(app: AppHandle, request: GameRequest) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = match storage::installation(&app) {
            Ok(r) => r,
            Err(_) => {
                return Ok(match request {
                    GameRequest::Maps => json!({"gameRoot":null,"maps":[]}),
                    GameRequest::Units => json!(responses::UnitAssetsResult::Missing(
                        responses::EmptyObject {}
                    )),
                    GameRequest::ResourceIcons => json!({}),
                    _ => Value::Null,
                })
            }
        };
        let cache = storage::user_data(&app)?;
        let resources = storage::resource(&app, "config")?
            .parent()
            .ok_or_else(|| crate::error::Error::new("invalid_resource_directory"))?
            .to_path_buf();
        use crate::game;
        match request {
            GameRequest::Buildings => {
                game::load_building_assets(&root, &cache.join("game-building-assets"), &resources)
            }
            GameRequest::Units => game::load_unit_sprites(&root, &cache.join("game-unit-assets"))
                .map(|assets| json!(responses::UnitAssetsResult::Loaded(assets))),
            GameRequest::ResourceIcons => game::read_resource_icons(&root),
            GameRequest::Balance => game::read_installed_balance(&root),
            GameRequest::Maps => game::list_game_maps(&root),
            GameRequest::Map { path } => game::read_map(Path::new(&path), &root),
            GameRequest::Tiles { path } => game::load_map_tiles(
                Path::new(&path),
                &root,
                &cache.join("native-map-renderer"),
                &resources,
            ),
        }
        .map_err(crate::error::Error::diagnostic)
    })
    .await
    .map_err(crate::error::Error::diagnostic)?
}
