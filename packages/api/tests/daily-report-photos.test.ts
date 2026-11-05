/**
 * Daily Site Report V1 — photos: type + magic bytes, size, count, draft-only,
 * scope, storage key layout, cleanup on failure, caption/sortOrder, delete.
 * Storage is an injected in-memory driver.
 */
import { createHash } from 'crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { RenderDailyReportPdf } from '../src/services/daily-report/pdf/types';
import { ExtractionError, ReportExtractor } from '../src/services/daily-report/extractor/types';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany, createTestDailyReport,
  createTestProject, createTestSite, createTestUser, TEST_JPEG_BYTES, TEST_PNG_BYTES, TestUser,
} from './helpers/fixtures';

class HookedStorage extends MemoryStorageDriver {
  onPut: ((key: string) => Promise<void>) | null = null;
  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    await super.put(key, body, opts);
    if (this.onPut) await this.onPut(key);
  }
}

const storage = new HookedStorage();
const renderPdf: RenderDailyReportPdf = async () => Buffer.from('%PDF-1.4 x');
const extractor: ReportExtractor = { async extract() { throw new ExtractionError('AI_DISABLED'); } };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ storage, renderPdf, reportExtractor: extractor });
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
  storage.objects.clear();
  storage.onPut = null;
});

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });
const GIF_BYTES  = Buffer.from('474946383961010001000000002c00000000010001000002024401003b', 'hex');
const WEBP_BYTES = Buffer.from('52494646240000005745425056503820', 'hex');

async function setup(slug = 'drp') {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id, 'Hillside Homes');
  const site = await createTestSite(company.id, project.id, 'Phase 1');
  const site2 = await createTestSite(company.id, project.id, 'Phase 2');
  const sup = await createTestUser(app, company.id, 'site_supervisor', `${slug}-sup`);
  await assignUserToProject(company.id, project.id, sup.id, site.id);
  const report = await createTestDailyReport(company.id, project.id, site.id, sup.id);
  const url = `/api/v1/projects/${project.id}/sites/${site.id}/daily-reports/${report.id}`;
  return { company, admin, project, site, site2, sup, report, url };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function upload(ctx: Ctx, file: { name: string; type: string; bytes: Buffer; field?: string }, user: TestUser = ctx.sup, url = ctx.url) {
  const mp = buildMultipartFile(file.name, file.type, file.bytes, file.field);
  return app.inject({ method: 'POST', url: `${url}/photos`, headers: { ...auth(user), ...mp.headers }, payload: mp.body });
}

const photoKeys = () => [...storage.objects.keys()].filter((k) => k.includes('/photos/'));

