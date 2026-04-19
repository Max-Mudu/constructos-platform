/**
 * SSEProvider — ported from packages/web/src/providers/SSEProvider.tsx
 * Uses react-native-sse instead of the browser EventSource API.
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

const BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000/api/v1';
const RECONNECT_DELAY = 5000;

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
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const esRef        = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<string, Set<Handler>>>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    esRef.current?.close();
    setStatus('connecting');

    const token = await getAccessToken();
    if (!token) {
      setStatus('disconnected');
      return;
    }

    const url = `${BASE_URL}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('open', () => {
      setStatus('connected');
    });

    es.addEventListener('message', (event) => {
      if (!event.data || event.data === 'heartbeat') return;
      try {
        const parsed = JSON.parse(event.data as string) as {
          type:    string;
          payload: Record<string, unknown>;
        };
        const handlers = listenersRef.current.get(parsed.type);
        handlers?.forEach((h) => h(parsed.payload));
      } catch {
        // Malformed SSE data — ignore
      }
    });

    es.addEventListener('error', () => {
      setStatus('disconnected');
      es.close();
      reconnectRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY);
    });
  }, []);

  useEffect(() => {
    void connect();
    return () => {
      esRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

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
