# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe self-service password reset flow (email link → one-time token → new password) to the backend, web, and mobile clients.

**Architecture:** A `PasswordResetToken` DB table mirrors the existing `RefreshToken` pattern — raw token travels only in the reset URL, SHA-256 hash stored in DB. Email sending is abstracted behind an `EmailService`; dev/test logs the link to console, production requires optional SMTP config (gracefully degrades with a warning if not set). On successful reset, all refresh tokens are revoked.

**Tech Stack:** Fastify API (Prisma/PostgreSQL), Next.js App Router web, Expo/React Native mobile, nodemailer (SMTP, optional), zod validation, bcryptjs, crypto.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/api/prisma/schema.prisma` | Modify | Add `PasswordResetToken` model + `User.passwordResetTokens` relation |
| `packages/api/prisma/migrations/20260603000000_add_password_reset_tokens/migration.sql` | Create | CREATE TABLE DDL |
| `packages/api/src/services/email.service.ts` | Create | Email abstraction: dev=console, prod=nodemailer SMTP |
| `packages/api/src/utils/env.ts` | Modify | Add optional SMTP_* and APP_URL env vars |
| `packages/api/src/services/auth.service.ts` | Modify | Add `requestPasswordReset`, `resetPassword` |
| `packages/api/src/routes/auth.routes.ts` | Modify | Add POST /forgot-password, POST /reset-password |
| `packages/api/.env.example` | Modify | Document new env vars |
| `packages/api/tests/auth.test.ts` | Modify | Add password reset test suite |
| `packages/api/tests/helpers/fixtures.ts` | Modify | Add `passwordResetToken` to `clearDatabase` |
| `packages/web/src/lib/api.ts` | Modify | Add `authApi.forgotPassword`, `authApi.resetPassword` |
| `packages/web/src/app/(auth)/forgot-password/page.tsx` | Create | Email form + generic success state + dev link display |
| `packages/web/src/app/(auth)/reset-password/page.tsx` | Create | Token-from-URL → new password form + success/invalid states |
| `packages/web/src/app/(auth)/login/page.tsx` | Modify | Add "Forgot password?" link below password field |
| `packages/mobile/app/login.tsx` | Modify | "Forgot password?" opens `EXPO_PUBLIC_WEB_URL/forgot-password` in browser |
| `packages/mobile/.env.example` | Modify | Add `EXPO_PUBLIC_WEB_URL` |

---

## Task 1: Install nodemailer

**Files:**
- Modify: `packages/api/package.json`

- [ ] **Step 1: Install nodemailer + types**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform\packages\api"
npm install nodemailer
npm install --save-dev @types/nodemailer
```

Expected output: package-lock.json updated, no errors.

- [ ] **Step 2: Verify package.json has nodemailer**

```powershell
Select-String '"nodemailer"' "C:\Users\ADMIN\Desktop\Constructon Platform\packages\api\package.json"
```

Expected: line containing `"nodemailer":`.

---

## Task 2: Prisma schema — add PasswordResetToken model

**Files:**
- Modify: `packages/api/prisma/schema.prisma` (lines 250–303)

- [ ] **Step 1: Add relation field to User model**

In the `User` model, inside the relation block (after `pushTokens PushToken[]` near line 282), add:

```prisma
  passwordResetTokens     PasswordResetToken[]
```

- [ ] **Step 2: Add PasswordResetToken model**

After the `RefreshToken` model (after line 303), insert:

```prisma
model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}
```

---

## Task 3: Create migration SQL

**Files:**
- Create: `packages/api/prisma/migrations/20260603000000_add_password_reset_tokens/migration.sql`

- [ ] **Step 1: Write migration file**

```sql
-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "tokenHash" TEXT         NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- AddForeignKey
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Apply migration**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform\packages\api"
npx prisma migrate dev --name add_password_reset_tokens
```

Expected: Migration applied, Prisma client regenerated. No errors.

- [ ] **Step 3: Regenerate Prisma client**

