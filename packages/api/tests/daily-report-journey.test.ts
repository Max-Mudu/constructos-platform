/**
 * Daily Site Report V1 — end-to-end journey through the real HTTP API with the
 * real modules wired together: sharp photo normalisation, the local private
 * storage driver + signed file route, and the real PDF renderer. AI is the
 * deterministic fake provider loaded with a realistic draft (no network).
 *
 * draft → notes → AI draft → photos → review/edit → finalise → PDF →
 * share/download → history → reopen → re-finalise (revision 0 immutable),
 * plus the manual path when AI is unavailable. All data is synthetic.
 */
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { LocalStorageDriver } from '../src/services/storage/local';
import { FakeReportExtractor } from '../src/services/daily-report/extractor/fake';
import { SECTION_KEYS } from '../src/services/daily-report/content.schema';
import { todayInTimeZone } from '../src/services/daily-report/daily-report.service';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany,
  createTestProject, createTestSite, createTestUser, TestUser,
} from './helpers/fixtures';

// Sample output for manual review (outside the repo).
const SAMPLE_DIR = process.env['DAILY_REPORT_SAMPLE_DIR'];

const NOTES =
  'Today we had 27 workers. Ten steel fixers, eight carpenters and nine general labourers. ' +
  'We completed reinforcement on the first-floor slab and poured 43 cubic metres of C30 concrete. ' +
  'The concrete pump arrived 45 minutes late. Rain stopped work for another hour. ' +
  'There were no safety incidents. Tomorrow we start blockwork.';

const AI_DRAFT = {
  weather: { conditions: ['cloudy', 'light_rain'], workStoppedByWeather: true, notes: 'Rain stopped work for about an hour.' },
  manpower: {
    entries: [
      { trade: 'Steel fixer', count: 10, employer: 'Own staff' },
      { trade: 'Carpenter', count: 8, employer: 'Own staff' },
      { trade: 'General labourer', count: 9, employer: 'Own staff' },
    ],
    totalOnSite: 27,
  },
  workCompleted: [
    { description: 'Completed reinforcement to the first-floor slab', location: 'First-floor slab' },
    { description: 'Poured C30 concrete to the first-floor slab', location: 'First-floor slab', quantity: 43, unit: 'm³' },
  ],
  delays: [
    { cause: 'equipment_breakdown', description: 'Concrete pump arrived 45 minutes late' },
    { cause: 'weather', description: 'Rain stopped work', hoursLost: 1 },
  ],
  safety: { incidentsReported: false, notes: 'No safety incidents.' },
  materialsDeliveries: [{ material: 'C30 ready-mix concrete', quantity: 43, unit: 'm³' }],
  tomorrowPlan: [{ description: 'Start blockwork' }],
};

const OPERATIONAL_TABLES = [
  'labourEntry', 'attendanceRecord', 'inventoryTransaction', 'siteInventory',
  'deliveryRecord', 'invoice', 'budgetLineItem', 'scheduleTask',
] as const;

const storage = new LocalStorageDriver(); // same root as the signed-file route's driver
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ storage, reportExtractor: new FakeReportExtractor(AI_DRAFT as never) });
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });

