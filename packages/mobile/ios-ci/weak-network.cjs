// Test-harness preload for the API started on the CI runner (not app code,
// never loaded outside this workflow): node --require weak-network.cjs ...
//
// Simulates a weak network for the iOS simulator flows, where the simulator
// itself has no network conditioner: the API handles a request normally (the
// record is saved) but its answer reaches the app late, after the app's own
// 15-second request limit. To the app that is a request whose answer was lost.
//
// Off unless the file named by $CI_WEAK_NETWORK_FILE exists. smoke.sh writes it
// to switch the slow answers on and deletes it to switch them off. Its content:
//   {"id":"labour-1","method":"POST","path":"/labour$","delayMs":20000,"count":1}
// `path` is a regular expression matched against the path without the query
// string; `count` is how many matching answers are held back (per `id`).
// Every held-back answer is written to $API_TIMING_LOG as
//   {"ev":"delayed", t, id, method, path, delay_ms}
// Nothing else changes: same status, headers and body, only later.
'use strict';

const RULE_FILE = process.env.CI_WEAK_NETWORK_FILE;
if (RULE_FILE) {
  const fs = require('node:fs');
  const dc = require('node:diagnostics_channel');
  const used = new Map(); // rule id -> answers already held back
  const log = (obj) => {
    const file = process.env.API_TIMING_LOG;
    if (!file) return;
    try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); } catch { /* never break the API */ }
  };
  const readRule = () => {
    try {
      if (!fs.existsSync(RULE_FILE)) return null;
      const rule = JSON.parse(fs.readFileSync(RULE_FILE, 'utf8'));
      if (!rule || typeof rule.path !== 'string' || !rule.id) return null;
      return rule;
    } catch {
      return null;
    }
  };

  dc.subscribe('http.server.request.start', ({ request, response }) => {
    const rule = readRule();
    if (!rule) return;
    const path = String(request.url ?? '').split(/[?#]/)[0];
    if (rule.method && rule.method !== request.method) return;
    let re;
    try { re = new RegExp(rule.path); } catch { return; }
    if (!re.test(path)) return;
    const n = used.get(rule.id) ?? 0;
    if (n >= Number(rule.count ?? 1)) return;
    used.set(rule.id, n + 1);
    const delay = Number(rule.delayMs ?? 20000);
    // Hold back everything that would reach the client: the status line and
    // headers (a client sees an answer as soon as they arrive) as well as the
    // body. The calls are replayed in order once the answer is complete.
    const held = [];
    const orig = {};
    let scheduled = false;
    for (const name of ['writeHead', 'flushHeaders', 'write', 'end']) {
      orig[name] = response[name];
      response[name] = function heldBack(...args) {
        held.push([name, args]);
        if (name === 'end' && !scheduled) {
          scheduled = true;
          log({ ev: 'delayed', t: new Date().toISOString(), id: rule.id, method: request.method, path, delay_ms: delay });
          setTimeout(() => {
            for (const n of Object.keys(orig)) response[n] = orig[n];
            // The client may have given up and closed the connection
            // meanwhile; writing to a destroyed response is harmless.
            try { for (const [n, a] of held) orig[n].apply(response, a); } catch { /* ignore */ }
          }, delay);
        }
        return name === 'write' ? true : response;
      };
    }
  });
}
