# Castle costs and analysis

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

Editable planning defaults and caveats are documented in
[Production references](production-reference.md). Distances start at 25 tiles,
plus five for each additional producer. Walking rates and workshop itineraries
use the cited Stronghold Heaven references, not a universal 500-tick placeholder.
Unknown work rates stay unknown. Food journeys use the granary/delivery distance;
stockpile goods use the stockpile distance. Custom timings and distances from
previous installations are preserved, except the old unmodified placeholders.

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

## Worker routes and fire

The toolbar overlays use the simplified planning model described below. They
calculate the current edited castle without launching the game or importing
recorded gameplay. Native engine integration is separate research, not a
prerequisite for these explicitly labelled estimates.

## Resource-building plan artwork

Wheat (9x9), hops (9x9), apples (10x10), dairy (10x10), quarry (6x6), iron (4x4)
and pitch (4x4) plan skins are assembled from the original Gremium village
editor's `gm/colour tiles.gm1`, with one 32x32 source tile per AIV tile. The
food/industry corners, edges and centres retain their native scale; the old
4x4 placeholder is no longer stretched over the whole farm. This restores the
classic schematic artwork, not crop growth or livestock. The 2.5D renderer now uses native hut and field components; see
[Native building components](farm-graphics.md) for initial-state assumptions.

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


### Cost source, resource rows and legacy plan tiles (2026-09-12)

Opening an AI project refreshes its installation's resolved UCP balance. The loader
reads the initialized-data cost table from the on-disk Stronghold Crusader.exe
using the cost initializer reference (with an unambiguous legacy signature fallback), then overlays the selected
profile. Cost omissions preserve that EXE baseline; other patch sections remain
available. This does not inspect live process memory or arbitrary later Lua
patches. Unsupported/ambiguous tables fail explicitly; refresh failures remain
visible when changing steps. The source tooltip contains the full path.

Mapper 166 and mapper 169 both resolve to runtime Garden 66 in Crusader 1.41
at 0x00409370 (both branch to 0x00409570). Runtime row 66 at 0x005C21D0 costs
30 gold. Rebalancer's table starts one row later (Hovel), so Garden is its index
65. Both garden variants now use Garden balance overrides.

Resource rows show Cost and Produced through the selected step, using original
HUD images loaded from the installation's gm/interface_icons2.gm1. No HUD archive
is redistributed. Text labels remain available as fallback and image alt/title.
Produced remains an estimate of gross output, not inventory.

The original Village Editor's colour tiles are clockwise: corners TL/TR/BR/BL
40/60/80/100, edges T/R/B/L 120/140/160/180, centre 200, plus colour index.
Previously swapped side edges put the dark outside border inside the field.
All seven added farm/resource previews now use the corrected original tiles.
Regenerate via scripts/export-resource-skins.js and an original colour tiles.gm1;
it reuses the existing GM1/TGX decoder. Full native footprints and AIV round trips
remain covered by resource-building tests. This corrects plan textures; variable
2.5D crops, livestock and fences remain outside the static sprite preview.


## Path map and Firespread planning overlays

The existing castle toolbar provides **Path map** and **Firespread** checkboxes.
Both views use only buildings through the selected step, including unsaved edits.
No game launch, capture file, observer, or separate simulation window is needed.
Calculations are debounced in a Web Worker and stale replies are discarded.
Pan/zoom/hover reuse the result and the cached 2.5D scene.

Fire is an explicit planning estimate with an HP-sensitive crimson/yellow/blue
halo (see HP-sensitive fire preview below). Distance is Euclidean from the actual
footprint edge, preserving rounded corners and multipart footprints. Flammability
uses the existing executable-derived table; colour is not ignition probability.

Paths use a multi-source Dijkstra search from one delivery point per stockpile. Routes cross stockpile interiors instead of stopping at the first stockpile tile. Stockpile mapper
52 and the keep's attached stockpile expose only their central cross as a walk surface. Stairs have six height
levels; Stair 6 can connect directly to a tower. Tower decks, wall walks and
open gate passages are connected separately from ground, so a gate passage
cannot implicitly climb onto its roof. Diagonal ordinary-building corners are
allowed; gaps between walls or a wall and negative fear buildings are blocked.
Four-by-four worker buildings next to a full wall start their entrance search
on the opposite side, using the retained entrance candidate tables.

