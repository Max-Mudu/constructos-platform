/**
 * "Notifications changed" signal for the unread badge.
 *
 * NotificationBell keeps its own unread count, and the sidebar mounts two bells
 * (desktop and mobile header). Marking read, marking all read or deleting on
 * /notifications — or in one bell — left the other badges stale until reload.
 * Whoever changes notifications calls notifyNotificationsChanged(); every bell
 * subscribes and re-fetches the count from the API, which stays the source of
 * truth (no client-side arithmetic to drift).
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onNotificationsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyNotificationsChanged(): void {
  // Copy so a listener that unsubscribes during dispatch does not skip another.
  for (const listener of Array.from(listeners)) {
    try { listener(); } catch { /* one bad listener must not block the rest */ }
  }
}
