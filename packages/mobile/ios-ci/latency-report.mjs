// Builds one timeline per app sign-in from the logs of a run, so a slow
// sign-in can be attributed to a segment instead of being guessed at:
//
//   tap (XCTest driver log)                      maestro/<part>/xctest_runner_*.log
//   request handed to iOS, sent, answer received  logs/simulator-app.log (CFNetwork task lines)
//   API parsed the request, API finished          logs/api-timing.jsonl (api-timing.cjs)
//   the app's next request, screen seen           api-timing.jsonl, maestro/<part>/maestro.log
//
// plus, for comparison, every login made with curl on the runner (the probes
// around each flow and the ones made while the test driver was polling), and
// which processes used the CPU meanwhile (logs/load-samples.log).
// Works on a downloaded artifact too. Reads no secrets: none of these logs
// holds a token, a password or a request body.
//
// Usage: node latency-report.mjs <output folder of the run> [folder for the report]
// Writes latency-report.md and latency-report.json (default: <output folder>/logs)
// and prints the Markdown. All clocks are the runner's; the simulator shares it.
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const REPORT_DIR = process.argv[3] ?? (OUT ? join(OUT, 'logs') : '.');
if (!OUT || !existsSync(OUT)) {
  console.error('usage: node latency-report.mjs <output folder of the run> [folder for the report]');
  process.exit(2);
}
// The simulator log and Maestro's log print local time without a zone.
// GitHub's macOS runners use UTC; LOG_TZ_OFFSET_MIN corrects another zone.
const TZ_MS = Number(process.env.LOG_TZ_OFFSET_MIN ?? 0) * 60000;
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const lines = (p) => read(p).split(/\r?\n/);
const ms = (a, b) => (a == null || b == null ? null : Math.round(b - a));
const hhmmss = (t) => (t == null ? '' : new Date(t).toISOString().slice(11, 23));
const isApp = (client) => !/^(curl|node|unknown)$/.test(client ?? 'unknown');

// ── API timing log ───────────────────────────────────────────────────────────
const api = lines(join(OUT, 'logs', 'api-timing.jsonl')).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .map((e) => ({ ...e, at: Date.parse(e.t) }));
const hasApi = api.length > 0;
const requests = new Map(); // "<segment>:<id>" -> { start, end }
{
  // Request ids restart when the API is restarted; a tick line or an id that
  // goes back to 1 marks nothing reliable, so key on (restart count, id).
  let segment = 0;
  let lastId = 0;
  for (const e of api) {
    if (e.ev === 'start') {
      if (e.id <= lastId) segment += 1;
      lastId = e.id;
      requests.set(`${segment}:${e.id}`, { start: e, end: null });
    } else if (e.ev === 'finish' || e.ev === 'closed') {
      const r = requests.get(`${segment}:${e.id}`);
      if (r) r.end = e;
    }
  }
}
const logins = [...requests.values()].filter((r) => r.start.method === 'POST' && /\/auth\/login$/.test(r.start.path));
const bcryptEvents = api.filter((e) => e.ev === 'bcrypt');

