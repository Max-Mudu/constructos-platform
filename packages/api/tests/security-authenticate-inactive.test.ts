/**
 * NEEDS OWNER APPROVAL — authentication behaviour change.
 *
 * authenticate() used to trust any unexpired access JWT, so a deactivated
 * (isActive=false) or deleted user kept full API access until the token
 * expired (JWT_EXPIRES_IN, default 15 minutes). It now checks the user row on
 * every request and answers 401 as soon as the account is inactive, gone, or
 * no longer in the token's company.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { clearDatabase, createTestCompany, createTestUser } from './helpers/fixtures';

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

const listProjects = (token: string) =>
  app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${token}` } });

describe('authenticate rejects tokens of inactive users', () => {
  it('accepts an active user', async () => {
    const { admin } = await createTestCompany(app, 'authn-active');
    expect((await listProjects(admin.accessToken)).statusCode).toBe(200);
  });

  it('rejects a still-valid token once the user is deactivated', async () => {
    const { admin } = await createTestCompany(app, 'authn-deactivated');
    expect((await listProjects(admin.accessToken)).statusCode).toBe(200);

    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    const res = await listProjects(admin.accessToken);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  });

  it('accepts the token again if the user is reactivated', async () => {
    const { admin } = await createTestCompany(app, 'authn-reactivated');
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect((await listProjects(admin.accessToken)).statusCode).toBe(401);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: true } });
    expect((await listProjects(admin.accessToken)).statusCode).toBe(200);
  });

  it('rejects a token whose user no longer exists', async () => {
    const { company } = await createTestCompany(app, 'authn-deleted');
    const viewer = await createTestUser(app, company.id, 'viewer', 'authn-deleted');
    await prisma.user.delete({ where: { id: viewer.id } });
    expect((await listProjects(viewer.accessToken)).statusCode).toBe(401);
  });

  it('rejects a token whose companyId does not match the user row', async () => {
    const a = await createTestCompany(app, 'authn-co-a');
    const b = await createTestCompany(app, 'authn-co-b');
    const forged = app.jwt.sign({
      sub: a.admin.id, email: a.admin.email, role: 'company_admin',
      companyId: b.company.id, canViewFinance: true,
    });
    expect((await listProjects(forged)).statusCode).toBe(401);
  });

  it('rejects a signed token without sub or companyId', async () => {
    const { admin } = await createTestCompany(app, 'authn-no-sub');
    // Signed with the real secret but malformed: cast past the JwtPayload type.
    const sign = (claims: Record<string, unknown>) => app.jwt.sign(claims as never);
    const noSub = sign({ email: admin.email, role: 'company_admin', companyId: admin.companyId, canViewFinance: true });
    const noCompany = sign({ sub: admin.id, email: admin.email, role: 'company_admin', canViewFinance: true });
    expect((await listProjects(noSub)).statusCode).toBe(401);
    expect((await listProjects(noCompany)).statusCode).toBe(401);
  });
});
