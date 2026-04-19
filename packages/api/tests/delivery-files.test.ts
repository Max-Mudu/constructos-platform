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

// Minimal valid file headers for magic-bytes validation
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
const PNG_BYTES  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const PDF_BYTES  = Buffer.from('%PDF-1.4 fake content');

/** Build a raw multipart/form-data body for a single file field named "file" */
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

// ─── POST photos ──────────────────────────────────────────────────────────────

describe('POST /deliveries/:deliveryId/photos', () => {
  it('company_admin can upload a photo', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('photo.jpg', 'image/jpeg', JPEG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const { photo } = res.json();
    expect(photo.fileName).toBe('photo.jpg');
    expect(photo.id).toBeDefined();
  });

  it('site_supervisor on the site can upload a photo', async () => {
    const { company } = await createTestCompany(app, 'df-photo-2');
    const admin    = await createTestUser(app, company.id, 'company_admin', 'adm-dfp2');
    const sup      = await createTestUser(app, company.id, 'site_supervisor', 'sup-dfp2');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('img.png', 'image/png', PNG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${sup.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
  });

  it('finance_officer cannot upload a photo — 403', async () => {
    const { company } = await createTestCompany(app, 'df-photo-3');
    const fo       = await createTestUser(app, company.id, 'finance_officer', 'fo-dfp3');
    const admin    = await createTestUser(app, company.id, 'company_admin', 'adm-dfp3');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${fo.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid file type (non-image) — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-4');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart(
      'report.pdf',
      'application/pdf',
      PDF_BYTES,
    );

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects MIME type spoofing (JPEG declared but PDF bytes) — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-spoof');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Declare image/jpeg but upload PDF magic bytes
    const { body, boundary } = buildMultipart('evil.jpg', 'image/jpeg', PDF_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');
  });

  it('returns 404 for non-existent delivery', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, '00000000-0000-0000-0000-000000000000'),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(404);
  });

  it('photo appears in delivery GET response', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-6');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);

    await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/deliveries/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.photos).toHaveLength(1);
    expect(res.json().delivery.photos[0].fileName).toBe('img.jpg');
  });

  it('fileKey is not exposed in photo upload response', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-nokey');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().photo.fileKey).toBeUndefined();
  });

  it('fileKey is not exposed in delivery GET response', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-nokey2');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);

    await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/deliveries/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.photos[0].fileKey).toBeUndefined();
  });

  it('writes audit log on photo upload', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-audit-up');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('audit.jpg', 'image/jpeg', JPEG_BYTES);

    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const photoId = uploadRes.json().photo.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'delivery_photo', entityId: photoId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });

  it('enforces max photo limit (20) per delivery — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-photo-limit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Upload 20 photos
    for (let i = 0; i < 20; i++) {
      const { body, boundary } = buildMultipart(`img${i}.jpg`, 'image/jpeg', JPEG_BYTES);
      const r = await app.inject({
        method: 'POST',
        url: PHOTOS_URL(project.id, site.id, delivery.id),
        headers: {
          authorization: `Bearer ${admin.accessToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(r.statusCode).toBe(201);
    }

    // 21st upload should fail
    const { body, boundary } = buildMultipart('extra.jpg', 'image/jpeg', JPEG_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('FILE_LIMIT_REACHED');
  });
});

// ─── DELETE photos ────────────────────────────────────────────────────────────

describe('DELETE /deliveries/:deliveryId/photos/:photoId', () => {
  it('company_admin can delete a photo', async () => {
    const { company, admin } = await createTestCompany(app, 'df-del-photo-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Upload a photo first
    const { body, boundary } = buildMultipart('to-delete.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const photoId = uploadRes.json().photo.id;

    // Delete it
    const delRes = await app.inject({
      method: 'DELETE',
      url: `${PHOTOS_URL(project.id, site.id, delivery.id)}/${photoId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(delRes.statusCode).toBe(204);

    // Verify removed
    const check = await prisma.deliveryPhoto.findUnique({ where: { id: photoId } });
    expect(check).toBeNull();
  });

  it('site_supervisor cannot delete a photo — 403', async () => {
    const { company } = await createTestCompany(app, 'df-del-photo-sup');
    const admin    = await createTestUser(app, company.id, 'company_admin', 'adm-dps');
    const sup      = await createTestUser(app, company.id, 'site_supervisor', 'sup-dps');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Upload as admin
    const { body, boundary } = buildMultipart('img.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const photoId = uploadRes.json().photo.id;

    // Site supervisor tries to delete — should be 403
    const res = await app.inject({
      method: 'DELETE',
      url: `${PHOTOS_URL(project.id, site.id, delivery.id)}/${photoId}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on photo delete', async () => {
    const { company, admin } = await createTestCompany(app, 'df-del-photo-audit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('del-audit.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const photoId = uploadRes.json().photo.id;

    await app.inject({
      method: 'DELETE',
      url: `${PHOTOS_URL(project.id, site.id, delivery.id)}/${photoId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'delivery_photo', entityId: photoId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });
});

// ─── POST documents ───────────────────────────────────────────────────────────

describe('POST /deliveries/:deliveryId/documents', () => {
  it('company_admin can upload a PDF document', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('delivery-note.pdf', 'application/pdf', PDF_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(document.fileName).toBe('delivery-note.pdf');
    expect(document.fileType).toBe('application/pdf');
  });

  it('rejects disallowed file type — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-2');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart(
      'script.sh',
      'application/x-sh',
      Buffer.from('#!/bin/bash'),
    );

    const res = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects MIME type spoofing (PDF declared but JPEG bytes) — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-spoof');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Declare application/pdf but upload JPEG magic bytes
    const { body, boundary } = buildMultipart('evil.pdf', 'application/pdf', JPEG_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_FILE_TYPE');
  });

  it('document appears in delivery GET response', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-3');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('dn.pdf', 'application/pdf', PDF_BYTES);

    await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/deliveries/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.documents).toHaveLength(1);
    expect(res.json().delivery.documents[0].fileType).toBe('application/pdf');
  });

  it('fileKey is not exposed in document upload response', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-nokey');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('note.pdf', 'application/pdf', PDF_BYTES);

    const res = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().document.fileKey).toBeUndefined();
  });

  it('writes audit log on document upload', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-audit-up');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('audit.pdf', 'application/pdf', PDF_BYTES);

    const uploadRes = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const docId = uploadRes.json().document.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'delivery_document', entityId: docId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });

  it('enforces max document limit (10) per delivery — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'df-doc-limit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Upload 10 documents
    for (let i = 0; i < 10; i++) {
      const { body, boundary } = buildMultipart(`doc${i}.pdf`, 'application/pdf', PDF_BYTES);
      const r = await app.inject({
        method: 'POST',
        url: DOCS_URL(project.id, site.id, delivery.id),
        headers: {
          authorization: `Bearer ${admin.accessToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(r.statusCode).toBe(201);
    }

    // 11th upload should fail
    const { body, boundary } = buildMultipart('extra.pdf', 'application/pdf', PDF_BYTES);
    const res = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('FILE_LIMIT_REACHED');
  });
});

// ─── DELETE documents ─────────────────────────────────────────────────────────

describe('DELETE /deliveries/:deliveryId/documents/:documentId', () => {
  it('company_admin can delete a document', async () => {
    const { company, admin } = await createTestCompany(app, 'df-del-doc-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('del.pdf', 'application/pdf', PDF_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const documentId = uploadRes.json().document.id;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `${DOCS_URL(project.id, site.id, delivery.id)}/${documentId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(delRes.statusCode).toBe(204);

    const check = await prisma.deliveryDocument.findUnique({ where: { id: documentId } });
    expect(check).toBeNull();
  });

  it('site_supervisor cannot delete a document — 403', async () => {
    const { company } = await createTestCompany(app, 'df-del-doc-sup');
    const admin    = await createTestUser(app, company.id, 'company_admin', 'adm-dds');
    const sup      = await createTestUser(app, company.id, 'site_supervisor', 'sup-dds');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('doc.pdf', 'application/pdf', PDF_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const documentId = uploadRes.json().document.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `${DOCS_URL(project.id, site.id, delivery.id)}/${documentId}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on document delete', async () => {
    const { company, admin } = await createTestCompany(app, 'df-del-doc-audit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('del-audit.pdf', 'application/pdf', PDF_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: DOCS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const documentId = uploadRes.json().document.id;

    await app.inject({
      method: 'DELETE',
      url: `${DOCS_URL(project.id, site.id, delivery.id)}/${documentId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'delivery_document', entityId: documentId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });
});

// ─── GET /uploads/* (file serving) ───────────────────────────────────────────

describe('GET /uploads/* — file serving security', () => {
  it('unauthenticated request returns 401', async () => {
    const { company, admin } = await createTestCompany(app, 'df-serve-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    // Upload a photo to get a real fileUrl
    const { body, boundary } = buildMultipart('serve.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const fileUrl: string = uploadRes.json().photo.fileUrl;

    // Request without auth
    const res = await app.inject({ method: 'GET', url: fileUrl });
    expect(res.statusCode).toBe(401);
  });

  it('authenticated user can fetch their own file', async () => {
    const { company, admin } = await createTestCompany(app, 'df-serve-2');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const { body, boundary } = buildMultipart('myfile.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const fileUrl: string = uploadRes.json().photo.fileUrl;

    const res = await app.inject({
      method: 'GET',
      url: fileUrl,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('user from different company cannot access another company file — 404', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'df-serve-3a');
    const { admin: a2 }              = await createTestCompany(app, 'df-serve-3b');
    const project  = await createTestProject(c1.id);
    const site     = await createTestSite(c1.id, project.id);
    const delivery = await createTestDelivery(c1.id, project.id, site.id, a1.id);

    // a1 uploads a file
    const { body, boundary } = buildMultipart('private.jpg', 'image/jpeg', JPEG_BYTES);
    const uploadRes = await app.inject({
      method: 'POST',
      url: PHOTOS_URL(project.id, site.id, delivery.id),
      headers: {
        authorization: `Bearer ${a1.accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const fileUrl: string = uploadRes.json().photo.fileUrl;

    // a2 (different company) tries to access it
    const res = await app.inject({
      method: 'GET',
      url: fileUrl,
      headers: { authorization: `Bearer ${a2.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('path traversal attempt returns 400', async () => {
    const { admin } = await createTestCompany(app, 'df-serve-pt');

    // %2E%2E is URL-encoded ".." — triggers path traversal detection
    const res = await app.inject({
      method: 'GET',
      url: '/uploads/photos/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
