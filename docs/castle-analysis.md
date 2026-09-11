# Castle costs and planning overlays

The collapsible **Castle costs** panel defaults to the left dock. Its resource
line totals all placements through the selected step; the entire-castle line
and building breakdown use the same price source. Quantities of different
resources are kept separate. Unknown prices mark the total as partial.

## Balance selection

**Use UCP balance** reads the installation selected in Library, its
`ucp-config.yml`, and the resolved `rebalancer.config.balance_config_file_selector`.
It resolves the plugin wildcard only if exactly one file matches. Ambiguous
versions, paths outside the installation, missing profiles and malformed
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
the first-pass entrance candidates from `setupBuildingEntrancesOffset`
(`0x0040BA10`, arguments size, 1, attempt, 0), preserving their table order.
Table coordinates are transformed into the editor's upward Y axis. The
automatic stockpile attached to the Keep is included.

The game routine `determineBuildingEntranceFromKeepArea` (`0x0041ADE0`) also
checks live regions, terrain heights, a saved attempt index, worker-specific
rings and fallback candidates. These cannot be reconstructed fully from AIV.
The planner starts at attempt zero and accepts the first reachable first-pass
candidate. A cardinal shortest-path search routes to stockpile tiles around
the known footprints. The displayed efficiency is unobstructed Manhattan
distance / routed distance, not a production percentage. Gates, elevations,
granary journeys, traffic and external resources are outside this overlay.
An enclosed or unsupported entrance is reported instead of drawing through a
wall. This model does not feed invented route lengths into production.

## Fire spread

**Fire spread** shades relative direct exposure orange, with a rounded stroke
on the red sampled-reach boundary. Only sources with a nonzero result in the
game's flammability switch contribute. Stone defenses, stockpiles and other
nonflammable sources do not generate a halo.

The model retains the game's 64 microtile jitter entries and cardinal spread
directions. It enumerates two generations of the sustained burning-building
intensity (3 → 2 → 1), keeping microtile coordinates until tile conversion.
Color intensity is normalized spatial exposure, under uniformly sampled RNG
indices, with the strongest source winning where overlays overlap. The exact
sampled contour is retained instead of inventing a circular radius.

This is **not an ignition probability**, a whole-fire simulation or a guarantee
that a gap is fireproof. It excludes timing, seed jitter, terrain/height checks,
firemen, damage/health, runtime fire flags and secondary burning buildings.
Chain fires can travel beyond the displayed direct reach. The UI names these
limits. A smooth decorative rectangle would imply probabilities the code does
not establish, so the actual sampled boundary is drawn instead.

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
- `0x0041C810`: ignition filters and per-building fire seeds.
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
