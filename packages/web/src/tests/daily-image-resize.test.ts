import {
  JPEG_QUALITY, MAX_PHOTO_DIMENSION, computeTargetSize, isAcceptedPhoto, resizeImageFile, toJpegName,
  type CanvasLike, type ResizeDeps,
} from '@/lib/image-resize';

describe('computeTargetSize', () => {
  it('scales a 4000×3000 phone photo to 1600×1200', () => {
    expect(computeTargetSize(4000, 3000)).toEqual({ width: 1600, height: 1200, scale: 0.4 });
  });

  it('scales portrait photos by the long edge', () => {
    const t = computeTargetSize(3024, 4032);
    expect(t.height).toBe(1600);
    expect(t.width).toBe(1200);
  });

  it('never upscales small images', () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(computeTargetSize(1600, 1600)).toEqual({ width: 1600, height: 1600, scale: 1 });
  });

  it('keeps extreme panoramas within bounds and at least 1 px', () => {
    const t = computeTargetSize(20000, 10);
    expect(t.width).toBe(1600);
    expect(t.height).toBe(1);
    expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(MAX_PHOTO_DIMENSION);
  });

  it('rejects invalid dimensions', () => {
    expect(() => computeTargetSize(0, 100)).toThrow();
    expect(() => computeTargetSize(NaN, 100)).toThrow();
    expect(() => computeTargetSize(100, 100, 0)).toThrow();
  });
});

describe('resizeImageFile (mocked canvas)', () => {
  function makeDeps(w: number, h: number, blobOut: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })) {
    const calls: { fill?: [number, number, number, number]; draw?: unknown[]; toBlob?: [string, number | undefined]; fillStyle?: string } = {};
    const close = jest.fn();
    const ctx = {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low' as ImageSmoothingQuality,
      fillRect: jest.fn((...a: number[]) => { calls.fill = a as [number, number, number, number]; calls.fillStyle = ctx.fillStyle as string; }),
      drawImage: jest.fn((...a: unknown[]) => { calls.draw = a; }),
    };
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ctx as unknown as ReturnType<CanvasLike['getContext']>,
      toBlob: (cb, type, quality) => { calls.toBlob = [type, quality]; cb(blobOut); },
    };
    const source = { tag: 'bitmap' } as unknown as CanvasImageSource;
    const deps: ResizeDeps = {
      decode: jest.fn().mockResolvedValue({ source, width: w, height: h, close }),
      createCanvas: () => canvas,
    };
    return { deps, canvas, calls, close, source };
  }

  it('draws a 4032×3024 photo onto a 1600×1200 canvas and encodes JPEG', async () => {
    const { deps, canvas, calls, close, source } = makeDeps(4032, 3024);
    const file = new File(['x'], 'IMG_2041.PNG', { type: 'image/png' });
    const out = await resizeImageFile(file, {}, deps);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(calls.draw).toEqual([source, 0, 0, 1600, 1200]);
    expect(calls.fill).toEqual([0, 0, 1600, 1200]); // white background for PNG transparency
    expect(calls.fillStyle).toBe('#FFFFFF');
    expect(calls.toBlob).toEqual(['image/jpeg', JPEG_QUALITY]);
    expect(out.file.type).toBe('image/jpeg');
    expect(out.file.name).toBe('IMG_2041.jpg');
    expect(out).toMatchObject({ width: 1600, height: 1200, scaled: true });
    expect(close).toHaveBeenCalled();
  });

  it('re-encodes small photos without upscaling', async () => {
    const { deps, canvas } = makeDeps(1000, 750);
    const out = await resizeImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), {}, deps);
    expect([canvas.width, canvas.height]).toEqual([1000, 750]);
    expect(out.scaled).toBe(false);
  });

  it('honours a custom max and quality', async () => {
    const { deps, canvas, calls } = makeDeps(3000, 2000);
    await resizeImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), { max: 1200, quality: 0.7 }, deps);
    expect([canvas.width, canvas.height]).toEqual([1200, 800]);
    expect(calls.toBlob).toEqual(['image/jpeg', 0.7]);
  });

  it('fails clearly when the canvas cannot encode, and still releases the image', async () => {
    const { deps, close } = makeDeps(2000, 2000, null);
    await expect(resizeImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), {}, deps)).rejects.toThrow(/compress/);
    expect(close).toHaveBeenCalled();
  });
});

describe('file helpers', () => {
  it('accepts JPEG/PNG by type, or by extension when type is missing', () => {
    expect(isAcceptedPhoto({ type: 'image/jpeg', name: 'a' })).toBe(true);
    expect(isAcceptedPhoto({ type: 'image/png', name: 'a' })).toBe(true);
    expect(isAcceptedPhoto({ type: 'image/heic', name: 'a.heic' })).toBe(false);
    expect(isAcceptedPhoto({ type: '', name: 'photo.JPEG' })).toBe(true);
    expect(isAcceptedPhoto({ type: '', name: 'photo.webp' })).toBe(false);
  });

  it('renames to .jpg', () => {
    expect(toJpegName('site.photo.png')).toBe('site.photo.jpg');
    expect(toJpegName('noext')).toBe('noext.jpg');
    expect(toJpegName('')).toBe('photo.jpg');
  });
});
