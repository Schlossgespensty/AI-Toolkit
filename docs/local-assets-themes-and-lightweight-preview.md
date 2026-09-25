# Local game assets, editor packs and a lightweight preview

Design baseline: 22 September 2026, `002e40d`.
Work branch: `experiment/local-assets-and-lightweight-ui`.

The design below records the original plan and its rationale. The experimental
implementation now uses Tauri/Rust, local game artwork, independent Default/UCP
themes and nine complete YAML language catalogues. Packaging and measured
acceptance results are recorded in [native-packaging.md](native-packaging.md)
and [native-preview-validation.md](native-preview-validation.md).

The 3D defensive troop formations described below are **not implemented**.
Their frame/anchor research is recorded in
[native-idle-sprite-research.md](native-idle-sprite-research.md). Existing 2D unit
previews do load from the selected game. Source changes are checked when choosing
an installation or loading/reloading a game map; a background filesystem watcher
is not implemented. The preview is Windows x64; Linux/macOS are not validated.

Keep the existing PR unchanged. The user will test the experimental preview
before a new PR is opened.

## Requirements

- Ship editor-owned/permitted artwork, not Firefly game sprites.
- Read game artwork from the selected installation and its active texture
  overrides. Refresh when that source changes, not just during installation.
- Preserve original image quality. No image shrinking or lossy compression.
- One folder defines a complete editor theme/texture pack. Replacing/selecting
  that folder replaces the theme without edits scattered throughout the app.
- Share styles by component role, not individual button identity.
- Centralize all user-facing interface strings and provide one persisted language
  selection, independent of theme and project/game content language.
- Preview defensive troops using cached idle sprites and approximate occupancy,
  with a maximum of nine visible figures per AIV marker.
- Preserve responsive scrubbing, current project restoration, map alignment,
  detached views, export compatibility and update behaviour.
- Treat 8,000,000 bytes as a prospective compressed download budget, measured on
  a real release artifact. It is not an established result or a Discord limit.

## Findings in the current source

`package.json` packages `assets/**/*`. The selected game's graphics therefore do
not prevent the package from redistributing the PNG fallback artwork.

`src/node/game-graphics.js` resolves the installed GM1 files and declarative UCP
file-source registrations in load order. Its revision includes paths, sizes,
modification times and configuration text. Reuse this resolver; do not create
independent rules for unit, map and building textures.

`src/node/game-building-assets.js` already decodes building components in a
worker and caches an atlas locally. Its mapping does not rewrite every legacy
catalogue image reference. `src/js/iso-view.js` still falls back to bundled
artwork when extraction is unavailable. Both need changing before the PNGs can
be excluded without losing previews.

`main.js` loads classic 2D unit images from bundled skins. Resource HUD icons
already come from the selected game's GM1. Local game folders contain the
`body_*` GM1 groups needed for troop sprites, but idle frame IDs, player palettes,
sprite origins and multipart mounted units still require verification.

`src/css/combined.css` already defines shared palette, typography and geometry
variables. `combined-blue.css` duplicates much of its layout; the current index
loads the first stylesheet. Themes should become data, not more stylesheet forks.

There are 18 Node backend JS modules and 42 `ipcMain.handle` registrations.
Electron also owns windows, dialogs, menus, update installation and lifecycle.
A Tauri conversion is a backend/desktop-adapter migration, not a renderer rewrite
or a change to one package dependency.

## Ownership and package boundary

Keep Monsterfish's supplied sidebar/background artwork, respecting the owner's
confirmation of permission. Correct the conflicting sidebar attribution. Keep
the original Toolkit SVG previews and other documented original artwork.
Classify legacy 2D tiles and the item atlas individually; a custom GM1 container
does not by itself establish authorship of every image inside it.

The distributed asset manifest must classify every shipped image as original,
permitted third-party artwork, or a local-only game source. Local-only entries
describe source group/frame/palette metadata and never embed game pixel bytes.
Packaging must use an allowlist and inspect the resulting archive, not rely on
developers remembering to delete a cache directory.

The game asset service owns:

1. Installation and active override resolution.
2. Source identity and revision.
3. Validated GM1 decoding, sprite origins and atlas construction.
4. On-disk derived cache and request coalescing.
5. A single revision notification consumed by all views.

Decode outside the UI thread. Return atlas handles and metadata rather than
repeated base64 copies. Missing sources show neutral editor-owned previews with
an actionable status, never a silent bundled game-art fallback.

