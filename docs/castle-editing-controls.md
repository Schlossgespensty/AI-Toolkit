# Castle editing controls

In **Customize Castle Shortcuts**, choose **Arrow keys + wheel zoom** to pan
with the arrow keys and zoom at the pointer with the mouse wheel. Individual
camera keys and pan speed can be edited in the same dialog. Shift accelerates
keyboard panning; Shift+wheel pans vertically and Ctrl+wheel horizontally.
Middle-drag remains available. The settings apply to the plan and 2.5D views;
click a view before using its camera keys. Camera keys do not act inside text
fields or dialogs, and cannot conflict with tool keys or C/X rotation.

**Photoshop controls** restores the original camera behavior: in the plan,
wheel pans vertically, Ctrl+wheel horizontally and Alt+wheel zooms. The original
2.5D view keeps its wheel zoom. **Restore defaults** resets both camera and tool
shortcuts. Save persists settings locally; Cancel discards edits.

The **Delete** tool now offers **Area** (the existing rectangle deletion) and
**Flood fill (same type)**. Flood delete removes the clicked placement and
placements of that exact type connected through their footprints along four
directions. It can span build steps, but not diagonal corners or empty gaps.
Locked placements and the Keep are protected barriers. One Undo restores a
flood deletion.

The brush-size +/- buttons are available with any active tool, just like the
existing `[` and `]` shortcuts. Changing size does not switch tools.

Ctrl-click or Shift-click complete build steps, then choose **Merge selected
steps**. At least two unlocked wall, moat or pitch steps of exactly the same
item type must be selected. Different wall types cannot be mixed. The result
occupies the earliest selected step, contains each tile once, and pauses after
that step if any selected step paused. Unselected steps retain their order.
Merging therefore brings later selected placements forward in the build order
and collapses their pauses to one. Undo restores the original steps.

The **Building Categories** sidebar uses the original Village Editor castle
background and category colors. Selection adds an inset outline without
replacing the category color. Item names wrap rather than being truncated,
and each row has its full name and ID as a tooltip and accessible label.

The **Item names** overlay keeps large-building labels inside their artwork.
Hovering any placement additionally shows its full name, including units,
one-tile walls and other items too small for readable in-sprite text. Native
hover tooltips are also available in both the plan and 2.5D views, even when
the overlay is off. Unknown or blank custom names fall back to `Item <ID>`.

## Window and workspace navigation

On Windows, File/Edit/View and the four workspace tabs share a single title
bar. Drag its empty area to move the window. Windows still draws the native
minimize/maximize/close controls; closing retains the unsaved-document prompt.
Menus reuse the existing commands and shortcuts. Alt+F/E/V opens a menu; F10
focuses the menu buttons, Left/Right selects one, and Down/Enter opens it.
Ctrl+1 through Ctrl+4 still switches workspaces. Other platforms retain their
native menu/title bar. Smaller windows hide status/branding before sacrificing
tabs or drag space.

## Castle costs

Castle costs now defaults to the bottom of the build-order column. Existing
saved side/visibility preferences are respected; use **Edit â†’ Castle Overviews**
to show it or move it between sides. Click **Castle costs** to collapse/expand
the whole panel. That choice is remembered separately from the building-detail
toggle.

The resource grid is cumulative through the selected step. **Entire castle
total** shows the final resource totals using the same balance. The per-building
breakdown ends with an additional cumulative total row. Wood, stone, iron,
pitch and gold remain separate resource amounts; they are not added into an
arbitrary gold equivalent. Unknown prices mark totals as partial.

Vanilla prices come from the bundled table previously extracted from the game
executable. **Balance â†’ Loadâ€¦** imports a plugin's balance JSON (for example
Liga or Ascension); fields without cost overrides retain vanilla prices. The
chosen balance and loaded tables are remembered locally. This is not live
inspection of a running game or automatic resolution of the UCP load order.

Resource-building and selection fixes (2026-09-12)

The native codec already mapped farms and resource buildings, but editor constants and save templates omitted mapper IDs 56, 70–73, 90 and 91. These now use the game's placement footprints from getBuildingSizeForCommandBuildingType (0x004FA550): quarry 6, wheat/hop 9, apple 11, dairy 10, iron/pitch 4 tiles per side. AIV IDs are 62, 73, 75, 71, 72, 64 and 65 respectively. Names, palette membership, worker counts and executable-derived building prices are included.

Farm 2.5D previews contain the actual static 3×3 farm building, anchored at the origin of its full field, with the full field outlined. These previews do not simulate crop growth, livestock or the game's changing fence layouts. GM1 source: tile_buildings2.gm1, zero-based groups 390, 399, 408 and 417; BuildingDefinedData sprite tables at +0x2E6C/+0x3024. Component assembly follows Gm1KonverterCrossPlatform's DecodedFile.CreateTileImage. The native field dimensions also drive plan rendering, selection, placement collision and save templates, so an imported farm no longer becomes a one-tile placeholder.

Ctrl-click (Command-click where supported) toggles one placement without starting a move; Shift-click remains additive. Ctrl-drag toggles placements covered by the selection rectangle. Delete mode uses the existing castleProjectChoice dropdown style in both themes.
