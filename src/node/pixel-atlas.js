'use strict';
const { encodeRgbaPng } = require('./pixel-image');
function packMapPictures(pictures) {
  const width = 2048;
  let x = 1, y = 1, rowHeight = 0;
  const entries = pictures.map(picture => {
    if (!picture) return null;
    if (picture.width + 2 > width || picture.height > 4096) throw new Error('Invalid map sprite dimensions.');
    if (x + picture.width + 1 > width) { x = 1; y += rowHeight + 2; rowHeight = 0; }
    const entry = { x, y, width: picture.width, height: picture.height, dx: picture.dx, dy: picture.dy };
    x += picture.width + 2;
    rowHeight = Math.max(rowHeight, picture.height);
    return entry;
  });
  const height = y + rowHeight + 1;
  if (width * height > 32 * 1024 * 1024) throw new Error('Map sprite atlas exceeds its size limit.');
  const rgba = Buffer.alloc(width * height * 4);
  pictures.forEach((picture, index) => {
    if (!picture) return;
    const entry = entries[index];
    for (let row = 0; row < picture.height; row++) {
      const from = row * picture.width * 4;
      picture.rgba.copy(rgba, ((entry.y + row) * width + entry.x) * 4, from, from + picture.width * 4);
    }
  });
  return { entries, dataUrl: `data:image/png;base64,${encodeRgbaPng(width, height, rgba).toString('base64')}` };
}

module.exports = { packMapPictures };
