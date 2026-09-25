# Update channels

The top-bar selector chooses official releases or experimental builds from a
Toolkit fork. Forks are discovered from GitHub; Other fork accepts owner/repository
and verifies that the repository belongs to the upstream fork network.

Checks run on startup and hourly for the selected source. Clicking a non-install
status forces a refresh. Releases are paginated and ordered by publication time,
not package version. Official releases exclude drafts and prereleases; fork
channels include prereleases and always display Experimental. Only compatible
fork packages published strictly after the newest official stable release are
offered. Forks without such a package are hidden, and manual selection rejects
them. The list refreshes hourly; an expired selected fork falls back to official.
If the official release cannot be verified, experimental installation is refused. A release must
contain one supported Windows x64 ZIP with a GitHub SHA-256 digest and size.
Missing/unsupported releases and network failures never display Up to date.

The installed receipt records repository and release/asset identity. The native
receipt verifies the executable hash; legacy Electron receipts verify app.asar.
When both hashes are present, both must match before that identity is trusted. This
allows switching channels and handles the historical development version 0.10.0
being numerically higher than newer upstream releases such as 0.7.2.

Selecting a source does not download or install anything. Install downloads and
verifies the chosen build, then uses the existing Save/Discard/Cancel flow and
transactional installer. The receipt participates in file locking, backups and
rollback. User-modified runtime configuration is preserved. A source change
invalidates a previously staged installer, and stale build keys are refused.

Only published release assets are installable: commits without a package and
GitHub Actions artifacts are not releases. Older builds bring their own UI and
updater implementation; switching to a release predating channels also restores
that older updater. Keep the experimental download if switching back is needed.

Validation: release pagination/date ordering, source switching, non-semver snapshot
tags, replaced assets, checksum requirements, cache isolation, fork validation,
receipt invalidation, and a Windows installer exercise with file locks and custom
configuration. Live isolated Electron UI checks found official 0.7.2 and
Krarilotus preview-578a0b9 and switched between them. Full local check: 422 passed,
10 native-fixture tests skipped, zero failures (432 total).

## Electron to native migration

The native portable ZIP also carries `resources/app.asar`, a real archive of its
supplemental resources and an executable-bound migration manifest. This is the
path understood by already-shipped Electron installers. It contains no Chromium
runtime and does not require a separately selected intermediate release.
Direct native files remain in the same ZIP for current native updaters.

At the first legacy-updated start, the native preflight verifies the legacy
receipt and migration manifest before restoring only the declared resource
files. WebView2 is checked before creating a window; if absent, its official
Microsoft bootstrapper is downloaded and its Authenticode signature verified.
The installed WebView2 fast path performs no download or subprocess work.

Settings and project history continue to use the same user data directory.
Editable configuration keeps the old updater's preservation rules. The legacy
transaction backup remains available for recovery, and a native receipt records
the successful handoff. There is still exactly one installable Toolkit ZIP per
release, so older source selectors cannot reject an ambiguous pair of packages.

An already-running older Electron app may still have a pre-migration native
release cached for the current hour. Its old Retry button repeats that same
download after `Incomplete Windows release`. Switch to Official releases and
back to the experimental fork to force a new lookup before installing; this
does not change the open project. The target must be a migration-compatible
release (`snapshot-native-14f5269c` or later on Krarilotus), not the older
`snapshot-native-39659543`. Current UI retries refresh the release information
after an installation failure instead of retaining the failed candidate.

## Windows handoff regression

The original detached + hidden PowerShell launch could report successful process
creation without executing the installer. The editor now launches a helper with
its own hidden console using Start-Process and waits for a unique startup
confirmation before quitting. Installer output is retained in installer.log.
Startup failure leaves the editor open; an installation failure after editor
exit restarts the retained installation. A real Electron regression now verifies
that the helper survives parent exit, replaces the fixture app, writes its receipt
and launches the newly installed executable. Full check: 424 pass, 10 native-fixture
skips, zero failures (434 tests).
