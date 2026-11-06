/**
 * Security regression: a password-reset token is single-use even under
 * concurrency. Before the fix, resetPassword checked `usedAt` and then spent
 * ~250 ms in bcrypt before an unconditional update, so two requests carrying
 * the same token could both succeed (the second silently overwriting the
 * first password).
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { verifyPassword } from '../src/utils/hash';
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

async function issueResetToken(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email },
  });
  const devLink: string = res.json().devLink;
  return devLink.split('token=')[1]!;
}

describe('reset-password token single use', () => {
  it('lets exactly one of two concurrent requests with the same token succeed', async () => {
    const { admin } = await createTestCompany(app, 'reset-race');
    const token = await issueResetToken(admin.email);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'FirstPass1' } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'SecondPass2' } }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 401]);

    const winner = a.statusCode === 200 ? 'FirstPass1' : 'SecondPass2';
    const loser  = a.statusCode === 200 ? 'SecondPass2' : 'FirstPass1';
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(await verifyPassword(winner, user.passwordHash)).toBe(true);
    expect(await verifyPassword(loser, user.passwordHash)).toBe(false);

    const audits = await prisma.auditLog.count({
      where: { userId: admin.id, changesAfter: { path: ['event'], equals: 'password_reset_completed' } },
    });
    expect(audits).toBe(1);
  });

  it('still rejects a sequential second use', async () => {
    const { admin } = await createTestCompany(app, 'reset-reuse');
    const token = await issueResetToken(admin.email);

    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'FirstPass1' } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'SecondPass2' } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
  });
});
