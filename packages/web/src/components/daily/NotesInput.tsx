'use client';

import { useEffect, useRef } from 'react';
import { Check, CloudOff, Loader2, Mic } from 'lucide-react';
import { LIMITS } from '@/lib/daily-report-types';
import { cn } from '@/lib/utils';
import { useReport, type NotesStatus } from './ReportContext';
import { DButton, DCard, Notice } from './ui';

function SaveState({ status }: { status: NotesStatus }) {
  const map: Record<NotesStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    saved: { icon: <Check className="h-3.5 w-3.5" aria-hidden />, text: 'Saved', cls: 'text-success' },
    pending: { icon: <Loader2 className="h-3.5 w-3.5 opacity-0" aria-hidden />, text: 'Unsaved changes', cls: 'text-[hsl(var(--text-tertiary))]' },
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />, text: 'Saving…', cls: 'text-[hsl(var(--text-tertiary))]' },
    error: { icon: <CloudOff className="h-3.5 w-3.5" aria-hidden />, text: 'Not saved', cls: 'text-destructive' },
    conflict: { icon: <CloudOff className="h-3.5 w-3.5" aria-hidden />, text: 'Needs your choice', cls: 'text-warning' },
  };
  const s = map[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', s.cls)} aria-live="polite">
      {s.icon}
      {s.text}
    </span>
  );
}

const fmt = new Intl.NumberFormat('en-KE');

export function NotesInput({ disabled = false }: { disabled?: boolean }) {
  const { notes, setNotes, notesStatus, notesError, notesConflict, flushNotes, resolveNotesConflict } = useReport();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text so the whole note stays visible while dictating.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 220), 900)}px`;
  }, [notes]);

  const count = notes.length;
  const near = count > LIMITS.rawInput * 0.9;

  return (
    <DCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="dr-notes" className="text-base font-semibold text-foreground">What happened on site today?</label>
        <SaveState status={notesStatus} />
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">
        <Mic className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Tap the 🎤 on your keyboard to dictate. Mention workers by trade, work done, deliveries, delays, safety and visitors — in any order.</span>
      </p>
      <textarea
        id="dr-notes"
        ref={ref}
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, LIMITS.rawInput))}
        onBlur={() => void flushNotes()}
        disabled={disabled}
        maxLength={LIMITS.rawInput}
        rows={9}
        spellCheck
        autoCapitalize="sentences"
        placeholder="e.g. 6 masons and 4 helpers from our team. Finished block work on level 2 east wing. 200 bags of cement delivered at 10am. Rain stopped work 2–3pm. Toolbox talk on working at height…"
        className="w-full resize-none rounded-xl border border-input bg-card px-3 py-3 text-[16px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background"
        aria-describedby="dr-notes-count"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-[hsl(var(--text-tertiary))]">Saved automatically as you type.</span>
        <span id="dr-notes-count" className={cn('tabular-nums', near ? 'font-semibold text-warning' : 'text-[hsl(var(--text-tertiary))]')}>
          {fmt.format(count)} / {fmt.format(LIMITS.rawInput)}
        </span>
      </div>

      {notesStatus === 'error' && notesError && (
        <Notice
          tone="danger"
          title={notesError.title}
          live
          actions={<DButton variant="secondary" size="sm" onClick={() => void flushNotes()}>Try saving again</DButton>}
        >
          {notesError.message} Your text is kept on this phone until it is saved.
        </Notice>
      )}

      {notesConflict !== null && (
        <Notice
          tone="warning"
          title="These notes were changed on another device"
          live
          actions={(
            <>
              <DButton size="sm" onClick={() => resolveNotesConflict('mine')}>Keep my version</DButton>
              <DButton variant="secondary" size="sm" onClick={() => resolveNotesConflict('theirs')}>Use the other version</DButton>
            </>
          )}
        >
          <p>Your text is still here. Choose which version to keep. The other version reads:</p>
          <blockquote className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-2 text-[13px] text-foreground">
            {notesConflict || '(empty)'}
          </blockquote>
        </Notice>
      )}
    </DCard>
  );
}
