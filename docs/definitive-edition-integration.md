# AIVE comparison and Definitive Edition integration

Reviewed 2026-09-20. DE JSON editing/export is implemented as an experimental interchange feature.
DE game execution and DE terrain/assets are not yet verified.

## Evidence and limits

The author publishes [AIVE 0.9.6 on ModDB](https://www.moddb.com/downloads/aive-ai-village-editor).
The user supplied the release ZIP. Its 144,240,006-byte size and MD5
`b857fb06bf47a4473733b8037e6bafd9` match the publisher's metadata. Inspected the
archive, configuration, item definitions, translations and bundled converter.
The editor GUI itself has not been tested; configuration evidence confirms
available controls, not their runtime correctness.

`AIVEditor.exe` is a PyInstaller package containing Python 3.10, PySide6/Qt6
and Microsoft runtime DLLs. No separate Python or Qt installation is indicated.
The bundled converter ran successfully without installing a framework. The ZIP
is about 137.6 MiB, so this particular Python/Qt distribution is not evidence
that replacing Electron alone produces a tiny download.

The archive's `plugins/source.txt` identifies the author's public
[AIVConverter repository on Codeberg](https://codeberg.org/SuschisWorld/AIVConverter).
Reviewed commit `25ec0c430029fda0ef268fe7420ccb4048c9f181` (GPL-3.0).
This is converter source, not the editor source; no implementation was copied.

For format evidence, inspected
[IIJanII's converter](https://github.com/IIJanII/AIV-to-AIVJson-Converter/blob/main/src/AIVtoAIVJson.py)
and the local Sourcehold checkout at `4f54a802b622180aab99e2767d8f27b723429def`,
particularly [its AIV JSON exporter](https://github.com/sourcehold/sourcehold-maps/blob/4f54a802b622180aab99e2767d8f27b723429def/sourcehold/tool/convert/aiv/exports.py).
These are separate projects, not AIVE source. No external implementation was
copied into the Toolkit.

## Feature comparison

AIVE's author describes shape/curve drawing, guide lines, reusable structures,
image export, customizable categories, localization, extended analysis, DE
items, pause controls, and a scratchpad. The following comparison is against
the Toolkit code inspected in this branch. Bundled settings additionally confirm
shape tools, guide-line docks, showcase/animation settings, converter profiles
and nine translation dictionaries; these have not been GUI-tested.

| Area | Toolkit status / missing work |
| --- | --- |
| Timeline, move/cut/merge, placement validation | Present; preserve existing behavior |
| Lines and fill | Present; circles, polygons and Bézier tools not found |
| Planning aids | Image reference present; editable guide-line manager missing |
| Reusable structures | Persistent clipboard/groups present; a named multi-template library is a separate gap |
| Presentation | No comparable configurable showcase image export found |
| Appearance | Bundled/custom skins and hotkeys present; interactive category management and full localization incomplete |
| Analysis | Population, resources, fear, routes and fire present; DE-aware validation missing |
| DE editing | Item definitions, timing preservation and safe export require work |
| Scratchpad | Editor remains a 100x100 castle grid |

Prioritize correct DE round-tripping over adding every drawing tool. The
reference-image feature and clipboard should be extended where suitable,
rather than introducing parallel models for the same castle data.

## What the format evidence shows

The converter writes an object containing `pauseDelayAmount`, `frames` and
`miscItems`. Frames use `itemType`, `tilePositionOfsets` (the actual spelling)
and `shouldPause`; miscellaneous markers use `itemType`, `positionOfset` and
`number`. Those names already match the Toolkit's document model. IIJanII calls
Sourcehold with `invert_x=False, invert_y=True`; orientation must be verified
with asymmetric fixtures, not inferred from a visually symmetric keep.

The installed DE game's `Assembly-CSharp.dll` confirms these `eMappers` constants:
79 `MAPPER_BEDOUIN_STOCKADE`, 53 `MAPPER_OUTPOST_BEDOUIN`,
178 `MAPPER_OUTPOST`, and 179 `MAPPER_OUTPOST_ARAB`. Its bundled help names
79's recruitment building Bedouin Stockade. AIVE 0.9.6 calls it Beduin Post
(10x10) and separately defines all three outposts as 5x5. Toolkit now uses the
actual game name for the stockade and keeps the three distinct outpost IDs.

AIVE's default config sets `allow_placeable_outposts: false`, despite including
the outpost definitions/categories. The earlier implementation copied the
Bedouin outpost definition without considering that setting. At the user's
explicit request, all three outposts are selectable under Misk alongside Dummy
Step. This is an opt-in parity choice for this editor, not proof that every AI
lord/build context executes them. No live-game AI construction test was run.

Read-only inspection on 2026-09-22: installed managed assembly SHA-256
`bc8b6a395f01d48557db413600c8dd8d1fdfd3abdf97bfbbb68a3c56b04fd789`.
No game process was launched or attached. The game defines separate Stockade and
Outpost UI panels; these are not duplicate names for one building.

The classic binary AIV mapper/template tables cannot encode outposts 178/179,
so they carry `classicAiv: false`. Classic export reports an error instead of
silently dropping them. DE JSON preserves 53/79/178/179 without substitutions.

Its definitions identify 9022 Camel Lancer, 9023 Healer, 9024 Eunuch,
9025 Ambusher, 9026 Skirmisher, 9027 Heavy Camel, 9028 Sapper and
9029 Demolisher. Treat these as AIVE definitions pending DE game verification,
not as a universally authoritative game registry.

The shipped config selects `Bedouin2Arab`. Its mappings substitute the Bedouin
Stockade with the Mercenary Post and several DE troops with classic troops.
These are deliberate compatibility substitutions, not lossless DE export.
The converter source preserves empty frames as `{}`, defaults to Y inversion,
uses multi-tile templates, and stores pause flags separately. Its classic
writer caps the pause array and only writes classic miscellaneous unit indices.
Those restrictions must be surfaced during export rather than silently applied.

Executed the bundled converter against the existing saved `Kratoloros.aiv`,
with an explicit output path outside both the repository and game directory.
It produced valid JSON with 716 frames, 50 miscellaneous markers and pause
amount 100. The first keep anchor is 5643. This is the saved file on disk,
not necessarily the 998-step document shown in earlier editor screenshots.
No original file was modified. This checks executable availability and basic
classic-to-JSON conversion only; no DE game or GUI round-trip was performed.

## Implemented in this branch

- Open `.aivjson` (and the `.aijson` alias); Export DE writes `.aivjson`.
  Save keeps the selected format and JSON is written atomically as UTF-8.
- DE import/save preserves empty frames, pauses, marker numbering and unknown
  JSON fields/IDs. Classic import retains its existing pause/compaction policy.
- Classic export rejects DE-only items, unsupported markers and timing loss
  with actionable diagnostics. It does not silently substitute or discard them.
- Bedouin Stockade (79, 10x10), all three 5x5 outposts (178/179/53), and the eight
  9022?9029 markers are selectable. Bedouins have a separate category.
  New artwork is original vector preview artwork, not extracted DE game sprites;
  existing raster assets retain their original resolution. Unavailable 2.5D
  building sprites use a footprint-sized placeholder.
- Classic maps, balance and analysis remain classic integrations. DE terrain,
  accurate DE costs/workers/fire/path rules and actual DE 2.5D building sprites
  remain outside verified support. Do not call this full DE game compatibility.

Schlossgespensty's supplied `Fix_for_AIVE-0.9.6.zip` was inspected as an archive
without executing its flagged binary. Its JSON adds Hunter and Caged War Dogs
classic templates and Dummy Step (200); those classic items already exist in
Toolkit's native definitions. These data changes do not establish which fixes
are present inside the patched converter executable.

## Remaining verification

1. **Acquire fixtures and define the contract.** AIVE 0.9.6 is acquired. Obtain a DE game
   export and an AIVE GUI save of the same asymmetric castle. Include rotated gates,
   a displaced keep, a multi-tile wall step, all new unit types, marker numbering,
   empty steps and pauses. Record which behaviors belong to the game versus the
   editor. Validate actual files in both applications before claiming interoperability.
2. **Verify DE definitions against the game.** The provided AIVE definitions
   support the current catalogue. Compare them with a current DE installation,
   including additional items and per-unit limits before expanding coverage.
3. **Validate timing-aware editing.** Round-trip tests cover empty and paused
   steps. Merging paused DE steps is rejected instead of dropping their timing.
4. **Separate DE runtime data.** Add an explicit DE game profile before exposing
   DE map rendering, balance or analysis as accurate game behavior.
5. **Verify both directions.** Test semantic import/export equality, asymmetric
   coordinate anchors, timing and unknown IDs, save-path/content agreement,
   failure atomicity, and unchanged classic regression coverage. Open Toolkit
   output in AIVE and in DE, then inspect actual construction order and unit
   placement. JSON syntax validation is only the first check.
6. **Then close selected UX gaps.** Build guide lines, named clipboard templates,
   shape/curve generators and showcase export around existing geometry and
   rendering. They are independent of DE file compatibility and should be
   reviewed separately. Avoid a second renderer or document model.

Estimated scope should be revisited after the real files are available. GUI and
game-level verification still remain before a feature-parity or working-DE-export
claim is justified.
