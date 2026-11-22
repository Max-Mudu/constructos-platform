/**
 * A refresh token from a session that was already ended on purpose (signed
 * out, or ended by a password reset, account setup or deactivation, as the
 * server recorded at that moment) is refused without touching the user's
 * current sessions. A token whose session ended because reuse was detected,
 * a token revoked by rotation, and a token whose session end is not on record
 * keep the reuse handling: every current session of the user ends.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { hashToken } from '../src/utils/hash';
import * as authService from '../src/services/auth.service';
import { createTestCompany, createTestUser, clearDatabase, TestUser } from './helpers/fixtures';

let app: FastifyInstance;
let cid: string;
let otherCid: string;
let admin: TestUser;
let warned: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();
  const a = await createTestCompany(app, 'ended-sessions');
  cid = a.company.id;
  admin = a.admin;
  otherCid = (await createTestCompany(app, 'ended-sessions-other')).company.id;
});

beforeEach(() => {
  warned = [];
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── helpers ────────────────────────────────────────────────────────────────

interface Session { accessToken: string; refreshToken: string }

async function signIn(email: string, password = 'TestPass1'): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return { accessToken: res.json().accessToken, refreshToken: res.json().refreshToken };
}

function refresh(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

function me(accessToken: string) {
  return app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
}

function signOut(s: Session) {
  return app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${s.accessToken}` },
    payload: { refreshToken: s.refreshToken },
  });
}

async function resetPassword(email: string, password = 'NewPass123'): Promise<void> {
  const { devLink } = await authService.requestPasswordReset(email);
  await authService.resetPassword(devLink!.split('token=')[1]!, password);
}

async function setStatus(userId: string, isActive: boolean) {
  const res = await app.inject({
    method: 'PATCH', url: `/api/v1/companies/me/users/${userId}/status`,
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { isActive },
  });
  expect(res.statusCode).toBe(200);
}

function reuseAudits(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId, entityType: 'auth', changesAfter: { path: ['event'], equals: 'refresh_token_reuse_detected' } },
  });
}

async function version(userId: string): Promise<number> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } })).sessionVersion;
}

/** The current sessions are intact: access works, refresh works, nothing was ended. */
async function expectUntouched(u: TestUser, current: Session, versionBefore: number) {
  expect((await me(current.accessToken)).statusCode).toBe(200);
  expect(await version(u.id)).toBe(versionBefore);
  expect(await reuseAudits(u.id)).toHaveLength(0);
  expect((await refresh(current.refreshToken)).statusCode).toBe(200);
}

/**
 * Every current session ended (reuse handling). The current refresh token is
 * checked in the database, not presented: presenting a token revoked by the
 * reuse handling is itself treated as reuse and would end the sessions again.
 */
async function expectAllEnded(u: TestUser, current: Session, versionBefore: number) {
  expect((await me(current.accessToken)).statusCode).toBe(401);
  expect(await version(u.id)).toBe(versionBefore + 1);
  const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(current.refreshToken) } });
  expect(row.revokedAt).not.toBeNull();
}

let seq = 0;
async function newUser(tag: string, companyId = cid): Promise<TestUser> {
  seq += 1;
  return createTestUser(app, companyId, 'finance_officer', `${tag}-${seq}`, { canViewFinance: true });
}

// ─── sessions ended on purpose: refused, current sessions untouched ─────────