// ── Simulator log: CFNetwork tasks ───────────────────────────────────────────
const tasks = new Map();
{
  const re = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})\s+\S+\s+[^\[]+\[(\d+):[0-9a-f]+\]\s+\[com\.apple\.CFNetwork:(?:Default|Summary)\]\s+Task <([0-9A-Fa-f-]+)>\.<(\d+)>\s+(.*)$/;
  for (const l of lines(join(OUT, 'logs', 'simulator-app.log'))) {
    const m = re.exec(l);
    if (!m) continue;
    const at = Date.parse(`${m[1]}T${m[2]}Z`) - TZ_MS;
    const key = `${m[3]}:${m[4]}`;
    const t = tasks.get(key) ?? { pid: m[3], n: Number(m[5]) };
    tasks.set(key, t);
    const text = m[6];
    let x;
    if ((x = /^resuming, timeouts\(([\d.]+),/.exec(text))) { t.resumed = at; t.timeout = Number(x[1]); }
    else if ((x = /^sent request, body (\w) (\d+)/.exec(text))) { t.sent = at; t.body = x[1]; }
    else if ((x = /^received response, status (\d+)/.exec(text))) { t.received = at; t.status = Number(x[1]); }
    else if ((x = /^summary for task (success|failure) \{(.*)\}/.exec(text))) {
      t.summary = Object.fromEntries(x[2].split(', ').map((kv) => kv.split('=')));
      t.ended = at;
    } else if ((x = /^finished with error \[(-?\d+)\]/.exec(text))) { t.error = Number(x[1]); t.ended = at; }
    else if (/^finished successfully/.test(text)) { t.ended = at; }
  }
}
const taskList = [...tasks.values()].filter((t) => t.resumed != null).sort((a, b) => a.resumed - b.resumed);

// ── Maestro: taps on "Sign in", what was seen afterwards, hierarchy polls ────
const parts = [];
const polls = []; // times of POST /viewHierarchy, all parts
const maestroDir = join(OUT, 'maestro');
if (existsSync(maestroDir)) {
  for (const name of readdirSync(maestroDir).sort()) {
    const dir = join(maestroDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const xcFiles = readdirSync(dir).filter((f) => /^xctest_runner_.*\.log$/.test(f)).sort();
    const xc = [];
    for (const f of xcFiles) {
      for (const l of lines(join(dir, f))) {
        const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d+)([+-]\d{4})\s+\S+\s+(.*)$/.exec(l);
        if (!m) continue;
        const at = Date.parse(`${m[1]}T${m[2].slice(0, 12)}${m[3].slice(0, 3)}:${m[3].slice(3)}`);
        xc.push({ at, text: m[4] });
        if (/request: POST \/viewHierarchy/.test(m[4])) polls.push(at);
      }
    }
    const day = xc.length ? new Date(xc[0].at).toISOString().slice(0, 10) : null;
    const ml = [];
    if (day) {
      for (const l of lines(join(dir, 'maestro.log'))) {
        const m = /^(\d\d:\d\d:\d\d\.\d{3}) \[\s*\w+\] [^:]+: (.*)$/.exec(l);
        if (!m) continue;
        let at = Date.parse(`${day}T${m[1]}Z`) - TZ_MS;
        if (at < xc[0].at - 12 * 3600e3) at += 24 * 3600e3;
        ml.push({ at, text: m[2] });
      }
    }
    parts.push({ name, xc, ml });
  }
}
polls.sort((a, b) => a - b);
const pollsBetween = (a, b) => (a == null || b == null ? null : polls.filter((p) => p >= a && p <= b).length);

const signIns = [];
for (const part of parts) {
  const { ml, xc } = part;
  for (let i = 0; i < ml.length; i += 1) {
    if (ml[i].text !== 'Tap on "Sign in" RUNNING') continue;
    const done = ml.findIndex((e, n) => n > i && /^Tap on "Sign in" (COMPLETED|FAILED)/.test(e.text));
    const tapEnd = done < 0 ? ml[i].at + 5000 : ml[done].at;
    const tap = xc.find((e) => e.at >= ml[i].at - 200 && e.at <= tapEnd + 500 && /^Tapping [\d.]+, [\d.]+/.test(e.text));
    const took = tap && xc.find((e) => e.at >= tap.at && e.at <= tap.at + 5000 && /^Tapping took/.test(e.text));
    const seen = done < 0 ? null : ml.find((e, n) => n > done && /^Assert that .* (COMPLETED|FAILED)$/.test(e.text));
    signIns.push({
      part: part.name,
      tapAt: tap ? tap.at : null,
      tapMs: took ? Math.round(Number(/took ([\d.]+)/.exec(took.text)[1]) * 1000) : null,
      maestroTapDone: done < 0 ? null : ml[done].at,
      seenAt: seen ? seen.at : null,
      seenWhat: seen ? seen.text.replace(/^Assert that /, '').slice(0, 90) : null,
    });
  }
}

// ── Join ─────────────────────────────────────────────────────────────────────
const usedTasks = new Set();
for (const s of signIns) {
  if (s.tapAt == null) continue;
  // The login POST is the first request with a body the app starts after the tap.
  const task = taskList.find((t) => !usedTasks.has(t) && t.resumed >= s.tapAt - 100 && t.resumed <= s.tapAt + 8000 && t.body === 'S');
  if (!task) continue;
  usedTasks.add(task);
  s.task = task;
  const end = task.received ?? task.ended ?? task.resumed + 20000;
  const srv = logins
    .filter((r) => isApp(r.start.client) && r.start.at >= task.resumed - 300 && r.start.at <= end + 300)
    .sort((a, b) => Math.abs(a.start.at - (task.sent ?? task.resumed)) - Math.abs(b.start.at - (task.sent ?? task.resumed)))[0];
  if (srv) {
    s.srv = srv;
    const finished = srv.end ? srv.end.at : null;
    s.next = finished == null ? null
      : (api.find((e) => e.ev === 'start' && isApp(e.client) && e.at > finished && e.at < finished + 60000) ?? null);
    s.bcrypt = bcryptEvents.filter((b) => b.op === 'compare' && b.at >= srv.start.at && b.at <= srv.start.at + 60000)[0] ?? null;
  }
}

// ── Load samples (runner-health.sh): "@ <iso> load a b c" then ps lines ──────
const samples = [];
{
  let cur = null;
  for (const l of lines(join(OUT, 'logs', 'load-samples.log'))) {
    let m;
    if ((m = /^@ (\S+) load ([\d.]+) ([\d.]+) ([\d.]+)/.exec(l))) {
      cur = { at: Date.parse(m[1]), load1: Number(m[2]), procs: new Map() };
      samples.push(cur);
    } else if (cur && (m = /^\s*(\d+)\s+[\d.]+\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?\s+(.+)$/.exec(l))) {
      const secs = Number(m[2] ?? 0) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4]) * 60 + Number(m[5]) + Number(`0.${m[6] ?? 0}`);
      cur.procs.set(m[1], { cpu: secs, name: m[7].trim().split('/').pop().slice(0, 34) });
    }
  }
}
function loadDuring(a, b) {
  if (a == null || b == null || samples.length < 2) return null;
  // Only when the samples cover the window (the sampler runs during the flows).
  const before = [...samples].reverse().find((s) => s.at <= a);
  const after = samples.find((s) => s.at >= b && before && s.at > before.at);
  if (!before || !after || a - before.at > 15000 || after.at - b > 15000) return null;
  const span = (after.at - before.at) / 1000;
  if (span <= 0) return null;
  const used = [];
  for (const [pid, p] of after.procs) {
    const p0 = before.procs.get(pid);
    if (p0 && p.cpu >= p0.cpu) used.push({ name: p.name, cores: (p.cpu - p0.cpu) / span });
  }
  used.sort((x, y) => y.cores - x.cores);
  return { span, load1: after.load1, top: used.slice(0, 5).filter((u) => u.cores >= 0.03) };
}
const loadText = (l) => (l ? `load ${l.load1}; ${l.top.map((u) => `${u.name} ${u.cores.toFixed(2)}`).join(', ') || 'nothing above 0.03 cores'} (cores, over ${Math.round(l.span)} s)` : '');

