//! Metadata only: static classic idle samples, verified against OpenSHC unit
//! update routines and Crusader 1.41 animation tables. GM1 indices are zero-based;
//! sprite origins and player palettes always come from the selected local game.
//! See docs/native-idle-sprite-research.md for formulas and table addresses.

// Lords have no AIV palette marker. Keep their explicit keys separate from
// serialized marker IDs; the renderer chooses one using character.lord.Type.
// UpdateLord's stationary guard phase: 0xa9 - lord_variant_offset - 1.
pub const LORD_POSES: &[(&str, &str, usize)] = &[
    ("lord-europ", "body_lord", 168),
    ("lord-arab", "body_saladin", 40),
];

pub fn idle_pose(marker: u16) -> Option<(usize, Option<usize>)> {
    let frame = match marker {
        2 => 0,     // UpdateMangonel: direction + 1 - 1
        3..=5 => 4, // Stationary siege body: ((direction + 4) & 7) + 1 - 1
        6 => 643,   // UpdateCrusaderArcher: 0x280 + 1*4 - 1
        7 => 151,   // UpdateCrossbowman: 0x90 + 8 - 1
        8 => 560,   // UpdateSpearman: 0x230 + 1 - 1
        9 => 192,   // UpdatePikeman, standing: 0xc0 + 1 - 1
        10 => 432,  // UpdateMaceman: 0x1b0 + 1 - 1
        11 => 341,  // UpdateSwordsman: 0x141 + 21 - 1
        // Mounted idle body and rider have different animation tables.
        12 => return Some((256, Some(424))),
        13 => 256, // UpdateSlave: 0x100 + 1 - 1
        14 => 672, // UpdateSlinger, seated idle: 664 + 9 - 1
        15 => 803, // UpdateAssassin: 0x310 + 20 - 1
        16 => 876, // UpdateArabianArcher: 0x36c + 1 - 1
        17 => return Some((592, Some(592))),
        18 => 368,    // UpdateArabianSwordsman: 0x170 + 1 - 1
        19 => 560,    // UpdateFireThrower: 0x230 + 1 - 1
        20 | 21 => 0, // First stationary flame/flag phase; no locomotion frames
        // Engineers and DE units require their own verified
        // poses; a thumbnail must never silently substitute a walking frame.
        _ => return None,
    };
    Some((frame, None))
}
