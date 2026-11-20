import path from 'path';
import dotenv from 'dotenv';
import { resolveTestDatabaseFromEnvironment, type TestDatabaseTarget } from './support/test-database';

const ENV_FILE = path.resolve(__dirname, '../.env');

// Validate the test database BEFORE anything can import Prisma. The tests
// delete every row, so a missing or unsafe target throws here: jest reports
// "Test suite failed to run" and no test touches a database. There is no
// fallback to DATABASE_URL. Rules: tests/support/test-database.ts.
let target: TestDatabaseTarget;
try {
  target = resolveTestDatabaseFromEnvironment({ envFile: ENV_FILE });
} catch (err) {
  delete process.env['DATABASE_URL'];
  throw err;
}

// Remaining .env values (dotenv never overrides variables that are already set).
dotenv.config({ path: ENV_FILE });
process.env['DATABASE_URL'] = target.url;

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-32chars!!';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-long-enough-32chars!';
