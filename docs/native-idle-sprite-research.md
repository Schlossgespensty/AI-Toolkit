# Static idle troop previews: verified research

Status: **implemented for 20 classic marker types and both lord variants**. Palette thumbnails face the
viewer (direction 4; `thumbnail_pose` in `unit_poses.rs`); the 2.5D view uses the verified idle frames
below. Engineers and DE-specific markers show
editor-drawn numbered rally markers until their stationary poses are verified.
No game process is started or attached to, and no Firefly pixels are packaged.

## Verified classic-game contract

The local OpenSHC C++ export is at
`S:\Projects\Harness\texture-research\openshc-sarif\cpp-126f25c9\src\OpenSHC`.
Its named layouts are in `S:\Projects\UCP\OpenSHC\src\OpenSHC`.
These are developer research inputs, not packaged assets or runtime dependencies.

- `Rendering/ViewportRenderState/renderMap.cpp:1009–1012` selects a zero-based
  GM1 picture using `gfxNumber - 1`.
- `Map/Units/UnitsState/setUnitValues.cpp` copies the GM1 file header's `originX`
  and `originY` into the unit. These are signed 32-bit values at offsets `0x48`
  and `0x4c`. Preserve the origin when trimming transparent margins, as the
  current native extraction already does.
- `Map/Units/UnitsState/updateUnits.cpp` derives walking pictures from direction
  and `animationSheetFrameOffset`. The first body frame belongs to this sequence.
- Idle states have separate unit-specific byte tables and sprite offsets.
  `Map/AnimationFrameData.hpp` names those tables; their base in the inspected
  executable is `0xB56AC4`. This address is research evidence for this build,
  **not a portable address to hard-code into the editor**.
- Indexed body GM1 palettes 1–8 are player colors. Palette 1 is the existing
  blue preview color; palette 0 can contain authoring magenta/cyan. Continue
  resolving the selected game's active texture overrides before extraction.

The following zero-based pictures were checked against both named idle code
and actual GM1 directories in `D:\Games\Stronghold Crusader KI-Liga`:

| Unit | GM1 source | Idle table / first value | Game picture formula | Zero-based picture |
| --- | --- | --- | --- | ---: |
| Mangonel | `body_mangonel` | Stationary next-state branch | `direction + 1` | 0 at direction 0 |
| Tower ballista | `body_ballista` | Stationary next-state branch | `((direction + 4) & 7) + 1` | 4 at direction 0 |
| Trebuchet | `body_trebutchet` | Stationary next-state branch | `((direction + 4) & 7) + 1` | 4 at direction 0 |
| Fire ballista | `body_arab_ballista` | Stationary next-state branch | `((direction + 4) & 7) + 1` | 4 at direction 0 |
| European archer | `body_archer` | `0xB57938` / 1 | `0x280 + value*4 + direction/2` | 643 at direction 0 |
| Crossbowman | `body_crossbowman` | `0xB57F68` / 8 | `0x90 + value` | 151 |
| Spearman | `body_spearman` | `0xB58718` / 1 | `0x230 + value` | 560 |
| Pikeman, standing | `body_pikeman` | `0xB57AD8` / 1 | `0xC0 + value` | 192 |
| Maceman | `body_maceman` | `0xB57DC8` / 1 | `0x1B0 + value` | 432 |
| Swordsman | `body_swordsman` | `0xB58988` / 21 | `0x141 + value` | 341 |
| Knight body | `body_knight` | `0xB58C48` / 1 | `0xF9 + value*8 + direction` | 256 at direction 0 |
| Knight rider | `body_knight_top` | `0xB58B48` / 6 | `0x179 + value*8 + direction` | 424 at direction 0 |
| Arabian archer | `body_arab_shortbow` | `0xB592E0` / 1 | `0x36C + value` | 876 |
| Slave | `body_arab_slave` | `0xB59030` / 1 | `0x100 + value` | 256 |
| Slinger, seated | `body_arab_slinger` | `0xB59560` / 9 | `664 + value` | 672 |
| Assassin | `body_arab_assasin` | `0xB5978C` / 20 | `0x310 + value` | 803 |
| Horse archer body | `body_horse_archer` | `0xB59A28` / 1 | `0x250 + value` | 592 |
| Horse archer rider | `body_horse_archer_top` | `0xB599C8` / 1 | `0x250 + value` | 592 |
| Arabian swordsman | `body_arab_swordsman` | `0xB59D68` / 1 | `0x170 + value` | 368 |
| Fire thrower | `body_arab_grenadier` | `0xB5A010` / 1 | `0x230 + value` | 560 |
| Brazier | `body_brazier` | Stationary flame cycle, eight frames | First flame phase | 0 |
| Small rally flag | `anim_flag_small` | Stationary cloth animation, 32 frames | First cloth phase | 0 |
| European lord | `body_lord` | `0xB5CA64` / 1, stationary guard/look phase | `direction + 0xA9 + lookDelta` | 168 at direction 0 |
| Arabian lord | `body_saladin` | Same stationary phase, Arabian variant offset | `direction - 0x80 + 0xA9 + lookDelta` | 40 at direction 0 |

