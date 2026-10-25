# 2.5D camera modes

X/C rotate the camera in quarter turns. A loaded saved-map atlas is sufficient:
its terrain, heights and scenery are indexed by world tile, and the existing
camera transform resolves those tiles for each direction. Four historical
engine-generated layers remain preferred when available. Without them, the
saved directional artwork is reused; this does not regenerate engine-specific
shorelines, cliff faces or directional sprites. No game process is started.

Initial map loading respects the saved camera in section 1044, so its saved
banks and terrain face the same direction as the scene. Refresh keeps the
current camera. When historical engine captures are available, Space has a
separate flat atlas for each of those four cameras; it no longer overlays the
saved map's differently oriented graphics on every camera.

Saved picture counters are also checked against native sea semantics:
undecorated sea uses pictures 0–7 in each 246-picture `tile_sea_new_01` bank
(`updateGfxLayer`, `0x0050CDBF`). Both the old compatibility table and an installed
table can refer to valid terrain pictures while disagreeing by 21 pictures
after GM slot 149. Prefer a completely valid table that satisfies those sea
constraints; retain compatibility when the map supplies no such evidence.

The old guard required those historical captures even after saved terrain loaded
successfully. Its "wait or reload" message could therefore persist forever.
Rotation now waits only for the atlas, and retains an actual map load error.

Space toggles flat view: terrain and troops use the game's constant 8-pixel
datum, with no cliff pillars or overground scenery. Buildings use the selected
installation's `tile_flatties.gm1` textures, selected by native building type,
instead of generated footprint diamonds. Farm fields retain their sparse native
layout, stairs use flat stair tiles, and plain walls retain their roof diamonds.
High and low crenellations use the complete native flat tiles 36–39, including
their upper artwork, rather than a sixteen-pixel crop of the normal wall sprite
(`renderMap` at `0x004E99AD` / `0x004EBCC6`). Their variation uses RandomLayer.
Each hut gets one centre symbol. Moats retain their native water/edge artwork.
Campgrounds, training grounds and the oil-smelter campfire use their linked
native building types (51, 53, 55–59). Those negative texture groups retain
their native ground artwork; they are not stockpile floors. Farm fields and
dairy fences use their parent building's plain flat ground tiles (30 and 28),
keeping the sparse placement layout and one centre symbol on the hut. Normal
view retains full crop/fence parts and camera-specific corners. Orchard positions remain visible in Space as native apple stumps
(one-based picture 101), instead of a sixteen-pixel slice of their canopy.
This is an editor visibility choice; the native apple updater hides its sprite.
The saved map has its own flat atlas, including native flat rock tiles and
preplaced building floors. Flat building types come from BuildingLayer (1012)
and the building records (1013, 812-byte stride, type at +210), matching
`renderMap` at `0x004E98C7`. BuildingWasLayer (1049) is only a compatibility
fallback when these records are missing: it can omit keep doors and scenario
decorations, and store the parent type on attached grounds. Surviving cells of
partial preplaced buildings resolve through their building ID individually.
Timber trees retain their native stump (picture 148)
with the saved species, palette and origin; shrubs are hidden and cacti retain
their native pictures. These follow the game's timber/shrub/cactus updaters.
Saved apple trees use the same stump as AIV orchards. Flat tile substitutions happen
before atlas decoding. The selected terrain tiles retain their TGX upper pixels
and offsets, including extended shore banks such as `tile_sea_new_01`, following
`renderMap` at `0x004E9C23`–`0x004E9C8F`. Cliff pillars remain hidden.

Placed killing pits use the completed covered bank (zero-based pictures 8–15)
in normal, V and Space views and their placement previews. Saved map traps keep
their saved graphics; their completed building records have construction state 0
and one-based pictures 9–16 (`updateBuildingGraphicsLayer`, `0x005067F5`). AIV
preview variation uses the map's RandomLayer; it approximates runtime allocation.

The compact Flat view button exposes the state. V toggles lowered structures:
terrain, cliffs, trees and the camera stay fixed. Supported walls, stairs,
towers, gatehouses and the keep use `floor(height / 4) + 1` above the unchanged
ground. Pillars are cropped, preserving the roof art and 30x16 tile base rather
than squashing complete images. Troops follow their visible supports.
This anchored-ground presentation is an editor choice requested after the
earlier terrain-lowering version moved the whole map. Press V again, or click the
Lowered view button, to turn it off. The pressed button exposes its state.
Key release, losing focus, closing, reopening or docking the viewport retains
the mode so screenshots can be captured. The editor deliberately uses a toggle
for V instead of the game's held-key interaction. The game controls are described
in the [Crusader manual, Camera Interface](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/40970/manuals/Stronghold_Crusader_HD_Manual_-_English.pdf?t=1758726250).
Flat texture variation uses the saved map's RandomLayer. Saved structures use
their native building IDs and MiscDisplay centre flag; AIV hut centres are
derived from their actual hut cells. Preview instance parity remains an
approximation of runtime building allocation.
Saved directional artwork is still subject to the camera limitations above.

Flat-view provenance: `renderMap` at `0x004E9845` / `0x004EBBC4` selects a
texture group from the native type table at `0x00B44220`, combines instance parity
and RandomLayer bits, and fixes the terrain datum at 8 pixels. The hut symbol
uses MiscDisplay bit 4; the flat rocky-terrain pictures come from `0x00B485E8`
through `0x004F2A10`. The 46 tile
references and type metadata can be regenerated with
`node scripts/extract-flat-view-rules.cjs <game-folder>`. Pictures are decoded
locally through the existing game-asset path; game pixels are not bundled.

Height provenance: `triggerLoweredView` at `0x004F6FD0` selects mode 3;
`updateShowHiLayerOrResetChangedLayer` at `0x00501A20` converges the 256-entry
height table to `(height >> 2) + 1`. `rebuildShowHiLayerFromHeights` at
`0x004F79D0` applies it to terrain. The terrain renderer draws its 30x16 diamonds
and TGX uppers without whole-sprite scaling (`0x004E9BE6` / `0x004E9C8F`).
These rules were inspected in the installed, previously verified classic
executable; no game executable or image pixels are bundled.

The refresh-arrow button next to Game map reloads the exact selected file from
disk. Its tooltip shows the full path. Metadata, terrain, flat atlas and collision
flags commit after all images decode, retaining the selected player/start place,
camera and modes. Failed reloads keep the prior map and allow another click;
late responses cannot restore a removed or replaced map. The castle is unchanged.

The modes affect presentation and picking only. They never modify terrain,
castle contents, build order or analysis inputs. Mode changes invalidate scene,
terrain and troop draw caches; pan/zoom continue to reuse the composed scene.
The world point at the viewport centre is preserved when displayed height changes.

Both actions are configurable in castle shortcuts. Adding the defaults preserves
existing custom Space/V assignments, camera keys and explicitly cleared bindings.
Typing in fields and open dialogs retains the existing shortcut guards. Holding
either toggle key does not toggle repeatedly. Both hosts share the same mode.

Focused follow-ups cover toggle keys, native height mapping, unscaled ground
and building/scenery commands, cropped structure columns and camera-centre
restoration between normal, lowered and flat modes.
Original camera-mode validation: 101 shortcut, camera/cache, geometry and troop tests passed.
The saved GreekSea atlas (without camera captures) was rendered through all four
directions in normal, flat and peek modes; Canvas and the GPU worker were checked
visually, including normal-view restoration. No full-suite or benchmark rerun.
