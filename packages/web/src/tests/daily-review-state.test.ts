import { SECTION_KEYS, type DailyReportContentV1, type DailyReportDraftV1, type SectionKey } from '@/lib/daily-report-types';
import { emptyContent } from '@/components/daily/content';
import {
  applyReviewAction, canFinalise, markReviewed, notApplicableDiscards, parseMissingSections,
  reviewProgress, suggestionState,
} from '@/components/daily/review-state';

function draft(): DailyReportDraftV1 {
  const { reviewedSections: _r, ...sections } = emptyContent();
  void _r;
  return {
    ...sections,
    weather: { conditions: ['sunny'], temperatureC: 27, workStoppedByWeather: false, notes: '' },
    manpower: { entries: [{ trade: 'Mason', count: 6, employer: 'Own staff', notes: '' }], totalOnSite: 10, notes: '' },
    workCompleted: [{ description: 'Block work level 2', location: 'East wing', quantity: 40, unit: 'm²', progressPercent: null }],
    remarks: 'All good',
  };
}

const reportWith = (content: DailyReportContentV1, over: Partial<{ status: 'draft' | 'final'; canEdit: boolean }> = {}) => ({
  status: 'draft' as const, canEdit: true, content, ...over,
});

describe('applyReviewAction', () => {
  it('accept copies the AI suggestion for that section only and marks it reviewed', () => {
    const c = emptyContent();
    const next = applyReviewAction(c, { type: 'accept', section: 'manpower', suggestion: draft() });
    expect(next.manpower.entries).toEqual([{ trade: 'Mason', count: 6, employer: 'Own staff', notes: '' }]);
    expect(next.manpower.totalOnSite).toBe(10);
    expect(next.weather).toEqual(c.weather); // untouched
    expect(next.reviewedSections).toEqual(['manpower']);
    expect(c.reviewedSections).toEqual([]); // input not mutated
  });

  it('edit stores the edited value and marks it reviewed', () => {
    const next = applyReviewAction(emptyContent(), { type: 'edit', section: 'remarks', value: 'Crane serviced' });
    expect(next.remarks).toBe('Crane serviced');
    expect(next.reviewedSections).toEqual(['remarks']);
  });

  it('mark as not applicable empties the section and marks it reviewed', () => {
    const withData = applyReviewAction(emptyContent(), { type: 'accept', section: 'workCompleted', suggestion: draft() });
    expect(withData.workCompleted).toHaveLength(1);
    const next = applyReviewAction(withData, { type: 'markNotApplicable', section: 'workCompleted' });
    expect(next.workCompleted).toEqual([]);
    expect(next.reviewedSections).toEqual(['workCompleted']);
  });

  it('keeps reviewedSections unique and in canonical section order', () => {
    let c = emptyContent();
    for (const s of ['remarks', 'weather', 'remarks', 'delays'] as SectionKey[]) {
      c = applyReviewAction(c, { type: 'markNotApplicable', section: s });
    }
    expect(c.reviewedSections).toEqual(['weather', 'delays', 'remarks']);
    expect(markReviewed(['remarks'], 'weather')).toEqual(['weather', 'remarks']);
  });

  it('edit drops fields that are not in the schema (no pay fields can be sent)', () => {
    const value = { entries: [{ trade: 'Mason', count: 2, employer: 'X', notes: '', dailyRate: 900 }], totalOnSite: null, notes: '', wage: 5 };
    const next = applyReviewAction(emptyContent(), { type: 'edit', section: 'manpower', value: value as never });
    expect(next.manpower).toEqual({ entries: [{ trade: 'Mason', count: 2, employer: 'X', notes: '' }], totalOnSite: null, notes: '' });
    expect(JSON.stringify(next)).not.toMatch(/rate|wage/i);
  });
});

describe('reviewProgress / canFinalise', () => {
  it('finalise is enabled only when all 9 sections are reviewed', () => {
    let c = emptyContent();
    expect(SECTION_KEYS).toHaveLength(9);
    SECTION_KEYS.forEach((k, i) => {
      expect(canFinalise(reportWith(c))).toBe(false);
      expect(reviewProgress(c).reviewed).toBe(i);
      c = applyReviewAction(c, { type: 'markNotApplicable', section: k });
    });
    expect(reviewProgress(c)).toEqual({ reviewed: 9, total: 9, missing: [], complete: true });
    expect(canFinalise(reportWith(c))).toBe(true);
  });

  it('lists the missing sections', () => {
    const c = applyReviewAction(emptyContent(), { type: 'markNotApplicable', section: 'weather' });
    expect(reviewProgress(c).missing).toEqual(SECTION_KEYS.filter((k) => k !== 'weather'));
  });

  it('is disabled for final reports, readers, busy saves and conflicts', () => {
    const all = { ...emptyContent(), reviewedSections: [...SECTION_KEYS] };
    expect(canFinalise(reportWith(all, { status: 'final' }))).toBe(false);
    expect(canFinalise(reportWith(all, { canEdit: false }))).toBe(false);
    expect(canFinalise(reportWith(all), { busy: true })).toBe(false);
    expect(canFinalise(reportWith(all), { conflict: true })).toBe(false);
    expect(canFinalise(null)).toBe(false);
  });
});

describe('suggestionState', () => {
  it('reports none / empty / same / different', () => {
    const c = emptyContent();
    expect(suggestionState('weather', c, null)).toBe('none');
    expect(suggestionState('delays', c, draft())).toBe('empty');
    expect(suggestionState('weather', c, draft())).toBe('different');
    const accepted = applyReviewAction(c, { type: 'accept', section: 'weather', suggestion: draft() });
    expect(suggestionState('weather', accepted, draft())).toBe('same');
  });
});

describe('notApplicableDiscards / parseMissingSections', () => {
  it('warns only when the section has visible content', () => {
    const c = emptyContent();
    expect(notApplicableDiscards('remarks', c)).toBe(false);
    expect(notApplicableDiscards('remarks', { ...c, remarks: 'x' })).toBe(true);
    expect(notApplicableDiscards('remarks', { ...c, remarks: '   ' })).toBe(false);
  });

  it('keeps only valid keys from a 422 REVIEW_INCOMPLETE body, in order', () => {
    expect(parseMissingSections(['remarks', 'bogus', 'weather', 'remarks'])).toEqual(['weather', 'remarks']);
    expect(parseMissingSections(undefined)).toEqual([]);
    expect(parseMissingSections('weather')).toEqual([]);
  });
});
