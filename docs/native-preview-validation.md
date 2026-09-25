# Native preview validation

Windows x64, 23 September 2026. Native compilation/tests now also pass on
Linux/macOS; their OS GUI and updater integration remain untested.

## Gate roofs, unit proportions and UCP toolbar polish: 6f18150b

Preview tag: `snapshot-native-6f18150b`; build source:
`6f18150bd4db4313f125a7d45c28765b3a70c630`.

All four gatehouse variants now use the game's **128-pixel roof height**, rather
than the 90-pixel wall height. Gatekeeper's slinger markers were already centred;
the incorrect height drew them 38 pixels too low. A real-sprite comparison
reproduces the front-edge placement before the fix and the centred roof placement
after it. Shared routing retains its explicit deck-to-wall/stair links.
The 2D renderer preserves each unit thumbnail's aspect ratio inside the existing
marker box, instead of stretching trimmed images into a square.

Focused checks: **51 troop/routing tests** and **10 canvas geometry cases** pass.
Toolbar/palette visual checks pass, with Default toolbar styling unchanged.
The standalone theme starter is **1.6.0**, containing all **165 variables** and
**33 texture roles**. Packaging passed compilation, installer checks, all nine
complete catalogues (**1,728 messages each**) and the image audit: all **122
packaged images** remain byte-identical to their originals.

Package: **7,403,128 bytes portable / 6,746,690 bytes Setup**. Portable SHA-256:
`357cc49d16a92083260b2f4ac771d598d8835e8b0a38c813004c73d3fb10e910`.
At the user's request, this quick fix did not rerun the full test suite or
performance benchmark. The sections below retain their historical build results;
those timings and full-suite counts are not measurements of this preview.

## Conserved defenders, lords and UCP numeric controls: a972e2eb

Defensive preview quotas follow the active recruitment cycle, aggregate repeated
types, then distribute each type over its markers in stable round-robin order.
`None` terminates the active slots; a type without a verified sprite still keeps
its quota. Four hundred varied deterministic cases match an independent per-unit
recruitment/smallest-group simulation. Gatekeeper's 144 wall defenders allocate
72 Arabian archers, 36 European archers, 18 slingers and 18 Arabian swordsmen.
The last group has no markers and uses the game's keep fallback; light unmatched
types use the campfire. This remains a stationary preview, not a patrol simulation.

The character's `lord.Type` selects the European/Arabian idle sprite at the centre
of its visible keep. Both sprites come from the selected game, with native pixel
origins and the verified 92-pixel keep deck. Synthetic standby/lord groups never
alter the saved AIV. Full allocation, bounded visual representatives and render
geometry are separate concerns. Allocation and resolved anchor identities remain
stable across ordinary build-step changes; pan/zoom still reuses the scene.

The UCP brush control uses the source GUI's orange native number spinner. Its
toolbar commands are two pixels taller, with labels one pixel lower. Default
retains its existing metrics and external plus/minus buttons. The standalone
starter is version 1.5.0, with all 154 variables and 33 texture roles.

Checks: **579 JavaScript tests and 71 Rust tests pass**, plus strict desktop
TypeScript, all nine catalogues, installer hooks and package audits. The local
game integration test remains opt-in. [CI at the release commit](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35794440829)
passes on Windows, Linux and macOS.

Package: **7,402,828 bytes portable / 6,746,281 bytes Setup**, 24 portable files,
and all 122 packaged images byte-identical to their source files. ZIP SHA-256:
`0c7b736a13643792cdcece2e4df984cd43371f8c74bac9d5a196575c436527ac`.
The new sprites add metadata and extraction support, not bundled game artwork.

Packaged WebView checks verify all four Gatekeeper quotas and exact marker
remainders, nine representative swordsmen plus one lord on distinct integer
keep tiles, and both lord choices through the actual bound Character select.
The centre tile is (46,46) above a keep at (43,43); elevation is terrain 80 + deck
92 = 172. An in-memory fixture without Slinger markers preserves its 18-unit
quota and renders nine campfire representatives at ground elevation 80; nearby
castle structures occlude part of that view. The original document and character
were restored exactly, with a clean final dirty state. UCP native up/down and
Default plus/minus each change brush size 3 → 4 → 3.

