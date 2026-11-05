/**
 * Client-side photo resize for the Daily Report.
 *
 * Phone cameras produce 4000×3000+ images of several MB. Before upload we
 * draw the photo onto a canvas no larger than 1600 px on its long edge and
 * re-encode it as JPEG. Re-encoding also drops EXIF metadata (including GPS
 * location) from the uploaded file. Decoding and canvas creation are
 * injectable so the sizing logic is unit tested without a real canvas.
 */

export const MAX_PHOTO_DIMENSION = 1600;
export const JPEG_QUALITY = 0.82;
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

export interface TargetSize {
  width: number;
  height: number;
  scale: number;
}

/**
 * Fits width×height inside max×max keeping the aspect ratio. Never upscales.
 * Throws for non-positive or non-finite input.
 */
export function computeTargetSize(width: number, height: number, max: number = MAX_PHOTO_DIMENSION): TargetSize {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Invalid image dimensions');
  }
  if (!(max > 0)) throw new Error('Invalid maximum dimension');
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.min(max, Math.max(1, Math.round(width * scale)));
  const h = Math.min(max, Math.max(1, Math.round(height * scale)));
  return { width: w, height: h, scale };
}

/** "IMG_2041.PNG" → "IMG_2041.jpg" */
export function toJpegName(name: string): string {
  const base = (name || 'photo').replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.jpg`;
}

/** JPEG or PNG by MIME type, or by extension when the picker gives no type. */
export function isAcceptedPhoto(file: { type: string; name: string }): boolean {
  if (file.type) return (ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type.toLowerCase());
  return /\.(jpe?g|png)$/i.test(file.name);
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Pick<CanvasRenderingContext2D, 'drawImage' | 'fillRect' | 'fillStyle' | 'imageSmoothingEnabled' | 'imageSmoothingQuality'> | null;
  toBlob(cb: (b: Blob | null) => void, type: string, quality?: number): void;
}

export interface ResizeDeps {
  decode: (file: Blob) => Promise<DecodedImage>;
  createCanvas: () => CanvasLike;
}

async function defaultDecode(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not read this photo'));
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

const defaultDeps: ResizeDeps = {
  decode: defaultDecode,
  createCanvas: () => document.createElement('canvas') as unknown as CanvasLike,
};

export interface ResizeResult {
  file: File;
  width: number;
  height: number;
  /** True when the photo was scaled down. */
  scaled: boolean;
}

/** Resizes to ≤ max px on the long edge and re-encodes as JPEG. */
export async function resizeImageFile(
  file: File,
  opts: { max?: number; quality?: number } = {},
  deps: ResizeDeps = defaultDeps,
): Promise<ResizeResult> {
  const max = opts.max ?? MAX_PHOTO_DIMENSION;
  const quality = opts.quality ?? JPEG_QUALITY;
  const img = await deps.decode(file);
  try {
    const target = computeTargetSize(img.width, img.height, max);
    const canvas = deps.createCanvas();
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // PNG transparency would turn black in JPEG; paint white first.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img.source, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not compress this photo');
    const out = new File([blob], toJpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    return { file: out, width: target.width, height: target.height, scaled: target.scale < 1 };
  } finally {
    img.close?.();
  }
}
