'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Bell, CheckCheck, Trash2, AlertCircle, Settings, X,
} from 'lucide-react';
import { notificationApi, ApiError } from '@/lib/api';
import { Notification } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { cn } from '@/lib/utils';
import { notifyNotificationsChanged } from '@/lib/notifications-events';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  instruction_created:    'Instruction',
  instruction_updated:    'Instruction',
  budget_approved:        'Budget',
  invoice_status_changed: 'Invoice',
  delivery_received:      'Delivery',
  drawing_approved:       'Drawing',
  system:                 'System',
};

const TYPE_VARIANT: Record<string, 'info' | 'pending' | 'active' | 'warning' | 'secondary'> = {
  instruction_created:    'info',
  instruction_updated:    'info',
  budget_approved:        'active',
  invoice_status_changed: 'pending',
  delivery_received:      'active',
  drawing_approved:       'active',
  system:                 'secondary',
};

function relativeTime(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1)  return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  <  7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Message for a failed action, e.g. "Could not delete the notification: <API message>". */
function actionErrorMessage(err: unknown, action: string): string {
  return err instanceof ApiError && err.message
    ? `Could not ${action}: ${err.message}`
    : `Could not ${action}. Check your connection and retry.`;
}

// ─── Notification card ────────────────────────────────────────────────────────

function NotificationCard({
  notification,
  onRead,
  onDelete,
  busy,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  /** A request for this notification is in flight: its actions are disabled. */
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 rounded-xl border bg-card p-4 transition-all',
        notification.isRead
          ? 'border-border opacity-75'
          : 'border-primary/30 bg-primary/5',
      )}
    >
      {/* Unread dot */}
      <div className="mt-1.5 flex-none">
        <div
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            notification.isRead ? 'bg-muted-foreground/20' : 'bg-primary',
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={TYPE_VARIANT[notification.type] ?? 'secondary'}>
            {TYPE_LABEL[notification.type] ?? notification.type}
          </Badge>
          <span className="text-xs text-muted-foreground">{relativeTime(notification.createdAt)}</span>
          {notification.isRead && (
            <span className="text-xs text-muted-foreground/50">Read</span>
          )}
        </div>
        <p className="mt-1.5 text-sm font-medium text-foreground">{notification.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{notification.body}</p>
      </div>

      {/* Actions */}
      <div className="flex-none flex items-center gap-1">
        {!notification.isRead && (
          <button
            type="button"
            onClick={() => onRead(notification.id)}
            disabled={busy}
            aria-busy={busy || undefined}
            title="Mark as read"
            className="rounded-md p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(notification.id)}
          disabled={busy}
          aria-busy={busy || undefined}
          title="Delete"
          className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [readFilter,    setReadFilter]    = useState('');
  const [typeFilter,    setTypeFilter]    = useState('');
  const [search,        setSearch]        = useState('');
  const [actionError,   setActionError]   = useState('');
  /** Notification ids with a mark-read or delete request in flight. */
  const [busyIds,       setBusyIds]       = useState<ReadonlySet<string>>(new Set());
  const [markingAll,    setMarkingAll]    = useState(false);
  // Synchronous guards so a fast double click cannot send a second request
  // before the disabled state has rendered.
  const busyRef        = useRef(new Set<string>());
  const markingAllRef  = useRef(false);

  useEffect(() => {
    setLoading(true);
    notificationApi.list({
      isRead: readFilter === '' ? undefined : readFilter === 'true',
      type:   typeFilter || undefined,
      limit:  100,
    })
      .then((r) => { setNotifications(r.notifications); setTotal(r.total); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load notifications'))
      .finally(() => setLoading(false));
  }, [readFilter, typeFilter]);

  const filtered = useMemo(() => {
    if (!search) return notifications;
    const q = search.toLowerCase();
    return notifications.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notifications, search]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  function setBusy(id: string, busy: boolean) {
    if (busy) busyRef.current.add(id); else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  }

  // The list only changes once the server confirms, so a failed request leaves
  // the page exactly as it was and only adds the error message.
  function handleRead(id: string) {
    if (busyRef.current.has(id)) return;
    setBusy(id, true);
    setActionError('');
    notificationApi.markRead(id).then((r) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? r.notification : n)));
      notifyNotificationsChanged();
    }).catch((e) => setActionError(actionErrorMessage(e, 'mark the notification as read')))
      .finally(() => setBusy(id, false));
  }

  function handleDelete(id: string) {
    if (busyRef.current.has(id)) return;
    setBusy(id, true);
    setActionError('');
    notificationApi.delete(id).then(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      notifyNotificationsChanged();
    }).catch((e) => setActionError(actionErrorMessage(e, 'delete the notification')))
      .finally(() => setBusy(id, false));
  }

  function handleMarkAllRead() {
    if (markingAllRef.current) return;
    markingAllRef.current = true;
    setMarkingAll(true);
    setActionError('');
    notificationApi.markAllRead().then(() => {
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
      );
      notifyNotificationsChanged();
    }).catch((e) => setActionError(actionErrorMessage(e, 'mark all notifications as read')))
      .finally(() => { markingAllRef.current = false; setMarkingAll(false); });
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-4">
        <Skeleton className="h-12 w-64 rounded-xl" />
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Notifications"
        subtitle={`${total} notification${total !== 1 ? 's' : ''}${unreadCount > 0 ? ` · ${unreadCount} unread` : ''}`}
        action={
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" onClick={handleMarkAllRead} disabled={markingAll} aria-busy={markingAll || undefined}>
                <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
              </Button>
            )}
            <Link href="/settings/notifications">
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-1" /> Settings
              </Button>
            </Link>
          </div>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-start justify-between gap-3">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError('')}
              aria-label="Dismiss error"
              className="flex-none rounded-md p-0.5 hover:bg-red-500/10"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search notifications…"
        filters={[
          {
            label:    'Status',
            value:    readFilter,
            onChange: setReadFilter,
            options:  [
              { value: '',      label: 'All' },
              { value: 'false', label: 'Unread' },
              { value: 'true',  label: 'Read' },
            ],
          },
          {
            label:    'Type',
            value:    typeFilter,
            onChange: setTypeFilter,
            options:  [
              { value: '',                       label: 'All types' },
              { value: 'instruction_created',    label: 'Instruction Created' },
              { value: 'instruction_updated',    label: 'Instruction Updated' },
              { value: 'budget_approved',        label: 'Budget Approved' },
              { value: 'invoice_status_changed', label: 'Invoice Update' },
              { value: 'delivery_received',      label: 'Delivery Received' },
              { value: 'drawing_approved',       label: 'Drawing Approved' },
              { value: 'system',                 label: 'System' },
            ],
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-12 w-12" />}
          title="No notifications"
          description={
            readFilter === 'false'
              ? 'All caught up — no unread notifications.'
              : 'No notifications match your filters.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onRead={handleRead}
              onDelete={handleDelete}
              busy={busyIds.has(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
