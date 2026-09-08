# Changelog

## 0.10.0 - 2026-09-08

### Added

- Synchronized 2D and 2.5D native AIV editing.
- Dockable Map and 2.5D panels with persisted layouts.
- Isometric castle sprites, walls, stairs, ground, and selection previews.
- Stronghold map previews, starting-place alignment, rotation, terrain height,
  trees, and cliffs.
- Brush sizing, flood fill, routed lines, multi-selection, replacement, named
  groups, and a cross-castle clipboard.
- Per-build-step resource cost, time, and population information.
- CI, self-contained validation, and renderer security checks.

### Changed

- Updated Electron to 44.3.0.
- Build-step locks are explicitly session-only and never persisted.
- Removed scripts and tests belonging to untracked example collections, UCP
  module packages, converter builds, and web builds.

### Security

- Sandboxed the renderer and restricted navigation and popup creation.
- Added a Content Security Policy.
- Removed HTML injection from Character search highlighting and help text.