See `Map/Units/UpdateCrusaderArcher.cpp:635`,
`UpdateCrossbowman.cpp:148`, `UpdateSwordsman.cpp:104`,
`UpdateArabianArcher.cpp:530`, `UpdateSlave.cpp:186` and
`UpdateHorseArcher.cpp:137`. These are static samples of idle/look-around
animations, not a claim that every pose has eight directional variants. The
horse and rider use different tables; their frame numbers coincide only at the
sampled phase. Their origins also differ (69,95 versus 68,95).

Additional evidence: `UpdateSpearman.cpp` idle case, `UpdatePikeman.cpp:204–311`
(standing branch), `UpdateMaceman.cpp:206`, `UpdateKnight.cpp:109–158`,
`UpdateSlinger.cpp:525–608` (seated branch), `UpdateAssassin.cpp:116`,
`UpdateArabianSwordsman.cpp:109`, `UpdateFireThrower.cpp:429–458`.
The named table offsets in `AnimationFrameData.hpp` and bytes read directly
from the local classic executable agree with the first values above. Only
the resulting frame metadata ships; these executable addresses are not used
by the runtime.

## Lord selection and support

The character field is `lord.Type`, with the exact values `Europ` and `Arab`.
It is not an integer `LordType` field in the classic AIC structure.
`extension-aiSwapper/scripts/lord.lua` resolves these to the game's lord
variants 0 and 1. The native extractor exposes `idleSprites["lord-europ"]`
and `idleSprites["lord-arab"]`; neither is a placeable AIV marker or added
to the palette thumbnail map.

`UpdateLord.cpp:112` sets stationary speed to zero. Lines 120-122 switch the
Arabian variant to sprite file 205 (`body_saladin`) and subtract `0x80` from
shared animation formulas. The stationary guard/look branch at lines 636-676
uses table `AnimationFrameData+0x5FA0`: its first value is 1, producing a zero
look offset. With direction zero, the shared `gfxNumber - 1` contract gives
frames 168 and 40. Both frames were decoded from the local game and visually
checked as stationary lords, preserving their native palette and origin.

The classic stone keep's unit deck is **92 native pixels** above its terrain:
`BuildingsState/getBuildingHeightForBuildingID.cpp:14-15` returns 92 for
`BT_STONEKEEP`, `UnitsState/recomputeUnitStandingHeight.cpp` applies that
building height, and `Rendering/ViewportRenderState/renderMap.cpp:1016`
subtracts it directly from the unit's image Y coordinate. The preview lord
occupies the central tile of the visible 7-by-7 keep, independent of defensive
recruitment quotas. Its appearance follows the loaded character's lord type.

Both small and large stone gatehouses use **128 native pixels**, as returned
by `getBuildingHeightForBuildingID`; their unit support must not reuse the
90-pixel high-wall height. All four AIV gate orientations share this constant.
The Gatekeeper slinger markers are centred on their 5-by-5 gate footprints;
the previously low appearance was a 38-pixel vertical error, not a tile offset.

## Implementation and verification

The stationary siege formulas come directly from the branches that set
`stateBasedSpeed = 0` in `UpdateMangonel.cpp:73`, `UpdateBallista.cpp:75`,
`UpdateTrebuchet.cpp:78`, and `UpdateFireBallista.cpp:81`. These sample the
engine body; they do not invent manning engineers. `UpdateBrazierEntity.cpp:12`
cycles eight flame frames without motion. `UpdateFlag_1_2_4_Entity.cpp` and
`UpdateFlag3Entity.cpp` animate cloth at a fixed entity origin. The selected
local files contain eight brazier frames and 32 small-flag frames. Their first
phase is a stationary representation, not a walking-unit thumbnail fallback.

