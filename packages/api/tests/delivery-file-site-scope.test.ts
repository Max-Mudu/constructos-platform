/**
 * Site-supervisor site scoping on delivery photo/document upload + delete.
 *
 * A site_supervisor assigned (ProjectMember.siteId) to site A of project P must
 * not be able to attach or remove files on a delivery at site B of the same
 * project by using the site B URL. Denial is a 404 identical to "delivery not
 * found" so it is not an existence oracle, and nothing is written (no row, no
 * file on disk).
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestDelivery,
  assignUserToProject,
  clearDatabase,
  TestUser,
  TestProject,
  TestSite,
  TestDelivery,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const PHOTOS_URL = (pid: string, sid: string, did: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/deliveries/${did}/photos`;
const DOCS_URL = (pid: string, sid: string, did: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/deliveries/${did}/documents`;

const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
const PDF_BYTES  = Buffer.from('%PDF-1.4 fake content');

// Same location upload.service uses when NODE_ENV=test
const UPLOAD_ROOT = path.join(os.tmpdir(), 'construction-platform-test-uploads');

async function listUploads(subdir: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(UPLOAD_ROOT, subdir))).sort();
  } catch {
    return [];
  }
}

function buildMultipart(
  filename: string,
  contentType: string,
  content: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

function uploadPhoto(user: TestUser, projectId: string, siteId: string, deliveryId: string) {
  const { body, boundary } = buildMultipart('photo.jpg', 'image/jpeg', JPEG_BYTES);
  return app.inject({
    method: 'POST',
    url: PHOTOS_URL(projectId, siteId, deliveryId),
    headers: {
      authorization: `Bearer ${user.accessToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

function uploadDocument(user: TestUser, projectId: string, siteId: string, deliveryId: string) {
  const { body, boundary } = buildMultipart('note.pdf', 'application/pdf', PDF_BYTES);
  return app.inject({
    method: 'POST',
    url: DOCS_URL(projectId, siteId, deliveryId),
    headers: {
      authorization: `Bearer ${user.accessToken}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

interface Scenario {
  admin: TestUser;
  pm: TestUser;
  supA: TestUser;      // site_supervisor assigned only to site A
  project: TestProject;
  siteA: TestSite;
  siteB: TestSite;
  deliveryA: TestDelivery;
  deliveryB: TestDelivery;
}

async function setup(slug: string): Promise<Scenario> {
  const { company, admin } = await createTestCompany(app, slug);
  const pm      = await createTestUser(app, company.id, 'project_manager', `pm-${slug}`);
  const supA    = await createTestUser(app, company.id, 'site_supervisor', `sup-${slug}`);
  const project = await createTestProject(company.id);
  const siteA   = await createTestSite(company.id, project.id, 'Site A');
  const siteB   = await createTestSite(company.id, project.id, 'Site B');
  await assignUserToProject(company.id, project.id, pm.id);
  await assignUserToProject(company.id, project.id, supA.id, siteA.id);
  const deliveryA = await createTestDelivery(company.id, project.id, siteA.id, admin.id);
  const deliveryB = await createTestDelivery(company.id, project.id, siteB.id, admin.id);
  return { admin, pm, supA, project, siteA, siteB, deliveryA, deliveryB };
}

// ─── Photo upload ─────────────────────────────────────────────────────────────

describe('POST delivery photos — site_supervisor site scope', () => {
  it('supervisor on site A cannot upload a photo to a site B delivery — 404, nothing stored', async () => {
    const s = await setup('dfss-photo-up');
    const filesBefore = await listUploads('photos');

    const res = await uploadPhoto(s.supA, s.project.id, s.siteB.id, s.deliveryB.id);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Delivery record not found', code: 'NOT_FOUND' });
    expect(await prisma.deliveryPhoto.count({ where: { deliveryRecordId: s.deliveryB.id } })).toBe(0);
    expect(await listUploads('photos')).toEqual(filesBefore);
    expect(await prisma.auditLog.count({ where: { entityType: 'delivery_photo' } })).toBe(0);
  });

  it('denial is indistinguishable from a nonexistent delivery', async () => {
    const s = await setup('dfss-photo-oracle');
    const denied  = await uploadPhoto(s.supA, s.project.id, s.siteB.id, s.deliveryB.id);
    const missing = await uploadPhoto(
      s.admin, s.project.id, s.siteB.id, '00000000-0000-0000-0000-000000000000',
    );
    expect(denied.statusCode).toBe(missing.statusCode);
    expect(denied.json()).toEqual(missing.json());
  });

  it('supervisor on site A can still upload a photo to a site A delivery', async () => {
    const s = await setup('dfss-photo-own');
    const res = await uploadPhoto(s.supA, s.project.id, s.siteA.id, s.deliveryA.id);
    expect(res.statusCode).toBe(201);
  });

  it('unrestricted supervisor (project membership with no site) can upload on any site', async () => {
    const s = await setup('dfss-photo-open');
    const supOpen = await createTestUser(app, s.project.companyId, 'site_supervisor', 'sup-open-photo');
    await assignUserToProject(s.project.companyId, s.project.id, supOpen.id);
    const res = await uploadPhoto(supOpen, s.project.id, s.siteB.id, s.deliveryB.id);
    expect(res.statusCode).toBe(201);
  });

  it('company_admin and project_manager can upload photos on both sites', async () => {
    const s = await setup('dfss-photo-roles');
    for (const user of [s.admin, s.pm]) {
      expect((await uploadPhoto(user, s.project.id, s.siteA.id, s.deliveryA.id)).statusCode).toBe(201);
      expect((await uploadPhoto(user, s.project.id, s.siteB.id, s.deliveryB.id)).statusCode).toBe(201);
    }
  });
});

// ─── Document upload ──────────────────────────────────────────────────────────

describe('POST delivery documents — site_supervisor site scope', () => {
  it('supervisor on site A cannot upload a document to a site B delivery — 404, nothing stored', async () => {
    const s = await setup('dfss-doc-up');
    const filesBefore = await listUploads('documents');

    const res = await uploadDocument(s.supA, s.project.id, s.siteB.id, s.deliveryB.id);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Delivery record not found', code: 'NOT_FOUND' });
    expect(await prisma.deliveryDocument.count({ where: { deliveryRecordId: s.deliveryB.id } })).toBe(0);
    expect(await listUploads('documents')).toEqual(filesBefore);
    expect(await prisma.auditLog.count({ where: { entityType: 'delivery_document' } })).toBe(0);
  });

  it('supervisor on site A can still upload a document to a site A delivery', async () => {
    const s = await setup('dfss-doc-own');
    const res = await uploadDocument(s.supA, s.project.id, s.siteA.id, s.deliveryA.id);
    expect(res.statusCode).toBe(201);
  });

  it('company_admin and project_manager can upload documents on both sites', async () => {
    const s = await setup('dfss-doc-roles');
    for (const user of [s.admin, s.pm]) {
      expect((await uploadDocument(user, s.project.id, s.siteA.id, s.deliveryA.id)).statusCode).toBe(201);
      expect((await uploadDocument(user, s.project.id, s.siteB.id, s.deliveryB.id)).statusCode).toBe(201);
    }
  });
});

// ─── Photo / document delete ──────────────────────────────────────────────────
// site_supervisor is not in DELETE_ROLES, so the role gate already refuses it;
// these pin that the site-B file is never removed by a site-A supervisor and
// that admin/PM deletes keep working on every site.

describe('DELETE delivery photos/documents — site scope', () => {
  it('supervisor on site A cannot delete a site B photo — row and file unchanged', async () => {
    const s = await setup('dfss-photo-del');
    const photoId = (await uploadPhoto(s.admin, s.project.id, s.siteB.id, s.deliveryB.id)).json().photo.id;
    const before = await prisma.deliveryPhoto.findUnique({ where: { id: photoId } });
    const filesBefore = await listUploads('photos');

    const res = await app.inject({
      method: 'DELETE',
      url: `${PHOTOS_URL(s.project.id, s.siteB.id, s.deliveryB.id)}/${photoId}`,
      headers: { authorization: `Bearer ${s.supA.accessToken}` },
    });

    expect([403, 404]).toContain(res.statusCode);
    expect(await prisma.deliveryPhoto.findUnique({ where: { id: photoId } })).toEqual(before);
    expect(await listUploads('photos')).toEqual(filesBefore);
  });

  it('supervisor on site A cannot delete a site B document — row and file unchanged', async () => {
    const s = await setup('dfss-doc-del');
    const documentId = (await uploadDocument(s.admin, s.project.id, s.siteB.id, s.deliveryB.id)).json().document.id;
    const before = await prisma.deliveryDocument.findUnique({ where: { id: documentId } });
    const filesBefore = await listUploads('documents');

    const res = await app.inject({
      method: 'DELETE',
      url: `${DOCS_URL(s.project.id, s.siteB.id, s.deliveryB.id)}/${documentId}`,
      headers: { authorization: `Bearer ${s.supA.accessToken}` },
    });

    expect([403, 404]).toContain(res.statusCode);
    expect(await prisma.deliveryDocument.findUnique({ where: { id: documentId } })).toEqual(before);
    expect(await listUploads('documents')).toEqual(filesBefore);
  });

  it('company_admin and project_manager can delete photos and documents on both sites', async () => {
    const s = await setup('dfss-del-roles');
    for (const user of [s.admin, s.pm]) {
      for (const [site, delivery] of [[s.siteA, s.deliveryA], [s.siteB, s.deliveryB]] as const) {
        const photoId = (await uploadPhoto(user, s.project.id, site.id, delivery.id)).json().photo.id;
        const delPhoto = await app.inject({
          method: 'DELETE',
          url: `${PHOTOS_URL(s.project.id, site.id, delivery.id)}/${photoId}`,
          headers: { authorization: `Bearer ${user.accessToken}` },
        });
        expect(delPhoto.statusCode).toBe(204);

        const documentId = (await uploadDocument(user, s.project.id, site.id, delivery.id)).json().document.id;
        const delDoc = await app.inject({
          method: 'DELETE',
          url: `${DOCS_URL(s.project.id, site.id, delivery.id)}/${documentId}`,
          headers: { authorization: `Bearer ${user.accessToken}` },
        });
        expect(delDoc.statusCode).toBe(204);
      }
    }
  });
});
