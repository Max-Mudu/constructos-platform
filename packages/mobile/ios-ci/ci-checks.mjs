// API-side checks and small API actions for the flows 06 to 17.
// smoke.sh calls these between and after Maestro flows, so every write the app
// makes is confirmed through the API and not only on the screen.
// Prints HTTP statuses, counts and record kinds; never tokens, passwords or
// response bodies.
//
// Usage: node ci-checks.mjs <command> <credentials file> <fixture json> [--name value ...]
//   labour-count     --expect N [--wait S] [--hold S]      entries for the second worker today
//   create-delivery  --supplier NAME                        a pending delivery, created by the admin
//   delivery-check   --supplier NAME --expect N --photos N  deliveries with exactly that supplier name
//   upload-contract  --image FILE.jpg                       the photo upload the app would make
//   status-sequence  --log FILE --since ISO                 401, then refresh 200, then logout 200 (app requests)
//   served           --log FILE --since ISO --method M --path REGEX --status N|any [--ctype T] [--count N]
//   labour-usd-setup                                         a worker paid in USD with a 4-hour entry today
//   labour-cost-check --worker-first N --hours H --rate R --currency C --expect "KES=3000,USD=20"
//   delivery-acceptance-check --supplier N --accepted Q --material M --stock Q
//   ended-session-replay                                     signed-out token presented again: 401, others kept
//   reuse-replay                                             rotated token presented again: every session ends
//   reset-password                                           supervisor password reset (env NEW_PASSWORD)
//   refreshed        --log FILE --since ISO [--refused yes]  401 then refresh 200 (or refresh refused)
// Env: API_ORIGIN (default http://localhost:3001)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [command, credFile, fixtureFile, ...rest] = process.argv.slice(2);
if (!command || !credFile || !fixtureFile) {
  console.error('usage: node ci-checks.mjs <command> <credentials file> <fixture json> [--name value ...]');
  process.exit(2);
}
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];

const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';
const API = `${ORIGIN}/api/v1`;
const creds = Object.fromEntries(
  readFileSync(credFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const fx = JSON.parse(readFileSync(fixtureFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app's requests in the timing log (api-timing.cjs): everything that is
// not one of this runner's own tools (curl probes, the Node helpers).
const isApp = (client) => !/^(curl|node|unknown)$/.test(client ?? 'unknown');

async function login(email, what) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: creds.SMOKE_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`${what} login: HTTP ${res.status}`);
  return (await res.json()).accessToken;
}

// A session of the site supervisor made through the API (as a second phone
// would make it). The token pair stays in memory and is never printed.
async function apiSession(what) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.SUP_EMAIL, password: creds.SMOKE_PASSWORD }),
  });
  console.log(`Sign in ${what} through the API: HTTP ${res.status}`);
  if (res.status !== 200) throw new Error(`${what} login: HTTP ${res.status}`);
  const { accessToken, refreshToken } = await res.json();
  if (!accessToken || !refreshToken) throw new Error(`${what}: no token pair in the login answer`);
  return { accessToken, refreshToken };
}

// POST /auth/refresh. Returns the status, or with full=true the status and
// the new access token (kept in memory only).
async function refresh(refreshToken, full = false) {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!full) return res.status;
  const body = res.status === 200 ? await res.json() : {};
  return { status: res.status, accessToken: body.accessToken };
}

async function get(path, token, what) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw new Error(`${what}: HTTP ${res.status}`);
  return res.json();
}

function timingEvents(file, since) {
  const from = Date.parse(since);
  if (Number.isNaN(from)) throw new Error(`--since is not a date: ${since}`);
  return readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.ev === 'finish' && Date.parse(e.t) >= from);
}
const line = (e) => `${e.t} ${e.method} ${e.path} -> ${e.status}`;

