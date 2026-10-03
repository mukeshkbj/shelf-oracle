// Browser-side image helpers: downscale uploads before sending (vision models
// don't need >1600px) and crop product thumbnails by fractional box.

export async function fileToResizedDataUrl(
  file: File,
  maxSide = 1600,
  quality = 0.82
): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function cropDataUrl(
  imageDataUrl: string,
  box: { x: number; y: number; w: number; h: number },
  outSize = 256,
  quality = 0.8
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = rej;
    el.src = imageDataUrl;
  });
  const pad = 0.06; // slight margin so boxes don't clip edges
  const x = Math.max(0, (box.x - box.w * pad) * img.width);
  const y = Math.max(0, (box.y - box.h * pad) * img.height);
  const w = Math.min(img.width - x, box.w * (1 + 2 * pad) * img.width);
  const h = Math.min(img.height - y, box.h * (1 + 2 * pad) * img.height);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, outSize / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas
    .getContext("2d")!
    .drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
