'use client';

import { forwardRef, useState } from 'react';
import { Ban, Check, CheckCircle2, Pencil, Sparkles } from 'lucide-react';
import type { AiDraft, DailyReportContentV1, DailyReportSections, SectionKey } from '@/lib/daily-report-types';
import { cn } from '@/lib/utils';
import { sanitizeSection, sectionIsEmpty } from './content';
import { SectionEditor } from './editors';
import { useReport } from './ReportContext';
import type { ErrorView } from './report-errors';
import { SECTION_LABELS, notApplicableDiscards, suggestionState, type ReviewAction } from './review-state';
import { SectionView } from './SectionView';
import { flaggedKeysIn, groupUnsupportedBySection } from './unsupported-numbers';
import { Chip, DButton, DCard, Notice } from './ui';

type Mode = 'view' | 'edit' | 'confirmNA';

export const SectionCard = forwardRef<HTMLDivElement, {
  section: SectionKey;
  content: DailyReportContentV1;
  aiDraft: AiDraft | null | undefined;
  editable: boolean;
  highlight: boolean;
}>(function SectionCard({ section, content, aiDraft, editable, highlight }, ref) {
  const { review } = useReport();
  const [mode, setMode] = useState<Mode>('view');
  const [draftValue, setDraftValue] = useState<DailyReportSections[SectionKey] | null>(null);
  const [startedFromAi, setStartedFromAi] = useState(false);
  const [busy, setBusy] = useState<ReviewAction['type'] | null>(null);
  const [error, setError] = useState<(ErrorView & { conflict?: boolean }) | null>(null);
  const [lastAction, setLastAction] = useState<ReviewAction | null>(null);

  const reviewed = content.reviewedSections.includes(section);
  const current = content[section];
  const suggestion = aiDraft ? sanitizeSection(section, aiDraft.draft[section]) : null;
  const sState = suggestionState(section, content, aiDraft?.draft);
  const unsupported = aiDraft?.unsupportedNumbers ?? [];
  const flaggedCount = groupUnsupportedBySection(unsupported)[section].length;
  const flaggedInSuggestion = aiDraft ? flaggedKeysIn(aiDraft.draft, unsupported, section) : new Set<string>();
  const flaggedInCurrent = flaggedKeysIn(content, unsupported, section);
  const currentEmpty = sectionIsEmpty(section, current);

  async function run(action: ReviewAction) {
    setBusy(action.type);
    setError(null);
    setLastAction(action);
    const res = await review(action);
    setBusy(null);
    if (res.ok) {
      setMode('view');
      setDraftValue(null);
      setLastAction(null);
    } else {
      setError({ ...res.error, conflict: res.conflict });
    }
  }

  function startEdit() {
    setError(null);
    const fromAi = currentEmpty && suggestion !== null && !sectionIsEmpty(section, suggestion);
    setStartedFromAi(fromAi);
    setDraftValue(fromAi ? suggestion : sanitizeSection(section, current));
    setMode('edit');
  }

  const editorFlagged = draftValue !== null
    ? flaggedKeysIn({ [section]: draftValue }, unsupported, section)
    : new Set<string>();

  return (
    <DCard
      ref={ref}
      id={`section-${section}`}
      className={cn(
        'scroll-mt-20 space-y-3 transition-shadow',
        highlight && !reviewed && 'border-destructive ring-2 ring-destructive/30',
        reviewed && 'border-success/30',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{SECTION_LABELS[section]}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {flaggedCount > 0 && <Chip tone="warning">{flaggedCount} to check</Chip>}
          {reviewed ? (
            <Chip tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden />Reviewed</Chip>
          ) : (
            <Chip tone={highlight ? 'danger' : 'neutral'}>{highlight ? 'Needs review' : 'To review'}</Chip>
          )}
        </div>
      </div>

      {mode === 'edit' && draftValue !== null ? (
        <div className="space-y-4">
          {startedFromAi && (
            <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-tertiary))]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Started from the AI suggestion — change anything that is wrong.
            </p>
          )}
          <SectionEditor
            section={section}
            value={draftValue}
            onChange={(v) => setDraftValue(v)}
            flagged={editorFlagged}
          />
          {error && (
            <Notice tone={error.conflict ? 'warning' : 'danger'} title={error.title} live>
              {error.message}
            </Notice>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <DButton
              block
              loading={busy === 'edit'}
              onClick={() => void run({ type: 'edit', section, value: draftValue })}
            >
              <Check className="h-4 w-4" aria-hidden />
              {error?.conflict ? 'Save mine anyway' : 'Save section'}
            </DButton>
            <DButton
              variant="secondary"
              block
              disabled={busy !== null}
              onClick={() => { setMode('view'); setDraftValue(null); setError(null); }}
            >
              {error?.conflict ? 'Keep the other version' : 'Cancel'}
            </DButton>
          </div>
        </div>
      ) : (
        <>
          {sState === 'different' && suggestion !== null ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-primary/25 bg-accent/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent-foreground">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI suggestion
                </p>
                <SectionView section={section} value={suggestion} flagged={flaggedInSuggestion} />
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">In the report now</p>
                <SectionView section={section} value={current} flagged={flaggedInCurrent} emptyText="Nothing yet" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sState === 'same' && (
                <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-tertiary))]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Matches the AI suggestion
                </p>
              )}
              {sState === 'empty' && currentEmpty && (
                <p className="text-xs text-[hsl(var(--text-tertiary))]">The AI found nothing for this section in your notes.</p>
              )}
              <SectionView
                section={section}
                value={current}
                flagged={flaggedInCurrent}
                emptyText={reviewed ? 'Not applicable' : 'Nothing entered yet'}
              />
            </div>
          )}

          {error && (
            <Notice
              tone={error.conflict ? 'warning' : 'danger'}
              title={error.title}
              live
              actions={error.conflict && lastAction ? (
                <>
                  <DButton size="sm" onClick={() => void run(lastAction)}>Apply my change again</DButton>
                  <DButton size="sm" variant="secondary" onClick={() => setError(null)}>Keep the other version</DButton>
                </>
              ) : undefined}
            >
              {error.message}
            </Notice>
          )}

          {editable && mode === 'confirmNA' && (
            <Notice
              tone="warning"
              title="Clear this section?"
              actions={(
                <>
                  <DButton size="sm" variant="danger" loading={busy === 'markNotApplicable'}
                    onClick={() => void run({ type: 'markNotApplicable', section })}>
                    Clear and mark not applicable
                  </DButton>
                  <DButton size="sm" variant="secondary" onClick={() => setMode('view')} disabled={busy !== null}>Keep it</DButton>
                </>
              )}
            >
              What is in this section now will be removed from the report.
            </Notice>
          )}

          {editable && mode === 'view' && (
            <div className="flex flex-wrap gap-2">
              {sState === 'different' && aiDraft && (
                <DButton
                  className="flex-1"
                  loading={busy === 'accept'}
                  disabled={busy !== null}
                  onClick={() => void run({ type: 'accept', section, suggestion: aiDraft.draft })}
                >
                  <Check className="h-4 w-4" aria-hidden /> Accept suggestion
                </DButton>
              )}
              {sState !== 'different' && !reviewed && !currentEmpty && (
                <DButton
                  className="flex-1"
                  loading={busy === 'edit'}
                  disabled={busy !== null}
                  onClick={() => void run({ type: 'edit', section, value: current })}
                >
                  <Check className="h-4 w-4" aria-hidden /> Looks right
                </DButton>
              )}
              <DButton variant="secondary" className="flex-1" disabled={busy !== null} onClick={startEdit}>
                <Pencil className="h-4 w-4" aria-hidden /> {currentEmpty && sState !== 'different' ? 'Fill in' : 'Edit'}
              </DButton>
              {!(reviewed && currentEmpty) && (
                <DButton
                  variant="ghost"
                  className="flex-1"
                  loading={busy === 'markNotApplicable'}
                  disabled={busy !== null}
                  onClick={() => {
                    if (notApplicableDiscards(section, content)) setMode('confirmNA');
                    else void run({ type: 'markNotApplicable', section });
                  }}
                >
                  <Ban className="h-4 w-4" aria-hidden /> Mark as not applicable
                </DButton>
              )}
            </div>
          )}
        </>
      )}
    </DCard>
  );
});
