'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** React Query for the (daily) route group only. */
export function DailyProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) => {
              const status = (err as { status?: number } | null)?.status ?? 0;
              // Never retry auth/permission/not-found/validation answers.
              if (status >= 400 && status < 500) return false;
              return count < 2;
            },
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      }),
  );
  // react-query resolves @types/react from the repo root; bridge the duplicate ReactNode type.
  type QcChildren = Parameters<typeof QueryClientProvider>[0]["children"];
  return <QueryClientProvider client={client}>{children as QcChildren}</QueryClientProvider>;
}
