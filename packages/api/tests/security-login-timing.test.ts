/**
 * Security regression: POST /auth/login does the same bcrypt work for an
 * unknown or inactive email as for a wrong password. Before the fix the
 * unknown-email path returned without hashing (a few ms vs ~250 ms), so
 * response time revealed which addresses have accounts.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import * as hash from '../src/utils/hash';
import { clearDatabase, createTestCompany } from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
}

describe('login does bcrypt work for every email', () => {
  it('runs one bcrypt comparison for an unknown email', async () => {
    const verify = jest.spyOn(hash, 'verifyPassword');
    const res = await login('nobody@nowhere.test', 'WrongPass1');
    expect(res.statusCode).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('runs one bcrypt comparison for an inactive account', async () => {
    const { admin } = await createTestCompany(app, 'login-inactive');
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    const verify = jest.spyOn(hash, 'verifyPassword');
    const res = await login(admin.email, 'TestPass1');
    expect(res.statusCode).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('answers unknown, inactive and wrong-password logins with the same body', async () => {
    const { admin } = await createTestCompany(app, 'login-same-body');
    const wrong = await login(admin.email, 'WrongPass1');
    const unknown = await login('nobody@nowhere.test', 'WrongPass1');
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false, failedLoginCount: 0 } });
    const inactive = await login(admin.email, 'TestPass1');
    for (const res of [wrong, unknown, inactive]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(wrong.json());
    }
  });

  it('still logs in with the right password', async () => {
    const { admin } = await createTestCompany(app, 'login-ok');
    const res = await login(admin.email, 'TestPass1');
    expect(res.statusCode).toBe(200);
  });
});