When a map is selected, section 1003 logic flags, section 1004 organisms and
base ground heights constrain the search. Sea, non-ford river, trees, rock/iron
obstacles, map edges and height changes greater than 16 block ground routes. The shared
keep transform aligns these layers with the current AIV. Saved building/path
layers are not used because they describe a different castle. Gates are assumed
open, the castle intact, and traffic/ownership changes are not simulated. Without
a map, paths are a castle-only estimate on flat terrain.


## Incremental build-step rendering

Selecting a step updates the existing list rows instead of recreating their DOM
and event handlers. The 2.5D view records the existing sprite draw calls at native
scale, retaining their exact anchors and source rectangles. Terrain commands
are retained across step changes. Changed or removed building commands (including
neighbour-dependent wall/stair variants) determine a damaged pixel rectangle.
Only intersecting terrain and building commands are replayed, in their shared
depth order, within that rectangle. Foreground rocks and trees still occlude
buildings correctly. Camera, map, image and surface-size changes rebuild fully.
No per-step full-size canvas cache is allocated.

GamerGrill's offscreen software-rendering check with Gatekeeper and both overlays
active measured step changes at about 40 ms mean / 49 ms maximum, down from the
previous 196 ms mean. The measurement includes two animation frames; it is not
a claim of a 40 ms drawing call. Cached paints averaged 4.5 ms. Pixel comparison
checks that stepping backward then forward restores an identical scene. Large
step jumps and rotations can still require substantially more drawing.


## Worker-route corrections

Civilian worker counts come from the population data, with an explicit per-building
count (including zero) taking precedence. Every worker building retains an entrance
marker: cyan when connected, coral when blocked. Hovering a marker gives its reason;
hovering other tiles shows ground, raised walkway, both, or blocked, using the same
graph as the search. These are access routes to storage, not complete production trips.

Entrance selection uses physical clearance, independently of destination reachability.
The south-facing default rotates clockwise; a full wall alongside a 4x4 workshop
starts the search on the opposite side. The original perimeter table supplies the
fallback sweep after side centres. Killing pits, pitch, stockpiles and the keep
courtyard are walkable. Dummy editor markers do not overwrite actual structures.

The map mask separates permanent water/border constraints from vegetation and
resource obstacles that a current construction replaces. Constructed stockpile
platforms do not inherit raw-ground cliff edges. Unbuilt terrain still constrains
routes. A single binary-heap, multi-source Dijkstra search serves all workers;
calculation runs in the existing Web Worker and stale results are discarded.


Stair connections include diagonal neighbours at the same or next level. Stairs
2/3 connect to low walls, Stair 6 to tower decks, and every stair level to gate
decks; ground gate passages remain separate. Drawbridge walk surfaces overlay
later moat placements. Ford flags override river water, while rocky tiles and
resource obstacles remain blocked. Ordinary terrain can change by up to 16
height units per move. These are the explicitly requested static planning rules.

Map-aware navigation includes a five-tile margin beyond the AIV boundary;
route coordinates and entrance markers remain in AIV coordinates. This does
not expand the rendered map or change the castle footprint.


Ordinary connections compare **terrain height + structure offset** at both ends,
with a maximum difference of 16. This applies across surface types (including
cliffs, walls and stairs), rather than treating stair numbers as connectivity
rules. `placeWalls` at `0x005034E2..0x00503510` copies the default terrain height
before adding 90/60 for high/low walls; subsequent branches add stair offsets.
The route keeps its relative height for drawing, and its total elevation for
navigation. Explicit gate/tower links and constructed-platform access remain.


### First-stockpile and directional connection correction (September 13)

Delivery routes share one destination: the west end of the keep-created first
stockpile's cross. Later stockpiles remain transit surfaces. An inaccessible
first destination is reported; another extension is never silently substituted.

The native stockpile placement routine (`0x00508540`) marks four 2x2 storage
quadrants unwalkable and nine cross tiles walkable. Its platform is placement
base +10, not raw terrain height. The preparation routine computes the base as
`minHeight + floor((maxHeight-minHeight)/2)`, rather than a mean of all tiles.
Cross tiles share this elevation and obey the ordinary 16-unit connection limit.
`placeWalls` (`0x00503626..0x0050363B`) adds four units when terrain flag 8 is set;
the map reader now exports that construction lift and invalidates older cached
navigation data. Entrance markers also retain elevated surface offsets in 2.5D.

