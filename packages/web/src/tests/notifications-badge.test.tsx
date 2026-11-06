/**
 * The unread badge follows changes made on /notifications and in the other
 * bell. Before, each NotificationBell only refreshed on mount and on SSE
 * 'notification' events, so marking read / marking all read / deleting on the
 * notifications page (or in the desktop bell while the mobile one is mounted)
 * left a stale count until reload.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Notification } from '@/lib/types';

let serverItems: Notification[] = [];
const unread = () => serverItems.filter((n) => !n.isRead).length;

const mockCount = jest.fn(async () => ({ count: unread() }));
const mockList = jest.fn(async () => ({ notifications: serverItems.map((n) => ({ ...n })), total: serverItems.length }));
const mockMarkRead = jest.fn(async (id: string) => {
  serverItems = serverItems.map((n) => (n.id === id ? { ...n, isRead: true, readAt: 'now' } : n));
  return { notification: serverItems.find((n) => n.id === id)! };
});
const mockMarkAll = jest.fn(async () => {
  const count = unread();
  serverItems = serverItems.map((n) => ({ ...n, isRead: true, readAt: 'now' }));
  return { count };
});
const mockDelete = jest.fn(async (id: string) => {
  serverItems = serverItems.filter((n) => n.id !== id);
});

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return {
    ApiError,
    notificationApi: {
      count: () => mockCount(),
      list: () => mockList(),
      markRead: (id: string) => mockMarkRead(id),
      markAllRead: () => mockMarkAll(),
      delete: (id: string) => mockDelete(id),
    },
  };
});
jest.mock('@/hooks/useSSEEvent', () => ({ useSSEEvent: () => {} }));

import { NotificationBell } from '@/components/notifications/NotificationBell';
import NotificationsPage from '@/app/(app)/notifications/page';
import { notifyNotificationsChanged, onNotificationsChanged } from '@/lib/notifications-events';

function n(id: string, isRead = false): Notification {
  return {
    id, companyId: 'c1', userId: 'u1', type: 'system', title: `Title ${id}`, body: `Body ${id}`,
    entityType: null, entityId: null, isRead, readAt: isRead ? 'then' : null, createdAt: new Date().toISOString(),
  };
}

/** The two bell trigger buttons (desktop sidebar + mobile header). */
const bells = () => screen.getAllByRole('button', { name: /^Notifications/ });
const bellLabels = () => bells().map((b) => b.getAttribute('aria-label'));

async function expectBells(count: number) {
  const label = count > 0 ? `Notifications — ${count} unread` : 'Notifications';
  await waitFor(() => expect(bellLabels()).toEqual([label, label]));
}

function renderAll() {
  return render(
    <>
      <NotificationBell />
      <NotificationBell />
      <NotificationsPage />
    </>,
  );
}

beforeEach(() => {
  serverItems = [n('a'), n('b'), n('c'), n('d', true)];
  jest.clearAllMocks();
});

describe('notifications-events', () => {
  it('calls every subscriber and stops after unsubscribe', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = onNotificationsChanged(a);
    const offB = onNotificationsChanged(b);
    notifyNotificationsChanged();
    offA();
    notifyNotificationsChanged();
    offB();
    notifyNotificationsChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('a throwing subscriber does not block the others', () => {
    const ok = jest.fn();
    const offBad = onNotificationsChanged(() => { throw new Error('boom'); });
    const offOk = onNotificationsChanged(ok);
    expect(() => notifyNotificationsChanged()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    offBad(); offOk();
  });
});

describe('unread badge follows the notifications page', () => {
  it('mark read, delete and mark all read on /notifications update both bells', async () => {
    renderAll();
    await expectBells(3);
    await screen.findByText('Title a');

    fireEvent.click(screen.getAllByTitle('Mark as read')[0]);
    await expectBells(2);

    // Delete an unread one
    const cardC = screen.getByText('Title c').closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(cardC).getByTitle('Delete'));
    await expectBells(1);

    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }));
    await expectBells(0);
  });

  it('a failed mutation does not refetch the count (control)', async () => {
    renderAll();
    await expectBells(3);
    await screen.findByText('Title a');
    const countCalls = mockCount.mock.calls.length;

    mockMarkRead.mockRejectedValueOnce(new Error('network'));
    await act(async () => { fireEvent.click(screen.getAllByTitle('Mark as read')[0]); });

    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(mockCount.mock.calls.length).toBe(countCalls);
    expect(bellLabels()).toEqual(['Notifications — 3 unread', 'Notifications — 3 unread']);
  });
});

describe('unread badge follows the other bell', () => {
  it('marking read in one bell updates the other', async () => {
    render(<><NotificationBell /><NotificationBell /></>);
    await expectBells(3);

    fireEvent.click(bells()[0]);
    await screen.findByText('Title a');
    fireEvent.click(screen.getAllByTitle('Mark as read')[0]);
    await expectBells(2);
  });
});
