# Native building components

The map renderer and the asset converter share `src/node/gm1.js`. GM1 diamonds
contain 30×16 pixels on a grid with a 32-pixel horizontal pitch. Upper graphics
retain their own lift and half-tile offset. They are not resized to the footprint.

`scripts/export-farm-parts.js GAME_FOLDER` also splits existing building and
ground-plate selections into their original GM1 components. Catalogue filenames
already identify the source group. The exporter checks the GM1 group header
against the footprint before reading its tiles. Terrain, cliffs, upper scenery
and building components then participate in a shared tile draw order.

Farm placement tables were read from Crusader 1.41, executable SHA-256
`0d3d0d0be90a41d0c07d02cb41e6edc3e399288d16039db5b666392660fbda34`.
The exporter refuses other binaries rather than treating these addresses as
portable. Function names and layouts use OpenSHC's `SHC_3BB0A8C1` declarations.

| Farm | Placement | Placement data | Components beyond the 3×3 hut |
|---|---|---|---|
| Wheat | `0x00514F30` | `0x00B49870` | 36 field tiles, four layouts |
| Hops | `0x005151C0` | `0x00B49CF0` | 24 field tiles, two layouts |
| Apples | `0x00515740` | `0x00B49E70` | Eight tree objects |
| Dairy | `0x005154D0` | `0x00B49EB0` | 23 fence tiles, four layouts |

The first four dairy records are cow destinations, not fence graphics.
`updateBuildingAreaTileGraphics` (`0x0040EFD0`) selects farmland tile 55 plus
the result of `getRubbleGraphicStageForDamageLevel` (`0x004FA460`). Wheat and
hops have separate growth-state tile selectors. Apple creation calls
`placeAppleTree` (`0x004F3560`); its initial frame comes from `Tree_1_A`, using
the original `tree_apple.gm1` origin and palette.

The AIV does not contain the world's random layer, crop age, cow positions or
existing per-player farm layout counters. These are **initial-state previews**:
layout order assumes a fresh castle; the running game supplies actual growth,
animation and randomness. Orchard trees are complete tree sprites, not enlarged
hut images. Farm parts currently use the default artwork view.

## Drawbridges

`checkDrawbridgePlacement` (`0x004FA2D0`) probes four edge strips from
`0x00B4AE20`, in order. The first five tiles must belong to the same small
gatehouse, or the first seven to the same large gatehouse. Passage orientation
must match the strip axis. The selected side becomes `uiBuildingRotation =
side * 2`. The editor applies that attachment rule to visible castle buildings;
it does not choose whichever gate happens to be closest. A bridge without an
aligned gate is shown as an unresolved footprint.

Original `tile_castle` preview groups 1332, 1357, 1382 and 1407 provide the four
lowered bridge views. Their camera order is the reverse of the world attachment
order. Runtime animation is separate: `UpdateDrawBridge` (`0x00417B90`) chooses
frames 1, 9, 17 and 25 from `anim_drawbridge` according to relative orientation.
The AIV preview represents a lowered bridge; it does not simulate gate commands.
Terrain placement validity and open/closed walkability are verified by the game,
not by this visual attachment resolver.
