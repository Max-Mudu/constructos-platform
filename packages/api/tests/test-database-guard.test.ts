/**
 * The API tests delete every row in their database, so they must refuse any
 * target that is not a confirmed local *_test database. These tests prove each
 * incorrect target is rejected (with a credential-free message), the valid one
 * is accepted, and the real setup path refuses in a child process before it
 * connects. The child processes point at an unreachable port (127.0.0.1:1).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  GUARD_MESSAGE_PREFIX,
  resolveTestDatabase,
  resolveTestDatabaseFromEnvironment,
  TestDatabaseGuardError,
  type ResolveTestDatabaseInput,
  type TestDatabaseTarget,
} from './support/test-database';
import { confirmServerDatabase, type DatabaseIdentityClient } from './support/confirm-database';

const USER = 'guard-user';
const PASSWORD = 'guard-pw-must-never-appear';
const dbUrl = (hostPort: string, database: string, query = ''): string =>
  `postgresql://${USER}:${PASSWORD}@${hostPort}/${database}${query}`;

const TEST_NAME = 'construction_platform_test';
const VALID_URL = dbUrl('localhost:5432', TEST_NAME, '?schema=public');
const VALID: ResolveTestDatabaseInput = { testUrl: VALID_URL, confirm: TEST_NAME };

function refusal(input: ResolveTestDatabaseInput): string {
  let caught: unknown;
  try {
    resolveTestDatabase(input);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(TestDatabaseGuardError);
  const message = (caught as Error).message;
  expect(message.startsWith(GUARD_MESSAGE_PREFIX)).toBe(true);
  expect(message).not.toContain(PASSWORD);
  expect(message).not.toContain(USER);
  return message;
}

describe('resolveTestDatabase: accepted target', () => {
  it('accepts a confirmed local *_test database and returns its parsed identity', () => {
    expect(resolveTestDatabase(VALID)).toEqual({
      url: VALID_URL, host: 'localhost', port: '5432', database: TEST_NAME,
    });
  });

  it('accepts 127.0.0.1 and ::1, and defaults the port to 5432', () => {
    expect(resolveTestDatabase({ testUrl: dbUrl('127.0.0.1', TEST_NAME), confirm: TEST_NAME }))
      .toMatchObject({ host: '127.0.0.1', port: '5432' });
    expect(resolveTestDatabase({ testUrl: dbUrl('[::1]:5433', TEST_NAME), confirm: TEST_NAME }))
      .toMatchObject({ host: '::1', port: '5433' });
  });

  it('accepts a dev database whose URL is a string prefix of the test URL but names a different database', () => {
    const devUrl = dbUrl('localhost:5432', 'construction_platform');
    expect(VALID_URL.startsWith(devUrl)).toBe(true);
    expect(resolveTestDatabase({ ...VALID, devUrl }).database).toBe(TEST_NAME);
  });

  it('accepts a dev database with the same name on a different port (a different server)', () => {
    expect(resolveTestDatabase({ ...VALID, devUrl: dbUrl('localhost:5433', TEST_NAME) }).port).toBe('5432');
  });
});

describe('resolveTestDatabase: rejected targets', () => {
  it('refuses a missing TEST_DATABASE_URL instead of falling back to DATABASE_URL', () => {
    for (const testUrl of [undefined, '', '   ']) {
      expect(refusal({ testUrl, confirm: TEST_NAME })).toContain('TEST_DATABASE_URL is not set');
    }
  });

  it('refuses a missing confirmation', () => {
    for (const confirm of [undefined, '', '  ']) {
      expect(refusal({ testUrl: VALID_URL, confirm })).toContain('TEST_DATABASE_CONFIRM is not set');
    }
  });

  it('refuses a confirmation that does not match the resolved database name', () => {
    for (const confirm of ['construction_platform', 'other_test', 'CONSTRUCTION_PLATFORM_TEST', 'localhost']) {
      expect(refusal({ testUrl: VALID_URL, confirm })).toContain('TEST_DATABASE_CONFIRM does not match');
    }
  });

  it('refuses the development database from .env, compared as parsed host/port/name', () => {
    // identical URL
    expect(refusal({ ...VALID, devUrl: VALID_URL })).toContain('points at the development database');
    // dev URL is a string prefix of the test URL and names the same database
    const prefixDev = dbUrl('localhost:5432', TEST_NAME);
    expect(VALID_URL.startsWith(prefixDev)).toBe(true);
    expect(refusal({ ...VALID, devUrl: prefixDev })).toContain('points at the development database');
    // other spelling of the same local server, default port, other credentials
    expect(refusal({ ...VALID, devUrl: `postgres://someone:else@127.0.0.1/${TEST_NAME}` }))
      .toContain('points at the development database');
  });

  it('refuses when the development URL in .env cannot be parsed (cannot prove they differ)', () => {
    expect(refusal({ ...VALID, devUrl: 'not a url' })).toContain('DATABASE_URL in packages/api/.env is not a valid URL');
  });

  it('refuses a database name that does not end in _test', () => {
    for (const name of ['construction_platform', 'construction_platform_testing', 'test_construction_platform', 'Construction_Platform_Test', 'x-test']) {
      expect(refusal({ testUrl: dbUrl('localhost:5432', name), confirm: name })).toContain('does not end in _test');
    }
  });

  it('refuses a remote host', () => {
    for (const hostPort of ['db.example.com:5432', '10.0.0.5:5432', '192.168.1.20', 'localhost.example.com', '0.0.0.0']) {
      expect(refusal({ testUrl: dbUrl(hostPort, TEST_NAME), confirm: TEST_NAME })).toContain('is not local');
    }
  });

  it('refuses a connection parameter that could redirect a local URL to another server', () => {
    for (const query of ['?host=db.example.com', '?schema=public&HOST=/var/run/other', '?hostaddr=10.0.0.5']) {
      expect(refusal({ testUrl: dbUrl('localhost:5432', TEST_NAME, query), confirm: TEST_NAME }))
        .toContain('host or hostaddr parameter');
    }
  });

  it('refuses Railway-style hosts', () => {
    for (const hostPort of ['containers-us-west-12.railway.app:6543', 'roundhouse.proxy.rlwy.net:12345', 'postgres.railway.internal']) {
      expect(refusal({ testUrl: dbUrl(hostPort, TEST_NAME), confirm: TEST_NAME }))
        .toContain('looks like a production, QA, staging or hosted (Railway) database');
    }
  });

  it('refuses production, QA and staging names even on localhost', () => {
    for (const name of ['construction_platform_prod_test', 'constructos_production_test', 'constructos_qa_test', 'QA_test', 'staging_test']) {
      expect(refusal({ testUrl: dbUrl('localhost:5432', name), confirm: name }))
        .toContain('looks like a production, QA, staging or hosted (Railway) database');
    }
  });

  it('refuses a non-postgres scheme', () => {
    for (const testUrl of [
      `mysql://${USER}:${PASSWORD}@localhost:3306/${TEST_NAME}`,
      `http://${USER}:${PASSWORD}@localhost:5432/${TEST_NAME}`,
      `file:./${TEST_NAME}.db`,
    ]) {
      expect(refusal({ testUrl, confirm: TEST_NAME })).toContain('must be a postgresql:// URL');
    }
  });

  it('refuses a malformed URL without echoing it', () => {
    for (const testUrl of [
      'not a url',
      `postgresql://${USER}:${PASSWORD}@local host:5432/${TEST_NAME}`,
      `postgresql://${USER}:${PASSWORD}@[::1/${TEST_NAME}`,
      `postgresql://${USER}:${PASSWORD}@localhost:99999/${TEST_NAME}`,
    ]) {
      expect(refusal({ testUrl, confirm: TEST_NAME })).toContain('TEST_DATABASE_URL is not a valid URL');
    }
    expect(refusal({ testUrl: dbUrl('localhost:5432', '%E0%A4%A_test'), confirm: TEST_NAME }))
      .toContain('malformed database name');
  });
});

describe('resolveTestDatabaseFromEnvironment', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-db-guard-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const writeEnvFile = (lines: string[]): string => {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  };

  it('reads the dev URL from the .env FILE, not from the environment (CI sets DATABASE_URL to the test URL)', () => {
    const envFile = writeEnvFile([`DATABASE_URL="${dbUrl('localhost:5432', TEST_NAME)}"`]);
    const env = { TEST_DATABASE_URL: VALID_URL, TEST_DATABASE_CONFIRM: TEST_NAME, DATABASE_URL: dbUrl('localhost:5432', 'other_test') };
    expect(() => resolveTestDatabaseFromEnvironment({ env, envFile })).toThrow('points at the development database');
  });

  it('skips only the dev comparison when there is no .env file (CI)', () => {
    const env = { TEST_DATABASE_URL: VALID_URL, TEST_DATABASE_CONFIRM: TEST_NAME, DATABASE_URL: VALID_URL };
    expect(resolveTestDatabaseFromEnvironment({ env, envFile: path.join(dir, 'missing.env') }).database).toBe(TEST_NAME);
    expect(() => resolveTestDatabaseFromEnvironment({ env: { TEST_DATABASE_URL: VALID_URL }, envFile: path.join(dir, 'missing.env') }))
      .toThrow('TEST_DATABASE_CONFIRM is not set');
  });

  it('never falls back to DATABASE_URL when TEST_DATABASE_URL is missing', () => {
    const envFile = writeEnvFile([`DATABASE_URL="${dbUrl('localhost:5432', 'construction_platform')}"`]);
    const env = { DATABASE_URL: VALID_URL, TEST_DATABASE_CONFIRM: TEST_NAME };
    expect(() => resolveTestDatabaseFromEnvironment({ env, envFile })).toThrow('TEST_DATABASE_URL is not set');
  });

  it('uses the environment before the .env file, like dotenv.config', () => {
    const envFile = writeEnvFile([
      `DATABASE_URL="${dbUrl('localhost:5432', 'construction_platform')}"`,
      `TEST_DATABASE_URL="${dbUrl('localhost:5432', 'from_file_test')}"`,
      'TEST_DATABASE_CONFIRM=from_file_test',
    ]);
    expect(resolveTestDatabaseFromEnvironment({ env: {}, envFile }).database).toBe('from_file_test');
    expect(resolveTestDatabaseFromEnvironment({ env: { TEST_DATABASE_URL: VALID_URL, TEST_DATABASE_CONFIRM: TEST_NAME }, envFile }).database)
      .toBe(TEST_NAME);
    // a confirmation in the file does not confirm a different URL from the environment
    expect(() => resolveTestDatabaseFromEnvironment({ env: { TEST_DATABASE_URL: VALID_URL }, envFile }))
      .toThrow('TEST_DATABASE_CONFIRM does not match');
  });
});

describe('confirmServerDatabase', () => {
  const target: TestDatabaseTarget = { url: VALID_URL, host: 'localhost', port: '5432', database: TEST_NAME };
  function fakeClient(result: () => Promise<unknown>): DatabaseIdentityClient & { disconnects: number } {
    const client = {
      disconnects: 0,
      $queryRawUnsafe: <T>() => result() as Promise<T>,
      $disconnect: async () => { client.disconnects += 1; },
    };
    return client;
  }

  it('passes when the server reports the confirmed name, and disconnects', async () => {
    const client = fakeClient(async () => [{ current_database: TEST_NAME }]);
    await expect(confirmServerDatabase(target, () => client)).resolves.toBeUndefined();
    expect(client.disconnects).toBe(1);
  });

  it('fails when the server reports another database, and disconnects', async () => {
    const client = fakeClient(async () => [{ current_database: 'construction_platform' }]);
    await expect(confirmServerDatabase(target, () => client))
      .rejects.toThrow('reports current_database() = "construction_platform", not the confirmed "construction_platform_test"');
    expect(client.disconnects).toBe(1);
  });

  it('fails on an unexpected result shape', async () => {
    const client = fakeClient(async () => []);
    await expect(confirmServerDatabase(target, () => client)).rejects.toThrow('current_database() = null');
  });

  it('fails closed when the server cannot be reached, without leaking the password', async () => {
    const client = fakeClient(async () => { throw new Error(`connect failed for ${VALID_URL}\nsecond line`); });
    let message = '';
    await confirmServerDatabase(target, () => client).catch((err: Error) => { message = err.message; });
    expect(message).toContain('could not confirm the test database localhost:5432/construction_platform_test');
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain('second line');
    expect(client.disconnects).toBe(1);
  });
});

describe('wiring', () => {
  const apiRoot = path.resolve(__dirname, '..');

  it('jest runs the guard as globalSetup and as the first setup file', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../jest.config');
    const resolve = (p: string): string => path.resolve(p.replace('<rootDir>', apiRoot));
    expect(resolve(config.globalSetup)).toBe(path.join(apiRoot, 'tests', 'global-setup.ts'));
    expect(resolve(config.setupFiles[0])).toBe(path.join(apiRoot, 'tests', 'setup.ts'));
  });

  it('npm run test:db:migrate runs the guarded migration script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(apiRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:db:migrate']).toBe('tsx tests/support/migrate-test-database.ts');
  });
});

describe('the real setup path refuses in a child process before connecting', () => {
  const apiRoot = path.resolve(__dirname, '..');
  const tsxCli = require.resolve('tsx/cli', { paths: [apiRoot] });
  const CHILD_PASSWORD = 'child-pw-must-never-appear';
  const unreachable = (database: string): string => `postgresql://probe:${CHILD_PASSWORD}@127.0.0.1:1/${database}?connect_timeout=5`;
  // A dev-style name on an unreachable port: wrong target, and harmless if a broken guard let it through.
  const BAD_ENV = {
    TEST_DATABASE_URL: unreachable('construction_platform'),
    TEST_DATABASE_CONFIRM: 'construction_platform',
    DATABASE_URL: unreachable('construction_platform'),
  };
  // Positive control: passes every rule, so the probe gets as far as connecting (and fails there).
  const ACCEPTED_ENV = {
    TEST_DATABASE_URL: unreachable('guard_probe_test'),
    TEST_DATABASE_CONFIRM: 'guard_probe_test',
    DATABASE_URL: unreachable('guard_probe_test'),
  };
  const BAD_REASON = `${GUARD_MESSAGE_PREFIX} database name "construction_platform" does not end in _test`;

  function run(args: string[], env: Record<string, string>): { status: number | null; output: string } {
    const r = spawnSync(process.execPath, args, {
      cwd: apiRoot, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 90_000,
    });
    return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
  }
  const tsx = (script: string, ...args: string[]): string[] => [tsxCli, script, ...args];

  it('tests/setup.ts throws the guard error and the probe never reaches its query', () => {
    const { status, output } = run(tsx('tests/support/guard-probe.ts', 'setup'), BAD_ENV);
    expect(status).not.toBe(0);
    expect(output).toContain(BAD_REASON);
    expect(output).not.toContain('PROBE: setup accepted');
    expect(output).not.toMatch(/Can't reach database server|P1001/);
    expect(output).not.toContain(CHILD_PASSWORD);
  }, 100_000);

  it('positive control: an accepted target makes the same probe try to connect', () => {
    const { status, output } = run(tsx('tests/support/guard-probe.ts', 'setup'), ACCEPTED_ENV);
    expect(status).not.toBe(0);
    expect(output).toContain('PROBE: setup accepted the target; querying the database');
    expect(output).not.toContain(GUARD_MESSAGE_PREFIX);
  }, 100_000);

  it('jest globalSetup refuses the bad target before connecting', () => {
    const bad = run(tsx('tests/support/guard-probe.ts', 'global'), BAD_ENV);
    expect(bad.status).not.toBe(0);
    expect(bad.output).toContain(BAD_REASON);
    expect(bad.output).not.toContain('could not confirm the test database');
    expect(bad.output).not.toContain(CHILD_PASSWORD);

    const control = run(tsx('tests/support/guard-probe.ts', 'global'), ACCEPTED_ENV);
    expect(control.status).not.toBe(0);
    expect(control.output).toContain('could not confirm the test database 127.0.0.1:1/guard_probe_test');
    expect(control.output).not.toContain(CHILD_PASSWORD);
  }, 100_000);

  it('npm run test:db:migrate refuses the bad target before Prisma runs', () => {
    const { status, output } = run(tsx('tests/support/migrate-test-database.ts'), BAD_ENV);
    expect(status).not.toBe(0);
    expect(output).toContain(BAD_REASON);
    expect(output).not.toContain('[test:db:migrate] target');
    expect(output).not.toMatch(/Prisma schema loaded|Datasource "db"/);
    expect(output).not.toContain(CHILD_PASSWORD);
  }, 100_000);

  it('the real jest CLI refuses the whole run in globalSetup', () => {
    const jestCli = require.resolve('jest/bin/jest', { paths: [apiRoot] });
    // extractor-schema.test.ts needs no database: without the guard this run would pass.
    const { status, output } = run([jestCli, '--ci', '--runInBand', '--runTestsByPath', 'tests/extractor-schema.test.ts'], BAD_ENV);
    expect(status).not.toBe(0);
    expect(output).toContain(BAD_REASON);
    expect(output).not.toMatch(/Tests:\s+\d+ passed/);
    expect(output).not.toContain(CHILD_PASSWORD);
  }, 100_000);
});
