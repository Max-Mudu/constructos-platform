// Creates the test data the role flows (04, 05) and the operational flows
// (06 to 10) read, through the API on this runner, signed in as the company
// admin start-backend.sh registered:
//   - a project manager and a site supervisor on the default project and site,
//     with the same generated password as the admin;
//   - a worker assigned to the site, with a labour entry for today;
//   - an accepted delivery (which also creates an inventory item);
//   - a contractor and a schedule task planned for today;
//   - a second worker with no labour entry (the offline-queue flow records one);
//   - a drawing with one revision whose PDF is generated here, in memory (no
//     binary file is kept in the repository).
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
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';
const API = `${ORIGIN}/api/v1`;

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

// The names the flows assert. Keep in step with maestro/04-*.yaml to 10-*.yaml.
const FIXTURE = {
  pm:         { firstName: 'Pendo', lastName: 'Manager' },
  supervisor: { firstName: 'Sefu',  lastName: 'Supervisor' },
  worker:     { firstName: 'Wanjiru', lastName: 'Kamau', trade: 'Mason' },
  supplier:   'Bamburi Cement Ltd',
  material:   'Cement 50kg bags',
  contractor: 'Ndovu Builders',
  task:       'Pour ground floor slab',
  offlineWorker: { firstName: 'Otieno', lastName: 'Offline', trade: 'Carpenter' },
  drawing:    { drawingNumber: 'CI-A-001', title: 'Ground floor plan', discipline: 'Architectural', revisionNumber: 'A' },
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

// A one-page PDF built from text, so the drawing flow has a real file to open.
// The app treats a download under 1000 bytes as an error page, hence the
// filler lines (comments inside the page's content stream). ASCII only, so
// string offsets are byte offsets.
function makePdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 72 ${760 - i * 28} Td (${esc(l)}) Tj ET`).join('\n');
  const filler = Array.from({ length: 16 }, (_, i) =>
    `% ConstructOS iOS CI drawing fixture, filler line ${String(i + 1).padStart(2, '0')} ..............................`).join('\n');
  const stream = `${text}\n${filler}`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
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

  // Second worker: assigned to the site, deliberately without a labour entry.
  const { worker: offlineWorker } = await call('POST', '/workers', {
    token: admin, expect: 201, what: 'Create second worker (offline-queue flow)',
    body: { ...FIXTURE.offlineWorker, dailyWage: 1800, currency: 'KES' },
  });
  await call('POST', `${site}/workers`, {
    token: admin, expect: 201, what: 'Assign second worker to the site', body: { workerId: offlineWorker.id },
  });

  // Drawing with one revision. The text fields go before the file: the API
  // reads them from the parts that precede it.
  const { drawing } = await call('POST', `/projects/${projectId}/drawings`, {
    token: admin, expect: 201, what: 'Create drawing',
    body: {
      drawingNumber: FIXTURE.drawing.drawingNumber, title: FIXTURE.drawing.title,
      discipline: FIXTURE.drawing.discipline, siteId,
    },
  });
  const pdf = makePdf([
    `${FIXTURE.drawing.drawingNumber}  ${FIXTURE.drawing.title}`,
    `Revision ${FIXTURE.drawing.revisionNumber}, issued for construction`,
    `Generated on the CI runner on ${today} for the iOS simulator flows.`,
  ]);
  const form = new FormData();
  form.append('revisionNumber', FIXTURE.drawing.revisionNumber);
  form.append('status', 'issued_for_construction');
  form.append('issueDate', today);
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ci-a-001-rev-a.pdf');
  const up = await fetch(`${API}/projects/${projectId}/drawings/${drawing.id}/revisions`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form,
  });
  console.log(`Upload drawing revision (generated PDF, ${pdf.length} bytes): HTTP ${up.status}`);
  if (up.status !== 201) {
    let code = '';
    try { code = (await up.json())?.code ?? ''; } catch { /* not JSON */ }
    throw new Error(`Upload drawing revision: expected HTTP 201, got ${up.status} ${code}`);
  }
  const { revision } = await up.json();
  // The file as the app will download it: same URL rule as projects.tsx
  // (uploads are served from the server origin, not under /api/v1).
  const fileUrl = revision.fileUrl.startsWith('http') ? revision.fileUrl : `${ORIGIN}${revision.fileUrl}`;
  const dl = await fetch(fileUrl, { headers: { Authorization: `Bearer ${admin}` } });
  const stored = Buffer.from(await dl.arrayBuffer());
  const isPdf = stored.subarray(0, 4).toString('latin1') === '%PDF';
  console.log(`Download drawing PDF: HTTP ${dl.status}, ${stored.length} bytes, starts with %PDF: ${isPdf}`);
  if (dl.status !== 200 || stored.length !== pdf.length || !isPdf || stored.length < 1000) {
    throw new Error('The stored drawing PDF does not match the generated one');
  }
  const anon = await fetch(fileUrl);
  console.log(`Download drawing PDF without a session: HTTP ${anon.status}`);
  if (anon.status !== 401) throw new Error(`Drawing PDF without a session: expected HTTP 401, got ${anon.status}`);

  appendFileSync(credFile, `PM_EMAIL=${pmEmail}\nSUP_EMAIL=${supEmail}\n`);
  writeFileSync(fixtureOut, JSON.stringify({
    projectId, siteId, workerId: worker.id, offlineWorkerId: offlineWorker.id, drawingId: drawing.id,
    date: today, ...FIXTURE,
  }, null, 2));
  console.log(`Fixture ready: ${pmEmail}, ${supEmail}, date ${today}`);
}

main().catch((err) => {
  console.error(`::error::Fixture setup failed: ${err.message}`);
  process.exitCode = 1;
});
