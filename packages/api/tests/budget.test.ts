import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  assignUserToProject,
  createTestBudget,
  createTestLineItem,
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

// ─── GET /budgets — list ──────────────────────────────────────────────────────

describe('GET /budgets', () => {
  it('admin can list all budgets in company', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-list-1');
    const p1 = await createTestProject(company.id, 'Project 1');
    const p2 = await createTestProject(company.id, 'Project 2');
    await createTestBudget(company.id, p1.id);
    await createTestBudget(company.id, p2.id);

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().budgets).toHaveLength(2);
  });

  it('can filter by project', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-list-2');
    const p1 = await createTestProject(company.id, 'Project 1');
    const p2 = await createTestProject(company.id, 'Project 2');
    await createTestBudget(company.id, p1.id);
    await createTestBudget(company.id, p2.id);

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/budgets?projectId=${p1.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().budgets).toHaveLength(1);
    expect(res.json().budgets[0].projectId).toBe(p1.id);
  });

  it('project_manager sees only their projects\' budgets', async () => {
    const { company } = await createTestCompany(app, 'bgt-list-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'bgt-list-3-pm');
    const p1 = await createTestProject(company.id, 'PM Project');
    const p2 = await createTestProject(company.id, 'Other Project');
    await assignUserToProject(company.id, p1.id, pm.id);
    await createTestBudget(company.id, p1.id);
    await createTestBudget(company.id, p2.id);

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().budgets).toHaveLength(1);
    expect(res.json().budgets[0].projectId).toBe(p1.id);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/budgets' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /budgets — create ───────────────────────────────────────────────────

describe('POST /budgets', () => {
  it('admin can create a budget', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-create-1');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name: 'Phase 1 Budget', currency: 'USD' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().budget.name).toBe('Phase 1 Budget');
    expect(res.json().budget.status).toBe('draft');
    expect(res.json().budget.currency).toBe('USD');
  });

  it('project_manager can create a budget for their project', async () => {
    const { company } = await createTestCompany(app, 'bgt-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'bgt-create-2-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name: 'PM Budget' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().budget.name).toBe('PM Budget');
  });

  it('contractor cannot create budgets', async () => {
    const { company } = await createTestCompany(app, 'bgt-create-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'bgt-create-3-c');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${contractor.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name: 'Hack' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('duplicate budget for same project is rejected', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-create-4');
    const project = await createTestProject(company.id);
    await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name: 'Second Budget' }),
    });

    expect(res.statusCode).toBe(409);
  });

  it('validates required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-create-5');

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No project' }),
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── GET /budgets/:budgetId — detail ──────────────────────────────────────────

describe('GET /budgets/:budgetId', () => {
  it('returns budget with summary and line items', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-get-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id, { name: 'Detail Budget' });
    await createTestLineItem(budget.id, company.id, project.id, { category: 'labour', budgetedAmount: 50000, actualSpend: 15000 });
    await createTestLineItem(budget.id, company.id, project.id, { category: 'materials', budgetedAmount: 30000, actualSpend: 10000 });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { budget: b, summary } = res.json();
    expect(b.name).toBe('Detail Budget');
    expect(b.lineItems).toHaveLength(2);
    expect(summary.totalBudgeted).toBe(80000);
    expect(summary.totalSpent).toBe(25000);
    expect(summary.totalRemaining).toBe(55000);
    expect(summary.overspend).toBe(false);
    expect(summary.categories).toHaveProperty('labour');
    expect(summary.categories).toHaveProperty('materials');
  });

  it('returns 404 for non-existent budget', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-get-2');

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/budgets/non-existent-id',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('summary flags overspend correctly', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-get-3');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 10000, actualSpend: 12000 });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary.overspend).toBe(true);
    expect(res.json().summary.variance).toBe(-2000);
  });
});

// ─── PATCH /budgets/:budgetId — update ────────────────────────────────────────

