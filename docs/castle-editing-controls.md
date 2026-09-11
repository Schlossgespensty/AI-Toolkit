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