Matched e2ed/a972 runs use GreekSea/Kratoloros, 998 steps, both GPU views and
the same maximized 2560-by-1392 window, zoom 0.2790625 and panX 470. The requested
two-pixel taller UCP toolbar reduces canvas heights by two pixels and changes
centred panY from 393.75 to 392.75. The old harness's exact layout assertion
flagged this intended change; no application fix or favourable zoom change was
used to hide it. All functional checks completed before that fixture assertion.
A separate strict acceptance check passes with exactly that expected delta:
canvas height -2, centred panY -1 and slider Y +2; window/map/step count/zoom,
panX, camera rotation and every canvas width remain identical.
At five slider round trips per second, input-to-next-animation-frame median/p95
is **14.9/20.4 ms before** and **15.9/21.4 ms after**, maximum 22.7/23.4 ms.
Neither run reports a main-thread task over 50 ms. These single runs document
the observed small difference; they do not prove a speedup or physical screen
latency. Instrumentation for detailed troop assertions was added after timing.

After publication, GitHub's exhausted anonymous API quota initially blocked
fork validation with HTTP 403. After the advertised reset, forced live native
checks confirm e2ed7f50 offers a972e2eb, while a972e2eb reports current. Both
identify the same published asset and the exact ZIP hash/size above. This last
check validates native updater responses, not toolbar initialization or an
installation. The labelled test clones closed cleanly; the user's app/profile
were untouched.

## UCP control styling and whole-tile troop previews: e2ed7f50

UCP dropdowns now follow the source GUI's native select indicator instead of
using its separate folder-expander button as an arrow. Chrome menus use the
dark palette; parchment fields retain their own contrasting controls. Select
appearance, arrow artwork/spacing and popup colors remain theme-owned tokens.