// ── Probes made with curl (runner-health.sh): "<iso>\t<label>\t<http>\t<secs>" ─
const probes = lines(join(OUT, 'logs', 'probes.tsv')).filter(Boolean).map((l) => {
  const [t, label, http, secs] = l.split('\t');
  return { at: Date.parse(t), label, http: Number(http), secs: Number(secs) };
}).filter((p) => !Number.isNaN(p.at));
const curlLogins = logins.filter((r) => r.start.client === 'curl' && r.end).map((r) => {
  const probe = probes.find((p) => r.start.at >= p.at - 1500 && r.start.at <= p.at + (p.secs + 2) * 1000);
  return { r, probe };
});

// ── Report ───────────────────────────────────────────────────────────────────
const rows = signIns.map((s, i) => {
  const t = s.task;
  const srv = s.srv;
  const end = srv && srv.end;
  const clientEnd = t ? (t.received ?? t.ended) : null;
  return {
    n: i + 1,
    part: s.part,
    tap_utc: hhmmss(s.tapAt),
    tap_to_handed_ms: t ? ms(s.tapAt, t.resumed) : null,
    handed_to_sent_ms: t ? ms(t.resumed, t.sent) : null,
    sent_to_api_ms: t && srv ? ms(t.sent, srv.start.at) : null,
    api_wall_ms: end ? end.ms : null,
    api_cpu_ms: end ? end.cpu_ms : null,
    bcrypt_wall_ms: s.bcrypt ? s.bcrypt.ms : (end && end.bcrypt_n ? end.bcrypt_ms : null),
    bcrypt_cpu_ms: s.bcrypt ? s.bcrypt.cpu_ms : (end && end.bcrypt_n ? end.bcrypt_cpu_ms : null),
    api_event_loop_delay_max_ms: end ? (end.eld_max_ms ?? null) : null,
    api_status: end ? (end.ev === 'closed' ? 'client closed' : end.status) : null,
    api_to_received_ms: t && end && t.received != null && end.ev === 'finish' ? ms(end.at, t.received) : null,
    client_total_ms: t && t.summary ? Number(t.summary.transaction_duration_ms) : (t ? ms(t.resumed, clientEnd) : null),
    client_status: t ? (t.error != null ? `error ${t.error}` : (t.status ?? null)) : null,
    client_connect_ms: t && t.summary ? Number(t.summary.connect_duration_ms) : null,
    received_to_next_request_ms: t && s.next && t.received != null ? ms(t.received, s.next.at) : null,
    next_request: s.next ? `${s.next.method} ${s.next.path}` : null,
    tap_to_seen_ms: ms(s.tapAt, s.seenAt),
    seen: s.seenWhat,
    polls_during_request: t ? pollsBetween(t.resumed, clientEnd) : null,
    load: t ? loadDuring(t.resumed, clientEnd ?? t.resumed + 15000) : null,
  };
});
const curlRows = curlLogins.map(({ r, probe }) => ({
  at_utc: hhmmss(r.start.at),
  label: probe ? probe.label : '(not a logged probe)',
  curl_total_ms: probe ? Math.round(probe.secs * 1000) : null,
  api_wall_ms: r.end.ms,
  api_cpu_ms: r.end.cpu_ms,
  bcrypt_wall_ms: r.end.bcrypt_n ? r.end.bcrypt_ms : null,
  bcrypt_cpu_ms: r.end.bcrypt_n ? r.end.bcrypt_cpu_ms : null,
  status: r.end.status,
  polls_during_request: pollsBetween(r.start.at, r.end.at),
  load: loadDuring(r.start.at, r.end.at),
}));

