'use client';

import { useEffect } from 'react';
import { useSSE } from '@/providers/SSEProvider';

/**
 * Subscribe to a single SSE event type.
 *
 * @param eventType  The SSE event name (e.g. 'notification', 'invoice_updated')
 * @param handler    Stable callback — wrap in useCallback to avoid re-subscribing every render
 */
export function useSSEEvent(
  eventType: string,
  handler: (payload: Record<string, unknown>) => void,
): void {
  const { subscribe } = useSSE();

  useEffect(() => {
    const unsub = subscribe(eventType, handler);
    return unsub;
  }, [subscribe, eventType, handler]);
}
