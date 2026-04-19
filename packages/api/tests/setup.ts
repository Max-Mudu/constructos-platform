import path from 'path';
import dotenv from 'dotenv';

// Load .env BEFORE any module imports so DATABASE_URL is correct
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Point to the test database
if (process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
}

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-32chars!!';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-long-enough-32chars!';
