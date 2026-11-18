// Creates the test data the role flows (04, 05) read, through the API on this
// runner, signed in as the company admin start-backend.sh registered:
//   - a project manager and a site supervisor on the default project and site,
//     with the same generated password as the admin;
//   - a worker assigned to the site, with a labour entry for today;
//   - an accepted delivery (which also creates an inventory item);
//   - a contractor and a schedule task planned for today.
// Prints only HTTP statuses and record kinds, never response bodies, tokens or
// passwords. Exits non-zero on the first unexpected status.
//
// Usage: node seed-fixture.mjs <credentials file> <fixture json out>
// Env:   API_ORIGIN (default http://localhost:3001)
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const [credFile, fixtureOut] = process.argv.slice(2);
if (!credFile || !fixtureOut) {
  console.error('usage: node seed-fixture.mjs <credentials file> <fixture json out>');
  process.exit(2);
}
const API = `${process.env.API_ORIGIN ?? 'http://localhost:3001'}/api/v1`;

const creds = Object.fromEntries(
  readFileSync(credFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const { SMOKE_EMAIL, SMOKE_PASSWORD } = creds;
if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
  console.error('SMOKE_EMAIL / SMOKE_PASSWORD missing from the credentials file');
  process.exit(2);
}

// The names the flows assert. Keep in step with maestro/04-*.yaml and 05-*.yaml.
const FIXTURE = {
  pm:         { firstName: 'Pendo', lastName: 'Manager' },
  supervisor: { firstName: 'Sefu',  lastName: 'Supervisor' },
  worker:     { firstName: 'Wanjiru', lastName: 'Kamau', trade: 'Mason' },
  supplier:   'Bamburi Cement Ltd',
  material:   'Cement 50kg bags',
  contractor: 'Ndovu Builders',
  task:       'Pour ground floor slab',
};

const today = new Date().toISOString().slice(0, 10);
const tag = (SMOKE_EMAIL.split('@')[0] ?? 'ios-ci').replace(/[^a-z0-9-]/gi, '');

async function call(method, path, { token, body, expect, what }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  console.log(`${what}: HTTP ${res.status}`);
  if (res.status !== expect) {
    // The error code only (never the body, which can echo input).
    let code = '';
    try { code = (await res.json())?.code ?? ''; } catch { /* not JSON */ }
    throw new Error(`${what}: expected HTTP ${expect}, got ${res.status} ${code}`);
  }
  return res.status === 204 ? null : res.json();
}

async function login(email, password, what) {
  const r = await call('POST', '/auth/login', { body: { email, password }, expect: 200, what });
  return r.accessToken;
}

async function createRoleUser(admin, role, person, projectId, siteId) {
  const email = `${tag}-${role.replace('_', '-')}@example.com`;
  const r = await call('POST', '/companies/me/users', {
    token: admin, expect: 201, what: `Create ${role} user`,
    body: { email, role, ...person, defaultProjectId: projectId, defaultSiteId: siteId },
  });
  // Outside production the API returns the one-time setup link; use it to set
  // the password exactly as the web reset page would.
  const setupToken = r.setupLink ? new URL(r.setupLink).searchParams.get('token') : null;
  if (!setupToken) throw new Error(`Create ${role} user: no setup link in the response`);
  await call('POST', '/auth/reset-password', {
    expect: 200, what: `Set ${role} password through the setup link`,
    body: { token: setupToken, password: SMOKE_PASSWORD },
  });
  await login(email, SMOKE_PASSWORD, `API login as ${role}`);
  return email;
}

async function main() {
  const admin = await login(SMOKE_EMAIL, SMOKE_PASSWORD, 'API login as company admin');
  const { user } = await call('GET', '/auth/me', { token: admin, expect: 200, what: 'Admin profile' });
  const projectId = user.defaultProjectId;
  const siteId = user.defaultSiteId;
  if (!projectId || !siteId) throw new Error('The registered admin has no default project and site');
  const site = `/projects/${projectId}/sites/${siteId}`;

  const pmEmail  = await createRoleUser(admin, 'project_manager', FIXTURE.pm, projectId, siteId);
  const supEmail = await createRoleUser(admin, 'site_supervisor', FIXTURE.supervisor, projectId, siteId);

  const { worker } = await call('POST', '/workers', {
    token: admin, expect: 201, what: 'Create worker',
    body: { ...FIXTURE.worker, dailyWage: 1500, currency: 'KES' },
  });
  await call('POST', `${site}/workers`, {
    token: admin, expect: 201, what: 'Assign worker to the site', body: { workerId: worker.id },
  });
  await call('POST', `${site}/labour`, {
    token: admin, expect: 201, what: 'Create labour entry for today',
    body: { workerId: worker.id, date: today, hoursWorked: 8 },
  });

  await call('POST', `${site}/deliveries`, {
    token: admin, expect: 201, what: 'Create accepted delivery',
    body: {
      supplierName: FIXTURE.supplier, deliveryDate: today, itemDescription: FIXTURE.material,
      unitOfMeasure: 'bags', quantityOrdered: 100, quantityDelivered: 100,
      conditionOnArrival: 'good', acceptanceStatus: 'accepted', receivedById: user.id,
    },
  });
  const inv = await call('GET', `${site}/inventory`, { token: admin, expect: 200, what: 'List inventory' });
  const items = Array.isArray(inv) ? inv : (inv.items ?? inv.inventory ?? []);
  if (!items.some((i) => i.materialName === FIXTURE.material)) {
    throw new Error('The accepted delivery did not create an inventory item');
  }
  console.log('Inventory item from the accepted delivery: present');

  const { contractor } = await call('POST', '/contractors', {
    token: admin, expect: 201, what: 'Create contractor', body: { name: FIXTURE.contractor },
  });
  await call('POST', `${site}/schedule/tasks`, {
    token: admin, expect: 201, what: 'Create schedule task for today',
    body: { contractorId: contractor.id, title: FIXTURE.task, plannedStartDate: today, plannedEndDate: today },
  });

  appendFileSync(credFile, `PM_EMAIL=${pmEmail}\nSUP_EMAIL=${supEmail}\n`);
  writeFileSync(fixtureOut, JSON.stringify({ projectId, siteId, workerId: worker.id, date: today, ...FIXTURE }, null, 2));
  console.log(`Fixture ready: ${pmEmail}, ${supEmail}, date ${today}`);
}

main().catch((err) => {
  console.error(`::error::Fixture setup failed: ${err.message}`);
  process.exitCode = 1;
});
