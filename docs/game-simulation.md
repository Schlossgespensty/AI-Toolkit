# Game simulation captures

The game is the authority for worker entrances, walkability, wall/gate/stair
transitions, production and fire. The Toolkit's capture viewer plots positions
read after actual simulation ticks. It does not run another pathfinder or assume
that an unsaved AIV is identical to the recorded world.

1. Install UCP Recorder 0.51.x (tick-observer API v1) and the supplied
   `integrations/ai-toolkit-observer` module in a classic Crusader 1.41 profile.
   The public API is supplied by [Recorder PR 49](https://github.com/Corax34/ucp_recorder/pull/49).
   The observer is an optional diagnostic integration with measurable runtime
   overhead; it is not a live route planner for an unsimulated AIV.
2. Enable Recorder and the observer in UCP, then record a single-player game
   containing the castle and concrete map you want to inspect.
3. In the Toolkit choose **Game simulation → Open capture**. Open
   `ucp/replays/<session>/ai-toolkit-trace.jsonl`. Keep its `start.sav` and
   `ucp-config.yml` beside it; their SHA-256 hashes must match the trace header.
4. Scrub the recorded ticks. Choose a worker to inspect its actual route,
   assigned building and entrance. Fire occupancy shows how many recorded
   samples contained fire on each tile; it is not a probability forecast.
   Spark trails show actual type-32 projectile positions, including height.

The observer subscribes to Recorder's public completed-tick API and reads memory.
UCP exposes other modules through read-only proxies; the observer never replaces
Recorder's private callbacks. It installs no
second native hook, calls no RNG or pathfinding routine, and changes no game
state. It rejects incompatible layouts and unit indices beyond the original
2500-slot array. The native unit high-water mark can be smaller than that capacity.
Captures stop at 64 MiB, 100,000 ticks or five million reconstructed entity rows;
errors stop the observer without suppressing Recorder's callback.
Recorded settings and the starting save are immutable provenance, not a request
to load arbitrary paths from JSON. Loading a capture never starts the game.

Worker cargo unloads are observed counter transitions, not a claim that the
entire stockpile increase was production: purchases, consumption and transfers
can also change stock. Measured unload intervals include walking and waiting.
Gaps and recycled unit IDs must not join unrelated routes.

## Native verification and capture encoding

On GamerGrill, the original classic Crusader simulation completed 1,000 ticks
from a populated save: 279 workers (195 moved), 519 buildings, up to 717 fire
entities and 30 travelling sparks. The Toolkit imported the capture with matching
starting-save and settings hashes. Recorder's existing completed-tick hook
delivered the observations; the test did not invoke an alternative pathfinder.

Version 2 stores changed tuples and explicit removals instead of rewriting
unchanged state. Every tick remains present. Reconstructing all 1,000 ticks from
the original full capture preserved every tuple and resource value. The native
delta capture was 2,029,049 bytes, versus 48,685,807 bytes for full frames.
Time measured inside capture callbacks fell from 22.706 to 6.483 seconds across
1,000 ticks on the test machine. This is a diagnostic overhead measurement, not
a promise of that cost on every castle or PC. The reader also supports version 1.

The SSH harness used a private game copy, enabled its background main loop and
marked the loaded world active because the hidden test skips the rendering
branch that normally does so. Those test-only changes are not part of Recorder
or the observer. The test ignited a church through the game's own ignition call;
the shipped observer only reads state.

## Fire findings

Researched executable SHA-256:
`0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34`.
OpenSHC declarations and decompilation use `SHC_3BB0A8C1` addresses.

* `igniteBuilding` (`0x0041C810`) seeds footprint tiles at strength 2. Its
  wrapper **does** call `IgniteFireAtMiniTile` (`0x004052E0`), which picks one
  of 64 asymmetric offsets from `0x005B6E70`. Eight microtiles equal one tile.
* `updateFireEntity` (`0x00405680`) has local propagation and reheating.
  This alone is not the building's full eventual fire reach.
* `spawnRandomFireEffectOnBuilding` (`0x00410800`) begins after burn duration
  399. Its interval depends on footprint width `n`: `24−5n` below four,
  `5(8−n)` for four through six, and `5(16−n)` above six. Fire damage can
  destroy the source before this phase; health, suppression and balance matter.
* The spawned object has **entity type 32**; the call's first argument, 5,
  is a unit type. `initializeProjectileVelocities` (`0x00403A20`) gives it
  an angle of 45–74 degrees and speed 35–42. Its time step is about 0.18.
* The x87 instructions in `moveProjectileEntity` (`0x004084A0`) compute
  horizontal travel `trunc(0.25 v_cos t)` and height change
  `trunc(2(v_sin t − 4.906 t²))`. The decompiler incorrectly types the time
  field as an integer; using that output literally would be wrong.
* On equal-height unobstructed ground, the continuous-flight major-axis
  estimate is `v² sin(2 angle)/(4×9.812)`. A possible RNG combination,
  speed 42 and angle 46°, yields about **44.92 microtiles / 5.61 tiles**
  before landing. The initial ±24 target offset chooses direction; it does
  not cap the flight at three tiles. Ignition jitter and subsequent fire
  add further reach. Discrete steps, collisions and elevation change it.

These findings invalidate the previous fixed three/four-tile envelope. They do
not establish a universal nine-tile church radius or a symmetric two-tile
initial border. The capture viewer shows the game result, including successive
stages, rather than turning these partial formulas into another competing model.
