import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
  createTestLabourEntry,
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

const URL = (pid: string, sid: string, eid: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/labour/${eid}`;

async function setup(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  const worker  = await createTestWorker(company.id);
  await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
  const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);
  return { company, admin, project, site, worker, entry };
}

describe('labour entry currency is fixed after creation', () => {
  it('refuses a different currency from a finance-authorised caller and changes nothing', async () => {
    const { admin, project, site, entry } = await setup('lb-cur-1');
    const res = await app.inject({
      method: 'PATCH',
      url: URL(project.id, site.id, entry.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { currency: 'KES', dailyRate: 2000, hoursWorked: 6 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/currency/i);

    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.currency).toBe('USD');
    expect(row.dailyRate.toString()).toBe('1500');
    expect(row.hoursWorked.toString()).toBe('8');
  });

  it('accepts the same currency alongside a rate change', async () => {
    const { admin, project, site, entry } = await setup('lb-cur-2');
    const res = await app.inject({
      method: 'PATCH',
      url: URL(project.id, site.id, entry.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { currency: 'USD', dailyRate: 1750 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.currency).toBe('USD');
    expect(row.dailyRate.toString()).toBe('1750');
  });

  it('a rate change without a currency keeps the stored currency', async () => {
    const { admin, project, site, entry } = await setup('lb-cur-3');
    const res = await app.inject({
      method: 'PATCH',
      url: URL(project.id, site.id, entry.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { dailyRate: 1600 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.currency).toBe('USD');
    expect(row.dailyRate.toString()).toBe('1600');
  });

  it('a non-finance caller is unchanged: currency and rate are ignored, other edits apply', async () => {
    const { company, project, site, entry } = await setup('lb-cur-4');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-cur4');
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const res = await app.inject({
      method: 'PATCH',
      url: URL(project.id, site.id, entry.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { currency: 'KES', dailyRate: 9999, hoursWorked: 5 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.currency).toBe('USD');
    expect(row.dailyRate.toString()).toBe('1500');
    expect(row.hoursWorked.toString()).toBe('5');
  });
});
