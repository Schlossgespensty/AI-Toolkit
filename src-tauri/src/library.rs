//! UCP project discovery and atomic project updates. No game process is involved.
use crate::storage::{self, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

const MANAGED: &str = "aiv-mod-editor-local-1.0.0";

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct AiProject {
    pub ai_root: PathBuf,
    pub owned: bool,
    pub vanilla: bool,
    pub character: Option<storage::DocumentResult>,
    pub lines: Option<ProjectLines>,
    pub media: Option<Value>,
    pub castle: Option<storage::DocumentResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional = nullable))]
    pub portraits: Option<ProjectPortraits>,
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProjectLines {
    pub path: PathBuf,
    pub exists: bool,
    pub content: String,
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProjectPortraits {
    pub portrait: PortraitFile,
    pub portrait_small: PortraitFile,
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PortraitFile {
    pub path: PathBuf,
    pub exists: bool,
    pub data_url: Option<String>,
}
impl PortraitFile {
    fn read(path: PathBuf) -> Self {
        Self {
            exists: path.exists(),
            data_url: storage::data_url(&path).ok(),
            path,
        }
    }
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CharacterReplacement {
    pub ai_root: PathBuf,
    pub path: PathBuf,
    pub content: String,
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CastleDestinationResult {
    pub path: PathBuf,
    pub exists: bool,
    pub file_name: String,
}
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PortraitResult {
    pub path: PathBuf,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}
fn default_lines(name: &str) -> Value {
    let keys: Vec<String> =
        serde_json::from_str(include_str!("../../src/shared/ai-line-keys.json"))
            .expect("validated line keys");
    Value::Object(
        keys.into_iter()
            .map(|key| {
                let value = if key == "ai_name" { name } else { "" };
                (key, json!(value))
            })
            .collect(),
    )
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn files(root: &Path, depth: usize) -> impl Iterator<Item = PathBuf> {
    WalkDir::new(root)
        .max_depth(depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
}
fn json_or(path: &Path, fallback: Value) -> Value {
    storage::read_json(path).unwrap_or(fallback)
}
fn image(path: &Path) -> Value {
    storage::data_url(path)
        .map(Value::String)
        .unwrap_or(Value::Null)
}
fn yaml(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_yaml::from_str(&s).ok())
        .unwrap_or(json!({}))
}
fn active_names(root: &Path) -> BTreeSet<String> {
    fn collect(v: &Value, out: &mut BTreeSet<String>) {
        match v {
            Value::Object(m) => {
                if let Some(Value::String(n)) = m.get("extension") {
                    out.insert(n.clone());
                }
                for c in m.values() {
                    collect(c, out);
                }
            }
            Value::Array(a) => {
                for c in a {
                    collect(c, out);
                }
            }
            _ => {}
        }
    }
    let mut out = BTreeSet::new();
    collect(&yaml(&root.join("ucp-config.yml")), &mut out);
    out
}
fn version(value: &str) -> semver::Version {
    semver::Version::parse(value.trim_start_matches('v')).unwrap_or(semver::Version::new(0, 0, 0))
}
pub fn castles(root: &Path) -> Value {
    let directory = root.join("aiv");
    let mapping_path = directory.join("mapping.json");
    let mapping = json_or(&mapping_path, json!({}));
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let mut add = |file: String, slot: Value| {
        let valid =
            storage::safe_name(&file).is_ok() && file.to_ascii_lowercase().ends_with(".aiv");
        let path = directory.join(&file);
        let json_path = path.with_extension("aivjson");
        seen.insert(file.to_ascii_lowercase());
        out.push(json!({"slot":slot,"fileName":file,"filePath":if valid{json!(path)}else{Value::Null},"exists":valid&&path.is_file(),"jsonPath":if valid{json!(json_path)}else{Value::Null},"jsonExists":valid&&json_path.is_file(),"valid":valid}));
    };
    if let Some(entries) = mapping.as_object() {
        for (key, value) in entries {
            if let (Some(slot), Some(file)) = (
                key.strip_prefix("castle_")
                    .and_then(|v| v.parse::<u32>().ok()),
                value.as_str(),
            ) {
                add(file.into(), json!(slot));
            }
        }
    }
    drop(add);
    out.sort_by_key(|v| v["slot"].as_u64());
    for path in files(&directory, 1)
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("aiv")))
    {
        let file = name(&path);
        if seen.contains(&file.to_ascii_lowercase()) {
            continue;
        }
        let jp = path.with_extension("aivjson");
        out.push(json!({"slot":null,"fileName":file,"filePath":path,"exists":true,"jsonPath":jp,"jsonExists":jp.exists(),"valid":true}));
    }
    json!({"mappingPath":mapping_path,"mappingExists":mapping_path.exists(),"castles":out})
}
pub fn scan(selected: &Path) -> Result<Value> {
    let root = storage::normalize_installation(selected)?;
    let plugins_root = root.join("ucp/plugins");
    let active = active_names(&root);
    let mut candidates = Vec::new();
    let mut newest = BTreeMap::new();
    for entry in fs::read_dir(&plugins_root)
        .map_err(crate::error::Error::diagnostic)?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() || name(&path).starts_with('.') {
            continue;
        }
        let definition = yaml(&path.join("definition.yml"));
        let kind = text(&definition, "type");
        if !kind.is_empty() && kind != "plugin" {
            continue;
        }
        let id = if text(&definition, "name").is_empty() {
            name(&path)
        } else {
            text(&definition, "name").into()
        };
        let ver = version(text(&definition, "version"));
        let latest = newest.entry(id.clone()).or_insert(ver.clone());
        if ver > *latest {
            *latest = ver;
        }
        candidates.push((path, definition, id));
    }
    let mut plugins = Vec::new();
    let mut ais = Vec::new();
    let mut diagnostics = Vec::new();
    for (path, definition, id) in candidates {
        if version(text(&definition, "version")) < newest[&id] {
            continue;
        }
        let display = if text(&definition, "display-name").is_empty() {
            id.as_str()
        } else {
            text(&definition, "display-name")
        };
        let mut plugin = json!({"folderName":name(&path),"rootPath":path,"name":id,"displayName":display,"version":text(&definition,"version"),"active":active.contains(&id),"owned":id=="aiv-mod-editor-local","definitionError":null,"aiCount":0});
        let resources = path.join("resources/ai");
        let before = ais.len();
        for meta_path in files(&resources, 9).filter(|p| {
            p.file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("meta.json"))
        }) {
            let meta = match storage::read_json(&meta_path) {
                Ok(v) => v,
                Err(e) => {
                    diagnostics.push(format!("{}: {e}", meta_path.display()));
                    continue;
                }
            };
            let ai = meta_path.parent().unwrap();
            let relative = slash(ai.strip_prefix(&resources).unwrap());
            let character = ai.join("character.json");
            let lines = ai.join("lines.json");
            let info = castles(ai);
            let portrait = ["portrait.png", "portrait.jpg", "portrait.jpeg"]
                .iter()
                .map(|n| ai.join(n))
                .find(|p| p.exists());
            let small = ai.join("portrait_small.png");
            ais.push(json!({"key":format!("{id}:{relative}:{}",slash(ai)),"id":relative,"folderName":name(ai),"rootPath":ai,"metaPath":meta_path,"meta":meta,
              "name":if text(&meta,"name").trim().is_empty(){name(ai)}else{text(&meta,"name").into()},"author":text(&meta,"author"),"version":text(&meta,"version"),"description":text(&meta,"description"),"defaultLang":text(&meta,"defaultLang"),"supportedLang":meta.get("supportedLang").cloned().unwrap_or(json!([])),
              "characterPath":character,"characterExists":character.exists(),"linesPath":lines,"linesExists":lines.exists(),"mappingPath":info["mappingPath"],"mappingExists":info["mappingExists"],"castles":info["castles"],
              "portraitPath":portrait,"portraitDataUrl":portrait.as_ref().map(|p|image(p)),"portraitSmallPath":small,"portraitSmallDataUrl":image(&small),"active":plugin["active"],"owned":plugin["owned"],"plugin":plugin,"diagnostics":[]}));
        }
        plugin["aiCount"] = json!(ais.len() - before);
        plugins.push(plugin);
    }
    let vanilla = root.join("aiv");
    let re = regex::Regex::new(r"(?i)^(.+?)(\d+)\.aiv$").unwrap();
    let mut lords: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for path in files(&vanilla, 1) {
        let file = name(&path);
        if let Some(c) = re.captures(&file) {
            lords.entry(c[1].to_ascii_lowercase()).or_default().push(json!({"slot":c[2].parse::<u32>().unwrap_or(0),"fileName":file,"filePath":path,"exists":true,"jsonPath":path.with_extension("aivjson"),"jsonExists":false,"valid":true}));
        }
    }
    for (lord, mut list) in lords {
        list.sort_by_key(|v| v["slot"].as_u64());
        let title = format!("{}{}", lord[..1].to_uppercase(), &lord[1..]);
        ais.push(json!({"key":format!("vanilla:{lord}"),"id":lord,"folderName":"aiv","rootPath":vanilla,"meta":{},"name":format!("{title} (Vanilla)"),"author":"Stronghold Crusader","version":"","description":"","defaultLang":"","supportedLang":[],"characterExists":false,"linesExists":false,"mappingExists":false,"castles":list,"portraitDataUrl":null,"portraitSmallDataUrl":null,"active":true,"owned":false,"vanilla":true,"plugin":{"name":"vanilla","displayName":"Vanilla","version":"","folderName":"aiv","rootPath":vanilla,"active":true,"owned":false},"diagnostics":[]}));
    }
    ais.sort_by_key(|v| text(v, "name").to_lowercase());
    plugins.sort_by_key(|v| text(v, "displayName").to_lowercase());
    Ok(
        json!({"gameRoot":root,"ucpRoot":root.join("ucp"),"pluginsRoot":plugins_root,"configPath":root.join("ucp-config.yml"),"managedPluginRoot":plugins_root.join(MANAGED),"managedPlugin": {"name":"aiv-mod-editor-local","displayName":"AI Toolkit - My AIs","version":"1.0.0","folderName":MANAGED},"activeExtensions":active,"plugins":plugins,"ais":ais,"diagnostics":diagnostics}),
    )
}
fn project_root(request: &Value) -> Result<PathBuf> {
    let game = storage::normalize_installation(Path::new(text(request, "gameRoot")))?;
    storage::within(
        &game.join("ucp/plugins"),
        Path::new(text(request, "aiRoot")),
    )
}
pub fn media(root: &Path) -> Value {
    let mut out = json!({"speech":[],"binks":[],"diagnostics":[]});
    for mapping in files(root, 7).filter(|p| p.file_name().is_some_and(|n| n == "mapping.json")) {
        let kind = name(mapping.parent().unwrap());
        if !["speech", "binks"].contains(&kind.as_str()) {
            continue;
        }
        let extension = if kind == "speech" { "wav" } else { "bik" };
        let entries = json_or(&mapping, json!({}));
        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
        if let Some(entries) = entries.as_object() {
            for (key, value) in entries {
                if let Some(file) = value.as_str() {
                    if storage::safe_name(file).is_ok()
                        && file
                            .to_ascii_lowercase()
                            .ends_with(&format!(".{extension}"))
                    {
                        groups.entry(file.into()).or_default().push(key.clone());
                    }
                }
            }
        }
        for (file, keys) in groups {
            let path = mapping.parent().unwrap().join(&file);
            let relative = slash(mapping.strip_prefix(root).unwrap());
            let group = slash(mapping.parent().unwrap().strip_prefix(root).unwrap());
            let language = group
                .strip_prefix("lang/")
                .and_then(|v| v.split('/').next());
            out[&kind].as_array_mut().unwrap().push(json!({"kind":kind,"mappingPath":mapping,"mappingRelativePath":relative,"group":group,"language":language,"fileName":file,"filePath":path,"exists":path.is_file(),"size":fs::metadata(&path).map(|m|m.len()).unwrap_or(0),"keys":keys}));
        }
    }
    out
}
pub fn resolve_media(request: &Value) -> Result<Value> {
    let root = project_root(request)?;
    let kind = text(request, "kind");
    media(&root)[kind]
        .as_array()
        .and_then(|a| {
            a.iter().find(|v| {
                text(v, "mappingRelativePath") == text(request, "mappingRelativePath")
                    && text(v, "fileName") == text(request, "fileName")
            })
        })
        .cloned()
        .ok_or_else(|| crate::error::Error::new("media_not_mapped"))
}
pub fn read_project(request: &Value) -> Result<Value> {
    let game = storage::normalize_installation(Path::new(text(request, "gameRoot")))?;
    let requested = Path::new(text(request, "aiRoot"));
    let vanilla = requested.canonicalize().ok() == game.join("aiv").canonicalize().ok();
    let root = if vanilla {
        storage::within(&game.join("aiv"), requested)?
    } else {
        project_root(request)?
    };
    let mut out = AiProject {
        ai_root: root.clone(),
        owned: root.starts_with(game.join("ucp/plugins").join(MANAGED)),
        vanilla,
        character: None,
        lines: None,
        media: None,
        castle: None,
        portraits: None,
    };
    if !vanilla {
        out.character = Some(storage::read_document(&root.join("character.json"), false)?);
        let lines = root.join("lines.json");
        let (content, exists) = match fs::read_to_string(&lines) {
            Ok(content) => (content, true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (default_lines(&name(&root)).to_string(), false)
            }
            Err(error) => return Err(crate::error::Error::diagnostic(error)),
        };
        out.lines = Some(ProjectLines {
            path: lines,
            exists,
            content,
        });
        out.portraits = Some(ProjectPortraits {
            portrait: PortraitFile::read(root.join("portrait.png")),
            portrait_small: PortraitFile::read(root.join("portrait_small.png")),
        });
        out.media = Some(media(&root));
    }
    let file = text(request, "castleFile");
    if !file.is_empty() {
        storage::safe_name(file)?;
        let directory = if vanilla {
            root.clone()
        } else {
            root.join("aiv")
        };
        let path = directory.join(file);
        let actual = if path.exists() {
            path.clone()
        } else {
            path.with_extension("aivjson")
        };
        let mut castle = storage::read_document(&storage::within(&directory, &actual)?, true)?;
        // An imported JSON fallback still belongs to the mapped Classic castle.
        // Saving the project must create that .aiv, not overwrite its JSON source.
        castle.path = path;
        castle.file_name = Some(file.into());
        out.castle = Some(castle);
    }
    Ok(json!(out))
}
pub fn update_mapping(request: &Value) -> Result<Value> {
    let root = project_root(request)?;
    let slots = request["slots"]
        .as_array()
        .ok_or_else(|| crate::error::Error::new("castle_slots_must_be_an_array"))?;
    let mut map = serde_json::Map::new();
    if slots.len() > 8 {
        return Err(crate::error::Error::new(
            "castle_mapping_must_contain_at_most_eight_slots",
        ));
    }
    if !root.join("aiv").is_dir() {
        return Err(crate::error::Error::new("this_ai_has_no_aiv_folder"));
    }
    let available: BTreeMap<_, _> = files(&root.join("aiv"), 1)
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("aiv")))
        .map(|p| {
            let n = name(&p);
            (n.to_lowercase(), n)
        })
        .collect();
    for (index, slot) in slots.iter().enumerate() {
        let file = slot.as_str().unwrap_or("").trim();
        if file.is_empty() {
            continue;
        }
        storage::safe_name(file)?;
        let actual = available
            .get(&file.to_lowercase())
            .ok_or_else(|| crate::error::Error::new("castle_file_does_not_exist_in_this_ai"))?;
        map.insert(format!("castle_{}", index + 1), json!(actual));
    }
    let path = root.join("aiv/mapping.json");
    storage::atomic_write(
        &path,
        &serde_json::to_vec_pretty(&map).map_err(crate::error::Error::diagnostic)?,
    )?;
    scanned_ai(
        &storage::normalize_installation(Path::new(text(request, "gameRoot")))?,
        &root,
    )
}
pub fn replace_character(request: &Value) -> Result<Value> {
    let root = project_root(request)?;
    let content = text(request, "content");
    serde_json::from_str::<Value>(content).map_err(crate::error::Error::diagnostic)?;
    let path = root.join("character.json");
    storage::atomic_write(&path, content.as_bytes())?;
    Ok(json!(CharacterReplacement {
        ai_root: root,
        path,
        content: content.into()
    }))
}

fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target).map_err(crate::error::Error::diagnostic)?;
    for entry in WalkDir::new(source).follow_links(false).into_iter() {
        // A partial traversal must abort the transaction. Silently dropping an
        // unreadable subtree would commit its omission over the original AI.
        let entry = entry.map_err(crate::error::Error::diagnostic)?;
        if entry.file_type().is_symlink() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(crate::error::Error::diagnostic)?;
        let dest = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest).map_err(crate::error::Error::diagnostic)?;
        } else if entry.file_type().is_file() {
            fs::copy(entry.path(), dest).map_err(crate::error::Error::diagnostic)?;
        }
    }
    Ok(())
}
fn transaction<T>(target: &Path, prepare: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
    let parent = target
        .parent()
        .ok_or_else(|| crate::error::Error::new("invalid_project_path"))?;
    fs::create_dir_all(parent).map_err(crate::error::Error::diagnostic)?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(crate::error::Error::diagnostic)?
        .as_nanos();
    let stage = parent.join(format!(".toolkit-stage-{suffix}"));
    let backup = parent.join(format!(".toolkit-backup-{suffix}"));
    if target.exists() {
        copy_tree(target, &stage)?;
    } else {
        fs::create_dir(&stage).map_err(crate::error::Error::diagnostic)?;
    }
    let result = prepare(&stage);
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
        return result;
    }
    if target.exists() {
        fs::rename(target, &backup).map_err(crate::error::Error::diagnostic)?;
    }
    if let Err(error) = fs::rename(&stage, target) {
        if backup.exists() {
            let _ = fs::rename(&backup, target);
        }
        let _ = fs::remove_dir_all(&stage);
        return Err(crate::error::Error::diagnostic(error));
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    result
}
fn json_write(path: &Path, value: &Value) -> Result<()> {
    storage::atomic_write(
        path,
        &serde_json::to_vec_pretty(value).map_err(crate::error::Error::diagnostic)?,
    )
}
fn decoded(request: &Value, key: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text(request, key))
        .map_err(crate::error::Error::diagnostic)
}
fn managed_target(request: &Value) -> Result<(PathBuf, PathBuf)> {
    let root = storage::normalize_installation(Path::new(text(request, "gameRoot")))?;
    let id = text(request, "aiId");
    if !regex::Regex::new(r"^[a-z0-9][a-z0-9._-]*$")
        .unwrap()
        .is_match(id)
    {
        return Err(crate::error::Error::new("invalid_ai_folder_id"));
    }
    let plugin = root.join("ucp/plugins").join(MANAGED);
    let target = plugin.join("resources/ai").join(id);
    Ok((root, target))
}
fn managed_transaction<T>(
    root: &Path,
    target: &Path,
    prepare: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let plugin = root.join("ucp/plugins").join(MANAGED);
    let definition = plugin.join("definition.yml");
    if definition.is_file() {
        // Existing metadata belongs to the installed plugin. Preserve it and
        // avoid copying every other AI for an ordinary single-project update.
        return transaction(target, prepare);
    }
    if definition.exists() {
        return Err(crate::error::Error::diagnostic(format!(
            "Expected a plugin definition file: {}",
            definition.display()
        )));
    }
    let relative = target
        .strip_prefix(&plugin)
        .map_err(crate::error::Error::diagnostic)?;
    // First creation/recovery of the definition and the AI commit together in
    // one directory rename. Failed preparation never publishes either one.
    transaction(&plugin, |stage| {
        let ai = stage.join(relative);
        fs::create_dir_all(&ai).map_err(crate::error::Error::diagnostic)?;
        let result = prepare(&ai)?;
        let defaults = "name: aiv-mod-editor-local\ndisplay-name: AI Toolkit - My AIs\nversion: 1.0.0\nauthor: AI Toolkit\nmeta:\n  version: 1.0.0\ntype: plugin\ndependencies:\n  aiSwapper: \">= 1.2.0\"\n";
        storage::atomic_write(&stage.join("definition.yml"), defaults.as_bytes())?;
        Ok(result)
    })
}
fn scanned_ai(root: &Path, target: &Path) -> Result<Value> {
    Ok(scan(root)?["ais"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|v| Path::new(text(v, "rootPath")) == target)
        })
        .cloned()
        .unwrap_or(Value::Null))
}
pub fn create(request: &Value, clone: bool) -> Result<Value> {
    let (root, target) = managed_target(request)?;
    if target.exists() {
        return Err(crate::error::Error::new(
            "an_ai_with_that_folder_id_already_exists",
        ));
    }
    let title = text(request, "name").trim();
    if title.is_empty() {
        return Err(crate::error::Error::new("enter_an_ai_name"));
    }
    managed_transaction(&root, &target, |stage| {
        if clone {
            let source = storage::within(
                &root.join("ucp/plugins"),
                Path::new(text(request, "sourceAiRoot")),
            )?;
            copy_tree(&source, stage)?;
            let mut meta = storage::read_json(stage.join("meta.json"))?;
            meta["name"] = json!(title);
            if !text(request, "version").is_empty() {
                meta["version"] = request["version"].clone();
            }
            json_write(&stage.join("meta.json"), &meta)?;
            let lines = stage.join("lines.json");
            if lines.exists() {
                let mut value = storage::read_json(&lines)?;
                value["ai_name"] = json!(title);
                json_write(&lines, &value)?;
            }
        } else {
            let character = text(request, "characterContent");
            serde_json::from_str::<Value>(character).map_err(crate::error::Error::diagnostic)?;
            storage::atomic_write(&stage.join("character.json"), character.as_bytes())?;
            let meta = json!({"name":title,"description":"","author":text(request,"author"),"link":"None","version":if text(request,"version").is_empty(){"1.0.0"}else{text(request,"version")},"defaultLang":"en","supportedLang":["en"],"switched":{"binks":false,"speech":false,"aic":true,"aiv":true,"lord":true,"startTroops":true,"lines":true,"portrait":true}});
            json_write(&stage.join("meta.json"), &meta)?;
            json_write(&stage.join("lines.json"), &default_lines(title))?;
            json_write(
                &stage.join("aiv/mapping.json"),
                &json!({"castle_1":"castle1.aiv"}),
            )?;
            storage::atomic_write(
                &stage.join("aiv/castle1.aiv"),
                &decoded(request, "castleBase64")?,
            )?;
            for (key, file) in [
                ("portraitBase64", "portrait.png"),
                ("portraitSmallBase64", "portrait_small.png"),
            ] {
                if !text(request, key).is_empty() {
                    storage::atomic_write(&stage.join(file), &decoded(request, key)?)?;
                }
            }
        }
        Ok(())
    })?;
    scanned_ai(&root, &target)
}
pub fn update(request: &Value) -> Result<Value> {
    let (root, target) = managed_target(request)?;
    if !target.is_dir() {
        return Err(crate::error::Error::new("the_ai_project_no_longer_exists"));
    }
    let content = text(request, "characterContent");
    serde_json::from_str::<Value>(content).map_err(crate::error::Error::diagnostic)?;
    managed_transaction(&root, &target, |stage| {
        storage::atomic_write(&stage.join("character.json"), content.as_bytes())?;
        let file = text(request, "castleFile");
        if !file.is_empty() {
            storage::safe_name(file)?;
            if !file.to_ascii_lowercase().ends_with(".aiv") {
                return Err(crate::error::Error::new("expected_an_aiv_castle_filename"));
            }
            storage::atomic_write(
                &stage.join("aiv").join(file),
                &decoded(request, "castleBase64")?,
            )?;
        }
        Ok(())
    })?;
    let mut ai = scanned_ai(&root, &target)?;
    if !text(request, "castleBase64").is_empty() {
        ai["savedCastleBase64"] = request["castleBase64"].clone();
    }
    Ok(ai)
}
pub fn castle_destination(request: &Value) -> Result<Value> {
    let root = project_root(request)?;
    let file = storage::safe_name(text(request, "fileName"))?;
    if !file.to_ascii_lowercase().ends_with(".aiv") {
        return Err(crate::error::Error::new("expected_an_aiv_castle_filename"));
    }
    let path = root.join("aiv").join(file);
    Ok(json!(CastleDestinationResult {
        exists: path.exists(),
        path,
        file_name: file.into()
    }))
}
pub fn add_castle(request: &Value) -> Result<Value> {
    let info = castle_destination(request)?;
    if info["exists"] == true && request["overwrite"] != true {
        return Err(crate::error::Error::new("castle_already_exists"));
    }
    let path = Path::new(text(&info, "path"));
    storage::atomic_write(path, &decoded(request, "castleBase64")?)?;
    Ok(info)
}
pub fn replace_portrait(request: &Value) -> Result<Value> {
    let root = project_root(request)?;
    let small = request["kind"] == "portraitSmall";
    let path = root.join(if small {
        "portrait_small.png"
    } else {
        "portrait.png"
    });
    let bytes = decoded(request, "base64")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(crate::error::Error::new("invalid_portrait_image"));
    }
    storage::atomic_write(&path, &bytes)?;
    Ok(json!(PortraitResult {
        data_url: storage::data_url(&path)?,
        path,
        width: if small { 36 } else { 72 },
        height: if small { 36 } else { 72 }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "toolkit-library-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(path.join("ucp/plugins/example-1.0.0/resources/ai/source/aiv"))
                .unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let target = dunce::canonicalize(&self.0).unwrap();
            let base = dunce::canonicalize(std::env::temp_dir()).unwrap();
            assert_eq!(target.parent(), Some(base.as_path()));
            fs::remove_dir_all(target).unwrap();
        }
    }
    #[test]
    fn project_clone_and_update_preserve_custom_files_and_serialized_values() {
        let fixture = Fixture::new();
        let game = &fixture.0;
        let plugin = game.join("ucp/plugins/example-1.0.0");
        let source = plugin.join("resources/ai/source");
        storage::atomic_write(
            &plugin.join("definition.yml"),
            b"name: example\nversion: 1.0.0\ntype: plugin\n",
        )
        .unwrap();
        json_write(
            &source.join("meta.json"),
            &json!({"name":"Original","custom":{"preserve":true}}),
        )
        .unwrap();
        let character = r#"{"Name":"Original","AIC":{"Farm1":"WheatFarm","UnknownField":72},"AI_Troop_Behaviour":{"enabled":false}}"#;
        storage::atomic_write(&source.join("character.json"), character.as_bytes()).unwrap();
        json_write(
            &source.join("lines.json"),
            &json!({"ai_name":"Original","custom_line":"über den Graben"}),
        )
        .unwrap();
        storage::atomic_write(&source.join("aiv/Castle.aiv"), &[0, 1, 2, 255]).unwrap();
        storage::atomic_write(&source.join("custom.yaml"), b"extension: untouched\n").unwrap();
        json_write(
            &source.join("aiv/mapping.json"),
            &json!({"castle_1":"Castle.aiv"}),
        )
        .unwrap();
        let clone = create(
            &json!({"gameRoot":game,"sourceAiRoot":source,"aiId":"copy","name":"Copy"}),
            true,
        )
        .unwrap();
        let target = Path::new(text(&clone, "rootPath"));
        assert_eq!(
            fs::read(target.join("character.json")).unwrap(),
            character.as_bytes()
        );
        assert_eq!(
            storage::read_json(target.join("meta.json")).unwrap()["custom"]["preserve"],
            true
        );
        assert_eq!(
            storage::read_json(target.join("lines.json")).unwrap()["custom_line"],
            "über den Graben"
        );
        assert_eq!(
            fs::read(target.join("custom.yaml")).unwrap(),
            b"extension: untouched\n"
        );
        let mapped =
            update_mapping(&json!({"gameRoot":game,"aiRoot":target,"slots":["castle.aiv"]}))
                .unwrap();
        assert_eq!(mapped["castles"][0]["fileName"], "Castle.aiv");
        assert!(
            update_mapping(&json!({"gameRoot":game,"aiRoot":target,"slots":["missing.aiv"]}))
                .is_err()
        );
        let opened =
            read_project(&json!({"gameRoot":game,"aiRoot":target,"castleFile":"Castle.aiv"}))
                .unwrap();
        assert_eq!(opened["castle"]["sourceBase64"], "AAEC/w==");
        update(&json!({"gameRoot":game,"aiId":"copy","characterContent":character,"castleFile":"Castle.aiv","castleBase64":"AAEC/w=="})).unwrap();
        assert_eq!(
            fs::read(target.join("aiv/Castle.aiv")).unwrap(),
            [0, 1, 2, 255]
        );
        assert_eq!(
            fs::read(target.join("custom.yaml")).unwrap(),
            b"extension: untouched\n"
        );
    }
    #[test]
    fn failed_managed_operations_preserve_plugin_and_project_metadata() {
        let fixture = Fixture::new();
        let plugin = fixture.0.join("ucp/plugins").join(MANAGED);
        let request = json!({"gameRoot":fixture.0,"aiId":"new","name":"New", "characterContent":"{}","castleBase64":"not base64"});
        // Target calculation and failures during first creation leave no plugin.
        managed_target(&request).unwrap();
        assert!(!plugin.exists());
        assert!(create(&request, false).is_err());
        assert!(!plugin.exists());

        let target = plugin.join("resources/ai/existing");
        storage::atomic_write(&target.join("character.json"), b"{\"preserve\":true}").unwrap();
        storage::atomic_write(&target.join("custom.txt"), b"custom AI file").unwrap();
        let definition =
            b"name: aiv-mod-editor-local\nversion: 1.0.0\ntype: plugin\ncustom: preserve\n";
        storage::atomic_write(&plugin.join("definition.yml"), definition).unwrap();
        // Fail before staging (duplicate ID / invalid character), and after a
        // changed character was staged (invalid encoded castle).
        assert!(create(
            &json!({"gameRoot":fixture.0,"aiId":"existing","name":"Duplicate"}),
            false
        )
        .is_err());
        assert!(update(
            &json!({"gameRoot":fixture.0,"aiId":"existing","characterContent":"invalid"})
        )
        .is_err());
        assert!(update(&json!({"gameRoot":fixture.0,"aiId":"existing","characterContent":"{}","castleFile":"castle.aiv","castleBase64":"invalid"})).is_err());
        assert_eq!(fs::read(plugin.join("definition.yml")).unwrap(), definition);
        assert_eq!(
            fs::read(target.join("character.json")).unwrap(),
            b"{\"preserve\":true}"
        );
        assert_eq!(
            fs::read(target.join("custom.txt")).unwrap(),
            b"custom AI file"
        );

        // A plugin without its definition must also survive failed recovery.
        fs::remove_file(plugin.join("definition.yml")).unwrap();
        assert!(create(&request, false).is_err());
        assert!(!plugin.join("definition.yml").exists());
        assert!(!plugin.join("resources/ai/new").exists());
        assert_eq!(
            fs::read(target.join("custom.txt")).unwrap(),
            b"custom AI file"
        );
    }
    #[test]
    fn successful_managed_creation_adds_definition_once_and_preserves_customizations() {
        let fixture = Fixture::new();
        let plugin = fixture.0.join("ucp/plugins").join(MANAGED);
        let request = json!({"gameRoot":fixture.0,"aiId":"first","name":"First", "characterContent":"{}","castleBase64":"AAEC/w=="});
        let first = create(&request, false).unwrap();
        assert_eq!(first["name"], "First");
        assert!(plugin.join("definition.yml").is_file());
        let definition =
            fs::read_to_string(plugin.join("definition.yml")).unwrap() + "custom: preserved\n";
        fs::write(plugin.join("definition.yml"), &definition).unwrap();
        storage::atomic_write(&plugin.join("custom-plugin.txt"), b"plugin extension").unwrap();
        storage::atomic_write(
            &plugin.join("resources/ai/first/custom.txt"),
            b"first AI extension",
        )
        .unwrap();
        let mut second = request.clone();
        second["aiId"] = json!("second");
        second["name"] = json!("Second");
        create(&second, false).unwrap();
        update(
            &json!({"gameRoot":fixture.0,"aiId":"second","characterContent":"{\"changed\":true}"}),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(plugin.join("definition.yml")).unwrap(),
            definition
        );
        assert_eq!(
            fs::read(plugin.join("custom-plugin.txt")).unwrap(),
            b"plugin extension"
        );
        assert_eq!(
            fs::read(plugin.join("resources/ai/first/custom.txt")).unwrap(),
            b"first AI extension"
        );
        assert_eq!(
            storage::read_json(plugin.join("resources/ai/second/character.json")).unwrap()
                ["changed"],
            true
        );
    }
    #[test]
    fn failed_project_transaction_does_not_replace_existing_files() {
        let fixture = Fixture::new();
        let target = fixture.0.join("project");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("file"), b"original").unwrap();
        let result: Result<()> = transaction(&target, |stage| {
            fs::write(stage.join("file"), b"changed").unwrap();
            Err(crate::error::Error::new("operation_failed"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(target.join("file")).unwrap(), b"original");
    }
    #[test]
    fn project_json_fallback_keeps_mapped_classic_destination_and_rejects_unreadable_lines() {
        let fixture = Fixture::new();
        let root = fixture
            .0
            .join("ucp/plugins/example-1.0.0/resources/ai/source");
        fs::write(root.join("character.json"), "{}").unwrap();
        fs::write(root.join("aiv/Castle.aivjson"), r#"{"frames":[]}"#).unwrap();
        let request = json!({"gameRoot":fixture.0,"aiRoot":root,"castleFile":"Castle.aiv"});
        let opened = read_project(&request).unwrap();
        assert_eq!(opened["castle"]["source"], "aivjson");
        assert!(text(&opened["castle"], "path").ends_with("Castle.aiv"));
        assert_eq!(opened["lines"]["exists"], false);
        fs::write(root.join("lines.json"), [0xff, 0xfe, 0xfd]).unwrap();
        assert!(read_project(&request).is_err());
        assert_eq!(
            fs::read(root.join("lines.json")).unwrap(),
            [0xff, 0xfe, 0xfd]
        );
    }
    #[test]
    fn directory_traversal_failure_cannot_commit_a_partial_project() {
        let fixture = Fixture::new();
        let target = fixture.0.join("project");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("character.json"), b"original character").unwrap();
        fs::write(target.join("custom.txt"), b"preserve extension").unwrap();
        let result = transaction(&target, |stage| {
            fs::write(stage.join("character.json"), b"changed character").unwrap();
            // A source removed before traversal produces the same WalkDir Err
            // branch as an unreadable directory, without altering machine ACLs.
            copy_tree(&fixture.0.join("removed-source"), stage)
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read(target.join("character.json")).unwrap(),
            b"original character"
        );
        assert_eq!(
            fs::read(target.join("custom.txt")).unwrap(),
            b"preserve extension"
        );
    }
}