`src-tauri/src/game/unit_poses.rs` owns frame metadata. The native extractor
reads each resolved GM1 once for its thumbnail and idle pose, preserves native
pixel dimensions and signed origins, and caches PNGs by active graphics
revision plus pose metadata. Returning a cached result does not rewrite PNGs.

`src/js/castle-troops.js` owns the pure, cached allocation planner. The budget
is `min(DefTotal, DefWalls)`. `AI/AICState/aiRecruitUnits.cpp:147–163` cycles
the recruitment slots in order, wrapping at slot eight or the first `None`.
Quotient/remainder allocation reproduces that cycle in at most eight operations,
then aggregates repeated types. For 100 defenders and eight distinct slots the
quotas are 13,13,13,13,12,12,12,12, preserving the budget rather than independently
rounding all eight shares up. `smallestTribeOfUnitType.cpp:51–72` selects the
first smallest matching marker group. Another quotient/remainder split gives
13 troops over three markers as 5,4,4, or over four as 4,3,3,3. Counts in this
plan are complete; the nine-sprite display cap is a separate rendering concern.

`assignUnitToATribe.cpp:40–54` sends unmatched European archers, crossbowmen,
pikemen, swordsmen, Arabian archers, Arabian swordsmen and fire throwers to
the keep. Other unmatched recruited types wait at the campfire. The keep target
is world origin +(3,4); the campfire target uses the rendered camp plate's
entrance +(3,0). World-oriented plates and rally points rotate with the camera,
not again with the AIV layout. The lord occupies keep centre +(3,3).
Synthetic groups only appear while their supporting keep exists in the visible
build step; they never modify saved AIV markers.

The portion of `DefTotal` above `DefWalls` belongs to outer patrols, not wall
groups or automatic campfire reserves. This static preview does not simulate
patrol movement, resource-limited recruitment, casualties or Extreme/nervous
AI states. The UCP troop-behaviour plugin can also change patrol/group movement;
its InitialRole setting does not change recruited-unit quotas or fallback types.
Without an opened/created character, one representative is shown per marker.
Siege and decorative markers remain independent of defense recruitment.
Monk and Tunneler quotas are retained as named standby groups, even though they
have no classic AIV marker and their idle sprites are not yet verified. An
unsupported visual type never consumes another type's share or truncates the
recruitment cycle; only `None`/an absent slot terminates it.

The plan is identity-stable across unrelated character/building edits. Scene
changes update support elevation from visible keeps, walls, stairs, gates and towers;
the height constants are shared with routing. Marker visibility matches 2D:
AIV rally markers do not have build steps, so they remain present, dropping to
the visible ground before a future supporting structure exists. Panning and
zooming reuse the scene. Cached draw commands join the existing depth merge,
damage tracking, GPU texture and command caches; they have no animation loop.
Representatives occupy distinct whole tiles in the marker's 3-by-3 neighbourhood.
Original rally tiles are reserved before neighbouring positions, so groups never
overlap. Preview members stay on the same support elevation, inside the map;
crowded locations or tower edges display fewer representatives instead of
stacking them or floating them off the roof. Nine candidate tiles per marker
bound the layout work. Standby groups search at most 49 nearby tiles, capped at
nine representatives per type; the lord's central tile is reserved first.
Resolved anchors are reused until the plan, visible keep or rotation changes.
Camera rotation preserves the same world positions.

Local extraction proof: all 21 existing thumbnails and 22 stationary poses decoded
with no warnings from `D:\Games\Stronghold Crusader KI-Liga`; a repeated call
returned identical metadata and all 41 cache files retained their modification
times. Debug build timings were 89 ms cold and 28 ms warm including override revision lookup.
The warm path does no pixel decoding. Mangonel, brazier and flag reuse their
already decoded first-frame thumbnail, including its preserved native anchor.
The six stationary marker additions and both lord sprites were visually inspected at their original dimensions in
an isolated extraction directory. Tests cover selected-frame pixels, shared
PNG reuse, unchanged warm caches, allocation identity, budget conservation,
400 deterministic varied cases against an independent per-unit simulation,
Gatekeeper's 72/36/18/18 wall quotas, zero/count weighting,
preserved origins and forward/backward support heights. Lord extraction tests
also verify the separate named keys, exact source/frame selection, native
palette and anchors, and absence from the placeable marker palette.
Live full-window drag/render performance remains a release acceptance check;
the additional commands are not literally free.

Definitive Edition-specific idle poses and classic engineer poses remain
unverified. Replacing sprite art may change animation conventions; a missing
verified frame is reported rather than replaced by an arbitrary body frame.
