# Castle costs and game simulation

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

The previous static models have been removed. They did not have the runtime
terrain, entrance, wall-linkage or staged spark state needed to match the game.
See [Game simulation captures](game-simulation.md) for the observer, viewer,
verified fire research and remaining in-game validation requirements.

## Resource-building plan artwork

Wheat (9x9), hops (9x9), apples (11x11), dairy (10x10), quarry (6x6), iron (4x4)
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
