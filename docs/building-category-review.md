# Building categories and artwork

The historical reference is Firefly's classic Village Editor README, section 4,
[distributed with the official modding tools](https://www.gamefront.com/games/stronghold-crusader/file/stronghold-crusader-modding-utilities).
It lists eleven placement groups plus Delete; towers and the keep belong with
castle buildings, and weapon workshops with military buildings. The list has
minor inconsistencies, so it establishes grouping intent rather than an item-ID
registry. All additional Toolkit items are retained.

## Current requested layout

| Left | Right |
| --- | --- |
| Castle | Gatehouses |
| Military | Walls, Moat & Pitch |
| Town | Stairs |
| Industry | Food |
| Good Things | Bad Things |
| Arabians | Europeans |

Every item remains available exactly once. Castle starts with the keep, then
towers by size and defensive utilities. Military starts with recruitment,
storage and guilds, then weapon workshops. Industry follows stockpile, wood,
stone/transport, iron, pitch and trade. Food contains farms, hunting and food
processing. Stairs remain separate for the expanded stair options.

Arabians starts with Arabian Archer, Slave, Slinger, Assassin, Horse Archer,
Arabian Swordsman and Fire Thrower, followed by Brazier, Flag and Fireballista.
Europeans starts with the seven barracks troop types, then Oil Engineer,
Mangonel, Ballista and Trebuchet.

Pause is a compact button beside Build order. It selects the existing Dummy
Step item (200), retaining its map-placement behavior; it does not enable
per-frame pause flags. Delete already has a dedicated toolbar action.

Placement defaults, unit storage, dimensions, overlap, multi-placement and stair
sequences come from item metadata, never category names. Saved per-item tool
preferences retain priority. Future units need explicit metadata and category
membership. Tests verify the complete item set and category-independent behavior.

## Resource artwork

Quarry (56), Iron Mine (90) and Pitch Rig (91) are exported from the original
AIV Editor Gremium/gm/colour tiles.gm1 at their unchanged 6x6, 4x4 and 4x4
footprints (192x192, 128x128 and 128x128 pixels). The resource exporter previously
selected cyan palette 2; these industry buildings use white palette 3. Farm
exports are unchanged. The existing GM1 decoder preserves the source tile
artwork; no image downscaling or lossy compression is involved.


DE extension: the twelve classic groups remain in their established order.
Bedouins is a thirteenth group for the eight DE unit markers. The Bedouin
Stockade is under Military. All three 5x5 outposts and Dummy Step are under Misk; the Bedouin preview tiles are light green.
New SVG previews are original Toolkit artwork; no AIVE texture-pack assets are
redistributed, and existing PNG artwork is unchanged.
