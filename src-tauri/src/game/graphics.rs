//! One source resolver shared by map tiles, building parts, units and HUD icons.
use super::{hash, read, Result};
use regex::Regex;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
#[derive(Clone, Debug)]
pub struct Graphics {
    pub root: PathBuf,
    pub files: BTreeMap<String, PathBuf>,
    pub revision: String,
}
impl Graphics {
    pub fn file(&self, name: &str) -> PathBuf {
        self.files
            .get(&name.to_lowercase())
            .cloned()
            .unwrap_or_else(|| self.root.join("gm").join(format!("{name}.gm1")))
    }
}
fn add_directory(
    directory: &Path,
    files: &mut BTreeMap<String, PathBuf>,
    inputs: &mut Vec<String>,
) -> Result<()> {
    if !directory.is_dir() {
        return Ok(());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect::<Vec<_>>();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let file = entry.path();
        if file
            .extension()
            .is_none_or(|s| !s.eq_ignore_ascii_case("gm1"))
            || !file.is_file()
        {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        files.insert(
            file.file_stem().unwrap().to_string_lossy().to_lowercase(),
            file.clone(),
        );
        inputs.push(format!(
            "{}:{}:{}",
            file.display(),
            meta.len(),
            meta.modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |v| v.as_nanos())
        ));
    }
    Ok(())
}
// Strip only Lua comments. Quoted strings must survive so registrations inside
// comments cannot become active texture paths, and '--' in a path remains valid.
fn uncomment(lua: &str) -> String {
    let b = lua.as_bytes();
    let (mut i, mut out) = (0, String::with_capacity(lua.len()));
    while i < b.len() {
        if b[i] == b'\'' || b[i] == b'"' {
            let start = i;
            let quote = b[i];
            i += 1;
            while i < b.len() {
                let c = b[i];
                i += 1;
                if c == b'\\' && i < b.len() {
                    i += 1;
                } else if c == quote {
                    break;
                }
            }
            // Copy the original UTF-8 slice: byte-to-char conversion corrupts
            // non-ASCII texture-pack directory names inside quoted paths.
            out.push_str(&lua[start..i]);
        } else if b.get(i..i + 2) == Some(b"--") {
            i += 2;
            let start = i;
            if b.get(i) == Some(&b'[') {
                i += 1;
                while b.get(i) == Some(&b'=') {
                    i += 1;
                }
                if b.get(i) == Some(&b'[') {
                    let close = format!("]{}]", "=".repeat(i - start - 1));
                    i += 1;
                    if let Some(end) = lua[i..].find(&close) {
                        i += end + close.len();
                    } else {
                        i = b.len();
                    }
                    continue;
                }
            }
            i = start;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else {
            let c = lua[i..].chars().next().unwrap();
            out.push(c);
            i += c.len_utf8();
        }
    }
    out
}
pub fn resolve_graphics(root: &Path) -> Result<Graphics> {
    let root = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
    let mut files = BTreeMap::new();
    let mut inputs = Vec::new();
    add_directory(&root.join("gm"), &mut files, &mut inputs)?;
    let config = root.join("ucp-config.yml");
    if config.is_file() {
        let text = String::from_utf8(read(&config)?).map_err(|e| e.to_string())?;
        inputs.push(text.clone());
        let config: Value = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;
        let full = config
            .get("config-full")
            .or_else(|| config.get("config-sparse"));
        if config.get("active") != Some(&Value::Bool(false)) {
            if let Some(order) = full
                .and_then(|c| c.get("load-order"))
                .and_then(Value::as_array)
            {
                let registration =
                    Regex::new(r#"registerFileSource\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap();
                let valid_name = Regex::new(r"^[\w. -]+$").unwrap();
                let valid_version = Regex::new(r"^[\w.+-]+$").unwrap();
                for entry in order {
                    let name = entry["extension"].as_str().unwrap_or("");
                    let version = entry["version"].as_str().unwrap_or("");
                    if !valid_name.is_match(name) || !valid_version.is_match(version) {
                        continue;
                    }
                    let init = root
                        .join("ucp/plugins")
                        .join(format!("{name}-{version}"))
                        .join("init.lua");
                    if !init.is_file() {
                        continue;
                    }
                    let lua = String::from_utf8(read(&init)?).map_err(|e| e.to_string())?;
                    inputs.push(lua.clone());
                    for capture in registration.captures_iter(&uncomment(&lua)) {
                        let mut relative = capture[1].replace('\\', "/");
                        let prefix = format!("ucp/plugins/{name}-*/");
                        if relative.starts_with(&prefix) {
                            relative = format!(
                                "ucp/plugins/{name}-{version}/{}",
                                &relative[prefix.len()..]
                            );
                        }
                        if relative.contains('*')
                            || relative.split('/').any(|p| p == "..")
                            || Path::new(&relative).is_absolute()
                        {
                            continue;
                        }
                        let source = root.join(relative);
                        if let Ok(source) = fs::canonicalize(source) {
                            if source.starts_with(&root) {
                                add_directory(&source.join("gm"), &mut files, &mut inputs)?
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(Graphics {
        root,
        files,
        revision: hash(inputs.join("\n").as_bytes()),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_lua_comments() {
        assert_eq!(
            uncomment("-- registerFileSource('bad')\nregisterFileSource('a--b') --[[ bad ]]"),
            "\nregisterFileSource('a--b') "
        );
    }
    #[test]
    fn preserves_unicode_texture_pack_paths() {
        let source = "registerFileSource('ucp/plugins/Текстуры-1.0/قلعه') -- comment";
        assert_eq!(
            uncomment(source),
            "registerFileSource('ucp/plugins/Текстуры-1.0/قلعه') "
        );
    }
}
