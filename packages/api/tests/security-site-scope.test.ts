/**
 * SITE_SCOPE_STRICT — opt-in consistent site scoping.
 *
 * Every case runs twice:
 *  - flag off (default): today's rules — only site_supervisor is limited by a
 *    site-scoped membership, and drawings/instructions are project-wide for
 *    every project member;
 *  - flag on: the Daily Report rule everywhere — site_supervisor, viewer and
 *    consultant with a membership naming a site see only that site; drawings
 *    and instructions are limited to their site plus project-level records
 *    (siteId null), plus instructions the actor issued. Project managers,
 *    contractors and finance officers are unchanged.
 *
 * World: one project with sites A and B. Site-limited users are members with
 * siteId = A; "*All" users are members with siteId = null. Records under test
 * live on site B, so "hidden" means 404 (or absent from a list).
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany, createTestContractor,
  createTestDelivery, createTestDrawing, createTestInstruction, createTestProject, createTestSite,
  createTestUser, createTestWorkPackage, TestUser,
} from './helpers/fixtures';

const UPLOAD_DIR = path.join(os.tmpdir(), 'construction-platform-test-uploads');
const writtenFiles: string[] = [];

let app: FastifyInstance;
const savedFlag = env.SITE_SCOPE_STRICT;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  (env as { SITE_SCOPE_STRICT: boolean }).SITE_SCOPE_STRICT = savedFlag;
  await Promise.all(writtenFiles.map((f) => fs.rm(f, { force: true })));
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function setFlag(value: boolean) {
  (env as { SITE_SCOPE_STRICT: boolean }).SITE_SCOPE_STRICT = value;
}

async function writeUpload(prefix: string, ext: string): Promise<string> {
  const key = `${prefix}/site-scope-${randomUUID()}.${ext}`;
  const full = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, 'site-scope-test-content');
  writtenFiles.push(full);
  return key;
}

// ─── Actors and the rule under test ──────────────────────────────────────────

interface ActorSpec {
  key: string;
  role: UserRole;
  /** true → membership siteId = site A; false → siteId null. */
  siteLimited: boolean;
  /** false → no project_members row at all (finance_officer is company-wide without one). */
  member?: boolean;
}

const ACTORS: ActorSpec[] = [
  { key: 'viewer',          role: 'viewer',          siteLimited: true },
  { key: 'consultant',      role: 'consultant',      siteLimited: true },
  { key: 'site_supervisor', role: 'site_supervisor', siteLimited: true },
  { key: 'contractor',      role: 'contractor',      siteLimited: true },
  { key: 'project_manager', role: 'project_manager', siteLimited: true },
  { key: 'finance_officer', role: 'finance_officer', siteLimited: false, member: false },
  { key: 'financeMemberA',  role: 'finance_officer', siteLimited: true },
  { key: 'viewerAll',       role: 'viewer',          siteLimited: false },
  { key: 'consultantAll',   role: 'consultant',      siteLimited: false },
];

const SITE_ROLES_OFF: UserRole[] = ['site_supervisor'];
const SITE_ROLES_ON:  UserRole[] = ['site_supervisor', 'viewer', 'consultant'];

/** Site-bound modules (sites, deliveries, schedule, reports). */
const siteScoped = (a: ActorSpec, flag: boolean) =>
  a.siteLimited && (flag ? SITE_ROLES_ON : SITE_ROLES_OFF).includes(a.role);
/** Project documents with an optional site (drawings, instructions). */
const docScoped = (a: ActorSpec, flag: boolean) =>
  flag && a.siteLimited && SITE_ROLES_ON.includes(a.role);

const DELIVERY_VIEW: UserRole[] = ['project_manager', 'site_supervisor', 'finance_officer', 'viewer'];
const SCHEDULE_VIEW: UserRole[] = ['project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant'];
const CONSULTANT_REPORT: UserRole[] = ['project_manager', 'consultant'];

// ─── World ───────────────────────────────────────────────────────────────────

interface World {
  admin: TestUser;
  users: Record<string, TestUser>;
  projectId: string;
  siteA: string;
  siteB: string;
  deliveryB: string;
  deliveryPhotoKeyB: string;
  drawingB: string;
  drawingP: string;
  revisionB: string;
  revisionKeyB: string;
  instrA: string;
  instrB: string;
  instrP: string;
  instrBbyConsultant: string;
  instrAbyConsultant: string;
  attachmentKeyB: string;
}

