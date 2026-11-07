import { AlertCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Alert, AlertDescription } from './Alert';
import { Button } from './Button';

/**
 * The message shown when a page's data fails to load, e.g. for `what` =
 * "projects": "Could not load projects: <API message>", or, for a network
 * failure, "Could not load projects. Check your connection and retry."
 */
export function loadErrorMessage(err: unknown, what: string): string {
  return err instanceof ApiError && err.message
    ? `Could not load ${what}: ${err.message}`
    : `Could not load ${what}. Check your connection and retry.`;
}

/**
 * Inline error for a failed data load, so a page never shows an empty list or
 * dropdown with no explanation. Pass `onRetry` when the page can reload.
 */
export function LoadErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
