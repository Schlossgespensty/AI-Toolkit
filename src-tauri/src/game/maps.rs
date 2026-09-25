//! Classic .map reader and sprite atlas. Decodes saved terrain without running
//! the game; preserves 400x400 raster and the existing renderer bridge schema.
use super::{
    atlas, b64,
    gm1::{composite, diamond, upper, Gm1, Picture},
    graphics::{resolve_graphics, Graphics},
    hash, png_url, read, u16le, u32le, Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};
const TILES: usize = 80400;
const EDGE: usize = 400;
const MAX_BYTES: usize = 32 * 1024 * 1024;
fn row_range(y: i32) -> (i32, i32) {
    if y <= 199 {
        (199 - y, 200 + y)
    } else {
        (y - 200, 599 - y)
    }
}
fn tile_index(x: i32, y: i32) -> usize {
    (if y <= 199 {
        y * y + 2 * y - 199
    } else {
        let k = y - 200;
        40200 + 400 * k - k * k
    } + x) as usize
}
fn valid_tile(x: i32, y: i32) -> bool {
    if !(0..400).contains(&y) {
        return false;
    }
    let (a, b) = row_range(y);
    x >= a && x <= b
}
fn keep_orientation(x: i32, y: i32) -> i32 {
    let dx = (x - 200).abs();
    let dy = (y - 200).abs();
    let o = if dy * 2 < dx {
        if x > 200 {
            6
        } else {
            2
        }
    } else if dx * 2 < dy {
        if y > 200 {
            0
        } else {
            4
        }
    } else if y > 200 {
        if x <= 200 {
            1
        } else {
            7
        }
    } else if y < 200 {
        if x > 200 {
            5
        } else {
            3
        }
    } else {
        0
    };
    match o & !1 {
        2 => 6,
        6 => 2,
        n => n,
    }
}
fn packed(block: &[u8], expected: usize) -> Result<Vec<u8>> {
    let length = u32le(block, 0)? as usize;
    let count = u32le(block, 4)? as usize;
    let wanted = if length == 0 { expected } else { length };
    if wanted > MAX_BYTES {
        return Err("Map section exceeds size limit".into());
    }
    let data = block
        .get(12..12usize.checked_add(count).ok_or("Map section overflow")?)
        .ok_or("Truncated packed map section")?;
    let mut reader = explode::ExplodeReader::new(data).take((wanted + 1) as u64);
    let mut out = Vec::with_capacity(wanted);
    reader.read_to_end(&mut out).map_err(|e| e.to_string())?;
    if out.len() != wanted {
        return Err(format!(
            "Map section unpacked to {} bytes instead of {wanted}",
            out.len()
        ));
    }
    Ok(out)
}
struct MapFile {
    bytes: Vec<u8>,
    directory: usize,
    count: usize,
    preview: Vec<u8>,
}
impl MapFile {
    fn read(path: &Path) -> Result<Self> {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BYTES as u64 {
            return Err("Map exceeds size limit".into());
        }
        let bytes = read(path)?;
        if u32le(&bytes, 0)? != u32::MAX {
            return Err("Not a Stronghold map".into());
        }
        let end = 8 + u32le(&bytes, 4)? as usize;
        let preview = packed(bytes.get(8..end).ok_or("Truncated map preview")?, 40512)?;
        let mut directory = None;
        for at in end..bytes.len().saturating_sub(16) {
            if u32le(&bytes, at)? != 3036 {
                continue;
            }
            let count = u32le(&bytes, at + 8)? as usize;
            if (1..=150).contains(&count)
                && at + 3036 + u32le(&bytes, at + 4)? as usize == bytes.len()
            {
                directory = Some((at, count));
                break;
            }
        }
        let (directory, count) = directory.ok_or("Map has no valid section directory")?;
        Ok(Self {
            bytes,
            directory,
            count,
            preview,
        })
    }
    fn section(&self, id: u32) -> Result<Option<Vec<u8>>> {
        let d = self.directory;
        for i in 0..self.count {
            if u32le(&self.bytes, d + 1232 + i * 4)? != id {
                continue;
            }
            let length = u32le(&self.bytes, d + 632 + i * 4)? as usize;
            let offset = u32le(&self.bytes, d + 2432 + i * 4)? as usize;
            let block = self
                .bytes
                .get(d + 3036 + offset..d + 3036 + offset + length)
                .ok_or("Truncated map section")?;
            return Ok(Some(if u32le(&self.bytes, d + 1832 + i * 4)? != 0 {
                packed(block, TILES)?
            } else {
                block.to_vec()
            }));
        }
        Ok(None)
    }
    fn preview_url(&self) -> Result<String> {
        if self.preview.len() != 40512 {
            return Err("Invalid map preview".into());
        }
        let mut rgba = vec![0; 200 * 200 * 4];
        for i in 0..40000 {
            let c = u16le(&self.preview, self.preview[512 + i] as usize * 2)?;
            rgba[i * 4] = ((((c >> 10) & 31) as f64 * 255. / 31.).round()) as u8;
            rgba[i * 4 + 1] = ((((c >> 5) & 31) as f64 * 255. / 31.).round()) as u8;
            rgba[i * 4 + 2] = (((c & 31) as f64 * 255. / 31.).round()) as u8;
            rgba[i * 4 + 3] = 255;
        }
        png_url(200, 200, &rgba)
    }
    fn keeps(&self) -> Result<Vec<Value>> {
        let Some(layer) = self.section(1049)? else {
            return Ok(Vec::new());
        };
        if layer.len() < TILES {
            return Ok(Vec::new());
        }
        let is_type = |x, y, t| valid_tile(x, y) && layer[tile_index(x, y)] == t;
        let mut keeps = Vec::new();
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                if is_type(x, y, 41)
                    && !is_type(x - 1, y, 41)
                    && !is_type(x, y - 1, 41)
                    && (0..7).all(|dy| (0..7).all(|dx| is_type(x + dx, y + dy, 41)))
                {
                    keeps.push(
                        json!({"x":x,"y":y,"player":null,"orientation":keep_orientation(x,y)}),
                    );
                }
            }
        }
        if let Some(buildings) = self.section(1013)? {
            for row in buildings.chunks_exact(812) {
                if u16le(row, 210)? != 41 {
                    continue;
                }
                let owner = u16le(row, 214)?;
                if !(1..=8).contains(&owner) {
                    continue;
                }
                let x = u16le(row, 238)? as i64;
                let y = u16le(row, 240)? as i64;
                if let Some(keep) = keeps.iter_mut().find(|k| {
                    k["x"].as_i64() == Some(x)
                        && k["y"].as_i64() == Some(y)
                        && k["player"].is_null()
                }) {
                    keep["player"] = json!(owner);
                }
            }
        }
        if !keeps.is_empty() {
            let owners = keeps
                .iter()
                .filter_map(|k| k["player"].as_i64())
                .collect::<HashSet<_>>();
            if owners.len() == keeps.len() {
                keeps.sort_by_key(|k| k["player"].as_i64());
            }
            return Ok(keeps);
        }
        let mut seen = vec![false; TILES];
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                let i = tile_index(x, y);
                if seen[i] || !is_type(x, y, 52) {
                    continue;
                }
                seen[i] = true;
                let mut pending = vec![(x, y)];
                let mut group = Vec::new();
                while let Some((x, y)) = pending.pop() {
                    group.push((x, y));
                    for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                        if !is_type(nx, ny, 52) {
                            continue;
                        }
                        let ni = tile_index(nx, ny);
                        if !seen[ni] {
                            seen[ni] = true;
                            pending.push((nx, ny));
                        }
                    }
                }
                if group.len() == 4 {
                    let x = group.iter().map(|p| p.0).min().unwrap();
                    let y = group.iter().map(|p| p.1).min().unwrap();
                    keeps.push(json!({"x":x,"y":y,"player":null,"orientation":keep_orientation(x,y),"fromMarker":true}));
                }
            }
        }
        Ok(keeps)
    }
    fn path_terrain(&self) -> Result<Value> {
        let Some(logic) = self.section(1003)? else {
            return Ok(Value::Null);
        };
        if logic.len() != TILES * 4 {
            return Ok(Value::Null);
        }
        let organisms = self.section(1004)?;
        let heights = self.section(1045)?.or(self.section(1005)?);
        let mut blocked = vec![1; EDGE * EDGE];
        let mut hard = blocked.clone();
        let mut ground = vec![0; EDGE * EDGE];
        let mut lift = ground.clone();
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                let i = tile_index(x, y);
                let target = (y * 400 + x) as usize;
                let f = u32le(&logic, i * 4)?;
                let water = f & (1 | 1048576) != 0 && f & 2097152 == 0;
                let h = water || f & (16 | 32) != 0;
                let organism = organisms
                    .as_ref()
                    .map_or(0, |o| u16le(o, i * 2).unwrap_or(0));
                blocked[target] =
                    (h || f & (128 | 4096 | 8192 | 131072 | 524288) != 0 || organism != 0) as u8;
                hard[target] = h as u8;
                ground[target] = heights
                    .as_ref()
                    .and_then(|v| v.get(i))
                    .copied()
                    .unwrap_or(0);
                lift[target] = if f & 8 != 0 { 4 } else { 0 };
            }
        }
        Ok(
            json!({"version":4,"constructionLift":b64(&lift),"fingerprint":hash(&self.bytes),"blocked":b64(&blocked),"hardBlocked":b64(&hard),"heights":b64(&ground)}),
        )
    }
}
fn map_folders(root: &Path) -> Vec<PathBuf> {
    let mut folders = vec![root.join("maps")];
    if let Ok(entries) = fs::read_dir(root.join("ucp/plugins")) {
        for e in entries.flatten() {
            let path = e.path().join("resources/maps");
            if path.is_dir() {
                folders.push(path)
            }
        }
    }
    folders
}
pub fn list_game_maps(root: &Path) -> Result<Value> {
    if !root.is_dir() {
        return Ok(json!({"gameRoot":null,"maps":[]}));
    }
    let mut maps = Vec::new();
    for dir in map_folders(root) {
        if let Ok(entries) = fs::read_dir(&dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|s| s.eq_ignore_ascii_case("map")) && p.is_file() {
                    maps.push(json!({"name":p.file_stem().unwrap().to_string_lossy(),"path":p,"source":dir.parent().and_then(Path::file_name).map(|s|s.to_string_lossy())}));
                }
            }
        }
    }
    maps.sort_by_cached_key(|m| m["name"].as_str().unwrap_or("").to_lowercase());
    Ok(json!({"gameRoot":root,"maps":maps}))
}
fn known_map(path: &Path, root: &Path) -> Result<Value> {
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let listed = list_game_maps(root)?;
    listed["maps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| {
            m["path"]
                .as_str()
                .and_then(|p| fs::canonicalize(p).ok())
                .is_some_and(|p| p == canonical)
        })
        .cloned()
        .ok_or_else(|| "That map is not one of the selected game's maps".into())
}
pub fn read_map(path: &Path, root: &Path) -> Result<Value> {
    let mut value = known_map(path, root)?;
    let map = MapFile::read(path)?;
    value["edge"] = json!(200);
    value["dataUrl"] = json!(map.preview_url()?);
    value["keeps"] = json!(map.keeps()?);
    value["pathTerrain"] = map.path_terrain()?;
    Ok(value)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockEntry {
    gm_id: i32,
    name: String,
    count: usize,
    from: usize,
}
struct Stock {
    entries: Vec<StockEntry>,
    layout: &'static str,
}
impl Stock {
    fn picture(&self, value: u16) -> Option<(&str, usize)> {
        let wanted = (value as usize).checked_sub(1)?;
        self.entries
            .iter()
            .find(|e| e.count > 0 && wanted >= e.from && wanted - e.from < e.count)
            .map(|e| (e.name.as_str(), wanted - e.from))
    }
}
struct Files {
    graphics: Graphics,
    files: HashMap<String, Gm1>,
}
impl Files {
    fn file(&mut self, name: &str) -> Result<&Gm1> {
        if !self.files.contains_key(name) {
            let gm = Gm1::read(&self.graphics.file(name))?;
            self.files.insert(name.into(), gm);
        }
        Ok(&self.files[name])
    }
}
fn stock(gfx: &[u8], files: &mut Files, resources: &Path) -> Result<Stock> {
    let layout: Value =
        serde_json::from_slice(&read(&resources.join("config/map-picture-layout.json"))?)
            .map_err(|e| e.to_string())?;
    let classic: Vec<StockEntry> =
        serde_json::from_value(layout["files"].clone()).map_err(|e| e.to_string())?;
    let exe = read(&files.graphics.root.join("Stronghold Crusader.exe"))?;
    let list = super::virtual_offset(&exe, 0xb601c0)?;
    for e in &classic {
        let at = list + (e.gm_id as usize - 1) * 1000;
        let name = exe
            .get(at..at + 64)
            .ok_or("Truncated game picture name table")?;
        let name = &name[..name.iter().position(|b| *b == 0).unwrap_or(name.len())];
        if name != e.name.as_bytes() {
            return Err("Unsupported game picture-file layout".into());
        }
    }
    let original = Stock {
        entries: classic.clone(),
        layout: "classic",
    };
    let values = gfx
        .chunks_exact(2)
        .map(|v| u16::from_le_bytes([v[0], v[1]]))
        .filter(|v| *v != 0)
        .collect::<HashSet<_>>();
    let valid = |s: &Stock, files: &mut Files| {
        values.iter().all(|v| {
            s.picture(*v).is_some_and(|(name, index)| {
                files
                    .file(name)
                    .is_ok_and(|g| g.kind == 3 && index < g.entries.len())
            })
        })
    };
    if valid(&original, files) {
        return Ok(original);
    }
    let mut total = 0;
    let entries = classic
        .into_iter()
        .map(|mut e| {
            e.from = total;
            e.count = files.file(&e.name).map_or(0, |g| g.entries.len());
            total += e.count;
            e
        })
        .collect();
    let installed = Stock {
        entries,
        layout: "installed",
    };
    if valid(&installed, files) {
        Ok(installed)
    } else {
        Ok(original)
    }
}
#[derive(Clone)]
struct Tree {
    picture: usize,
    gm_id: i32,
    palette: i32,
    x: i32,
    y: i32,
    alive: bool,
}
fn trees(bytes: Option<Vec<u8>>) -> Result<Vec<Tree>> {
    let Some(bytes) = bytes else {
        return Ok(Vec::new());
    };
    if bytes.len() % 156 != 0 {
        return Ok(Vec::new());
    }
    bytes
        .chunks_exact(156)
        .map(|b| {
            let typ = u16le(b, 0x46)?;
            let rng = u32le(b, 0x88)?;
            let p = u32le(b, 0)?;
            let picture = if p != 0 {
                p
            } else {
                match typ {
                    16 => (rng & 7) + 10,
                    17 => ((rng & 3) + 1).min(3),
                    18 => ((rng & 3) + 4).min(6),
                    19 => ((rng & 3) + 7).min(9),
                    _ => 0,
                }
            };
            Ok(Tree {
                picture: picture as usize,
                gm_id: u16le(b, 4)? as i16 as i32,
                palette: u32le(b, 8)? as i32,
                x: u16le(b, 0xc)? as i16 as i32,
                y: u16le(b, 0xe)? as i16 as i32,
                alive: u16le(b, 0x44)? != 0,
            })
        })
        .collect()
}
fn raster(layer: &[u8]) -> Vec<u8> {
    let mut out = vec![0; EDGE * EDGE];
    for y in 0..400 {
        let (a, b) = row_range(y);
        for x in a..=b {
            out[(y * 400 + x) as usize] = layer.get(tile_index(x, y)).copied().unwrap_or(0);
        }
    }
    out
}
fn u16_bytes(values: &[u16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}
fn replace_keeps(gfx: &mut [u8], keeps: &[Value], desert: u16) {
    for keep in keeps.iter().filter(|k| k["fromMarker"] != true) {
        let kx = keep["x"].as_i64().unwrap() as i32;
        let ky = keep["y"].as_i64().unwrap() as i32;
        for (dx, dy, w, h) in [(0, 0, 7, 7), (2, 7, 3, 1), (0, 8, 7, 7), (7, 2, 5, 5)] {
            for y in ky + dy..ky + dy + h {
                for x in kx + dx..kx + dx + w {
                    if valid_tile(x, y) {
                        let at = tile_index(x, y) * 2;
                        gfx[at..at + 2].copy_from_slice(&desert.to_le_bytes());
                    }
                }
            }
        }
    }
}
fn build_atlas(
    gfx: &[u8],
    height: Option<&[u8]>,
    pillars: Option<&[u8]>,
    organisms: Option<&[u8]>,
    trees: &[Tree],
    stock: &Stock,
    files: &mut Files,
    atlas_cache: &Path,
) -> Result<Value> {
    let mut slots = HashMap::new();
    let mut values = Vec::new();
    for b in gfx.chunks_exact(2) {
        let value = u16::from_le_bytes([b[0], b[1]]);
        if value != 0 && !slots.contains_key(&value) {
            slots.insert(value, values.len());
            values.push(value);
        }
    }
    let width = 64 * 30;
    let rows = values.len().div_ceil(64).max(1);
    let mut ground = Picture::empty(width, rows * 16, 0, 0);
    let mut uppers = vec![None; values.len()];
    let mut missing = 0;
    for (i, value) in values.iter().enumerate() {
        let picture = stock.picture(*value).and_then(|(name, index)| {
            let gm = files.file(name).ok()?;
            if gm.kind != 3 {
                return None;
            }
            let (e, raw) = gm.raw(index).ok()?;
            Some((diamond(raw).ok()?, upper(e, raw).ok()?))
        });
        if let Some((p, up)) = picture {
            composite(
                &mut ground,
                &p,
                ((i % 64) * 30) as i32,
                ((i / 64) * 16) as i32,
            );
            uppers[i] = up;
        } else {
            missing += 1;
        }
    }
    let mut tile_slots = vec![u16::MAX; EDGE * EDGE];
    for y in 0..400 {
        let (a, b) = row_range(y);
        for x in a..=b {
            let value = u16le(gfx, tile_index(x, y) * 2)?;
            if let Some(i) = slots.get(&value) {
                tile_slots[(y * 400 + x) as usize] = *i as u16;
            }
        }
    }
    let mut cliffs = vec![0u16; EDGE * EDGE];
    let mut cliff_indices = HashMap::<String, usize>::new();
    if let Some(heights) = height.filter(|h| h.len() == TILES) {
        let at_height = |x, y, fallback| {
            if valid_tile(x, y) {
                heights[tile_index(x, y)]
            } else {
                fallback
            }
        };
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                let tile = tile_index(x, y);
                let lift = heights[tile];
                if lift == 0
                    || [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                        .iter()
                        .all(|(x, y)| at_height(*x, *y, lift) >= lift)
                {
                    continue;
                }
                let found = pillars
                    .filter(|p| p.len() == TILES * 2)
                    .and_then(|p| stock.picture(u16le(p, tile * 2).unwrap_or(0)));
                let (name, index) = found.unwrap_or(("tile_cliffs", 0));
                let key = format!("{name}:{index}:{lift}");
                let packed = if let Some(p) = cliff_indices.get(&key) {
                    *p
                } else {
                    let strip = files
                        .file(name)
                        .ok()
                        .and_then(|g| g.pillar(index, lift as usize).ok().flatten())
                        .or_else(|| {
                            files
                                .file("tile_cliffs")
                                .ok()
                                .and_then(|g| g.pillar(0, lift as usize).ok().flatten())
                        });
                    let Some(strip) = strip else { continue };
                    let p = uppers.len();
                    uppers.push(Some(strip));
                    cliff_indices.insert(key, p);
                    p
                };
                if packed >= u16::MAX as usize {
                    return Err("Too many cliff sprite variants".into());
                }
                cliffs[(y * 400 + x) as usize] = (packed + 1) as u16;
            }
        }
    }
    let mut tree_sprites = Vec::new();
    let mut tree_indices = HashMap::new();
    if let Some(organisms) = organisms.filter(|o| o.len() == TILES * 2) {
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                let id = u16le(organisms, tile_index(x, y) * 2)? as usize;
                if id == 0 || id >= 2000 {
                    continue;
                }
                let Some(t) = trees.get(id).filter(|t| t.alive && t.picture > 0) else {
                    continue;
                };
                let Some(file) = stock
                    .entries
                    .iter()
                    .find(|f| f.gm_id == t.gm_id && t.picture <= f.count)
                else {
                    continue;
                };
                let key = format!("{}/{}/{}", file.name, t.picture, t.palette);
                let index = if let Some(index) = tree_indices.get(&key) {
                    *index
                } else {
                    let gm = files.file(&file.name)?;
                    let entry = &gm.entries[t.picture - 1];
                    let palette = if (0..10).contains(&t.palette) {
                        t.palette as usize
                    } else {
                        entry.palette
                    };
                    let picture = gm.sprite(t.picture - 1, Some(palette))?;
                    let i = uppers.len();
                    uppers.push(Some(picture));
                    tree_indices.insert(key, i);
                    i
                };
                tree_sprites.push(json!([x, y, index, 14 - t.x, 6 - t.y]));
            }
        }
    }
    Ok(
        json!({"atlas":atlas::single_url(&ground,atlas_cache)?,"atlasBreite":width,"atlasHoehe":ground.height,"spalten":64,"kachelBreite":30,"kachelHoehe":16,"kacheln":values.len(),"fehlend":missing,"upper":atlas::json_atlas(&uppers,atlas_cache)?,"treeSprites":tree_sprites,"cliffSprites":b64(&u16_bytes(&cliffs)),"plaetze":b64(&u16_bytes(&tile_slots)),"hoehen":height.map(|h|b64(&raster(h)))}),
    )
}
pub fn load_map_tiles(
    path: &Path,
    root: &Path,
    cache_root: &Path,
    resource_root: &Path,
) -> Result<Value> {
    super::cache::extract(cache_root, || {
        extract_map_tiles(path, root, cache_root, resource_root)
    })
}

