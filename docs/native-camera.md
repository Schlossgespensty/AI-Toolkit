# Native map camera

C/X rotates the complete 2.5D scene: terrain, castle, scenery, overlays and
mouse picking. The camera is separate from the AIV's placement orientation at
its selected keep. A camera turn never edits or rotates the saved AIV.

The viewport centre stays fixed in world space. Four turns restore the same
pan and zoom. Grid corners rotate around `edge`, while a footprint anchor
rotates around `edge - footprintSize`; using one formula for both causes the
half-tile displacement. Elevation is removed before inverse projection and
reapplied after turning.

Terrain origins are restricted to the 100x100 AIV footprint plus five tiles
on each side. The fixed AIV origin `(mapKeep.x - 43, mapKeep.y - 43)` positions both terrain and castle;
the viewport does not expand this region to the complete 400x400 game map.
Raised tile tops and attached sprites can overhang the boundary. Hover-only
updates reuse a screen-sized scene cache, while edits, steps, camera changes
and image loads invalidate it. Consecutive rotations retain their world-space
pivot elevation so cliffs cannot make the camera drift between turns.

## AIV origin and rotated keeps

Verified against the installed classic executable on 2026-09-20
(SHA-256 `0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34`)
and OpenSHC's named Ghidra references:

- `setKeepOffsetAndOrientation`, `0x004ecf70`: instructions at
  `0x004ecf8b` and `0x004ecf97` subtract 43 from the original map keep X/Y.
- `rotateAIV`, `0x004ed0b0`: rotates the 100x100 construction/step grids.
  Its copy loops map `(x,y)` to `(y,99-x)`, `(99-x,99-y)` or `(99-y,x)`
  for game orientations 2, 4 or 6. No map-origin adjustment occurs here.
- `applyAIV`, `0x004ef0d0`: the first rotated keep cell is added to those
  unchanged offsets (`0x004ef194` through `0x004ef1ae`). Buildings and
  rally points use the same origin.
- `LaunchSkirmishGame`: `0x00441eb4` through `0x00441ecc` uses those
  resulting coordinates when placing the replacement 7x7 keep.

Consequently, a standard keep at AIV `(43,43)` is displaced from the map's
original keep by `(0,0)`, `(0,7)`, `(7,7)` or `(7,0)` for game orientations
0, 2, 4 or 6. Custom keep positions retain their additional rotated offset.
The former rotated-anchor subtraction cancelled this intentional shift.
Camera rotation is separate and must not change the absolute placement.

Absolute-coordinate regressions run without a game installation. Read-only
integration tests additionally compare the rotated construction grids of
installed AIVs at every available map start; they do not launch the game.

## Original game graphics

Startup, restored projects and map selection never launch Crusader. The former
cache-miss path did start a private game copy automatically; this has been
removed along with executable patching, helper installation, junction creation,
UCP launch configuration, process locks and process management.

Existing four-camera captures are read-only compatibility data. Their request,
map, executable/assets fingerprint and layer lengths are still validated.
Missing, stale or corrupt captures fall back to the saved map's GM1 terrain,
initially viewed from its saved camera (section 1044). X/C can rotate that
fallback, but reuse its directional artwork. No game
installation or helper directory is created or changed by this reader.

The bundled Lua files remain only to validate historical capture fingerprints
and document their format. The editor neither installs nor executes them.
The following describes how older builds generated these captures:

The private executable has a separate instance mutex. It runs only the standard
graphics modules and the supplied renderer module, loads a private copy of the
map, exports four graphics layers, and exits. The per-process UCP flags permit
that local module; Windows security settings are unchanged. The input map and
engine hashes, request ID and layer lengths are checked before accepting an
export. Unrecognized executable builds are refused rather than called through
unverified addresses. Cached output is invalidated when the map or relevant
renderer inputs change.

Original Crusader 1.41 calls used by the helper:

| Routine | Address | Purpose |
| --- | --- | --- |
| `MapPropertiesState::loadMap` | `0x004c62c0` | Load `preview.map`; ResourceManager map slot 15 adds `maps\` at `0x004786d0` |
| `TileMapState::changeMapOrientation` | `0x00501b90` | Set camera 0, 2, 4 or 6 and refresh direction-dependent state |
| `TileMapState::updateGfxLayer` | `0x00509180` | Rebuild tile graphics |
| `TileMapState::updateGFXLayers` | `0x004fc9e0` | Regenerate directional terrain graphics |
| CRT `_exit` | `0x00583d55` | Exit this private helper after closing its exports |

The existing GM1 decoder and atlas builder convert the game's resulting
layers. There is no second bank/cliff terrain-generation algorithm. The saved
map atlas remains available when cached layers are missing or invalid, with a
visible status message. Valid captures provide four separate normal and Space
atlases, selected together with the camera.

Starting stockpile platforms can change height during the game's map load.
The reader compares the unchanged default ground layer (map section 1045)
against the exported default heights, then uses the game's resulting current
height layer for drawing and picking. It does not require saved platform
heights to survive map initialization unchanged.

## Verification and limits

The coordinate fixture was read from the running game's four projection-table
banks. It covers interior and edge tiles, all four orientations, inverse
picking, height and viewport focus. A separate Electron check verifies that
the selected directional atlas follows the scene and that four turns restore
map placement. Farm components and plates rotate as groups, preserving their
original pixels and footprint offsets.

The September 12 regression check used the affected user's cached map on
GamerGrill. The previous helper passed `maps/preview.map` to a loader that
already prepends `maps\`, silently producing an empty map. Keeping the
height validation exposed this error. With the basename corrected, the same
map produced four validated camera layers and its actual elevations in 3.7
seconds including atlas conversion. A hidden Electron check dispatched actual
C/X keyboard events, verified the 12,100-tile maximum, confirmed that four
turns restore terrain positions, and observed zero terrain redraws on hover.
All tests ran remotely; timings are specific to this machine and map.

Direct SSH Session 0 fails during the original game's graphics initialization.
Remote native tests therefore use a hidden scheduled launcher in the logged-in
desktop session. That historical capture workflow is no longer invoked by Toolkit startup.
No game or editor test was run on the user's workstation.

This reuses the game's terrain-generation path; the editor still composites
GM1 building sprites and terrain in its own canvas. Building animation, growth,
livestock and random runtime state are not simulated by an AIV. This feature
does not imply that the entire game renderer or simulation is embedded in the
editor.
