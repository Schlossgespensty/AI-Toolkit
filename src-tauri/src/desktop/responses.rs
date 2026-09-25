//! Fixed native UI metadata. Domain-owned output DTOs live with their producers.
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct InterfaceSettings {
    pub theme: String,
    pub language: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ImageSelection {
    pub file_name: String,
    pub path: PathBuf,
    pub data_url: String,
}

#[derive(Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Skins {
    pub skins: BTreeMap<String, String>,
    pub custom_skin_types: Vec<String>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct EmptyObject {}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(untagged)]
pub enum UnitAssetsResult {
    Loaded(crate::game::UnitAssets),
    Missing(EmptyObject),
}

// The operation/result association is generated with the DTOs. These compile-
// time catalogues are not constructed at runtime; domain JSON stays extensible.
#[cfg(test)]
type JsonObject = serde_json::Map<String, serde_json::Value>;

#[cfg(test)]
#[allow(dead_code)]
#[derive(ts_rs::TS)]
#[ts(rename_all = "kebab-case")]
pub struct DesktopResults {
    interface_settings: InterfaceSettings,
    set_theme: InterfaceSettings,
    list_themes: Vec<crate::themes::ThemePack>,
    set_language: InterfaceSettings,
    load_config: JsonObject,
    installation: Option<String>,
    choose_installation: Option<String>,
    pick_path: Option<String>,
    read_document: crate::storage::DocumentResult,
    write_file: String,
    read_bytes: String,
    scan_library: JsonObject,
    read_project: crate::library::AiProject,
    replace_character: crate::library::CharacterReplacement,
    update_mapping: Option<JsonObject>,
    read_media: JsonObject,
    replace_media: Option<JsonObject>,
    open_media: String,
    open_path: String,
    load_skins: Skins,
    choose_skin: Option<String>,
    remove_skin: bool,
    open_skins: String,
    choose_background: Option<ImageSelection>,
    save_picture: Option<String>,
    ready: bool,
    confirm_close: bool,
    new_window: String,
    confirm: Option<String>,
    clone_ai: Option<JsonObject>,
    create_ai: Option<JsonObject>,
    update_ai: Option<JsonObject>,
    castle_destination: crate::library::CastleDestinationResult,
    add_castle: crate::library::CastleDestinationResult,
    replace_portrait: crate::library::PortraitResult,
    check_update: crate::updates::responses::UpdateStatus,
    update_sources: crate::updates::responses::UpdateSources,
    set_update_source: String,
    prepare_update: crate::updates::responses::PreparedUpdate,
    install_update: bool,
    document_ready: (),
    protect_close: (),
    developer_tools: (),
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(ts_rs::TS)]
#[ts(rename_all = "kebab-case")]
pub struct GameResults {
    buildings: Option<JsonObject>,
    units: UnitAssetsResult,
    resource_icons: BTreeMap<String, String>,
    balance: Option<JsonObject>,
    maps: JsonObject,
    map: Option<JsonObject>,
    tiles: Option<JsonObject>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_game_keeps_the_empty_object_contract_but_loaded_assets_keep_empty_maps() {
        assert_eq!(json!(UnitAssetsResult::Missing(EmptyObject {})), json!({}));
        let assets = crate::game::UnitAssets {
            asset_revision: "revision".into(),
            sprites: BTreeMap::new(),
            idle_sprites: BTreeMap::new(),
            warnings: vec![],
        };
        assert_eq!(
            json!(UnitAssetsResult::Loaded(assets)),
            json!({"assetRevision":"revision","sprites":{},"idleSprites":{},"warnings":[]})
        );
        assert_eq!(
            json!(Skins::default()),
            json!({"skins":{},"customSkinTypes":[]})
        );
    }
}