```powershell
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors.

---

## Task 4: Add email service

**Files:**
- Create: `packages/api/src/services/email.service.ts`

- [ ] **Step 1: Write email service**

```typescript
import { env } from '../utils/env';

export interface EmailService {
  sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;
}

const EXPIRY_MINUTES = 60;

function buildText(link: string): string {
  return (
    `You requested a password reset for your ConstructOS account.\n\n` +
    `Reset your password:\n${link}\n\n` +
    `This link expires in ${EXPIRY_MINUTES} minutes. If you did not request this, ignore this email.`
  );
}

function buildHtml(link: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:480px;margin:auto;padding:24px">` +
    `<h2>Reset your ConstructOS password</h2>` +
    `<p>Click the link below to set a new password:</p>` +
    `<p><a href="${link}" style="color:#1d4ed8">Reset password</a></p>` +
    `<p style="color:#666;font-size:13px">This link expires in ${EXPIRY_MINUTES} minutes. ` +
    `If you did not request a reset, you can safely ignore this email.</p>` +
    `</body></html>`;
}

async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  if (!env.SMTP_HOST) {
    if (env.isProduction) {
      console.warn(
        `[email] SMTP not configured — password reset email NOT sent to ${to}. ` +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in env vars.',
      );
      console.warn(`[email] Reset link (deliver manually during pilot): ${resetLink}`);
    } else {
      console.log(`[email-dev] Password reset for ${to} → ${resetLink}`);
    }
    return;
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Reset your ConstructOS password',
    text: buildText(resetLink),
    html: buildHtml(resetLink),
  });
}

export const emailService: EmailService = { sendPasswordResetEmail };
```

---

## Task 5: Update env.ts

**Files:**
- Modify: `packages/api/src/utils/env.ts`

- [ ] **Step 1: Add SMTP and APP_URL config to env export**

Add after the existing `AWS_S3_BUCKET` line in the `env` export object:

```typescript
  APP_URL:   process.env['APP_URL']   ?? 'http://localhost:3000',
  SMTP_HOST: process.env['SMTP_HOST'] ?? '',
  SMTP_PORT: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
  SMTP_USER: process.env['SMTP_USER'] ?? '',
  SMTP_PASS: process.env['SMTP_PASS'] ?? '',
  SMTP_FROM: process.env['SMTP_FROM'] ?? 'noreply@constructos.app',
```

---

## Task 6: Add password reset to auth.service.ts

**Files:**
- Modify: `packages/api/src/services/auth.service.ts`

- [ ] **Step 1: Add imports at top of file**

After the existing imports, add:

```typescript
import { emailService } from './email.service';
import { env } from '../utils/env';
```

Note: `env` may already be imported; only add if missing.

- [ ] **Step 2: Add constant and requestPasswordReset function**

At the bottom of the file, add:

```typescript
const RESET_TOKEN_EXPIRES_MINUTES = 60;

