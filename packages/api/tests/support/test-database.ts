/**
 * Test database guard (pure: no Prisma, no network).
 *
 * The API tests delete every row (`clearDatabase()` in tests/helpers/fixtures.ts),
 * so they must only ever run against a disposable local test database. This
 * module decides, before anything connects, whether the configured target is
 * acceptable. It fails closed: anything it cannot prove safe is refused.
 *
 * Rules (see packages/api/docs/TESTING.md):
 *  - TEST_DATABASE_URL is required. There is no fallback to DATABASE_URL.
 *  - postgres:// or postgresql:// only.
 *  - The host is localhost, 127.0.0.1 or ::1, and no query parameter may
 *    redirect the connection to another host.
 *  - The database name is lowercase letters, digits and underscores and ends
 *    in `_test`.
 *  - Neither the host nor the database name contains prod, production, qa,
 *    staging, railway or rlwy (any case).
 *  - The target is not the development database named by DATABASE_URL in the
 *    packages/api/.env file, compared as parsed host/port/name rather than as
 *    strings (the dev URL can be a string prefix of the test URL).
 *  - TEST_DATABASE_CONFIRM equals the database name: an explicit confirmation
 *    of the resolved target.
 *
 * Messages name the host, port and database only. They never contain the URL,
 * user name or password.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export interface TestDatabaseTarget {
  /** The validated connection URL (contains credentials: never print it). */
  url: string;
  host: string;
  port: string;
  database: string;
}

export interface ResolveTestDatabaseInput {
  /** TEST_DATABASE_URL */
  testUrl: string | undefined;
  /** TEST_DATABASE_CONFIRM */
  confirm: string | undefined;
  /** DATABASE_URL from the packages/api/.env file, when that file exists. */
  devUrl?: string | undefined;
}

export const GUARD_MESSAGE_PREFIX = 'Test database guard refused to run:';

export class TestDatabaseGuardError extends Error {
  constructor(reason: string) {
    super(`${GUARD_MESSAGE_PREFIX} ${reason}. See packages/api/docs/TESTING.md.`);
    this.name = 'TestDatabaseGuardError';
  }
}

/** packages/api/.env, resolved from this file's location. */
export const API_ENV_FILE = path.resolve(__dirname, '../../.env');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FORBIDDEN_MARKER = /prod|production|qa|staging|railway|rlwy/i;
const TEST_NAME = /^[a-z0-9_]+_test$/;
// Connection-string parameters that can point the client at a different server.
const HOST_OVERRIDE_PARAMS = new Set(['host', 'hostaddr']);

interface ParsedDatabaseUrl {
  host: string;
  port: string;
  database: string;
  hostOverride: boolean;
}

function refuse(reason: string): never {
  throw new TestDatabaseGuardError(reason);
}

function parseDatabaseUrl(raw: string, label: string): ParsedDatabaseUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse(`${label} is not a valid URL`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    refuse(`${label} must be a postgresql:// URL`);
  }
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return refuse(`${label} has a malformed database name`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const hostOverride = [...url.searchParams.keys()].some((k) => HOST_OVERRIDE_PARAMS.has(k.toLowerCase()));
  return { host, port: url.port || '5432', database, hostOverride };
}

function sameServer(a: ParsedDatabaseUrl, b: ParsedDatabaseUrl): boolean {
  // Every local alias reaches the same server.
  const hostA = LOCAL_HOSTS.has(a.host) ? 'local' : a.host;
  const hostB = LOCAL_HOSTS.has(b.host) ? 'local' : b.host;
  return hostA === hostB && a.port === b.port;
}

/**
 * Validates the test database target. Returns it, or throws
 * TestDatabaseGuardError with a credential-free reason.
 */
export function resolveTestDatabase(input: ResolveTestDatabaseInput): TestDatabaseTarget {
  const testUrl = (input.testUrl ?? '').trim();
  if (!testUrl) {
    refuse('TEST_DATABASE_URL is not set (tests never fall back to DATABASE_URL)');
  }
  const test = parseDatabaseUrl(testUrl, 'TEST_DATABASE_URL');
  const where = `${test.host}:${test.port}/${test.database}`;

  if (FORBIDDEN_MARKER.test(test.host) || FORBIDDEN_MARKER.test(test.database)) {
    refuse(`${where} looks like a production, QA, staging or hosted (Railway) database`);
  }
  if (!LOCAL_HOSTS.has(test.host)) {
    refuse(`TEST_DATABASE_URL host "${test.host}" is not local (allowed: localhost, 127.0.0.1, ::1)`);
  }
  if (test.hostOverride) {
    refuse('TEST_DATABASE_URL has a host or hostaddr parameter, which could connect to another server');
  }
  if (!TEST_NAME.test(test.database)) {
    refuse(`database name "${test.database}" does not end in _test (lowercase letters, digits and underscores only)`);
  }

  const devUrl = (input.devUrl ?? '').trim();
  if (devUrl) {
    const dev = parseDatabaseUrl(devUrl, 'DATABASE_URL in packages/api/.env');
    if (sameServer(dev, test) && dev.database.toLowerCase() === test.database.toLowerCase()) {
      refuse(`TEST_DATABASE_URL points at the development database ${where} from packages/api/.env`);
    }
  }

  const confirm = (input.confirm ?? '').trim();
  if (!confirm) {
    refuse(`TEST_DATABASE_CONFIRM is not set; set it to "${test.database}" to confirm the target ${where}`);
  }
  if (confirm !== test.database) {
    refuse(`TEST_DATABASE_CONFIRM does not match the resolved test database "${test.database}" at ${where}`);
  }

  return { url: testUrl, host: test.host, port: test.port, database: test.database };
}

/** Parses an env file with dotenv; null when the file does not exist (CI). */
export function readEnvFile(file: string): Record<string, string> | null {
  if (!fs.existsSync(file)) return null;
  return dotenv.parse(fs.readFileSync(file));
}

/**
 * Resolves the target from the process environment, falling back to the
 * packages/api/.env file for TEST_DATABASE_URL / TEST_DATABASE_CONFIRM (the
 * same precedence as dotenv.config). The development URL is read from the
 * .env FILE only, because CI and the local runner set DATABASE_URL to the test
 * database in the environment.
 */
export function resolveTestDatabaseFromEnvironment(
  options: { env?: NodeJS.ProcessEnv; envFile?: string } = {},
): TestDatabaseTarget {
  const env = options.env ?? process.env;
  const fileEnv = readEnvFile(options.envFile ?? API_ENV_FILE);
  return resolveTestDatabase({
    testUrl: env['TEST_DATABASE_URL'] ?? fileEnv?.['TEST_DATABASE_URL'],
    confirm: env['TEST_DATABASE_CONFIRM'] ?? fileEnv?.['TEST_DATABASE_CONFIRM'],
    devUrl: fileEnv?.['DATABASE_URL'],
  });
}

/** host:port/database, for logs. Never includes credentials. */
export function describeTarget(target: TestDatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}
