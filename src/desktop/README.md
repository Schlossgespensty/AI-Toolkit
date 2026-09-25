# Native desktop boundary

`api.ts` adapts the existing editor/preload API. Editor documents and selection
state belong to their editors, not to this module.

- `runtime.ts` owns transport, native error translation and window-scoped events.
- `documents.ts` owns file formats and codec conversion.
- `assets.ts` owns asset URLs, not rendering or extraction.
- `contracts.ts` selects each operation's generated request and response types.
  `rpc()` and `game()` infer both arguments and return type from the operation;
  do not add caller-selected generic result casts.
- `src-tauri/src/desktop/contracts.rs` owns request envelopes. Rust matches every
  variant exhaustively. Fixed response DTOs live with their Rust producers; their
  operation map is in `desktop/responses.rs`. `generated/` is ts-rs output, never
  hand-edited. Error/status variants are discriminated unions, so callers must
  narrow their status before using variant-specific fields.

After changing a native request, regenerate and check its frontend callers:

```powershell
$env:UPDATE_DESKTOP_BINDINGS = '1'
cargo test --manifest-path src-tauri/Cargo.toml desktop::contracts
Remove-Item Env:UPDATE_DESKTOP_BINDINGS
npx.cmd tsc --project tsconfig.desktop.json --noEmit
node --test tests/desktop-bridge.test.js
```

Without the environment variable, the Rust test verifies committed bindings
against generated output, including obsolete files. ts-rs is a pinned development
dependency and contributes no code to the release executable. The type fixtures
in `tests/types/` also verify that invalid calls fail compilation.

These are typed IPC envelopes, not a closed schema for arbitrary AIC, castle or
plugin metadata. Content strings cross unchanged; native JSON configuration and
domain results remain extensible. Fixed responses are constructed using their
Rust DTOs before serialization. Library internals still accept JSON through
one adapter in `desktop.rs`. The rest of the legacy JavaScript frontend is not
claimed to be strongly typed by this boundary.
