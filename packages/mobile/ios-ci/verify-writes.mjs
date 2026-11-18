// Run after the Maestro flows: checks through the API that the writes the
// supervisor flow made in the app reached the server. Flow 05 marks the
// fixture worker present for today and then checks them out, so the API must
// hold exactly one attendance record for that worker today, status "present",
// with a check-out time. Prints no tokens, passwords or response bodies.
//
// Usage: node verify-writes.mjs <credentials file> <fixture json>
// Env:   API_ORIGIN (default http://localhost:3001)
import { readFileSync } from 'node:fs';

const [credFile, fixtureFile] = process.argv.slice(2);
if (!credFile || !fixtureFile) {
  console.error('usage: node verify-writes.mjs <credentials file> <fixture json>');
  process.exit(2);
}
const API = `${process.env.API_ORIGIN ?? 'http://localhost:3001'}/api/v1`;
const creds = Object.fromEntries(
  readFileSync(credFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const fx = JSON.parse(readFileSync(fixtureFile, 'utf8'));

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.SMOKE_EMAIL, password: creds.SMOKE_PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`admin login: HTTP ${login.status}`);
  const { accessToken } = await login.json();

  const url = `${API}/projects/${fx.projectId}/sites/${fx.siteId}/attendance?date=${fx.date}&workerId=${fx.workerId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status !== 200) throw new Error(`attendance list: HTTP ${res.status}`);
  const { records } = await res.json();
  const mine = (records ?? []).filter((r) => r.workerId === fx.workerId);
  const who = `${fx.worker.firstName} ${fx.worker.lastName}`;
  if (mine.length !== 1) throw new Error(`expected 1 attendance record for ${who} on ${fx.date}, found ${mine.length}`);
  const [r] = mine;
  if (r.status !== 'present') throw new Error(`attendance status is ${r.status}, expected present`);
  if (!r.checkOutTime) throw new Error('attendance has no check-out time');
  console.log(`API cross-check passed: ${who} is present on ${fx.date} with check-out ${r.checkOutTime}, recorded by the app`);
}

main().catch((err) => {
  console.error(`::error::API cross-check failed: ${err.message}`);
  process.exitCode = 1;
});
