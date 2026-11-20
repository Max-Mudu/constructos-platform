/**
 * Asks the server which database a validated test target really is.
 *
 * Used by the jest globalSetup and by `npm run test:db:migrate` after
 * resolveTestDatabase() has accepted the target: the run continues only when
 * `select current_database()` returns the confirmed name. The client is always
 * disconnected. Messages never contain credentials.
 */
import { PrismaClient } from '@prisma/client';
import { describeTarget, TestDatabaseGuardError, type TestDatabaseTarget } from './test-database';

export interface DatabaseIdentityClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
}

export type CreateIdentityClient = (url: string) => DatabaseIdentityClient;

const createPrismaClient: CreateIdentityClient = (url) =>
  new PrismaClient({ datasources: { db: { url } }, log: [] });

function credentialFree(text: string, target: TestDatabaseTarget): string {
  let out = text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? 'unknown error';
  try {
    const { password } = new URL(target.url);
    for (const secret of [password, decodeURIComponent(password)]) {
      if (secret) out = out.split(secret).join('***');
    }
  } catch {
    return 'unknown error';
  }
  return out;
}

export async function confirmServerDatabase(
  target: TestDatabaseTarget,
  createClient: CreateIdentityClient = createPrismaClient,
): Promise<void> {
  const client = createClient(target.url);
  try {
    let rows: unknown;
    try {
      rows = await client.$queryRawUnsafe('select current_database() as current_database');
    } catch (err) {
      const reason = credentialFree(err instanceof Error ? err.message : String(err), target);
      throw new TestDatabaseGuardError(`could not confirm the test database ${describeTarget(target)} (${reason})`);
    }
    const first = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
    const actual = typeof first?.['current_database'] === 'string' ? first['current_database'] : null;
    if (actual !== target.database) {
      throw new TestDatabaseGuardError(
        `the server at ${target.host}:${target.port} reports current_database() = ${JSON.stringify(actual)}, not the confirmed "${target.database}"`,
      );
    }
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}