describe('a token from a session that was ended on purpose', () => {
  it('signed out: refused; the user\'s other device stays signed in', async () => {
    const u = await newUser('ended-logout');
    const laptop = await signIn(u.email);
    const phone = await signIn(u.email);
    expect((await signOut(laptop)).statusCode).toBe(200);
    const v = await version(u.id);

    expect((await refresh(laptop.refreshToken)).statusCode).toBe(401);
    expect((await refresh(laptop.refreshToken)).statusCode).toBe(401);

    await expectUntouched(u, phone, v);
    expect(warned.join('\n')).toContain('already-ended session');
  });

  it('the sign-out audit names the ended token by row id only, never the token or its hash', async () => {
    const u = await newUser('ended-logout-audit');
    const s = await signIn(u.email);
    const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(s.refreshToken) } });
    expect((await signOut(s)).statusCode).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { userId: u.id, action: 'logout' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.entityId).toBe(row.id);
    const json = JSON.stringify(logs[0]);
    expect(json).not.toContain(s.refreshToken);
    expect(json).not.toContain(hashToken(s.refreshToken));
  });

  it('password reset: a token from before it is refused; the session signed in after it stays', async () => {
    const u = await newUser('ended-reset');
    const before = await signIn(u.email);
    await resetPassword(u.email);
    const after = await signIn(u.email, 'NewPass123');
    const v = await version(u.id);

    expect((await refresh(before.refreshToken)).statusCode).toBe(401);
    await expectUntouched(u, after, v);
  });

  it('account setup through a setup link: a token from before it is refused; later sessions stay', async () => {
    const email = 'ended.setup@test.com';
    const created = await app.inject({
      method: 'POST', url: '/api/v1/companies/me/users',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { email, firstName: 'End', lastName: 'Setup', role: 'finance_officer' },
    });
    expect(created.statusCode).toBe(201);
    const setupToken = (created.json().setupLink as string).split('token=')[1]!;
    const u: TestUser = { id: created.json().user.id, email, role: 'finance_officer', companyId: cid, canViewFinance: true, accessToken: '' };
    // A session of this account from before setup completed (issued directly,
    // as a sign-in would have).
    const early = await prisma.refreshToken.create({
      data: { userId: u.id, tokenHash: hashToken('early-session-token'), expiresAt: new Date(Date.now() + 86_400_000), sessionVersion: await version(u.id) },
    });
    await authService.resetPassword(setupToken, 'SetupPass123');
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: early.id } })).revokedAt).not.toBeNull();
    const after = await signIn(email, 'SetupPass123');
    const v = await version(u.id);

    expect((await refresh('early-session-token')).statusCode).toBe(401);
    await expectUntouched(u, after, v);
  });

  it('deactivation then reactivation: a token from before is refused; the new session stays', async () => {
    const u = await newUser('ended-deactivated');
    const before = await signIn(u.email);
    await setStatus(u.id, false);
    await setStatus(u.id, true);
    const after = await signIn(u.email);
    const v = await version(u.id);

    expect((await refresh(before.refreshToken)).statusCode).toBe(401);
    await expectUntouched(u, after, v);
  });

  it('while still deactivated: a token from before is refused and nothing else changes', async () => {
    const u = await newUser('ended-still-inactive');
    const before = await signIn(u.email);
    await setStatus(u.id, false);
    const v = await version(u.id);
    expect((await refresh(before.refreshToken)).statusCode).toBe(401);
    expect(await version(u.id)).toBe(v);
    expect(await reuseAudits(u.id)).toHaveLength(0);
  });

  it('a token signed out before a later reuse ended every session is still only refused', async () => {
    const u = await newUser('ended-logout-then-reuse');
    const laptop = await signIn(u.email);
    expect((await signOut(laptop)).statusCode).toBe(200);
    const phone = await signIn(u.email);
    const rotated = await refresh(phone.refreshToken);
    expect((await refresh(phone.refreshToken)).statusCode).toBe(401); // reuse: every session ends
    expect(await reuseAudits(u.id)).toHaveLength(1);
    const again = await signIn(u.email);
    const v = await version(u.id);
    expect(rotated.statusCode).toBe(200);

    expect((await refresh(laptop.refreshToken)).statusCode).toBe(401);
    expect((await me(again.accessToken)).statusCode).toBe(200);
    expect(await version(u.id)).toBe(v);
    expect(await reuseAudits(u.id)).toHaveLength(1);
  });
});

// ─── everything else stays security-sensitive ───────────────────────────────

