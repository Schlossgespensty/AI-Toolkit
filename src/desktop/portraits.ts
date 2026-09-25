import { resizePortraitPixels } from "../shared/portrait-pixels";

/** Conversion is explicit; browser interpolation must not blur game portraits. */
export async function portraitPng(
  dataUrl: string,
  size: 36 | 72,
): Promise<Uint8Array> {
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const source = new OffscreenCanvas(image.width, image.height);
    const context = source.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = resizePortraitPixels(
      context.getImageData(0, 0, image.width, image.height).data,
      image.width,
      image.height,
      size,
      size,
    );
    const output = new OffscreenCanvas(size, size);
    output
      .getContext("2d")!
      .putImageData(new ImageData(pixels, size, size), 0, 0);
    const png = await output.convertToBlob({ type: "image/png" });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    image.close();
  }
}
