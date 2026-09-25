//! Local, read-only game formats. No process injection or game invocation.
mod atlas;
mod balance;
mod buildings;
mod cache;
mod gm1;
mod graphics;
mod maps;
mod native_cache;
#[cfg(test)]
mod tests;
mod units;

pub use balance::{read_exe_costs, read_installed_balance};
pub use buildings::{load_building_assets, read_resource_icons};
pub use graphics::{resolve_graphics, Graphics};
pub use maps::{list_game_maps, load_map_tiles, read_map};
pub use units::{load_unit_sprites, UnitAssets, UnitSprite};

use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;
pub type Result<T> = std::result::Result<T, String>;
pub(crate) fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(crate) fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}
pub(crate) fn u16le(b: &[u8], at: usize) -> Result<u16> {
    b.get(at..at + 2)
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or_else(|| "Truncated game data".into())
}
pub(crate) fn u32le(b: &[u8], at: usize) -> Result<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or_else(|| "Truncated game data".into())
}
pub(crate) fn png_bytes(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>> {
    if width == 0
        || height == 0
        || width.checked_mul(height).and_then(|v| v.checked_mul(4)) != Some(rgba.len())
    {
        return Err("Invalid image dimensions".into());
    }
    let mut output = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut output, width as u32, height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        enc.write_header()
            .map_err(|e| e.to_string())?
            .write_image_data(rgba)
            .map_err(|e| e.to_string())?;
    }
    Ok(output)
}
pub(crate) fn png_url(width: usize, height: usize, rgba: &[u8]) -> Result<String> {
    Ok(format!(
        "data:image/png;base64,{}",
        b64(&png_bytes(width, height, rgba)?)
    ))
}
pub(crate) fn virtual_offset(exe: &[u8], address: u32) -> Result<usize> {
    if exe.get(..2) != Some(b"MZ") {
        return Err("Not a Windows game executable".into());
    }
    let pe = u32le(exe, 60)? as usize;
    if u32le(exe, pe)? != 0x4550 {
        return Err("Invalid PE executable".into());
    }
    let relative = address
        .checked_sub(u32le(exe, pe + 52)?)
        .ok_or("Invalid virtual address")?;
    let table = pe + 24 + u16le(exe, pe + 20)? as usize;
    for i in 0..u16le(exe, pe + 6)? as usize {
        let at = table + i * 40;
        let va = u32le(exe, at + 12)?;
        let size = u32le(exe, at + 16)?;
        if relative >= va && relative - va < size {
            return Ok((u32le(exe, at + 20)? + relative - va) as usize);
        }
    }
    Err("Unsupported game executable layout".into())
}
