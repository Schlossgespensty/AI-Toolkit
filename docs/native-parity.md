# Native desktop parity and acceptance

The native application uses the existing editor, serializers and GPU renderer.
Rust replaces Electron's filesystem, game extraction, window and update services.
This matrix records evidence, not a claim that a passing unit test covers an OS UI.
See [validation](native-preview-validation.md) for measured builds and
[packaging](native-packaging.md) for the download/image audit.

## Evidence levels

- **Live**: exercised in a separate native editor and profile through WebView2/native IPC.
- **Fixture**: real files, codecs or transactions exercised with owned fixtures.
- **Unit**: isolated contracts/state checked automatically.
- **Pending**: implementation exists, but the listed integration has not been verified.

Supplying a test destination is not evidence that the Windows file picker works.
No game was launched or attached to during these checks.

## Compatibility matrix

| Area | Retained behavior and evidence | Remaining acceptance |
| --- | --- | --- |
| Desktop API | Rust-owned serde request envelopes and generated TypeScript; operation/result coverage and invalid-call fixtures. Existing editor API names remain available. | Extensible plugin/document content is intentionally opaque; the whole legacy JS frontend is not claimed to be TypeScript. |
| Classic `.aiv` | Shared codec and classic-format validation; unchanged saves preserve original bytes. Fixture tests and live load/create/clone/save/reopen passed. | Windows Open/Save picker interaction. |
| DE `.aivjson` / `.aijson` | Existing shared import/export and explicit extension selection. Unsupported classic exports fail before writing. Format fixtures pass. | Load an exported castle in DE; DE is installed locally but has not been launched. |
| Character/dialogue JSON | Game keys and unknown fields remain unchanged. Transactional native writes; string and object-valued JSON saves verified through native IPC. | OS Save As interaction and representative dialogue playback. |
| Editable configuration | External config overrides embedded defaults. Custom values, unknown files and nested user config survive updates. Real update, NSIS reinstall/abort and fixture checks pass. | Clean-machine installer run. |
| Library/project lifecycle | Selected installation discovery and last-project restore verified live. Create, clone, update, add character/castle, map slots and reopen verified with an isolated native project. Unknown fields and unchanged castle bytes survive. | Picker-driven add/replace; arbitrary third-party dynamic Lua registration is outside the declarative resolver. |
| Project transactions | Validation precedes mutation. First plugin definition and AI creation commit together; ordinary updates stage only the affected AI. Failure/preservation fixtures pass. | OS-specific permission failures beyond existing fixtures. |
| Portraits/media | Shared 72/36-pixel portrait conversion preserves prior pixel rules. Speech data is returned for browser playback; Bink opens externally. | Image/media pickers, actual audio playback and external Bink association. |
| Custom skins/background | UserData skins override extracted game previews; existing background formats and opacity retained. | Picker and damaged-image UI scenarios. |
| Castle PNG | Full-resolution shared rendering, independent of viewport zoom. Live 8900x8900 PNG export passed without document changes. | OS save picker itself. |
| Editor windows | Window-scoped document events, one atomic readiness/pending state, independent project ownership. Live extra-window check passed. | Mixed-DPI physical multi-monitor checks. |
| Detached 2.5D | Shared theme, language and scene. Native window ownership and close bridge keep editor/viewport lifecycles separate. | Rapid detach/dock race is covered by the follow-up fix and its acceptance check; see validation. |
| Bounds/maximization | Logical bounds and maximized state restored; disconnected-monitor geometry clamps safely. Live restore and geometry tests pass. | Every physical monitor arrangement is not tested. |
| Unsaved changes/dialogs | Shared unsaved gate retained; all native dialogs receive their invoking window as owner. Update and secondary-window guards verified live. | Actual OS modal ownership/keyboard interaction. |
| Menus/shortcuts | File/Edit/View, custom castle bindings, viewport keys, zoom/fullscreen/reload, theme/language submenus retained. Reload uses unsaved gate. | Every OS menu accelerator and keyboard navigation path. |
| Themes | Default/UCP and external theme folders use one semantic token/component system. CSS layers own precedence; detached chrome reuses the same stylesheet. Built WebView contrast checks cover numeric/text/search fields and both themes. | Designer review of final screenshots and physical DPI scaling. |
| Languages | Nine YAML catalogues, 1,728 messages each, checked for completeness/interpolation/references. Live language switching and Persian text direction without mirrored geometry verified. | Native-speaker review of every translated sentence. |
| Game maps and textures | Read-only Rust readers match existing decoder pixels/metadata on GreekSea, A Friend Indeed and Double Trouble, including four camera directions. Selected game/UCP overrides are shared by terrain/buildings/units/icons. | Unusual third-party dynamic Lua override logic is not executed. |
| Troop previews | 20 verified classic stationary marker poses and both lords extracted locally, with native palettes/origins. Cached conserved recruitment quotas, ordered marker remainders and native keep/campfire fallbacks. Lord follows character.lord.Type; units use distinct whole tiles and visible-step support heights. | Static preview does not simulate patrol movement/resources/casualties. Engineer/Monk/Tunneler/DE idle poses remain unverified; unsupported types retain their allocation. |
| Asset cache | Same-root extraction serialized; warm requests preserve metadata and PNG mtimes. Changed game/pack revisions invalidate caches. | No background watcher or automatic old-revision pruning. Reload rechecks sources; old cache retention affects local disk use, not bundle size. |
| Native updater | Dynamic official/fork selection, SHA checks, staged install/rollback, config preservation and installed receipts. Real baseline-to-published update passed. | Native-to-official-Electron migration has fixture coverage, not live acceptance. |
| Electron migration | Unchanged shipped Electron updater installed the published native ZIP in an isolated clone, restarted it, restored the exact selected castle and custom config, and displayed the selected fork as current. | Hard power-loss recovery is not live-tested. |
| Installer/runtime | NSIS and portable startup obtain WebView2 separately only if missing. Portable downloads verify Microsoft's Authenticode signature. Config defaults written only when absent and retained on uninstall. Real NSIS hook/reinstall/abort checks pass. | Clean Windows without WebView2 and its runtime installation. |
| Linux/macOS | CI compiles the native application and runs portable contracts/tests on Windows, Linux and macOS. | CI passes on all three OSes; GUI, installer and updater integration remain Windows-only acceptance. |

