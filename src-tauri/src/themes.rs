//! User theme packs live together under the existing editor data directory.
//! Browser-side validation restricts CSS to the shared semantic token schema.
use crate::storage::{self, Result};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ThemePack {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

pub fn discover(directory: &Path) -> Result<Vec<ThemePack>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut packs = Vec::new();
    for entry in fs::read_dir(directory).map_err(crate::error::Error::diagnostic)? {
        let entry = entry.map_err(crate::error::Error::diagnostic)?;
        if !entry
            .file_type()
            .map_err(crate::error::Error::diagnostic)?
            .is_dir()
        {
            continue;
        }
        let id = entry.file_name();
        let id = id.to_string_lossy();
        if !valid_id(&id) || matches!(id.as_ref(), "default" | "ucp") {
            continue;
        }
        let root = storage::within(directory, &entry.path())?;
        let Ok(manifest) = storage::read_json(root.join("theme.json")) else {
            continue;
        };
        if manifest["id"] != id.as_ref()
            || manifest["schemaVersion"] != 1
            || !root.join("variables.css").is_file()
        {
            continue;
        }
        if let Some(name) = manifest["name"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 240)
        {
            packs.push(ThemePack {
                id: id.into_owned(),
                name: name.into(),
                path: root,
            });
        }
    }
    packs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(packs)
}
fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 48
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pack_ids_cannot_escape_the_pack_folder() {
        assert!(valid_id("my-ucp-theme"));
        for id in ["../other", "C:/theme", "ucp/theme", "", "A", "a.json"] {
            assert!(!valid_id(id));
        }
    }
}
