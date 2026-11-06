/**
 * SSEProvider — ported from packages/web/src/providers/SSEProvider.tsx
 * Uses react-native-sse instead of the browser EventSource API.
 *
 * The API (GET /api/v1/events?token=<access JWT>) sends NAMED events:
 *   event: <type>\ndata: <JSON payload>\n\n
 * so each type needs its own listener; nothing arrives on 'message'.
 *
 * The stream only runs while a user is signed in, and restarts when the
 * signed-in user changes (login / logout / session expiry).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import EventSource from 'react-native-sse';
import { getAccessToken } from '../auth/secureStorage';
import { API_BASE_URL } from '../constants/api';
import { useAuthStore } from '../store/auth.store';
import { apiClient } from '../api/client';

const BASE_URL = API_BASE_URL;
const RECONNECT_BASE_DELAY = 5_000;
const RECONNECT_MAX_DELAY  = 60_000;

// Event types the server emits (see packages/api emitToCompany / emitToUser
// callers) plus types screens subscribe to. Types subscribed later than the
// connection are picked up on the next (re)connect.
const KNOWN_EVENT_TYPES = [
  'notification',
  'invoice_updated',
  'invoice_created',
  'delivery_created',
  'labour_created',
  'instruction_updated',
  'dashboard',
] as const;

type SSEStatus = 'connecting' | 'connected' | 'disconnected';
type Handler = (payload: Record<string, unknown>) => void;

interface SSEContextValue {
  status:    SSEStatus;
  subscribe: (eventType: string, handler: Handler) => () => void;
}

const SSEContext = createContext<SSEContextValue>({
  status:    'disconnected',
  subscribe: () => () => {},
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [status, setStatus] = useState<SSEStatus>('disconnected');
  const esRef        = useRef<EventSource<string> | null>(null);
  const listenersRef = useRef<Map<string, Set<Handler>>>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef  = useRef(0);
  // Bumped on every teardown so callbacks from a stale connection are ignored.
  const generationRef = useRef(0);

  const teardown = useCallback(() => {
    generationRef.current += 1;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    esRef.current?.removeAllEventListeners();
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    teardown();
    const generation = generationRef.current;
    setStatus('connecting');

    const token = await getAccessToken();
    if (generation !== generationRef.current) return; // superseded meanwhile
    if (!token) {
      setStatus('disconnected');
      return;
    }

    const url = `${BASE_URL}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource<string>(url);
    esRef.current = es;

    const scheduleReconnect = () => {
      const delay = Math.min(
        RECONNECT_BASE_DELAY * 2 ** failuresRef.current,
        RECONNECT_MAX_DELAY,
      );
      failuresRef.current += 1;
      reconnectRef.current = setTimeout(() => {
        if (generation === generationRef.current) void connect();
      }, delay);
    };

    es.addEventListener('open', () => {
      failuresRef.current = 0;
      setStatus('connected');
    });

    const dispatch = (type: string, raw: string | null) => {
      if (!raw) return;
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
      listenersRef.current.get(type)?.forEach((h) => h(payload));
    };

    const types = new Set<string>([...KNOWN_EVENT_TYPES, ...listenersRef.current.keys()]);
    types.forEach((type) => {
      es.addEventListener(type, (event) => {
        dispatch(type, (event as { data?: string | null }).data ?? null);
      });
    });

    es.addEventListener('error', (event) => {
      if (generation !== generationRef.current) return;
      setStatus('disconnected');
      es.removeAllEventListeners();
      es.close();
      esRef.current = null;

      const httpStatus = 'xhrStatus' in event ? event.xhrStatus : 0;
      // 404 = live updates switched off server-side (SSE_DISABLED) — polling
      // would only keep resending the token in the URL. Stop until the next
      // sign-in.
      if (httpStatus === 404) return;

      if (httpStatus === 401) {
        // Access token expired. One authenticated axios call lets the refresh
        // interceptor rotate it (or end the session, which tears this down
        // via the userId effect). Then reconnect with the new token.
        apiClient.get('/auth/me')
          .catch(() => { /* network / session end handled elsewhere */ })
          .finally(() => {
            if (generation === generationRef.current) scheduleReconnect();
          });
        return;
      }

      scheduleReconnect();
    });
  }, [teardown]);

  useEffect(() => {
    failuresRef.current = 0;
    if (userId) {
      void connect();
    } else {
      teardown();
      setStatus('disconnected');
    }
    return teardown;
  }, [userId, connect, teardown]);

  const subscribe = useCallback((eventType: string, handler: Handler) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType)!.add(handler);
    return () => {
      listenersRef.current.get(eventType)?.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ status, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}
