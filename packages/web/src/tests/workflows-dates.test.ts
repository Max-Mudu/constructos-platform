/**
 * "Today" for site workflows must be the local calendar date, not the UTC
 * one: at 01:30 in Nairobi (UTC+3) toISOString() still says yesterday.
 */
import * as fs from 'fs';
import * as path from 'path';
import { dateOnly, localToday, todayInTimeZone } from '@/lib/workflows-dates';

describe('localToday', () => {
  it('uses the local calendar date (constructed from local fields, so TZ-independent)', () => {
    expect(localToday(new Date(2026, 10, 6, 1, 30))).toBe('2026-11-06');
    expect(localToday(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(localToday(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('defaults to now and is YYYY-MM-DD', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('todayInTimeZone', () => {
  // 22:30 UTC on 5 Nov is 01:30 on 6 Nov in Nairobi.
  const justAfterMidnightInNairobi = new Date('2026-11-05T22:30:00.000Z');

  it('is the Nairobi date while the UTC date is still yesterday (the old bug)', () => {
    expect(justAfterMidnightInNairobi.toISOString().split('T')[0]).toBe('2026-11-05');
    expect(todayInTimeZone('Africa/Nairobi', justAfterMidnightInNairobi)).toBe('2026-11-06');
  });

  it('handles other zones', () => {
    expect(todayInTimeZone('UTC', justAfterMidnightInNairobi)).toBe('2026-11-05');
    expect(todayInTimeZone('America/New_York', new Date('2026-11-06T03:00:00.000Z'))).toBe('2026-11-05');
  });

  it('falls back to the local date for a missing or unknown zone', () => {
    const d = new Date(2026, 10, 6, 12, 0);
    expect(todayInTimeZone(null, d)).toBe(localToday(d));
    expect(todayInTimeZone('Not/AZone', d)).toBe(localToday(d));
  });
});

describe('dateOnly', () => {
  it('takes the calendar date of a stored date value', () => {
    expect(dateOnly('2026-11-06T00:00:00.000Z')).toBe('2026-11-06');
    expect(dateOnly('2026-11-06')).toBe('2026-11-06');
    expect(dateOnly(null)).toBe('');
    expect(dateOnly('garbage')).toBe('');
  });
});

describe('site workflow pages no longer derive "today" from the UTC date', () => {
  const APP = path.resolve(__dirname, '..', 'app', '(app)');
  const DIRS = ['projects', 'consultants', 'drawings', 'contractors', 'attendance', 'labour', 'targets'];
  const UTC_TODAY = /new Date\(\)\.toISOString\(\)\.(split\('T'\)\[0\]|slice\(0,\s*10\)|substring\(0,\s*10\))/;

  function files(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
    });
  }

  it('positive control: the pattern catches the old code', () => {
    expect(UTC_TODAY.test("const t = new Date().toISOString().split('T')[0];")).toBe(true);
    expect(UTC_TODAY.test('date: new Date().toISOString().slice(0, 10),')).toBe(true);
  });

  it.each(DIRS)('%s/** has no UTC "today"', (d) => {
    const offenders = files(path.join(APP, d)).filter((f) => UTC_TODAY.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it('the pages that default to today use localToday()', () => {
    const S = path.join(APP, 'projects', '[projectId]', 'sites', '[siteId]');
    for (const f of [
      path.join(S, 'page.tsx'),
      path.join(S, 'attendance', 'page.tsx'),
      path.join(S, 'attendance', 'new', 'page.tsx'),
      path.join(S, 'targets', 'page.tsx'),
      path.join(S, 'targets', 'new', 'page.tsx'),
      path.join(S, 'labour', 'new', 'page.tsx'),
      path.join(S, 'schedules', 'page.tsx'),
      path.join(S, 'schedules', '[taskId]', 'page.tsx'),
      path.join(S, 'deliveries', 'new', 'page.tsx'),
      path.join(APP, 'consultants', 'instructions', 'new', 'page.tsx'),
    ]) {
      expect(fs.readFileSync(f, 'utf8')).toMatch(/localToday\(\)/);
    }
  });
});
