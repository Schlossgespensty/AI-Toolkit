//! Classic marker previews extracted locally. Keep the source mapping together;
//! mounted units compose their matching rider layer without image resizing.
use super::{
    gm1::{composite, Gm1, Picture},
    graphics::resolve_graphics,
    hash, png_bytes, read, u32le, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
#[path = "unit_poses.rs"]
mod poses;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UnitSprite {
    pub path: PathBuf,
    pub width: usize,
    pub height: usize,
    pub dx: i32,
    pub dy: i32,
    pub source: String,
    pub frame: usize,
    pub player_palette: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UnitAssets {
    pub asset_revision: String,
    pub sprites: BTreeMap<String, UnitSprite>,
    pub idle_sprites: BTreeMap<String, UnitSprite>,
    pub warnings: Vec<String>,
}
const SOURCES: &[(u16, &str, Option<&str>)] = &[
    (1, "body_siege_engineer", None),
    (2, "body_mangonel", None),
    (3, "body_ballista", None),
    (4, "body_trebutchet", None),
    (5, "body_arab_ballista", None),
    (6, "body_archer", None),
    (7, "body_crossbowman", None),
    (8, "body_spearman", None),
    (9, "body_pikeman", None),
    (10, "body_maceman", None),
    (11, "body_swordsman", None),
    (12, "body_knight", Some("body_knight_top")),
    (13, "body_arab_slave", None),
    (14, "body_arab_slinger", None),
    (15, "body_arab_assasin", None),
    (16, "body_arab_shortbow", None),
    (17, "body_horse_archer", Some("body_horse_archer_top")),
    (18, "body_arab_swordsman", None),
    (19, "body_arab_grenadier", None),
    (20, "body_brazier", None),
    (21, "anim_flag_small", None),
];
// Body GM1 palettes 1..=8 are the player colour tables. Palette 0 is the
// authoring palette and can contain diagnostic magenta/cyan colours; it is
// not a neutral player. Use the first game's player colour consistently.
const PREVIEW_PLAYER_PALETTE: usize = 1;
fn decode(gm: &Gm1, frame: usize) -> Result<Picture> {
    let mut p = gm.sprite(
        frame,
        if gm.kind == 2 {
            Some(PREVIEW_PLAYER_PALETTE)
        } else {
            None
        },
    )?;
    p.dx = -(u32le(&gm.bytes, 0x48)? as i32);
    p.dy = -(u32le(&gm.bytes, 0x4c)? as i32);
    Ok(p)
}
fn compose(base: Picture, top: Picture) -> Picture {
    let left = base.dx.min(top.dx);
    let upper = base.dy.min(top.dy);
    let width = (base.dx + base.width as i32).max(top.dx + top.width as i32) - left;
    let height = (base.dy + base.height as i32).max(top.dy + top.height as i32) - upper;
    let mut out = Picture::empty(width as usize, height as usize, left, upper);
    composite(&mut out, &base, base.dx - left, base.dy - upper);
    composite(&mut out, &top, top.dx - left, top.dy - upper);
    out
}
fn trim(p: Picture) -> Picture {
    let (mut left, mut top, mut right, mut bottom) = (p.width, p.height, 0, 0);
    for y in 0..p.height {
        for x in 0..p.width {
            if p.rgba[(y * p.width + x) * 4 + 3] != 0 {
                left = left.min(x);
                top = top.min(y);
                right = right.max(x + 1);
                bottom = bottom.max(y + 1);
            }
        }
    }
    if right == 0 {
        return p;
    }
    let mut out = Picture::empty(
        right - left,
        bottom - top,
        p.dx + left as i32,
        p.dy + top as i32,
    );
    composite(&mut out, &p, -(left as i32), -(top as i32));
    out
}
pub fn load_unit_sprites(root: &Path, cache_root: &Path) -> Result<UnitAssets> {
    super::cache::extract(cache_root, || extract_unit_sprites(root, cache_root))
}
fn extract_unit_sprites(root: &Path, cache_root: &Path) -> Result<UnitAssets> {
    let graphics = resolve_graphics(root)?;
    let revision = hash(
        format!(
            "unit-previews-v3:{}:{}",
            graphics.revision,
            include_str!("unit_poses.rs")
        )
        .as_bytes(),
    );
    fs::create_dir_all(cache_root).map_err(|e| e.to_string())?;
    let cache = cache_root.join(format!("{revision}.json"));
    if let Ok(bytes) = read(&cache) {
        if let Ok(v) = serde_json::from_slice::<UnitAssets>(&bytes) {
            if v.sprites
                .values()
                .chain(v.idle_sprites.values())
                .all(|p| p.path.is_file())
            {
                return Ok(v);
            }
        }
    }
    let mut sprites: BTreeMap<String, UnitSprite> = BTreeMap::new();
    let mut idle_sprites = BTreeMap::new();
    let mut warnings = Vec::new();
    let sources =
        SOURCES
            .iter()
            .map(|&(id, name, rider)| (id.to_string(), name, rider, Some(0), poses::idle_pose(id)))
            .chain(poses::LORD_POSES.iter().map(|&(key, name, frame)| {
                (key.to_owned(), name, None, None, Some((frame, None)))
            }));
    for (key, name, rider, thumbnail, idle_pose) in sources {
        // Thumbnail and idle pose share the same file/palette decode. Mounted
        // troops also share their rider file; never read it once per output.
        let sources = (|| {
            Ok::<_, String>((
                Gm1::read(&graphics.file(name))?,
                rider
                    .map(|name| Gm1::read(&graphics.file(name)))
                    .transpose()?,
            ))
        })();
        let (body, top) = match sources {
            Ok(sources) => sources,
            Err(error) => {
                warnings.push(format!("{name}: {error}"));
                continue;
            }
        };
        for (idle, frame, rider_frame) in thumbnail
            .map(|frame| (false, frame, rider.map(|_| 0)))
            .into_iter()
            .chain(idle_pose.map(|(frame, rider)| (true, frame, rider)))
        {
            // Stationary objects can use the same phase as their thumbnail.
            // Share its native anchor and PNG instead of decoding it twice.
            if idle && frame == 0 && rider_frame == rider.map(|_| 0) {
                if let Some(sprite) = sprites.get(&key) {
                    idle_sprites.insert(key.clone(), sprite.clone());
                    continue;
                }
            }
            let decoded = (|| {
                let mut p = decode(&body, frame)?;
                if let (Some(top), Some(frame)) = (top.as_ref(), rider_frame) {
                    p = compose(p, decode(top, frame)?)
                }
                Ok::<_, String>(trim(p))
            })();
            match decoded {
                Ok(p) => {
                    let path = cache_root.join(format!("{revision}-{key}-{frame}.png"));
                    fs::write(&path, png_bytes(p.width, p.height, &p.rgba)?)
                        .map_err(|e| e.to_string())?;
                    let target = if idle {
                        &mut idle_sprites
                    } else {
                        &mut sprites
                    };
                    target.insert(
                        key.clone(),
                        UnitSprite {
                            path,
                            width: p.width,
                            height: p.height,
                            dx: p.dx,
                            dy: p.dy,
                            source: name.into(),
                            frame,
                            player_palette: PREVIEW_PLAYER_PALETTE,
                        },
                    );
                }
                Err(e) => warnings.push(format!("{name}: {e}")),
            }
        }
    }
    let value = UnitAssets {
        asset_revision: revision,
        sprites,
        idle_sprites,
        warnings,
    };
    fs::write(
        cache,
        serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "toolkit-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("gm")).unwrap();
        root
    }

    fn indexed_body(frames: usize) -> Vec<u8> {
        let offsets = 88 + 5120;
        let sizes = offsets + frames * 4;
        let heads = sizes + frames * 4;
        let data_at = heads + frames * 16;
        let mut bytes = vec![0; data_at + frames * 2];
        bytes[12..16].copy_from_slice(&(frames as u32).to_le_bytes());
        bytes[20..24].copy_from_slice(&2u32.to_le_bytes());
        bytes[72..76].copy_from_slice(&10u32.to_le_bytes());
        bytes[76..80].copy_from_slice(&20u32.to_le_bytes());
        for i in 0..frames {
            let palette = 88 + 512 + (i + 1) * 2;
            bytes[palette..palette + 2].copy_from_slice(&((i as u16 + 1) * 5).to_le_bytes());
            bytes[offsets + i * 4..offsets + i * 4 + 4]
                .copy_from_slice(&(i as u32 * 2).to_le_bytes());
            bytes[sizes + i * 4..sizes + i * 4 + 4].copy_from_slice(&2u32.to_le_bytes());
            bytes[heads + i * 16..heads + i * 16 + 2].copy_from_slice(&1u16.to_le_bytes());
            bytes[heads + i * 16 + 2..heads + i * 16 + 4].copy_from_slice(&1u16.to_le_bytes());
            bytes[data_at + i * 2..data_at + i * 2 + 2].copy_from_slice(&[0, i as u8 + 1]);
        }
        bytes
    }

    #[test]
    fn stationary_markers_extract_verified_frames_and_reuse_shared_pngs() {
        let root = fixture("stationary");
        let ids = [(2, 0), (3, 4), (4, 4), (5, 4), (20, 0), (21, 0)];
        for &(id, frame) in &ids {
            let (_, name, _) = SOURCES.iter().find(|(marker, _, _)| *marker == id).unwrap();
            fs::write(
                root.join("gm").join(format!("{name}.gm1")),
                indexed_body(frame + 1),
            )
            .unwrap();
        }
        let cache = root.join("cache");
        let assets = load_unit_sprites(&root, &cache).unwrap();
        assert_eq!(assets.idle_sprites.len(), ids.len());
        for (id, frame) in ids {
            let idle = &assets.idle_sprites[&id.to_string()];
            let thumbnail = &assets.sprites[&id.to_string()];
            assert_eq!(
                (idle.frame, idle.width, idle.height, idle.dx, idle.dy),
                (frame, 1, 1, -10, -20)
            );
            if frame == 0 {
                assert_eq!(
                    idle, thumbnail,
                    "Stationary first phases must reuse thumbnail output"
                );
            } else {
                assert_ne!(
                    fs::read(&idle.path).unwrap(),
                    fs::read(&thumbnail.path).unwrap()
                );
            }
        }
        let timestamps: Vec<_> = fs::read_dir(&cache)
            .unwrap()
            .map(|entry| {
                let file = entry.unwrap().path();
                let modified = fs::metadata(&file).unwrap().modified().unwrap();
                (file, modified)
            })
            .collect();
        assert_eq!(load_unit_sprites(&root, &cache).unwrap(), assets);
        for (file, modified) in timestamps {
            assert_eq!(fs::metadata(file).unwrap().modified().unwrap(), modified);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lord_variants_have_distinct_verified_idle_frames_and_no_palette_markers() {
        let root = fixture("lords");
        for &(key, name, frame) in poses::LORD_POSES {
            let body = indexed_body(frame + 1);
            fs::write(root.join("gm").join(format!("{name}.gm1")), &body).unwrap();
            assert!(key.starts_with("lord-"));
        }
        let assets = load_unit_sprites(&root, &root.join("cache")).unwrap();
        assert!(
            assets.sprites.is_empty(),
            "Lords are not placeable AIV markers"
        );
        assert_eq!(assets.idle_sprites.len(), 2);
        for (key, name, frame) in [
            ("lord-europ", "body_lord", 168),
            ("lord-arab", "body_saladin", 40),
        ] {
            let pose = &assets.idle_sprites[key];
            assert_eq!((pose.source.as_str(), pose.frame), (name, frame));
            assert_eq!(
                (pose.width, pose.height, pose.dx, pose.dy),
                (1, 1, -10, -20)
            );
            assert_eq!(pose.player_palette, PREVIEW_PLAYER_PALETTE);
            let body = Gm1::read(&root.join("gm").join(format!("{name}.gm1"))).unwrap();
            let expected = decode(&body, frame).unwrap();
            assert_eq!(
                fs::read(&pose.path).unwrap(),
                png_bytes(expected.width, expected.height, &expected.rgba).unwrap()
            );
            assert_ne!(expected.rgba, decode(&body, 0).unwrap().rgba);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trimming_preserves_scale_and_origin() {
        let mut p = Picture::empty(4, 4, -2, -3);
        p.rgba[(1 * 4 + 2) * 4..(1 * 4 + 2) * 4 + 4].copy_from_slice(&[1, 2, 3, 255]);
        let p = trim(p);
        assert_eq!((p.width, p.height, p.dx, p.dy), (1, 1, 0, -2));
        assert_eq!(p.rgba, [1, 2, 3, 255]);
    }

    #[test]
    fn body_preview_uses_player_palette_not_authoring_palette() {
        // One indexed pixel with deliberately distinct authoring/player
        // colours verifies the actual file decoder's palette selection.
        let data_at = 88 + 5120 + 4 + 4 + 16;
        let mut bytes = vec![0u8; data_at + 2];
        bytes[12..16].copy_from_slice(&1u32.to_le_bytes());
        bytes[20..24].copy_from_slice(&2u32.to_le_bytes());
        bytes[88 + 2..88 + 4].copy_from_slice(&0x7c1fu16.to_le_bytes());
        bytes[88 + 512 + 2..88 + 512 + 4].copy_from_slice(&0x001fu16.to_le_bytes());
        bytes[88 + 5120 + 4..88 + 5120 + 8].copy_from_slice(&2u32.to_le_bytes());
        bytes[88 + 5120 + 8..88 + 5120 + 10].copy_from_slice(&1u16.to_le_bytes());
        bytes[88 + 5120 + 10..88 + 5120 + 12].copy_from_slice(&1u16.to_le_bytes());
        bytes[data_at..].copy_from_slice(&[0, 1]);
        let path =
            std::env::temp_dir().join(format!("toolkit-unit-palette-{}.gm1", std::process::id()));
        fs::write(&path, bytes).unwrap();
        let result = Gm1::read(&path).and_then(|gm| decode(&gm, 0));
        fs::remove_file(path).unwrap();
        assert_eq!(result.unwrap().rgba, [0, 0, 255, 255]);
    }
}
