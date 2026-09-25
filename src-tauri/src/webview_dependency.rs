//! Prepare WebView2 before Tauri creates any webview, including after a legacy
//! updater replaces the executable without running the new NSIS installer.

pub(crate) fn ensure() -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure_with(&mut windows::Setup).map_err(|error| {
            format!(
                "AI Toolkit needs Microsoft Edge WebView2 to start.\n\n{error}\n\n\
                 Check your internet connection and try again. You can also install \
                 the Evergreen WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/."
            )
        })
    }
    #[cfg(not(windows))]
    Ok(())
}

/// This must also work when WebView2 is absent and Tauri has not been initialized.
pub(crate) fn notify_error(message: &str) {
    #[cfg(windows)]
    windows::notify_error(message);
    #[cfg(not(windows))]
    eprintln!("{message}");
}

#[cfg(any(windows, test))]
trait RuntimeSetup {
    type Bootstrapper;

    fn available(&mut self) -> bool;
    fn download(&mut self) -> Result<Self::Bootstrapper, String>;
    fn verify(&mut self, bootstrapper: &Self::Bootstrapper) -> Result<(), String>;
    fn install(&mut self, bootstrapper: &Self::Bootstrapper) -> Result<(), String>;
}

#[cfg(any(windows, test))]
fn ensure_with(setup: &mut impl RuntimeSetup) -> Result<(), String> {
    if setup.available() {
        return Ok(());
    }
    let bootstrapper = setup.download()?;
    setup.verify(&bootstrapper)?;
    setup.install(&bootstrapper)?;
    if !setup.available() {
        return Err("WebView2 installation finished, but its runtime is still unavailable. Restart Windows if the installer requested it, then try again.".into());
    }
    Ok(())
}

#[cfg(any(windows, test))]
const MAX_BOOTSTRAPPER_BYTES: u64 = 16 * 1024 * 1024;

#[cfg(any(windows, test))]
fn trusted_download_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url
            .host_str()
            .is_some_and(|host| host == "microsoft.com" || host.ends_with(".microsoft.com"))
}

#[cfg(any(windows, test))]
fn copy_bootstrapper(
    reader: impl std::io::Read,
    writer: &mut impl std::io::Write,
) -> Result<(), String> {
    let bytes = std::io::copy(&mut reader.take(MAX_BOOTSTRAPPER_BYTES + 1), writer)
        .map_err(|error| format!("Could not save the WebView2 installer: {error}"))?;
    if bytes == 0 || bytes > MAX_BOOTSTRAPPER_BYTES {
        return Err("The downloaded WebView2 installer has an unexpected size.".into());
    }
    Ok(())
}