export async function requestPasswordReset(
  email: string,
): Promise<{ devLink?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    return {};
  }

  // Invalidate any live unused tokens before creating a fresh one
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const rawToken  = generateToken(48);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  await prisma.auditLog.create({
    data: {
      companyId:    user.companyId,
      userId:       user.id,
      userEmail:    user.email,
      userRole:     user.role,
      action:       'update',
      entityType:   'auth',
      changesAfter: { event: 'password_reset_requested' },
    },
  });

  const resetLink = `${env.APP_URL}/reset-password?token=${rawToken}`;
  await emailService.sendPasswordResetEmail(email, resetLink);

  if (!env.isProduction) {
    return { devLink: resetLink };
  }
  return {};
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken || !resetToken.user.isActive) {
    throw new UnauthorizedError('Invalid or expired reset link');
  }
  if (resetToken.usedAt) {
    throw new UnauthorizedError('This reset link has already been used');
  }
  if (resetToken.expiresAt < new Date()) {
    throw new UnauthorizedError('This reset link has expired');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, failedLoginCount: 0, lockedAt: null },
    });

    await tx.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        companyId:    resetToken.user.companyId,
        userId:       resetToken.userId,
        userEmail:    resetToken.user.email,
        userRole:     resetToken.user.role,
        action:       'update',
        entityType:   'auth',
        changesAfter: { event: 'password_reset_completed' },
      },
    });
  });
}
```

---

## Task 7: Add routes to auth.routes.ts

**Files:**
- Modify: `packages/api/src/routes/auth.routes.ts`

- [ ] **Step 1: Add Zod schemas**

After the existing `logoutSchema` / `updateDefaultsSchema` declarations, add:

```typescript
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});
```

- [ ] **Step 2: Add route handlers inside authRoutes function**

Before the closing `}` of `authRoutes`, add:

```typescript
  // POST /api/v1/auth/forgot-password
  fastify.post('/forgot-password', {
    config: {
      rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 },
    },
  }, async (request, reply) => {
    const GENERIC = 'If an account with that email exists, a reset link has been sent.';
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.send({ message: GENERIC });
    }
    try {
      const result = await authService.requestPasswordReset(parsed.data.email);
      const response: Record<string, unknown> = { message: GENERIC };
      if (result.devLink) response.devLink = result.devLink;
      return reply.send(response);
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/reset-password
  fastify.post('/reset-password', async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      await authService.resetPassword(parsed.data.token, parsed.data.password);
      return reply.send({ message: 'Password reset successfully. Please sign in with your new password.' });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
```

---

## Task 8: Update .env.example

**Files:**
- Modify: `packages/api/.env.example`

- [ ] **Step 1: Append password reset / email section**

Add at the end of the file:

```
# ─── Password reset & email ───────────────────────────────────────────────────
# APP_URL is the public URL of the web frontend — used to build reset links.
# In Railway production: set to your web app Railway URL (no trailing slash).
APP_URL="http://localhost:3000"

# SMTP configuration for sending password reset emails (all optional for pilot).
# If SMTP_HOST is empty, the API logs reset links to stdout instead of emailing.
# This is intentional for pilot setup — configure SMTP when ready for real email.
#
# Example using Gmail App Password:
#   SMTP_HOST="smtp.gmail.com"
#   SMTP_PORT=587
#   SMTP_USER="your-address@gmail.com"
#   SMTP_PASS="your-app-password"   # generate at myaccount.google.com/apppasswords
#   SMTP_FROM="ConstructOS <your-address@gmail.com>"
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@constructos.app"
```

---

## Task 9: Update fixtures.ts clearDatabase

**Files:**
- Modify: `packages/api/tests/helpers/fixtures.ts`

- [ ] **Step 1: Add passwordResetToken.deleteMany before refreshToken.deleteMany**

In `clearDatabase()`, find the line:
```typescript
  await prisma.refreshToken.deleteMany();
```
and add before it:
```typescript
  await prisma.passwordResetToken.deleteMany();
```

---

## Task 10: Add password reset tests

**Files:**
- Modify: `packages/api/tests/auth.test.ts`

- [ ] **Step 1: Add forgot-password describe block**

Add at the end of auth.test.ts:

```typescript
// ─── Forgot Password ──────────────────────────────────────────────────────────

describe('POST /api/v1/auth/forgot-password', () => {
  const userEmail = 'forgotpw@test.com';
  let userId: string;

  beforeEach(async () => {
    const company = await prisma.company.create({
      data: { name: 'Forgot Co', slug: 'forgot-co', currency: 'USD' },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email: userEmail,
        passwordHash: await hashPassword('TestPass1'),
        firstName: 'Forgot',
        lastName: 'User',
        role: 'company_admin',
        canViewFinance: false,
      },
    });
    userId = user.id;
  });

  it('returns 200 with generic message for known email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain('If an account');
  });

  it('returns 200 with same generic message for unknown email (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ghost@nowhere.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain('If an account');
  });

  it('creates a reset token in the database', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    const token = await prisma.passwordResetToken.findFirst({
      where: { userId },
    });
    expect(token).toBeTruthy();
    expect(token!.usedAt).toBeNull();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns devLink in test environment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    expect(res.json().devLink).toBeTruthy();
    expect(res.json().devLink).toContain('/reset-password?token=');
  });

  it('invalidates previous live token when new request is made', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    const tokens = await prisma.passwordResetToken.findMany({ where: { userId } });
    const unused = tokens.filter((t) => t.usedAt === null);
    expect(unused).toHaveLength(1);
  });

  it('writes audit log with event=password_reset_requested', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'auth', userId },
    });
    expect(log).toBeTruthy();
    expect((log!.changesAfter as Record<string, unknown>)['event']).toBe('password_reset_requested');
  });
});

