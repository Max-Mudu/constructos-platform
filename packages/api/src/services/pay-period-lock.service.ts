/**
 * Pay-period lock (owner-approved 25 Nov 2026).
 *
 * A company has one "closed up to" date for labour and attendance. Labour
 * entries and attendance records dated on or before it cannot be created,
 * edited or deleted by anyone. The date moves forward by "close" (company
 * admins and finance officers, up to yesterday) and back by "reopen"
 * (company admins only, with a reason). Every close and reopen is kept as a
 * row in pay_period_locks (append-only) and written to the audit log.
 * Closing or reopening never changes an existing labour or attendance row.
 *
 * Concurrency: a close or reopen takes a transaction-level exclusive
 * advisory lock for the company; every guarded write takes the shared form
 * of the same lock and checks the date inside its own transaction. A write
 * therefore either commits before the close starts or sees the new date.
 *
 * pay_period_locks is read and written with SQL so that this code does not
 * depend on the generated client's model for the new table.
 */
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError, ForbiddenError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';

// ─── Policy ───────────────────────────────────────────────────────────────────

export const PAY_PERIOD_CLOSE_ROLES:  readonly UserRole[] = ['company_admin', 'finance_officer'];
export const PAY_PERIOD_REOPEN_ROLES: readonly UserRole[] = ['company_admin'];

// ─── Errors ──────────────────────────────────────────────────────────────────

/** 409 for any labour / attendance write dated in a closed pay period. */
export class PayPeriodClosedError extends AppError {
  constructor(public lockedThrough: string) {
    super(
      409,
      `Labour and attendance up to ${lockedThrough} are closed for payroll and cannot be changed. ` +
      'Ask a company admin to reopen the period if a correction is needed.',
      'PAY_PERIOD_CLOSED',
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

const lockKey = (companyId: string) => `pay_period_lock:${companyId}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** "YYYY-MM-DD" -> Date at UTC midnight (how @db.Date labour/attendance dates are stored). */
function parseDay(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || ymd(d) !== value) throw new ValidationError(`${field} is not a valid date`);
  return d;
}

async function currentLockedThrough(tx: Tx | typeof prisma, companyId: string): Promise<Date | null> {
  const rows = await tx.$queryRaw<Array<{ lockedThrough: Date | null }>>`
    SELECT "lockedThrough" FROM "pay_period_locks"
    WHERE "companyId" = ${companyId}
    ORDER BY "id" DESC
    LIMIT 1`;
  return rows[0]?.lockedThrough ?? null;
}

/**
 * Inside a write's transaction: wait for any close or reopen in progress,
 * then refuse the write when one of `dates` is on or before the closed date.
 */
export async function assertPayPeriodOpen(tx: Tx, companyId: string, dates: Date[]): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock_shared(hashtext(${lockKey(companyId)}))`;
  const through = await currentLockedThrough(tx, companyId);
  if (through && dates.some((d) => d.getTime() <= through.getTime())) {
    throw new PayPeriodClosedError(ymd(through));
  }
}

/** Runs `fn` in a transaction that first checks the pay period is open for `dates`. */
export function withPayPeriodOpen<T>(companyId: string, dates: Date[], fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await assertPayPeriodOpen(tx, companyId, dates);
    return fn(tx);
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export interface PayPeriodLockView {
  lockedThrough: string | null;
  history: Array<{
    id: number; action: 'close' | 'reopen'; lockedThrough: string | null; previousLockedThrough: string | null;
    reason: string | null; createdById: string; createdAt: string;
  }>;
}

export async function getPayPeriodLock(actor: RequestUser): Promise<PayPeriodLockView> {
  const rows = await prisma.$queryRaw<Array<{
    id: number; action: 'close' | 'reopen'; lockedThrough: Date | null; previousLockedThrough: Date | null;
    reason: string | null; createdById: string; createdAt: Date;
  }>>`
    SELECT "id", "action"::text AS "action", "lockedThrough", "previousLockedThrough", "reason", "createdById", "createdAt"
    FROM "pay_period_locks" WHERE "companyId" = ${actor.companyId}
    ORDER BY "id" DESC LIMIT 50`;
  return {
    lockedThrough: rows[0]?.lockedThrough ? ymd(rows[0].lockedThrough) : null,
    history: rows.map((r) => ({
      id: r.id, action: r.action,
      lockedThrough: r.lockedThrough ? ymd(r.lockedThrough) : null,
      previousLockedThrough: r.previousLockedThrough ? ymd(r.previousLockedThrough) : null,
      reason: r.reason, createdById: r.createdById, createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─── Close / reopen ──────────────────────────────────────────────────────────

async function writeLockEvent(
  actor: RequestUser,
  action: 'close' | 'reopen',
  next: Date | null,
  reason: string | null,
  validate: (current: Date | null) => void,
): Promise<PayPeriodLockView> {
  await prisma.$transaction(async (tx) => {
    // Exclusive: waits for labour/attendance writes in flight, holds new ones until commit.
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${lockKey(actor.companyId)}))`;
    const current = await currentLockedThrough(tx, actor.companyId);
    validate(current);
    const inserted = await tx.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "pay_period_locks" ("companyId", "action", "lockedThrough", "previousLockedThrough", "reason", "createdById")
      VALUES (${actor.companyId}, ${action}::"PayPeriodLockAction", ${next ? ymd(next) : null}::date,
              ${current ? ymd(current) : null}::date, ${reason}, ${actor.id})
      RETURNING "id"`;
    await tx.auditLog.create({
      data: {
        companyId:     actor.companyId,
        userId:        actor.id,
        userEmail:     actor.email,
        userRole:      actor.role,
        action:        'update',
        entityType:    'pay_period_lock',
        entityId:      String(inserted[0].id),
        changesBefore: { lockedThrough: current ? ymd(current) : null },
        changesAfter:  { action, lockedThrough: next ? ymd(next) : null, reason },
      },
    });
  });
  return getPayPeriodLock(actor);
}

export async function closePayPeriod(actor: RequestUser, lockedThrough: string, reason?: string): Promise<PayPeriodLockView> {
  if (!PAY_PERIOD_CLOSE_ROLES.includes(actor.role)) throw new ForbiddenError('You cannot close a pay period');
  const next = parseDay(lockedThrough, 'lockedThrough');
  const today = parseDay(new Date().toISOString().slice(0, 10), 'today');
  if (next.getTime() >= today.getTime()) throw new ValidationError('A pay period can only be closed up to yesterday');
  return writeLockEvent(actor, 'close', next, reason?.trim() || null, (current) => {
    if (current && next.getTime() <= current.getTime()) {
      throw new ValidationError(`Labour is already closed up to ${ymd(current)}; to move the date back, reopen`);
    }
  });
}

export async function reopenPayPeriod(actor: RequestUser, lockedThrough: string | null, reason: string): Promise<PayPeriodLockView> {
  if (!PAY_PERIOD_REOPEN_ROLES.includes(actor.role)) throw new ForbiddenError('Only a company admin can reopen a pay period');
  const why = reason?.trim();
  if (!why) throw new ValidationError('A reason is required to reopen a pay period');
  const next = lockedThrough === null ? null : parseDay(lockedThrough, 'lockedThrough');
  return writeLockEvent(actor, 'reopen', next, why, (current) => {
    if (!current) throw new ValidationError('No pay period is closed');
    if (next && next.getTime() >= current.getTime()) {
      throw new ValidationError(`Reopening must move the closed date before ${ymd(current)}`);
    }
  });
}
