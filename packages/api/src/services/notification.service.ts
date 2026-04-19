import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { emitToUser, emitToCompany } from './event-emitter.service';
import { sendPushToUser } from './push.service';

// ─── Constants ────────────────────────────────────────────────────────────────

/** All notification types the platform emits. */
export const NOTIFICATION_TYPES = [
  'instruction_created',
  'instruction_updated',
  'budget_approved',
  'invoice_status_changed',
  'delivery_received',
  'drawing_approved',
  'system',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ─── Select shape ──────────────────────────────────────────────────────────────

const NOTIFICATION_SELECT = {
  id:         true,
  companyId:  true,
  userId:     true,
  type:       true,
  title:      true,
  body:       true,
  entityType: true,
  entityId:   true,
  isRead:     true,
  readAt:     true,
  createdAt:  true,
} as const;

const PREFERENCE_SELECT = {
  id:        true,
  userId:    true,
  companyId: true,
  type:      true,
  enabled:   true,
  updatedAt: true,
} as const;

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List notifications for the requesting user with optional read-filter.
 * company_admin can also query on behalf of any user by passing a userId param.
 */
export async function listNotifications(
  actor: RequestUser,
  params: {
    isRead?: boolean;
    type?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const where: Record<string, unknown> = {
    userId:    actor.id,
    companyId: actor.companyId,
  };
  if (params.isRead !== undefined) where['isRead'] = params.isRead;
  if (params.type)                 where['type']   = params.type;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      select:  NOTIFICATION_SELECT,
      orderBy: { createdAt: 'desc' },
      take:    params.limit  ?? 50,
      skip:    params.offset ?? 0,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

/**
 * Return unread count for the requesting user.
 */
export async function getUnreadCount(actor: RequestUser): Promise<number> {
  return prisma.notification.count({
    where: { userId: actor.id, companyId: actor.companyId, isRead: false },
  });
}

/**
 * Mark a single notification as read. Only the owner may do this.
 */
export async function markRead(notificationId: string, actor: RequestUser) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.id, companyId: actor.companyId },
    select: NOTIFICATION_SELECT,
  });
  if (!notification) throw new NotFoundError('Notification');
  if (notification.isRead) return notification;   // already read — idempotent

  const updated = await prisma.notification.update({
    where:  { id: notificationId },
    data:   { isRead: true, readAt: new Date() },
    select: NOTIFICATION_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:  actor.companyId,
      userId:     actor.id,
      userEmail:  actor.email,
      userRole:   actor.role,
      action:     'update',
      entityType: 'notification',
      entityId:   notificationId,
    },
  });

  return updated;
}

/**
 * Mark ALL unread notifications for the current user as read.
 */
export async function markAllRead(actor: RequestUser): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId: actor.id, companyId: actor.companyId, isRead: false },
    data:  { isRead: true, readAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'update',
      entityType:  'notification',
      entityId:    'bulk_read',
      changesAfter: { markedRead: result.count } as object,
    },
  });

  return { count: result.count };
}

/**
 * Delete a single notification. Only the owner may delete their own.
 */
export async function deleteNotification(notificationId: string, actor: RequestUser) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.id, companyId: actor.companyId },
    select: { id: true },
  });
  if (!notification) throw new NotFoundError('Notification');

  await prisma.notification.delete({ where: { id: notificationId } });

  await prisma.auditLog.create({
    data: {
      companyId:  actor.companyId,
      userId:     actor.id,
      userEmail:  actor.email,
      userRole:   actor.role,
      action:     'delete',
      entityType: 'notification',
      entityId:   notificationId,
    },
  });
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * Return the current user's notification preferences, filling in defaults
 * for any type that has no explicit row yet.
 */
export async function getPreferences(actor: RequestUser) {
  const stored = await prisma.notificationPreference.findMany({
    where:  { userId: actor.id, companyId: actor.companyId },
    select: PREFERENCE_SELECT,
  });

  // Merge stored prefs with defaults for missing types
  const storedMap = new Map(stored.map((p) => [p.type, p]));
  const preferences = NOTIFICATION_TYPES.map((type) => {
    const row = storedMap.get(type);
    return row ?? {
      id:        null,
      userId:    actor.id,
      companyId: actor.companyId,
      type,
      enabled:   true,
      updatedAt: null,
    };
  });

  return preferences;
}

/**
 * Upsert one or more notification type preferences for the current user.
 */
export async function upsertPreferences(
  actor: RequestUser,
  updates: Array<{ type: string; enabled: boolean }>,
) {
  // Validate all types
  const validTypes = new Set(NOTIFICATION_TYPES as readonly string[]);
  for (const u of updates) {
    if (!validTypes.has(u.type)) {
      throw new ForbiddenError(`Unknown notification type: ${u.type}`);
    }
  }

  await Promise.all(
    updates.map((u) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_type: { userId: actor.id, type: u.type },
        },
        update: { enabled: u.enabled },
        create: {
          companyId: actor.companyId,
          userId:    actor.id,
          type:      u.type,
          enabled:   u.enabled,
        },
      }),
    ),
  );

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'update',
      entityType:  'notification_preference',
      entityId:    actor.id,
      changesAfter: { updates } as object,
    },
  });

  return getPreferences(actor);
}

// ─── Internal helper — create a notification ─────────────────────────────────

/**
 * Create an in-app notification for a user. Respects their type preference
 * (skip silently if they have disabled this type). Safe to call from any
 * service — does NOT throw on failure.
 */
export async function createNotification(params: {
  companyId:  string;
  userId:     string;
  type:       NotificationType;
  title:      string;
  body:       string;
  entityType?: string;
  entityId?:   string;
}): Promise<void> {
  try {
    // Check preference — skip if user has disabled this type
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: params.userId, type: params.type } },
      select: { enabled: true },
    });
    if (pref && !pref.enabled) return;

    const notification = await prisma.notification.create({
      data: {
        companyId:  params.companyId,
        userId:     params.userId,
        type:       params.type,
        title:      params.title,
        body:       params.body,
        entityType: params.entityType ?? null,
        entityId:   params.entityId   ?? null,
      },
      select: {
        id: true, type: true, title: true, body: true,
        entityType: true, entityId: true, createdAt: true,
      },
    });

    // Push to connected SSE clients — non-fatal
    emitToUser(params.companyId, params.userId, {
      type:    'notification',
      payload: {
        id:         notification.id,
        type:       notification.type,
        title:      notification.title,
        body:       notification.body,
        entityType: notification.entityType,
        entityId:   notification.entityId,
        createdAt:  notification.createdAt.toISOString(),
      },
    });

    // Push notification to mobile devices — non-fatal
    await sendPushToUser(
      params.userId,
      notification.title,
      notification.body,
      {
        notificationId: notification.id,
        type:           notification.type,
        entityType:     notification.entityType ?? undefined,
        entityId:       notification.entityId   ?? undefined,
      },
    );
  } catch {
    // Non-fatal — notification delivery failure must not break the primary action
  }
}