// ─── Reset Password ───────────────────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password', () => {
  const userEmail    = 'resetpw@test.com';
  const userPassword = 'OldPass1';
  let userId: string;

  beforeEach(async () => {
    const company = await prisma.company.create({
      data: { name: 'ResetPw Co', slug: 'resetpw-co', currency: 'USD' },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email: userEmail,
        passwordHash: await hashPassword(userPassword),
        firstName: 'Pw',
        lastName: 'Reset',
        role: 'company_admin',
        canViewFinance: false,
      },
    });
    userId = user.id;
  });

  async function getResetToken(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    const devLink: string = res.json().devLink;
    return devLink.split('token=')[1]!;
  }

  it('resets password with valid token', async () => {
    const token = await getResetToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain('Password reset');
  });

  it('allows login with new password after reset', async () => {
    const token = await getResetToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: 'NewPass1!' },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('rejects old password after reset', async () => {
    const token = await getResetToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });
    expect(loginRes.statusCode).toBe(401);
  });

  it('rejects already-used token', async () => {
    const token = await getResetToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass2!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects expired token', async () => {
    const { hashToken: ht, generateToken: gt } = await import('../src/utils/hash');
    const rawToken = gt(48);
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: ht(rawToken),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: rawToken, password: 'NewPass1!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'totallyFakeToken123abc', password: 'NewPass1!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects weak password', async () => {
    const token = await getResetToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'weak' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('revokes all active refresh tokens after reset', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: userPassword },
    });
    const before = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(before).toBeGreaterThan(0);

    const token = await getResetToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });

    const after = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(after).toBe(0);
  });

  it('writes audit log with event=password_reset_completed', async () => {
    const token = await getResetToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1!' },
    });
    const logs = await prisma.auditLog.findMany({
      where: { action: 'update', entityType: 'auth', userId },
    });
    const completedLog = logs.find(
      (l) => (l.changesAfter as Record<string, unknown>)?.['event'] === 'password_reset_completed',
    );
    expect(completedLog).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform\packages\api"
npx jest tests/auth.test.ts --runInBand --forceExit
```

Expected: All existing tests pass + new password reset tests pass.

- [ ] **Step 3: Commit backend**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform"
git add packages/api/prisma/schema.prisma
git add packages/api/prisma/migrations/20260603000000_add_password_reset_tokens/
git add packages/api/src/services/email.service.ts
git add packages/api/src/utils/env.ts
git add packages/api/src/services/auth.service.ts
git add packages/api/src/routes/auth.routes.ts
git add packages/api/.env.example
git add packages/api/tests/auth.test.ts
git add packages/api/tests/helpers/fixtures.ts
git add packages/api/package.json packages/api/package-lock.json
git commit -m "feat: add self-service password reset (backend)"
```

---

## Task 11: Web — add authApi methods

**Files:**
- Modify: `packages/web/src/lib/api.ts` (after `updateDefaults` method in authApi, around line 168)

- [ ] **Step 1: Add forgotPassword and resetPassword to authApi**

After the `updateDefaults` method (before the closing `},` of `authApi`), add:

```typescript
  forgotPassword: (email: string) =>
    request<{ message: string; devLink?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
```

---

## Task 12: Web — forgot-password page

