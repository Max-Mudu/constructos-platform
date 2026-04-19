import { useEffect } from 'react';
import { useSSE } from '../providers/SSEProvider';

type Handler = (payload: Record<string, unknown>) => void;

export function useSSEEvent(eventType: string, handler: Handler): void {
  const { subscribe } = useSSE();

  useEffect(() => {
    const unsub = subscribe(eventType, handler);
    return unsub;
  }, [subscribe, eventType, handler]);
}
