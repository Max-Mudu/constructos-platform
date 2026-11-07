import { SECTION_KEYS } from '@/lib/daily-report-types';
import { deepEqual, emptyContent, parseNumberInput, sanitizeContent, sectionIsEmpty } from '@/components/daily/content';
import { daysBetween, formatReportDate, relativeReportDate, todayIn } from '@/components/daily/dates';
import { clearNotesBackup, readNotesBackup, writeNotesBackup } from '@/components/daily/notes-backup';
import { useAuthStore } from '@/store/auth.store';
import type { AuthUser } from '@/lib/types';
import { guardScreen, reportHref, screenOf } from '@/components/daily/paths';
import { resolveStale } from '@/components/daily/save-conflict';
import { pickDefaultId } from '@/components/daily/site-select';
import { todayCardModel } from '@/components/daily/today';
import { nextQueued, photoSlotsLeft, uploadReducer, type UploadItem } from '@/components/daily/upload-queue';

describe('content sanitising', () => {
  it('fills every section with defaults', () => {
    const c = sanitizeContent({});
    expect(Object.keys(c).sort()).toEqual([...SECTION_KEYS, 'reviewedSections'].sort());
    expect(c).toEqual(emptyContent());
    for (const k of SECTION_KEYS) expect(sectionIsEmpty(k, c[k])).toBe(true);
  });

  it('drops unknown (money-shaped) keys at every level and invalid enums', () => {
    const c = sanitizeContent({
      cost: 1, totalWages: 2,
      manpower: { entries: [{ trade: 'Mason', count: 3, employer: 'Own', notes: '', rate: 800, wage: 900 }], totalOnSite: 3, notes: '', payroll: 1 },
      materialsDeliveries: [{ material: 'Cement', quantity: 200, unit: 'bags', supplier: 'Bamburi', notes: '', price: 750, amount: 150000 }],
      weather: { conditions: ['sunny', 'tornado', 'sunny'], temperatureC: '30', workStoppedByWeather: 'no', notes: 5 },
      delays: [{ cause: 'aliens', description: 'x', hoursLost: -1, responsibleParty: '' }],
      reviewedSections: ['weather', 'bogus', 'weather'],
    });
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/rate|wage|price|amount|cost|payroll/i);
    expect(c.manpower.entries[0]).toEqual({ trade: 'Mason', count: 3, employer: 'Own', notes: '' });
    expect(c.weather).toEqual({ conditions: ['sunny'], temperatureC: null, workStoppedByWeather: null, notes: '' });
    expect(c.delays[0].cause).toBe('other');
    expect(c.reviewedSections).toEqual(['weather']);
  });

  it('parses number inputs', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('12,5')).toBe(12.5);
    expect(parseNumberInput('-3')).toBeNull();
    expect(parseNumberInput('-3', { allowNegative: true })).toBe(-3);
    expect(parseNumberInput('4.6', { integer: true })).toBeNull(); // never rounded
    expect(parseNumberInput('5', { integer: true })).toBe(5);
    expect(parseNumberInput('101', { max: 100 })).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
  });

  it('deepEqual compares JSON shapes', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('409 STALE resolution', () => {
  it('retries when the field is unchanged on the server (e.g. a photo bumped updatedAt)', () => {
    expect(resolveStale({ base: 'a', server: 'a', mine: 'ab' })).toBe('retry');
  });
  it('does nothing when the server already has my value', () => {
    expect(resolveStale({ base: 'a', server: 'ab', mine: 'ab' })).toBe('noop');
  });
  it('reports a conflict when someone else changed the same field', () => {
    expect(resolveStale({ base: 'a', server: 'a-theirs', mine: 'a-mine' })).toBe('conflict');
  });
});

describe('notes backup', () => {
  const signIn = (id: string) => useAuthStore.setState({ user: { id } as AuthUser });
  beforeEach(() => { localStorage.clear(); signIn('u1'); });
  it('is per user: another account on the same phone never sees it', () => {
    writeNotesBackup('r3', 'private notes', 'base');
    signIn('u2');
    expect(readNotesBackup('r3')).toBeNull();
    signIn('u1');
    expect(readNotesBackup('r3')).toMatchObject({ text: 'private notes' });
  });
  it('is wiped on logout and session expiry', () => {
    writeNotesBackup('r4', 'unsaved', 'base');
    useAuthStore.getState().clearAuth();
    signIn('u1');
    expect(readNotesBackup('r4')).toBeNull();
    writeNotesBackup('r5', 'unsaved', 'base');
    useAuthStore.getState().expireSession();
    signIn('u1');
    expect(readNotesBackup('r5')).toBeNull();
  });
  it('does nothing without a signed-in user', () => {
    useAuthStore.setState({ user: null });
    writeNotesBackup('r6', 'x', 'base');
    expect(localStorage.length).toBe(0);
  });
  it('round-trips and clears', () => {
    writeNotesBackup('r1', 'typed', 'base');
    expect(readNotesBackup('r1')).toMatchObject({ text: 'typed', base: 'base' });
    clearNotesBackup('r1');
    expect(readNotesBackup('r1')).toBeNull();
  });
  it('expires old backups', () => {
    writeNotesBackup('r2', 'typed', 'base');
    expect(readNotesBackup('r2', Date.now() + 15 * 24 * 3600 * 1000)).toBeNull();
  });
});

describe('photo upload queue', () => {
  const f = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
  it('processes one at a time, supports retry and dismiss', () => {
    let s: UploadItem[] = [];
    s = uploadReducer(s, { type: 'add', items: [{ id: 'a', file: f('a.jpg') }, { id: 'b', file: f('b.jpg') }] });
    expect(nextQueued(s)?.id).toBe('a');
    s = uploadReducer(s, { type: 'start', id: 'a' });
    expect(nextQueued(s)).toBeNull(); // one in flight
    s = uploadReducer(s, { type: 'resized', id: 'a' });
    s = uploadReducer(s, { type: 'progress', id: 'a', progress: 0.5 });
    s = uploadReducer(s, { type: 'progress', id: 'a', progress: 0.2 }); // never goes backwards
    expect(s[0].progress).toBe(0.5);
    s = uploadReducer(s, { type: 'fail', id: 'a', error: 'offline', retryable: true });
    expect(nextQueued(s)?.id).toBe('b');
    s = uploadReducer(s, { type: 'retry', id: 'a' });
    expect(s.find((i) => i.id === 'a')?.status).toBe('queued');
    s = uploadReducer(s, { type: 'fail', id: 'a', error: 'bad file', retryable: false });
    s = uploadReducer(s, { type: 'retry', id: 'a' });
    expect(s.find((i) => i.id === 'a')?.status).toBe('failed'); // not retryable
    s = uploadReducer(s, { type: 'dismiss', id: 'a' });
    s = uploadReducer(s, { type: 'start', id: 'b' });
    s = uploadReducer(s, { type: 'done', id: 'b' });
    expect(s).toEqual([]);
  });
  it('respects the 30-photo limit', () => {
    expect(photoSlotsLeft(28, 1)).toBe(1);
    expect(photoSlotsLeft(30, 0)).toBe(0);
    expect(photoSlotsLeft(29, 5)).toBe(0);
  });
});

describe('dates', () => {
  const now = new Date('2026-11-05T22:30:00Z'); // 01:30 on 6 Nov in Nairobi
  it('computes today in the company time zone', () => {
    expect(todayIn('Africa/Nairobi', now)).toBe('2026-11-06');
    expect(todayIn('UTC', now)).toBe('2026-11-05');
    expect(todayIn('Not/AZone', now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('formats report dates', () => {
    expect(formatReportDate('2026-11-05')).toBe('Thu 5 Nov 2026');
    expect(relativeReportDate('2026-11-05', '2026-11-05')).toBe('Today');
    expect(relativeReportDate('2026-11-04', '2026-11-05')).toBe('Yesterday');
    expect(relativeReportDate('2026-10-31', '2026-11-05')).toBe('Sat 31 Oct 2026');
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe("today's report card", () => {
  const summary = (over = {}) => ({
    id: 'r1', reportDate: '2026-11-05', reportNumber: 7, displayNumber: 'DR-0007', status: 'draft' as const,
    revision: 0, photoCount: 3, preparedBy: { id: 'u', firstName: 'A', lastName: 'B' }, finalisedAt: null, updatedAt: '', ...over,
  });
  it('not started: editors create, readers see no CTA', () => {
    expect(todayCardModel(null, true)).toMatchObject({ status: 'not_started', action: 'create' });
    expect(todayCardModel(null, false)).toMatchObject({ status: 'not_started', action: null, ctaLabel: null });
  });
  it('draft: editors continue, readers view', () => {
    expect(todayCardModel(summary(), true)).toMatchObject({ status: 'draft', action: 'continue' });
    expect(todayCardModel(summary(), false)).toMatchObject({ status: 'draft', action: 'view' });
    expect(todayCardModel(summary({ revision: 2 }), true).headline).toMatch(/Rev 2/);
  });
  it('final: everyone views', () => {
    expect(todayCardModel(summary({ status: 'final' }), true)).toMatchObject({ status: 'final', action: 'view' });
  });
});

describe('screen guards and links', () => {
  it('sends finals and readers to the read-only share screen', () => {
    expect(guardScreen('capture', { status: 'final', canEdit: true })).toBe('share');
    expect(guardScreen('review', { status: 'draft', canEdit: false })).toBe('share');
    expect(guardScreen('capture', { status: 'draft', canEdit: true })).toBeNull();
    expect(guardScreen('share', { status: 'draft', canEdit: false })).toBeNull();
  });
  it('detects the screen from the path', () => {
    expect(screenOf('/daily/p/s/r')).toBe('capture');
    expect(screenOf('/daily/p/s/r/review')).toBe('review');
    expect(screenOf('/daily/p/s/r/share')).toBe('share');
  });
  it('history rows open the right screen', () => {
    expect(reportHref('p', 's', { id: 'r', status: 'draft' }, true)).toBe('/daily/p/s/r');
    expect(reportHref('p', 's', { id: 'r', status: 'draft' }, false)).toBe('/daily/p/s/r/share');
    expect(reportHref('p', 's', { id: 'r', status: 'final' }, true)).toBe('/daily/p/s/r/share');
  });
});

describe('site picker defaults', () => {
  const opts = [{ id: 'a' }, { id: 'b' }];
  it('prefers the user default, then last used, else auto-selects a single option', () => {
    expect(pickDefaultId(opts, ['b', 'a'])).toBe('b');
    expect(pickDefaultId(opts, ['zzz', 'a'])).toBe('a');
    expect(pickDefaultId(opts, [null, undefined])).toBeNull();
    expect(pickDefaultId([{ id: 'only' }], [null])).toBe('only');
    expect(pickDefaultId([], ['a'])).toBeNull();
  });
});
