# Permanent terrain construction warnings

With a game map loaded, blocked building footprints are marked by a translucent
red fill, outline and cross in both the floor-plan and 2.5D editors. Hover text
names the terrain conflict. Placement, brush, copy and move previews use the same
check. The warning is advisory: editing and saving the AIV remain available.
Floor-plan image exports retain their existing artwork without diagnostic marks.

The map bridge supplies a separate `pathTerrain.buildFlags` grid in version 5.
It retains sea, river, ford, rock, borders, marsh, moat and resource flags from
saved section 1003. It excludes tree/bush flags, unit/animal layers, old buildings
and planned moat markers. Walking obstruction masks remain independent. The
height input is the default terrain in section 1045 (1005 only as a fallback),
so saved structures do not introduce artificial cliffs. Cached older map metadata
is refreshed before warnings are calculated.

The selected start's orientation maps the terrain into canonical AIV coordinates;
camera rotation, Space and V affect its presentation only. Composite keep and
attached stockpile footprints are included, with the keep's empty gap excluded.
The visible build step controls which existing buildings receive warnings.
Results are cached per terrain identity, start, document revision and definitions.

`scripts/extract-construction-rules.cjs` exports numeric metadata from the known
Crusader executable layouts. No executable code or game image bytes are copied.
The mapper-to-building switch is at 0x00409370, with the height-difference table
at 0x005B8108 and height-limit table at 0x005B7F50. The underlying checks are
`checkBuildingCanBePlacedHere` (0x005037B0), `storeMinAndMaxHeightOfArea`
(0x004F9980), and `isBuildingPlacementAllowedAtTile` (0x004F9A60), as named in
OpenSHC. Height differences are native height units, not tile counts: ordinary
buildings and dairy farms allow 12, quarries 40, wheat/hop/apple farms 80.
Equality with the limit is permitted. Walls/stairs are checked tile by tile.

AI placement's explicit rock-clearance exceptions are retained, including
quarries, iron mines and towers. Pitch rigs may occupy oil marsh; a drawbridge
may cross a moat but retains its separate absolute height limit. A warning
therefore means terrain the supported AI placement rule cannot use, rather than
every piece of scenery that currently obstructs a human or a walking unit.

This is a permanent-terrain diagnostic, not a full game placement simulation.
It does not model enemy proximity, temporary units, resource affordability,
resource/fertility sufficiency, drawbridge attachment, or Lua changes to runtime
placement tables. Unknown building rules and missing map data produce no claim.
