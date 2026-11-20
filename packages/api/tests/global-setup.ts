/**
 * Jest globalSetup: runs once before any test file.
 *
 * Applies the same target rules as tests/setup.ts, then connects once and
 * fails the whole run unless the server reports current_database() equal to
 * the confirmed name (TEST_DATABASE_CONFIRM). See packages/api/docs/TESTING.md.
 */
import { describeTarget, resolveTestDatabaseFromEnvironment } from './support/test-database';
import { confirmServerDatabase } from './support/confirm-database';

export default async function globalSetup(): Promise<void> {
  const target = resolveTestDatabaseFromEnvironment();
  await confirmServerDatabase(target);
  // Workers and in-band test files start from this environment; setup.ts sets it again.
  process.env['DATABASE_URL'] = target.url;
  console.log(`Test database guard: server confirmed ${describeTarget(target)} (current_database() matches TEST_DATABASE_CONFIRM)`);
}
