import { PrismaClient } from '@prisma/client';

// Always create a fresh client using the current DATABASE_URL at import time.
// In tests, setup.ts sets DATABASE_URL before any module is imported (via
// Jest's setupFiles, which run before the test module graph is evaluated).
export const prisma = new PrismaClient({
  log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: { url: process.env['DATABASE_URL'] },
  },
});
