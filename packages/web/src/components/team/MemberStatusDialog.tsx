'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { teamApi, type SetTeamMemberStatusResponse, type TeamMember } from '@/lib/team-api';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export type StatusAction = 'deactivate' | 'reactivate';

/**
 * Wording for a failed status change. 409s carry the server's own message
 * (self-deactivation, last active company admin) and are shown verbatim — the
 * API is the authority on those rules, the UI only hides the obvious case.
 */
export function statusErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.message) return err.message;
    if (err.status === 404) return 'This person is no longer in your company. Refresh the list.';
    if (err.status === 403) return 'Only an active company admin can change who has access.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
    return err.message || 'The change could not be saved.';
  }
  return 'The change could not be saved.';
}

export interface MemberStatusDialogProps {
  member:   TeamMember;
  action:   StatusAction;
  onClose:  () => void;
  onDone:   (res: SetTeamMemberStatusResponse) => void;
}

/**
 * Confirmation step for deactivating / reactivating a team member.
 * Accessible modal without a portal: focus moves into the dialog, Escape and
 * the backdrop cancel (unless a request is in flight), focus is restored.
 */
export function MemberStatusDialog({ member, action, onClose, onDone }: MemberStatusDialogProps) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const ref               = useRef<HTMLDivElement>(null);
  const busyRef           = useRef(false);
  const name              = `${member.firstName} ${member.lastName}`.trim() || member.email;
  const deactivating      = action === 'deactivate';

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await teamApi.setStatus(member.id, !deactivating);
      onDone(res);
    } catch (err) {
      setError(statusErrorMessage(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div
        className="absolute inset-0 bg-[#121826]/50"
        aria-hidden
        onClick={() => { if (!busyRef.current) onClose(); }}
      />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="team-status-title"
        aria-describedby="team-status-desc"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl space-y-4"
      >
        <h2 id="team-status-title" className="text-lg font-semibold text-foreground">
          {deactivating ? `Deactivate ${name}?` : `Reactivate ${name}?`}
        </h2>

        <div id="team-status-desc" className="space-y-2 text-sm text-muted-foreground">
          {deactivating ? (
            <>
              <p className="font-medium text-foreground">
                This signs them out everywhere immediately — web and mobile.
              </p>
              <p>
                They cannot sign in again until a company admin reactivates them. Any unused setup
                or password-reset link stops working.
              </p>
              <p>
                Their project assignments are kept on record. Remove them from a project on its
                Members page if they should not get it back after a reactivation.
              </p>
            </>
          ) : (
            <>
              <p>
                They can sign in again with their existing password and get back the project
                access they still have. Projects they were removed from stay removed.
              </p>
              <p>
                Old sessions and setup links stay revoked. If they never chose a password, they can
                use “Forgot password” on the sign-in page.
              </p>
            </>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button
            variant={deactivating ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            loading={busy}
          >
            {busy
              ? (deactivating ? 'Deactivating…' : 'Reactivating…')
              : (deactivating ? 'Deactivate and sign out' : 'Reactivate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
