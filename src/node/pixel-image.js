'use strict';

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function encodeRgbaPng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('PNG dimensions must be positive integers.');
  }
  if (!Buffer.isBuffer(rgba) || rgba.length !== width * height * 4) {
    throw new Error('RGBA data does not match the PNG dimensions.');
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function setPixel(rgba, width, x, y, color) {
  const offset = (y * width + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function fillRect(rgba, width, height, x, y, rectWidth, rectHeight, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) setPixel(rgba, width, column, row, color);
  }
}

function placeholderPortraitPng(size) {
  if (!Number.isInteger(size) || size < 8) throw new Error('The portrait size is invalid.');
  const rgba = Buffer.alloc(size * size * 4);
  fillRect(rgba, size, size, 0, 0, size, size, [36, 40, 48, 255]);
  fillRect(rgba, size, size, size * .2, size * .14, size * .6, size * .72, [48, 101, 172, 255]);
  fillRect(rgba, size, size, size * .27, size * .22, size * .46, size * .56, [25, 32, 43, 255]);

  const ink = [238, 241, 246, 255];
  const stroke = Math.max(1, Math.round(size / 18));
  const letterTop = Math.round(size * .37);
  const letterHeight = Math.round(size * .25);
  const aLeft = Math.round(size * .33);
  const aWidth = Math.round(size * .16);
  fillRect(rgba, size, size, aLeft, letterTop + stroke, stroke, letterHeight - stroke, ink);
  fillRect(rgba, size, size, aLeft + aWidth - stroke, letterTop + stroke, stroke, letterHeight - stroke, ink);
  fillRect(rgba, size, size, aLeft + stroke, letterTop, aWidth - stroke * 2, stroke, ink);
  fillRect(rgba, size, size, aLeft + stroke, letterTop + Math.round(letterHeight * .48), aWidth - stroke * 2, stroke, ink);
  const iLeft = Math.round(size * .56);
  fillRect(rgba, size, size, iLeft, letterTop, stroke, letterHeight, ink);
  return encodeRgbaPng(size, size, rgba);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function resizeBgraBitmapToPng(bitmap, sourceWidth, sourceHeight, targetWidth, targetHeight, alphaThreshold = 128) {
  for (const value of [sourceWidth, sourceHeight, targetWidth, targetHeight]) {
    if (!Number.isInteger(value) || value < 1) throw new Error('Portrait dimensions must be positive integers.');
  }
  if (!Buffer.isBuffer(bitmap) || bitmap.length !== sourceWidth * sourceHeight * 4) {
    throw new Error('The decoded portrait bitmap has an unexpected size.');
  }

  const rgba = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      const alpha = bitmap[sourceOffset + 3];
      if (alpha < alphaThreshold) continue;

      const unpremultiply = alpha < 255 ? 255 / alpha : 1;
      rgba[targetOffset] = clampByte(bitmap[sourceOffset + 2] * unpremultiply);
      rgba[targetOffset + 1] = clampByte(bitmap[sourceOffset + 1] * unpremultiply);
      rgba[targetOffset + 2] = clampByte(bitmap[sourceOffset] * unpremultiply);
      rgba[targetOffset + 3] = 255;
    }
  }
  return encodeRgbaPng(targetWidth, targetHeight, rgba);
}

module.exports = {
  encodeRgbaPng,
  placeholderPortraitPng,
  resizeBgraBitmapToPng
};
