use super::*;
use serde_json::Value;

fn page_write_times(value: &Value) -> Vec<(std::path::PathBuf, std::time::SystemTime)> {
    let mut pages = Vec::new();
    let mut record = |value: &Value| {
        let path = url::Url::parse(value.as_str().unwrap())
            .unwrap()
            .to_file_path()
            .unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        pages.push((path, modified));
    };
    record(&value["atlas"]);
    for page in value["upper"]["pages"].as_array().unwrap() {
        record(page);
    }
    pages
}

/// Explicit opt-in integration test: no game files or pixels are distributed as
/// fixtures. The reference is produced by the former Node reader on this user's
/// installation, and contains only metadata plus SHA-256 checksums.
#[test]
#[ignore = "requires an explicitly supplied local installation and Node parity reference"]
fn selected_installation_matches_reference() {
    let reference_path =
        std::env::var("AI_TOOLKIT_GAME_REFERENCE").expect("Set AI_TOOLKIT_GAME_REFERENCE");
    let reference: Value = serde_json::from_slice(&std::fs::read(reference_path).unwrap()).unwrap();
    let root = Path::new(reference["root"].as_str().unwrap());
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let cache = std::env::temp_dir().join("ai-toolkit-native-parity");
    for entry in reference["maps"].as_array().unwrap() {
        let path = Path::new(entry["path"].as_str().unwrap());
        let map = read_map(path, root).unwrap();
        assert_eq!(map["keeps"], entry["keeps"], "{} keeps", path.display());
        assert_eq!(
            map["pathTerrain"],
            entry["pathTerrain"],
            "{} path terrain",
            path.display()
        );
        let started = std::time::Instant::now();
        let atlas = load_map_tiles(path, root, &cache, resources).unwrap();
        let cold = started.elapsed();
        let initial_page_times = page_write_times(&atlas);
        let mut warm_ms = Vec::new();
        for _ in 0..5 {
            let started = std::time::Instant::now();
            let cached = load_map_tiles(path, root, &cache, resources).unwrap();
            warm_ms.push(started.elapsed().as_secs_f64() * 1000.);
            assert_eq!(
                cached, atlas,
                "Warm cache must preserve the full map payload"
            );
            assert_eq!(
                page_write_times(&cached),
                initial_page_times,
                "Warm cache must not rewrite PNG pages"
            );
        }
        assert!(super::atlas::cached_pages_available(&atlas));
        eprintln!(
            "Map load {}: initial {:.1}ms; warm {:?}ms; payload {} bytes",
            path.display(),
            cold.as_secs_f64() * 1000.,
            warm_ms,
            serde_json::to_vec(&atlas).unwrap().len()
        );
        for field in [
            "pictureLayout",
            "atlasBreite",
            "atlasHoehe",
            "kacheln",
            "fehlend",
            "treeSprites",
            "plaetze",
            "hoehen",
        ] {
            assert_eq!(atlas[field], entry[field], "{} {field}", path.display());
        }
        eprintln!(
            "Verified {}: {} tiles, {} trees",
            path.display(),
            atlas["kacheln"],
            atlas["treeSprites"].as_array().unwrap().len()
        );
    }
    let costs = read_exe_costs(root).unwrap();
    if let Some(native) = reference.get("native") {
        let path = Path::new(native["path"].as_str().unwrap());
        let native_cache = Path::new(native["cacheRoot"].as_str().unwrap());
        super::native_cache::read_capture(root, &read(path).unwrap(), native_cache)
            .expect("Native capture provenance");
        let atlas = load_map_tiles(path, root, native_cache, resources).unwrap();
        assert_eq!(
            atlas["nativeRenderer"], true,
            "Native cache must pass provenance validation"
        );
        assert_eq!(atlas["pictureLayout"], "capture");
        for (index, camera) in atlas["cameras"].as_array().unwrap().iter().enumerate() {
            for field in [
                "atlasBreite",
                "atlasHoehe",
                "kacheln",
                "fehlend",
                "treeSprites",
                "plaetze",
                "hoehen",
                "cliffSprites",
            ] {
                assert_eq!(
                    camera[field], native["cameras"][index][field],
                    "native camera {index} {field}"
                );
            }
        }
        eprintln!(
            "Verified all four cached native GreekSea cameras with source fingerprint validation"
        );
    }
    assert_eq!(costs["buildings"], reference["costs"]);
    let buildings = load_building_assets(root, &cache.join("buildings"), resources).unwrap();
    assert!(
        buildings["assetWarnings"].as_array().unwrap().is_empty(),
        "{:?}",
        buildings["assetWarnings"]
    );
    fn check_assets(v: &Value) {
        match v {
            Value::Object(o) => {
                if let Some(file) = o
                    .get("bild")
                    .and_then(Value::as_str)
                    .filter(|s| s.ends_with(".png"))
                {
                    assert!(
                        file.starts_with("file:"),
                        "Bundled game-art reference remains: {file}"
                    );
                }
                for v in o.values() {
                    check_assets(v)
                }
            }
            Value::Array(a) => {
                for v in a {
                    check_assets(v)
                }
            }
            _ => {}
        }
    }
    check_assets(&buildings);
    let units = load_unit_sprites(root, &cache.join("units")).unwrap();
    assert_eq!(units.sprites.len(), 21);
    assert_eq!(units.idle_sprites.len(), 22);
    assert!(units.warnings.is_empty());
    assert_eq!(
        read_resource_icons(root)
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        11
    );
}