On folder selection or pack reload, resolve the entire source revision once.
Do not scan/hash files on render or slider events. Detect filesystem changes
with debouncing and revalidate on app focus/explicit reload. Include source
content hashes when validating suspected changes, so a replacement preserving
timestamps and size can be recovered by explicit reload. Version the decoder
and mapping metadata in the cache key too.

Build the next asset generation fully before swapping it into all views. Reject
late results from an older generation. Retain the previous generation while
loading, show that it is loading, and release obsolete textures after no view
uses them. Theme revisions and game asset revisions are separate.

## One editor pack, with a small hierarchy

Expose selection under **Edit -> Theme**, initially **Default** and **UCP**,
with the active choice checked. UCP is the first alternative/proof-of-concept
pack, not a separate UI implementation. Persist the choice across restarts.

The local UCP GUI reference is `S:/Projects/UCP/UCP3-GUI`. Its
`src/assets/ucp3/` includes `button_ucp.png`, `button_ucp_hover.png`,
`button_ucp_active.png`, checkbox textures and ornament borders. The shared
`src/components/base.css` already uses CSS border-image with eight-pixel slices
for the buttons. Reuse those established assets/scaling choices where provenance
and distribution terms permit, rather than drawing replacements or cloning the
GUI's entire stylesheet. The user explicitly invited this reuse. The repository
contains an AGPLv3 license; establish asset-specific provenance/terms and retain
the required attribution before packaging. Do not infer that assets in its
separate `game-assets` directory are editor-owned merely because they are there.

Apply the UCP pack's sword/checkbox styling to real accessible checkbox controls,
including checked, unchecked, disabled, focus and mixed states where used.
Buttons, tabs and panels should consume shared semantic tokens and texture slots;
no UCP-only copies of editor components. Default/UCP switching is the acceptance
test that the theme boundary actually covers the entire editor.

Proposed installed location: `<userData>/themes/<pack-id>/`.

```text
theme.json
tokens.json
variables.css
textures/
  button.png
  button-pressed.png
  panel.png
  sidebar.png
  backdrop.png
LICENSE.txt
```

Use the published DTCG 2025.10 JSON token format for `tokens.json`, including
standard groups, types and aliases. Use Style Dictionary during pack authoring
to produce `variables.css`; do not invent a token parser/reference language or
bundle the authoring tool into the desktop application. `theme.json` is only
the small application-specific manifest for identity, version and texture slots.
Validate its shape with JSON Schema. The distributed CSS is generated custom
property declarations, not an arbitrary pack stylesheet overriding application
selectors. A pack author changes tokens or replaces texture files in this one
folder, then builds the pack; ordinary users select/import it in one operation.

Use the familiar primitive -> semantic -> component token hierarchy. For
example, button/input/select surface tokens can all alias `surface.control`;
that semantic token can in turn alias a primitive palette or shared texture.
Do not duplicate the resolved colour or texture in every component definition.

Hierarchy, from broadest to most specific:

1. Built-in defaults: a complete usable dark theme.
2. Pack tokens: palette, typography, density, borders and radii.
3. Shared surfaces: control face, panel, toolbar and backdrop textures.
4. Component roles: button, tab, input, select, menu and panel heading.
5. Component states: hover, pressed, selected, disabled and keyboard focus.

An omitted value inherits the previous level. Buttons of the same role share
one definition; changing the common control surface updates every applicable
button/input/select. Do not expose DOM IDs or require per-button images. Semantic
roles such as primary/destructive are shared variants, not bespoke widgets.

The manifest names relative texture paths and scaling modes. Use native CSS
`border-image`/`border-image-slice` for nine-slice framed controls,
`background-repeat` for material surfaces, and `background-size: cover/contain` for
large illustrations. Use logical CSS units for frame thickness and density; do
not stretch ornate corners across the entire button. Native-resolution textures
remain intact, with optional author-supplied high-DPI variants.

Pack data must not contain arbitrary executable JS or unrestricted CSS. Validate
the version, known tokens, component/state names, relative paths, image type and
dimensions. Report a missing optional texture and inherit defaults. Load the
validated generated CSS variables through one theme adapter. Apply the same
definition to the main window, popovers and detached views.

Keep layout/accessibility rules in shared CSS: readable focus rings, minimum
hit areas, disabled behaviour, scrolling and reduced-motion support. A theme
must not override pointer behaviour or canvas transforms. Theme changes should
not decode the game again or rebuild its scene.

Selecting a folder is one operation; optionally importing an archive creates
that same folder. A game texture pack remains resolved from the selected game;
an editor theme must not install into or modify a live game. A single editor
pack can supply all permitted editor artwork without containing game sprites.