## Maintained boundaries

- `src/desktop/` adapts the existing editor API; Rust owns wire contracts.
  Generated bindings are checked for drift and obsolete files. See its README
  for regeneration; do not hand-edit generated TypeScript.
- `scripts/manifests/native-package.json` owns portable files, executable aliases,
  configuration grammar and the 8,000,000-byte download limit. JavaScript packaging,
  Rust update classification and generated NSIS hooks consume/validate that policy.
  Install and update transactions retain their distinct preservation semantics.
- The ordered CSS layers are `tokens`, `layout`, `components`, `theme`,
  `accessibility`. Theme packs provide data/artwork; shared roles define controls.
  Decorative specificity overrides and duplicate detached-window palettes were removed.
- Game source resolution, atlas extraction, atomic file writes and castle codecs
  stay shared. Troop allocation lives separately from pose metadata and rendering.
  Panning/zooming does not rerun the allocation or support-height calculation.

## Release boundaries

The universal native ZIP supports migration through the old Electron updater's
experimental channel. Its small `resources/app.asar` carries verified supplemental
resources, not an Electron runtime. Keep the PR in draft until the
user has tested the preview and the outstanding OS acceptance is understood.

Published `snapshot-native-14f5269c` is 7,396,843 bytes (portable) and 6,740,570
bytes (Setup), with 122 unchanged source images. Its native CI passes on Windows,
Linux and macOS. Chromium, Node, source maps,
authoring files and Firefly sprite pixels are excluded. WebView2 is external.
Every included image must remain byte-identical to its permitted source.

Windows uses SChannel TLS with certificate validation enabled; other targets use
Rustls. The GPU bundle includes the symbols actually used by the existing renderer.
These changes reduce the executable without downscaling/re-encoding artwork.

There is no claim of zero runtime cost or universal OS parity. Startup, input-to-frame
callbacks, GPU submission and physical screen presentation are different measurements.
The validation document names exactly what each benchmark measures.