The website's original 7-by-18 hook replaces the old scrollbar cap. Native
start-track pieces extend to the thumb centre, so painting chain artwork on
both pieces overlapped it. The chain now paints once on the leading track,
with half the hook height reserved; the thumb paints only the centred hook.
The scrollbar keeps native behavior and its existing hit area. Source image
bytes are unchanged. The same GUI fix is submitted in
[UCP3-GUI PR #384](https://github.com/UnofficialCrusaderPatch/UCP3-GUI/pull/384).

Troop representatives now use whole neighbouring tiles, reserve each rally
position before filling neighbours, and never share a tile. Map boundaries and
support elevation limit the formation instead of placing troops off a tower.
Camera rotation preserves world positions. Layout examines at most nine
candidates per marker; AIC allocation and drawing command caches remain in use.
Six verified stationary sprites replace numeric placeholders for the mangonel,
ballista, trebuchet, fireballista, brazier and flag. Shared frame-zero outputs
reuse thumbnail PNGs. Engineer and DE idle poses remain unverified.

Source checks: **573 JavaScript tests, 70 Rust tests**, strict TypeScript and
all nine complete catalogues. One local-game integration test remains opt-in.
[Native CI](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35791407612)
passes on Windows, Linux and macOS. The updated designer starter contains
136 variables and 33 texture roles.

An image-decode error visible during testing came from a copied QA profile
whose cached absolute asset paths still referenced the original profile, outside
the clone's asset scope. Correcting only the copied metadata fixed the fixture;
the installed editor's paths and PNGs were valid. No production cache purge or
scope widening was added. Subsequent owned windows are explicitly titled as
isolated tests.

Final package: **7,401,148 bytes portable / 6,744,769 bytes Setup**; all 122
source images match their packaged bytes. Portable SHA-256:
`3fe8cc7f7ed0f925756b693c44575c42ffeacc75462da12a6582d02d077cbfe9`.
The actual WebView popup was visible in the captured frame: dark options and
white text/chevron. A native scrollbar drag moved scrollTop from 20,709 to 25,832;
top/middle/end/dragged views show one thin chain and its hook. Zoomed roof
formations show whole-tile rows and siege/brazier sprites in place of type IDs.

Matched 306f0269/e2ed7f50 runs used GreekSea/Kratoloros, 998 steps, both GPU views,
2560-by-1392 viewport, zoom 0.2790625, pan (470,393.75), and five slider round trips
per second. All viewport, map, camera, slider and canvas dimensions matched.
Input-to-next-animation-frame median/p95 was **19.1/25.6 ms before** and
**15.4/20.2 ms after**; neither run had a main-thread task over 50 ms. These
individual runs establish no observed regression, not a universal speedup or
physical screen latency. Separate detail screenshots used the same closer zoom
in both builds and did not affect the timed run. The user's app was untouched.

After publication, forced live GitHub checks in labelled isolated copies
confirmed that 306f0269 offers e2ed7f50 and e2ed7f50 reports current, including
their visible Install/Up to date buttons. Both selected asset 582376421 with
the exact portable hash and size above. No installation was invoked.

## Integrated chrome, theme groups and cached map restoration: 306f0269

Final `snapshot-native-306f0269`: **7,399,459 bytes portable / 6,744,764 bytes
Setup**. All 122 packaged images remain byte-identical to source. ZIP SHA-256:
`62c45a11b8c5f42b4706e20827df50c9a6be5fa09c13490886154c3f3f4c0343`.
[Native CI at the release commit](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35787949878)
passes on Windows, Linux and macOS.

The installed 9421b5fe was the correct updated native application, but editor
windows still had Tauri's default Windows decorations above the existing menu/tab
bar. The earlier Electron titlebar tests and web-content screenshots did not cover
the native frame. The new opt-in `scripts/test-native-titlebar.mjs` checks actual
window metadata and geometry, as well as the rendered controls.

On candidate d1bfed95 and the final 306f0269 package, the native top inset changed
from **31 px to 1 px**.
Main and secondary editor windows report `isDecorated=false`; detached viewports
retain native decoration. Minimize, maximize/restore, fullscreen, detached
dock/reopen and dirty-document Cancel/Discard close protection passed. The test
uses the real native close-request path but supplies the unsaved dialog choice as
a fixture; it does not claim OS dialog rendering. Caption controls fit at 800 px
outer width and use flat paint in both themes. The final package also verifies
single-line, ellipsized tab labels at that width. Physical dragging/Snap hover and
an outer-window screenshot remain unverified because computer-use was unavailable.

The UCP toolbar previously targeted a nonexistent `.castleToolbarGroup` selector.
Actual `.toolbarGroup` decoration and spacing now consume shared pack-owned
component tokens. UCP has no outer frame; Default retains the original colored
groups. Computed styles and screenshots were checked at 1680 and 800 px without
horizontal clipping. The complete starter now contains all 123 variables and
33 supported texture roles, with no asset resizing.

The map-loading hang was reproduced using an isolated copy of the user's old
cache: its atlas retained a mixed-slash path, so the restored selection rejected
the otherwise valid result. Rebinding response path/name to the current request
fixed automatic GreekSea/Kratoloros restoration (998 steps). All **29 cached files
kept identical bytes and modification times**; four camera layers were reused.
The final 306f0269 run reached restored map data in 2.06 s from process spawn;
the earlier d1bfed95 run took 2.13 s. These are individual warm-cache startup
observations, not a per-frame rendering benchmark or a measured speedup. Both
maps were visible in the captured UCP castle view. No game process was invoked.

Source checks pass **571 JavaScript tests**, **69 Rust tests**, strict desktop
TypeScript and all nine complete 1,727-message catalogues. One native game-fixture
test remains opt-in. The user's running installation was left unchanged.

After publication, isolated copies of the real 9421b5fe and 306f0269 applications
queried live GitHub data. The old native build reported `available` and displayed
the 306f0269 Install button; the final build reported `current` and displayed
the green Up to date state. Both selected release 394143502 / asset 582316843,
with the ZIP hash and size above. This was discovery-only: neither installation
nor the user's running application was modified.

## Cached update retry follow-up: 9421b5fe

The running Electron app retried `snapshot-native-39659543` from its hourly cache
after the migration-compatible release was already published. Both failed stages
identified that older release. Replaying one downloaded archive with the unchanged
Prepare helper in an isolated folder reproduced `Incomplete Windows release`
before installation. The previous migration E2E began with fresh metadata and did
not cover this stale-cache state.

The shared renderer now discards the failed candidate and its availability classes.
Retry forces a new release check; it shows the new candidate before another explicit
installation. A regression uses the real checker with time fixed within the cache
hour and newly published metadata; it fails when the state-reset line is removed.
Busy-click and unsaved-cancellation checks also pass. Full JavaScript: **568 pass,
0 fail, 0 skip**; strict desktop TypeScript passes. No backend/rendering code changed.

Published `snapshot-native-9421b5fe`: **7,396,986 bytes portable / 6,740,776 bytes
Setup**, with all 122 source images unchanged. Existing old Electron installations
can force the first refresh by switching to Official and back to their fork;
the fix cannot change an older process that is already running.

The final published 9421b5fe package passed the same isolated original-Electron
update test against real GitHub metadata/downloads. Native startup, exact selected
castle/config restoration and the visible fork's green `Aktuell` state passed;
the user's live app and original EXE/ASAR hashes stayed unchanged. ZIP SHA-256:
`dd894faa8f2eb82e08e517cd56f7bed31aa1192dcf0fca39e3f37a9d7f8b6d6c`.
[Native CI at the release commit](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35781436843)
also passes on Windows, Linux and macOS.

## Electron updater migration preview: 14f5269c

Published `snapshot-native-14f5269c`: **7,396,843 bytes portable / 6,740,570 bytes
Setup**. All 122 packaged images remain byte-identical to source. The package now
contains a real supplemental ASAR resource capsule for older Electron updaters;
neither download bundles Chromium or WebView2. Setup/uninstall use the Toolkit icon.

566 JavaScript tests, strict desktop TypeScript and nine complete catalogues pass.
[Native CI](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35778275868)
passes on Windows, Linux and macOS: 68 Rust tests and application compilation.
The one opt-in local-game fixture was not rerun for this update-only change.
The renderer is unchanged; performance measurements below belong to their named builds.

An isolated copy of the installed `snapshot-002e40d` Electron application exercised
its original update button, checker, downloader and PowerShell installer. These
production files were byte-identical to the installed originals. The preliminary
run used fixture release responses; it passed download, install, exit and native
restart at the same path. The exact second castle, workspace, localStorage,
settings, selected update source and customized UTF-8 configuration were preserved.
Supplemental resources were restored and the native receipt matched the new EXE.
The original live installation's EXE/ASAR hashes stayed unchanged.

The repeat against the **published GitHub release** also passed with no fixture
transport: download, checksum verification, installation, restart and restoration
all completed. The real native checker returned `current` with the release/asset
key, and the rendered fork selector remained `Krarilotus/AI-Toolkit` with a green
`Aktuell` (`releaseCurrent`) button. Receipt key:
`krarilotus/ai-toolkit:394086658:582167250:f62fa6344b93442a5c3e09fb277d502a566a43be0ba9cbf258d41525031ccae9`.
The test app closed itself; the user's original app remained running unchanged.

The installer failure fixture removes the staged receipt after preflight/backups
to exercise partial-write rollback through the unchanged shipped helper. Native
tests cover resource/receipt binding, bounded archive parsing, path containment,
readiness and recovery. WebView2 tests cover the installed fast path and rejection
of unsigned installers; the actual Microsoft bootstrapper's signature was verified
without executing it. Clean-machine runtime installation and hard power-loss
recovery remain unverified. Existing users' WebView2 was not removed for testing.

Repeat the real published-release acceptance test in an isolated clone:

```powershell
node scripts/test-legacy-native-migration.mjs --archive release/native/AI-Toolkit-0.11.0-windows-x64.zip --original-root '<existing Electron installation>' --run --published --repo Krarilotus/AI-Toolkit --tag snapshot-native-14f5269c
```

## Earlier cleanup preview: 39659543

Published `snapshot-native-39659543`: **7,208,195 bytes portable / 6,597,650 bytes
Setup**. All 122 packaged images match their source bytes. 564 JavaScript tests,
strict TypeScript and all nine catalogues pass.
[Native CI](https://github.com/Krarilotus/AI-Toolkit/actions/runs/35736981014)
passes on Windows, Linux and macOS: 47 Rust tests and native binary compilation.
The opt-in local game parity test passed separately against the installed game.

Native create/save/clone/reopen/add/mapping checks preserve unknown character
fields and unchanged castle bytes. Object-valued JSON saves work. Twelve rapid
panel detach/dock cycles leave only `main` registered and the document clean.
The final rebuilt detached UCP/Default controls fit without an inner scrollbar;
Persian switches text direction without moving layout. Four maximized UCP tab
screenshots were captured. No temporary CSS overrides were injected.

All following drag runs use GreekSea/Kratoloros, 998 steps, 2560x1369, both GPU
surfaces, zoom 0.2790625, pan (470,376.25), and 60 alternating pointer jumps at
100 ms intervals. This castle has 50 troop markers. Document/AIC values are unchanged.

| Build / mode | Median input to next rAF | p95 | Maximum | Tasks >50 ms |
| --- | ---: | ---: | ---: | ---: |
| f06c691c, Default, matched baseline | 16.0 ms | 22.2 ms | 23.9 ms | 0 |
| f06c691c, UCP + fire, matched baseline | 16.5 ms | 22.1 ms | 27.2 ms | 0 |
| 39659543, Default | 16.4 ms | 22.4 ms | 26.7 ms | 0 |
| 39659543, UCP + fire | 17.5 ms | 23.0 ms | 28.0 ms | 0 |

The preliminary 474bd4c6 Default run was slower: 19.8/29.1 ms median/p95, then
18.9/32.0 ms on a warm repeat. Profiling found a nested generator merge added
roughly 0.96 ms/input; the final single-pass stable merge removes that traversal.
Troop command generation sampled 0.185 ms/input and support heights 0.063 ms/input.
Disabling troops did not establish the cause of all timing variation. These
small samples do not prove universally identical performance or screen latency.

### Startup

The new startup benchmark launches only an owned process/profile and verifies
clean shutdown. Fresh profiles copy preferences, not app asset/WebView caches;
OS filesystem caches are not flushed. Readiness is polled every 50 ms and means
DOM/data readiness, not a fully presented GPU frame.

| Build / profile | DOM ready | Project ready | Map data ready |
| --- | ---: | ---: | ---: |
| f06c691c, fresh | 0.66 s | 1.18 s | 1.52 s |
| f06c691c, warm restart | 0.95 s | 1.21 s | 0.95 s |
| 39659543, fresh | 0.67 s | 1.04 s | 1.42 s |
| 39659543, warm restart | 0.96 s | 1.23 s | 0.96 s |

These are individual paired observations, not a statistically proven speedup.
Project and map loading are independent. Repeat with:

```powershell
node scripts/benchmark-native-startup.mjs --exe '<preview>/AI Toolkit.exe' --profile '<new-profile-directory>' --seed '<owned-settings-profile>' --port 9245 --output startup.json
```

The earlier real 4b10b163-to-f06c691c update passed download/install/restart,
receipt, settings and config preservation. The repeat against 39659543 was
blocked **before download** by GitHub's anonymous API quota (HTTP 403; reset
22 September, 14:25:56 UTC). It is not claimed as a successful final-release
update. Direct release downloads remain available.
The newer 14f5269c migration run above passed against the public release.

## UCP usability follow-up

The optimized `a16a6e50` candidate was checked in a separate WebView2 profile
with the same 998-step castle, maximized window and both GPU views. These are
input-to-next-animation-frame timings, not screen-presentation latency:

| Test | Median | p95 | Maximum | Tasks over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Default, rapid mouse jumps | 15.2 ms | 20.3 ms | 25.4 ms | 0 |
| UCP with fire overlay enabled, rapid mouse jumps | 14.6 ms | 20.4 ms | 22.3 ms | 0 |
| UCP with CPU profiler recording | 18.0 ms | 23.4 ms | 27.2 ms | 0 |

The smaller Pixi bundle retained both GPU surfaces and the fire-mask pass. Its
public exports and standard CSP adapter are bundled together by esbuild; no
renderer logic or artwork was replaced. Windows SChannel successfully checked
GitHub and downloaded/digest-verified the previous published portable release.

Persian/English switching was checked against live pane/tab order, literal
paths, numeric controls, input direction and caret selection. Content textareas
retain their identity and values; switching languages no longer rebuilds them.
The test restores the original language/workspace and checks unchanged project
content and dirty state. Detached-view language/title propagation and secondary
editor document isolation also passed. Closing a detached view exposed a stale
native-window entry; the lifecycle correction is documented with the parity
review, rather than treating the initial smoke test as sufficient updater proof.

The follow-up source checks pass 544 editor tests, 40 Rust tests, strict desktop
TypeScript and all nine complete language catalogues. The unchanged game-fixture
test remains opt-in and was run separately for the previous published baseline.
Full-window UCP screenshots are captured for Library, Character, Castle and AI
Content from the built preview. Native OS picker interaction and Linux/macOS
builds still have the limits listed in the parity review.

## Test conditions

The actual packaged WebView2 application used a separate user-data directory,
the existing Gatekeeper/Kratoloros castle (998 steps), and GreekSea from the
selected classic installation. The window was maximized at 2560 × 1369, with
both 2D and 2.5D views visible. No game process was started or attached to.

`scripts/benchmark-native-preview.mjs` sends mouse dragging events to the real
range control: 60 jumps at 100 ms intervals, approximately five round trips
per second between steps 100 and 900, also visiting adjacent steps. It records
the actual resulting values because range-thumb geometry can differ by theme.
It preserves the current view; `--fit` explicitly requests fitting the map.
All runs below had both GPU surfaces active and left the document unchanged.

The measurements are input-handler to next animation-frame callback, **not**
photon/presentation latency. CDP dispatch is measured separately. An idle frame
interval is not proof that a changed scene was presented in that interval.

## Rendering and map transport

| Optimized build | Median input → next frame | p95 | Maximum | Main-thread tasks over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Default | 14.9 ms | 18.9 ms | 24.3 ms | 0 |
| UCP | 14.7 ms | 20.8 ms | 23.4 ms | 0 |
| UCP, one wheel step closer | 11.8 ms | 19.0 ms | 19.4 ms | 0 |

The first native integration was materially worse: median input-to-frame was
about 69 ms. Asset-protocol images had been loaded without anonymous CORS, so
their ImageBitmaps could not transfer to the renderer worker. That silently
selected the CPU fallback. Loading these local images with the correct CORS
mode restores the existing GPU pipeline; the fix does not reduce image quality.

GreekSea's map response previously contained approximately 45.26 MB of base64
PNG data. It now contains approximately 1.50 MB of metadata and cache-file URLs.
The PNG bytes are unchanged. Three optimized, warm, complete bridge requests
took 60.9, 60.0 and 59.6 ms. These timings exclude later scene construction and
are not cold-start measurements. The existing Node and new Rust map decoders
were compared on the installed game in all four camera directions, including
Double Trouble. Concurrent asset requests share one extraction per cache path.

## Compatibility and visual checks

- Default and UCP are separate complete packs using the same shared components.
  The UCP pack uses original nine-slice button frames, arrows, fields, tabs,
  checkbox and scrollbar artwork by their intended role.
- Palette rows have uniform 44 px previews; image intrinsic height cannot enlarge
  the row. The player palette uses game colours, not the debug colour table.
- Nine catalogues contain 1,723 messages each. Completeness, interpolation and
  explicit source references are checked during development/packaging. Live
  switching was exercised for every language; Persian uses RTL without mirroring
  game coordinates. Domain labels were reviewed against their actual behavior.
- Existing project, clipboard, selected game/map, window bounds and maximized
  state were restored in an isolated copy of existing settings. Original settings
  are not modified by the legacy storage migration.
- Full-resolution PNG export produced an 8900 × 8900 image with the extracted
  game sprites, leaving the castle unchanged. The test substituted only the save
  picker destination with an owned temporary filename; it did not test the OS
  file-picker interaction itself.
- Detached 2.5D rendering uses the same theme and language services. New-window
  document delivery has one atomic pending/readiness state to prevent lost loads.
- Custom theme discovery, selection and persistence were exercised with an owned
  temporary pack. Existing custom configuration is covered by real NSIS reinstall
  and abort tests; defaults are only written when the file does not already exist.
- ZIP contents are round-trip verified. Every packaged image is byte-identical
  to its permitted source. No Firefly unit/isometric sprite pixels are bundled.

The final source checks passed 536 editor tests, 35 native tests, strict TypeScript,
complete catalogues and 1,024 explicit translation references. One game-fixture Rust test is explicitly
ignored in the ordinary portable suite; it was separately exercised against the
local installation. See the release notes for final test/artifact counts.

## Repeating the interactive benchmark

Run a separate portable copy, never the user's active installation:

```powershell
$env:AI_TOOLKIT_USER_DATA = '<owned test profile>'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9241'
$env:AI_TOOLKIT_DEBUG_PORT = '9241'
Start-Process '<test copy>/AI Toolkit.exe' -WindowStyle Hidden
# Load the unchanged 998-step castle and game map, then:
node scripts/benchmark-native-preview.mjs performance.json
```

`--profile` also writes a CPU profile and adds profiling overhead. Do not use
profiling runs to represent normal operation. The script refuses an unsaved
document, a missing map or fewer than 901 steps, and rejects the CPU fallback.
The debug port is a test-only launch option, not enabled in shipped shortcuts.

## Limits

WebView2 is an external runtime, downloaded separately if missing. The universal
ZIP supports both the existing Electron updater and native updates. Clean-machine
runtime installation and hard power-loss recovery still require acceptance tests.

Fourteen classic idle poses now have cached defensive formations; unverified
engineer/siege/DE poses remain explicit rally markers. Local
asset changes are rechecked on installation selection and map reload, not by a
background filesystem watcher. Native OS popup/file-picker interaction still
needs user testing: the computer-use bridge was unavailable, so live checks used
WebView2/CDP, screenshots and native integration tests.
