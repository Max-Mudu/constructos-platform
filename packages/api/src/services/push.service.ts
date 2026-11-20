import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

// ─── Push Token Management ────────────────────────────────────────────────────

/**
 * Register (upsert) a push token for a user.
 * If the token already exists, update its owner/platform.
 *
 * `sessionVersion` is the version carried by the access token that
 * authenticated the request. The user row is re-read with a row lock in the
 * same transaction as the write, so a registration cannot land after a
 * concurrent password reset or deactivation has ended that session and
 * removed the user's devices: it waits for that transaction and then finds the
 * session no longer current. Returns false (nothing written) in that case.
 */
export async function registerPushToken(
  userId: string,
  companyId: string,
  token: string,
  platform: string,
  sessionVersion: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${userId}
        AND "companyId" = ${companyId}
        AND "isActive" = true
        AND "sessionVersion" = ${sessionVersion}
      FOR SHARE
    `;
    if (current.length === 0) return false;

    await tx.pushToken.upsert({
      where: { token },
      update: { userId, companyId, platform },
      create: { userId, companyId, token, platform },
    });
    return true;
  });
}

/**
 * Remove every device registered for one user. Called inside the transaction
 * that ends all of that user's sessions (password reset / account setup,
 * deactivation), after the session version has been bumped, so the devices
 * go together with the sessions they were registered under. The app
 * registers the device again at the next sign-in. Returns the number removed.
 */
export async function removeUserPushDevices(
  tx: Prisma.TransactionClient,
  userId: string,
  companyId: string,
): Promise<number> {
  const removed = await tx.pushToken.deleteMany({ where: { userId, companyId } });
  return removed.count;
}

/**
 * Remove a specific push token. Only the owner can remove their own token.
 */
export async function unregisterPushToken(token: string, userId: string): Promise<void> {
  await prisma.pushToken.deleteMany({
    where: { token, userId },
  });
}

// ─── Push Delivery ────────────────────────────────────────────────────────────

/**
 * Send a push notification to all registered tokens for a user.
 * Uses the Expo Push API directly (no npm dependency).
 * Non-fatal — failures are silently swallowed.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  // Deactivated accounts get no pushes. Deactivation also removes the
  // account's registered devices (setCompanyUserStatus), so this filter is a
  // second check, e.g. for a send already in progress.
  const tokens = await prisma.pushToken.findMany({
    where: { userId, user: { isActive: true } },
    select: { token: true },
  });

  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to:    t.token,
    title,
    body,
    data:  data ?? {},
    sound: 'default',
  }));

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        Accept:           'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch {
    // Non-fatal — push delivery failure must not break the primary action
  }
}