async function buildWorld(tag: string): Promise<World> {
  const { company, admin } = await createTestCompany(app, `site-scope-${tag}`);
  const project = await createTestProject(company.id, 'Scoped Project');
  const siteA = await createTestSite(company.id, project.id, 'Site A');
  const siteB = await createTestSite(company.id, project.id, 'Site B');

  const users: Record<string, TestUser> = {};
  for (const a of ACTORS) {
    const u = await createTestUser(app, company.id, a.role, `${a.key}-${tag}`.toLowerCase());
    users[a.key] = u;
    if (a.member !== false) {
      await assignUserToProject(company.id, project.id, u.id, a.siteLimited ? siteA.id : undefined);
    }
  }
  const contractor = await createTestContractor(company.id, `Contractor ${tag}`, users['contractor']!.id);

  // Deliveries + photo on site B
  const deliveryB = await createTestDelivery(company.id, project.id, siteB.id, admin.id);
  const deliveryPhotoKeyB = await writeUpload('photos', 'jpg');
  await prisma.deliveryPhoto.create({
    data: {
      deliveryRecordId: deliveryB.id, companyId: company.id, fileUrl: `/uploads/${deliveryPhotoKeyB}`,
      fileKey: deliveryPhotoKeyB, fileName: 'p.jpg', fileSizeBytes: 10, uploadedById: admin.id,
    },
  });

  // Schedule on site B (contractor's own package, so contractors can read it)
  await createTestWorkPackage(company.id, project.id, siteB.id, contractor.id, admin.id, 'B package');

  // Drawings: site B (with revision file + comment), project-level, site A
  const drawingB = await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: `B-${tag}`, siteId: siteB.id });
  const drawingP = await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: `P-${tag}` });
  await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: `A-${tag}`, siteId: siteA.id });
  const revisionKeyB = await writeUpload('drawings', 'pdf');
  const revisionB = await prisma.drawingRevision.create({
    data: {
      drawingId: drawingB.id, companyId: company.id, revisionNumber: 'A', fileUrl: `/uploads/${revisionKeyB}`,
      fileKey: revisionKeyB, fileName: 'b.pdf', fileSizeBytes: 10, fileType: 'application/pdf',
      status: 'draft', uploadedById: admin.id,
    },
  });
  await prisma.drawingComment.create({
    data: { companyId: company.id, drawingId: drawingB.id, revisionId: revisionB.id, userId: admin.id, text: 'site B note' },
  });

  // Instructions
  const instrA = await createTestInstruction(company.id, project.id, admin.id, { siteId: siteA.id, title: 'A' });
  const instrB = await createTestInstruction(company.id, project.id, admin.id, {
    siteId: siteB.id, contractorId: contractor.id, title: 'B',
  });
  const instrP = await createTestInstruction(company.id, project.id, admin.id, { title: 'P' });
  const instrBbyConsultant = await createTestInstruction(company.id, project.id, users['consultant']!.id, {
    siteId: siteB.id, title: 'B by consultant',
  });
  const instrAbyConsultant = await createTestInstruction(company.id, project.id, users['consultant']!.id, {
    siteId: siteA.id, title: 'A by consultant',
  });
  const attachmentKeyB = await writeUpload('instructions', 'pdf');
  await prisma.instructionAttachment.create({
    data: {
      instructionId: instrB.id, companyId: company.id, fileUrl: `/uploads/${attachmentKeyB}`, fileKey: attachmentKeyB,
      fileName: 'att.pdf', fileSizeBytes: 10, fileType: 'application/pdf', uploadedById: admin.id,
    },
  });

  return {
    admin, users, projectId: project.id, siteA: siteA.id, siteB: siteB.id,
    deliveryB: deliveryB.id, deliveryPhotoKeyB,
    drawingB: drawingB.id, drawingP: drawingP.id, revisionB: revisionB.id, revisionKeyB,
    instrA: instrA.id, instrB: instrB.id, instrP: instrP.id,
    instrBbyConsultant: instrBbyConsultant.id, instrAbyConsultant: instrAbyConsultant.id,
    attachmentKeyB,
  };
}

function req(user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
  return app.inject({
    method, url, headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload !== undefined && { payload }),
  });
}

const ids = (rows: Array<{ id: string }>) => new Set(rows.map((r) => r.id));

it('SITE_SCOPE_STRICT defaults to off', () => {
  expect(savedFlag).toBe(false);
});

