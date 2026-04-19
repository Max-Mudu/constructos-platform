'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, X, ExternalLink } from 'lucide-react';
import { notificationApi } from '@/lib/api';
import { Notification } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useSSEEvent } from '@/hooks/useSSEEvent';

// ─── Type labels & icons ──────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  instruction_created:    'New Instruction',
  instruction_updated:    'Instruction Updated',
  budget_approved:        'Budget Approved',
  invoice_status_changed: 'Invoice Update',
  delivery_received:      'Delivery Received',
  drawing_approved:       'Drawing Approved',
  system:                 'System',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1)  return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  <  7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Individual notification row ──────────────────────────────────────────────

function NotificationRow({
  notification,
  onRead,
  onDelete,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 hover:bg-accent/40 transition-colors',
        !notification.isRead && 'bg-primary/5',
      )}
    >
      {/* Unread dot */}
      <div className="flex-none mt-1.5">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            notification.isRead ? 'bg-transparent' : 'bg-primary',
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {TYPE_LABEL[notification.type] ?? notification.type}
        </p>
        <p className="text-sm font-medium text-foreground leading-snug mt-0.5">
          {notification.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          {relativeTime(notification.createdAt)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex-none flex items-center gap-1 ml-1">
        {!notification.isRead && (
          <button
            onClick={() => onRead(notification.id)}
            title="Mark as read"
            className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(notification.id)}
          title="Dismiss"
          className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Bell component ───────────────────────────────────────────────────────────

interface NotificationBellProps {
  /** Extra class for positioning the trigger button */
  className?: string;
}

export function NotificationBell({ className }: NotificationBellProps) {
  const [open,          setOpen]          = useState(false);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Fetch unread count ─────────────────────────────────────────────────────
  const refreshCount = useCallback(() => {
    notificationApi.count()
      .then((r) => setUnreadCount(r.count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // ── SSE: re-fetch count when a new notification arrives ───────────────────
  const handleNotificationEvent = useCallback(() => {
    refreshCount();
  }, [refreshCount]);

  useSSEEvent('notification', handleNotificationEvent);

  // ── Load notifications when dropdown opens ─────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    notificationApi.list({ limit: 20 })
      .then((r) => setNotifications(r.notifications))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // ── Click-outside to close ─────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // ── Mark single as read ────────────────────────────────────────────────────
  function handleRead(id: string) {
    notificationApi.markRead(id).then((r) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? r.notification : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }).catch(() => {});
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function handleDelete(id: string) {
    const was = notifications.find((n) => n.id === id);
    notificationApi.delete(id).then(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (was && !was.isRead) setUnreadCount((c) => Math.max(0, c - 1));
    }).catch(() => {});
  }

  // ── Mark all read ──────────────────────────────────────────────────────────
  function handleMarkAllRead() {
    notificationApi.markAllRead().then(() => {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    }).catch(() => {});
  }

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Bell trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                View all <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border/50">
            {loading && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Bell className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            )}
            {!loading && notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onRead={handleRead}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Footer */}
          {!loading && notifications.length > 0 && (
            <div className="border-t border-border px-4 py-2.5 text-center">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline"
              >
                See all notifications
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
