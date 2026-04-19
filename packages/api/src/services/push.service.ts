import { prisma } from '../utils/prisma';

// ─── Push Token Management ────────────────────────────────────────────────────

/**
 * Register (upsert) a push token for a user.
 * If the token already exists, update its owner/platform.
 */
export async function registerPushToken(
  userId: string,
  companyId: string,
  token: string,
  platform: string,
): Promise<void> {
  await prisma.pushToken.upsert({
    where: { token },
    update: { userId, companyId, platform },
    create: { userId, companyId, token, platform },
  });
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
  const tokens = await prisma.pushToken.findMany({
    where: { userId },
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
