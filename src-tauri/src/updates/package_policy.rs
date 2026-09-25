//! File classification only; installation and rollback remain in the updater.
//! The same manifest drives ZIP resources and validates the NSIS install hook.
use regex::Regex;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Deserialize)]
struct Executable {
    path: String,
    aliases: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    directory: String,
    stem_pattern: String,
    extension: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    executable: Executable,
    files: BTreeMap<String, String>,
    configuration: Configuration,
    legacy_update_patterns: Vec<String>,
}
struct Policy {
    manifest: Manifest,
    configuration: Regex,
    legacy: Regex,
}
static POLICY: LazyLock<Policy> = LazyLock::new(|| {
    let manifest: Manifest = serde_json::from_str(include_str!(
        "../../../scripts/manifests/native-package.json"
    ))
    .expect("valid checked-in package manifest");
    let config = &manifest.configuration;
    let configuration = Regex::new(&format!(
        r"\A{}/{}{}\z",
        regex::escape(&config.directory),
        config.stem_pattern,
        regex::escape(&config.extension)
    ))
    .expect("valid configuration pattern");
    let legacy = Regex::new(&format!(
        r"\A(?:{})\z",
        manifest.legacy_update_patterns.join("|")
    ))
    .expect("valid legacy update patterns");
    Policy {
        manifest,
        configuration,
        legacy,
    }
});

pub(super) fn canonical_executable() -> &'static str {
    &POLICY.manifest.executable.path
}
pub(super) fn executable_name(name: &str) -> bool {
    POLICY
        .manifest
        .executable
        .aliases
        .iter()
        .any(|alias| alias.eq_ignore_ascii_case(name))
}
pub(super) fn is_configuration(path: &str) -> bool {
    POLICY.configuration.is_match(path)
}
pub(super) fn allowed(path: &str) -> bool {
    executable_name(path)
        || POLICY.manifest.files.contains_key(path)
        || is_configuration(path)
        || POLICY.legacy.is_match(path)
}
