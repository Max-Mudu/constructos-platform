/**
 * Review state for the 9 report sections. Pure functions only.
 *
 * Every review action (accept the AI suggestion, save an edit, mark the
 * section as not applicable) writes the section value AND records the section
 * in reviewedSections. Finalising is allowed only when all 9 are reviewed.
 */
import {
  SECTION_KEYS,
  type DailyReport,
  type DailyReportContentV1,
  type DailyReportDraftV1,
  type DailyReportSections,
  type SectionKey,
} from '@/lib/daily-report-types';
import { deepEqual, emptySection, sanitizeContent, sanitizeSection, sectionIsEmpty } from './content';

export type ReviewAction =
  | { type: 'accept'; section: SectionKey; suggestion: DailyReportDraftV1 }
  | { type: 'edit'; section: SectionKey; value: DailyReportSections[SectionKey] }
  | { type: 'markNotApplicable'; section: SectionKey };

export const SECTION_LABELS: Record<SectionKey, string> = {
  weather: 'Weather',
  manpower: 'Manpower on site',
  workCompleted: 'Work completed',
  delays: 'Delays',
  safety: 'Safety',
  materialsDeliveries: 'Materials & deliveries',
  visitorsInstructions: 'Visitors & instructions',
  tomorrowPlan: "Tomorrow's plan",
  remarks: 'Remarks',
};

/** Adds a section to reviewedSections, keeping the canonical section order. */
export function markReviewed(reviewed: readonly SectionKey[], section: SectionKey): SectionKey[] {
  const set = new Set<SectionKey>([...reviewed, section]);
  return SECTION_KEYS.filter((k) => set.has(k));
}

/** Applies one review action. Returns new content; the input is not mutated. */
export function applyReviewAction(content: DailyReportContentV1, action: ReviewAction): DailyReportContentV1 {
  const base = sanitizeContent(content);
  const { section } = action;
  let value: DailyReportSections[SectionKey];
  switch (action.type) {
    case 'accept':
      value = sanitizeSection(section, action.suggestion[section]);
      break;
    case 'edit':
      value = sanitizeSection(section, action.value);
      break;
    case 'markNotApplicable':
      value = emptySection(section);
      break;
  }
  return {
    ...base,
    [section]: value,
    reviewedSections: markReviewed(base.reviewedSections, section),
  } as DailyReportContentV1;
}

export interface ReviewProgress {
  reviewed: number;
  total: number;
  missing: SectionKey[];
  complete: boolean;
}

export function reviewProgress(content: Pick<DailyReportContentV1, 'reviewedSections'> | null | undefined): ReviewProgress {
  const done = new Set(content?.reviewedSections ?? []);
  const missing = SECTION_KEYS.filter((k) => !done.has(k));
  return { reviewed: SECTION_KEYS.length - missing.length, total: SECTION_KEYS.length, missing, complete: missing.length === 0 };
}

/**
 * Finalise is enabled only for an editable draft whose 9 sections are all
 * reviewed, with no save in flight and no unresolved conflict.
 */
export function canFinalise(
  report: Pick<DailyReport, 'status' | 'canEdit' | 'content'> | null | undefined,
  opts: { busy?: boolean; conflict?: boolean } = {},
): boolean {
  if (!report || report.status !== 'draft' || !report.canEdit) return false;
  if (opts.busy || opts.conflict) return false;
  return reviewProgress(report.content).complete;
}

export type SuggestionState = 'none' | 'empty' | 'same' | 'different';

/** How the AI suggestion relates to the current content for one section. */
export function suggestionState(
  section: SectionKey,
  content: DailyReportContentV1,
  draft: DailyReportDraftV1 | null | undefined,
): SuggestionState {
  if (!draft) return 'none';
  const s = sanitizeSection(section, draft[section]);
  if (sectionIsEmpty(section, s)) return 'empty';
  return deepEqual(s, sanitizeSection(section, content[section])) ? 'same' : 'different';
}

/** Whether "Mark as not applicable" would discard something the user can see. */
export function notApplicableDiscards(section: SectionKey, content: DailyReportContentV1): boolean {
  return !sectionIsEmpty(section, content[section]);
}

/** Filters a server-provided `missing` list down to valid section keys. */
export function parseMissingSections(missing: unknown): SectionKey[] {
  if (!Array.isArray(missing)) return [];
  const set = new Set(missing.filter((m): m is SectionKey => (SECTION_KEYS as readonly string[]).includes(m as string)));
  return SECTION_KEYS.filter((k) => set.has(k));
}
