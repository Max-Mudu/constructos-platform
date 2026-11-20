// Test-harness preload for the API started on the CI runner (not app code,
// never loaded outside this workflow): node --require api-timing.cjs ...
//
// Writes one JSON line per event to $API_TIMING_LOG so a slow request can be
// attributed: when the API parsed the request, when it finished the response,
// how much CPU the process got in between, and how long the password check
// (bcryptjs, pure JavaScript on the main thread) took in wall and CPU time.
//
//   {"ev":"start", id, t, method, path, client, rport, conn_age_ms}
//   {"ev":"finish", id, t, method, path, client, status, ms, cpu_ms,
//    bcrypt_n, bcrypt_ms, bcrypt_cpu_ms, eld_max_ms, ctype, bytes}
//   {"ev":"closed", id, t, ..., ms}   (the client went away before the response)
//   {"ev":"bcrypt", t, op, ms, cpu_ms}                        (each password hash or check)
//   {"ev":"tick", t, late_ms, cpu_ms, eld_max_ms, open}      (once a second)
//
// Never written: query strings (the event stream carries the access token
// there), headers, bodies. `client` is only the product name of the
// User-Agent ("curl", "node", "ConstructOS").
'use strict';

const LOG = process.env.API_TIMING_LOG;
if (LOG) {
  const fs = require('node:fs');
  const dc = require('node:diagnostics_channel');
  const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
  const Module = require('node:module');

  let fd = null;
  const write = (obj) => {
    try {
      if (fd === null) fd = fs.openSync(LOG, 'a');
      fs.writeSync(fd, JSON.stringify(obj) + '\n');
    } catch { /* measuring must never break the API */ }
  };
  const iso = () => new Date().toISOString();
  const round = (n) => Math.round(n * 10) / 10;
  const cpuMs = (since) => {
    const u = process.cpuUsage(since);
    return (u.user + u.system) / 1000;
  };

  // ── Password-hash timing ───────────────────────────────────────────────────
  // Totals since process start; a request reports the difference between its
  // start and its finish.
  const bcrypt = { n: 0, ms: 0, cpu: 0 };
  const timed = (fn, op) => function timedBcrypt(...args) {
    // Only the promise form (what the API uses) is timed.
    if (typeof args[args.length - 1] === 'function') return fn.apply(this, args);
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    const done = () => {
      const ms = performance.now() - t0;
      const cpu = cpuMs(c0);
      bcrypt.n += 1; bcrypt.ms += ms; bcrypt.cpu += cpu;
      write({ ev: 'bcrypt', t: iso(), op, ms: round(ms), cpu_ms: round(cpu) });
    };
    const r = fn.apply(this, args);
    if (r && typeof r.then === 'function') r.then(done, done);
    return r;
  };
  const patchBcrypt = (lib) => {
    for (const target of [lib, lib && lib.default]) {
      if (!target || target.__ciTimed) continue;
      for (const name of ['compare', 'hash']) {
        if (typeof target[name] === 'function') target[name] = timed(target[name], name);
      }
      Object.defineProperty(target, '__ciTimed', { value: true });
    }
  };
  const origLoad = Module._load;
  Module._load = function ciTimingLoad(request, ...rest) {
    const exported = origLoad.call(this, request, ...rest);
    if (request === 'bcryptjs') {
      try { patchBcrypt(exported); } catch { /* leave the library as it is */ }
    }
    return exported;
  };

  // ── Event-loop delay and once-a-second process samples ─────────────────────
  const eld = monitorEventLoopDelay({ resolution: 10 });
  const eldHistory = []; // { at: performance.now(), max: ms } for the last 3 minutes
  let ticker = null;
  const startTicker = () => {
    if (ticker) return;
    eld.enable();
    let expected = performance.now() + 1000;
    let cpu = process.cpuUsage();
    ticker = setInterval(() => {
      const now = performance.now();
      const max = eld.max / 1e6;
      eld.reset();
      eldHistory.push({ at: now, max });
      while (eldHistory.length > 180) eldHistory.shift();
      write({ ev: 'tick', t: iso(), late_ms: round(now - expected), cpu_ms: round(cpuMs(cpu)), eld_max_ms: round(max), open: open.size });
      cpu = process.cpuUsage();
      expected = now + 1000;
    }, 1000);
    ticker.unref();
  };
  const eldMaxSince = (since) => {
    let max = eld.max / 1e6;
    for (const h of eldHistory) if (h.at >= since && h.max > max) max = h.max;
    return max;
  };

  // ── Requests ───────────────────────────────────────────────────────────────
  const open = new Map(); // response -> record
  const accepted = new WeakMap(); // socket -> performance.now() at accept
  let nextId = 1;
  const clean = (s, max) => String(s ?? '').replace(/[^A-Za-z0-9._/:-]/g, '_').slice(0, max);
  const pathOnly = (url) => clean(String(url ?? '').split(/[?#]/)[0], 200);
  const clientOf = (ua) => clean(String(ua ?? '').split(/[\/ ]/)[0], 40) || 'unknown';

  dc.subscribe('net.server.socket', ({ socket }) => {
    if (socket) accepted.set(socket, performance.now());
  });

  dc.subscribe('http.server.request.start', ({ request, response, socket }) => {
    startTicker();
    const now = performance.now();
    const rec = {
      id: nextId++,
      at: now,
      cpu: process.cpuUsage(),
      bcrypt: { ...bcrypt },
      method: clean(request.method, 10),
      path: pathOnly(request.url),
      client: clientOf(request.headers && request.headers['user-agent']),
    };
    open.set(response, rec);
    // A client that gives up (the app's 15 s limit) closes the connection and
    // "finish" never comes; record when that happened instead.
    response.once('close', () => {
      if (!open.has(response)) return;
      open.delete(response);
      write({
        ev: 'closed', id: rec.id, t: iso(), method: rec.method, path: rec.path, client: rec.client,
        ms: round(performance.now() - rec.at), cpu_ms: round(cpuMs(rec.cpu)),
        bcrypt_n: bcrypt.n - rec.bcrypt.n, bcrypt_ms: round(bcrypt.ms - rec.bcrypt.ms),
      });
    });
    const acceptedAt = socket ? accepted.get(socket) : undefined;
    write({
      ev: 'start', id: rec.id, t: iso(), method: rec.method, path: rec.path, client: rec.client,
      rport: socket ? socket.remotePort : undefined,
      conn_age_ms: acceptedAt === undefined ? undefined : round(now - acceptedAt),
    });
  });

  dc.subscribe('http.server.response.finish', ({ response }) => {
    const rec = open.get(response);
    if (!rec) return;
    open.delete(response);
    const now = performance.now();
    const length = Number(response.getHeader && response.getHeader('content-length'));
    write({
      ev: 'finish', id: rec.id, t: iso(), method: rec.method, path: rec.path, client: rec.client,
      status: response.statusCode,
      ms: round(now - rec.at),
      cpu_ms: round(cpuMs(rec.cpu)),
      bcrypt_n: bcrypt.n - rec.bcrypt.n,
      bcrypt_ms: round(bcrypt.ms - rec.bcrypt.ms),
      bcrypt_cpu_ms: round(bcrypt.cpu - rec.bcrypt.cpu),
      eld_max_ms: round(eldMaxSince(rec.at)),
      ctype: clean(String((response.getHeader && response.getHeader('content-type')) ?? '').split(';')[0], 60) || undefined,
      bytes: Number.isFinite(length) ? length : undefined,
    });
  });
}
