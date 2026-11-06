/**
 * "Today" for site workflows (attendance, targets, labour, schedules, ...).
 *
 * The forms and lists used `new Date().toISOString().split('T')[0]`, which is
 * the UTC calendar date: in Kenya (UTC+3) it is still *yesterday* between
 * 00:00 and 03:00, so a supervisor recording attendance just after midnight
 * defaulted to the wrong day, and the site summary showed yesterday's figures.
 *
 * The company time zone is not on the signed-in user (AuthUser has no
 * timezone; it lives on GET /companies/me), so these pages use the browser's
 * local date, which is what a site user on a local device expects.
 * todayInTimeZone() is here for callers that already have the company zone.
 */

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today's date in the browser's local time zone, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Today's date in an IANA time zone, as YYYY-MM-DD. Falls back to the
 * browser-local date when the zone is missing or unknown.
 */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const out = `${get('year')}-${get('month')}-${get('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
    } catch { /* unknown zone → browser-local */ }
  }
  return localToday(now);
}

/** The calendar date of a stored date value ("2026-11-06T00:00:00.000Z" → "2026-11-06"). */
export function dateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : '';
}
