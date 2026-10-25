# Castle editing controls

**F1** saves the current castle; **F2** opens a castle using the existing file
dialog and unsaved-change handling. Both actions can be reassigned under
**Customize Castle Shortcuts**, with primary and alternative keys. Tool and
file-action bindings accept letters, numbers and F1–F12 and are checked for
conflicts with each other and camera controls. Existing customized bindings
are preserved when the new defaults are added. Ctrl+S and Ctrl+O remain
available through the File menu.

The Castle toolbar separates file actions, views, AI castle selection, placement
tools, editing tools, overlays, and Groups/Clipboard into bordered groups.
**New** starts a castle; **Save As** remains in the File menu. Shortcut settings
remain in the Edit menu rather than taking up a toolbar button.
The **Overlays** menu contains Item names, Unit Order, Guide lines, Path map and
Firespread. Click outside the menu or press Escape to close it.

Each item remembers its last chosen placement tool (Single, Line, Brush or Fill),
including after restarting the editor. Items without a saved choice start with
Single, or Line for walls. Stair sequences always use Line. Selecting an editing
tool such as Delete does not overwrite an item's placement preference.

## Two castles side by side

With the Castle workspace active, use **File > Load In New Window**
(**Ctrl+Shift+O**) to open the second castle without replacing the first.
Snap one editor window left and the other right using Windows+Left/Right.
Select placements in the source and press **Ctrl+C**. In the destination,
move the pointer to the desired position and press **Ctrl+V**, or click
**Clipboard**, then click the map. The newest copied group is shared between
windows; the existing placement checks and undo still apply. The Keep and
unit rally points are excluded from this building-copy operation.
Use **Ctrl+X** to cut unlocked building placements to the same shared clipboard.
The Keep, rally points and locked placements are left in place. Cutting is one
undoable edit; Ctrl+V uses the usual placement checks in either castle window.
There is no separate Copy toolbar button: Select/Move stays highlighted while
holding a copy. The 2.5D view shows a translucent preview of all copied items.

Library castles and characters have no editor read-only mode. Saving a vanilla
castle writes to its original game file; use Save As to keep that file intact.

The main startup window automatically reopens the last successfully opened
AI project, its selected castle and workspace. This stores file references,
not unsaved edits. Explicit new windows remain independent. Missing projects
or castles are reported without silently opening a different castle, and
interacting during startup cancels automatic restoration. On the first run
after upgrading, open your project once so it can be remembered.

In **Customize Castle Shortcuts**, choose **Arrow keys + wheel zoom** to pan
with the arrow keys and zoom at the pointer with the mouse wheel. Individual
camera keys and pan speed can be edited in the same dialog. Shift accelerates
keyboard panning; Alt+wheel or Shift+wheel pans vertically and Ctrl+wheel horizontally.
Middle-drag remains available. The settings apply to the plan and 2.5D views;
click a view before using its camera keys. Camera keys do not act inside text
fields or dialogs, and cannot conflict with tool keys or C/X rotation.

**Photoshop controls** restores the original Map camera controls in both views:
wheel pans vertically, Ctrl+wheel horizontally and Alt+wheel zooms.
Right-click clears the selection and held item; only middle-drag pans.
**Restore defaults** resets both camera and tool
shortcuts. Save persists settings locally; Cancel discards edits.

The **Delete** tool now offers **Area** (the existing rectangle deletion) and
**Flood fill**. Flood delete removes the clicked placement and
placements of that exact type connected through their footprints along eight
directions, including corner-touching tiles, matching the classic editor. The
fill bucket uses the same connectivity. Empty gaps do not connect regions.
Locked placements and the Keep are protected barriers. One Undo restores a
flood deletion.

The brush-size +/- buttons are available with any active tool, just like the
existing `[` and `]` shortcuts. Changing size does not switch tools.
The displayed width is remembered when selecting a building. Area painting
applies only to single-tile objects, including walls, moat and pitch; larger
buildings preview and place once per brush position. Stair sequences retain
their Line tool behavior. Objects that cannot share a build step are still
committed as separate steps.

