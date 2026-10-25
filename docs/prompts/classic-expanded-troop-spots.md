# Research prompt: 30 defensive troop spots in classic Crusader

Investigate how Stronghold Crusader HD/classic, using UCP3, could support up to
30 defensive AIV rally positions per supported troop type. Produce an evidence
based feasibility report and a concrete implementation plan. Do not present an
editor limit change as working game support.

## Existing editor contract

AI Toolkit stores rally markers in the castle document's `miscItems` array:

```json
{"itemType":18,"positionOfset":7123,"number":10}
```

`positionOfset = y * 100 + x` in the unrotated castle grid; `number` is a
zero-based slot within that troop type. The editor can retain slots 0–29 in
`.aivjson`, including unknown JSON fields. The current classic writer supports
24 types × 10 Int32 positions in AIV section 2012 (`tarr`, 960 bytes), alongside
section 2013 (`tmap`). Classic export rejects extra slots, rather than dropping
them. Existing AIVs must stay byte-identical when saved unchanged.

Start with `src/node/aiv-codec.mjs`, `src/js/castle-format.js`,
`src/js/castle-editor.js`, `src/desktop/documents.ts`,
`tests/expanded-troop-spots.test.js`, and `docs/expanded-troop-spots.md` in
`S:/Projects/Harness/ai-toolkit-setup/source`.

Keep the existing interchange representation as the source for a future
converter. Do not discard, clamp or repurpose slots 10–29 today. Do not silently
substitute DE-only troops with classic ones. An unsupported conversion must
fail before changing the output file.

## Verified DE precedent

Inspect Rawra's own implementation and record the exact commit/version you
review. This is SHCDE-Fixes, requiring its compatible Script Extender, rather
than a vanilla DE feature:

- https://gitlab.com/rawra-stronghold-crusader/shcde-fixes/-/blob/main/README.md#per-ai-guarding-spots-per-unit-type
- https://gitlab.com/rawra-stronghold-crusader/shcde-fixes/-/blob/main/src/shcde-fixes/Detours/ExpandedGuardingSpotsDetours.cs
- https://gitlab.com/rawra-stronghold-crusader/shcde-fixes/-/blob/main/src/shcde-fixes/Components/ExpandedGuardingSpotsSaveData.cs

`GuardingSpotsPerUnitType` is a per-AI preference, default 10, range 10–30.
Supported native troop classes are 6–19 and 22–28. Siege engines and
oil-smelter engineers retain specialized limits. Slots must be unique and
contiguous per troop type. AIVE aliases above 9000 are translated by the DE
game's `GetRawData()`/the Script Extender encoder; verify the equivalent ID
mapping explicitly instead of assuming all DE IDs are classic IDs.

The DE implementation keeps extended position and tribe-ID/global-ID state
outside vanilla buffers and hooks decoding, village placement, tribe creation,
defender assignment and movement. Establish which of those changes have
classic equivalents. Do not copy x64 patterns or managed layouts into x86 UCP.

## Research work

1. Read the applicable AGENTS.md instructions and inspect the UCP3/OpenSHC
   checkouts under `S:/Projects/UCP`. Record supported executable hashes and
   which findings are static analysis, tests, or actual game observations.
   The game copy at `D:/Games/Stronghold Crusader KI-Liga` is a read-only source.
   Do not alter the user's installation, saves, maps, running game or Toolkit.
2. Trace every classic consumer and producer of the ten-slot layout: AIV file
   decode, temporary castle buffers, castle rotation/offset, player defensive
   position tables, role/tribe arrays, recruitment allocation, smallest-group
   selection, defensive movement, keep retreat/last stand, resets and player
   initialization. Use function names, addresses/patterns and bounds proven
   against each executable. Search OpenSHC's `AI/AIVState`, `AI/Tribes`,
   `AIVUnitTypeTribeArrayOffset`, `AIVUnitTypeMaxLocationPair`, PlayerData and
   unit-to-tribe assignment. Separate ordinary defenders from oil engineers,
   defensive siege equipment, flags and braziers.
3. Identify fixed storage that would overlap another troop class/player or
   overflow when a slot is 10–29. Compare external extension buffers and hooks
   with reallocating native structures. Include tribe capacity, troop limits,
   deterministic allocation and CPU/memory costs. List all required patches;
   replacing a single comparison with 30 is not sufficient evidence.
4. Trace save/load, campaign/scenario changes and multiplayer sync, including
   checksums, replay/recorder assumptions and whether every peer requires the
   same module/config. Define how extended state is restored or rebuilt after
   a save, how stale tribe handles are rejected, and how 10-slot behavior stays
   unchanged when disabled.
5. Design the on-disk contract only after the loader constraints are known.
   Compare a versioned additional AIV section, a sidecar and a new container.
   Determine how old loaders behave, including bounds checks and unknown
   sections. Specify magic/version/capability checks, type/slot mapping,
   byte order, lengths, directory/compression/checksum updates and atomic
   writes. Do not invent an `.xaiv` extension and call it supported. Do not
   enlarge section 2012 until every reader's allocation and bounds are proven.
6. Define conversion from the editor's existing `miscItems` records to the
   proposed extension. Preserve type, slot order, unrotated tile coordinates,
   building steps, pauses and unknown metadata. Define reverse conversion and
   explicit refusal of lossy downgrade to vanilla. Keep the vanilla first ten
   spots consistent with the extension. Document how the editor detects that
   a classic installation actually has the supporting module enabled.
7. Create asymmetric fixtures: 10, 11, 29 and 30 positions; attempted slot 31;
   missing/duplicate slots; invalid coordinates and unsupported troops; two
   expanded troop types; multiple AIs and all four castle rotations. Verify
   placements, recruitment distribution, tribe selection, death/replacement,
   movement, retreat, resets, save/load and synchronization. Include unchanged
   10-slot regression cases and JSON → extended AIV → JSON semantic equality.
   Run any proof of concept only in an owned game copy/test profile. Keep
   uncertain or untested claims clearly separate from demonstrated support.

## Deliverables

- A concise feasibility verdict, supported classic versions and unresolved
  blockers, with links and function/structure evidence.
- A patch inventory and architecture diagram, a proposed format/capability
  contract, a conversion plan, and a staged test plan.
- Estimated work split between game/UCP runtime, serialization/converter and
  editor integration, with risks and acceptance criteria for each stage.
- If feasible, a minimal isolated proof of concept for one classic defender
  type at 11 and 30 positions. Do not merge, publish, or claim broad support
  until the full acceptance criteria are met.

Do not launch a separate agent or create a new top-level conversation unless
explicitly asked. Return the report and reviewable artifacts to the user.