describe('PATCH /budgets/:budgetId', () => {
  it('admin can update budget name', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-update-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id, { name: 'Old Name' });

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().budget.name).toBe('Updated Name');
  });

  it('consultant cannot update budget', async () => {
    const { company } = await createTestCompany(app, 'bgt-update-2');
    const consultant = await createTestUser(app, company.id, 'consultant', 'bgt-update-2-c');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${consultant.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /budgets/:budgetId/approve ──────────────────────────────────────────

describe('POST /budgets/:budgetId/approve', () => {
  it('finance_officer can approve a budget', async () => {
    const { company } = await createTestCompany(app, 'bgt-approve-1');
    const fo = await createTestUser(app, company.id, 'finance_officer', 'bgt-approve-1-fo', { canViewFinance: true });
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/approve`,
      headers: { authorization: `Bearer ${fo.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().budget.status).toBe('approved');
    expect(res.json().budget.approvedBy).not.toBeNull();
  });

  it('project_manager cannot approve a budget', async () => {
    const { company } = await createTestCompany(app, 'bgt-approve-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'bgt-approve-2-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const budget = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/approve`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Line Items ───────────────────────────────────────────────────────────────

describe('POST /budgets/:budgetId/line-items', () => {
  it('admin can add a standard line item', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'materials',
        description: 'Portland cement bags',
        quantity: 500,
        unit: 'bags',
        unitRate: 25,
        budgetedAmount: 12500,
      }),
    });

    expect(res.statusCode).toBe(201);
    const li = res.json().lineItem;
    expect(li.category).toBe('materials');
    expect(Number(li.budgetedAmount)).toBe(12500);
    expect(li.consultantCostEntry).toBeNull();
    expect(li.marketingBudgetEntry).toBeNull();
  });

  it('admin can add a consultant line item with sub-entry', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-2');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'consultants',
        description: 'Structural engineer fee',
        budgetedAmount: 80000,
        consultant: {
          consultantType: 'engineer',
          consultantName: 'Jane Doe',
          firmName: 'Doe Engineering',
          feeAgreed: 80000,
          feePaid: 20000,
          feeOutstanding: 60000,
        },
      }),
    });

    expect(res.statusCode).toBe(201);
    const li = res.json().lineItem;
    expect(li.category).toBe('consultants');
    expect(li.consultantCostEntry).not.toBeNull();
    expect(li.consultantCostEntry.consultantName).toBe('Jane Doe');
    expect(li.consultantCostEntry.firmName).toBe('Doe Engineering');
    expect(Number(li.consultantCostEntry.feePaid)).toBe(20000);
  });

  it('admin can add a marketing line item with sub-entry', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-3');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'marketing',
        description: 'Launch campaign Q2',
        budgetedAmount: 15000,
        marketing: {
          campaignName: 'Q2 Launch',
          channel: 'digital',
          vendorAgency: 'Bright Agency',
          budgetedAmount: 15000,
          actualSpend: 5000,
          paidAmount: 5000,
          expectedRoi: '3x units sold',
        },
      }),
    });

    expect(res.statusCode).toBe(201);
    const li = res.json().lineItem;
    expect(li.category).toBe('marketing');
    expect(li.marketingBudgetEntry).not.toBeNull();
    expect(li.marketingBudgetEntry.campaignName).toBe('Q2 Launch');
    expect(li.marketingBudgetEntry.channel).toBe('digital');
    expect(Number(li.marketingBudgetEntry.actualSpend)).toBe(5000);
  });

  it('consultant category requires consultant sub-entry', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-4');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'consultants',
        description: 'Missing consultant details',
        budgetedAmount: 10000,
      }),
    });

    expect(res.statusCode).toBe(422);
  });

  it('validates required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-5');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Missing category and amount' }),
    });

    expect(res.statusCode).toBe(422);
  });
});

describe('PATCH /budgets/:budgetId/line-items/:lineItemId', () => {
  it('admin can update a line item', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-upd-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);
    const lineItem = await createTestLineItem(budget.id, company.id, project.id, {
      description: 'Old desc',
      budgetedAmount: 10000,
    });

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/budgets/${budget.id}/line-items/${lineItem.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Updated desc', actualSpend: 5000 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lineItem.description).toBe('Updated desc');
    expect(Number(res.json().lineItem.actualSpend)).toBe(5000);
  });
});

describe('DELETE /budgets/:budgetId/line-items/:lineItemId', () => {
  it('admin can delete a line item', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-li-del-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);
    const lineItem = await createTestLineItem(budget.id, company.id, project.id);

    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/v1/budgets/${budget.id}/line-items/${lineItem.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
  });
});

// ─── Variation Orders ─────────────────────────────────────────────────────────

describe('Variation orders', () => {
  it('PM can add a variation order', async () => {
    const { company } = await createTestCompany(app, 'bgt-var-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'bgt-var-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const budget = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/variations`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        referenceNumber: 'VO-001',
        description: 'Additional foundation depth',
        amount: 25000,
        direction: 'addition',
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().variation.referenceNumber).toBe('VO-001');
    expect(res.json().variation.status).toBe('pending');
    expect(Number(res.json().variation.amount)).toBe(25000);
  });

  it('admin can approve a variation', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-var-2');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    // Add variation first
    await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/variations`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ referenceNumber: 'VO-001', description: 'Extra work', amount: 5000 }),
    });

    const { budget: b } = (await app.inject({
      method: 'GET',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    })).json();

    const variationId = b.variationOrders[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/budgets/${budget.id}/variations/${variationId}`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().variation.status).toBe('approved');
  });

  it('validates required variation fields', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-var-3');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/variations`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Missing ref and amount' }),
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── DELETE /budgets/:budgetId ────────────────────────────────────────────────

describe('DELETE /budgets/:budgetId', () => {
  it('admin can delete a budget', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-del-1');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('project_manager cannot delete a budget', async () => {
    const { company } = await createTestCompany(app, 'bgt-del-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'bgt-del-2-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const budget = await createTestBudget(company.id, project.id);

    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/v1/budgets/${budget.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Audit logging ────────────────────────────────────────────────────────────

describe('Budget audit logging', () => {
  it('creates audit log on budget creation', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-audit-1');
    const project = await createTestProject(company.id);

    await app.inject({
      method: 'POST',
      url:    '/api/v1/budgets',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name: 'Audit Budget' }),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'budget', action: 'create' },
    });
    expect(log).not.toBeNull();
    expect(log?.userEmail).toBe(admin.email);
  });

  it('creates audit log on line item creation', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-audit-2');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/line-items`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'equipment', description: 'Crane rental', budgetedAmount: 50000 }),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'budget_line_item', action: 'create' },
    });
    expect(log).not.toBeNull();
  });

  it('creates audit log on budget approval', async () => {
    const { company, admin } = await createTestCompany(app, 'bgt-audit-3');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);

    await app.inject({
      method: 'POST',
      url:    `/api/v1/budgets/${budget.id}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'budget', action: 'update' },
    });
    expect(log).not.toBeNull();
  });
});