describe('POST /:reportId/photos', () => {
  it('stores a JPEG under the tenant-prefixed key and returns a signed URL', async () => {
    const ctx = await setup();
    const t0 = Date.now();
    const res = await upload(ctx, { name: 'slab.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES });
    expect(res.statusCode).toBe(201);
    const { photo } = res.json();
    expect(Object.keys(photo).sort()).toEqual(['caption', 'height', 'id', 'sortOrder', 'url', 'urlExpiresAt', 'width']);
    expect(photo).toMatchObject({ caption: '', sortOrder: 0 });

    const row = await prisma.dailyReportPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row.fileKey).toMatch(new RegExp(`^daily-reports/${ctx.company.id}/${ctx.report.id}/photos/[0-9a-f-]{36}\\.jpg$`));
    expect(row).toMatchObject({ companyId: ctx.company.id, fileType: 'image/jpeg', fileName: 'slab.jpg', uploadedById: ctx.sup.id });
    const stored = storage.objects.get(row.fileKey)!;
    expect(stored.contentType).toBe('image/jpeg');
    expect(row.sha256).toBe(createHash('sha256').update(stored.body).digest('hex'));
    expect(row.fileSizeBytes).toBe(stored.body.length);

    expect(photo.url).toBe(await storage.signedUrl(row.fileKey, { expiresInSec: 300 }));
    const ttl = Date.parse(photo.urlExpiresAt) - t0;
    expect(ttl).toBeGreaterThan(290_000);
    expect(ttl).toBeLessThan(310_000);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'daily_report_photo', action: 'create', entityId: photo.id } });
    expect(audit).not.toBeNull();
  });

  it('accepts PNG (stored as normalised JPEG) and appends sortOrder', async () => {
    const ctx = await setup();
    expect((await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES })).json().photo.sortOrder).toBe(0);
    const res = await upload(ctx, { name: 'b.png', type: 'image/png', bytes: TEST_PNG_BYTES });
    expect(res.statusCode).toBe(201);
    expect(res.json().photo.sortOrder).toBe(1);
    const row = await prisma.dailyReportPhoto.findUniqueOrThrow({ where: { id: res.json().photo.id } });
    expect(row.fileKey.endsWith('.jpg')).toBe(true);
    expect(row.fileType).toBe('image/jpeg');
  });

  it.each([
    ['GIF', 'image/gif', GIF_BYTES],
    ['WEBP', 'image/webp', WEBP_BYTES],
    ['PNG bytes declared as JPEG', 'image/jpeg', TEST_PNG_BYTES],
    ['text declared as PNG', 'image/png', Buffer.from('definitely not an image')],
    ['PDF', 'application/pdf', Buffer.from('%PDF-1.4 x')],
  ])('rejects %s with 422 INVALID_FILE_TYPE and stores nothing', async (_label, type, bytes) => {
    const ctx = await setup();
    const res = await upload(ctx, { name: 'x', type, bytes });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');
    expect(photoKeys()).toEqual([]);
    expect(await prisma.dailyReportPhoto.count()).toBe(0);
  });

  it('rejects a file over 10 MB with 413 FILE_TOO_LARGE', async () => {
    const ctx = await setup();
    const big = Buffer.concat([TEST_JPEG_BYTES, Buffer.alloc(10 * 1024 * 1024 + 1 - TEST_JPEG_BYTES.length, 0)]);
    const res = await upload(ctx, { name: 'big.jpg', type: 'image/jpeg', bytes: big });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('FILE_TOO_LARGE');
    expect(photoKeys()).toEqual([]);
    expect(await prisma.dailyReportPhoto.count()).toBe(0);
  });

  it('rejects the 31st photo with 422 FILE_LIMIT_REACHED', async () => {
    const ctx = await setup();
    await prisma.dailyReportPhoto.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        companyId: ctx.company.id, dailyReportId: ctx.report.id, fileKey: `seed/${ctx.report.id}/${i}.jpg`,
        fileName: `${i}.jpg`, fileType: 'image/jpeg', fileSizeBytes: 10, sha256: 'c'.repeat(64), uploadedById: ctx.sup.id, sortOrder: i,
      })),
    });
    const res = await upload(ctx, { name: 'one-too-many.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('FILE_LIMIT_REACHED');
    expect(photoKeys()).toEqual([]);
  });

  it('requires a multipart body with a "file" field (400)', async () => {
    const ctx = await setup();
    const wrongField = await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES, field: 'photo' });
    expect(wrongField.statusCode).toBe(400);
    const json = await app.inject({ method: 'POST', url: `${ctx.url}/photos`, headers: auth(ctx.sup), payload: { file: 'x' } });
    expect(json.statusCode).toBe(400);
    expect(photoKeys()).toEqual([]);
  });

  it('is draft-only (409 REPORT_FINAL)', async () => {
    const ctx = await setup();
    await prisma.dailyReport.update({ where: { id: ctx.report.id }, data: { status: 'final' } });
    const res = await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('REPORT_FINAL');
    expect(photoKeys()).toEqual([]);
  });

  it('a supervisor of another site gets 404 and nothing is stored', async () => {
    const ctx = await setup();
    const other = await createTestUser(app, ctx.company.id, 'site_supervisor', 'drp-other');
    await assignUserToProject(ctx.company.id, ctx.project.id, other.id, ctx.site2.id);
    const res = await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES }, other);
    expect(res.statusCode).toBe(404);
    expect(photoKeys()).toEqual([]);
  });

  it('deletes the stored object when the DB write fails after the upload', async () => {
    const ctx = await setup();
    // The report is finalised by someone else between the object write and the row insert.
    storage.onPut = async () => {
      await prisma.dailyReport.update({ where: { id: ctx.report.id }, data: { status: 'final' } });
    };
    const res = await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES });
    expect(res.statusCode).toBe(409);
    expect(photoKeys()).toEqual([]);
    expect(await prisma.dailyReportPhoto.count()).toBe(0);
  });
});

