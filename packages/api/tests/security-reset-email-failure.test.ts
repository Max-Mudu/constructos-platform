/**
 * Security regression: POST /auth/forgot-password must answer identically for
 * registered and unknown addresses even when SMTP delivery fails. Before the
 * fix, a delivery error propagated as a 500 only for registered addresses,
 * which turned a broken mail relay into an account-enumeration oracle.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { emailService } from '../src/services/email.service';
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

describe('forgot-password with failing SMTP delivery', () => {
  it('returns the same 200 body for a registered and an unknown address', async () => {
    const { admin } = await createTestCompany(app, 'reset-smtp-fail');
    const send = jest
      .spyOn(emailService, 'sendPasswordResetEmail')
      .mockRejectedValue(new Error('[email] password reset email delivery failed (code: ECONNREFUSED)'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const known = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: admin.email },
    });
    const unknown = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'nobody@nowhere.test' },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json().message).toBe(unknown.json().message);

    // The failure is logged without the address or the link.
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('password reset email delivery failed');
    expect(logged).not.toContain(admin.email);
    expect(logged).not.toContain('token=');
  });

  it('still issues a usable reset token when delivery fails', async () => {
    const { admin } = await createTestCompany(app, 'reset-smtp-fail-token');
    jest.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValue(new Error('down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: admin.email },
    });
    const tokens = await prisma.passwordResetToken.count({ where: { userId: admin.id, usedAt: null } });
    expect(tokens).toBe(1);
  });
});