#[cfg(windows)]
mod windows {
    use super::{copy_bootstrapper, trusted_download_url, RuntimeSetup, MAX_BOOTSTRAPPER_BYTES};
    use std::{
        fs::{self, File, OpenOptions},
        os::windows::{fs::OpenOptionsExt, process::CommandExt},
        path::PathBuf,
        process::{Child, Command, ExitStatus, Stdio},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    // The same Microsoft evergreen link is used by Tauri's NSIS bootstrapper.
    // https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
    const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    const INSTALLER_NAME: &str = "MicrosoftEdgeWebview2Setup.exe";
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const FILE_SHARE_READ: u32 = 1;

    pub(super) struct Setup;

    pub(super) struct Bootstrapper {
        // Keep this handle open through verification and execution, denying write
        // and delete sharing so that the verified executable cannot be replaced.
        // Fields drop in declaration order: release the handle before cleanup.
        _file: File,
        directory: DownloadDirectory,
    }

    impl Bootstrapper {
        fn path(&self) -> PathBuf {
            self.directory.0.join(INSTALLER_NAME)
        }
    }

    struct DownloadDirectory(PathBuf);

    impl DownloadDirectory {
        fn create() -> Result<Self, String> {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos();
            for attempt in 0..32 {
                let path = std::env::temp_dir().join(format!(
                    "ai-toolkit-webview2-{}-{timestamp}-{attempt}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Ok(Self(path)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        return Err(format!("Could not prepare the WebView2 download: {error}"));
                    }
                }
            }
            Err("Could not create a temporary directory for the WebView2 download.".into())
        }
    }

    impl Drop for DownloadDirectory {
        fn drop(&mut self) {
            // Remove only the file and directory this attempt created.
            let _ = fs::remove_file(self.0.join(INSTALLER_NAME));
            let _ = fs::remove_dir(&self.0);
        }
    }

    impl RuntimeSetup for Setup {
        type Bootstrapper = Bootstrapper;

        fn available(&mut self) -> bool {
            // Calls the WebView2 loader without creating a webview, running a
            // subprocess, or starting a network request on ordinary launches.
            tauri::webview_version()
                .is_ok_and(|version| !version.trim().is_empty() && version.trim() != "0.0.0.0")
        }

        fn download(&mut self) -> Result<Bootstrapper, String> {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(120))
                .https_only(true)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() >= 5 {
                        attempt.error("Too many WebView2 download redirects")
                    } else if trusted_download_url(attempt.url()) {
                        attempt.follow()
                    } else {
                        attempt.error("WebView2 download redirected outside Microsoft HTTPS")
                    }
                }))
                .build()
                .map_err(|error| format!("Could not prepare the WebView2 download: {error}"))?;
            let response = client
                .get(BOOTSTRAPPER_URL)
                .send()
                .and_then(reqwest::blocking::Response::error_for_status)
                .map_err(|error| format!("Could not download WebView2 from Microsoft: {error}"))?;
            if !trusted_download_url(response.url()) {
                return Err("The WebView2 download did not come from Microsoft HTTPS.".into());
            }
            if response
                .content_length()
                .is_some_and(|size| size == 0 || size > MAX_BOOTSTRAPPER_BYTES)
            {
                return Err("The downloaded WebView2 installer has an unexpected size.".into());
            }
            let directory = DownloadDirectory::create()?;
            let path = directory.0.join(INSTALLER_NAME);
            {
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .share_mode(0)
                    .open(&path)
                    .map_err(|error| format!("Could not save the WebView2 installer: {error}"))?;
                copy_bootstrapper(response, &mut file)?;
                file.sync_all()
                    .map_err(|error| format!("Could not save the WebView2 installer: {error}"))?;
            }
            let file = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&path)
                .map_err(|error| format!("Could not protect the WebView2 installer: {error}"))?;
            Ok(Bootstrapper {
                _file: file,
                directory,
            })
        }

        fn verify(&mut self, bootstrapper: &Bootstrapper) -> Result<(), String> {
            // Authenticode uses the Windows trust store. Require both a valid
            // signature and Microsoft's exact publisher name; never execute an
            // unsigned payload, even if it was received over a trusted HTTPS URL.
            // Pass the path as data, not interpolated PowerShell source.
            const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
    $signature = Get-AuthenticodeSignature -LiteralPath $env:AI_TOOLKIT_WEBVIEW2_BOOTSTRAPPER
    if ($signature.Status -ne 'Valid') { exit 10 }
    if ($null -eq $signature.SignerCertificate) { exit 10 }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne 'Microsoft Corporation') { exit 11 }
    exit 0
} catch { exit 12 }
"#;
            let system_root = std::env::var_os("SystemRoot").ok_or_else(|| {
                "Could not locate Windows to verify the WebView2 installer.".to_string()
            })?;
            let powershell_root =
                PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0");
            let mut child = Command::new(powershell_root.join("powershell.exe"))
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    SCRIPT,
                ])
                .env("AI_TOOLKIT_WEBVIEW2_BOOTSTRAPPER", bootstrapper.path())
                // A pwsh parent may export incompatible PowerShell 7 modules.
                // Use Windows' built-in Authenticode command exclusively.
                .env("PSModulePath", powershell_root.join("Modules"))
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("Could not verify the WebView2 installer: {error}"))?;
            let status = wait_for(
                &mut child,
                Duration::from_secs(60),
                "WebView2 signature verification",
            )?;
            match status.code() {
                Some(0) => Ok(()),
                Some(10) => {
                    Err("The WebView2 installer does not have a valid trusted signature.".into())
                }
                Some(11) => {
                    Err("The WebView2 installer is not signed by Microsoft Corporation.".into())
                }
                _ => Err(
                    "Windows could not verify the WebView2 installer's Microsoft signature.".into(),
                ),
            }
        }

        fn install(&mut self, bootstrapper: &Bootstrapper) -> Result<(), String> {
            // The Microsoft installer may show progress. No elevation is forced:
            // Microsoft supports per-user installation from a normal process.
            let mut child = Command::new(bootstrapper.path())
                .arg("/install")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("Could not start the WebView2 installer: {error}"))?;
            let status = wait_for(
                &mut child,
                Duration::from_secs(600),
                "WebView2 installation",
            )?;
            match status.code() {
                Some(0 | 3010) => Ok(()),
                Some(code) => Err(format!(
                    "The WebView2 installer failed or was cancelled (exit code {code})."
                )),
                None => Err("The WebView2 installer stopped before completing.".into()),
            }
        }
    }

    fn wait_for(
        child: &mut Child,
        timeout: Duration,
        operation: &str,
    ) -> Result<ExitStatus, String> {
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return Ok(status),
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Could not complete {operation}: {error}"));
                }
            }
            if started.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{operation} timed out. Please try again."));
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    pub(super) fn notify_error(message: &str) {
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(
                window: *mut std::ffi::c_void,
                text: *const u16,
                caption: *const u16,
                kind: u32,
            ) -> i32;
        }
        let message: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let caption: Vec<u16> = "AI Toolkit startup".encode_utf16().chain(Some(0)).collect();
        // Native, ownerless error dialog; requires neither Tauri nor WebView2.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                caption.as_ptr(),
                0x00010010,
            );
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn unsigned_payload_is_locked_rejected_and_cleaned_up_without_execution() {
            let directory = DownloadDirectory::create().unwrap();
            let path = directory.0.join(INSTALLER_NAME);
            fs::write(
                &path,
                b"This is an unsigned test payload, not an executable.",
            )
            .unwrap();
            let file = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&path)
                .unwrap();
            let bootstrapper = Bootstrapper {
                _file: file,
                directory,
            };
            assert!(OpenOptions::new().write(true).open(&path).is_err());
            assert!(fs::remove_file(&path).is_err());
            assert_eq!(
                Setup.verify(&bootstrapper).unwrap_err(),
                "The WebView2 installer does not have a valid trusted signature."
            );
            drop(bootstrapper);
            assert!(!path.exists());
            assert!(!path.parent().unwrap().exists());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, collections::VecDeque, rc::Rc};

    struct Artifact(Rc<Cell<bool>>);

    impl Drop for Artifact {
        fn drop(&mut self) {
            self.0.set(true);
        }
    }

    struct FakeSetup {
        availability: VecDeque<bool>,
        calls: Vec<&'static str>,
        failure: Option<&'static str>,
        cleaned_up: Rc<Cell<bool>>,
    }

    impl FakeSetup {
        fn new(availability: impl IntoIterator<Item = bool>) -> Self {
            Self {
                availability: availability.into_iter().collect(),
                calls: Vec::new(),
                failure: None,
                cleaned_up: Rc::new(Cell::new(false)),
            }
        }

        fn step(&mut self, name: &'static str) -> Result<(), String> {
            self.calls.push(name);
            if self.failure == Some(name) {
                Err(format!("{name} failed"))
            } else {
                Ok(())
            }
        }
    }

    impl RuntimeSetup for FakeSetup {
        type Bootstrapper = Artifact;

        fn available(&mut self) -> bool {
            self.calls.push("detect");
            self.availability.pop_front().expect("unexpected detection")
        }

        fn download(&mut self) -> Result<Artifact, String> {
            self.step("download")?;
            Ok(Artifact(self.cleaned_up.clone()))
        }

        fn verify(&mut self, _: &Artifact) -> Result<(), String> {
            self.step("verify")
        }

        fn install(&mut self, _: &Artifact) -> Result<(), String> {
            self.step("install")
        }
    }

    #[test]
    fn existing_runtime_never_downloads_or_installs() {
        let mut setup = FakeSetup::new([true]);
        assert!(ensure_with(&mut setup).is_ok());
        assert_eq!(setup.calls, ["detect"]);
    }

    #[test]
    fn missing_runtime_is_verified_installed_and_detected_again() {
        let mut setup = FakeSetup::new([false, true]);
        assert!(ensure_with(&mut setup).is_ok());
        assert_eq!(
            setup.calls,
            ["detect", "download", "verify", "install", "detect"]
        );
        assert!(setup.cleaned_up.get());
    }

    #[test]
    fn failures_stop_before_any_later_step_and_clean_up_downloads() {
        for (failure, expected) in [
            ("download", vec!["detect", "download"]),
            ("verify", vec!["detect", "download", "verify"]),
            ("install", vec!["detect", "download", "verify", "install"]),
        ] {
            let mut setup = FakeSetup::new([false]);
            setup.failure = Some(failure);
            assert_eq!(ensure_with(&mut setup), Err(format!("{failure} failed")));
            assert_eq!(setup.calls, expected);
            assert_eq!(setup.cleaned_up.get(), failure != "download");
        }
    }

    #[test]
    fn successful_installer_without_runtime_is_an_error() {
        let mut setup = FakeSetup::new([false, false]);
        assert!(ensure_with(&mut setup)
            .unwrap_err()
            .contains("still unavailable"));
        assert!(setup.cleaned_up.get());
    }

    #[test]
    fn downloads_only_allow_microsoft_https() {
        for url in [
            "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
            "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/setup.exe",
        ] {
            assert!(
                trusted_download_url(&url::Url::parse(url).unwrap()),
                "{url}"
            );
        }
        for url in [
            "http://go.microsoft.com/setup.exe",
            "https://microsoft.com.attacker.example/setup.exe",
            "https://notmicrosoft.com/setup.exe",
            "https://user:password@go.microsoft.com/setup.exe",
            "https://go.microsoft.com:8443/setup.exe",
        ] {
            assert!(
                !trusted_download_url(&url::Url::parse(url).unwrap()),
                "{url}"
            );
        }
    }

    #[test]
    fn downloads_reject_empty_and_unbounded_bodies() {
        assert!(copy_bootstrapper(std::io::empty(), &mut std::io::sink()).is_err());
        assert!(copy_bootstrapper(std::io::repeat(0), &mut std::io::sink()).is_err());
        let mut output = Vec::new();
        assert!(copy_bootstrapper(&b"installer bytes"[..], &mut output).is_ok());
        assert_eq!(output, b"installer bytes");
    }
}