**Files:**
- Create: `packages/web/src/app/(auth)/forgot-password/page.tsx`

- [ ] **Step 1: Write page component**

```typescript
'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authApi.forgotPassword(email);
      setSuccess(true);
      if (result.devLink) setDevLink(result.devLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center text-center gap-3">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <h2 className="text-lg font-semibold text-foreground">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            If an account with that email exists, you will receive a reset link shortly.
            The link expires in 60 minutes.
          </p>
          {devLink && (
            <div className="mt-2 w-full rounded border border-border bg-muted p-3 text-left">
              <p className="text-xs font-medium text-muted-foreground mb-1">Dev — reset link:</p>
              <a href={devLink} className="text-xs text-primary break-all hover:underline">
                {devLink}
              </a>
            </div>
          )}
          <Link
            href="/login"
            className="mt-2 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Reset your password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remember your password?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
```

---

## Task 13: Web — reset-password page

**Files:**
- Create: `packages/web/src/app/(auth)/reset-password/page.tsx`

- [ ] **Step 1: Write page component**

```typescript
'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

function ResetPasswordContent() {
  const searchParams = useSearchParams()!;
  const token        = searchParams.get('token');

  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error,           setError]           = useState('');
  const [success,         setSuccess]         = useState(false);
  const [loading,         setLoading]         = useState(false);

  if (!token) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center text-center gap-3">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <h2 className="text-lg font-semibold text-foreground">Invalid reset link</h2>
          <p className="text-sm text-muted-foreground">
            This link is missing or invalid. Please request a new password reset.
          </p>
          <Link
            href="/forgot-password"
            className="mt-2 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            Request new link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center text-center gap-3">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <h2 className="text-lg font-semibold text-foreground">Password updated</h2>
          <p className="text-sm text-muted-foreground">
            Your password has been reset. Please sign in with your new password.
          </p>
          <Link
            href="/login"
            className="mt-2 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(token!, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Set new password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a strong password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
        />
        <Input
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Reset password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm h-[300px] animate-pulse" />
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
```

---

## Task 14: Web — update login page with "Forgot password?" link

**Files:**
- Modify: `packages/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Add forgot-password link below password Input**

After the closing `/>` of the password `<Input ... />` element (around line 76), insert:

```typescript
        <div className="flex justify-end -mt-2">
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:text-primary hover:underline underline-offset-4"
          >
            Forgot password?
          </Link>
        </div>
```

- [ ] **Step 2: Commit web changes**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform"
git add packages/web/src/lib/api.ts
git add packages/web/src/app/
git commit -m "feat: add password reset pages and forgot-password link (web)"
```

---

## Task 15: Mobile — update login.tsx and .env.example

**Files:**
- Modify: `packages/mobile/app/login.tsx`
- Modify: `packages/mobile/.env.example`

- [ ] **Step 1: Add Linking import to login.tsx**

At the top of `packages/mobile/app/login.tsx`, `Linking` is already part of `react-native`. Update the existing react-native import line to include it:

Find:
```typescript
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, Alert, TextInput,
} from 'react-native';
```

Replace with:
```typescript
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, Alert, TextInput, Linking,
} from 'react-native';
```

- [ ] **Step 2: Add WEB_URL constant**

After the `import` block (before `async function registerForPushNotifications`), add:

```typescript
const WEB_URL =
  (process.env['EXPO_PUBLIC_WEB_URL'] as string | undefined) ??
  'https://constructos.up.railway.app';
```

- [ ] **Step 3: Replace the Forgot password onPress handler**

Find the existing onPress (line ~148):
```typescript
                onPress={() => Alert.alert('Password Reset', 'Contact your administrator to reset your password.')}
```

Replace with:
```typescript
                onPress={async () => {
                  const url = `${WEB_URL}/forgot-password`;
                  const supported = await Linking.canOpenURL(url);
                  if (supported) {
                    await Linking.openURL(url);
                  } else {
                    Alert.alert(
                      'Password Reset',
                      'Visit the platform in your browser to reset your password.',
                    );
                  }
                }}
```