describe('PATCH / DELETE /:reportId/photos/:photoId', () => {
  async function withPhoto() {
    const ctx = await setup();
    const res = await upload(ctx, { name: 'a.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES });
    const photo = res.json().photo;
    const row = await prisma.dailyReportPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    return { ...ctx, photo, fileKey: row.fileKey, photoUrl: `${ctx.url}/photos/${photo.id}` };
  }

  it('updates caption (trimmed, ≤ 300) and sortOrder', async () => {
    const ctx = await withPhoto();
    const ok = await app.inject({ method: 'PATCH', url: ctx.photoUrl, headers: auth(ctx.sup), payload: { caption: `  ${'c'.repeat(300)}  `, sortOrder: 5 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().photo).toMatchObject({ id: ctx.photo.id, caption: 'c'.repeat(300), sortOrder: 5, url: expect.any(String) });

    for (const payload of [{ caption: 'c'.repeat(301) }, { sortOrder: -1 }, { sortOrder: 1.5 }, { fileKey: 'x' }, {}]) {
      const bad = await app.inject({ method: 'PATCH', url: ctx.photoUrl, headers: auth(ctx.sup), payload });
      expect(bad.statusCode).toBe(422);
    }
    const row = await prisma.dailyReportPhoto.findUniqueOrThrow({ where: { id: ctx.photo.id } });
    expect(row).toMatchObject({ caption: 'c'.repeat(300), sortOrder: 5, fileKey: ctx.fileKey });
  });

  it('GET orders photos by sortOrder', async () => {
    const ctx = await withPhoto();
    const second = (await upload(ctx, { name: 'b.jpg', type: 'image/jpeg', bytes: TEST_JPEG_BYTES })).json().photo;
    await app.inject({ method: 'PATCH', url: ctx.photoUrl, headers: auth(ctx.sup), payload: { sortOrder: 9 } });
    const report = (await app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.sup) })).json().report;
    expect(report.photos.map((p: { id: string }) => p.id)).toEqual([second.id, ctx.photo.id]);
    expect(report.photoCount).toBe(2);
  });

  it('DELETE removes the row and the stored object (204), then 404', async () => {
    const ctx = await withPhoto();
    expect(storage.objects.has(ctx.fileKey)).toBe(true);
    const res = await app.inject({ method: 'DELETE', url: ctx.photoUrl, headers: auth(ctx.sup) });
    expect(res.statusCode).toBe(204);
    expect(await prisma.dailyReportPhoto.count()).toBe(0);
    expect(storage.objects.has(ctx.fileKey)).toBe(false);
    const again = await app.inject({ method: 'DELETE', url: ctx.photoUrl, headers: auth(ctx.sup) });
    expect(again.statusCode).toBe(404);
  });

  it('a photo of another report is 404; a final report is 409', async () => {
    const ctx = await withPhoto();
    const otherReport = await createTestDailyReport(ctx.company.id, ctx.project.id, ctx.site.id, ctx.sup.id, { reportDate: '2026-04-08' });
    const otherUrl = `/api/v1/projects/${ctx.project.id}/sites/${ctx.site.id}/daily-reports/${otherReport.id}/photos/${ctx.photo.id}`;
    expect((await app.inject({ method: 'PATCH', url: otherUrl, headers: auth(ctx.sup), payload: { caption: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: otherUrl, headers: auth(ctx.sup) })).statusCode).toBe(404);

    await prisma.dailyReport.update({ where: { id: ctx.report.id }, data: { status: 'final' } });
    const p = await app.inject({ method: 'PATCH', url: ctx.photoUrl, headers: auth(ctx.sup), payload: { caption: 'x' } });
    expect(p.statusCode).toBe(409);
    const d = await app.inject({ method: 'DELETE', url: ctx.photoUrl, headers: auth(ctx.sup) });
    expect(d.statusCode).toBe(409);
    expect(storage.objects.has(ctx.fileKey)).toBe(true);
    expect(await prisma.dailyReportPhoto.count()).toBe(1);
  });
});