const commands = {
  // The offline-queue flow records one labour entry for the second fixture
  // worker. --wait: how long to wait for the expected count; --hold: how long
  // the count must then stay the same (a duplicate would arrive in that time).
  async 'labour-count'() {
    const expect = Number(opt.expect);
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const who = `${fx.offlineWorker.firstName} ${fx.offlineWorker.lastName}`;
    const count = async () => {
      const q = `projectId=${fx.projectId}&siteId=${fx.siteId}&workerId=${fx.offlineWorkerId}&date=${fx.date}&limit=100`;
      const { entries } = await get(`/labour?${q}`, admin, 'labour list');
      return (entries ?? []).filter((e) => e.workerId === fx.offlineWorkerId).length;
    };
    const deadline = Date.now() + Number(opt.wait ?? 0) * 1000;
    let n = await count();
    while (n !== expect && Date.now() < deadline) { await sleep(2000); n = await count(); }
    if (n !== expect) throw new Error(`expected ${expect} labour entries for ${who} on ${fx.date}, found ${n}`);
    const holdUntil = Date.now() + Number(opt.hold ?? 0) * 1000;
    while (Date.now() < holdUntil) {
      await sleep(3000);
      n = await count();
      if (n !== expect) throw new Error(`labour entries for ${who} changed from ${expect} to ${n} while watching`);
    }
    console.log(`LABOUR COUNT for ${who} on ${fx.date}: ${n} (expected ${expect}${opt.hold ? `, unchanged for ${opt.hold} s` : ''})`);
  },

  async 'create-delivery'() {
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const { user } = await get('/auth/me', admin, 'admin profile');
    const res = await fetch(`${API}/projects/${fx.projectId}/sites/${fx.siteId}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({
        supplierName: opt.supplier, deliveryDate: fx.date, itemDescription: 'Binding wire rolls',
        unitOfMeasure: 'rolls', quantityOrdered: 20, quantityDelivered: 20,
        conditionOnArrival: 'good', receivedById: user.id,
      }),
    });
    console.log(`Create delivery "${opt.supplier}" through the API: HTTP ${res.status}`);
    if (res.status !== 201) throw new Error(`create delivery: HTTP ${res.status}`);
  },

  async 'delivery-check'() {
    const expect = Number(opt.expect);
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const sup = await login(creds.SUP_EMAIL, 'supervisor');
    const { user: supervisor } = await get('/auth/me', sup, 'supervisor profile');
    const q = `projectId=${fx.projectId}&siteId=${fx.siteId}&search=${encodeURIComponent(opt.supplier)}&limit=100`;
    const { records } = await get(`/deliveries?${q}`, admin, 'delivery list');
    const mine = (records ?? []).filter((r) => r.supplierName === opt.supplier);
    if (mine.length !== expect) throw new Error(`expected ${expect} deliveries from "${opt.supplier}", found ${mine.length}`);
    for (const r of mine) {
      const photos = Array.isArray(r.photos) ? r.photos.length : 0;
      if (opt.photos !== undefined && photos !== Number(opt.photos)) {
        throw new Error(`delivery from "${opt.supplier}" has ${photos} photos, expected ${opt.photos}`);
      }
      const by = (r.receivedById ?? r.receivedBy?.id) === supervisor.id ? 'the site supervisor' : 'someone else';
      console.log(`DELIVERY CHECK: "${r.supplierName}", ${r.itemDescription}, ${r.quantityDelivered} ${r.unitOfMeasure}, photos ${photos}, received by ${by}`);
      if (opt['received-by-supervisor'] === 'yes' && by !== 'the site supervisor') {
        throw new Error('the delivery was not recorded for the signed-in supervisor');
      }
    }
    console.log(`DELIVERY CHECK passed: ${mine.length} delivery from "${opt.supplier}" in the API`);
  },

  // The simulator has no camera, so the app cannot produce a photo there.
  // This makes the same two calls the app makes after "Create Delivery" with a
  // photo (src/api/deliveries.ts): create, then multipart POST .../photos with
  // field "file", a .jpg name and type image/jpeg; then reads the photo back
  // the way the delivery detail screen does (origin + fileUrl, bearer token).
  async 'upload-contract'() {
    const jpeg = readFileSync(opt.image);
    const sup = await login(creds.SUP_EMAIL, 'supervisor');
    const { user } = await get('/auth/me', sup, 'supervisor profile');
    const site = `${API}/projects/${fx.projectId}/sites/${fx.siteId}`;
    const created = await fetch(`${site}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sup}` },
      body: JSON.stringify({
        supplierName: 'Upload Contract Check Ltd', deliveryDate: fx.date, itemDescription: 'Photo upload contract check',
        unitOfMeasure: 'units', quantityOrdered: 1, quantityDelivered: 1, conditionOnArrival: 'good', receivedById: user.id,
      }),
    });
    console.log(`Create delivery as the supervisor: HTTP ${created.status}`);
    if (created.status !== 201) throw new Error(`create delivery: HTTP ${created.status}`);
    const { delivery } = await created.json();

    const upload = async (bytes, type, name, token) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), name);
      return fetch(`${site}/deliveries/${delivery.id}/photos`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
      });
    };
    const anon = await upload(jpeg, 'image/jpeg', basename(opt.image), null);
    console.log(`Upload photo without a session: HTTP ${anon.status}`);
    if (anon.status !== 401) throw new Error(`upload without a session: expected 401, got ${anon.status}`);
    const fake = await upload(Buffer.from('this is not a picture'), 'image/jpeg', 'not-a-photo.jpg', sup);
    console.log(`Upload text declared as image/jpeg: HTTP ${fake.status}`);
    if (fake.status !== 422) throw new Error(`upload of a non-image: expected 422, got ${fake.status}`);
    const ok = await upload(jpeg, 'image/jpeg', basename(opt.image), sup);
    console.log(`Upload photo (${jpeg.length} bytes, image/jpeg, field "file"): HTTP ${ok.status}`);
    if (ok.status !== 201) throw new Error(`upload: expected 201, got ${ok.status}`);
    const { photo } = await ok.json();

    const q = `projectId=${fx.projectId}&siteId=${fx.siteId}&search=${encodeURIComponent('Upload Contract Check Ltd')}`;
    const { records } = await get(`/deliveries?${q}`, sup, 'delivery list');
    const listed = (records ?? []).find((r) => r.id === delivery.id);
    const photos = listed && Array.isArray(listed.photos) ? listed.photos : [];
    console.log(`Delivery list shows the delivery with ${photos.length} photo(s)`);
    if (photos.length !== 1 || photos[0].id !== photo.id) throw new Error('the delivery list does not show the uploaded photo');

    const url = photo.fileUrl.startsWith('http') ? photo.fileUrl : `${ORIGIN}${photo.fileUrl}`;
    const back = await fetch(url, { headers: { Authorization: `Bearer ${sup}` } });
    const stored = Buffer.from(await back.arrayBuffer());
    console.log(`Read the photo back: HTTP ${back.status}, ${stored.length} bytes, identical: ${stored.equals(jpeg)}`);
    if (back.status !== 200 || !stored.equals(jpeg)) throw new Error('the stored photo differs from the uploaded one');
    const noSession = await fetch(url);
    console.log(`Read the photo back without a session: HTTP ${noSession.status}`);
    if (noSession.status !== 401) throw new Error(`photo without a session: expected 401, got ${noSession.status}`);
    console.log('UPLOAD CONTRACT passed (API only: no photo was taken or sent by the app)');
  },

  // Token expiry (flow 10): among the app's requests since the phase started
  // there must be a 401, later a refresh answered 200, later a logout answered
  // 200. Status codes and paths only.
  async 'status-sequence'() {
    const events = timingEvents(opt.log, opt.since).filter((e) => isApp(e.client));
    const i = events.findIndex((e) => e.status === 401 && !/\/auth\/(login|refresh)$/.test(e.path));
    const j = i < 0 ? -1 : events.findIndex((e, n) => n > i && e.method === 'POST' && /\/auth\/refresh$/.test(e.path) && e.status === 200);
    const k = j < 0 ? -1 : events.findIndex((e, n) => n > j && e.method === 'POST' && /\/auth\/logout$/.test(e.path) && e.status === 200);
    console.log(`App requests answered since ${opt.since}: ${events.length}`);
    if (i >= 0) console.log(`  expired token refused:  ${line(events[i])}`);
    if (j >= 0) console.log(`  token refreshed:        ${line(events[j])}`);
    if (k >= 0) console.log(`  session ended:          ${line(events[k])}`);
    if (k < 0) {
      throw new Error(`the API log does not show ${i < 0 ? 'a 401 for an app request' : j < 0 ? 'a refresh answered 200 after the 401' : 'a logout answered 200 after the refresh'}`);
    }
    const after = events.slice(j + 1).filter((e) => e.status === 401 && !/\/auth\/logout$/.test(e.path));
    console.log(`  401 answers after the refresh (other than logout): ${after.length}`);
    console.log('STATUS SEQUENCE passed: 401, then refresh 200, then logout 200');
  },

  // A request the app must have made, by method, path pattern, status and
  // (optionally) content type, for example the PDF downloads.
  async served() {
    const path = new RegExp(opt.path);
    const events = timingEvents(opt.log, opt.since).filter((e) =>
      isApp(e.client) && e.method === opt.method && path.test(e.path) && (opt.status === 'any' || e.status === Number(opt.status))
      && (opt.ctype === undefined || e.ctype === opt.ctype));
    for (const e of events.slice(0, 5)) console.log(`  ${line(e)} ${e.ctype ?? ''} ${e.bytes ?? '?'} bytes in ${e.ms} ms`);
    const want = opt.count === undefined ? null : Number(opt.count);
    if (want === null ? events.length < 1 : events.length !== want) {
      throw new Error(`expected ${want ?? 'at least 1'} app request(s) ${opt.method} ${opt.path} -> ${opt.status}${opt.ctype ? ` ${opt.ctype}` : ''}, found ${events.length}`);
    }
    console.log(`SERVED passed: ${events.length} app request(s) ${opt.method} ${opt.path} -> ${opt.status}${opt.ctype ? ` ${opt.ctype}` : ''}`);
  },

  // ── Labour cost (flow 11) ─────────────────────────────────────────────────
  // A third worker paid in another currency, assigned to the site, with a
  // 4-hour entry today, so the Labour tab has two currencies to keep apart.
  async 'labour-usd-setup'() {
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const site = `/projects/${fx.projectId}/sites/${fx.siteId}`;
    const post = async (path, body, what) => {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
        body: JSON.stringify(body),
      });
      console.log(`${what}: HTTP ${res.status}`);
      if (res.status !== 201) throw new Error(`${what}: HTTP ${res.status}`);
      return res.json();
    };
    const { worker } = await post('/workers',
      { firstName: 'Juma', lastName: 'Dollar', trade: 'Electrician', dailyWage: 40, currency: 'USD' },
      'Create worker paid in USD');
    await post(`${site}/workers`, { workerId: worker.id }, 'Assign the USD worker to the site');
    await post(`${site}/labour`, { workerId: worker.id, date: fx.date, hoursWorked: 4 }, 'Create a 4-hour labour entry for the USD worker');
  },

  // Recomputes the labour cost from the stored entries (hours / 8 x daily
  // rate, per currency) and checks the entry the project manager made in the
  // app: --worker-first NAME --hours H --rate R --currency C, and the expected
  // totals --expect "KES=3000,USD=20".
  async 'labour-cost-check'() {
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const pm = await login(creds.PM_EMAIL, 'project manager');
    const { user: pmUser } = await get('/auth/me', pm, 'project manager profile');
    const q = `projectId=${fx.projectId}&siteId=${fx.siteId}&limit=100`;
    const { entries } = await get(`/labour?${q}`, admin, 'labour list');
    const mine = (entries ?? []).filter((e) => e.worker?.firstName === opt['worker-first']);
    if (mine.length !== 1) throw new Error(`expected 1 labour entry for ${opt['worker-first']}, found ${mine.length}`);
    const e = mine[0];
    const by = (e.registeredById ?? e.recordedById ?? e.createdById);
    console.log(`LABOUR ENTRY: ${opt['worker-first']}, ${Number(e.hoursWorked)} h, daily rate ${Number(e.dailyRate)} ${e.currency}, recorded by ${by === undefined ? 'not reported' : by === pmUser.id ? 'the project manager' : 'someone else'}`);
    if (Number(e.hoursWorked) !== Number(opt.hours)) throw new Error(`hours ${e.hoursWorked}, expected ${opt.hours}`);
    if (Number(e.dailyRate) !== Number(opt.rate)) throw new Error(`daily rate ${e.dailyRate}, expected ${opt.rate}`);
    if (e.currency !== opt.currency) throw new Error(`currency ${e.currency}, expected ${opt.currency}`);
    if (by !== undefined && by !== pmUser.id) throw new Error('the entry was not recorded by the signed-in project manager');
    const totals = {};
    for (const x of entries ?? []) {
      if (x.dailyRate == null) throw new Error('the admin was not shown a daily rate');
      totals[x.currency] = (totals[x.currency] ?? 0) + (Number(x.hoursWorked) / 8) * Number(x.dailyRate);
    }
    const shown = Object.keys(totals).sort().map((c) => `${c} ${totals[c].toFixed(2)}`).join(' + ');
    console.log(`LABOUR COST from ${entries.length} stored entries (hours / 8 x daily rate, per currency): ${shown}`);
    for (const pair of String(opt.expect).split(',')) {
      const [cur, amount] = pair.split('=');
      if (Math.abs((totals[cur] ?? 0) - Number(amount)) > 0.005) {
        throw new Error(`${cur} total ${(totals[cur] ?? 0).toFixed(2)}, expected ${amount}`);
      }
    }
    if (Object.keys(totals).length !== String(opt.expect).split(',').length) throw new Error('unexpected currency in the totals');
    console.log('LABOUR COST CHECK passed');
  },

  // ── Partial acceptance (flow 12) ──────────────────────────────────────────
  // --supplier NAME --accepted N --material NAME --stock N
  async 'delivery-acceptance-check'() {
    const admin = await login(creds.SMOKE_EMAIL, 'admin');
    const q = `projectId=${fx.projectId}&siteId=${fx.siteId}&search=${encodeURIComponent(opt.supplier)}&limit=100`;
    const { records } = await get(`/deliveries?${q}`, admin, 'delivery list');
    const mine = (records ?? []).filter((r) => r.supplierName === opt.supplier);
    if (mine.length !== 1) throw new Error(`expected 1 delivery from "${opt.supplier}", found ${mine.length}`);
    const d = mine[0];
    console.log(`DELIVERY: "${d.supplierName}", delivered ${Number(d.quantityDelivered)} ${d.unitOfMeasure}, acceptance ${d.acceptanceStatus}, accepted ${d.quantityAccepted == null ? 'not recorded' : Number(d.quantityAccepted)}`);
    if (d.acceptanceStatus !== 'partially_accepted') throw new Error(`acceptance ${d.acceptanceStatus}, expected partially_accepted`);
    if (Number(d.quantityAccepted) !== Number(opt.accepted)) throw new Error(`accepted ${d.quantityAccepted}, expected ${opt.accepted}`);
    const inv = await get(`/projects/${fx.projectId}/sites/${fx.siteId}/inventory`, admin, 'inventory');
    const items = Array.isArray(inv) ? inv : (inv.items ?? inv.inventory ?? []);
    const item = items.find((i) => i.materialName === opt.material);
    if (!item) throw new Error(`no inventory item "${opt.material}"`);
    console.log(`INVENTORY: "${item.materialName}" ${Number(item.currentQuantity)} ${item.unitOfMeasure}`);
    if (Number(item.currentQuantity) !== Number(opt.stock)) {
      throw new Error(`stock ${item.currentQuantity}, expected ${opt.stock} (only the accepted quantity may be credited)`);
    }
    console.log('DELIVERY ACCEPTANCE CHECK passed');
  },

  // ── Session ending (flows 15 to 17) ───────────────────────────────────────
  // A second session of the site supervisor, signed in through the API (as a
  // second phone would be). Returns the token pair; never printed.
  async 'ended-session-replay'() {
    // A session that is signed out on purpose, then its refresh token is
    // presented again: refused, and no other session is touched. A third
    // session made before the replay must still work after it.
    const a = await apiSession('supervisor session A');
    const keep = await apiSession('supervisor session B');
    const out = await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.accessToken}` },
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    });
    console.log(`Sign out session A: HTTP ${out.status}`);
    if (out.status !== 200) throw new Error(`logout: HTTP ${out.status}`);
    const replay = await refresh(a.refreshToken);
    console.log(`Present session A's refresh token again: HTTP ${replay}`);
    if (replay !== 401) throw new Error(`replay of a signed-out token: expected 401, got ${replay}`);
    const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${keep.accessToken}` } });
    console.log(`Session B after the replay: GET /auth/me HTTP ${me.status}`);
    if (me.status !== 200) throw new Error('another session was ended by the replay of a signed-out token');
    console.log('ENDED SESSION REPLAY passed: refused quietly, other sessions kept');
  },

  async 'reuse-replay'() {
    // A refresh token that was already rotated is presented again: the API
    // treats it as reuse and ends every session of the user, including the
    // app's, from the next request on.
    const a = await apiSession('supervisor session C');
    const first = await refresh(a.refreshToken, true);
    console.log(`Rotate session C's refresh token: HTTP ${first.status}`);
    if (first.status !== 200) throw new Error(`rotate: HTTP ${first.status}`);
    const replay = await refresh(a.refreshToken);
    console.log(`Present the rotated-away refresh token again: HTTP ${replay}`);
    if (replay !== 401) throw new Error(`reuse: expected 401, got ${replay}`);
    const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${first.accessToken}` } });
    console.log(`Session C's newest access token after the reuse: GET /auth/me HTTP ${me.status}`);
    if (me.status !== 401) throw new Error(`after reuse the newest access token still works (HTTP ${me.status})`);
    console.log('REUSE REPLAY passed: every session of the user ended');
  },

  async 'reset-password'() {
    // The password reset a user makes from the web "Forgot password" page,
    // for the site supervisor. The new password comes from the environment
    // (NEW_PASSWORD, generated and masked by smoke.sh). The one-time link is
    // read from the API's non-production answer and never printed.
    const next = process.env.NEW_PASSWORD;
    if (!next) throw new Error('NEW_PASSWORD is not set');
    const f = await fetch(`${API}/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.SUP_EMAIL }),
    });
    console.log(`Request a password reset for the site supervisor: HTTP ${f.status}`);
    if (f.status !== 200) throw new Error(`forgot-password: HTTP ${f.status}`);
    const link = (await f.json()).devLink;
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('no reset link in the non-production answer');
    const r = await fetch(`${API}/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: next }),
    });
    console.log(`Set the new password through the reset link: HTTP ${r.status}`);
    if (r.status !== 200) throw new Error(`reset-password: HTTP ${r.status}`);
    const again = await fetch(`${API}/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: next }),
    });
    console.log(`Use the same reset link a second time: HTTP ${again.status}`);
    if (again.status !== 401) throw new Error(`second use of the reset link: expected 401, got ${again.status}`);
    console.log('PASSWORD RESET done (the app session is checked by the next flow)');
  },

  // Among the app's requests since --since: a 401 on an ordinary request,
  // then POST /auth/refresh answered 200; and no refresh answered 401.
  // --refused yes instead requires the refresh to be answered 401 (the
  // session was ended on the server) and no refresh answered 200 after it.
  async refreshed() {
    const events = timingEvents(opt.log, opt.since).filter((e) => isApp(e.client));
    const refreshes = events.filter((e) => e.method === 'POST' && /\/auth\/refresh$/.test(e.path));
    const i = events.findIndex((e) => e.status === 401 && !/\/auth\/(login|refresh|logout)$/.test(e.path));
    console.log(`App requests answered since ${opt.since}: ${events.length}; refreshes: ${refreshes.map((e) => e.status).join(', ') || 'none'}`);
    if (i < 0) throw new Error('no app request was answered 401 in this phase');
    console.log(`  first 401: ${line(events[i])}`);
    const after = refreshes.filter((e) => Date.parse(e.t) >= Date.parse(events[i].t));
    if (opt.refused === 'yes') {
      if (!after.some((e) => e.status === 401)) throw new Error('no refresh was refused after the 401');
      const lastRefused = after.filter((e) => e.status === 401).pop();
      if (after.some((e) => e.status === 200 && Date.parse(e.t) > Date.parse(lastRefused.t))) {
        throw new Error('a refresh succeeded after the session was ended');
      }
      console.log('REFRESHED check passed: the ended session could not be refreshed');
      return;
    }
    if (!after.some((e) => e.status === 200)) throw new Error('no refresh answered 200 after the 401');
    if (refreshes.some((e) => e.status !== 200)) throw new Error('a refresh was refused in this phase');
    console.log('REFRESHED check passed: the expired token was refreshed, no refresh refused');
  },
};

if (!commands[command]) {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
commands[command]().catch((err) => {
  console.error(`::error::${command} failed: ${err.message}`);
  process.exitCode = 1;
});
