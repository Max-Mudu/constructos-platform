/**
 * Rate-limit keys (utils/rate-limit.ts).
 *
 *  - Default (RATE_LIMIT_PER_USER unset): every request is counted per client
 *    address, exactly as before.
 *  - RATE_LIMIT_PER_USER=true: a request whose access token verifies is counted
 *    per user; anything else per address. Every address is also capped at
 *    RATE_LIMIT_ADDRESS_MAX requests per minute, all users together.
 *  - Sign-in, refresh, registration, forgot-password, reset-password and the
 *    setup-link route are always counted per address, with unchanged numbers.
 *
 * Rate limiting is off under NODE_ENV=test; each test builds its own app with
 * the `rateLimit` test hook, so every test starts from empty counters. Tokens
 * are signed for users that need not exist: the limit is applied before the
 * route authenticates, so every request counts whatever its final status.
 */
import { createHmac, randomUUID } from 'crypto';
import { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import { AddressCeiling, GENERAL_RATE_LIMIT } from '../src/utils/rate-limit';

type MutableEnv = Record<string, unknown>;

const ADDRESS_A = '198.51.100.10';
const ADDRESS_B = '198.51.100.20';
const ADDRESS_C = '198.51.100.30';

const ME = '/api/v1/auth/me';

let app: FastifyInstance | null = null;

/** Builds an app with rate limiting on and the given RATE_LIMIT_* settings. */
async function appWith(settings: { perUser: boolean; addressMax?: number }): Promise<FastifyInstance> {
  const mutable = env as unknown as MutableEnv;
  const saved = { p: mutable['RATE_LIMIT_PER_USER'], m: mutable['RATE_LIMIT_ADDRESS_MAX'] };
  mutable['RATE_LIMIT_PER_USER'] = settings.perUser;
  if (settings.addressMax !== undefined) mutable['RATE_LIMIT_ADDRESS_MAX'] = settings.addressMax;
  try {
    app = await buildApp({ rateLimit: true });
    await app.ready();
    return app;
  } finally {
    mutable['RATE_LIMIT_PER_USER'] = saved.p;
    mutable['RATE_LIMIT_ADDRESS_MAX'] = saved.m;
  }
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function tokenFor(a: FastifyInstance, userId: string = randomUUID()): string {
  return a.jwt.sign({
    sub: userId, email: `${userId}@test.com`, role: 'company_admin',
    companyId: randomUUID(), canViewFinance: true,
  });
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An HS256 token signed with a key other than JWT_SECRET. */
function foreignToken(): string {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub: randomUUID(), companyId: randomUUID(), role: 'company_admin', iat: Math.floor(Date.now() / 1000) });
  const sig = createHmac('sha256', 'some-other-key-that-is-not-the-api-secret').update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** An unsigned token. */
function unsignedToken(): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: randomUUID(), companyId: randomUUID() })}.`;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Sends `count` requests and returns their status codes. */
async function send(a: FastifyInstance, count: number, request: () => InjectOptions): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = await a.inject(request());
    statuses.push(res.statusCode);
  }
  return statuses;
}

const limited = (statuses: number[]) => statuses.filter((s) => s === 429).length;

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('defaults', () => {
  it('per-user keys are off and the address cap is 1000 per minute', () => {
    expect(env.RATE_LIMIT_PER_USER).toBe(false);
    expect(env.RATE_LIMIT_ADDRESS_MAX).toBe(1000);
    expect(GENERAL_RATE_LIMIT).toEqual({ max: 100, timeWindowMs: 60_000 });
  });

  it('without RATE_LIMIT_PER_USER, all users at one address share one allowance (unchanged)', async () => {
    const a = await appWith({ perUser: false });
    const userOne = tokenFor(a);
    const userTwo = tokenFor(a);
    const first = await send(a, 100, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userOne) }));
    expect(limited(first)).toBe(0);
    const res = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userTwo) });
    expect(res.statusCode).toBe(429);
    expect(String(res.headers['x-ratelimit-limit'])).toBe('100');
    // Another address has its own allowance.
    const other = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_B, headers: bearer(userOne) });
    expect(other.statusCode).not.toBe(429);
  });
});

// ─── Per-user keys ───────────────────────────────────────────────────────────

describe('RATE_LIMIT_PER_USER=true', () => {
  it('counts a request with a valid access token per user', async () => {
    const a = await appWith({ perUser: true });
    const userOne = tokenFor(a);
    const userTwo = tokenFor(a);
    const first = await send(a, 100, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userOne) }));
    expect(limited(first)).toBe(0);
    const over = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userOne) });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe('Rate limit exceeded, retry in 1 minute');
    // Another user at the same address, and an unauthenticated request there, are unaffected.
    const second = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userTwo) });
    expect(second.statusCode).not.toBe(429);
    const anonymous = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A });
    expect(anonymous.statusCode).not.toBe(429);
  });

  it('a user keeps one allowance across addresses', async () => {
    const a = await appWith({ perUser: true });
    const user = tokenFor(a);
    const fromA = await send(a, 50, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(user) }));
    const fromB = await send(a, 50, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_B, headers: bearer(user) }));
    expect(limited([...fromA, ...fromB])).toBe(0);
    const res = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_C, headers: bearer(user) });
    expect(res.statusCode).toBe(429);
  });

  it('counts a request without a token per address', async () => {
    const a = await appWith({ perUser: true });
    const first = await send(a, 100, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A }));
    expect(limited(first)).toBe(0);
    expect((await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A })).statusCode).toBe(429);
    expect((await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_B })).statusCode).not.toBe(429);
  });

  it('counts unverifiable tokens per address, whatever user they name', async () => {
    const a = await appWith({ perUser: true });
    const expired = a.jwt.sign({
      sub: randomUUID(), email: 'x@test.com', role: 'company_admin', companyId: randomUUID(),
      canViewFinance: true, exp: Math.floor(Date.now() / 1000) - 60,
    });
    const noSubject = a.jwt.sign({ companyId: randomUUID() } as never);
    expect(() => a.jwt.verify(expired)).toThrow();
    const kinds: Array<() => Record<string, string>> = [
      () => bearer(foreignToken()),
      () => bearer(unsignedToken()),
      () => bearer(expired),
      () => bearer('not-a-jwt'),
      () => bearer(noSubject),
      () => ({ authorization: `Bearer ${tokenFor(a)} extra` }),
      () => ({ authorization: `Basic ${tokenFor(a)}` }),
    ];
    // 100 requests, each naming a different (or no) user: one address allowance.
    let i = 0;
    const statuses = await send(a, 100, () => ({
      method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: kinds[i++ % kinds.length]!(),
    }));
    expect(limited(statuses)).toBe(0);
    for (const kind of kinds) {
      const res = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: kind() });
      expect(res.statusCode).toBe(429);
    }
  });

  it('caps one address at RATE_LIMIT_ADDRESS_MAX per minute, all users together', async () => {
    const a = await appWith({ perUser: true, addressMax: 150 });
    const userOne = tokenFor(a);
    const userTwo = tokenFor(a);
    const one = await send(a, 100, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userOne) }));
    const two = await send(a, 50, () => ({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userTwo) }));
    expect(limited([...one, ...two])).toBe(0);
    // userTwo has used 50 of its own 100, but the address has reached 150.
    const capped = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(userTwo) });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toBe('Rate limit exceeded, retry in 1 minute');
    expect(Number(capped.headers['retry-after'])).toBeGreaterThan(0);
    const newUser = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) });
    expect(newUser.statusCode).toBe(429);
    const anonymous = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_A });
    expect(anonymous.statusCode).toBe(429);
    // The same users from another address are not capped by this one.
    const elsewhere = await a.inject({ method: 'GET', url: ME, remoteAddress: ADDRESS_B, headers: bearer(userTwo) });
    expect(elsewhere.statusCode).not.toBe(429);
  });

  it('cycling many users from one address stops at the address cap', async () => {
    const a = await appWith({ perUser: true, addressMax: 120 });
    const statuses = await send(a, 200, () => ({
      method: 'GET', url: ME, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)),
    }));
    expect(statuses.slice(0, 120).every((s) => s !== 429)).toBe(true);
    expect(limited(statuses.slice(120))).toBe(80);
  });

  it('the AI extract limit (6 per minute) is per user', async () => {
    const a = await appWith({ perUser: true });
    const url = `/api/v1/projects/${randomUUID()}/sites/${randomUUID()}/daily-reports/${randomUUID()}/extract`;
    const userOne = tokenFor(a);
    const first = await send(a, 6, () => ({ method: 'POST', url, remoteAddress: ADDRESS_A, headers: bearer(userOne) }));
    expect(limited(first)).toBe(0);
    const over = await a.inject({ method: 'POST', url, remoteAddress: ADDRESS_A, headers: bearer(userOne) });
    expect(over.statusCode).toBe(429);
    expect(String(over.headers['x-ratelimit-limit'])).toBe('6');
    const other = await a.inject({ method: 'POST', url, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) });
    expect(other.statusCode).not.toBe(429);
  });
});

// ─── Routes that stay per address ────────────────────────────────────────────

describe.each([
  ['off', false],
  ['on', true],
])('routes counted per address (RATE_LIMIT_PER_USER %s)', (_label, perUser) => {
  const generalRoutes: Array<[string, InjectOptions]> = [
    ['POST /auth/login',          { method: 'POST', url: '/api/v1/auth/login', payload: {} }],
    ['POST /auth/refresh',        { method: 'POST', url: '/api/v1/auth/refresh', payload: {} }],
    ['POST /auth/register',       { method: 'POST', url: '/api/v1/auth/register', payload: {} }],
    ['POST /auth/reset-password', { method: 'POST', url: '/api/v1/auth/reset-password', payload: {} }],
  ];

  it.each(generalRoutes)('%s: 100 per minute per address, whatever token is sent', async (_name, request) => {
    const a = await appWith({ perUser });
    const statuses = await send(a, 100, () => ({ ...request, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) }));
    expect(limited(statuses)).toBe(0);
    const over = await a.inject({ ...request, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) });
    expect(over.statusCode).toBe(429);
    expect(String(over.headers['x-ratelimit-limit'])).toBe('100');
    const elsewhere = await a.inject({ ...request, remoteAddress: ADDRESS_B, headers: bearer(tokenFor(a)) });
    expect(elsewhere.statusCode).not.toBe(429);
  });

  it('POST /auth/forgot-password: 5 per 15 minutes per address, whatever token is sent', async () => {
    const a = await appWith({ perUser });
    const request: InjectOptions = { method: 'POST', url: '/api/v1/auth/forgot-password', payload: {} };
    const statuses = await send(a, 5, () => ({ ...request, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) }));
    expect(limited(statuses)).toBe(0);
    const over = await a.inject({ ...request, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) });
    expect(over.statusCode).toBe(429);
    expect(String(over.headers['x-ratelimit-limit'])).toBe('5');
    expect(Number(over.headers['x-ratelimit-reset'])).toBeGreaterThan(60);
    expect((await a.inject({ ...request, remoteAddress: ADDRESS_B })).statusCode).not.toBe(429);
  });

  it('POST /companies/me/users/:id/setup-link: 10 per 15 minutes per address, whatever token is sent', async () => {
    const a = await appWith({ perUser });
    const url = `/api/v1/companies/me/users/${randomUUID()}/setup-link`;
    const statuses = await send(a, 10, () => ({ method: 'POST', url, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) }));
    expect(limited(statuses)).toBe(0);
    const over = await a.inject({ method: 'POST', url, remoteAddress: ADDRESS_A, headers: bearer(tokenFor(a)) });
    expect(over.statusCode).toBe(429);
    expect(String(over.headers['x-ratelimit-limit'])).toBe('10');
    expect(Number(over.headers['x-ratelimit-reset'])).toBeGreaterThan(60);
  });
});

// ─── AddressCeiling ──────────────────────────────────────────────────────────

describe('AddressCeiling', () => {
  it('allows max requests per window and starts a new window after it ends', () => {
    let now = 1_000_000;
    const ceiling = new AddressCeiling(3, 60_000, 100, () => now);
    expect([1, 2, 3, 4].map(() => ceiling.hit('a').allowed)).toEqual([true, true, true, false]);
    expect(ceiling.hit('b').allowed).toBe(true);
    now += 30_000;
    const blocked = ceiling.hit('a');
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 30 });
    now += 30_000;
    expect(ceiling.hit('a').allowed).toBe(true);
  });

  it('tracks a bounded number of addresses, dropping ended windows first', () => {
    let now = 0;
    const ceiling = new AddressCeiling(5, 1_000, 3, () => now);
    ceiling.hit('a');
    ceiling.hit('b');
    now = 500;
    ceiling.hit('c');
    expect(ceiling.size).toBe(3);
    now = 1_200; // a and b have ended, c has not
    ceiling.hit('d');
    expect(ceiling.size).toBe(2);
    ceiling.hit('e');
    ceiling.hit('f'); // full of live windows: the oldest (c) is dropped
    expect(ceiling.size).toBe(3);
    for (let i = 0; i < 50; i++) ceiling.hit(`x${i}`);
    expect(ceiling.size).toBeLessThanOrEqual(3);
  });
});