- [ ] **Step 4: Add EXPO_PUBLIC_WEB_URL to mobile .env.example**

Append to `packages/mobile/.env.example`:

```
# ─── Web app URL ───────────────────────────────────────────────────────────────
# Used to open the password reset page in the device browser.
# Set to your Railway web app URL in production EAS builds.
EXPO_PUBLIC_WEB_URL=http://localhost:3000
```

- [ ] **Step 5: Commit mobile changes**

```powershell
cd "C:\Users\ADMIN\Desktop\Constructon Platform"
git add packages/mobile/app/login.tsx
git add packages/mobile/.env.example
git commit -m "feat: open password reset in browser from mobile login (mobile)"
```

---

## Self-Review Checklist

- [x] **Spec requirement 1 (request reset endpoint):** Task 7 — POST /forgot-password
- [x] **Spec requirement 2 (reset password endpoint):** Task 7 — POST /reset-password
- [x] **Spec requirement 3 (secure token generation):** Task 6 — `generateToken(48)` → 96 hex chars
- [x] **Spec requirement 4 (60-min expiry):** Task 6 — `RESET_TOKEN_EXPIRES_MINUTES = 60`
- [x] **Spec requirement 5 (one-time usage):** Task 6 — `usedAt` set in transaction, checked before use
- [x] **Spec requirement 6 (password hashing):** Task 6 — `hashPassword()` (bcrypt, 12 rounds)
- [x] **Spec requirement 7 (no enumeration):** Task 7 — `/forgot-password` always returns GENERIC message, even for invalid email format
- [x] **Spec requirement 8 (audit log):** Task 6 — both request and completion write audit logs
- [x] **Spec requirement 9 (reset link generation):** Task 6 — `${env.APP_URL}/reset-password?token=...`
- [x] **Spec requirement 10 (email template):** Task 4 — text + HTML templates in email.service.ts
- [x] **Spec requirement 11 (email abstraction):** Task 4 — dev=console, prod=nodemailer, graceful missing SMTP
- [x] **Spec requirement 12 (forgot-password link on login):** Task 14
- [x] **Spec requirement 13 (request reset page):** Task 12
- [x] **Spec requirement 14 (reset password page):** Task 13
- [x] **Spec requirement 15 (success screen):** Tasks 12 + 13 — both show success state
- [x] **Spec requirement 16 (error handling web):** Tasks 12 + 13 — ApiError displayed, missing token shows invalid-link state
- [x] **Spec requirement 17 (mobile forgot password entry):** Task 15
- [x] **Spec requirement 18 (open in browser):** Task 15 — `Linking.openURL`
- [x] **Spec requirement 19 (no enumeration):** Task 7 — verified
- [x] **Spec requirement 20 (expired token rejection):** Task 6 — `resetToken.expiresAt < new Date()` check
- [x] **Spec requirement 21 (used token rejection):** Task 6 — `resetToken.usedAt` check
- [x] **Spec requirement 22 (strong password):** Task 7 — same Zod schema as register
- [x] **Spec requirement 23 (rate limit):** Task 7 — per-route config `{ max: 5, timeWindow: 15min }`
- [x] **Adjustment 1 (SMTP optional, warn not crash):** Task 4 — no SMTP_HOST check, console.warn in prod
- [x] **Adjustment 2 (dev link in non-prod, never in prod):** Tasks 6+7 — `if (!env.isProduction) return { devLink }`
- [x] **Adjustment 3 (reset clears tokens + audit log):** Task 6 — transaction covers all four ops
- [x] **Adjustment 4 (invalidate previous tokens):** Task 6 — `updateMany` before creating new token
- [x] **Adjustment 5 (missing token graceful):** Task 13 — `if (!token)` renders invalid-link state
- [x] **Adjustment 6 (mobile EXPO_PUBLIC_WEB_URL with fallback):** Task 15 — fallback to Railway URL
- [x] **Adjustment 7 (env examples documented):** Tasks 8 + 15