The 2.5D scene stops at the selected build step, including ground plates and
wall/stair/bridge connections. Use the step slider or build list to move the
cutoff; returning to the last step shows the entire castle. The flat plan
retains its subdued future-step preview.

Selecting placements on either castle canvas also scrolls the active build-order
row into view, moving the list only as far as needed. This applies to clicks,
area selections and flood selections, including locked steps; it does not change
the selection rules or the castle itself.

Use the **Merge** toolbar tool to draw an area in either view, then check the
item types to combine in the dialog. Only types configured for multiple
placements per step can be merged. Each checked type is combined separately
at its earliest selected step. Placements outside the box stay in their
original steps, including the remainder of a partly selected step.

Alternatively, Ctrl-click or Shift-click build-order rows, then right-click
and choose **Merge selected steps…** to use the same dialog for whole steps.
Types represented in fewer than two unlocked steps cannot be merged. Cancel
changes nothing; one Undo restores the entire merge. The right-click menu also
contains **Lock positions / Unlock positions**, acting on all selected rows.
Locks remain session-only and locked steps are excluded from merging.

Build-step pauses
are disabled on import and stay false on save; importing a paused castle marks
it modified so saving cannot silently reuse the original paused binary.

When scrubbing build steps, the list reuses its rows and the 2.5D renderer
reuses terrain drawing commands. It compares the actual building sprites
(including changed neighbours), repaints only the damaged region in depth
order, and uses a full redraw after document, map, camera or asset changes.
It does not allocate a full-map bitmap for every historical step.

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
saved side/visibility preferences are respected; use **Edit → Castle Overviews**
to show it or move it between sides. Click **Castle costs** to collapse/expand
the whole panel. That choice is remembered separately from the building-detail
toggle.

The resource grid and per-building breakdown are cumulative through the
selected step, with an additional cumulative total row. Wood, stone, iron,
pitch and gold remain separate resource amounts; they are not added into an
arbitrary gold equivalent. Unknown prices mark totals as partial.

Vanilla prices come from the bundled table previously extracted from the game
executable. **Balance → Load…** imports a plugin's balance JSON (for example
Liga or Ascension); fields without cost overrides retain vanilla prices. The
chosen balance and loaded tables are remembered locally. Use UCP balance resolves the installation?s selected profile and overlays it on
the executable?s initialized-data cost table. Importing a balance does not start or inspect a running game. Offline worker
routes and staged fire calculations are still in development.

Resource-building and selection fixes (2026-09-12)

The native codec already mapped farms and resource buildings, but editor constants and save templates omitted mapper IDs 56, 70–73, 90 and 91. These now use the game's placement footprints: quarry 6, wheat/hop 9, apple/dairy 10, iron/pitch 4 tiles per side. Apple placement reserves 10x10 in `placeApplefarm` (0x00515740); its save template, plan skin and camera layouts use the same boundary. AIV IDs are 62, 73, 75, 71, 72, 64 and 65 respectively. Names, palette membership, worker counts and executable-derived building prices are included.

Farm 2.5D previews now assemble the original hut and field/fence/tree components.
See [Native building components](farm-graphics.md). The native field dimensions
also drive plan rendering, selection, placement collision and save templates.


Ctrl-click (Command-click where supported) toggles one placement without starting a move; Shift-click remains additive. Ctrl-drag toggles placements covered by the selection rectangle. Delete mode uses the existing castleProjectChoice dropdown style in both themes.

The new plan/palette skins reuse the existing Food (80.png) and Industry (52.png) category artwork, sized by the native footprint.


File dialogs use the active AI project folder, independently for each window.
This includes castle/character open, load in a new window, balance JSON, skins,
backgrounds and media. Save As retains the suggested filename within that folder.
Detaching a project restores the platform's default locations. Choosing a game
installation still starts at the selected game folder.

Flood selection: choose Select / Move, then Select mode > Flood fill (same type).
Click selects connected same-type placements across build steps, including diagonal
corners. Shift adds a connected group. Ctrl-click (Command-click) removes the group
when its clicked placement is selected, or adds it otherwise. An unmodified empty
click clears selection. Locked placements and the Keep can be selected; existing
move/delete protection remains. Return to Select / Move mode to drag the selection.
The selection operation does not change castle data or add an undo entry.
