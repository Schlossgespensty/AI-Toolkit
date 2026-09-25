//! Stable, localizable desktop errors. OS/parser details remain diagnostic data.
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "NativeError", optional_fields = nullable))]
pub struct Error {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
}
impl Error {
    pub fn diagnostic(error: impl std::fmt::Display) -> Self {
        error.to_string().into()
    }
    pub fn new(code: &str) -> Self {
        Self {
            code: format!("nativeErrors:{code}"),
            details: None,
            arguments: None,
        }
    }
    pub fn with_arguments(code: &str, arguments: Value) -> Self {
        Self {
            arguments: Some(arguments),
            ..Self::new(code)
        }
    }
}
impl From<String> for Error {
    fn from(details: String) -> Self {
        Self {
            details: Some(details),
            ..Self::new("operation_failed")
        }
    }
}
impl From<&str> for Error {
    fn from(details: &str) -> Self {
        details.to_string().into()
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(details) = &self.details {
            write!(f, ": {details}")?;
        }
        Ok(())
    }
}
impl std::error::Error for Error {}
