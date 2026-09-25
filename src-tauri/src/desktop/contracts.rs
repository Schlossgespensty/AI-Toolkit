//! IPC envelopes are closed and typed; editable document JSON remains opaque.
//! TypeScript bindings are generated from these serde types by the test below.
use serde::{Deserialize, Serialize};

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct FileDialog {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub default_path: Option<String>,
    #[serde(default)]
    pub filters: Option<Vec<FileFilter>>,
    #[serde(default)]
    pub directory: Option<bool>,
    #[serde(default)]
    pub save: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocation {
    pub game_root: String,
    pub ai_root: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct ReadProject {
    #[serde(flatten)]
    pub project: ProjectLocation,
    #[serde(default)]
    pub castle_file: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct MediaRequest {
    #[serde(flatten)]
    pub project: ProjectLocation,
    pub kind: String,
    pub mapping_relative_path: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct ReplaceMedia {
    #[serde(flatten)]
    pub media: MediaRequest,
    pub dialog: FileDialog,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct ReplaceCharacter {
    #[serde(flatten)]
    pub project: ProjectLocation,
    // Preserve exact AIC/AI-content bytes, including unknown plugin fields.
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct UpdateMapping {
    #[serde(flatten)]
    pub project: ProjectLocation,
    pub slots: Vec<Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct AiIdentity {
    pub game_root: String,
    pub ai_id: String,
    pub name: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct CloneAi {
    #[serde(flatten)]
    pub identity: AiIdentity,
    pub source_ai_root: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct CreateAi {
    #[serde(flatten)]
    pub identity: AiIdentity,
    pub character_content: String,
    pub castle_base64: String,
    #[serde(default)]
    pub portrait_base64: Option<String>,
    #[serde(default)]
    pub portrait_small_base64: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct UpdateAi {
    pub game_root: String,
    pub ai_id: String,
    pub character_content: String,
    #[serde(default)]
    pub castle_file: Option<String>,
    #[serde(default)]
    pub castle_base64: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct CastleDestination {
    #[serde(flatten)]
    pub project: ProjectLocation,
    pub file_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct AddCastle {
    #[serde(flatten)]
    pub destination: CastleDestination,
    #[serde(default, skip_serializing_if = "is_false")]
    pub overwrite: bool,
    pub castle_base64: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(rename_all = "camelCase")]
pub struct ReplacePortrait {
    #[serde(flatten)]
    pub project: ProjectLocation,
    pub kind: String,
    pub base64: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(
    tag = "operation",
    content = "payload",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    InterfaceSettings,
    SetTheme {
        theme: String,
    },
    ListThemes,
    SetLanguage {
        language: String,
    },
    LoadConfig {
        file: String,
    },
    Installation,
    ChooseInstallation(FileDialog),
    PickPath(FileDialog),
    ReadDocument {
        path: String,
        #[serde(default, skip_serializing_if = "is_false")]
        castle: bool,
    },
    WriteFile {
        path: String,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        base64: Option<String>,
    },
    ReadBytes {
        path: String,
    },
    ScanLibrary {
        game_root: String,
    },
    ReadProject(ReadProject),
    ReplaceCharacter(ReplaceCharacter),
    UpdateMapping(UpdateMapping),
    ReadMedia(MediaRequest),
    ReplaceMedia(ReplaceMedia),
    OpenMedia(MediaRequest),
    OpenPath {
        game_root: String,
        #[serde(default)]
        target_path: Option<String>,
    },
    LoadSkins,
    ChooseSkin {
        item_type: u32,
        dialog: FileDialog,
    },
    RemoveSkin {
        item_type: u32,
    },
    OpenSkins,
    ChooseBackground(FileDialog),
    SavePicture {
        png: String,
        dialog: FileDialog,
    },
    Ready,
    ConfirmClose,
    NewWindow,
    Confirm {
        title: String,
        message: String,
        choices: Vec<String>,
        values: Vec<Option<String>>,
    },
    CloneAi(CloneAi),
    CreateAi(CreateAi),
    UpdateAi(UpdateAi),
    CastleDestination(CastleDestination),
    AddCastle(AddCastle),
    ReplacePortrait(ReplacePortrait),
    CheckUpdate {
        #[serde(default, skip_serializing_if = "is_false")]
        force: bool,
    },
    UpdateSources,
    SetUpdateSource {
        repo: String,
    },
    PrepareUpdate {
        key: String,
    },
    InstallUpdate,
    DocumentReady,
    ProtectClose,
    DeveloperTools,
}

#[derive(Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(optional_fields = nullable))]
#[serde(tag = "operation", content = "payload", rename_all = "kebab-case")]
pub enum GameRequest {
    Buildings,
    Units,
    ResourceIcons,
    Balance,
    Maps,
    Map { path: String },
    Tiles { path: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use ts_rs::TS;

    #[test]
    fn generated_bindings_match_rust_contracts() {
        let committed =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/desktop/generated");
        let generated =
            std::env::temp_dir().join(format!("toolkit-contracts-{}", std::process::id()));
        // Tauri's serde_json wire carries JSON numbers, never JS bigint values.
        let config = ts_rs::Config::default()
            .with_large_int("number")
            .with_out_dir(&generated);
        Request::export_all(&config).unwrap();
        GameRequest::export_all(&config).unwrap();
        super::super::responses::DesktopResults::export_all(&config).unwrap();
        super::super::responses::GameResults::export_all(&config).unwrap();
        if std::env::var_os("UPDATE_DESKTOP_BINDINGS").is_some() {
            std::fs::create_dir_all(&committed).unwrap();
        }
        for entry in walkdir::WalkDir::new(&generated).min_depth(1) {
            let entry = entry.unwrap();
            if !entry.file_type().is_file() {
                continue;
            }
            let expected = std::fs::read_to_string(entry.path()).unwrap();
            let target = committed.join(entry.path().strip_prefix(&generated).unwrap());
            if std::env::var_os("UPDATE_DESKTOP_BINDINGS").is_some() {
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(&target, &expected).unwrap();
            }
            assert_eq!(
                std::fs::read_to_string(&target)
                    .unwrap()
                    .replace("\r\n", "\n"),
                expected,
                "Regenerate IPC types with UPDATE_DESKTOP_BINDINGS=1 cargo test desktop::contracts"
            );
        }
        let names = |folder: &std::path::Path| -> std::collections::BTreeSet<_> {
            walkdir::WalkDir::new(folder)
                .min_depth(1)
                .into_iter()
                .map(|entry| entry.unwrap())
                .filter(|entry| entry.file_type().is_file())
                .map(|entry| entry.path().strip_prefix(folder).unwrap().to_path_buf())
                .collect()
        };
        assert_eq!(
            names(&committed),
            names(&generated),
            "Remove obsolete generated IPC types"
        );
        std::fs::remove_dir_all(generated).unwrap();
    }

    #[test]
    fn request_variants_reject_wrong_payloads_before_side_effects() {
        for wire in [
            json!({"operation":"unknown","payload":{}}),
            json!({"operation":"read-document","payload":{"file":"a.aiv"}}),
            json!({"operation":"choose-skin","payload":{"itemType":"7","dialog":{}}}),
            json!({"operation":"update-mapping","payload":{"gameRoot":"game","aiRoot":"ai","slots":{}}}),
        ] {
            assert!(serde_json::from_value::<Request>(wire).is_err());
        }
        assert!(serde_json::from_value::<GameRequest>(json!({"operation":"map"})).is_err());
    }

    #[test]
    fn document_payloads_and_cancel_values_roundtrip_without_interpretation() {
        let content = "{\n  \"unknownPlugin\": {\"null\":null,\"values\":[18446744073709551615,true,\"\u{200f}\"]}\n}";
        let wire = json!({"operation":"replace-character","payload":{"gameRoot":"game","aiRoot":"ai","content":content}});
        let request: Request = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), wire);
        let wire = json!({"operation":"confirm","payload":{"title":"t","message":"m","choices":["Save","Discard","Cancel"],"values":["save","discard",null]}});
        let request: Request = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), wire);
    }

    #[test]
    fn absent_and_null_optional_fields_keep_picker_and_project_semantics() {
        for payload in [
            json!({}),
            json!({"title":null,"defaultPath":null,"filters":null}),
        ] {
            let request: Request =
                serde_json::from_value(json!({"operation":"pick-path","payload":payload})).unwrap();
            let Request::PickPath(dialog) = request else {
                panic!("wrong variant")
            };
            assert!(dialog.title.is_none());
            assert!(dialog.default_path.is_none());
            assert!(dialog.filters.is_none());
            assert_ne!(dialog.directory, Some(true));
            assert_ne!(dialog.save, Some(true));
        }
        for optional in [json!({}), json!({"castleFile":null,"castleBase64":null})] {
            let mut payload = json!({"gameRoot":"game","aiId":"ai","characterContent":"{\"unknownPlugin\":true}"});
            payload
                .as_object_mut()
                .unwrap()
                .extend(optional.as_object().unwrap().clone());
            let request: Request =
                serde_json::from_value(json!({"operation":"update-ai","payload":payload})).unwrap();
            let Request::UpdateAi(update) = request else {
                panic!("wrong variant")
            };
            assert!(update.castle_file.is_none());
            assert!(update.castle_base64.is_none());
            assert_eq!(update.character_content, "{\"unknownPlugin\":true}");
        }
    }
}