Wall-to-gate roof links permit diagonals; wall-to-tower links are cardinal only.
Gate passage endpoints permit diagonal approaches/exits while passage interiors
remain axial and separate from the roof. These remain static planning rules,
not a replacement for running the native path grid.

Private current-map validation uses GreekSea.map and Kratoloros.aiv (2,345
placements, 87 worker buildings). 80 currently reach the first stockpile;
seven remain disconnected. In particular, the marked Stair 6 has total height
80 and its adjacent high wall 98, with no flag-8 lift on either tile. The static
16-unit rule rejects that 18-unit edge. Do not widen the threshold or claim this
specific shortcut is fixed without resolving the runtime-height discrepancy.


### Fire display and open-gate access (September 13 follow-up)

The fire visualization uses two crimson tile rings and an HP-scaled yellow-to-blue
outer halo, with a smooth transparent edge (current formula below).
Color represents distance from the nearest flammable footprint, not an ignition
probability. Flammable plan buildings are drawn above the overlay. The 2.5D view
caches a visible-sprite alpha mask in scene depth order so the halo cannot tint
flammable sprites or undo their terrain occlusion. Masks update only in damaged
scene regions and are omitted while fire display is disabled.

Open gate endpoints connect the ground passage and roof display nodes. The
previous completely separate surfaces prevented a stair-to-gate-to-ground route.
The native endpoint routine at 0x00499FA0 changes the same walk-link grid as
0x004999C0; the two surfaces in this planner are display bookkeeping, not separate
native connectivity grids. Closed gates keep passage access disabled. Current
GreekSea/Kratoloros checks reach 86/87 worker buildings after this correction.
The remaining mill's selected entrance is in an isolated two-tile terrain pocket.
The southeast stockpile cross is elevation47 against nearby ground8: its 39-unit
boundary drop remains blocked by the requested 16-unit rule. Stockpile quadrants
remain solid; the central nine tiles are traversable.


### Mill entrance connectivity correction

`determineBuildingEntranceFromKeepArea` (`0x0041AF43..0x0041AF7E`) compares the
candidate's area with the keep area and checks linked areas before accepting it.
The planner previously accepted the first physically free candidate, even in an
isolated pocket. It now keeps the existing entrance preference order but skips
candidates that cannot reach the first stockpile, using the already-computed
Dijkstra field (no additional graph searches). If none connect, the first free
candidate remains visible as a blocked marker. Stockpile storage quadrants are
still blocked; only the existing elevated cross is an entrance surface.

In the current GreekSea/Kratoloros fixture the mill now selects `(63,37)` on the
stockpile cross instead of the disconnected `(65,40)` pocket. All 87 worker
buildings reach the first stockpile. This corrects the earlier assumption in
these notes that entrance choice should ignore area connectivity.

### Recruitment gathering grounds

Barracks and mercenary-post AIV footprints (87 and 86) now distinguish their
solid 5x5 structure from the three adjoining 5x5 gathering grounds. The native
`placeBarracks` routine at `0x005076A0` creates those three components using the
offsets at `0x00B49090`. Each ground marks only its central flag tile occupied
(`0x00507876..0x0050788D` and the equivalent two loops), rather than its whole
area. The default AIV footprint places the structure in the north-west quadrant.

The planner keeps that structure and the three flag tiles blocked and opens the
other 72 tiles at the placement base height, with no stockpile-style height lift.
These surfaces participate in the existing height-aware shortest-path graph and
can serve as worker entrance candidates. Terrain obstacles remain enforced.


### HP-sensitive fire preview
The fire preview remains a user-selected planning heuristic, not a native fire simulation.
Selected balance `buildings[name].health` overrides the vanilla HP table (Crusader 1.41,
file offset 0x001BA21C, indexed using rebalancer building_names). The outer radius is
`2 + 6 * sqrt(clamp(HP / 800, 0, 1))` tiles: approximately 3.64 at 60 HP,
5 at 200 HP, and 8 at 800 HP or more. Unknown buildings retain the eight-tile fallback.
The first two adjacent tile centres (0.5 and 1.5 from the footprint boundary) are
crimson. Colour starts changing immediately after 1.5, reaching yellow at nominal
3.5 and blue at 6; the outer band compresses for lower HP. Inner opacity is reduced
10% (189/255); blue remains visible at 7 (90/255) before a smooth fade to zero at 8.
Balance HP changes invalidate the cached worker result; fire remains below burnable
buildings and above nonburnable structures in both views.
