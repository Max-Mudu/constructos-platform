/**
 * Production-security hardening:
 *  1. Reset / setup links never reach production logs; account-setup email.
 *  2. trustProxy is explicit and env-configured (safe default: no trust).
 *  3. Public self-registration is gated server-side.
 *  4. Query strings (SSE ?token=) are stripped from logs; SSE can be disabled
 *     and rejects deactivated users.
 *
 * Runtime toggles mutate fields on the shared `env` object and are always
 * restored in `finally` / afterEach so no other test sees the change.
 */
import { Writable } from 'stream';
import { FastifyInstance } from 'fastify';

// The email service imports nodemailer lazily; mock it so no test can ever
// open a real SMTP connection.
const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: sendMailMock })) },
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

import { buildApp, stripQueryString } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env, parseTrustProxy, parseEnvFlag, flagDefaultOffInProduction } from '../src/utils/env';
import { emailService } from '../src/services/email.service';
import { createTestCompany, createTestUser, clearDatabase } from './helpers/fixtures';

type MutableEnv = Record<string, unknown>;

/** Temporarily override env fields for the duration of `fn`. */
async function withEnv<T>(overrides: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const mutable = env as unknown as MutableEnv;
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = mutable[key];
    mutable[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) mutable[key] = saved[key];
  }
}

/** Captures everything written to console.* while `fn` runs. */
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const record = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(record),
  );
  try {
    const result = await fn();
    return { result, output: lines.join('\n') };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}

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
  sendMailMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── 1. Reset / setup links ───────────────────────────────────────────────────

describe('email service — links never logged in production', () => {
  const LINK = 'http://app.test/reset-password?token=SECRET_TOKEN_abc123';

  it('production + SMTP unset: password reset logs neither link, token nor recipient', async () => {
    const { output } = await withEnv({ isProduction: true, SMTP_HOST: '' }, () =>
      captureConsole(() => emailService.sendPasswordResetEmail('victim@example.com', LINK)),
    );
    expect(output).toContain('not sent');
    expect(output).not.toContain('SECRET_TOKEN_abc123');
    expect(output).not.toContain('reset-password?token');
    expect(output).not.toContain('victim@example.com');
  });

  it('production + SMTP unset: account setup email logs no link and reports not delivered', async () => {
    const { result, output } = await withEnv({ isProduction: true, SMTP_HOST: '' }, () =>
      captureConsole(() => emailService.sendAccountSetupEmail('new@example.com', LINK)),
    );
    expect(result).toBe(false);
    expect(output).toContain('not sent');
    expect(output).not.toContain('SECRET_TOKEN_abc123');
    expect(output).not.toContain('new@example.com');
  });

  it('positive control: development + SMTP unset still logs the link for local use', async () => {
    const { output } = await withEnv({ isProduction: false, SMTP_HOST: '' }, () =>
      captureConsole(() => emailService.sendPasswordResetEmail('dev@example.com', LINK)),
    );
    expect(output).toContain('SECRET_TOKEN_abc123');
  });

  it('SMTP configured: account setup email is sent with the link and nothing is logged', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });
    const { result, output } = await withEnv({ isProduction: true, SMTP_HOST: 'smtp.invalid.test' }, () =>
      captureConsole(() => emailService.sendAccountSetupEmail('new@example.com', LINK)),
    );
    expect(result).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0] as { to: string; subject: string; text: string; html: string };
    expect(mail.to).toBe('new@example.com');
    expect(mail.subject).toMatch(/set up/i);
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain(LINK);
    expect(output).not.toContain('SECRET_TOKEN_abc123');
  });

  it('SMTP failure: the thrown error never carries the link', async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error(`smtp rejected ${LINK}`), { code: 'EENVELOPE' }));
    await withEnv({ isProduction: true, SMTP_HOST: 'smtp.invalid.test' }, async () => {
      let caught: unknown;
      try {
        await emailService.sendPasswordResetEmail('x@example.com', LINK);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).message)).not.toContain('SECRET_TOKEN_abc123');
      expect(String((caught as Error).stack)).not.toContain('SECRET_TOKEN_abc123');
      expect(JSON.stringify(caught)).not.toContain('SECRET_TOKEN_abc123');
    });
  });
});

