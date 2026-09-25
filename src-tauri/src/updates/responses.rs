//! Release UI response shapes; GitHub's broader API objects remain opaque.
use serde::Serialize;

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ReleaseAsset {
    pub id: u64,
    pub url: Option<String>,
    pub size: u64,
    pub sha256: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub repo: String,
    pub experimental: bool,
    pub key: Option<String>,
    pub latest: Option<String>,
    pub published_at: Option<String>,
    pub installed: String,
    pub url: Option<String>,
    pub asset: Option<ReleaseAsset>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum UpdateStatus {
    Current {
        #[serde(flatten)]
        release: ReleaseInfo,
    },
    Available {
        #[serde(flatten)]
        release: ReleaseInfo,
    },
    Unsupported {
        #[serde(flatten)]
        release: ReleaseInfo,
    },
    Empty {
        repo: String,
        experimental: bool,
    },
    Error {
        repo: String,
        error: crate::error::Error,
    },
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct UpdateSources {
    pub selected: String,
    pub repos: Vec<String>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PreparedUpdate {
    pub version: Option<String>,
    pub key: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn release_status_preserves_missing_fields_null_asset_and_structured_errors() {
        assert_eq!(
            json!(UpdateStatus::Empty {
                repo: "owner/repo".into(),
                experimental: true
            }),
            json!({"status":"empty","repo":"owner/repo","experimental":true})
        );
        assert_eq!(
            json!(UpdateStatus::Error {
                repo: "owner/repo".into(),
                error: crate::error::Error::new("invalid_github_response")
            }),
            json!({"status":"error","repo":"owner/repo","error":{"code":"nativeErrors:invalid_github_response"}})
        );
        let release = ReleaseInfo {
            repo: "owner/repo".into(),
            experimental: false,
            key: None,
            latest: Some("v1".into()),
            published_at: Some("date".into()),
            installed: "old".into(),
            url: Some("url".into()),
            asset: None,
        };
        assert_eq!(
            json!(UpdateStatus::Unsupported { release }),
            json!({
                "status":"unsupported","repo":"owner/repo","experimental":false,"key":null,
                "latest":"v1","publishedAt":"date","installed":"old","url":"url","asset":null
            })
        );
    }
}
