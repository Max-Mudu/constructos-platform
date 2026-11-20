// Times the API's password check on this runner, outside the API: the same
// library (bcryptjs, pure JavaScript) and the same cost the API uses
// (SALT_ROUNDS in packages/api/src/utils/hash.ts). Printed in the job log as
// the baseline for the sign-in latency table: a login cannot be faster than
// one check, and the check takes one whole core while it runs.
//
// Usage (from packages/api): node ../mobile/ios-ci/bcrypt-bench.mjs <label>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const label = process.argv[2] ?? '';
const require = createRequire(`${process.cwd()}/`);
const bcrypt = require('bcryptjs');
const m = /SALT_ROUNDS\s*=\s*(\d+)/.exec(readFileSync('src/utils/hash.ts', 'utf8'));
const rounds = m ? Number(m[1]) : 12;

const secret = 'Aa1' + 'x'.repeat(24); // same length as the generated test password; not a real one
const hash = await bcrypt.hash(secret, rounds);
const runs = [];
for (let i = 0; i < 3; i += 1) {
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  await bcrypt.compare(secret, hash);
  const cpu = process.cpuUsage(c0);
  runs.push(`${Math.round(performance.now() - t0)} ms wall / ${Math.round((cpu.user + cpu.system) / 1000)} ms CPU`);
}
console.log(`BCRYPT BENCH ${label}: cost ${rounds}, one password check: ${runs.join('; ')}`);
