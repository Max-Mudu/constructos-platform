// API-side checks and small API actions for the operational flows (06 to 10).
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
};

if (!commands[command]) {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
commands[command]().catch((err) => {
  console.error(`::error::${command} failed: ${err.message}`);
  process.exitCode = 1;
});
