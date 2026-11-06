/**
 * Delivery / drawing / instruction uploads go through the upload storage
 * driver (app.uploadStorage):
 *  - STORAGE_DRIVER=local (default): local disk under the legacy uploads
 *    directory, same keys and paths as before;
 *  - STORAGE_DRIVER=s3: the same driver as Daily Reports (here a
 *    MemoryStorageDriver / stubbed S3 client — no network);
 * and GET /uploads/* serves from the driver, falling back to files already on
 * local disk. Access rules are unchanged.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { S3Client } from '@aws-sdk/client-s3';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { S3StorageDriver } from '../src/services/storage/s3';
import { legacyUploadRoot, readFile, removeFile, storeFile } from '../src/services/upload.service';
import {
  buildMultipartFile, clearDatabase, createTestCompany, createTestDelivery, createTestProject,
  createTestSite, TEST_JPEG_BYTES, TestUser,
} from './helpers/fixtures';

const UPLOAD_ROOT = path.join(os.tmpdir(), 'construction-platform-test-uploads');
const written: string[] = [];

afterAll(async () => {
  await Promise.all(written.map((f) => fs.rm(f, { force: true })));
  await clearDatabase();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });

async function world(app: FastifyInstance, slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id);
  const site = await createTestSite(company.id, project.id);
  const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);
  const base = `/api/v1/projects/${project.id}/sites/${site.id}/deliveries/${delivery.id}`;
  return { company, admin, project, site, delivery, base };
}

async function uploadPhoto(app: FastifyInstance, admin: TestUser, base: string) {
  const file = buildMultipartFile('site.jpg', 'image/jpeg', TEST_JPEG_BYTES);
  const res = await app.inject({
    method: 'POST', url: `${base}/photos`, headers: { ...auth(admin), ...file.headers }, payload: file.body,
  });
  expect(res.statusCode).toBe(201);
  const photo = await prisma.deliveryPhoto.findUniqueOrThrow({ where: { id: res.json().photo.id } });
  return photo;
}

/** A file already on local disk with a delivery photo row pointing at it. */
async function legacyDiskPhoto(companyId: string, deliveryId: string, uploaderId: string, key: string) {
  const full = path.join(UPLOAD_ROOT, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, 'legacy-bytes');
  written.push(full);
  await prisma.deliveryPhoto.create({
    data: {
      deliveryRecordId: deliveryId, companyId, fileUrl: `/uploads/${key}`, fileKey: key,
      fileName: 'old.jpg', fileSizeBytes: 12, uploadedById: uploaderId,
    },
  });
}

describe('default (STORAGE_DRIVER=local): same disk layout as before', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('uses the legacy uploads directory', () => {
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(legacyUploadRoot()).toBe(path.resolve(UPLOAD_ROOT));
  });

  it('upload writes <root>/photos/<uuid>.jpg, /uploads serves it, delete removes it', async () => {
    const w = await world(app, 'uploads-local');
    const photo = await uploadPhoto(app, w.admin, w.base);
    expect(photo.fileKey).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/);
    expect(photo.fileUrl).toBe(`/uploads/${photo.fileKey}`);
    const onDisk = path.join(UPLOAD_ROOT, photo.fileKey);
    written.push(onDisk);
    expect(await fs.readFile(onDisk)).toEqual(TEST_JPEG_BYTES);

    const get = await app.inject({ method: 'GET', url: `/uploads/${photo.fileKey}`, headers: auth(w.admin) });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload).toEqual(TEST_JPEG_BYTES);
    expect(get.headers['content-type']).toBe('application/octet-stream');

    const del = await app.inject({ method: 'DELETE', url: `${w.base}/photos/${photo.id}`, headers: auth(w.admin) });
    expect(del.statusCode).toBe(204);
    expect(await exists(onDisk)).toBe(false);
  });

  it('traversal is still rejected and unknown keys are 404', async () => {
    const w = await world(app, 'uploads-local-guard');
    const bad = await app.inject({ method: 'GET', url: '/uploads/..%2F..%2Fetc%2Fpasswd', headers: auth(w.admin) });
    expect([400, 404]).toContain(bad.statusCode);
    const missing = await app.inject({ method: 'GET', url: `/uploads/photos/${randomUUID()}.jpg`, headers: auth(w.admin) });
    expect(missing.statusCode).toBe(404);
  });
});