describe('a revoked token whose session was not ended on purpose ends every session', () => {
  it('replay of a token already rotated by a refresh (current sessions)', async () => {
    const u = await newUser('sensitive-rotated');
    const first = await signIn(u.email);
    const rotated = await refresh(first.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const current: Session = { accessToken: rotated.json().accessToken, refreshToken: rotated.json().refreshToken };
    const v = await version(u.id);

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, current, v);
    expect(await reuseAudits(u.id)).toHaveLength(1);
  });

  it('a token from sessions ended because reuse was detected (suspected compromise) is not exempt', async () => {
    const u = await newUser('sensitive-compromised');
    const first = await signIn(u.email);
    expect((await refresh(first.refreshToken)).statusCode).toBe(200);
    expect((await refresh(first.refreshToken)).statusCode).toBe(401); // reuse: sessions end
    const relogin = await signIn(u.email);
    const v = await version(u.id);

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, relogin, v);
    const audits = await reuseAudits(u.id);
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => (a.changesAfter as { sessionVersionEnded: number }).sessionVersionEnded).sort())
      .toEqual([v - 1, v]);
  });

  it('a token revoked by the reuse handling itself (another device) is not exempt either', async () => {
    const u = await newUser('sensitive-other-device');
    const laptop = await signIn(u.email);
    const phone = await signIn(u.email);
    expect((await refresh(phone.refreshToken)).statusCode).toBe(200);
    expect((await refresh(phone.refreshToken)).statusCode).toBe(401); // reuse: laptop's token revoked too
    const relogin = await signIn(u.email);
    const v = await version(u.id);

    expect((await refresh(laptop.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, relogin, v);
  });

  it('a session version ended without any record of why is treated as reuse', async () => {
    const u = await newUser('sensitive-unrecorded');
    const old = await signIn(u.email);
    await prisma.user.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } });
    await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
    const current = await signIn(u.email);
    const v = await version(u.id);

    expect((await refresh(old.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, current, v);
  });

  it('a sign-out of a token that had already been rotated does not make that token exempt', async () => {
    const u = await newUser('sensitive-logout-rotated');
    const first = await signIn(u.email);
    const rotated = await refresh(first.refreshToken);
    const current: Session = { accessToken: rotated.json().accessToken, refreshToken: rotated.json().refreshToken };
    // Sign-out presenting the rotated (already revoked) token revokes nothing.
    expect((await signOut({ accessToken: current.accessToken, refreshToken: first.refreshToken })).statusCode).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { userId: u.id, action: 'logout' } });
    expect(logs[0]!.entityId).toBeNull();
    const v = await version(u.id);

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, current, v);
  });

  it('another user\'s reset record for the same version number does not exempt this user\'s token', async () => {
    const a = await newUser('iso-a');
    const b = await newUser('iso-b');
    const bOld = await signIn(b.email);
    await resetPassword(a.email); // a: version 0 ended, on record for a only
    await prisma.user.update({ where: { id: b.id }, data: { sessionVersion: { increment: 1 } } });
    await prisma.refreshToken.updateMany({ where: { userId: b.id }, data: { revokedAt: new Date() } });
    const bNow = await signIn(b.email);
    const v = await version(b.id);

    expect((await refresh(bOld.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(b, bNow, v);
  });

  it('a deactivation record in another company does not exempt this user\'s token', async () => {
    const u = await newUser('iso-company', otherCid);
    const old = await signIn(u.email);
    await prisma.user.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } });
    await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
    // A record naming this user but written in a different company.
    await prisma.auditLog.create({
      data: {
        companyId: cid, userId: admin.id, action: 'update', entityType: 'user', entityId: u.id,
        changesAfter: { event: 'user_deactivated', sessionVersionEnded: 0 },
      },
    });
    const current = await signIn(u.email);
    const v = await version(u.id);

    expect((await refresh(old.refreshToken)).statusCode).toBe(401);
    await expectAllEnded(u, current, v);
  });
});

// ─── concurrency ────────────────────────────────────────────────────────────

