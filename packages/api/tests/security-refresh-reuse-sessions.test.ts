/**
 * NEEDS OWNER APPROVAL — authentication behaviour change.
 *
 * When a refresh token that was already revoked is presented again (reuse
 * detection), every session of that user ends at once: the session version is
 * bumped (so access tokens already issued are refused immediately), every
 * refresh token is revoked, and the user's registered push devices are
 * removed, all in one transaction with an audit row that records counts only.
 * The user signs in again and the device registers again. Other users and
 * other companies are unaffected.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { createNotification } from '../src/services/notification.service';
import { heartbeatOrClose } from '../src/routes/events.routes';
import { JwtPayload } from '../src/types';
import { createTestCompany, createTestUser, clearDatabase, TestUser } from './helpers/fixtures';

let app: FastifyInstance;
let cid: string;
let otherCid: string;

const realFetch = global.fetch;
let sent: string[] = [];
let warned: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();
  cid = (await createTestCompany(app, 'reuse-sessions')).company.id;
  otherCid = (await createTestCompany(app, 'reuse-sessions-other')).company.id;
});

beforeEach(() => {
  sent = [];
  warned = [];
  global.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(String(init?.body ?? ''));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── helpers ────────────────────────────────────────────────────────────────

interface Session { accessToken: string; refreshToken: string }

async function signIn(email: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'TestPass1' } });
  expect(res.statusCode).toBe(200);
  return { accessToken: res.json().accessToken, refreshToken: res.json().refreshToken };
}

function refresh(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

function me(accessToken: string) {
  return app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
}

function registerDevice(accessToken: string, token: string) {
  return app.inject({
    method: 'POST', url: '/api/v1/notifications/push-token',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { token, platform: 'expo' },
  });
}

async function registerOk(accessToken: string, token: string) {
  expect((await registerDevice(accessToken, token)).statusCode).toBe(204);
}

function notify(companyId: string, userId: string) {
  return createNotification({
    companyId, userId, type: 'invoice_status_changed',
    title: 'Invoice REUSE-1 approved', body: 'Invoice for Vendor has been approved.',
  });
}

function devices(userId: string) {
  return prisma.pushToken.count({ where: { userId } });
}

function reuseAudits(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId, entityType: 'auth', changesAfter: { path: ['event'], equals: 'refresh_token_reuse_detected' } },
    orderBy: { createdAt: 'asc' },
  });
}

let seq = 0;
async function newUser(tag: string, companyId = cid): Promise<TestUser> {
  seq += 1;
  return createTestUser(app, companyId, 'finance_officer', `${tag}-${seq}`, { canViewFinance: true });
}

/**
 * Two sessions of one user: the legitimate client (which has rotated its
 * refresh token once) and a second holder of the first refresh token, which
 * replays it. Returns everything the tests need.
 */
async function rotatedSession(u: TestUser) {
  const first = await signIn(u.email);
  const rotated = await refresh(first.refreshToken);
  expect(rotated.statusCode).toBe(200);
  const legit: Session = { accessToken: rotated.json().accessToken, refreshToken: rotated.json().refreshToken };
  return { stale: first, legit };
}

// ─── reuse detection ────────────────────────────────────────────────────────

