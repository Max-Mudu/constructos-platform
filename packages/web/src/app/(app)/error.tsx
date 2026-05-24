'use client';

import { useEffect } from 'react';

// Catches runtime errors thrown by any page or component inside app/(app)/*.
// The sidebar and auth session are still rendered; only the page content is replaced.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the browser console so it shows in Railway logs via server-side rendering
    // and in browser devtools for client-side debugging during pilot.
    console.error('[AppError]', error.message, error.digest ?? '');
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          An unexpected error occurred in this section. Your other work is not affected.
          {error.digest ? (
            <span className="block mt-1 font-mono text-xs opacity-50">
              ref: {error.digest}
            </span>
          ) : null}
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
