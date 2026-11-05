import { createHash } from 'crypto';
import sharp from 'sharp';

/** Thrown for anything that is not a decodable, reasonably sized JPEG or PNG. */
export class InvalidImageError extends Error {
  constructor(message = 'Invalid image') {
    super(message);
    this.name = 'InvalidImageError';
  }
}

/** Decompression-bomb guard: refuse inputs above 40 megapixels. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Output is resized to fit inside this box (never enlarged). */
export const MAX_OUTPUT_DIMENSION = 1600;
export const JPEG_QUALITY = 80;

const ALLOWED_FORMATS = new Set(['jpeg', 'png']);

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Buffer): boolean {
  return b.length >= 8
    && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}

/** Maps any sharp/libvips failure to InvalidImageError without echoing its text. */
function toInvalidImageError(err: unknown): InvalidImageError {
  if (/pixel limit/i.test((err as Error | null)?.message ?? '')) {
    return new InvalidImageError('Image dimensions are too large');
  }
  return new InvalidImageError('Image could not be decoded');
}

/**
 * Normalises an uploaded site photo before it is stored or embedded in a PDF:
 *  1. accepts only JPEG / PNG (magic bytes AND decoder agree),
 *  2. refuses more than MAX_INPUT_PIXELS (checked from the header before any
 *     pixel decode, and again by sharp's limitInputPixels),
 *  3. applies the EXIF orientation, then resizes inside 1600×1600 without
 *     enlargement,
 *  4. flattens transparency onto white and encodes JPEG quality 80,
 *  5. strips ALL metadata (EXIF incl. GPS, XMP, IPTC, ICC; sharp converts to
 *     sRGB and writes none of it because withMetadata/keepMetadata is not used),
 *  6. returns the sha256 (hex) of the output bytes.
 */
export async function normalisePhoto(input: Buffer): Promise<{
  data: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
}> {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new InvalidImageError('Image is empty');
  }
  if (!isJpeg(input) && !isPng(input)) {
    throw new InvalidImageError('Only JPEG and PNG images are accepted');
  }

  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' as const };

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, options).metadata();
  } catch (err) {
    throw toInvalidImageError(err);
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new InvalidImageError('Only JPEG and PNG images are accepted');
  }
  if (!meta.width || !meta.height) {
    throw new InvalidImageError('Image could not be decoded');
  }
  if (meta.width * meta.height > MAX_INPUT_PIXELS) {
    throw new InvalidImageError('Image dimensions are too large');
  }

  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(input, options)
      .rotate() // auto-orient from EXIF Orientation
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw toInvalidImageError(err);
  }

  const { data, info } = output;
  return {
    data,
    contentType: 'image/jpeg',
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
