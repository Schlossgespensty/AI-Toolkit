//! Read-only compatibility with former engine captures. A cache miss does not
//! install a helper, modify a game file, start a process or touch a live game.
use super::{hash, read, Result};
use serde_json::Value;
use std::{fs, path::Path, time::UNIX_EPOCH};
const FORMAT: &str = "ai-toolkit-native-map-v1";
const MODULE: &str = "ai-toolkit-native-map-renderer-0.1.0";
pub struct Capture {
    pub heights: Vec<u8>,
    pub base_heights: Vec<u8>,
    pub cameras: Vec<(Vec<u8>, Vec<u8>)>,
    pub revision: String,
}
fn source_fingerprint(root: &Path) -> Result<(String, String)> {
    let engine = hash(&read(&root.join("Stronghold Crusader.exe"))?);
    if ![
        "3bb0a8c1e72331b3a30a5aa93ed94beca0081b476b04c1960e26d5b45387ac5a",
        "0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34",
    ]
    .contains(&engine.as_str())
    {
        return Err("No compatible cached camera views for this game executable".into());
    }
    let mut sources = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.to_lowercase().ends_with(".dll"))
        .collect::<Vec<_>>();
    // The historical capture fingerprint used the directory enumeration order
    // for DLLs (unlike its sorted GM1 list). Preserve that exact contract.
    for name in [
        "cr.tex",
        "faces.bmp",
        "extremeTrail.csv",
        "ucp/code.zip",
        "ucp/ucp-version.yml",
        "ucp/modules/winProcHandler-1.0.0.zip",
        "ucp/modules/graphicsApiReplacer-1.3.0.zip",
    ] {
        sources.push(name.into())
    }
    let mut hashes = vec![engine.clone()];
    for source in sources {
        hashes.push(format!("{source}:{}", hash(&read(&root.join(&source))?)));
    }
    for (name, bytes) in [
        (
            "definition.yml",
            include_bytes!("../../../integrations/native-map-renderer/definition.yml").as_slice(),
        ),
        (
            "init.lua",
            include_bytes!("../../../integrations/native-map-renderer/init.lua").as_slice(),
        ),
    ] {
        hashes.push(format!("ucp/modules/{MODULE}/{name}:{}", hash(bytes)));
    }
    let mut files = fs::read_dir(root.join("gm"))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<_>>();
    files.sort_by_key(|e| e.file_name());
    for file in files {
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            continue;
        }
        let time = metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?;
        let milliseconds = time.as_secs() as f64 * 1000. + time.subsec_nanos() as f64 / 1_000_000.;
        hashes.push(format!(
            "gm/{}:{}:{}",
            file.file_name().to_string_lossy(),
            metadata.len(),
            milliseconds
        ));
    }
    Ok((engine, hash(hashes.join("\n").as_bytes())))
}
pub fn read_capture(root: &Path, map_bytes: &[u8], cache_root: &Path) -> Result<Capture> {
    let request: Value = serde_json::from_slice(&read(&cache_root.join("completed-request.json"))?)
        .map_err(|e| e.to_string())?;
    let map_hash = hash(map_bytes);
    // Most map selections do not match the one historical engine capture.
    // Reject those before hashing the executable and every runtime dependency.
    if request["format"] != FORMAT || request["mapHash"] != map_hash {
        return Err("No cached camera views for this map".into());
    }
    let (engine, source) = source_fingerprint(root)?;
    if request["sourceHash"] != source || request["engineHash"] != engine {
        return Err(format!("Cached camera views are outdated; using saved map terrain (map {}, engine {}, source {})",
            request["mapHash"] == map_hash, request["engineHash"] == engine, source));
    }
    let result: Value = serde_json::from_slice(&read(&cache_root.join("renderer-result.json"))?)
        .map_err(|e| e.to_string())?;
    if result["format"] != FORMAT
        || result["id"] != request["id"]
        || result["mapHash"] != map_hash
        || result["engineHash"] != engine
        || result["complete"] != true
        || result.get("error").is_some_and(|v| !v.is_null())
    {
        return Err("Cached camera result does not match this map and executable".into());
    }
    let layer = |name: &str, size: u64| -> Result<Vec<u8>> {
        let path = cache_root.join(name);
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != size {
            return Err(format!("Invalid native renderer layer: {name}"));
        }
        read(&path)
    };
    let heights = layer("height.bin", 80400)?;
    let base_heights = layer("base-height.bin", 80400)?;
    let cameras = [0, 2, 4, 6]
        .into_iter()
        .map(|orientation| {
            Ok((
                layer(&format!("camera-{orientation}-gfx.bin"), 160800)?,
                layer(&format!("camera-{orientation}-pillar.bin"), 160800)?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut identity = source.into_bytes();
    identity.extend(&heights);
    identity.extend(&base_heights);
    for (gfx, pillars) in &cameras {
        identity.extend(gfx);
        identity.extend(pillars)
    }
    Ok(Capture {
        heights,
        base_heights,
        cameras,
        revision: hash(&identity),
    })
}
