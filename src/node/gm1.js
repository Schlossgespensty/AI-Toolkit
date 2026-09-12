'use strict';
// Shared original GM1 decoding for maps and asset conversion.
const TILE_W = 30, TILE_H = 16;
const GM1_HEAD = 88, GM1_PALETTES = 10, GM1_COLOURS = 256;
const TILE_ROW = [2,6,10,14,18,22,26,30,30,26,22,18,14,10,6,2];
function colourOf(word) {
  return [((word >> 10) & 31) * 255 / 31 | 0, ((word >> 5) & 31) * 255 / 31 | 0, (word & 31) * 255 / 31 | 0];
}

// Kopf, Farbtafeln und Bildverzeichnis einer .gm1
function readGm1(buffer) {
  const count = buffer.readUInt32LE(12);
  const paletteAt = GM1_HEAD;
  const offsetsAt = paletteAt + GM1_PALETTES * GM1_COLOURS * 2;
  const sizesAt = offsetsAt + count * 4;
  const headsAt = sizesAt + count * 4;
  const picturesAt = headsAt + count * 16;

  const palettes = [];
  for (let index = 0; index < GM1_PALETTES; index += 1) {
    const palette = [];
    for (let colour = 0; colour < GM1_COLOURS; colour += 1) {
      palette.push(colourOf(buffer.readUInt16LE(paletteAt + index * 512 + colour * 2)));
    }
    palettes.push(palette);
  }

  const pictures = [];
  for (let index = 0; index < count; index += 1) {
    const at = headsAt + index * 16;
    pictures.push({
      offset: buffer.readUInt32LE(offsetsAt + index * 4),
      size: buffer.readUInt32LE(sizesAt + index * 4),
      width: buffer.readUInt16LE(at),
      height: buffer.readUInt16LE(at + 2),
      lift: buffer.readUInt16LE(at + 10),        // kachelVersatz: hebt den Aufbau
      direction: buffer.readUInt8(at + 12),
      palette: buffer.readUInt8(at + 15)
    });
  }
  return { count, palettes, pictures, picturesAt, buffer };
}

// Ein TGX-Strom in eine RGBA-Flaeche. Ohne Farbtafel sind Farben 2 Byte lang,
// mit Farbtafel 1 Byte als Nummer darin.
function tgxToRgba(data, width, height, palette) {
  const image = Buffer.alloc(width * height * 4, 0);
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 4;
    image[at] = rgb[0]; image[at + 1] = rgb[1]; image[at + 2] = rgb[2]; image[at + 3] = 255;
  };

  let read = 0, x = 0, y = 0;
  while (read < data.length) {
    const mark = data[read]; read += 1;
    const kind = mark & 0xE0;
    const run = (mark & 0x1F) + 1;
    if (kind === 0x00) {                       // Punkte am Stueck
      for (let step = 0; step < run; step += 1) {
        if (palette) { put(x, y, palette[data[read]]); read += 1; }
        else { if (read + 1 >= data.length) return image; put(x, y, colourOf(data.readUInt16LE(read))); read += 2; }
        x += 1;
      }
    } else if (kind === 0x80) {                // Zeilenende
      y += 1; x = 0;
    } else if (kind === 0x40) {                // ein Punkt, wiederholt
      let rgb;
      if (palette) { rgb = palette[data[read]]; read += 1; }
      else { if (read + 1 >= data.length) return image; rgb = colourOf(data.readUInt16LE(read)); read += 2; }
      for (let step = 0; step < run; step += 1) { put(x, y, rgb); x += 1; }
    } else if (kind === 0x20) {                // durchsichtig
      x += run;
    } else {
      break;                                    // unbekannte Marke: hier ist Schluss
    }
    if (y >= height) break;
  }
  return image;
}

// Eine Rautenkachel: 512 Byte, Punkt fuer Punkt, Zeilenlaengen nach TILE_ROW
function diamondToRgba(data) {
  const image = Buffer.alloc(TILE_W * TILE_H * 4, 0);
  let read = 0;
  for (let y = 0; y < TILE_ROW.length; y += 1) {
    const run = TILE_ROW[y];
    for (let step = 0; step < run; step += 1) {
      const x = 15 + step - run / 2;
      if (read * 2 + 1 >= data.length) return image;
      const rgb = colourOf(data.readUInt16LE(read * 2));
      const at = ((x | 0) + y * TILE_W) * 4;
      image[at] = rgb[0]; image[at + 1] = rgb[1]; image[at + 2] = rgb[2]; image[at + 3] = 255;
      read += 1;
    }
  }
  return image;
}

// The upper part belongs to the same map tile as its diamond. Keep its
// original GM1 offset instead of flattening it into a background image.
// Shared by the cropped renderer and the whole-map sprite atlas.
function upperTilePicture(entry, raw) {
  if (raw.length <= 512 || !entry.height) return null;
  return { width: TILE_W, height: entry.height,
    dx: entry.direction === 3 ? 14 : 0, dy: -(entry.lift || 0),
    rgba: tgxToRgba(raw.subarray(512), TILE_W, entry.height, null) };
}


module.exports = { colourOf, readGm1, tgxToRgba, diamondToRgba, upperTilePicture };
