use super::{read, u16le, u32le, Result};
use std::path::Path;
#[derive(Clone, Debug)]
pub struct Picture {
    pub width: usize,
    pub height: usize,
    pub dx: i32,
    pub dy: i32,
    pub rgba: Vec<u8>,
}
impl Picture {
    pub fn empty(width: usize, height: usize, dx: i32, dy: i32) -> Self {
        Self {
            width,
            height,
            dx,
            dy,
            rgba: vec![0; width * height * 4],
        }
    }
}
#[derive(Clone, Debug)]
pub struct Entry {
    pub offset: usize,
    pub size: usize,
    pub width: usize,
    pub height: usize,
    pub lift: usize,
    pub direction: u8,
    pub palette: usize,
}
pub struct Gm1 {
    pub bytes: Vec<u8>,
    pub entries: Vec<Entry>,
    pub palettes: Vec<Vec<[u8; 3]>>,
    pub kind: u32,
    pub data_at: usize,
}
fn colour(v: u16) -> [u8; 3] {
    [
        ((v >> 10) & 31) as u32 * 255 / 31,
        ((v >> 5) & 31) as u32 * 255 / 31,
        (v & 31) as u32 * 255 / 31,
    ]
    .map(|v| v as u8)
}
impl Gm1 {
    pub fn read(path: &Path) -> Result<Self> {
        Self::parse(read(path)?)
    }
    pub fn parse(bytes: Vec<u8>) -> Result<Self> {
        let count = u32le(&bytes, 12)? as usize;
        if count > 100_000 {
            return Err("GM1 picture count exceeds limit".into());
        }
        let kind = u32le(&bytes, 20)?;
        let offsets = 88 + 5120;
        let sizes = offsets + count * 4;
        let heads = sizes + count * 4;
        let data_at = heads + count * 16;
        if data_at > bytes.len() {
            return Err("Truncated GM1 directory".into());
        }
        let mut palettes = Vec::with_capacity(10);
        for p in 0..10 {
            let mut pal = Vec::with_capacity(256);
            for i in 0..256 {
                pal.push(colour(u16le(&bytes, 88 + p * 512 + i * 2)?));
            }
            palettes.push(pal);
        }
        let mut entries = Vec::with_capacity(count);
        for i in 0..count {
            let at = heads + i * 16;
            let e = Entry {
                offset: u32le(&bytes, offsets + i * 4)? as usize,
                size: u32le(&bytes, sizes + i * 4)? as usize,
                width: u16le(&bytes, at)? as usize,
                height: u16le(&bytes, at + 2)? as usize,
                lift: u16le(&bytes, at + 10)? as usize,
                direction: bytes[at + 12],
                palette: bytes[at + 15] as usize,
            };
            if e.width > 8192
                || e.height > 8192
                || data_at
                    .checked_add(e.offset)
                    .and_then(|v| v.checked_add(e.size))
                    .filter(|v| *v <= bytes.len())
                    .is_none()
            {
                return Err("Invalid GM1 picture bounds".into());
            }
            entries.push(e);
        }
        Ok(Self {
            bytes,
            entries,
            palettes,
            kind,
            data_at,
        })
    }
    pub fn raw(&self, index: usize) -> Result<(&Entry, &[u8])> {
        let e = self
            .entries
            .get(index)
            .ok_or_else(|| format!("Missing GM1 picture {index}"))?;
        Ok((
            e,
            &self.bytes[self.data_at + e.offset..self.data_at + e.offset + e.size],
        ))
    }
    pub fn sprite(&self, index: usize, palette: Option<usize>) -> Result<Picture> {
        let (e, raw) = self.raw(index)?;
        let pal = palette
            .map(|p| self.palettes.get(p).ok_or("Invalid GM1 palette"))
            .transpose()?;
        Ok(Picture {
            width: e.width,
            height: e.height,
            dx: 0,
            dy: 0,
            rgba: tgx(raw, e.width, e.height, pal)?,
        })
    }
    pub fn part(&self, index: usize, palette: Option<usize>) -> Result<Picture> {
        if let Some(palette) = palette {
            let mut p = self.sprite(index, Some(palette))?;
            p.dx = -1 - u32le(&self.bytes, 0x48)? as i32;
            p.dy = 6 - u32le(&self.bytes, 0x4c)? as i32;
            return Ok(p);
        }
        let (e, raw) = self.raw(index)?;
        let upper = upper(e, raw)?;
        let top = upper.as_ref().map_or(0, |p| p.dy.min(0));
        let width = upper
            .as_ref()
            .map_or(30, |p| (p.dx + p.width as i32).max(30) as usize);
        let height = (upper
            .as_ref()
            .map_or(16, |p| (p.dy + p.height as i32).max(16))
            - top) as usize;
        let mut p = Picture::empty(width, height, -15, top);
        composite(&mut p, &diamond(raw)?, 0, -top);
        if let Some(u) = upper {
            composite(&mut p, &u, u.dx, u.dy - top)
        }
        Ok(p)
    }
    pub fn pillar(&self, index: usize, lift: usize) -> Result<Option<Picture>> {
        let (e, raw) = self.raw(index)?;
        let rows = e.height.saturating_sub(7);
        if self.kind != 5 || e.width != 30 || rows == 0 || raw.len() < rows * 60 {
            return Ok(None);
        }
        let mut p = Picture::empty(30, lift + 7, 0, 9);
        for y in 0..lift {
            for x in 0..30 {
                let rgb = colour(u16le(raw, ((y % rows) * 30 + x) * 2)?);
                let skew = (x / 2).min((29 - x) / 2);
                put(&mut p.rgba, 30, lift + 7, x as i32, (y + skew) as i32, rgb)
            }
        }
        Ok(Some(p))
    }
}
fn put(out: &mut [u8], width: usize, height: usize, x: i32, y: i32, rgb: [u8; 3]) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let at = (y as usize * width + x as usize) * 4;
    out[at..at + 3].copy_from_slice(&rgb);
    out[at + 3] = 255;
}
pub fn tgx(
    raw: &[u8],
    width: usize,
    height: usize,
    palette: Option<&Vec<[u8; 3]>>,
) -> Result<Vec<u8>> {
    if width
        .checked_mul(height)
        .filter(|v| *v <= 16 * 1024 * 1024)
        .is_none()
    {
        return Err("GM1 image exceeds limit".into());
    }
    let mut out = vec![0; width * height * 4];
    let (mut at, mut x, mut y) = (0, 0i32, 0i32);
    while at < raw.len() && y < height as i32 {
        let mark = raw[at];
        at += 1;
        let run = (mark & 31) as i32 + 1;
        match mark & 0xe0 {
            0 | 0x40 => {
                let repeated = mark & 0xe0 == 0x40;
                let mut rgb = [0; 3];
                for n in 0..run {
                    if n == 0 || !repeated {
                        rgb = if let Some(p) = palette {
                            let b = *raw.get(at).ok_or("Truncated palette TGX")?;
                            at += 1;
                            p[b as usize]
                        } else {
                            let c = colour(u16le(raw, at)?);
                            at += 2;
                            c
                        };
                    }
                    put(&mut out, width, height, x, y, rgb);
                    x += 1;
                }
            }
            0x80 => {
                y += 1;
                x = 0;
            }
            0x20 => x += run,
            _ => break,
        }
    }
    Ok(out)
}
pub fn diamond(raw: &[u8]) -> Result<Picture> {
    let mut p = Picture::empty(30, 16, 0, 0);
    let mut at = 0;
    for (y, run) in [2, 6, 10, 14, 18, 22, 26, 30, 30, 26, 22, 18, 14, 10, 6, 2]
        .into_iter()
        .enumerate()
    {
        for step in 0..run {
            if at + 2 > raw.len() {
                return Ok(p);
            }
            let c = colour(u16le(raw, at)?);
            at += 2;
            put(&mut p.rgba, 30, 16, 15 + step - run / 2, y as i32, c)
        }
    }
    Ok(p)
}
pub fn upper(e: &Entry, raw: &[u8]) -> Result<Option<Picture>> {
    if raw.len() <= 512 || e.height == 0 {
        return Ok(None);
    }
    Ok(Some(Picture {
        width: 30,
        height: e.height,
        dx: if e.direction == 3 { 14 } else { 0 },
        dy: -(e.lift as i32),
        rgba: tgx(&raw[512..], 30, e.height, None)?,
    }))
}
pub fn composite(target: &mut Picture, source: &Picture, dx: i32, dy: i32) {
    for y in 0..source.height {
        let ty = y as i32 + dy;
        if ty < 0 || ty >= target.height as i32 {
            continue;
        }
        for x in 0..source.width {
            let tx = x as i32 + dx;
            let from = (y * source.width + x) * 4;
            if source.rgba[from + 3] == 0 || tx < 0 || tx >= target.width as i32 {
                continue;
            }
            let to = (ty as usize * target.width + tx as usize) * 4;
            target.rgba[to..to + 4].copy_from_slice(&source.rgba[from..from + 4]);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tgx_runs() {
        assert_eq!(
            tgx(&[0x41, 0xff, 0x7f, 0x80, 0x21], 2, 2, None).unwrap(),
            vec![255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]
        );
    }
    #[test]
    fn rejects_bad_directory() {
        assert!(Gm1::parse(vec![0; 20]).is_err())
    }
}