fn with_map_identity(mut tiles: Value, known: &Value, requested: &Path) -> Value {
    // Atlas identity follows map contents and graphics, not a filename. A hit
    // can come from another copy or an older spelling of the same Windows
    // path. Echo this request so the renderer's stale-selection guard accepts
    // the current result, and use the current map's display name.
    tiles["path"] = json!(requested);
    tiles["name"] = known["name"].clone();
    tiles
}

fn extract_map_tiles(
    path: &Path,
    root: &Path,
    cache_root: &Path,
    resource_root: &Path,
) -> Result<Value> {
    let known = known_map(path, root)?;
    let map = MapFile::read(path)?;
    let graphics = resolve_graphics(root)?;
    let capture = super::native_cache::read_capture(root, &map.bytes, cache_root)
        .ok()
        .filter(|capture| {
            map.section(1045).ok().flatten().as_deref() == Some(capture.base_heights.as_slice())
        });
    let identity = format!(
        "rust-map-atlas-4:{}:{}:{}",
        hash(&map.bytes),
        graphics.revision,
        capture.as_ref().map_or("saved", |c| c.revision.as_str())
    );
    let key = hash(identity.as_bytes());
    let atlas_cache = cache_root.join("atlas-pages");
    let cache = cache_root.join("map-atlas.json");
    if let Ok(meta) = fs::metadata(&cache) {
        if meta.len() < 128 * 1024 * 1024 {
            if let Ok(bytes) = fs::read(&cache) {
                if let Ok(mut entry) = serde_json::from_slice::<Value>(&bytes) {
                    if entry["key"] == key && atlas::cached_pages_available(&entry["value"]) {
                        return Ok(with_map_identity(entry["value"].take(), &known, path));
                    }
                }
            }
        }
    }
    let mut gfx = map
        .section(1001)?
        .filter(|v| v.len() == TILES * 2)
        .ok_or("Map has no valid terrain layer")?;
    let heights = map.section(1005)?;
    let pillars = map.section(1002)?;
    let organisms = map.section(1004)?;
    let trees = trees(map.section(1014)?)?;
    let mut files = Files {
        graphics,
        files: HashMap::new(),
    };
    let mut stock = stock(&gfx, &mut files, resource_root)?;
    if capture.is_some() {
        let mut total = 0;
        for entry in &mut stock.entries {
            // Captures use the engine's actual base-file counts. Replacement
            // pack file counts must not shift these IDs when decoding them.
            entry.count = read(&root.join("gm").join(format!("{}.gm1", entry.name)))
                .ok()
                .and_then(|bytes| u32le(&bytes, 12).ok())
                .unwrap_or(0) as usize;
            entry.from = total;
            total += entry.count;
        }
        stock.layout = "capture";
    }
    let keeps = map.keeps()?;
    let desert = stock
        .entries
        .iter()
        .find(|e| e.name == "tile_land8" && e.count > 0)
        .ok_or("Game desert terrain graphics missing")?;
    let desert = (desert.from + 1) as u16;
    let mut value = if let Some(capture) = capture {
        let mut cameras = Vec::new();
        for (mut camera, pillars) in capture.cameras {
            replace_keeps(&mut camera, &keeps, desert);
            cameras.push(build_atlas(
                &camera,
                Some(&capture.heights),
                Some(&pillars),
                organisms.as_deref(),
                &trees,
                &stock,
                &mut files,
                &atlas_cache,
            )?);
        }
        let mut value = cameras[0].clone();
        value["cameras"] = json!(cameras);
        value["nativeRenderer"] = json!(true);
        value
    } else {
        replace_keeps(&mut gfx, &keeps, desert);
        build_atlas(
            &gfx,
            heights.as_deref(),
            pillars.as_deref(),
            organisms.as_deref(),
            &trees,
            &stock,
            &mut files,
            &atlas_cache,
        )?
    };
    value = with_map_identity(value, &known, path);
    value["pictureLayout"] = json!(stock.layout);
    value["assetRevision"] = json!(files.graphics.revision);
    // Saved-map decoding is a complete independent path, never a request to
    // capture or attach to a running game. Legacy caches are not executed.
    if let Ok(bytes) = serde_json::to_vec(&json!({"key":key,"value":value})) {
        if bytes.len() < 128 * 1024 * 1024 && fs::create_dir_all(cache_root).is_ok() {
            let temporary = cache_root.join("map-atlas.tmp");
            if fs::write(&temporary, bytes).is_ok() {
                let _ = fs::rename(&temporary, &cache);
            }
        }
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diamond_has_exactly_80400_tiles() {
        let mut seen = vec![false; TILES];
        for y in 0..400 {
            let (a, b) = row_range(y);
            for x in a..=b {
                let i = tile_index(x, y);
                assert!(i < TILES);
                assert!(!seen[i]);
                seen[i] = true;
            }
        }
        assert!(seen.into_iter().all(|v| v));
    }
    #[test]
    fn checked_implode_block() {
        let mut bytes = Vec::new();
        bytes.extend(13u32.to_le_bytes());
        bytes.extend(8u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend([0, 4, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
        assert_eq!(packed(&bytes, 0).unwrap(), b"AIAIAIAIAIAIA");
    }
    #[test]
    fn map_keep_replacement_is_bounded() {
        let mut gfx = vec![0; TILES * 2];
        replace_keeps(&mut gfx, &[json!({"x":190,"y":190})], 123);
        assert_eq!(u16le(&gfx, tile_index(190, 190) * 2).unwrap(), 123);
        assert_eq!(u16le(&gfx, tile_index(188, 190) * 2).unwrap(), 0);
    }

    #[test]
    fn cached_atlas_uses_the_requested_map_identity() {
        let cached = json!({
            "path": "D:/Games/Crusader\\maps\\GreekSea.map",
            "name": "GreekSea",
            "atlas": "file:///cache/terrain.png",
            "plaetze": "unchanged terrain",
            "cameras": [{"atlas": "file:///cache/camera.png"}],
        });
        // The selection guard compares strings; separator spelling from a
        // former runtime must not reject an otherwise valid cached atlas.
        let requested = Path::new(r"D:\Games\Crusader\maps\GreekSea.map");
        let restored = with_map_identity(cached.clone(), &json!({"name":"GreekSea"}), requested);
        assert_eq!(restored["path"], json!(requested));
        assert_eq!(restored["atlas"], cached["atlas"]);
        assert_eq!(restored["cameras"], cached["cameras"]);
        assert_eq!(restored["plaetze"], cached["plaetze"]);

        // Byte-identical maps intentionally share atlas work, but not labels
        // or selection identity when a copy is selected from the map menu.
        let copy = Path::new(r"D:\Games\Crusader\maps\GreekSea Copy.map");
        let copied = with_map_identity(cached, &json!({"name":"GreekSea Copy"}), copy);
        assert_eq!(copied["path"], json!(copy));
        assert_eq!(copied["name"], "GreekSea Copy");
        assert_eq!(copied["atlas"], restored["atlas"]);
    }
}
