/**
 * Mark read, delete and mark all read on /notifications used to swallow
 * errors. A rejected request now shows an inline error and leaves the list as
 * it was, and each button is disabled while its request is in flight.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Notification } from '@/lib/types';

const mockList = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAll = jest.fn();
const mockDelete = jest.fn();
const mockNotify = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return {
    ApiError,
    notificationApi: {
      list: () => mockList(),
      markRead: (id: string) => mockMarkRead(id),
      markAllRead: () => mockMarkAll(),
      delete: (id: string) => mockDelete(id),
    },
  };
});
jest.mock('@/lib/notifications-events', () => ({ notifyNotificationsChanged: () => mockNotify() }));

import { ApiError } from '@/lib/api';
import NotificationsPage from '@/app/(app)/notifications/page';

function n(id: string, isRead = false): Notification {
  return {
    id, companyId: 'c1', userId: 'u1', type: 'system', title: `Title ${id}`, body: `Body ${id}`,
    entityType: null, entityId: null, isRead, readAt: isRead ? 'then' : null, createdAt: new Date().toISOString(),
  };
}

const serverError = () =>
  new (ApiError as unknown as new (s: number, c: string, m: string) => Error)(500, 'INTERNAL', 'Server unavailable');

/** A promise the test settles by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const card = (id: string) => screen.getByText(`Title ${id}`).closest('div.rounded-xl') as HTMLElement;

async function renderPage() {
  render(<NotificationsPage />);
  await screen.findByText('Title a');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ notifications: [n('a'), n('b'), n('c', true)], total: 3 });
});

describe('notifications page: failed actions', () => {
  it('mark read: shows the API error, keeps the item unread and re-enables the button', async () => {
    const req = deferred<{ notification: Notification }>();
    mockMarkRead.mockReturnValueOnce(req.promise);
    await renderPage();

    const button = within(card('a')).getByTitle('Mark as read');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(within(card('a')).getByTitle('Delete')).toBeDisabled();
    expect(mockMarkRead).toHaveBeenCalledTimes(1);

    await act(async () => { req.reject(serverError()); });

    expect(await screen.findByText('Could not mark the notification as read: Server unavailable')).toBeInTheDocument();
    expect(within(card('a')).getByTitle('Mark as read')).toBeEnabled();
    expect(within(card('a')).queryByText('Read')).not.toBeInTheDocument();
    expect(screen.getByText('3 notifications · 2 unread')).toBeInTheDocument();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('delete: shows the error, keeps the item and the total, and re-enables the button', async () => {
    const req = deferred<void>();
    mockDelete.mockReturnValueOnce(req.promise);
    await renderPage();

    const button = within(card('b')).getByTitle('Delete');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(mockDelete).toHaveBeenCalledTimes(1);

    await act(async () => { req.reject(new Error('network down')); });

    expect(await screen.findByText('Could not delete the notification. Check your connection and retry.')).toBeInTheDocument();
    expect(screen.getByText('Title b')).toBeInTheDocument();
    expect(within(card('b')).getByTitle('Delete')).toBeEnabled();
    expect(screen.getByText('3 notifications · 2 unread')).toBeInTheDocument();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('mark all read: shows the error, keeps unread items unread and re-enables the button', async () => {
    const req = deferred<{ count: number }>();
    mockMarkAll.mockReturnValueOnce(req.promise);
    await renderPage();

    const button = screen.getByRole('button', { name: /Mark all read/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(mockMarkAll).toHaveBeenCalledTimes(1);

    await act(async () => { req.reject(serverError()); });

    expect(await screen.findByText('Could not mark all notifications as read: Server unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark all read/ })).toBeEnabled();
    expect(screen.getAllByTitle('Mark as read')).toHaveLength(2);
    expect(screen.getByText('3 notifications · 2 unread')).toBeInTheDocument();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('the error can be dismissed, and a later successful action clears it', async () => {
    mockMarkRead.mockRejectedValueOnce(serverError());
    await renderPage();

    fireEvent.click(within(card('a')).getByTitle('Mark as read'));
    await screen.findByText(/Could not mark the notification as read/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByText(/Could not mark the notification as read/)).not.toBeInTheDocument();

    mockMarkRead.mockRejectedValueOnce(serverError());
    fireEvent.click(within(card('a')).getByTitle('Mark as read'));
    await screen.findByText(/Could not mark the notification as read/);

    mockMarkRead.mockResolvedValueOnce({ notification: n('a', true) });
    fireEvent.click(within(card('a')).getByTitle('Mark as read'));
    await waitFor(() => expect(screen.queryByText(/Could not mark/)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('3 notifications · 1 unread')).toBeInTheDocument());
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});
