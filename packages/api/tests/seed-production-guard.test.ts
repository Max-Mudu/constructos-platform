/**
 * The demo seed (prisma/seed.ts) refuses to run with NODE_ENV=production.
 * Both runs point DATABASE_URL at an address where no database listens, so no
 * real database is ever touched: the production run must stop before
 * connecting, and the development run (control) must get as far as starting.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const API_DIR = path.resolve(__dirname, '..');
const NO_DATABASE = 'postgresql://127.0.0.1:9/no_database_here';

function runSeed(nodeEnv: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv, DATABASE_URL: NO_DATABASE };
  delete env['TEST_DATABASE_URL'];
  return spawnSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
    cwd: API_DIR, env, encoding: 'utf8', timeout: 90_000,
  });
}

describe('demo seed', () => {
  it('refuses NODE_ENV=production before connecting to any database', () => {
    const r = runSeed('production');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Refusing to seed: NODE_ENV is production');
    expect(r.stdout).not.toContain('Seeding database');
  }, 120_000);

  it('control: outside production it starts seeding (and fails only because no database listens)', () => {
    const r = runSeed('development');
    expect(r.stdout).toContain('Seeding database');
    expect(r.stderr).not.toContain('Refusing to seed');
    expect(r.status).not.toBe(0);
  }, 120_000);
});