describe('refresh-token reuse ends every session and removes registered devices', () => {
  it('removes that user\'s devices only; no push reaches them; others still receive', async () => {
    const u = await newUser('reuse');
    const neighbour = await newUser('reuse-neighbour');
    const foreign = await newUser('reuse-foreign', otherCid);
    const { stale, legit } = await rotatedSession(u);
    await registerOk(legit.accessToken, 'ExponentPushToken[ru-legit]');
    await registerOk(stale.accessToken, 'ExponentPushToken[ru-other]');
    await registerOk((await signIn(neighbour.email)).accessToken, 'ExponentPushToken[ru-neighbour]');
    await registerOk((await signIn(foreign.email)).accessToken, 'ExponentPushToken[ru-foreign]');

    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);

    expect(await devices(u.id)).toBe(0);
    expect(await devices(neighbour.id)).toBe(1);
    expect(await devices(foreign.id)).toBe(1);
    await notify(cid, u.id);
    await notify(cid, neighbour.id);
    await notify(otherCid, foreign.id);
    const all = sent.join('');
    expect(all).not.toContain('ExponentPushToken[ru-legit]');
    expect(all).not.toContain('ExponentPushToken[ru-other]');
    expect(all).toContain('ExponentPushToken[ru-neighbour]');
    expect(all).toContain('ExponentPushToken[ru-foreign]');
  });

  it('refuses every access token issued before, at once, including for device registration', async () => {
    const u = await newUser('reuse-access');
    const { stale, legit } = await rotatedSession(u);
    expect((await me(legit.accessToken)).statusCode).toBe(200);

    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);

    expect((await me(legit.accessToken)).statusCode).toBe(401);
    expect((await me(stale.accessToken)).statusCode).toBe(401);
    expect((await registerDevice(stale.accessToken, 'ExponentPushToken[ra-again]')).statusCode).toBe(401);
    expect((await refresh(legit.refreshToken)).statusCode).toBe(401);
    expect(await devices(u.id)).toBe(0);
  });

  it('audits counts only, never device or refresh token values, and logs no token', async () => {
    const u = await newUser('reuse-audit');
    const { stale, legit } = await rotatedSession(u);
    await registerOk(legit.accessToken, 'ExponentPushToken[rau-1]');
    await registerOk(legit.accessToken, 'ExponentPushToken[rau-2]');

    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);

    const logs = await reuseAudits(u.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.companyId).toBe(cid);
    // The sign-in token was already rotated, so only the legitimate one was live.
    expect(logs[0]!.changesAfter).toEqual({
      event: 'refresh_token_reuse_detected', refreshTokensRevoked: 1, pushDevicesRemoved: 2,
      sessionVersionEnded: 0,
    });
    const json = JSON.stringify(logs[0]);
    expect(json).not.toContain('ExponentPushToken');
    expect(json).not.toContain(stale.refreshToken);
    expect(json).not.toContain(legit.refreshToken);
    const log = warned.join('\n');
    expect(log).toContain(u.id);
    expect(log).not.toContain(stale.refreshToken);
    expect(log).not.toContain('ExponentPushToken');
  });

  it('a user with no registered device: reuse is handled and audits 0', async () => {
    const u = await newUser('reuse-none');
    const { stale } = await rotatedSession(u);
    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);
    expect((await reuseAudits(u.id))[0]!.changesAfter).toMatchObject({ pushDevicesRemoved: 0 });
  });

  it('after a new sign-in the device registers again and receives pushes', async () => {
    const u = await newUser('reuse-relogin');
    const { stale, legit } = await rotatedSession(u);
    await registerOk(legit.accessToken, 'ExponentPushToken[rr-1]');
    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);

    const again = await signIn(u.email);
    expect((await me(again.accessToken)).statusCode).toBe(200);
    await registerOk(again.accessToken, 'ExponentPushToken[rr-1]');
    await notify(cid, u.id);
    expect(sent.join('')).toContain('ExponentPushToken[rr-1]');
    expect((await refresh(again.refreshToken)).statusCode).toBe(200);
  });
});

// Tokens from sessions that were already ended (signed out, password reset,
// account setup, deactivation, or ended after reuse was detected) are
// covered in security-refresh-ended-sessions.test.ts.

// ─── concurrency ────────────────────────────────────────────────────────────

