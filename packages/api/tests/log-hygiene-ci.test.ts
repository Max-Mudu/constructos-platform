/**
 * Log hygiene under CI: one-time account links, passwords and bearer tokens
 * never reach stdout, stderr or the request logger when the CI variable is
 * set, even outside production. The API responses are unchanged (setupLink /
 * devLink are still returned outside production, which CI scripts rely on).
 */
import { Writable } from 'stream';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env, isCiEnvironment } from '../src/utils/env';
import { createTestCompany, clearDatabase } from './helpers/fixtures';

type MutableEnv = Record<string, unknown>;

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

/** Captures console.*, process.stdout and process.stderr while `fn` runs. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const record = (...args: unknown[]) => { chunks.push(args.map(String).join(' ')); };
  const spies: jest.SpyInstance[] = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(record),
  );
  const writeSpy = (stream: NodeJS.WriteStream) =>
    jest.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never);
  spies.push(writeSpy(process.stdout), writeSpy(process.stderr));
  try {
    const result = await fn();
    return { result, output: chunks.join('\n') };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}

const logLines: string[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  const stream = new Writable({
    write(chunk, _enc, cb) { logLines.push(chunk.toString()); cb(); },
  });
  app = await buildApp({ logStream: stream });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
  logLines.length = 0;
});

afterEach(() => jest.restoreAllMocks());

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

describe('CI detection', () => {
  it('treats CI=true / 1 / any other non-empty value as CI, and unset / false / 0 as not CI', () => {
    expect(isCiEnvironment('true')).toBe(true);
    expect(isCiEnvironment('1')).toBe(true);
    expect(isCiEnvironment('TRUE')).toBe(true);
    expect(isCiEnvironment(undefined)).toBe(false);
    expect(isCiEnvironment('')).toBe(false);
    expect(isCiEnvironment('false')).toBe(false);
    expect(isCiEnvironment('0')).toBe(false);
  });

  it('env.isCI follows process.env.CI at load time', () => {
    const saved = process.env['CI'];
    try {
      for (const [raw, expected] of [['true', true], ['', false]] as const) {
        process.env['CI'] = raw;
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fresh = require('../src/utils/env') as typeof import('../src/utils/env');
          expect(fresh.env.isCI).toBe(expected);
        });
      }
    } finally {
      if (saved === undefined) delete process.env['CI'];
      else process.env['CI'] = saved;
    }
  });
});

describe('development mode with CI set: no credential in any output', () => {
  it('create user, set password, log in, request a reset, call with bearer: nothing secret is printed', async () => {
    const password = 'ChosenPass1!';
    const { result, output } = await withEnv({ isProduction: false, isCI: true, SMTP_HOST: '' }, () =>
      captureOutput(async () => {
        const { admin } = await createTestCompany(app, 'loghyg');
        const created = await app.inject({
          method: 'POST',
          url: '/api/v1/companies/me/users',
          headers: { authorization: `Bearer ${admin.accessToken}` },
          payload: { email: 'loghyg.user@test.com', firstName: 'Log', lastName: 'Hyg', role: 'finance_officer' },
        });
        const setupLink = created.json().setupLink as string;

        const setPw = await app.inject({
          method: 'POST', url: '/api/v1/auth/reset-password',
          payload: { token: tokenOf(setupLink), password },
        });
        const login = await app.inject({
          method: 'POST', url: '/api/v1/auth/login',
          payload: { email: 'loghyg.user@test.com', password },
        });
        const { accessToken, refreshToken } = login.json() as { accessToken: string; refreshToken: string };

        const forgot = await app.inject({
          method: 'POST', url: '/api/v1/auth/forgot-password',
          payload: { email: 'loghyg.user@test.com' },
        });
        const devLink = forgot.json().devLink as string;

        const me = await app.inject({
          method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` },
        });
        const badBearer = 'not.a.valid-jwt-value-loghyg';
        const bad = await app.inject({
          method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${badBearer}` },
        });
        // Query-string token on an unknown route (logged as "Route not found").
        const notFound = await app.inject({ method: 'GET', url: `/api/v1/nope?token=${accessToken}` });
        // A future log call that passes headers or a body must be redacted.
        app.log.info({
          headers: { authorization: `Bearer ${accessToken}`, cookie: `refreshToken=${refreshToken}` },
          body: { password, token: tokenOf(devLink) },
        }, 'diagnostic');

        return {
          statuses: [created.statusCode, setPw.statusCode, login.statusCode, forgot.statusCode,
            me.statusCode, bad.statusCode, notFound.statusCode],
          secrets: { setupToken: tokenOf(setupLink), resetToken: tokenOf(devLink), password,
            accessToken, refreshToken, badBearer, adminToken: admin.accessToken },
        };
      }),
    );

    // The flow worked and the API still returns the links outside production.
    expect(result.statuses).toEqual([201, 200, 200, 200, 200, 401, 404]);
    expect(result.secrets.setupToken).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(result.secrets.resetToken).toMatch(/^[A-Za-z0-9]{16,}$/);

    const logs = logLines.join('');
    const everything = `${output}\n${logs}`;
    const leaked = Object.entries(result.secrets)
      .filter(([, value]) => everything.includes(value))
      .map(([name]) => name);
    expect(leaked).toEqual([]);
    expect(everything).not.toMatch(/token=[A-Za-z0-9]{16,}/);
    expect(everything).not.toContain('loghyg.user@test.com →');

    // The captures saw output (so an empty capture cannot pass the test).
    expect(output).toContain('link not printed in CI');
    expect(logs).toContain('incoming request');
    expect(logs).toContain('[redacted]');
  });

  it('local development (CI unset) still prints the link for the developer', async () => {
    const { output } = await withEnv({ isProduction: false, isCI: false, SMTP_HOST: '' }, () =>
      captureOutput(async () => {
        const { admin } = await createTestCompany(app, 'loghyg-dev');
        await app.inject({
          method: 'POST',
          url: '/api/v1/companies/me/users',
          headers: { authorization: `Bearer ${admin.accessToken}` },
          payload: { email: 'loghyg.dev@test.com', firstName: 'Log', lastName: 'Dev', role: 'finance_officer' },
        });
      }),
    );
    expect(output).toMatch(/\[email-dev\] account setup for loghyg\.dev@test\.com → \S+token=/);
  });

  it('production with CI set: unchanged, nothing about the link is printed and no link is returned', async () => {
    const { result, output } = await withEnv({ isProduction: true, isCI: true, SMTP_HOST: '' }, () =>
      captureOutput(async () => {
        const { admin } = await createTestCompany(app, 'loghyg-prod');
        return app.inject({
          method: 'POST',
          url: '/api/v1/companies/me/users',
          headers: { authorization: `Bearer ${admin.accessToken}` },
          payload: { email: 'loghyg.prod@test.com', firstName: 'Log', lastName: 'Prod', role: 'finance_officer' },
        });
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(result.json().setupLink).toBeUndefined();
    expect(output).toContain('not sent');
    expect(output).not.toMatch(/token=/);
    expect(output).not.toContain('loghyg.prod@test.com');
  });
});