describe.each([false, true])('SITE_SCOPE_STRICT=%s', (flag) => {
  let w: World;

  beforeAll(async () => {
    setFlag(flag);
    await clearDatabase();
    w = await buildWorld(flag ? 'on' : 'off');
  });

  afterAll(() => setFlag(savedFlag));

  const P = () => `/api/v1/projects/${w.projectId}`;

  // ── Job sites ──────────────────────────────────────────────────────────────
  describe.each(ACTORS)('$key', (a) => {
    const u = () => w.users[a.key]!;

    it('sites: list and get follow the site rule', async () => {
      const list = await req(u(), 'GET', `${P()}/sites`);
      expect(list.statusCode).toBe(200);
      const listed = ids(list.json().sites);
      expect(listed.has(w.siteA)).toBe(true);
      expect(listed.has(w.siteB)).toBe(!siteScoped(a, flag));

      const get = await req(u(), 'GET', `${P()}/sites/${w.siteB}`);
      expect(get.statusCode).toBe(siteScoped(a, flag) ? 404 : 200);
    });

    it('deliveries: site B list and photo follow the site rule', async () => {
      const allowed = DELIVERY_VIEW.includes(a.role);
      const list = await req(u(), 'GET', `${P()}/sites/${w.siteB}/deliveries`);
      expect(list.statusCode).toBe(!allowed ? 403 : siteScoped(a, flag) ? 404 : 200);
      if (list.statusCode === 200) expect(ids(list.json().deliveries).has(w.deliveryB)).toBe(true);

      const file = await req(u(), 'GET', `/uploads/${w.deliveryPhotoKeyB}`);
      expect(file.statusCode).toBe(allowed && !siteScoped(a, flag) ? 200 : 404);
    });

    it('schedule: site B work packages follow the site rule', async () => {
      const allowed = SCHEDULE_VIEW.includes(a.role);
      const res = await req(u(), 'GET', `${P()}/sites/${w.siteB}/schedule/packages`);
      expect(res.statusCode).toBe(!allowed ? 403 : siteScoped(a, flag) ? 404 : 200);
      if (res.statusCode === 200) expect(res.json().packages).toHaveLength(1);
    });

    // Drawings and instructions require a membership row even for finance_officer
    // (unchanged by the flag): without one the module answers 403 and files 404.
    const docMember = a.member !== false;

    it('drawings: site B drawing, its comments and file follow the document rule; project-level stays visible', async () => {
      const list = await req(u(), 'GET', `${P()}/drawings`);
      if (!docMember) {
        expect(list.statusCode).toBe(403);
        expect((await req(u(), 'GET', `/uploads/${w.revisionKeyB}`)).statusCode).toBe(404);
        return;
      }
      expect(list.statusCode).toBe(200);
      const listed = ids(list.json().drawings);
      expect(listed.has(w.drawingP)).toBe(true);
      expect(listed.has(w.drawingB)).toBe(!docScoped(a, flag));

      const hidden = docScoped(a, flag);
      expect((await req(u(), 'GET', `${P()}/drawings/${w.drawingB}`)).statusCode).toBe(hidden ? 404 : 200);
      expect((await req(u(), 'GET', `${P()}/drawings/${w.drawingP}`)).statusCode).toBe(200);
      const comments = await req(u(), 'GET', `${P()}/drawings/${w.drawingB}/revisions/${w.revisionB}/comments`);
      expect(comments.statusCode).toBe(hidden ? 404 : 200);
      if (hidden) expect(comments.body).not.toContain('site B note');
      expect((await req(u(), 'GET', `/uploads/${w.revisionKeyB}`)).statusCode).toBe(hidden ? 404 : 200);
    });

    it('instructions: site B instruction and attachment follow the document rule; project-level stays visible', async () => {
      const hidden = docScoped(a, flag);
      const list = await req(u(), 'GET', `${P()}/instructions`);
      if (!docMember) {
        expect(list.statusCode).toBe(403);
        expect((await req(u(), 'GET', `/uploads/${w.attachmentKeyB}`)).statusCode).toBe(404);
        return;
      }
      expect(list.statusCode).toBe(200);
      const listed = ids(list.json().instructions);
      // Contractors only ever see instructions directed at them (instrB).
      expect(listed.has(w.instrP)).toBe(a.role !== 'contractor');
      expect(listed.has(w.instrB)).toBe(!hidden);
      if (a.key === 'consultant') expect(listed.has(w.instrBbyConsultant)).toBe(true); // own, any site

      expect((await req(u(), 'GET', `${P()}/instructions/${w.instrB}`)).statusCode).toBe(hidden ? 404 : 200);
      expect((await req(u(), 'GET', `/uploads/${w.attachmentKeyB}`)).statusCode).toBe(hidden ? 404 : 200);
    });

    it('consultants report: rows and site filter follow the rule', async () => {
      const allowed = CONSULTANT_REPORT.includes(a.role);
      const all = await req(u(), 'GET', `/api/v1/reports/consultants?projectId=${w.projectId}`);
      expect(all.statusCode).toBe(allowed ? 200 : 403);
      if (allowed) {
        // 5 instructions; a scoped consultant loses only instrB (site B, issued by admin).
        expect(all.json().report.rows).toHaveLength(docScoped(a, flag) ? 4 : 5);
      }
      const bySite = await req(u(), 'GET', `/api/v1/reports/consultants?projectId=${w.projectId}&siteId=${w.siteB}`);
      expect(bySite.statusCode).toBe(!allowed ? 403 : siteScoped(a, flag) ? 404 : 200);
    });
  });

  // ── Writes (run after the read matrix: they add rows) ──────────────────────
  describe('writes by site-limited actors', () => {
    const consultant = () => w.users['consultant']!;
    const supervisor = () => w.users['site_supervisor']!;
    const issue = (siteId?: string) => req(consultant(), 'POST', `${P()}/instructions`, {
      type: 'instruction', title: 'new', issuedDate: '2026-04-10', ...(siteId && { siteId }),
    });

    it('consultant issues instructions only for their site or project-level (other site → 404 when on)', async () => {
      expect((await issue(w.siteB)).statusCode).toBe(flag ? 404 : 201);
      expect((await issue(w.siteA)).statusCode).toBe(201);
      expect((await issue()).statusCode).toBe(201);
    });

    it('consultant may still update an instruction they issued on another site', async () => {
      const res = await req(consultant(), 'PATCH', `${P()}/instructions/${w.instrBbyConsultant}`, { title: 'edited' });
      expect(res.statusCode).toBe(200);
    });

    it('consultant cannot move their instruction to another site when on', async () => {
      const res = await req(consultant(), 'PATCH', `${P()}/instructions/${w.instrAbyConsultant}`, { siteId: w.siteB });
      expect(res.statusCode).toBe(flag ? 404 : 200);
    });

    it('supervisor status update on another site\'s instruction', async () => {
      const res = await req(supervisor(), 'PATCH', `${P()}/instructions/${w.instrB}`, { status: 'acknowledged' });
      expect(res.statusCode).toBe(flag ? 404 : 200);
    });

    it('consultant comments on another site\'s drawing (404 when on); project-level drawing always allowed', async () => {
      const revisionP = await prisma.drawingRevision.create({
        data: {
          drawingId: w.drawingP, companyId: w.admin.companyId, revisionNumber: 'A', fileUrl: '/uploads/drawings/x.pdf',
          fileKey: `drawings/site-scope-unused-${randomUUID()}.pdf`, fileName: 'x.pdf', fileSizeBytes: 1,
          fileType: 'application/pdf', status: 'draft', uploadedById: w.admin.id,
        },
      });
      const onB = await req(consultant(), 'POST', `${P()}/drawings/${w.drawingB}/revisions/${w.revisionB}/comments`, { text: 'x' });
      expect(onB.statusCode).toBe(flag ? 404 : 201);
      const onP = await req(consultant(), 'POST', `${P()}/drawings/${w.drawingP}/revisions/${revisionP.id}/comments`, { text: 'y' });
      expect(onP.statusCode).toBe(201);
    });

    it('consultant attaches files only to instructions they can see', async () => {
      const file = buildMultipartFile('note.pdf', 'application/pdf', Buffer.from('%PDF-1.4 site scope'));
      const res = await app.inject({
        method: 'POST', url: `${P()}/instructions/${w.instrB}/attachments`,
        headers: { authorization: `Bearer ${consultant().accessToken}`, ...file.headers },
        payload: file.body,
      });
      expect(res.statusCode).toBe(flag ? 404 : 201);
      if (res.statusCode === 201) {
        writtenFiles.push(path.join(UPLOAD_DIR, res.json().attachment.fileKey));
      }
    });

    it('project manager with a site-A membership stays project-wide', async () => {
      const pm = w.users['project_manager']!;
      const res = await req(pm, 'POST', `${P()}/instructions`, {
        type: 'instruction', title: 'pm', issuedDate: '2026-04-10', siteId: w.siteB,
      });
      expect(res.statusCode).toBe(201);
    });
  });
});
