/** Layout-independent contrast normalization. No crop coordinates or metric color assumptions. */
export async function prepareImage(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('图片分辨率过大');
    const scale = Math.min(2, 1800 / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法处理图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    // Screenshot backgrounds determine polarity; labels can be any color.
    let luminance = 0;
    for (let i = 0; i < pixels.data.length; i += 16) luminance += (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
    const dark = luminance / (pixels.data.length / 16) < 127;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      const normalized = dark ? 255 - gray : gray;
      pixels.data[i] = normalized;
      pixels.data[i + 1] = normalized;
      pixels.data[i + 2] = normalized;
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}