async function sitePhoto(label: string, colour: string, withGps = false): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="2400" height="1800" xmlns="http://www.w3.org/2000/svg">
      <rect width="2400" height="1800" fill="${colour}"/>
      <rect x="200" y="900" width="2000" height="600" fill="#6b6b6b"/>
      <rect x="200" y="860" width="2000" height="40" fill="#3d3d3d"/>
      <text x="1200" y="500" font-size="140" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${label}</text>
    </svg>`,
  );
  let img = sharp(svg).jpeg({ quality: 90 });
  if (withGps) {
    img = img.withExif({ IFD0: { Make: 'SyntheticCam' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 17/1 30/1' } });
  }
  return img.toBuffer();
}

async function logoPng(): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="480" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="160" rx="24" fill="#121826"/>
      <text x="80" y="108" font-size="84" text-anchor="middle" fill="#D9A441" font-family="sans-serif" font-weight="bold">MB</text>
      <text x="190" y="105" font-size="56" fill="#111827" font-family="sans-serif" font-weight="bold">Mwangaza</text>
    </svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function world() {
  const { company, admin } = await createTestCompany(app, 'journey');
  await prisma.company.update({ where: { id: company.id }, data: { name: 'Mwangaza Builders Ltd', timezone: 'Africa/Nairobi' } });
  const project = await createTestProject(company.id, 'Kilimani Apartments – Phase 2');
  const site = await createTestSite(company.id, project.id, 'Block B');
  const otherSite = await createTestSite(company.id, project.id, 'Block C');
  const supervisor = await createTestUser(app, company.id, 'site_supervisor', 'journey-sup');
  await prisma.user.update({ where: { id: supervisor.id }, data: { firstName: 'Peter', lastName: 'Otieno' } });
  await assignUserToProject(company.id, project.id, supervisor.id, site.id);
  const pm = await createTestUser(app, company.id, 'project_manager', 'journey-pm');
  await prisma.user.update({ where: { id: pm.id }, data: { firstName: 'Grace', lastName: 'Wanjiru' } });
  await assignUserToProject(company.id, project.id, pm.id);
  const viewer = await createTestUser(app, company.id, 'viewer', 'journey-viewer');
  await assignUserToProject(company.id, project.id, viewer.id);
  const otherSupervisor = await createTestUser(app, company.id, 'site_supervisor', 'journey-sup2');
  await assignUserToProject(company.id, project.id, otherSupervisor.id, otherSite.id);
  const outsider = await createTestCompany(app, 'journey-outsider');

  const logoKey = `companies/${company.id}/logo/journey-logo.png`;
  await storage.put(logoKey, await logoPng(), { contentType: 'image/png' });
  await prisma.company.update({ where: { id: company.id }, data: { logoKey } });

  return { company, admin, project, site, supervisor, pm, viewer, otherSupervisor, outsider: outsider.admin,
    base: `/api/v1/projects/${project.id}/sites/${site.id}/daily-reports` };
}

async function operationalCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of OPERATIONAL_TABLES) {
    counts[t] = await (prisma[t] as unknown as { count: () => Promise<number> }).count();
  }
  return counts;
}

describe('Daily Site Report — complete journey', () => {
  it('supervisor captures, reviews, finalises and shares a professional report; history and revisions stay intact', async () => {
    const w = await world();
    const before = await operationalCounts();
    const today = todayInTimeZone('Africa/Nairobi');

    // 1. Open today's draft
    const created = await app.inject({ method: 'POST', url: w.base, headers: auth(w.supervisor), payload: { reportDate: today } });
    expect(created.statusCode).toBe(201);
    let report = created.json().report;
    expect(report.status).toBe('draft');
    expect(report.displayNumber).toBe('DR-0001');

    // 2. Notes (typed or dictated on the phone keyboard)
    let res = await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
      payload: { rawInput: NOTES, expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(200);
    report = res.json().report;

    // 3. AI draft — written only to aiDraft, never to content
    res = await app.inject({ method: 'POST', url: `${w.base}/${report.id}/extract`, headers: auth(w.supervisor), payload: {} });
    expect(res.statusCode).toBe(200);
    report = res.json().report;
    expect(report.extractionStatus).toBe('succeeded');
    expect(report.aiDraft.draft.manpower.totalOnSite).toBe(27);
    expect(report.content.reviewedSections).toEqual([]);
    expect(report.content.workCompleted).toEqual([]);
    expect(report.rawInput).toBe(NOTES);

    // 4. Photos — one carries GPS EXIF that must not survive
    const shots: Array<[string, string, boolean, string]> = [
      ['Slab reinforcement', '#8a9bb0', true,  'First-floor slab reinforcement complete before the pour'],
      ['C30 pour', '#9aa58c', false, 'Pouring 43 m³ of C30 concrete to the first-floor slab'],
      ['Concrete pump', '#b0a08a', false, 'Concrete pump on arrival, 45 minutes late'],
      ['Rain delay', '#7f8c99', false, 'Site during the afternoon rain stoppage'],
    ];
    const photoIds: string[] = [];
    for (const [label, colour, gps, caption] of shots) {
      const file = buildMultipartFile(`${label}.jpg`, 'image/jpeg', await sitePhoto(label, colour, gps));
      const up = await app.inject({ method: 'POST', url: `${w.base}/${report.id}/photos`,
        headers: { ...auth(w.supervisor), ...file.headers }, payload: file.body });
      expect(up.statusCode).toBe(201);
      const photo = up.json().photo;
      photoIds.push(photo.id);
      const cap = await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}/photos/${photo.id}`,
        headers: auth(w.supervisor), payload: { caption } });
      expect(cap.statusCode).toBe(200);
    }
    const stored = await prisma.dailyReportPhoto.findMany({ where: { dailyReportId: report.id }, orderBy: { sortOrder: 'asc' } });
    expect(stored).toHaveLength(4);
    for (const p of stored) {
      const bytes = await storage.get(p.fileKey);
      const meta = await sharp(bytes!).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();          // GPS and all EXIF stripped
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
    }

    // 5. Private photo access: the signed URL works, a tampered one does not
    res = await app.inject({ method: 'GET', url: `${w.base}/${report.id}`, headers: auth(w.supervisor) });
    report = res.json().report;
    expect(report.photos).toHaveLength(4);
    const signed = report.photos[0].url as string;
    expect(signed).toMatch(/^\/api\/v1\/files\/signed\?/);
    const img = await app.inject({ method: 'GET', url: signed });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const tampered = await app.inject({ method: 'GET', url: signed.replace(/s=[^&]+/, 's=AAAA') });
    expect(tampered.statusCode).toBe(404);

    // 6. Human review: accept the AI draft, correct one number, tick every section
    const reviewed = {
      ...report.aiDraft.draft,
      delays: [
        { ...report.aiDraft.draft.delays[0], hoursLost: 0.75 },
        report.aiDraft.draft.delays[1],
      ],
      remarks: 'Pour completed before the rain. Curing started; slab to be kept wet for 7 days.',
      reviewedSections: [...SECTION_KEYS],
    };
    res = await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
      payload: { content: reviewed, expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(200);
    report = res.json().report;

    // 7. Finalise → PDF
    res = await app.inject({ method: 'POST', url: `${w.base}/${report.id}/finalise`, headers: auth(w.supervisor),
      payload: { expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(200);
    report = res.json().report;
    expect(report.status).toBe('final');
    expect(report.revision).toBe(0);

    const pdf0 = await app.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf`, headers: auth(w.supervisor) });
    expect(pdf0.statusCode).toBe(200);
    expect(pdf0.headers['content-type']).toBe('application/pdf');
    expect(String(pdf0.headers['content-disposition'])).toContain('DR-0001-rev0.pdf');
    expect(pdf0.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    if (SAMPLE_DIR) await fs.writeFile(path.join(SAMPLE_DIR, 'journey-DR-0001-rev0.pdf'), pdf0.rawPayload);

    // 8. Final is locked; a viewer can read and download but not edit or see draft inputs
    res = await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
      payload: { rawInput: 'late edit', expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(409);
    res = await app.inject({ method: 'GET', url: `${w.base}/${report.id}`, headers: auth(w.viewer) });
    expect(res.statusCode).toBe(200);
    expect(res.json().report.rawInput).toBeUndefined();
    expect(res.json().report.aiDraft).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf`, headers: auth(w.viewer) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.viewer),
      payload: { rawInput: 'x', expectedUpdatedAt: report.updatedAt } })).statusCode).toBe(403);

    // 9. Project/site and tenant boundaries
    expect((await app.inject({ method: 'GET', url: `${w.base}/${report.id}`, headers: auth(w.otherSupervisor) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf`, headers: auth(w.outsider) })).statusCode).toBe(404);

    // 10. Correction: PM reopens, supervisor amends, re-finalise → revision 1; revision 0 PDF unchanged
    res = await app.inject({ method: 'POST', url: `${w.base}/${report.id}/reopen`, headers: auth(w.pm),
      payload: { reason: 'Add toolbox talk topic', expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(200);
    report = res.json().report;
    expect(report.status).toBe('draft');
    expect(report.revision).toBe(1);
    res = await app.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
      payload: { content: { ...report.content, safety: { ...report.content.safety, toolboxTalk: 'Working at height on slab edges' } },
        expectedUpdatedAt: report.updatedAt } });
    report = res.json().report;
    res = await app.inject({ method: 'POST', url: `${w.base}/${report.id}/finalise`, headers: auth(w.supervisor),
      payload: { expectedUpdatedAt: report.updatedAt } });
    expect(res.statusCode).toBe(200);
    report = res.json().report;
    expect(report.revision).toBe(1);
    expect(report.revisions.map((r: { revision: number }) => r.revision).sort()).toEqual([0, 1]);

    const rev0Again = await app.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf?revision=0`, headers: auth(w.pm) });
    expect(Buffer.compare(rev0Again.rawPayload, pdf0.rawPayload)).toBe(0);
    const pdf1 = await app.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf?revision=1`, headers: auth(w.pm) });
    expect(pdf1.statusCode).toBe(200);
    expect(Buffer.compare(pdf1.rawPayload, pdf0.rawPayload)).not.toBe(0);
    if (SAMPLE_DIR) await fs.writeFile(path.join(SAMPLE_DIR, 'journey-DR-0001-rev1.pdf'), pdf1.rawPayload);

    // 11. History for the site
    res = await app.inject({ method: 'GET', url: w.base, headers: auth(w.supervisor) });
    const history = res.json().reports;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ displayNumber: 'DR-0001', status: 'final', revision: 1, photoCount: 4 });

    // 12. No money anywhere; AI never touched operational records
    const all = JSON.stringify(report).toLowerCase();
    for (const word of ['dailyrate', 'dailywage', 'wage', '"rate"', 'cost', 'amount']) expect(all).not.toContain(word);
    expect(await operationalCounts()).toEqual(before);
  });

  it('manual reporting still works end to end when AI is unavailable', async () => {
    const manualApp = await buildApp({ storage, reportExtractor: new FakeReportExtractor('AI_UNAVAILABLE') });
    await manualApp.ready();
    try {
      const w = await world();
      const created = await manualApp.inject({ method: 'POST', url: w.base, headers: auth(w.supervisor),
        payload: { reportDate: todayInTimeZone('Africa/Nairobi') } });
      let report = created.json().report;
      let res = await manualApp.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
        payload: { rawInput: NOTES, expectedUpdatedAt: report.updatedAt } });
      report = res.json().report;

      res = await manualApp.inject({ method: 'POST', url: `${w.base}/${report.id}/extract`, headers: auth(w.supervisor), payload: {} });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('AI_UNAVAILABLE');

      res = await manualApp.inject({ method: 'GET', url: `${w.base}/${report.id}`, headers: auth(w.supervisor) });
      report = res.json().report;
      expect(report.rawInput).toBe(NOTES);          // notes preserved
      expect(report.extractionStatus).toBe('failed');
      expect(report.status).toBe('draft');          // never auto-finalised

      const manual = {
        ...report.content,
        manpower: { entries: [{ trade: 'Mason', count: 6, employer: 'Own staff', notes: '' }], totalOnSite: 6, notes: '' },
        workCompleted: [{ description: 'Blockwork to ground-floor partitions', location: 'Ground floor', quantity: null, unit: '', progressPercent: null }],
        reviewedSections: [...SECTION_KEYS],
      };
      res = await manualApp.inject({ method: 'PATCH', url: `${w.base}/${report.id}`, headers: auth(w.supervisor),
        payload: { content: manual, expectedUpdatedAt: report.updatedAt } });
      report = res.json().report;
      res = await manualApp.inject({ method: 'POST', url: `${w.base}/${report.id}/finalise`, headers: auth(w.supervisor),
        payload: { expectedUpdatedAt: report.updatedAt } });
      expect(res.statusCode).toBe(200);
      expect(res.json().report.status).toBe('final');
      const pdf = await manualApp.inject({ method: 'GET', url: `${w.base}/${report.id}/pdf`, headers: auth(w.supervisor) });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await manualApp.close();
    }
  });
});
