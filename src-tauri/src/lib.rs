mod desktop;
mod error;
pub mod game;
mod legacy_update;
mod library;
mod migration;
mod storage;
mod themes;
mod updates;
mod webview_dependency;
mod windows;
use tauri::{Emitter, Manager};

pub fn run() {
    let mut pending = match legacy_update::detect() {
        Ok(pending) => pending,
        Err(error) => {
            webview_dependency::notify_error(&error);
            return;
        }
    };
    let prepared = (|| -> Result<(), String> {
        if let Some(migration) = pending.as_mut() {
            migration.prepare()?;
        }
        webview_dependency::ensure()
    })();
    if let Err(error) = prepared {
        startup_failed(&error, pending.as_ref());
        return;
    }
    let pending = std::sync::Arc::new(std::sync::Mutex::new(pending));
    let result = tauri::Builder::default()
        .manage(legacy_update::Startup(pending.clone()))
        .manage(desktop::Session::default())
        .manage(updates::Updates::default())
        .manage(windows::WindowState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop::desktop_request,
            desktop::game_request,
            desktop::queue_document
        ])
        .setup(move |app| {
            let handle = app.handle();
            // Tauri panics on setup errors, so explain and leave here instead.
            if let Err(message) = storage::require_resources(handle) {
                let migration = handle
                    .state::<legacy_update::Startup>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.take());
                startup_failed(&message, migration.as_ref());
                std::process::exit(1);
            }
            let cache = storage::user_data(handle)?;
            app.asset_protocol_scope().allow_directory(&cache, true)?;
            windows::create(handle, true)?;
            if let Some(window) = app.get_webview_window("main") {
                windows::restore(handle, &window)?;
            }
            legacy_update::watch_startup(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                windows::destroyed(window);
            }
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                windows::remember(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let approved = app
                    .state::<desktop::Session>()
                    .approved_close
                    .lock()
                    .map(|s| s.contains(window.label()))
                    .unwrap_or(false);
                let protected = app
                    .state::<desktop::Session>()
                    .protected
                    .lock()
                    .map(|s| s.contains(window.label()))
                    .unwrap_or(false);
                if protected && !approved {
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), "request-window-close", ());
                } else if window.label() == "main" {
                    windows::persist(window);
                }
            }
        })
        .run(tauri::generate_context!());
    let migration = pending.lock().ok().and_then(|mut pending| pending.take());
    if let Err(error) = result {
        startup_failed(&error.to_string(), migration.as_ref());
    } else if migration.is_some() {
        startup_failed(
            "The editor closed before its first migration finished.",
            migration.as_ref(),
        );
    }
}

pub(crate) fn startup_failed(error: &str, pending: Option<&legacy_update::Pending>) {
    let message = if pending.is_some() {
        format!("The native update could not start. The previous editor will be restored after you close this message.\n\n{error}")
    } else {
        format!("AI Toolkit could not start.\n\n{error}")
    };
    webview_dependency::notify_error(&message);
    if let Some(pending) = pending {
        if let Err(recovery) = pending.launch_recovery() {
            webview_dependency::notify_error(&format!("Could not start automatic recovery. The previous editor backup remains in the release-updates cache.\n\n{recovery}"));
        }
    }
}

pub fn rollback_legacy(path: &std::path::Path) {
    if let Err(error) = legacy_update::recover(path) {
        let _ = std::fs::write(path.join("native-recovery-error.log"), &error);
        webview_dependency::notify_error(&format!("The previous editor could not be restored automatically. Its backup remains in the release-updates cache.\n\n{error}"));
    }
}

pub fn apply_update(path: &std::path::Path) -> Result<(), String> {
    updates::apply_update(path).map_err(|e| e.to_string())
}
