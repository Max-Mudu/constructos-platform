import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { StorageDriver } from './types';
import { assertValidStorageKey, assertValidTtl, signFileUrl } from './signed-url';

/**
 * Same root as services/upload.service.ts `getUploadDir()` (not exported
 * there): a temp directory under test, `<cwd>/uploads` otherwise.
 *
 * Delivery, drawing and instruction uploads share this root (upload.service
 * legacyLocalUploadDriver, keys `photos/…`, `documents/…`, `drawings/…`,
 * `instructions/…`). The `/uploads/*` route only serves keys owned by one of
 * those database records via canAccessUploadedFile; daily-report keys are
 * served only through short-lived signed URLs (`GET /api/v1/files/signed`).
 */
export function defaultLocalStorageRoot(): string {
  if (process.env['NODE_ENV'] === 'test') {
    return path.join(os.tmpdir(), 'construction-platform-test-uploads');
  }
  return path.resolve(process.cwd(), 'uploads');
}

/** Sidecar metadata lives under a dot-directory, which no valid key can name. */
const META_DIR = '.storage-meta';

interface Sidecar {
  contentType: string;
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class LocalStorageDriver implements StorageDriver {
  readonly root: string;

  constructor(root: string = defaultLocalStorageRoot()) {
    this.root = path.resolve(root);
  }

  /** Validates the key and resolves it strictly inside `base`. */
  private resolveInside(base: string, key: string, suffix = ''): string {
    assertValidStorageKey(key);
    const resolved = path.resolve(base, ...key.split('/')) + suffix;
    // Belt and braces: the allow-list already makes escape impossible.
    if (!resolved.startsWith(base + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return resolved;
  }

  private dataPath(key: string): string {
    return this.resolveInside(this.root, key);
  }

  private metaPath(key: string): string {
    return this.resolveInside(path.join(this.root, META_DIR), key, '.json');
  }

  /** Write to a unique temp file in the target directory, then rename. */
  private async atomicWrite(target: string, body: Buffer | string): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    const dataFile = this.dataPath(key);
    const metaFile = this.metaPath(key);
    await this.atomicWrite(dataFile, body);
    const sidecar: Sidecar = { contentType: opts.contentType };
    await this.atomicWrite(metaFile, JSON.stringify(sidecar));
  }

  async get(key: string): Promise<Buffer | null> {
    const dataFile = this.dataPath(key);
    try {
      return await fs.readFile(dataFile);
    } catch (err) {
      if (isMissing(err) || (err as NodeJS.ErrnoException).code === 'EISDIR') return null;
      throw err;
    }
  }

  /** Content type recorded at put() time, or null if there is no sidecar. */
  async getContentType(key: string): Promise<string | null> {
    const metaFile = this.metaPath(key);
    try {
      const parsed = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Partial<Sidecar>;
      return typeof parsed.contentType === 'string' ? parsed.contentType : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const dataFile = this.dataPath(key);
    const metaFile = this.metaPath(key);
    for (const file of [dataFile, metaFile]) {
      try {
        await fs.unlink(file);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }
  }

  async signedUrl(
    key: string,
    opts: { expiresInSec: number; downloadName?: string; contentType?: string },
  ): Promise<string> {
    assertValidStorageKey(key);
    assertValidTtl(opts.expiresInSec);
    return signFileUrl({
      key,
      expiresAt: Math.floor(Date.now() / 1000) + opts.expiresInSec,
      ...(opts.downloadName ? { downloadName: opts.downloadName } : {}),
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
    });
  }
}