describe('concurrent requests around an ended session', () => {
  it('replays of a signed-out token racing the other device\'s refresh: other device unaffected (looped)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const u = await newUser(`race-logout-${i}`);
      const laptop = await signIn(u.email);
      const phone = await signIn(u.email);
      expect((await signOut(laptop)).statusCode).toBe(200);
      const [r1, r2, p] = await Promise.all([refresh(laptop.refreshToken), refresh(laptop.refreshToken), refresh(phone.refreshToken)]);
      expect([r1.statusCode, r2.statusCode, p.statusCode]).toEqual([401, 401, 200]);
      expect((await me(p.json().accessToken)).statusCode).toBe(200);
      expect(await reuseAudits(u.id)).toHaveLength(0);
    }
  });

  it('a sign-out racing a refresh of the same token: never a usable token afterwards from that pair (looped)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const u = await newUser(`race-logout-refresh-${i}`);
      const s = await signIn(u.email);
      const [out, ref] = await Promise.all([signOut(s), refresh(s.refreshToken)]);
      expect(out.statusCode).toBe(200);
      expect([200, 401]).toContain(ref.statusCode);
      // Whichever won, the original token is dead and presenting it again is refused.
      expect((await refresh(s.refreshToken)).statusCode).toBe(401);
    }
  });

  it('a replay racing a password reset: the reset still completes and the old token stays refused', async () => {
    const u = await newUser('race-reset');
    const old = await signIn(u.email);
    const { devLink } = await authService.requestPasswordReset(u.email);
    const [, replay] = await Promise.all([
      authService.resetPassword(devLink!.split('token=')[1]!, 'NewPass123'),
      refresh(old.refreshToken),
    ]);
    expect([200, 401]).toContain(replay.statusCode);
    const after = await signIn(u.email, 'NewPass123');
    expect((await refresh(old.refreshToken)).statusCode).toBe(401);
    expect((await me(after.accessToken)).statusCode).toBe(200);
  });
});

// ─── the browser's refresh cookie after a refusal ──────────────────────────

function refreshWithCookie(refreshToken?: string) {
  return app.inject({
    method: 'POST', url: '/api/v1/auth/refresh',
    ...(refreshToken !== undefined && { cookies: { refreshToken } }),
  });
}

function clearsRefreshCookie(res: { headers: Record<string, unknown> }): boolean {
  const raw = res.headers['set-cookie'];
  const all = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  return all.some((c) => /^refreshToken=;/.test(c) && /(Expires=Thu, 01 Jan 1970|Max-Age=0)/i.test(c));
}

describe('a refused refresh in a browser', () => {
  it('a cookie from sessions ended after suspected theft is cleared, so it is presented once and later sessions survive', async () => {
    const u = await newUser('cookie-compromised');
    const first = await signIn(u.email);
    expect((await refreshWithCookie(first.refreshToken)).statusCode).toBe(200);
    const replay = await refreshWithCookie(first.refreshToken); // reuse: every session ends
    expect(replay.statusCode).toBe(401);
    expect(clearsRefreshCookie(replay)).toBe(true);
    expect(await reuseAudits(u.id)).toHaveLength(1);

    const relogin = await signIn(u.email);
    const v = await version(u.id);
    // The browser's next visit: its cookie was cleared, so nothing is presented.
    const nextVisit = await refreshWithCookie();
    expect(nextVisit.statusCode).toBe(401);
    expect((await me(relogin.accessToken)).statusCode).toBe(200);
    expect(await version(u.id)).toBe(v);
    expect(await reuseAudits(u.id)).toHaveLength(1);
  });

  it('a signed-out cookie and an unknown cookie are cleared too', async () => {
    const u = await newUser('cookie-signed-out');
    const s = await signIn(u.email);
    expect((await signOut(s)).statusCode).toBe(200);
    expect(clearsRefreshCookie(await refreshWithCookie(s.refreshToken))).toBe(true);
    expect(clearsRefreshCookie(await refreshWithCookie('not-a-real-token'))).toBe(true);
  });

  it('a successful refresh sets the new cookie and does not clear it', async () => {
    const u = await newUser('cookie-ok');
    const s = await signIn(u.email);
    const ok = await refreshWithCookie(s.refreshToken);
    expect(ok.statusCode).toBe(200);
    expect(clearsRefreshCookie(ok)).toBe(false);
  });

  it('a refresh that lost a race to another refresh of the same token keeps the cookie', async () => {
    const u = await newUser('cookie-race-loser');
    const s = await signIn(u.email);
    // The other request rotated this token between this one's read and its rotation.
    const spy = jest.spyOn(prisma.refreshToken, 'updateMany').mockResolvedValueOnce({ count: 0 } as never);
    const lost = await refreshWithCookie(s.refreshToken);
    spy.mockRestore();
    expect(lost.statusCode).toBe(401);
    expect(clearsRefreshCookie(lost)).toBe(false);
    expect(await reuseAudits(u.id)).toHaveLength(0);
  });
});
