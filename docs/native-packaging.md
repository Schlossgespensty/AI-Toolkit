# Native preview packaging

The Windows preview uses Tauri and the installed Microsoft WebView2 runtime. The
runtime is not embedded in either download. NSIS and the portable application
download Microsoft's bootstrapper only when WebView2 is missing.
This keeps the editor download small without reducing image quality or removing
editor features.

## Build

Use Windows x64 with Node 22.12 or later, stable Rust and the Microsoft C++ build
tools. From the repository root:

```powershell
npm ci
npm run check
npm run check:locales
cargo test --locked --manifest-path src-tauri/Cargo.toml
$env:AI_TOOLKIT_RELEASE_REPO = 'Krarilotus/AI-Toolkit'
$env:AI_TOOLKIT_RELEASE_TAG = 'snapshot-native-<commit>'
npm run package:native
```

Set the release identity **before compiling**. The updater compares that embedded
repository/tag with the selected release. The `Native preview` workflow performs
the same build and uploads artifacts; publishing requires its explicit `publish`
input and always creates an experimental `snapshot-*` prerelease. Reusing a tag
does not silently replace an existing release.

## Continuous integration

`Native CI` runs on pull requests, pushes to `main` or `experiment/**`, and manual dispatch. One
matrix compiles the native application and runs Rust unit/contract tests on
Windows, Ubuntu 24.04 and macOS. Each runner also builds the embedded frontend,
checks TypeScript, translations and the package policy, and runs the portable
bridge/package tests. Linux dependencies follow the
[official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

These checks do not start the GUI or publish a release. Passing them demonstrates
compilation and automated logic coverage on those runners, not native dialogs,
WebView rendering, accessibility, installers or in-game compatibility. The local
game parity fixture remains explicitly opt-in; CI does not distribute or start
the game. The separate existing `CI` workflow retains the full JavaScript suite
and Electron renderer checks; the manual `Native preview` workflow owns Windows
packaging, the download-size gate, installer verification and optional publication.

## Build artifacts

Outputs are in `release/native/`: the setup EXE, portable ZIP, SHA256SUMS.txt and
package-report.json. Packaging fails if either download reaches 8,000,000 bytes.
The report records the exact bytes, checksums, portable file list, and dimensions
and hashes of every original image. `--skip-build` only repackages an already-built
binary; it is for inspection, not for claiming source changes are included.

## Payload and compatibility

The portable archive contains the executable, editable config JSON files, the
isometric catalogue, README and dependency/artwork notices. ZIP extraction is
checked byte-for-byte against every input. Immutable config defaults remain
embedded too: the native configuration merge and updater need those baselines to
preserve user customizations. The small duplication is deliberate.

The NSIS installer handles editable configuration through
`scripts/installer/config.nsh`, outside Tauri's generic overwrite/delete resource
list. Its post-install hook writes only missing default JSON files using NSIS
`SetOverwrite off`. Existing files, including unknown custom files and subfolders,
are never moved or overwritten. An interrupted installation therefore cannot
discard their originals. Uninstalling also leaves the editable config folder
intact. The native updater separately handles its verified configuration merge.

`scripts/test-installer.mjs` compiles the production hook into a silent,
registry-free test installer in a fresh temporary folder. It verifies a reinstall
and an aborted installation preserve modified/unknown/nested files byte-for-byte
while adding a missing default. Packaging runs this check against the installed
NSIS toolchain before accepting its output.

The compiled frontend includes all nine language catalogues, Default and UCP theme
packs, and the original permitted editor artwork. It excludes unused atlases,
authoring tokens/schema, Node/Electron backends, source maps, duplicate artwork and
Firefly unit/isometric sprites. Game artwork is read from the selected game and
active texture packs. Every shipped PNG/SVG/ICO is checked against its source bytes;
packaging never resizes, recompresses or substitutes an image.

Runtime dependency licenses are collected from the locked Rust graph and the full
installed JavaScript runtime graph, including transitive Pixi dependencies and the
node-pkware codec attribution. When a published package omitted its license file,
`scripts/licenses/supplemental.json` retains the actual upstream text, pinned source
URL and checksum. Packaging fails on an unresolved notice. Installer-specific
Hungarian and Farsi strings supplement Tauri's built-in translations.

The same ZIP supports already-shipped Electron updaters and native updates.
`resources/app.asar` contains the supplemental resource files and an
executable-bound migration manifest. Native startup validates and restores those
resources when the old installer's allowlist omitted their direct ZIP entries.
The receipt is finalized after the main window opens. No Electron shim or second
browser engine is bundled. See [update channels](update-channels.md).

## Measured baseline

Published `snapshot-native-14f5269c`: **7,396,843 bytes portable ZIP** and
**6,740,570 bytes Setup**. Its audit covers 122 unchanged images and 24 portable
files; real NSIS fresh/reinstall/abort checks pass. The authoritative
`package-report.json` and SHA256SUMS are attached to the release.

The 22 September 2026 `local-preview` build produced:

| Artifact | Bytes | Decimal MB |
| --- | ---: | ---: |
| Portable ZIP | 7,727,157 | 7.73 |
| NSIS setup | 7,075,193 | 7.08 |

The audit checked 121 original images and 23 portable files. These are baseline
measurements, not a published release: later source changes require another packaging run. The generated report is authoritative for
each specific release. There was no image shrinking or lossy conversion.

Focused automated checks cover ZIP contents/round-trip integrity, unchanged image
bytes, rejection of game artwork, and nested runtime dependency license traversal.
Theme checks include discovered custom packs, accessible controls, asynchronous
switching and shared detached-window styling.
