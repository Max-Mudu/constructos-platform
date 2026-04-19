import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { hashPassword } from '../src/utils/hash';
import { clearDatabase } from './helpers/fixtures';

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

// ─── Register ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  const validPayload = {
    email: 'owner@acme.com',
    password: 'SecurePass1',
    firstName: 'Alice',
    lastName: 'Smith',
    companyName: 'Acme Construction',
    currency: 'USD',
  };

  it('creates company and user, returns accessToken and user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validPayload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user.email).toBe('owner@acme.com');
    expect(body.user.role).toBe('company_admin');
    expect(body.user.canViewFinance).toBe(true);
    // Password must never be returned
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.password).toBeUndefined();
  });

  it('sets httpOnly refreshToken cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validPayload,
    });

    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeTruthy();
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    expect(cookieStr).toContain('refreshToken=');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('creates company with correct slug', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validPayload,
    });

    const company = await prisma.company.findFirst({ where: { name: 'Acme Construction' } });
    expect(company).toBeTruthy();
    expect(company!.slug).toBe('acme-construction');
  });

  it('writes audit log on registration', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validPayload,
    });

    const log = await prisma.auditLog.findFirst({ where: { action: 'create', entityType: 'company' } });
    expect(log).toBeTruthy();
  });

  it('rejects duplicate email with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: validPayload });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: validPayload });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('rejects weak password with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...validPayload, password: 'weakpass' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects invalid email with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...validPayload, email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects missing fields with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'a@b.com' },
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  const userEmail = 'user@test.com';
  const userPassword = 'TestPass1';
  let companyId: string;

  beforeEach(async () => {
    const company = await prisma.company.create({
      data: { name: 'Test Co', slug: 'test-co', currency: 'USD' },
    });
    companyId = company.id;
    await prisma.user.create({
      data: {
        companyId,
        email: userEmail,
        passwordHash: await hashPassword(userPassword),
        firstName: 'Test',
        lastName: 'User',
        role: 'company_admin',
        canViewFinance: true,
      },
    });
  });

  it('returns accessToken and user on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user.email).toBe(userEmail);
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'WrongPass1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on non-existent email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'noone@test.com', password: 'AnyPass1' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('increments failed login count on wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'Wrong1' },
    });

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    expect(user!.failedLoginCount).toBe(1);
  });

  it('resets failed login count on successful login', async () => {
    // Fail once first
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'Wrong1' },
    });

    // Then succeed
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    expect(user!.failedLoginCount).toBe(0);
  });

  it('locks account after 10 failed attempts', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: userEmail, password: 'WrongPass1' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('logs successful login to audit log', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'login', userEmail },
    });
    expect(log).toBeTruthy();
    expect((log!.changesAfter as Record<string, unknown>)['success']).toBe(true);
  });

  it('logs failed login to audit log', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'WrongPass1' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'login', userEmail },
    });
    expect(log).toBeTruthy();
    expect((log!.changesAfter as Record<string, unknown>)['success']).toBe(false);
  });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('issues new token pair using body refresh token', async () => {
    // Register to get tokens
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'refresh@test.com',
        password: 'TestPass1',
        firstName: 'Ref',
        lastName: 'User',
        companyName: 'Refresh Co',
      },
    });

    // Extract refresh token from cookie
    const setCookie = regRes.headers['set-cookie'] as string;
    const refreshToken = setCookie.split('refreshToken=')[1]?.split(';')[0];
    expect(refreshToken).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user).toBeTruthy();
  });

  it('rejects reuse of already-rotated refresh token', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'rotate@test.com',
        password: 'TestPass1',
        firstName: 'Rot',
        lastName: 'User',
        companyName: 'Rotate Co',
      },
    });

    const setCookie = regRes.headers['set-cookie'] as string;
    const refreshToken = setCookie.split('refreshToken=')[1]?.split(';')[0];

    // Use it once (rotates)
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    // Try to reuse old token — should fail
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'completely-fake-token-that-does-not-exist' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  it('revokes refresh token and returns success', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'logout@test.com',
        password: 'TestPass1',
        firstName: 'Log',
        lastName: 'Out',
        companyName: 'Logout Co',
      },
    });

    const accessToken = regRes.json().accessToken;
    const setCookie = regRes.headers['set-cookie'] as string;
    const refreshToken = setCookie.split('refreshToken=')[1]?.split(';')[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);

    // Verify refresh token is revoked
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(401);
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returns current user when authenticated', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'me@test.com',
        password: 'TestPass1',
        firstName: 'Me',
        lastName: 'User',
        companyName: 'Me Co',
      },
    });

    const accessToken = regRes.json().accessToken;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('me@test.com');
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with expired/invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer invalid.token.here' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('Tenant isolation', () => {
  it('two companies with same email prefix get different UUIDs and isolated data', async () => {
    const reg1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'admin@company1.com',
        password: 'TestPass1',
        firstName: 'A1',
        lastName: 'User',
        companyName: 'Company One',
      },
    });

    const reg2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'admin@company2.com',
        password: 'TestPass1',
        firstName: 'A2',
        lastName: 'User',
        companyName: 'Company Two',
      },
    });

    expect(reg1.statusCode).toBe(201);
    expect(reg2.statusCode).toBe(201);

    const user1 = reg1.json().user;
    const user2 = reg2.json().user;

    expect(user1.companyId).not.toBe(user2.companyId);
    expect(user1.id).not.toBe(user2.id);
  });
});
