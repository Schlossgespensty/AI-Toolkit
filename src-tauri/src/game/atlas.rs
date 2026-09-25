use super::{
    gm1::{composite, Picture},
    hash, png_bytes, Result,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
pub struct Atlas {
    pub entries: Vec<Value>,
    pub pages: Vec<Vec<u8>>,
}
#[derive(Default)]
struct Layout {
    x: usize,
    y: usize,
    row: usize,
    width: usize,
    height: usize,
    indices: Vec<usize>,
}
impl Layout {
    fn new() -> Self {
        Self {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
            ..Default::default()
        }
    }
}
/// Shelf-packed atlas pages with stable input indices; no giant world bitmap.
pub fn pack(pictures: &[Option<Picture>]) -> Result<Atlas> {
    let mut entries = vec![Value::Null; pictures.len()];
    let mut order = (0..pictures.len())
        .filter(|i| pictures[*i].is_some())
        .collect::<Vec<_>>();
    order.sort_by_key(|i| {
        let p = pictures[*i].as_ref().unwrap();
        (std::cmp::Reverse(p.height), std::cmp::Reverse(p.width), *i)
    });
    let mut layouts = vec![Layout::new()];
    for i in order {
        let p = pictures[i].as_ref().unwrap();
        if p.width == 0 || p.height == 0 || p.width + 2 > 2048 || p.height + 2 > 4096 {
            return Err("Invalid atlas sprite dimensions".into());
        }
        let mut page = layouts.last_mut().unwrap();
        if page.x + p.width + 1 > 2048 {
            page.x = 1;
            page.y += page.row + 2;
            page.row = 0;
        }
        if page.y + p.height + 1 > 4096 {
            if layouts.len() >= 8 {
                return Err("Sprites exceed atlas page budget".into());
            }
            layouts.push(Layout::new());
        }
        let index = layouts.len() - 1;
        page = layouts.last_mut().unwrap();
        entries[i] = json!({"page":index,"x":page.x,"y":page.y,"width":p.width,"height":p.height,"dx":p.dx,"dy":p.dy});
        page.indices.push(i);
        page.width = page.width.max(page.x + p.width + 1);
        page.height = page.height.max(page.y + p.height + 1);
        page.x += p.width + 2;
        page.row = page.row.max(p.height);
    }
    let mut pages = Vec::new();
    for layout in layouts {
        let mut out = Picture::empty(layout.width, layout.height, 0, 0);
        for i in layout.indices {
            let e = &entries[i];
            composite(
                &mut out,
                pictures[i].as_ref().unwrap(),
                e["x"].as_i64().unwrap() as i32,
                e["y"].as_i64().unwrap() as i32,
            )
        }
        pages.push(png_bytes(out.width, out.height, &out.rgba)?)
    }
    Ok(Atlas { entries, pages })
}
pub fn json_atlas(pictures: &[Option<Picture>], cache: &Path) -> Result<Value> {
    let a = pack(pictures)?;
    let pages = a
        .pages
        .iter()
        .map(|b| cached_png(cache, b))
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({"entries":a.entries,"pages":pages}))
}
pub fn single_url(p: &Picture, cache: &Path) -> Result<String> {
    cached_png(cache, &png_bytes(p.width, p.height, &p.rgba)?)
}

/// The WebView loads the exact encoded pixels directly. Passing megabytes of
/// base64 through JSON would reallocate and parse every page on each map load.
/// Content-addressed names also keep already loaded images valid during a swap.
fn cached_png(cache: &Path, bytes: &[u8]) -> Result<String> {
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let destination = cache.join(format!("{}.png", hash(bytes)));
    if fs::metadata(&destination).map_or(true, |m| m.len() != bytes.len() as u64) {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let temporary = cache.join(format!(
            "{}.{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&temporary, &destination) {
            // A concurrent request may have written this identical page first.
            let _ = fs::remove_file(&temporary);
            if fs::metadata(&destination).map_or(true, |m| m.len() != bytes.len() as u64) {
                return Err(error.to_string());
            }
        }
    }
    url::Url::from_file_path(destination)
        .map(|v| v.to_string())
        .map_err(|_| "Invalid atlas cache path".into())
}

pub fn cached_pages_available(value: &Value) -> bool {
    let exists = |value: &Value| {
        value
            .as_str()
            .and_then(|s| url::Url::parse(s).ok())
            .and_then(|u| u.to_file_path().ok())
            .is_some_and(|p| p.is_file())
    };
    exists(&value["atlas"])
        && value["upper"]["pages"]
            .as_array()
            .is_some_and(|pages| pages.iter().all(exists))
        && value.get("cameras").is_none_or(|c| {
            c.as_array()
                .is_some_and(|cameras| cameras.iter().all(cached_pages_available))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_pages_preserve_png_bytes_and_reuse_content_identity() {
        let cache = std::env::temp_dir().join(format!("toolkit-atlas-test-{}", std::process::id()));
        let bytes = png_bytes(1, 1, &[17, 34, 51, 255]).unwrap();
        let first = cached_png(&cache, &bytes).unwrap();
        assert_eq!(first, cached_png(&cache, &bytes).unwrap());
        let path = url::Url::parse(&first).unwrap().to_file_path().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let value = json!({"atlas":first,"upper":{"pages":[first]}});
        assert!(cached_pages_available(&value));
        fs::remove_file(path).unwrap();
        fs::remove_dir(cache).unwrap();
        assert!(!cached_pages_available(&value));
    }
}