describe('POST /companies/me/users — account setup email', () => {
  const ENDPOINT = '/api/v1/companies/me/users';
  const body = {
    email: 'setup.user@test.com', firstName: 'Setup', lastName: 'User', role: 'finance_officer',
  };

  it('sends the setup link by email and still returns setupLink outside production', async () => {
    const { admin } = await createTestCompany(app, 'ps-setup-dev');
    const spy = jest.spyOn(emailService, 'sendAccountSetupEmail').mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST', url: ENDPOINT, headers: { authorization: `Bearer ${admin.accessToken}` }, payload: body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.setupLink).toContain('/reset-password?token=');
    expect(json.setupEmailSent).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('setup.user@test.com', json.setupLink);
  });

  it('production: no setupLink in the response, link only in the email, never in logs', async () => {
    const { admin } = await createTestCompany(app, 'ps-setup-prod');
    let emailedLink = '';
    jest.spyOn(emailService, 'sendAccountSetupEmail').mockImplementation(async (_to, link) => {
      emailedLink = link;
      return true;
    });

    const { result: res, output } = await withEnv({ isProduction: true }, () =>
      captureConsole(() => app.inject({
        method: 'POST', url: ENDPOINT, headers: { authorization: `Bearer ${admin.accessToken}` }, payload: body,
      })),
    );

    expect(res.statusCode).toBe(201);
    expect(res.json().setupLink).toBeUndefined();
    expect(res.json().setupEmailSent).toBe(true);
    const token = emailedLink.split('token=')[1]!;
    expect(token.length).toBeGreaterThan(32);
    expect(res.body).not.toContain(token);
    expect(output).not.toContain(token);
  });

  it('email failure does not fail user creation and does not log the token', async () => {
    const { admin } = await createTestCompany(app, 'ps-setup-fail');
    let emailedLink = '';
    jest.spyOn(emailService, 'sendAccountSetupEmail').mockImplementation(async (_to, link) => {
      emailedLink = link;
      throw new Error(`boom ${link}`);
    });

    const { result: res, output } = await withEnv({ isProduction: true }, () =>
      captureConsole(() => app.inject({
        method: 'POST', url: ENDPOINT, headers: { authorization: `Bearer ${admin.accessToken}` }, payload: body,
      })),
    );

    expect(res.statusCode).toBe(201);
    expect(res.json().setupEmailSent).toBe(false);
    expect(await prisma.user.count({ where: { email: body.email } })).toBe(1);
    const token = emailedLink.split('token=')[1]!;
    expect(output).toContain('setup email');
    expect(output).not.toContain(token);
  });
});

// ─── 2. trustProxy ────────────────────────────────────────────────────────────

describe('TRUST_PROXY parsing', () => {
  it('defaults to no proxy trust', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('accepts a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('accepts a list of IPs / CIDRs / proxy-addr presets', () => {
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1,::1')).toEqual(['10.0.0.0/8', '127.0.0.1', '::1']);
    expect(parseTrustProxy('loopback,fd00::/8')).toEqual(['loopback', 'fd00::/8']);
  });

  it('rejects unrestricted trust and malformed entries', () => {
    expect(() => parseTrustProxy('true')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('not-an-ip')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('10.0.0.0/99')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('-1')).toThrow(/TRUST_PROXY/);
  });
});

describe('request.ip and X-Forwarded-For', () => {
  async function ipSeenBy(trustProxy: unknown): Promise<string> {
    return withEnv({ TRUST_PROXY: trustProxy }, async () => {
      const probe = await buildApp();
      probe.get('/__probe/ip', async (req) => ({ ip: req.ip }));
      await probe.ready();
      try {
        const res = await probe.inject({
          method: 'GET',
          url: '/__probe/ip',
          remoteAddress: '127.0.0.1',
          headers: { 'x-forwarded-for': '203.0.113.9' },
        });
        return res.json().ip as string;
      } finally {
        await probe.close();
      }
    });
  }

  it('default config ignores a spoofed X-Forwarded-For', async () => {
    expect(env.TRUST_PROXY).toBe(false); // test env sets no TRUST_PROXY
    expect(await ipSeenBy(env.TRUST_PROXY)).toBe('127.0.0.1');
  });

  it('positive control: a trusted proxy address makes X-Forwarded-For effective', async () => {
    expect(await ipSeenBy(['127.0.0.1'])).toBe('203.0.113.9');
    expect(await ipSeenBy(1)).toBe('203.0.113.9');
  });
});

// ─── 3. Public registration ───────────────────────────────────────────────────

describe('env flag parsing', () => {
  it('parses strict true/false and rejects anything else', () => {
    expect(parseEnvFlag('X', 'true', false)).toBe(true);
    expect(parseEnvFlag('X', ' TRUE ', false)).toBe(true);
    expect(parseEnvFlag('X', 'false', true)).toBe(false);
    expect(parseEnvFlag('X', undefined, true)).toBe(true);
    expect(parseEnvFlag('X', '', false)).toBe(false);
    expect(() => parseEnvFlag('X', 'yes', false)).toThrow(/X/);
  });

  it('defaults on outside production and off in production', () => {
    expect(flagDefaultOffInProduction('X', undefined, false)).toBe(true);
    expect(flagDefaultOffInProduction('X', undefined, true)).toBe(false);
    expect(flagDefaultOffInProduction('X', 'true', true)).toBe(true);
    expect(flagDefaultOffInProduction('X', 'false', false)).toBe(false);
  });
});

