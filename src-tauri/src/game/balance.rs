use super::{read, u16le, u32le, Result};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
const NAMES: &str = include_str!("../../../src/node/building-cost-names.json");
struct Section {
    start: usize,
    size: usize,
    rva: u32,
    flags: u32,
}
fn read_cost_table(bytes: &[u8]) -> Result<Value> {
    if bytes.get(..2) != Some(b"MZ") {
        return Err("Not a Windows game executable".into());
    }
    let pe = u32le(bytes, 60)? as usize;
    if u32le(bytes, pe)? != 0x4550 {
        return Err("Invalid PE executable".into());
    }
    let optional = u16le(bytes, pe + 20)? as usize;
    let headers = pe + 24 + optional;
    let mut ranges = Vec::new();
    for i in 0..u16le(bytes, pe + 6)? as usize {
        let at = headers + i * 40;
        let section = Section {
            start: u32le(bytes, at + 20)? as usize,
            size: u32le(bytes, at + 16)? as usize,
            rva: u32le(bytes, at + 12)?,
            flags: u32le(bytes, at + 36)?,
        };
        if section
            .start
            .checked_add(section.size)
            .filter(|end| *end <= bytes.len())
            .is_none()
        {
            return Err("Truncated PE section".into());
        }
        ranges.push(section);
    }
    let names: Vec<String> = serde_json::from_str(NAMES).map_err(|e| e.to_string())?;
    let copy_loop = [
        0x8b, 0x50, 0xfc, 0x89, 0x51, 0xfc, 0x8b, 0x10, 0x89, 0x11, 0x8b, 0x50, 0x04, 0x89, 0x51,
        0x04, 0x8b, 0x50, 0x08, 0x89, 0x51, 0x08, 0x8b, 0x50, 0x0c, 0x89, 0x51, 0x0c, 0x83, 0xc0,
        0x14, 0x83, 0xc1, 0x14, 0x3d,
    ];
    let mut copies = HashSet::new();
    if optional >= 32 && u16le(bytes, pe + 24)? == 0x10b {
        let image_base = u32le(bytes, pe + 52)?;
        for section in ranges.iter().filter(|s| s.flags & 0x20 != 0) {
            for (offset, window) in bytes[section.start..section.start + section.size]
                .windows(copy_loop.len())
                .enumerate()
            {
                if window != copy_loop {
                    continue;
                }
                let at = section.start + offset;
                if at < section.start + 16
                    || at + copy_loop.len() + 7 > section.start + section.size
                    || bytes[at - 16] != 0xb8
                    || bytes[at + copy_loop.len() + 4] != 0x7c
                    || bytes[at + copy_loop.len() + 6] != 0xc3
                {
                    continue;
                }
                let origin = u32le(bytes, at - 15)?;
                let limit = u32le(bytes, at + copy_loop.len())?;
                if limit <= origin
                    || (limit - origin) % 20 != 0
                    || (limit - origin) / 20 < (names.len() + 1) as u32
                {
                    continue;
                }
                let Some(rva) = origin
                    .checked_sub(image_base)
                    .and_then(|v| v.checked_add(16))
                else {
                    continue;
                };
                if let Some(data) = ranges.iter().find(|s| {
                    s.flags & 0x40 != 0
                        && rva >= s.rva
                        && (rva as usize + names.len() * 20) <= s.rva as usize + s.size
                }) {
                    copies.insert(data.start + (rva - data.rva) as usize);
                }
            }
        }
    }
    if copies.len() > 1 {
        return Err("Multiple game cost initializers; unsupported executable".into());
    }
    let signature = [
        6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut matches = Vec::new();
    for section in ranges.iter().filter(|s| s.flags & 0x40 != 0) {
        let end = section.start + section.size;
        let candidates = if copies.is_empty() {
            bytes[section.start..end]
                .windows(signature.len())
                .enumerate()
                .filter(|(_, w)| *w == signature)
                .map(|(i, _)| section.start + i)
                .collect::<Vec<_>>()
        } else {
            copies
                .iter()
                .copied()
                .filter(|i| *i >= section.start && *i < end)
                .collect()
        };
        for at in candidates {
            if at + names.len() * 20 > end {
                continue;
            }
            let rows = (0..names.len())
                .map(|n| {
                    (0..5)
                        .map(|r| u32le(bytes, at + n * 20 + r * 4).map(|v| v as i32))
                        .collect::<Result<Vec<_>>>()
                })
                .collect::<Result<Vec<_>>>()?;
            if rows
                .iter()
                .all(|r| r.iter().all(|v| (0..=1_000_000).contains(v)))
            {
                matches.push(rows);
            }
        }
    }
    if matches.len() != 1 {
        return Err(format!(
            "Game cost table matched {} locations; unsupported or modified executable",
            matches.len()
        ));
    }
    let mut buildings = serde_json::Map::new();
    for (name, row) in names.into_iter().zip(matches.remove(0)) {
        buildings.entry(name).or_insert(json!({"cost":row}));
    }
    Ok(Value::Object(buildings))
}
pub fn read_exe_costs(root: &Path) -> Result<Value> {
    let path = root.join("Stronghold Crusader.exe");
    if !path.is_file() {
        return Ok(Value::Null);
    }
    Ok(json!({"filePath":path,"buildings":read_cost_table(&read(&path)?)?}))
}
fn resolve_selector(
    root: &Path,
    selector: &str,
    load_order: Option<&Vec<Value>>,
) -> Result<PathBuf> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let normal = selector.replace('\\', "/");
    let parts = normal.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|p| p.is_empty() || *p == ".." || *p == "." || p.contains([':', '?', '[', ']']))
    {
        return Err("Unsupported balance path".into());
    }
    let mut candidates = vec![root.clone()];
    for (i, part) in parts.iter().enumerate() {
        let pattern = regex::Regex::new(&format!(
            "(?i)^{}$",
            part.split('*')
                .map(regex::escape)
                .collect::<Vec<_>>()
                .join(".*")
        ))
        .map_err(|e| e.to_string())?;
        let selected = if i == 2
            && parts[0].eq_ignore_ascii_case("ucp")
            && ["plugins", "modules"].contains(&parts[1])
            && part.contains('*')
        {
            load_order.map(|o| {
                o.iter()
                    .map(|e| {
                        format!(
                            "{}-{}",
                            e["extension"].as_str().unwrap_or(""),
                            e["version"].as_str().unwrap_or("")
                        )
                        .to_lowercase()
                    })
                    .collect::<HashSet<_>>()
            })
        } else {
            None
        };
        let mut next = Vec::new();
        for dir in candidates {
            for e in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !pattern.is_match(&name)
                    || selected
                        .as_ref()
                        .is_some_and(|s| !s.contains(&name.to_lowercase()))
                {
                    continue;
                }
                let path = fs::canonicalize(e.path()).map_err(|e| e.to_string())?;
                if !path.starts_with(&root) {
                    return Err("Balance path escapes the game installation".into());
                }
                next.push(path);
            }
        }
        candidates = next;
    }
    if candidates.len() != 1 {
        return Err(format!(
            "Balance path matched {} files; load the intended profile explicitly",
            candidates.len()
        ));
    }
    Ok(candidates.remove(0))
}
fn validate(profile: &Value) -> Result<()> {
    if !["buildings", "resources", "units", "population", "castle"]
        .iter()
        .any(|s| profile[*s].is_object())
    {
        return Err("Expected a rebalancer profile".into());
    }
    for section in ["buildings", "resources"] {
        if let Some(value) = profile.get(section) {
            let object = value
                .as_object()
                .ok_or_else(|| format!("Invalid {section} section"))?;
            for (name, stats) in object {
                if !stats.is_object() {
                    return Err(format!("Invalid {section} entry: {name}"));
                }
                let number = |v: &Value, max: u64| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                        .is_some_and(|n| n <= max)
                };
                if section == "buildings" {
                    for field in ["health", "housing"] {
                        if stats.get(field).is_some_and(|v| !number(v, 2147483647)) {
                            return Err(format!("{name}: {field} must be a non-negative integer"));
                        }
                    }
                    if let Some(cost) = stats.get("cost") {
                        if !cost.as_array().is_some_and(|a| {
                            a.len() == 5 && a.iter().all(|n| number(n, 2147483647))
                        }) {
                            return Err(format!(
                                "{name}: cost must contain five non-negative integers"
                            ));
                        }
                    }
                } else {
                    if stats.get("baseDelivery").is_some_and(|n| !number(n, 255)) {
                        return Err(format!("{name}: delivery must fit a byte"));
                    }
                    if stats.get("skirmishBonus").is_some_and(|n| !n.is_boolean()) {
                        return Err(format!("{name}: skirmishBonus must be boolean"));
                    }
                }
            }
        }
    }
    if let Some(v) = profile["castle"].get("ditch_per_pitch") {
        let n = v
            .as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()));
        if !n.is_some_and(|n| (1..=4).contains(&n)) {
            return Err("castle.ditch_per_pitch must be 1, 2, 3 or 4".into());
        }
    }
    Ok(())
}
pub fn read_installed_balance(root: &Path) -> Result<Value> {
    let config_path = root.join("ucp-config.yml");
    let config: Value = serde_yaml::from_slice(&read(&config_path)?).map_err(|e| e.to_string())?;
    if config["active"] == false {
        return Err("Selected UCP configuration is inactive".into());
    }
    let full = config
        .get("config-full")
        .or_else(|| config.get("config"))
        .unwrap_or(&Value::Null);
    let sparse = &config["config-sparse"];
    let order = full["load-order"].as_array();
    if order.is_some_and(|o| !o.iter().any(|e| e["extension"] == "rebalancer")) {
        return Err("Rebalancer is not enabled in the resolved UCP load order".into());
    }
    let section = full["modules"]
        .get("rebalancer")
        .unwrap_or(&sparse["modules"]["rebalancer"]);
    let leaf = &section["config"]["balance_config_file_selector"];
    let contents = leaf.get("contents").unwrap_or(leaf);
    let selector = contents
        .as_str()
        .or_else(|| contents["value"].as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or("No resolved rebalancer profile; load balance JSON explicitly")?;
    let file_path = resolve_selector(root, selector, order)?;
    if fs::metadata(&file_path).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
        return Err("Balance profile is too large".into());
    }
    let mut profile: Value =
        serde_yaml::from_slice(&read(&file_path)?).map_err(|e| e.to_string())?;
    validate(&profile)?;
    let baseline = read_exe_costs(root)?;
    if let Some(buildings) = baseline["buildings"].as_object() {
        let overrides = profile["buildings"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let mut result = buildings.clone();
        for (name, patch) in overrides {
            let current = result.entry(name).or_insert(json!({}));
            for (key, value) in patch.as_object().unwrap() {
                current[key] = value.clone();
            }
        }
        profile["buildings"] = Value::Object(result);
    }
    Ok(
        json!({"profile":profile,"name":file_path.file_name().unwrap().to_string_lossy(),"filePath":file_path,"configPath":config_path,"exePath":baseline["filePath"]}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_exe_is_rejected() {
        assert!(read_cost_table(b"MZ").is_err())
    }
    #[test]
    fn invalid_balance_is_rejected() {
        assert!(validate(&json!({"buildings":{"Keep":{"cost":[1,-2,3,4,5]}}})).is_err());
    }
}