describe('driver-backed uploads (s3 path, in-memory driver)', () => {
  const memory = new MemoryStorageDriver();
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ uploadStorage: memory }); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => memory.objects.clear());

  it('upload lands in the driver (with its content type), not on local disk', async () => {
    const w = await world(app, 'uploads-mem');
    const photo = await uploadPhoto(app, w.admin, w.base);
    expect(memory.objects.get(photo.fileKey)).toEqual({ body: TEST_JPEG_BYTES, contentType: 'image/jpeg' });
    expect(await exists(path.join(UPLOAD_ROOT, photo.fileKey))).toBe(false);

    const get = await app.inject({ method: 'GET', url: `/uploads/${photo.fileKey}`, headers: auth(w.admin) });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload).toEqual(TEST_JPEG_BYTES);

    const del = await app.inject({ method: 'DELETE', url: `${w.base}/photos/${photo.id}`, headers: auth(w.admin) });
    expect(del.statusCode).toBe(204);
    expect(memory.objects.has(photo.fileKey)).toBe(false);
  });

  it('files still on local disk are served through the fallback', async () => {
    const w = await world(app, 'uploads-mem-legacy');
    const key = `photos/legacy-${randomUUID()}.jpg`;
    await legacyDiskPhoto(w.company.id, w.delivery.id, w.admin.id, key);
    const get = await app.inject({ method: 'GET', url: `/uploads/${key}`, headers: auth(w.admin) });
    expect(get.statusCode).toBe(200);
    expect(get.body).toBe('legacy-bytes');
  });

  it('access rules are unchanged: another company gets 404 for a stored key', async () => {
    const w = await world(app, 'uploads-mem-a');
    const other = await world(app, 'uploads-mem-b');
    const photo = await uploadPhoto(app, w.admin, w.base);
    const get = await app.inject({ method: 'GET', url: `/uploads/${photo.fileKey}`, headers: auth(other.admin) });
    expect(get.statusCode).toBe(404);
  });
});

describe('driver selection', () => {
  it('STORAGE_DRIVER=s3 → uploads use the same driver as Daily Reports', async () => {
    const memory = new MemoryStorageDriver();
    const mutable = env as { STORAGE_DRIVER: 'local' | 's3' };
    const saved = mutable.STORAGE_DRIVER;
    mutable.STORAGE_DRIVER = 's3';
    const app = await buildApp({ storage: memory });
    try {
      await app.ready();
      expect(app.uploadStorage).toBe(memory);
    } finally {
      mutable.STORAGE_DRIVER = saved;
      await app.close();
    }
  });

  it('STORAGE_DRIVER=local → uploads stay on local disk even when Daily Report storage is injected', async () => {
    const memory = new MemoryStorageDriver();
    const app = await buildApp({ storage: memory });
    try {
      await app.ready();
      expect(app.uploadStorage).not.toBe(memory);
    } finally {
      await app.close();
    }
  });
});

describe('upload.service with an S3 driver (stubbed client, no network)', () => {
  function stubS3() {
    const commands: Array<{ name: string; input: Record<string, unknown> }> = [];
    const client = {
      send: jest.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });
        return {};
      }),
    } as unknown as S3Client;
    const driver = new S3StorageDriver({
      bucket: 'test-fixture-bucket', region: 'auto', accessKeyId: 'TEST', secretAccessKey: 'TEST', client,
    });
    return { driver, commands };
  }

  it('storeFile PUTs the server-generated key with the validated content type', async () => {
    const { driver, commands } = stubS3();
    const result = await storeFile(Buffer.from('%PDF-1.4 x'), 'plan.pdf', 'application/pdf', 'drawings', driver);
    expect(result.fileKey).toMatch(/^drawings\/[0-9a-f-]{36}\.pdf$/);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('PutObjectCommand');
    expect(commands[0]!.input).toMatchObject({
      Bucket: 'test-fixture-bucket', Key: result.fileKey, ContentType: 'application/pdf',
    });
  });

  it('removeFile deletes from the bucket; readFile with a key the driver rejects falls back to disk', async () => {
    const { driver, commands } = stubS3();
    await removeFile('photos/abc.jpg', driver);
    expect(commands.map((c) => c.name)).toEqual(['DeleteObjectCommand']);

    // A legacy key outside the driver's key rules (space) is read from disk only.
    const key = `photos/legacy ${randomUUID()}.jpg`;
    const full = path.join(UPLOAD_ROOT, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, 'old');
    written.push(full);
    expect((await readFile(key, driver))?.toString()).toBe('old');
    expect(commands).toHaveLength(1); // no GetObject for the invalid key
    expect(await readFile('../outside.txt', driver)).toBeNull();
  });
});