## Centralized language, alongside the styling sweep

Use i18next with JSON resources and its existing namespaces, interpolation,
plural rules and fallback support. Do not write a custom translation engine.
Use native `Intl` for locale-aware display formatting. Keep game-file numeric
serialization and format keys invariant, regardless of interface language.

Author resources centrally as `locales/<language>/<area>.yaml`, with areas
such as common, shell, library, character, castle and updates. Shared actions
belong in common; context-dependent labels keep separate meaningful keys. Use
stable semantic keys and typed key checking, not English sentences as IDs.
Compile YAML to JSON at build time; YAML parsing and authoring tooling are not
shipped as runtime dependencies of the frontend.

One application preference selects System or an explicit supported language.
Expose it under **Edit -> Language**, with the active choice checked, next to
the Theme submenu. Do not add separate top-bar selectors for either setting.
Persist it across restart/update and propagate changes to all open/detached
views and native menus. Resolve an unavailable language to English. Load the
chosen language and English fallback once, outside render/slider handlers.
Language changes update UI labels without reloading the project or decoding
game graphics. Keep document edits, selection and active field contents intact.

Audit each UI area for both style ownership and string ownership at the same
time: HTML, dynamically generated controls, context/pie menus, dialogs, native
menus, help text, item/category names, accessible names, status messages, export
warnings and updater/error messages. Translate user-readable error summaries
from stable error codes; retain raw diagnostic details for troubleshooting.
Do not translate user project names, paths, AIC parameter IDs or format enums.

Translate complete messages with named interpolation and pluralization rather
than concatenating fragments. Avoid translated HTML strings; use text bindings
and structured rich-text rendering where help genuinely needs formatting.
Localize shortcut descriptions, while resolving displayed key bindings from
the same shortcut registry that executes them.

Use one locale registry to expose all currently supported UCP languages, verified
against UCP's own registry rather than treating packaged Electron locales as
proof of translation coverage. Mark partial translations honestly and use the
English fallback for missing entries. Interface language is separate from the
AI speech/media language selection that already exists.

Theme packs contain no translated UI labels. Their fonts must fall back to
system fonts with suitable script coverage. Use CSS logical properties and set
document `lang`/`dir`; support right-to-left UI without mirroring castle world
coordinates or compass semantics.

Acceptance checks: missing keys and interpolation/plural mismatches, live
language switching, restart persistence, native/detached views, pseudo-localized
long labels, RTL layout, non-Latin scripts and 100/150/200% display scaling.
Scan source for remaining user-facing literals and triage actual findings rather
than blindly treating every program string as translatable. Keep extraction and
translation checks in development tooling, not the runtime bundle.

## Defensive troop preview

This is a visual estimate, not a simulation of recruitment or troop movement.
The project's help text identifies `DefWalls` as a count from `DefTotal`, not a
percentage. Verify the game/AIC semantics while wiring the estimator.

For the initial approximation:

```text
wallBudget = min(nonnegative DefWalls, nonnegative DefTotal)
activeSlots = nonempty supported DefUnit1..DefUnit8 entries
typeWeight = number of activeSlots naming this troop type
markersOfType = number of matching markers in the complete loaded AIV
estimatedPerMarker = floor(wallBudget * typeWeight /
                           (activeSlots.length * markersOfType))
visibleFigures = min(9, estimatedPerMarker)
```

Repeated recruitment slots deliberately increase that troop type's share. Slots
with no matching marker do not donate their estimated allocation to other types.
Handle empty/unknown unit names and zero denominators explicitly. With 80 wall
defenders, eight equally weighted slots and four Arabian archer markers, the
estimate is 2.5 and the proposed display rounds down to two per marker, matching
the requested example. A zero estimate retains the existing editable marker,
not a misleading population of soldiers. No loaded AIC also retains markers.

Counts use the complete loaded AIV so scrubbing does not redistribute soldiers
across temporarily visible markers. Calculate only when the relevant AIC values
or marker counts/types change. Moving a marker changes its transform, not counts.

Cache idle sprite frames in the same local asset service used for buildings.
Verify direction, foot anchor and player colour. Mounted units may require
compositing body/rider frames; do not guess frame zero for every troop.

Place the first figure at its marker, then south, then other deterministic
positions within a compact 3x3 local formation. Derive height from the supporting
surface and depth-sort against buildings/walls. Avoid placing extra figures off
the tower onto adjacent ground. Rotate the formation in world coordinates with
the castle/camera. Keep marker picking independent from the extra preview figures.

