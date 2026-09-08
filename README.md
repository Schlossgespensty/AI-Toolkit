# AI Toolkit

AI Toolkit is a Windows desktop editor for Stronghold Crusader AI projects. It
combines four workspaces in one Electron application:

- **UCP AI Library** discovers installed AI plugins and creates or updates AIs
  managed by the toolkit.
- **Character** edits `character.json` using the schemas in `config/`.
- **Castle** reads and writes native `.aiv` files and provides 2D and 2.5D
  editing, build-order tools, cost information, groups, and copy/paste.
- **AI Content** edits `lines.json`, portraits, speech, and mapped video files.

## Requirements

- Windows 10 or newer
- Node.js 22.12 or newer and npm for development
- A Stronghold Crusader Extreme installation with UCP only for the UCP Library,
  game-map backgrounds, and rendered game terrain

The Character editor and direct AIV editing do not require an installed game.

## Development

```powershell
npm ci
npm start
```

Validation and packaging:

```powershell
npm run check
npm run package
npm run dist
```

`npm run check` checks every application JavaScript module and runs the
self-contained Node test suite. No example tree, private AIV collection, UCP
module source, web-build source, or installed game is needed for validation.

## Castle editor notes

- Native `.aiv` data is read and written by the bundled JavaScript codec.
- Build-step locks are deliberately session-only. They are cleared when a castle
  is loaded and are never written into the AIV or a sidecar file.
- Named groups, cross-castle clipboard data, panel layout, shortcuts, and cost
  balance selections are local UI preferences stored by Electron.
- Real map terrain is generated from the selected game installation on demand.

## Project structure

- `main.js` — Electron lifecycle, application menus, IPC, and filesystem access
- `preload.js` — isolated renderer bridge
- `src/js/` — workspace controllers, castle geometry, 2.5D view, and panels
- `src/node/` — AIV codec, UCP filesystem operations, images, and map parsing
- `config/` — Character and AIV schemas and templates
- `assets/aiv/` — bundled castle artwork
- `tests/` — self-contained Node tests

## Security

The renderer uses context isolation, Electron sandboxing, a restrictive Content
Security Policy, and blocked external navigation. Filesystem operations remain
in the main process and are exposed through the preload bridge.

## Licensing and bundled assets

No project license has been selected yet. A maintainer must choose one before
granting reuse rights. See [ASSETS.md](ASSETS.md) for the separate provenance
work required for bundled artwork.
