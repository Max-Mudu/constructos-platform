/** Date helpers for daily reports (YYYY-MM-DD report dates). Pure. */

/** Today's date as YYYY-MM-DD in the given IANA time zone (falls back to device time). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const ymd = `${get('year')}-${get('month')}-${get('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    } catch { /* unknown zone → device time */ }
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "Thu 5 Nov 2026" — computed from the calendar date itself, not a time zone. */
export function formatReportDate(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAYS[dow]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** Whole days from a to b (b − a) for YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number | null {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** "Today", "Yesterday" or the formatted date. */
export function relativeReportDate(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatReportDate(ymd);
}

/** "5 Nov 2026, 14:32" in the device's locale/time zone. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

export function personName(p: { firstName: string; lastName: string } | null | undefined): string {
  if (!p) return '';
  return `${p.firstName} ${p.lastName}`.trim();
}
