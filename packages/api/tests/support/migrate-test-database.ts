/**
 * npm run test:db:migrate
 *
 * Applies the Prisma migrations to the confirmed local test database, and only
 * to it. The plain Prisma CLI reads DATABASE_URL from packages/api/.env, which
 * is the development database, so do not run `prisma migrate deploy` directly
 * for the test database.
 *
 * Validates TEST_DATABASE_URL / TEST_DATABASE_CONFIRM with the same rules as
 * the jest setup, asks the server for current_database(), prints the resolved
 * host and database (never credentials), then runs `prisma migrate deploy`
 * without a shell and with DATABASE_URL set to the validated URL. The database
 * must already exist (createdb construction_platform_test).
 */
import path from 'path';
import { spawn } from 'child_process';
import { describeTarget, resolveTestDatabaseFromEnvironment } from './test-database';
import { confirmServerDatabase } from './confirm-database';

const API_ROOT = path.resolve(__dirname, '../..');

async function main(): Promise<number> {
  const target = resolveTestDatabaseFromEnvironment();
  await confirmServerDatabase(target);
  console.log(`[test:db:migrate] target ${describeTarget(target)} (server confirmed current_database())`);

  const prismaCli = require.resolve('prisma/build/index.js', { paths: [API_ROOT] });
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: target.url };
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: API_ROOT,
      env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
