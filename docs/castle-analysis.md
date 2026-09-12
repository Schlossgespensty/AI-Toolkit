# Castle costs and planning overlays

The collapsible **Castle costs** panel defaults to the left dock. Its resource
line and overall total include only placements through the selected step,
using the same scope and price source as the per-building breakdown. Future
steps and their unknown prices do not contribute. Quantities of different
resources are kept separate. Unknown prices mark the total as partial.

## Sidebar space

The divider between the main list and overviews can be dragged vertically.
Drag it to either end to collapse that section, or use the labelled **Steps**
/**Overview** buttons on the divider. The same controls remain visible to
restore it. The middle grip supports Arrow Up/Down, Home/End to collapse and
Enter to restore. Split proportions and collapsed state persist per sidebar.
Moving overviews through the existing View menu preserves the split, and a
side with no visible overview gives all space back to its main list. Population
and costs share one overview scroll area rather than competing percentage caps.

## Balance selection

**Use UCP balance** reads the installation selected in Library, its
`ucp-config.yml`, and the resolved `rebalancer.config.balance_config_file_selector`.
For an extension-directory wildcard, it uses the version selected in the
resolved UCP load order; older installed versions do not compete. The remaining
path must resolve to exactly one file. Without a resolved load order, ambiguous
versions are rejected. Paths outside the installation, missing profiles and malformed
values produce an error, without replacing the selected profile. Nothing is
executed from a plugin. **Load…** also accepts standalone balance JSON files.

The full profile is retained, including resource delivery and other sections.
Building `cost` arrays use wood, stone, iron, pitch, gold in that order. Missing
overrides retain the bundled executable-derived price. Explicit zero overrides
are respected. The established AI-free walls/stairs/keep rules remain distinct
from player construction prices. `housing` overrides affect the population
used for the AIC estimates. The Keep's runtime variant is not identified by
this editor's cost mapping, so Keep housing retains the configured default.

This is a **snapshot of the configured rebalancer input**, not a read of live
patched process memory. Reload after changing UCP settings. Arbitrary Lua
patches applied after rebalancer cannot be inferred from this file. Resource
buy/sell prices do not change the physical construction quantities. No gold
conversion of goods is implied.

Pitch is a special payment rule, not a normal per-building table price:
`0x0041BFD0` charges one pitch and retains a per-player placement counter.
The ordinary default is four tiles per pitch. Rebalancer's `castle.ditch_per_pitch`
changes that to 1–4 (Team Liga uses 2). The panel rounds the cumulative pitch
tile count across steps, assuming a fresh counter, rather than charging or
rounding separately at each step. Merging pitch steps therefore cannot change
the estimated total. The map-editor mode's free-pitch branch is not used for
the AI castle construction estimate.

Reference: [CIO61/rebalancer, init.lua at 8d5b47e](https://github.com/CIO61/rebalancer/blob/8d5b47e1d61cab8c0f4b1f301669d2541788facd/init.lua),
`edit_buildings` (lines 624–651), production patch offsets (458–477),
`edit_resources` (881–920), and `apply_rebalance`/`enable`.
The schema documents `baseDelivery` and the optional 50% skirmish bonus.

## Production estimate

The line immediately under construction costs shows **potential gross output**
of wood, stone, iron, pitch, meat, fruit, cheese, hops and wheat. It is not a
prediction of stockpile contents or a complete economy simulation. Workshops,
food consumption, trade, tax income and initial resources are not included.

Each interval contributes 50 ticks, using the existing measured AIV build-step
timing model. Housing and AIC thresholds are evaluated separately for each
interval. Newly eligible producers cannot contribute to earlier intervals.
Explicitly placed resource buildings count towards the AIC target rather than
being counted twice. A producer retains its own unfinished cycle and delivery
fraction. Farm kinds come from the Character's Farm1…Farm8 slots.

Editable planning defaults:

- Resource distance: 25 tiles, plus 5 tiles per additional building of that type.
- Walking: 4 ticks per tile. Work: 500 ticks per delivery, separately editable
  for each resource. **These are assumptions, not measured game cycle times.**
- Cycle = work ticks + two-way distance × walking ticks.
- Neutral delivery productivity: 100%; skirmish mode enabled.

Delivery base quantities are from the rebalancer's original instruction
signatures: wood 12, stone 8, iron/pitch 1, meat 6, fruit/cheese 3, wheat 2,
hops 2 in skirmish and 1 in scenario mode. The selected profile can override
these and disable a resource's skirmish bonus. Disassembly of `0x00530D70`
confirms a minimum productivity of 100, an additive 50-point skirmish bonus,
and a per-worker remainder carried between deliveries. For example, two
one-unit deliveries at 150% total three goods, rather than two or four.

Actual staffing, pauses, failed placement, resource availability, work
animations, fear/rest, unit-speed patches and ox transport are not simulated.
Stone means quarry output; it may not have reached the stockpile. Loaded
balance sections for these effects are retained, but do not silently replace
the explicit timing assumptions. Production is an estimate even when prices
and delivery quantities are known.

## Worker routes

**Worker routes** draws cyan entrance markers and paths in both views. It uses
first-pass entrance candidates from `setupBuildingEntrancesOffset`
(`0x0040BA10`, arguments size, 1, attempt, 0), preserving table order and
transforming coordinates into the editor's upward Y axis. The automatic
stockpile attached to the Keep is included.

The topology now distinguishes ground passages from elevated surfaces:

- Small/large gates have a central passage along their NS/EW axis. The roof is
  a separate surface; walking through a gate does not give access to its roof.
- Wall walks, tower decks and stairs connect. Stair 6 can enter an adjacent
  tower directly. Ordinary ground cannot enter a tower or climb a high wall.
- Stair segments use heights 80, 64, 48, 32, 16, 0 and the ordinary 16-height
  neighbour threshold. High/low walls use 90/60. These values come from
  `placeWalls` (`0x00502F30`, explicit-placement branch at `0x005034D1`).
  Tower roof offsets come from `0x00409DB0`: 296/148/180/192/192.
  Intact tower-to-wall/stair links bypass the ordinary height threshold.
- Diagonally touching wall walks connect; diagonal edges cannot skip stairs or
  enter a tower from ground. Cardinal ground paths remain conservative. Crenellations remain blocked
  because their walkability also depends on world-tile parity and live flags.

This is a static reconstruction for intact, same-owner structures on level
terrain, not the live pathfinder. `updatePathLinkageLayerBasedOnBuildingsUnk`
(`0x004999C0`) distinguishes stairs, walls and building-backed wall surfaces,
checks +/-16 height differences for ordinary links, and permits intact tower
connections using the damage layer (threshold 20). Gate linkage (`0x00499FA0`)
uses the centre row/column and checks gate state, obstacles and terrain height.
The planner assumes open gates; AIV does not store their live state. Closed
passages can be represented by its internal `closed` flag.

The game entrance routine also checks live regions, terrain, saved entrance
attempts and worker-specific fallback rings. The planner accepts the first
reachable ground-level first-pass candidate. Dijkstra search includes diagonal
wall-walk length. Efficiency is straight-line distance / routed distance, not
worker productivity. Damage, terrain, granary trips, traffic and external
resources remain outside this model; route lengths do not feed production.

## Fire spread

The original overlay was incorrect: it started intensity 3 on every footprint
tile, omitted ignition jitter and treated sustained burning as two fresh
propagation generations. It also implied a spatial probability distribution
without simulating the stateful game process. That model has been removed.

The toggle now offers two explicitly different views:

- **Initial fire spread** enumerates the ignition seeds and their first spread.
  `igniteBuilding` (`0x0041C810`) visits size-squared footprint tiles in row-major
  order, requesting intensity **2** at `(tileX*8, tileY*8)`. The generated layout
  table (`0x004F9590`, accessed by `0x004F9880`) uses offsets 0 through size-1;
  there is no rounded-centre substitution. `0x00407130` forwards intensity 2
  to `IgniteFireAtMiniTile` (`0x004052E0`), which adds a 64-entry random microtile
  offset before retaining the fire position. The fire updater then attempts
  four cardinal offsets of eight microtiles, each with another jitter sample,
  reducing intensity **2 to 1**. Intensity 1 does not propagate.
- **Reheated upper bound** allows all 8x8 microtile phases within each source
  tile and two outgoing generations from intensity 3. It is a conservative
  geometric envelope, **not a prediction that every displayed tile can burn**.
  Burning buildings can sustain intensity 3, but that happens in a later
  lifecycle phase. Propagation requires phase zero, animation frame one and
  an unspent direction counter. Re-hitting an existing fire resets its phase
  and animation and raises its intensity, but does not reset that counter.
  The bound deliberately ignores these timing/coalescing restrictions.

For an interior source on unobstructed, level terrain, the initial envelope's
extrema relative to its occupied footprint are X **-3 to +3**, game Y **-3 to
+2** tiles (editor Y reverses the sign). These are axis extrema, not a filled
rectangle: corners differ. For example, two (+8,-8) jitters plus a +8 X attempt
reach (+24,-16) microtiles, or tile (+3,-2); the reflected tile (-3,+2) is not
in that single-seed envelope. The reheated envelope has axis extrema -4 to +4.
Building size expands the shape from the actual footprint corners. The inspected
seed routine does not establish a special odd/even-size radius rule; collisions,
seed order and available microtile phases can change a particular fire's outcome.

Red outlines the selected envelope. Orange distinguishes seed and propagation
bands, **not probability**. Enumeration includes independently possible jitter
values; the game shares an RNG and coalesces fire entities on occupied tiles,
so simultaneous reach and observed frequencies are not inferred. All sources
must pass the game's flammability lookup. Its values 1/4/5 are **not radii**.

Both views omit runtime terrain/obstacle flags, suppression and secondary
ignition chains. The updater rejects a direction at a neighbour height difference
of 25 or more; ignition applies additional tile flags and building-type filters.
A static AIV alone cannot reproduce these live map layers. Pitch/weapon fires
may start with other intensities. A newly ignited neighbouring building becomes
a fresh source, so neither envelope is a whole-castle fireproofing guarantee.
The rebalancer's `castle.fire_damage` changes unit fire damage tables, not this
jitter table or propagation range; it must not scale the overlay radius.

## Resource-building plan artwork

Wheat (9x9), hops (9x9), apples (11x11), dairy (10x10), quarry (6x6), iron (4x4)
and pitch (4x4) plan skins are assembled from the original Gremium village
editor's `gm/colour tiles.gm1`, with one 32x32 source tile per AIV tile. The
food/industry corners, edges and centres retain their native scale; the old
4x4 placeholder is no longer stretched over the whole farm. This restores the
classic schematic artwork, not crop growth or livestock. Existing 2.5D farm
sprites remain the static 3x3 farm building anchored within the full field;
variable field/fence layouts are not represented by these plan skins.

## Numerical source data

`src/js/castle-game-data.js` contains numerical tables inspected from the local
Crusader 1.41 executable, SHA-256
`0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34`.
No executable or disassembly is distributed.

- `0x00410920`: flammability switch, lookup at `0x00410978`.
- `0x0040BA10`: entrance candidates; count table `0x005C06E0`, size tables
  `0x005C071C` through `0x005C10E0`.
- `0x004052E0`: fire jitter selected by RNG & 63 from `0x005B6E70`.
- `0x00405680`: directional propagation, intensity decay and sustained burning.
- `0x0041C810`: ignition filters and per-building intensity-2 fire seeds.
- `0x004F9590` / `0x004F9880`: footprint offset table generation/access.
- `0x004999C0` / `0x00499FA0`: wall/stair/tower and gate path linkage.
- `0x00530D70`: resource-delivery bonus and fractional carry.

Function names and addresses were cross-referenced against
[OpenSHC's building declarations](https://github.com/sourcehold/OpenSHC/blob/main/src/OpenSHC/Map/Buildings/BuildingsState.func.hpp)
and [entity declarations](https://github.com/sourcehold/OpenSHC/blob/main/src/OpenSHC/Map/Entities.func.hpp).
Decompiler export failed for these functions; the numerical tables and branch
behavior were inspected directly in the executable. Planning assumptions are
kept separate from that evidence.

Automated checks run on GitHub's Windows runners. No local interactive game or
editor validation has been performed for these changes.

## 2.5D map alignment

The full-map tile atlas renders elevations directly. Previously this bypassed
the cropped-background path that initialized `hoehenFeld`; building sprites
and picking could therefore use zero or a stale height while the background
was elevated. They now use the atlas height at the same mapped tile, including
the selected Keep's rotation/offset. An eight-pixel elevation no longer leaves
the sprite half a tile below its ground. A separate ground-texture correction
scales 30×16 artwork to the 32×16 grid independently on each axis.

The regression checks cover atlas mapping, sprite anchoring and picking at all
four rotations and multiple zoom levels. They do not establish that every
artist-provided sprite or low-resolution map preview is pixel-perfect; visual
comparison on the reported map remains pending.
