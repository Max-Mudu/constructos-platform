'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  ReactNode,
} from 'react';
import { getAccessToken } from '@/store/auth.store';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SSEStatus = 'connecting' | 'connected' | 'disconnected';

type Handler = (payload: Record<string, unknown>) => void;

interface SSEContextValue {
  status: SSEStatus;
  subscribe: (eventType: string, handler: Handler) => () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SSEContext = createContext<SSEContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

const RECONNECT_DELAY_MS     = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10; // stop retrying after this many failures

export function SSEProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SSEStatus>('connecting');

  // Map of eventType → Set of handlers
  const listenersRef      = useRef<Map<string, Set<Handler>>>(new Map());
  const esRef             = useRef<EventSource | null>(null);
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef         = useRef(true); // false when component unmounts
  const reconnectCountRef = useRef(0);    // resets to 0 on successful connection

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || !activeRef.current) return;

    setStatus('connecting');

    const url = `/api/v1/events?token=${encodeURIComponent(token)}`;
    const es   = new EventSource(url);
    esRef.current = es;

    es.addEventListener('connected', () => {
      reconnectCountRef.current = 0; // reset retry counter on successful connection
      setStatus('connected');
    });

    es.addEventListener('heartbeat', () => {
      // keep-alive; no action needed
    });

    // Generic dispatcher — fires any event through the listener registry
    const dispatch = (type: string, rawData: string) => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(rawData) as Record<string, unknown>; } catch { /* ignore */ }
      const handlers = listenersRef.current.get(type);
      if (handlers) {
        handlers.forEach((h) => h(payload));
      }
    };

    // Known event types from the server
    const eventTypes = [
      'notification',
      'invoice_updated',
      'delivery_created',
      'labour_created',
      'instruction_updated',
      'dashboard',
    ];

    eventTypes.forEach((type) => {
      es.addEventListener(type, (e) => dispatch(type, (e as MessageEvent).data));
    });

    es.onerror = () => {
      if (!activeRef.current) return;
      setStatus('disconnected');
      es.close();
      esRef.current = null;
      // Stop retrying after MAX_RECONNECT_ATTEMPTS — prevents an infinite loop
      // when the server is down or the token is permanently invalid.
      if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectCountRef.current += 1;
      timerRef.current = setTimeout(() => {
        if (activeRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };
  }, []);

  useEffect(() => {
    activeRef.current = true;

    // Wait a tick so the auth store has time to hydrate on initial render
    const init = setTimeout(connect, 200);

    return () => {
      activeRef.current = false;
      clearTimeout(init);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  const subscribe = useCallback((eventType: string, handler: Handler): (() => void) => {
    const map = listenersRef.current;
    if (!map.has(eventType)) map.set(eventType, new Set());
    map.get(eventType)!.add(handler);

    return () => {
      map.get(eventType)?.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ status, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error('useSSE must be used within SSEProvider');
  return ctx;
}
