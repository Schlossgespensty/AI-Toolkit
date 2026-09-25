//! Native window lifecycle shared by the main and additional editor windows.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{
    webview::NewWindowResponse, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, Window,
};

/// Electron-compatible logical outer bounds, retained while maximized or minimized.
#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Bounds {
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Default)]
pub struct WindowState {
    bounds: Mutex<Option<Bounds>>,
    viewport_owners: Mutex<HashMap<String, String>>,
}

impl Bounds {
    fn fit(self, area: Self) -> Self {
        let width = self.width.clamp(800.0, area.width.max(800.0));
        let height = self.height.clamp(600.0, area.height.max(600.0));
        Self {
            x: self
                .x
                .clamp(area.x, (area.x + area.width - width).max(area.x)),
            y: self
                .y
                .clamp(area.y, (area.y + area.height - height).max(area.y)),
            width,
            height,
        }
    }
    fn overlaps(self, area: Self) -> bool {
        self.x < area.x + area.width
            && self.x + self.width > area.x
            && self.y < area.y + area.height
            && self.y + self.height > area.y
    }
}

pub fn restore(app: &AppHandle, window: &WebviewWindow) -> crate::storage::Result<()> {
    let saved = crate::storage::settings(app)?;
    if let Ok(mut bounds) = serde_json::from_value::<Bounds>(saved["mainWindow"]["bounds"].clone())
    {
        let areas: Vec<_> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|monitor| {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                Bounds {
                    x: area.position.x as f64 / scale,
                    y: area.position.y as f64 / scale,
                    width: area.size.width as f64 / scale,
                    height: area.size.height as f64 / scale,
                }
            })
            .collect();
        if let Some(area) = areas
            .iter()
            .find(|area| bounds.overlaps(**area))
            .or(areas.first())
        {
            bounds = bounds.fit(*area);
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let border = window
            .outer_size()
            .ok()
            .zip(window.inner_size().ok())
            .map(|(outer, inner)| {
                (
                    (outer.width.saturating_sub(inner.width)) as f64 / scale,
                    (outer.height.saturating_sub(inner.height)) as f64 / scale,
                )
            })
            .unwrap_or_default();
        let _ = window.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y));
        let _ = window.set_size(tauri::LogicalSize::new(
            bounds.width - border.0,
            bounds.height - border.1,
        ));
        *app.state::<WindowState>().bounds.lock().unwrap() = Some(bounds);
    }
    if saved["mainWindow"]["maximized"].as_bool() == Some(true) {
        let _ = window.maximize();
    }
    Ok(())
}

pub fn remember(window: &Window) {
    if window.label() != "main"
        || window.is_maximized().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    if let (Ok(position), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) {
        if let Ok(mut normal) = window.state::<WindowState>().bounds.lock() {
            *normal = Some(Bounds {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            });
        }
    }
}

pub fn persist(window: &Window) {
    remember(window);
    if let Ok(bounds) = window.state::<WindowState>().bounds.lock() {
        let _ = crate::storage::update_settings(
            window.app_handle(),
            "mainWindow",
            serde_json::json!({"bounds": *bounds, "maximized": window.is_maximized().unwrap_or(false)}),
        );
    }
}

static WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn release_viewports(owners: &mut HashMap<String, String>, closed: &str) -> Vec<String> {
    let mut children = Vec::new();
    owners.retain(|child, owner| {
        if owner == closed {
            children.push(child.clone());
        }
        child != closed && owner != closed
    });
    children
}

pub fn destroyed(window: &Window) {
    let state = window.state::<WindowState>();
    let children = release_viewports(&mut state.viewport_owners.lock().unwrap(), window.label());
    for label in children {
        if let Some(child) = window.app_handle().get_webview_window(&label) {
            let _ = child.close();
        }
    }
}

pub fn create(app: &AppHandle, main: bool) -> tauri::Result<WebviewWindow> {
    let mut config = app.config().app.windows[0].clone();
    // Windows editor controls live in the existing menu/tab row. Keep the
    // framework's resizable window, but omit its second native title bar.
    // Other platforms and detached viewports retain their native controls.
    #[cfg(windows)]
    {
        config.decorations = false;
    }
    if !main {
        config.label = format!("editor-{}", WINDOW_ID.fetch_add(1, Ordering::Relaxed));
        config.url = tauri::WebviewUrl::App("src/index.html?restoreProject=0".into());
    }
    let owner = app.clone();
    let owner_label = config.label.clone();
    let user_data = crate::storage::user_data(app).map_err(std::io::Error::other)?;
    let migration = crate::migration::initialization(&user_data);
    WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(user_data.join("WebView"))
        .initialization_script(&migration)
        .on_new_window(move |url, features| {
            // The detached view reuses the live canvas through a same-origin
            // blank child. Remote pages must never become privileged windows.
            if url.as_str() != "about:blank" {
                return NewWindowResponse::Deny;
            }
            let label = format!("viewport-{}", WINDOW_ID.fetch_add(1, Ordering::Relaxed));
            match WebviewWindowBuilder::new(&owner, &label, tauri::WebviewUrl::External(url))
                .window_features(features)
                .initialization_script(include_str!("viewport-close.js"))
                .title("AI Toolkit")
                .on_document_title_changed(|window, title| {
                    let _ = window.set_title(&title);
                })
                .build()
            {
                Ok(window) => {
                    owner
                        .state::<WindowState>()
                        .viewport_owners
                        .lock()
                        .unwrap()
                        .insert(label, owner_label.clone());
                    NewWindowResponse::Create { window }
                }
                Err(_) => NewWindowResponse::Deny,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn viewport_cleanup_only_closes_children_of_the_destroyed_editor() {
        let mut owners = HashMap::from([
            ("viewport-1".into(), "main".into()),
            ("viewport-2".into(), "editor-3".into()),
            ("viewport-4".into(), "main".into()),
        ]);
        assert!(release_viewports(&mut owners, "viewport-1").is_empty());
        assert_eq!(release_viewports(&mut owners, "main"), ["viewport-4"]);
        assert_eq!(
            owners.get("viewport-2").map(String::as_str),
            Some("editor-3")
        );
        assert!(release_viewports(&mut owners, "main").is_empty());
        assert_eq!(release_viewports(&mut owners, "editor-3"), ["viewport-2"]);
        assert!(owners.is_empty());
    }
    #[test]
    fn restores_visible_bounds_after_monitor_removal() {
        let desktop = Bounds {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1040.0,
        };
        let old = Bounds {
            x: -2560.0,
            y: 600.0,
            width: 2400.0,
            height: 1400.0,
        };
        assert!(!old.overlaps(desktop));
        let restored = old.fit(desktop);
        assert_eq!(
            (restored.x, restored.y, restored.width, restored.height),
            (0.0, 0.0, 1920.0, 1040.0)
        );
    }
}