describe('POST /auth/register — server-side gate', () => {
  const payload = {
    email: 'self.signup@test.com', password: 'Password1', firstName: 'Self', lastName: 'Signup',
    companyName: 'Self Signup Co',
  };

  it('is enabled by default in the test environment', () => {
    expect(env.ALLOW_PUBLIC_REGISTRATION).toBe(true);
  });

  it('returns 403 REGISTRATION_DISABLED and creates nothing when disabled', async () => {
    const res = await withEnv({ ALLOW_PUBLIC_REGISTRATION: false }, () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('REGISTRATION_DISABLED');
    expect(await prisma.user.count({ where: { email: payload.email } })).toBe(0);
    expect(await prisma.company.count()).toBe(0);
  });

  it('rejects before validation when disabled (no field-level detail leaks)', async () => {
    const res = await withEnv({ ALLOW_PUBLIC_REGISTRATION: false }, () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {} }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('REGISTRATION_DISABLED');
  });

  it('registers normally when enabled', async () => {
    const res = await withEnv({ ALLOW_PUBLIC_REGISTRATION: true }, () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe(payload.email);
  });

  it('login is unaffected by the registration gate', async () => {
    const { admin } = await createTestCompany(app, 'ps-reg-login');
    const res = await withEnv({ ALLOW_PUBLIC_REGISTRATION: false }, () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: admin.email, password: 'TestPass1' } }),
    );
    expect(res.statusCode).toBe(200);
  });
});

// ─── 4. Log redaction + SSE gate ──────────────────────────────────────────────

describe('stripQueryString', () => {
  it('removes the query string and fragment', () => {
    expect(stripQueryString('/api/v1/events?token=abc')).toBe('/api/v1/events');
    expect(stripQueryString('/a/b#frag')).toBe('/a/b');
    expect(stripQueryString('/plain')).toBe('/plain');
    expect(stripQueryString(undefined)).toBeUndefined();
  });
});

describe('request logging never contains query strings', () => {
  let logApp: FastifyInstance;
  let logs: string[];

  beforeAll(async () => {
    logs = [];
    const stream = new Writable({
      write(chunk, _enc, cb) { logs.push(chunk.toString()); cb(); },
    });
    logApp = await buildApp({ logStream: stream });
    logApp.get('/__probe/boom', async () => { throw new Error('kaboom'); });
    await logApp.ready();
  });

  afterAll(async () => {
    await logApp.close();
  });

  beforeEach(() => { logs.length = 0; });

  it('SSE ?token= is not written to the request log', async () => {
    const { admin } = await createTestCompany(app, 'ps-log-sse');
    const res = await logApp.inject({ method: 'GET', url: `/api/v1/events?token=${admin.accessToken}` });
    expect(res.statusCode).toBe(200);
    const text = logs.join('');
    expect(text).toContain('/api/v1/events'); // positive control: the request was logged
    expect(text).toContain('incoming request');
    expect(text).not.toContain(admin.accessToken);
    expect(text).not.toContain('token=');
  });

  it('error handler logs the path without the query string', async () => {
    const res = await logApp.inject({ method: 'GET', url: '/__probe/boom?token=ERRSECRET123' });
    expect(res.statusCode).toBe(500);
    const text = logs.join('');
    expect(text).toContain('Unhandled server error');
    expect(text).toContain('/__probe/boom');
    expect(text).not.toContain('ERRSECRET123');
  });

  it('JWT-failure warnings from authenticate are redacted too', async () => {
    const res = await logApp.inject({ method: 'GET', url: '/api/v1/auth/me?token=AUTHSECRET456' });
    expect(res.statusCode).toBe(401);
    const text = logs.join('');
    expect(text).toContain('JWT verification failed');
    expect(text).not.toContain('AUTHSECRET456');
  });

  it('404s neither log nor echo the query string', async () => {
    const res = await logApp.inject({ method: 'GET', url: '/no/such/route?token=NOTFOUNDSECRET' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('NOTFOUNDSECRET');
    expect(logs.join('')).not.toContain('NOTFOUNDSECRET');
  });
});

describe('GET /events — SSE_ENABLED gate', () => {
  it('is enabled by default in the test environment', () => {
    expect(env.SSE_ENABLED).toBe(true);
  });

  it('when disabled returns 404 SSE_DISABLED before the token is verified', async () => {
    const { admin } = await createTestCompany(app, 'ps-sse-off');
    const verifySpy = jest.spyOn(app.jwt, 'verify');

    const res = await withEnv({ SSE_ENABLED: false }, () =>
      app.inject({ method: 'GET', url: `/api/v1/events?token=${admin.accessToken}` }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SSE_DISABLED');
    expect(res.headers['content-type']).not.toContain('text/event-stream');
    expect(verifySpy).not.toHaveBeenCalled();

    const noToken = await withEnv({ SSE_ENABLED: false }, () =>
      app.inject({ method: 'GET', url: '/api/v1/events' }),
    );
    expect(noToken.statusCode).toBe(404);
    expect(noToken.json().code).toBe('SSE_DISABLED');
  });

  it('when enabled rejects a deactivated user with 401', async () => {
    const { company } = await createTestCompany(app, 'ps-sse-inactive');
    const user = await createTestUser(app, company.id, 'project_manager', 'ps-sse-inactive');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/events?token=${user.accessToken}` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).not.toContain('text/event-stream');
  });

  it('when enabled still streams for an active user', async () => {
    const { admin } = await createTestCompany(app, 'ps-sse-active');
    const res = await app.inject({ method: 'GET', url: `/api/v1/events?token=${admin.accessToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: connected');
  });
});
