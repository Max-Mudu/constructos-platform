/**
 * NEEDS OWNER APPROVAL — authentication behaviour change.
 *
 * Refresh-token rotation is single-use under concurrency. Before the fix two
 * concurrent POST /auth/refresh calls carrying the same token both passed the
 * revokedAt check and both minted a new pair, leaving two live token families
 * — so a stolen token replayed at the same moment as the real client evaded
 * reuse detection. Now exactly one request wins; the other gets 401.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
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

async function loginRefreshToken(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'TestPass1' },
  });
  expect(res.statusCode).toBe(200);
  return res.json().refreshToken as string;
}

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

describe('refresh token rotation', () => {
  it('lets exactly one of several concurrent refreshes with the same token succeed', async () => {
    const { admin } = await createTestCompany(app, 'refresh-race');
    const token = await loginRefreshToken(admin.email);

    // Deterministic race: hold every token lookup until all three requests
    // have read the (still unrevoked) row, so each passes the revokedAt check
    // before any of them rotates.
    const N = 3;
    const realFindUnique = prisma.refreshToken.findUnique.bind(prisma.refreshToken);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = jest.spyOn(prisma.refreshToken, 'findUnique').mockImplementation(((args: unknown) =>
      (realFindUnique as (a: unknown) => Promise<unknown>)(args).then(async (row) => {
        if (++arrived === N) release();
        await barrier;
        return row;
      })) as never);

    const results = await Promise.all(Array.from({ length: N }, () => refresh(token)));
    spy.mockRestore();
    expect(arrived).toBe(N);

    // Compare status codes only, so a failure never prints token bodies.
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, ...Array(N - 1).fill(401)]);

    // Exactly one new token family is live; the original token is revoked.
    const live = await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } });
    expect(live).toBe(1);
  });

  it('still rotates normally for sequential use', async () => {
    const { admin } = await createTestCompany(app, 'refresh-seq');
    const first = await loginRefreshToken(admin.email);
    const r1 = await refresh(first);
    expect(r1.statusCode).toBe(200);
    const r2 = await refresh(r1.json().refreshToken);
    expect(r2.statusCode).toBe(200);
  });

  it('still treats a later replay of a rotated token as reuse and revokes every session', async () => {
    const { admin } = await createTestCompany(app, 'refresh-reuse');
    const first = await loginRefreshToken(admin.email);
    const r1 = await refresh(first);
    expect(r1.statusCode).toBe(200);

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replay = await refresh(first);
    warn.mockRestore();
    expect(replay.statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
  });
});
