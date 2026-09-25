"use strict";

/**
 * Shared Classic portrait contract: nearest source pixel, binary transparency.
 * Canvas supplies straight RGBA; Electron nativeImage supplies premultiplied BGRA.
 * @param {Uint8Array|Uint8ClampedArray} source
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @param {{bgra?:boolean,premultiplied?:boolean,alphaThreshold?:number}} options
 */
function resizePortraitPixels(
  source,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  options = {},
) {
  const pixels = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const threshold = options.alphaThreshold ?? 128;
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y * sourceHeight) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x * sourceWidth) / targetWidth),
      );
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      const alpha = source[from + 3];
      if (alpha < threshold) continue;
      const scale = options.premultiplied && alpha > 0 ? 255 / alpha : 1;
      pixels[to] = Math.round(source[from + (options.bgra ? 2 : 0)] * scale);
      pixels[to + 1] = Math.round(source[from + 1] * scale);
      pixels[to + 2] = Math.round(
        source[from + (options.bgra ? 0 : 2)] * scale,
      );
      pixels[to + 3] = 255;
    }
  }
  return pixels;
}

module.exports = { resizePortraitPixels };