Cache formation commands per marker and update only affected entries. Scrubbing
uses existing visibility/command indexing; pan/zoom changes a view transform.
Idle previews have no animation timer. There is nonzero draw cost: compare frame
times with preview off/on, including a castle with every marker capped at nine.

## Size and runtime choice

Measured Windows ZIP at this baseline: 151,461,092 bytes. The Electron executable
alone contributes 103,716,248 compressed bytes; app.asar contributes 8,513,978.
Removing application graphics cannot make the Electron distribution 8 MB.

A preliminary per-file DEFLATE estimate over src/config/integrations/assets is
8,484,220 bytes today. Excluding only 324 isometric PNGs and 21 classic preview
PNGs gives 4,127,238 bytes. This is NOT a built Tauri artifact: it excludes its
native executable/installer and production dependencies, and is not exact archive
compression. It suggests testing an approximately 4 MB payload plus native shell
budget; it does not prove the target is attainable.

Tauri 2 is the leading candidate because it uses the system WebView. Preserve
the existing web UI and renderer, and port native services behind a typed desktop
API. Rust can help decoding/IO work and packaging; it does not automatically make
the existing JS canvas pipeline faster. Measure rendering on each platform's
WebView rather than assuming equivalent GPU behaviour.

Do not ship a Node sidecar to avoid the port: it undermines the size goal. First
inventory every bridge contract, keep renderer-only pure algorithms in JS/TS,
and port filesystem/settings, binary codecs, asset workers and update operations
behind those contracts. Consider a WASM codec only where sharing existing logic
actually reduces total code and payload.

The small Windows artifact relies on WebView2 being installed or downloaded
separately. A fully offline package including that runtime is a separate, larger
artifact. System dependencies must be documented for Linux too. Do not advertise
an 8 MB self-contained application if dependencies are external.

Use a small Tauri spike to prove real artifact size and to open/save an AIV,
decode a selected game's texture and render the existing canvas. The migration
decision follows these results, including install/startup/update tests. Preserve
the existing updater until the new package format and rollback are verified.

Primary references checked for this plan:

- https://v2.tauri.app/reference/webview-versions/
- https://v2.tauri.app/concept/process-model/
- https://v2.tauri.app/develop/calling-rust/
- https://v2.tauri.app/distribute/windows-installer/
- https://www.designtokens.org/tr/2025.10/format/
- https://styledictionary.com/info/tokens/
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-image-slice
- https://www.i18next.com/principles/namespaces
- https://www.i18next.com/principles/fallback
- https://www.i18next.com/translation-function/plurals

## Implementation order and acceptance checks

1. **Local-only game artwork.** Complete and test the source mappings, unit-frame
   extraction and missing-source behaviour; unify source-change notifications.
   Then exclude game pixel assets and inspect the packaged archive. Test base
   game, Reconquista, folder changes, texture replacement and stale cache recovery.
2. **Theme and localization sweep.** Add a versioned validated pack manifest,
   Default and UCP packs, plus centralized translation resources
   and a persisted language selector. Migrate each UI area once for both concerns.
   Replace duplicate theme CSS and embedded UI strings; check shared controls,
   native menus and detached views. Verify long translations, RTL, 100/150/200%
   scaling and narrow panels without stretched corners or clipped labels.
3. **Troop preview.** Verify source frames, AIC/type mapping, weighted counts,
   surface alignment and max-nine formations. Test missing AIC, repeated slots,
   zero counts, rotation, camera changes, marker moves and build-step visibility.
4. **Lightweight shell spike.** Produce an actual Tauri artifact, report bytes
   and cold/warm startup on the same project, and document missing native API
   coverage. No advertised feature-complete release while contracts are missing.
5. **Preview release.** After feature parity and archive checks, publish on the
   experiment branch with its own explicit update source. Verify install, restart,
   last-project/window restoration and rollback from the user's real shortcut.

For performance, use the maximized, correctly zoomed GreekSea/Kratoloros fixture
and the reported Double Trouble map. Alternate steps 100/900 about five times a
second, include nearby uncached steps, resize both panes, and toggle overlays.
Record median/p95/worst input and render latency, long tasks, CPU and retained
memory. Compare identical scenes/hardware before and after. No smooth-only or
zoomed-out substitute for the user's actual interaction.

Keep modules small by ownership: asset resolution/decoding, theme schema/loading,
localization resources/service, pure troop estimation, renderer integration and desktop adapters. Use explicit
types at boundaries and one shared definition for each format. Avoid parallel
legacy implementations and speculative abstraction layers. Remove replaced
paths only after parity tests pass; do not preserve dead fallbacks indefinitely.
