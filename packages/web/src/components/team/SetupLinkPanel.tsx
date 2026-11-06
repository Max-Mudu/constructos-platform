'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, KeyRound, MailCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface SetupLinkPanelProps {
  /** Email of the member the link belongs to. */
  email:          string;
  /** One-time link; only present outside production. */
  setupLink?:     string;
  setupEmailSent: boolean;
  onDismiss:      () => void;
  /** Defaults to "<email> was added to your team". */
  heading?:       string;
}

/**
 * Shows the result of adding a member.
 *
 * The setup link is a bearer credential: whoever opens it chooses the
 * member's password. It lives only in the parent's React state, is rendered
 * as read-only text (never a clickable link, so it cannot leak through a
 * Referer or be opened by the admin's own session), and disappears for good
 * when the panel is dismissed or the page is left.
 */
export function SetupLinkPanel({ email, setupLink, setupEmailSent, onDismiss, heading }: SetupLinkPanelProps) {
  const [copied, setCopied]       = useState(false);
  const [copyError, setCopyError] = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const resetTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function handleCopy() {
    if (!setupLink) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(setupLink);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context): select the text so
      // the admin can copy it manually.
      inputRef.current?.select();
      setCopyError(true);
    }
  }

  return (
    <section
      role="region"
      aria-label="New team member access"
      className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{heading ?? `${email} was added to your team`}</p>
          {setupEmailSent ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MailCheck className="h-3.5 w-3.5 text-emerald-400" />
              A setup email was sent to {email}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No setup email was sent. {setupLink
                ? 'Share the link below, or ask them to use “Forgot password” on the sign-in page.'
                : 'Ask them to use “Forgot password” on the sign-in page to choose a password.'}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {setupLink && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-400">
            <KeyRound className="h-3.5 w-3.5" />
            One-time setup link — share privately, expires in 60 minutes
          </p>
          <p className="text-xs text-muted-foreground">
            Anyone with this link can set this member&apos;s password. It is shown only once and
            will not be shown again after you close this panel or leave the page.
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              readOnly
              aria-label="One-time setup link"
              value={setupLink}
              autoComplete="off"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 w-full min-w-0 rounded-lg border border-border bg-navy-base px-3 font-mono text-xs text-foreground"
            />
            <Button variant="outline" onClick={handleCopy}>
              <Copy className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copyError && (
            <p className="text-xs text-red-400">Could not copy automatically — the link is selected, copy it manually.</p>
          )}
        </div>
      )}

      <div>
        <Button variant="secondary" size="sm" onClick={onDismiss}>Done</Button>
      </div>
    </section>
  );
}
