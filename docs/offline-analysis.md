# Offline analysis work (unfinished)

The editor must calculate the current unsaved AIV, selected build step and actual
map, then draw Path map and Firespread directly in its existing views. A replay
capture viewer does not satisfy this requirement and has been removed.

## Native proof on GamerGrill

A private helper loads the selected map with the original Crusader 1.41 loader
(0x4C62C0), calls the original placement functions, resolves building entrances
(0x421BE0), spawns a worker (0x53E440) and queries its destination (0x53D3D0).
There is no recorded-game input and no alternate JavaScript pathfinder.

On Gatekeeper.aiv, 286 placements yielded 23 building records and four rejected
building placements; walls/stairs are separate native tile structures. The four
workshop entrance queries returned paths of 82, 75, 78 and 72 directions to the
native stockpile entrance. These are prototype results, not an editor feature.

Two mistakes were found by tracing the original routines:

- spawnUnit adds four micro-units itself; supply tile coordinates multiplied by
  eight, without adding the half-tile centre a second time.
- A stockpile's footprint origin is not its worker destination. Read its native
  entry; in this map the origin is (195,296), entry (195,298). Querying the origin
  returned no path while querying the entrance returned native paths.

Still required before enabling overlays: verify the complete packed path and
special wall/gate/stair transitions; complete placement handling for moat,
pitch, multipart buildings and rotated keeps; retain placement failures;
verify the active UCP changes; implement and validate staged fire/ember behavior;
and connect async results to the current document with cancellation and caching.
No guessed fixed-radius fire result or static terrain-free route model should
be exposed as the native result.

## Performance

The scene is composed once at native scale. Panning, zooming and hover transform
that cached image; editor changes, step changes, camera turns, terrain and image
loads invalidate it. Terrain and buildings retain the same interleaved draw
order. The map remains bounded to the AIV area plus five tiles on each side.

In the GamerGrill offscreen software-rendering profile, cached redraws fell from
about 147 ms to 6 ms. This is a controlled renderer measurement, not a guarantee
of frame rate on every machine. Step/camera changes still rebuild the scene.
