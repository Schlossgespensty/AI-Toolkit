# Expanded defensive troop spots

The editor allows up to 30 guarding spots for native troop classes 6–19 and
22–28 (the latter use AIVE IDs 9022–9028 in the palette). Other marker types
retain their existing caps, including oil engineers, defensive siege equipment
and the currently unsupported class 29. Custom item caps remain respected.

Spots 11–30 carry a DE label in the plan, 2.5D view and palette count. The item
information/tooltip explains the requirement: **DE + SHCDE-Fixes**, with the
AI's `GuardingSpotsPerUnitType` set to the required capacity. For 30 spots:

```json
{"GuardingSpotsPerUnitType":30}
```

For an Extended Lord, Rawra documents `Override/Fixes/preferences.json` in the
lord folder. The editor does not change the installed game or that preference.
This is not a claim that vanilla DE supports 30 spots.

The marker data stays in the existing `.aivjson` interchange model: `itemType`,
`positionOfset` and zero-based `number` 0–29. New placements use the next free
slot. Editing an expanded DE group compacts its remaining slots, because the
extension requires unique contiguous numbering. Undo restores the document;
unchanged JSON retains its original numbering and unknown fields, including
future slots beyond the current editable limit. Classic `.aiv` export refuses
extra slots and recommends DE JSON; it never truncates them to ten.

This preserves the data needed by a future classic extension converter. Such a
runtime patch and extended binary format are not implemented here. See the
[classic research prompt](prompts/classic-expanded-troop-spots.md).

Primary evidence inspected on 21 October 2026:

SHCDE-Fixes 1.28.1, commit `a90f96c176e9c8981af83534f5a8bb444838ae0a`.
This records the reviewed source, not the earliest compatible release.

- [SHCDE-Fixes instructions](https://gitlab.com/rawra-stronghold-crusader/shcde-fixes/-/blob/main/README.md#per-ai-guarding-spots-per-unit-type)
- [ExpandedGuardingSpotsDetours](https://gitlab.com/rawra-stronghold-crusader/shcde-fixes/-/blob/main/src/shcde-fixes/Detours/ExpandedGuardingSpotsDetours.cs)
- [DE encoder's >9000 mapping](https://gitlab.com/rawra-stronghold-crusader/shcde-script-extender/-/blob/4014ca67c96974a5e6d697665baf5351cbfebde6/src/SHCDESE.AIVDecoder/src/SHCDESE.AIVDecoder/AIVEncoder.cs)

Boundary placement, JSON preservation and classic-write refusal are tested in
the editor. Actual DE game execution with the mod remains unverified.
