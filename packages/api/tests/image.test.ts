/**
 * normalisePhoto(): decode guard, auto-orientation, resize, JPEG re-encode,
 * metadata stripping and hashing. Fixtures are generated in-test with sharp.
 */
import { createHash } from 'crypto';
import zlib from 'zlib';
import sharp from 'sharp';
import {
  normalisePhoto,
  InvalidImageError,
  MAX_INPUT_PIXELS,
} from '../src/services/storage/image';

const GPS_MARKER = 'TEST-FIXTURE-GPS-DATUM';
const DESC_MARKER = 'TEST-FIXTURE-DESCRIPTION';

/** 400×200 JPEG: left half red, right half blue. */
async function redLeftBlueRight(width = 400, height = 200) {
  const left = await sharp({ create: { width: width / 2, height, channels: 3, background: '#ff0000' } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#0000ff' } })
    .composite([{ input: left, left: 0, top: 0 }]);
}

/** A JPEG carrying EXIF (incl. a GPS IFD) and the given EXIF Orientation. */
async function jpegWithGps(orientation: number, width = 400, height = 200): Promise<Buffer> {
  const base = await (await redLeftBlueRight(width, height)).jpeg({ quality: 90 }).toBuffer();
  return sharp(base)
    .withExif({
      IFD0: { ImageDescription: DESC_MARKER, Orientation: String(orientation) },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '1/1 17/1 30/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '36/1 49/1 0/1',
        GPSMapDatum: GPS_MARKER,
      },
    })
    .withMetadata({ orientation })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function pixel(img: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

/** Marker bytes of every segment between SOI and SOS. */
function jpegHeaderMarkers(b: Buffer): number[] {
  const markers: number[] = [];
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error(`bad marker at ${i}`);
    const marker = b[i + 1]!;
    markers.push(marker);
    if (marker === 0xda) break; // SOS: entropy-coded data follows
    i += 2 + b.readUInt16BE(i + 2);
  }
  return markers;
}

function isRed([r, g, b]: [number, number, number]) { return r > 200 && g < 60 && b < 60; }
function isBlue([r, g, b]: [number, number, number]) { return b > 200 && r < 60 && g < 60; }

// ── Minimal PNG writer for header-only "bomb" fixtures ───────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A PNG whose header claims width×height (8-bit greyscale); the IDAT holds one row. */
function pngClaiming(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + width); // filter byte + pixels
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(row)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('normalisePhoto', () => {
  it('fixture sanity: the input really carries EXIF + GPS and an orientation', async () => {
    const input = await jpegWithGps(6);
    const meta = await sharp(input).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif).toBeDefined();
    expect(meta.exif!.includes(GPS_MARKER)).toBe(true);
    expect(input.includes(GPS_MARKER)).toBe(true);
    expect(input.includes(DESC_MARKER)).toBe(true);
  });

  it('strips all metadata (EXIF, GPS, ICC, XMP, IPTC) from the output', async () => {
    const out = await normalisePhoto(await jpegWithGps(1));
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.data.includes(GPS_MARKER)).toBe(false);
    expect(out.data.includes(DESC_MARKER)).toBe(false);
    expect(out.data.includes('Exif')).toBe(false);
    // Walk the JPEG header segments (SOI … SOS): no APP1 (EXIF/XMP), APP2 (ICC)
    // or APP13 (IPTC) segment may be present.
    const markers = jpegHeaderMarkers(out.data);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers).not.toContain(0xe1);
    expect(markers).not.toContain(0xe2);
    expect(markers).not.toContain(0xed);
    // Positive control: the input does have an APP1 segment.
    expect(jpegHeaderMarkers(await jpegWithGps(1))).toContain(0xe1);
  });

  it('applies the EXIF orientation (6 = rotate 90° clockwise) before stripping it', async () => {
    const out = await normalisePhoto(await jpegWithGps(6));
    expect(out.width).toBe(200);
    expect(out.height).toBe(400);
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    // Stored left half (red) becomes the displayed top half.
    expect(isRed(await pixel(out.data, 100, 50))).toBe(true);
    expect(isBlue(await pixel(out.data, 100, 350))).toBe(true);
  });

  it('leaves an upright image upright and does not enlarge small images', async () => {
    const out = await normalisePhoto(await jpegWithGps(1));
    expect([out.width, out.height]).toEqual([400, 200]);
    expect(isRed(await pixel(out.data, 50, 100))).toBe(true);
    expect(isBlue(await pixel(out.data, 350, 100))).toBe(true);
  });

  it('resizes inside 1600×1600 preserving aspect ratio', async () => {
    const landscape = await (await redLeftBlueRight(3200, 2400)).jpeg().toBuffer();
    const a = await normalisePhoto(landscape);
    expect([a.width, a.height]).toEqual([1600, 1200]);

    const portrait = await sharp({ create: { width: 1000, height: 4000, channels: 3, background: '#808080' } }).png().toBuffer();
    const b = await normalisePhoto(portrait);
    expect([b.width, b.height]).toEqual([400, 1600]);
  });

  it('converts PNG (with alpha) to JPEG, flattening onto white', async () => {
    const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png().toBuffer();
    const out = await normalisePhoto(png);
    expect(out.contentType).toBe('image/jpeg');
    expect(out.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([64, 32]);
    const [r, g, b] = await pixel(out.data, 10, 10);
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
  });

  it('returns the sha256 of the output bytes and is deterministic', async () => {
    const input = await jpegWithGps(3);
    const a = await normalisePhoto(input);
    const b = await normalisePhoto(input);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(createHash('sha256').update(a.data).digest('hex'));
    expect(b.sha256).toBe(a.sha256);
  });

  it.each([
    ['empty buffer', Buffer.alloc(0)],
    ['random garbage', Buffer.from('this is definitely not an image, just text bytes')],
    ['JPEG magic then garbage', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x41)])],
    ['PNG magic then garbage', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x41)])],
    ['PDF', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')],
  ])('rejects %s with InvalidImageError', async (_name, input) => {
    await expect(normalisePhoto(input)).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('rejects decodable non-JPEG/PNG formats (WebP, GIF)', async () => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).webp().toBuffer();
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).gif().toBuffer();
    await expect(normalisePhoto(webp)).rejects.toBeInstanceOf(InvalidImageError);
    await expect(normalisePhoto(gif)).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('rejects a truncated JPEG', async () => {
    const full = await (await redLeftBlueRight()).jpeg().toBuffer();
    await expect(normalisePhoto(full.subarray(0, Math.floor(full.length / 2)))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('guards against decompression bombs (header claims > 40 MP)', async () => {
    expect(MAX_INPUT_PIXELS).toBe(40_000_000);
    // 10000 × 10000 = 100 MP claimed by a ~100-byte file.
    const bomb = pngClaiming(10_000, 10_000);
    expect(bomb.length).toBeLessThan(2_000);
    const meta = await sharp(bomb).metadata();
    expect([meta.width, meta.height]).toEqual([10_000, 10_000]);
    await expect(normalisePhoto(bomb)).rejects.toThrow(new InvalidImageError('Image dimensions are too large'));
    // Just over the limit also fails; the limit is on area, not side length.
    await expect(normalisePhoto(pngClaiming(40_001, 1_000))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('InvalidImageError is an Error subclass usable with instanceof', () => {
    const err = new InvalidImageError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidImageError);
    expect(err.name).toBe('InvalidImageError');
  });
});
