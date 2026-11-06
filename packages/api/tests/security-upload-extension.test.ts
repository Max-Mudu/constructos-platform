/**
 * Security regression: the extension of a stored upload comes from the
 * validated MIME type, never from the client-supplied filename. Before the
 * fix `evil.html` uploaded as image/png was stored as `<uuid>.html`, which a
 * static host / CDN that infers Content-Type from the extension would serve
 * as HTML (stored XSS) once legacy uploads move off the API's /uploads route.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { storeFile, removeFile, storedFileExtension } from '../src/services/upload.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.4\n%test\n', 'latin1');
const uploadRoot = path.join(os.tmpdir(), 'construction-platform-test-uploads');

describe('stored upload extension', () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const key of created) await removeFile(key);
  });

  it.each([
    ['evil.html', 'image/png', PNG, '.png'],
    ['evil.svg', 'image/png', PNG, '.png'],
    ['payload.js', 'application/pdf', PDF, '.pdf'],
    ['noext', 'application/pdf', PDF, '.pdf'],
    ['PHOTO.JPEG', 'image/png', PNG, '.png'],
  ])('%s declared as %s is stored with %s', async (name, mime, body, ext) => {
    const result = await storeFile(body, name, mime, 'photos');
    created.push(result.fileKey);
    expect(path.extname(result.fileKey)).toBe(ext);
    expect(result.fileKey).toMatch(new RegExp(`^photos/[0-9a-f-]{36}\\${ext}$`));
    expect(result.fileUrl).toBe(`/uploads/${result.fileKey}`);
    // The display name is kept as given; only the on-disk key changes.
    expect(result.fileName).toBe(name);
    const onDisk = await fs.readFile(path.join(uploadRoot, result.fileKey));
    expect(onDisk.equals(body)).toBe(true);
  });

  it('maps every accepted MIME type to a fixed extension', () => {
    expect(storedFileExtension('image/jpeg')).toBe('.jpg');
    expect(storedFileExtension('image/jpg')).toBe('.jpg');
    expect(storedFileExtension('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('.xlsx');
    expect(storedFileExtension('text/html')).toBe('');
  });
});
