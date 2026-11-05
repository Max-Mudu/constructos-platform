import { emptyContent } from '@/components/daily/content';
import { applyReviewAction } from '@/components/daily/review-state';
import {
  UNSUPPORTED_CHIP_LABEL, fieldKey, flaggedKeysIn, getAtPath, groupUnsupportedBySection, normalizePath, parsePath, sectionOfPath,
} from '@/components/daily/unsupported-numbers';
import type { DailyReportDraftV1, UnsupportedNumber } from '@/lib/daily-report-types';

const draft = (): DailyReportDraftV1 => {
  const { reviewedSections: _r, ...s } = emptyContent();
  void _r;
  return {
    ...s,
    weather: { conditions: [], temperatureC: 31, workStoppedByWeather: null, notes: '' },
    manpower: {
      entries: [{ trade: 'Mason', count: 6, employer: '', notes: '' }, { trade: 'Helper', count: 4, employer: '', notes: '' }],
      totalOnSite: 12, notes: '',
    },
    workCompleted: [{ description: 'Slab', location: '', quantity: 40, unit: 'm³', progressPercent: 75 }],
  };
};

const unsupported: UnsupportedNumber[] = [
  { path: 'workCompleted[0].quantity', value: 40 },
  { path: 'manpower.entries[1].count', value: 4 },
  { path: 'manpower.totalOnSite', value: 12 },
  { path: 'weather.temperatureC', value: 31 },
  { path: 'not a path!', value: 1 },
  { path: 'pay[0].rate', value: 900 }, // unknown section is ignored
];

describe('path parsing', () => {
  it('parses dotted / indexed paths', () => {
    expect(parsePath('workCompleted[0].quantity')).toEqual(['workCompleted', 0, 'quantity']);
    expect(parsePath('manpower.entries[12].count')).toEqual(['manpower', 'entries', 12, 'count']);
    expect(normalizePath('manpower.entries[1].count')).toBe('manpower.entries.1.count');
    expect(parsePath('[0].x')).toBeNull();
    expect(parsePath('a..b ')).toBeNull();
    expect(parsePath('')).toBeNull();
  });

  it('maps to sections and reads values', () => {
    expect(sectionOfPath('delays[2].hoursLost')).toBe('delays');
    expect(sectionOfPath('nope.x')).toBeNull();
    expect(getAtPath(draft(), 'manpower.entries[1].count')).toBe(4);
    expect(getAtPath(draft(), 'manpower.entries[9].count')).toBeUndefined();
  });
});

describe('unsupported-number chip mapping', () => {
  it('groups by section and drops malformed / unknown paths', () => {
    const g = groupUnsupportedBySection(unsupported);
    expect(g.workCompleted.map((f) => f.key)).toEqual(['workCompleted.0.quantity']);
    expect(g.manpower.map((f) => f.key)).toEqual(['manpower.entries.1.count', 'manpower.totalOnSite']);
    expect(g.weather.map((f) => f.key)).toEqual(['weather.temperatureC']);
    expect(g.delays).toEqual([]);
    const total = Object.values(g).reduce((n, l) => n + l.length, 0);
    expect(total).toBe(4);
    expect(groupUnsupportedBySection(null).remarks).toEqual([]);
  });

  it('flags the AI suggestion fields with the keys the editors and views use', () => {
    const keys = flaggedKeysIn(draft(), unsupported, 'manpower');
    expect(keys.has(fieldKey('manpower', 'entries', 1, 'count'))).toBe(true);
    expect(keys.has(fieldKey('manpower', 'totalOnSite'))).toBe(true);
    expect(keys.has(fieldKey('manpower', 'entries', 0, 'count'))).toBe(false);
    expect(keys.has(fieldKey('workCompleted', 0, 'quantity'))).toBe(false); // other section
  });

  it('keeps the chip after Accept, and drops it once the user changes the number', () => {
    const accepted = applyReviewAction(emptyContent(), { type: 'accept', section: 'workCompleted', suggestion: draft() });
    expect(flaggedKeysIn(accepted, unsupported, 'workCompleted').has('workCompleted.0.quantity')).toBe(true);
    const fixed = applyReviewAction(accepted, {
      type: 'edit', section: 'workCompleted',
      value: [{ ...accepted.workCompleted[0], quantity: 38 }],
    });
    expect(flaggedKeysIn(fixed, unsupported, 'workCompleted').size).toBe(0);
  });

  it('has the agreed chip label', () => {
    expect(UNSUPPORTED_CHIP_LABEL).toBe('Not found in your notes — check');
  });
});