describe('concurrent refreshes around reuse detection', () => {
  it('a legitimate refresh racing a replay never leaves a usable session (looped)', async () => {
    for (let i = 0; i < 6; i += 1) {
      const u = await newUser(`reuse-race-${i}`);
      const { stale, legit } = await rotatedSession(u);
      await registerOk(legit.accessToken, `ExponentPushToken[rrace-${i}]`);

      const [mine, replay] = await Promise.all([refresh(legit.refreshToken), refresh(stale.refreshToken)]);
      expect(replay.statusCode).toBe(401);
      expect([200, 401]).toContain(mine.statusCode);

      if (mine.statusCode === 200) {
        // A pair minted while the reuse was being handled must not outlive it.
        expect((await me(mine.json().accessToken)).statusCode).toBe(401);
        expect((await refresh(mine.json().refreshToken)).statusCode).toBe(401);
      }
      expect((await me(legit.accessToken)).statusCode).toBe(401);
      expect(await devices(u.id)).toBe(0);
    }
  });

  it('a pair minted by a refresh that was mid-rotation when reuse was handled is refused', async () => {
    const u = await newUser('reuse-held');
    const { stale, legit } = await rotatedSession(u);

    // Hold the legitimate refresh after it has rotated its token and just
    // before it stores the new one, run the replay, then let it finish.
    const realCreate = prisma.refreshToken.create.bind(prisma.refreshToken);
    let markEntered!: () => void;
    const entered = new Promise<void>((r) => { markEntered = r; });
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    const spy = jest.spyOn(prisma.refreshToken, 'create').mockImplementation(((args: unknown) => {
      markEntered();
      return released.then(() => (realCreate as (a: unknown) => Promise<unknown>)(args));
    }) as never);

    const pending = refresh(legit.refreshToken);
    await entered;
    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);
    release();
    const mine = await pending;
    spy.mockRestore();

    expect(mine.statusCode).toBe(200);
    expect((await me(mine.json().accessToken)).statusCode).toBe(401);
    expect((await refresh(mine.json().refreshToken)).statusCode).toBe(401);
  });

  it('a device registration racing a replay never survives it (looped)', async () => {
    for (let i = 0; i < 6; i += 1) {
      const u = await newUser(`reuse-reg-race-${i}`);
      const { stale, legit } = await rotatedSession(u);
      const [reg, replay] = await Promise.all([
        registerDevice(legit.accessToken, `ExponentPushToken[rreg-${i}]`),
        refresh(stale.refreshToken),
      ]);
      expect(replay.statusCode).toBe(401);
      expect([204, 401]).toContain(reg.statusCode);
      // Registered before the sessions ended (and removed with them) or refused after.
      expect(await devices(u.id)).toBe(0);
    }
  });

  it('two replays at once: both refused, no error, devices removed and counted once', async () => {
    const u = await newUser('reuse-twice');
    const { stale, legit } = await rotatedSession(u);
    await registerOk(legit.accessToken, 'ExponentPushToken[rt-1]');

    const results = await Promise.all([refresh(stale.refreshToken), refresh(stale.refreshToken)]);
    expect(results.map((r) => r.statusCode)).toEqual([401, 401]);
    expect(await devices(u.id)).toBe(0);
    const removed = (await reuseAudits(u.id))
      .map((l) => (l.changesAfter as { pushDevicesRemoved: number }).pushDevicesRemoved);
    expect(removed.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

// ─── legitimate concurrency ─────────────────────────────────────────────────

/** A browser tab's refresh: the refresh token travels in the shared cookie. */
function refreshWithCookie(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { refreshToken } });
}

describe('legitimate concurrent refreshes are not treated as reuse', () => {
  it('two browser tabs taking turns: each sends the cookie the previous refresh set; both stay signed in', async () => {
    const u = await newUser('tabs-turns');
    const first = await signIn(u.email);
    await registerOk(first.accessToken, 'ExponentPushToken[tabs-1]');
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion;

    // Tab A refreshes; the browser stores the new cookie; tab B's refresh,
    // made after A's finished, carries that new cookie.
    const tabA = await refreshWithCookie(first.refreshToken);
    expect(tabA.statusCode).toBe(200);
    const tabB = await refreshWithCookie(tabA.json().refreshToken);
    expect(tabB.statusCode).toBe(200);

    expect((await me(tabA.json().accessToken)).statusCode).toBe(200);
    expect((await me(tabB.json().accessToken)).statusCode).toBe(200);
    expect((await refreshWithCookie(tabB.json().refreshToken)).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion).toBe(before);
    expect(await reuseAudits(u.id)).toHaveLength(0);
    expect(await devices(u.id)).toBe(1);
  });

  it('two devices of one user refreshing at the same moment both succeed (looped)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const u = await newUser(`two-devices-${i}`);
      const laptop = await signIn(u.email);
      const phone = await signIn(u.email);
      const [a, b] = await Promise.all([refresh(laptop.refreshToken), refresh(phone.refreshToken)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect((await me(a.json().accessToken)).statusCode).toBe(200);
      expect((await me(b.json().accessToken)).statusCode).toBe(200);
      expect(await reuseAudits(u.id)).toHaveLength(0);
    }
  });

  it('two tabs sending the same cookie at the same instant never yield two live sessions (looped)', async () => {
    // Without the web client's turn-taking, both tabs can present one token.
    // Either the second is refused outright (both read it before either
    // rotated it) or it counts as reuse and every session ends. Never two
    // usable pairs. Browser tabs take turns across the whole browser (one
    // shared refresh lock), so this does not arise in the web client.
    for (let i = 0; i < 6; i += 1) {
      const u = await newUser(`tabs-same-instant-${i}`);
      const first = await signIn(u.email);
      const results = await Promise.all([refreshWithCookie(first.refreshToken), refreshWithCookie(first.refreshToken)]);
      const ok = results.filter((r) => r.statusCode === 200);
      expect(ok.length).toBeLessThanOrEqual(1);
      expect(results.filter((r) => r.statusCode === 401).length).toBeGreaterThanOrEqual(1);
      const reused = (await reuseAudits(u.id)).length > 0;
      for (const r of ok) {
        expect((await me(r.json().accessToken)).statusCode).toBe(reused ? 401 : 200);
      }
    }
  });
});

// ─── open live-update streams ───────────────────────────────────────────────

describe('an open live-updates stream', () => {
  function stream() {
    const written: string[] = [];
    let closed = 0;
    return { written, closedCount: () => closed, write: (d: string) => { written.push(d); }, close: () => { closed += 1; } };
  }

  it('closes at its next heartbeat once reuse has ended the sessions; another user\'s stays open', async () => {
    const u = await newUser('stream-reuse');
    const other = await newUser('stream-other');
    const { stale, legit } = await rotatedSession(u);
    const mine = stream();
    const theirs = stream();
    const myPayload = app.jwt.verify<JwtPayload>(legit.accessToken);
    const theirPayload = app.jwt.verify<JwtPayload>((await signIn(other.email)).accessToken);

    expect(await heartbeatOrClose(myPayload, mine)).toBe(true);
    expect(mine.written.join('')).toContain('event: heartbeat');

    expect((await refresh(stale.refreshToken)).statusCode).toBe(401);

    mine.written.length = 0;
    expect(await heartbeatOrClose(myPayload, mine)).toBe(false);
    expect(mine.closedCount()).toBe(1);
    expect(mine.written).toHaveLength(0);
    expect(await heartbeatOrClose(theirPayload, theirs)).toBe(true);
    expect(theirs.closedCount()).toBe(0);
  });

  it('closes when the session check cannot vouch for the token', async () => {
    const s = stream();
    const bad = { sub: undefined, companyId: cid } as unknown as JwtPayload;
    expect(await heartbeatOrClose(bad, s)).toBe(false);
    expect(s.closedCount()).toBe(1);
  });
});
