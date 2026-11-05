import { StorageDriver } from './types';

/** In-memory driver for tests. */
export class MemoryStorageDriver implements StorageDriver {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType: opts.contentType });
  }

  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedUrl(key: string, opts: { expiresInSec: number }): Promise<string> {
    return `memory://${key}?expiresIn=${opts.expiresInSec}`;
  }
}