const v = (x) => (x == null ? '-' : String(x));
const md = [];
md.push('## Sign-in latency: client and server timings');
md.push('');
md.push(`Sources: ${taskList.length} CFNetwork tasks in the simulator log, ${hasApi ? `${requests.size} requests in the API timing log` : 'NO API timing log'}, ${parts.length} Maestro parts, ${polls.length} screen-tree requests by the test driver, ${samples.length} load samples, ${probes.length} curl probes.`);
md.push('');
md.push('### Sign-ins made by the app (one row per tap on "Sign in"; times in ms)');
md.push('');
md.push('| # | flow part | tap (UTC) | tap -> request handed to iOS | handed -> sent | sent -> API parsed it | API handling (wall) | API process CPU | password check wall / CPU | API answered -> app received | app total (CFNetwork) | app result | API result | received -> app\'s next request | tap -> seen by test driver | screen-tree requests during the request |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  md.push(`| ${r.n} | ${r.part} | ${v(r.tap_utc)} | ${v(r.tap_to_handed_ms)} | ${v(r.handed_to_sent_ms)} | ${v(r.sent_to_api_ms)} | ${v(r.api_wall_ms)} | ${v(r.api_cpu_ms)} | ${v(r.bcrypt_wall_ms)} / ${v(r.bcrypt_cpu_ms)} | ${v(r.api_to_received_ms)} | ${v(r.client_total_ms)} | ${v(r.client_status)} | ${v(r.api_status)} | ${v(r.received_to_next_request_ms)} | ${v(r.tap_to_seen_ms)} | ${v(r.polls_during_request)} |`);
}
md.push('');
for (const r of rows) {
  if (r.load) md.push(`- #${r.n} CPU while the request was open: ${loadText(r.load)}`);
}
md.push('');
md.push('### Logins made with curl on the runner (control: same API, no app)');
md.push('');
md.push('| time (UTC) | when | curl total | API handling (wall) | API process CPU | password check wall / CPU | status | screen-tree requests during the request | CPU meanwhile |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const c of curlRows) {
  md.push(`| ${c.at_utc} | ${c.label} | ${v(c.curl_total_ms)} | ${v(c.api_wall_ms)} | ${v(c.api_cpu_ms)} | ${v(c.bcrypt_wall_ms)} / ${v(c.bcrypt_cpu_ms)} | ${c.status} | ${v(c.polls_during_request)} | ${loadText(c.load)} |`);
}
md.push('');
const med = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const polled = rows.filter((r) => (r.polls_during_request ?? 0) > 0);
const quiet = rows.filter((r) => r.polls_during_request === 0 && r.client_total_ms != null);
const curlPolled = curlRows.filter((c) => (c.polls_during_request ?? 0) > 0);
const curlQuiet = curlRows.filter((c) => c.polls_during_request === 0);
md.push('### Medians (ms)');
md.push('');
md.push('| group | n | app or curl total | API handling wall | API process CPU | password check wall | password check CPU |');
md.push('|---|---|---|---|---|---|---|');
const group = (name, xs, total) => md.push(`| ${name} | ${xs.length} | ${v(med(xs.map(total)))} | ${v(med(xs.map((x) => x.api_wall_ms)))} | ${v(med(xs.map((x) => x.api_cpu_ms)))} | ${v(med(xs.map((x) => x.bcrypt_wall_ms)))} | ${v(med(xs.map((x) => x.bcrypt_cpu_ms)))} |`);
group('app sign-in, test driver polling the screen', polled, (x) => x.client_total_ms);
group('app sign-in, test driver not polling', quiet, (x) => x.client_total_ms);
group('curl login, test driver polling the screen', curlPolled, (x) => x.curl_total_ms);
group('curl login, test driver not polling', curlQuiet, (x) => x.curl_total_ms);
md.push('');
md.push('Reading the columns: "tap -> request handed to iOS" is the app\'s own share before the network (touch delivery, JavaScript, the request leaving React Native); "API handling" is measured inside the API process, from the request line being parsed to the response being finished; "API process CPU" is the CPU time that process received in that interval, so wall time far above CPU time means the API was waiting (for the CPU or for PostgreSQL), not computing; the password check is bcryptjs running on the API\'s only JavaScript thread.');

const text = md.join('\n');
writeFileSync(join(REPORT_DIR, 'latency-report.md'), `${text}\n`);
writeFileSync(join(REPORT_DIR, 'latency-report.json'), JSON.stringify({ rows, curlRows, sources: { tasks: taskList.length, apiRequests: requests.size, parts: parts.length, polls: polls.length, samples: samples.length, probes: probes.length } }, null, 2));
console.log(text);
