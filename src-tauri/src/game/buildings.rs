use super::{
    atlas,
    gm1::{composite, Gm1, Picture},
    graphics::{resolve_graphics, Graphics},
    hash, read, Result,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
};
struct Sources {
    graphics: Graphics,
    files: HashMap<PathBuf, Gm1>,
    warnings: BTreeSet<String>,
}
impl Sources {
    fn new(root: &Path) -> Result<Self> {
        Ok(Self {
            graphics: resolve_graphics(root)?,
            files: HashMap::new(),
            warnings: BTreeSet::new(),
        })
    }
    fn file(&mut self, name: &str, index: usize) -> Result<&Gm1> {
        let selected = self.graphics.file(name);
        if !self.files.contains_key(&selected) {
            self.files.insert(selected.clone(), Gm1::read(&selected)?);
        }
        if self.files[&selected].entries.get(index).is_some() {
            return Ok(&self.files[&selected]);
        }
        let base = self.graphics.root.join("gm").join(format!("{name}.gm1"));
        if base == selected {
            return Err(format!("Missing {name} picture {index}"));
        }
        if !self.files.contains_key(&base) {
            self.files.insert(base.clone(), Gm1::read(&base)?);
        }
        self.warnings.insert(format!(
            "{name} picture {index}: missing from replacement; using installed base texture."
        ));
        Ok(&self.files[&base])
    }
    fn decode(&mut self, s: &Value) -> Result<Picture> {
        let name = s["file"].as_str().ok_or("Invalid building source file")?;
        let index = s["index"].as_u64().ok_or("Invalid building source index")? as usize;
        let palette = s["palette"].as_u64().map(|v| v as usize);
        let top = self.file(name, index)?.part(index, palette)?;
        if let Some(pillar) = s["pillar"].as_u64() {
            let lift = s["lift"].as_u64().ok_or("Invalid wall lift")? as usize;
            let strip = self
                .file("tile_walls", pillar as usize)?
                .pillar(pillar as usize, lift)?
                .ok_or("Unsupported wall pillar")?;
            let mut out = Picture::empty(top.width, top.height + lift, top.dx, top.dy);
            composite(&mut out, &strip, 0, strip.dy - top.dy);
            composite(&mut out, &top, 0, 0);
            Ok(out)
        } else {
            Ok(top)
        }
    }
}
/// Cached extracted artwork. Every pixel comes from the selected installation.
/// Metadata and layout mappings contain no game image bytes.
pub fn load_building_assets(root: &Path, cache_root: &Path, resource_root: &Path) -> Result<Value> {
    super::cache::extract(cache_root, || {
        extract_building_assets(root, cache_root, resource_root)
    })
}
fn extract_building_assets(root: &Path, cache_root: &Path, resource_root: &Path) -> Result<Value> {
    let mut sources = Sources::new(root)?;
    let catalogue_bytes = read(&resource_root.join("assets/aiv/iso/verzeichnis.json"))?;
    let parts_bytes = read(&resource_root.join("config/iso-source-parts.json"))?;
    let walls_bytes = read(&resource_root.join("config/iso-wall-sources.json"))?;
    let mut identity = b"native-building-assets-2".to_vec();
    identity.extend(sources.graphics.revision.as_bytes());
    identity.extend(&catalogue_bytes);
    identity.extend(&parts_bytes);
    identity.extend(&walls_bytes);
    let revision = hash(&identity);
    fs::create_dir_all(cache_root).map_err(|e| e.to_string())?;
    let cached = cache_root.join(format!("{revision}.json"));
    if let Ok(bytes) = fs::read(&cached) {
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            if value["assetPages"].as_array().is_some_and(|a| {
                a.iter()
                    .all(|p| p.as_str().is_some_and(|p| Path::new(p).is_file()))
            }) {
                return Ok(value);
            }
        }
    }
    let mut catalogue: Value =
        serde_json::from_slice(&catalogue_bytes).map_err(|e| e.to_string())?;
    let parts: Value = serde_json::from_slice(&parts_bytes).map_err(|e| e.to_string())?;
    let walls: Value = serde_json::from_slice(&walls_bytes).map_err(|e| e.to_string())?;
    let mut pictures = Vec::new();
    let mut indices = HashMap::<String, usize>::new();
    fn visit(
        v: &mut Value,
        parts: &Value,
        walls: &Value,
        sources: &mut Sources,
        pictures: &mut Vec<Option<Picture>>,
        indices: &mut HashMap<String, usize>,
    ) -> Result<()> {
        match v {
            Value::Array(a) => {
                for child in a {
                    visit(child, parts, walls, sources, pictures, indices)?
                }
            }
            Value::Object(object) => {
                let filename = object
                    .get("bild")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let key = if let Some(m) = object.get("nativeMoat").and_then(Value::as_u64) {
                    format!("moat:{m}")
                } else if filename == "building-parts.png" {
                    format!("{},{}", object["sx"], object["sy"])
                } else {
                    filename.clone()
                };
                let mut source = if filename == "building-parts.png" {
                    parts[&key].clone()
                } else {
                    walls[&key].clone()
                };
                if let Some(m) = object.get("nativeMoat").and_then(Value::as_u64) {
                    source = json!({"file":"tile_sea8","index":m});
                }
                if filename.starts_with("killing_pits_") || filename.starts_with("pitch_ditches_") {
                    if let Some((name, index)) = filename.trim_end_matches(".png").rsplit_once('_')
                    {
                        if let Ok(index) = index.parse::<usize>() {
                            source = json!({"file":name,"index":index});
                        }
                    }
                }
                if !source.is_null() {
                    let index = if let Some(i) = indices.get(&key) {
                        *i
                    } else {
                        let p = sources.decode(&source)?;
                        let i = pictures.len();
                        pictures.push(Some(p));
                        indices.insert(key, i);
                        i
                    };
                    let p = pictures[index].as_ref().unwrap();
                    object.insert("assetIndex".into(), json!(index));
                    object.insert("breite".into(), json!(p.width));
                    object.insert("hoehe".into(), json!(p.height));
                    object.insert("dx".into(), json!(p.dx));
                    object.insert("dy".into(), json!(p.dy));
                }
                for child in object.values_mut() {
                    if child.is_object() || child.is_array() {
                        visit(child, parts, walls, sources, pictures, indices)?
                    }
                }
                // Legacy monolithic previews are rebuilt from their decoded parts.
                // This also supplies consumers which do not use multipart rendering.
                if filename.ends_with(".png") && !object.contains_key("assetIndex") {
                    if let Some(layout) = object
                        .get("partsLayouts")
                        .and_then(|v| v.get(0))
                        .and_then(Value::as_array)
                    {
                        let mut layer = layout
                            .iter()
                            .filter_map(|p| {
                                Some((
                                    p["assetIndex"].as_u64()? as usize,
                                    p["gx"].as_i64()? as i32,
                                    p["gy"].as_i64()? as i32,
                                ))
                            })
                            .collect::<Vec<_>>();
                        if !layer.is_empty() {
                            layer.sort_by_key(|(_, x, y)| x + y);
                            let n =
                                object.get("kacheln").and_then(Value::as_i64).unwrap_or(1) as i32;
                            let mut top = 0;
                            let mut half = (32 * n - 2 + 1) / 2;
                            let mut bottom = 16 * n;
                            for (i, x, y) in &layer {
                                let p = pictures[*i].as_ref().unwrap();
                                let px = (x - y) * 16 + p.dx;
                                let py = (x + y) * 8 + p.dy;
                                top = top.min(py);
                                half = half.max(px.abs()).max((px + p.width as i32).abs());
                                bottom = bottom.max(py + p.height as i32)
                            }
                            let mut out = Picture::empty(
                                (half * 2) as usize,
                                (bottom - top) as usize,
                                0,
                                top,
                            );
                            for (i, x, y) in layer {
                                let p = pictures[i].as_ref().unwrap();
                                composite(
                                    &mut out,
                                    p,
                                    half + (x - y) * 16 + p.dx,
                                    (x + y) * 8 + p.dy - top,
                                )
                            }
                            let i = pictures.len();
                            object.insert("breite".into(), json!(out.width));
                            object.insert("hoehe".into(), json!(out.height));
                            object.insert("assetIndex".into(), json!(i));
                            pictures.push(Some(out));
                        }
                    }
                    if !object.contains_key("assetIndex") {
                        object.remove("bild");
                        sources.warnings.insert(format!(
                            "No local source mapping for {filename}; showing editor footprint."
                        ));
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    visit(
        &mut catalogue,
        &parts,
        &walls,
        &mut sources,
        &mut pictures,
        &mut indices,
    )?;
    let atlas = atlas::pack(&pictures)?;
    let mut paths = Vec::new();
    for (i, bytes) in atlas.pages.iter().enumerate() {
        let p = cache_root.join(format!("{revision}-{i}.png"));
        fs::write(&p, bytes).map_err(|e| e.to_string())?;
        paths.push(p);
    }
    fn locate(v: &mut Value, entries: &[Value], paths: &[PathBuf]) {
        match v {
            Value::Array(a) => {
                for x in a {
                    locate(x, entries, paths)
                }
            }
            Value::Object(o) => {
                if let Some(index) = o.remove("assetIndex").and_then(|i| i.as_u64()) {
                    let e = &entries[index as usize];
                    let p = &paths[e["page"].as_u64().unwrap() as usize];
                    o.insert(
                        "bild".into(),
                        Value::String(url::Url::from_file_path(p).unwrap().to_string()),
                    );
                    o.insert("sx".into(), e["x"].clone());
                    o.insert("sy".into(), e["y"].clone());
                }
                for child in o.values_mut() {
                    if child.is_object() || child.is_array() {
                        locate(child, entries, paths)
                    }
                }
            }
            _ => {}
        }
    }
    locate(&mut catalogue, &atlas.entries, &paths);
    catalogue["assetWarnings"] = json!(sources.warnings);
    catalogue["assetRevision"] = json!(revision);
    catalogue["assetPages"] = json!(paths);
    fs::write(
        &cached,
        serde_json::to_vec(&catalogue).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(catalogue)
}
pub fn read_resource_icons(root: &Path) -> Result<Value> {
    let g = resolve_graphics(root)?;
    let path = g.file("interface_icons2");
    if !path.is_file() {
        return Ok(json!({}));
    }
    let gm = Gm1::read(&path)?;
    if gm.kind != 1 {
        return Err("Unsupported HUD icon format".into());
    }
    let mut icons = serde_json::Map::new();
    for (name, index) in [
        ("wood", 45),
        ("stone", 49),
        ("iron", 53),
        ("pitch", 57),
        ("gold", 71),
        ("hop", 47),
        ("wheat", 59),
        ("bread", 61),
        ("cheese", 63),
        ("meat", 65),
        ("fruit", 67),
    ] {
        let p = gm.sprite(index, None)?;
        if p.width > 128 || p.height > 128 {
            return Err("Invalid resource icon".into());
        }
        icons.insert(
            name.into(),
            json!(super::png_url(p.width, p.height, &p.rgba)?),
        );
    }
    Ok(Value::Object(icons))
}
