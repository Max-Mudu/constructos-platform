/**
 * Text helpers for the Daily Site Report PDF: glyph-safe sanitising,
 * deterministic date/number formatting and human labels for enum values.
 * Nothing here depends on the host locale or ICU month names, so the same
 * input renders the same text on every machine.
 */

/** Anything that can answer "does the embedded font have a glyph for this?". */
export interface GlyphCoverage {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

const REPLACEMENT = 0xfffd;
const COMBINING_MARK = /\p{M}/u;

/**
 * Normalises free text so it can be drawn with the embedded font:
 * - CRLF/CR → LF, tabs → space, other control characters removed;
 * - NFC normalisation;
 * - a character the font lacks is decomposed (NFD). If the font has every part
 *   (e.g. "ũ" → "u" + U+0303), the decomposed form is used, so the diacritic is
 *   still drawn via mark positioning. Otherwise unsupported combining marks are
 *   dropped and the base letter kept; anything still missing becomes U+FFFD.
 */
export function sanitizeForFont(input: string, fonts: readonly GlyphCoverage[]): string {
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .normalize('NFC');
  const has = (cp: number) => fonts.every((f) => f.hasGlyphForCodePoint(cp));
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '\n' || has(cp)) { out += ch; continue; }
    const parts = Array.from(ch.normalize('NFD'));
    if (parts.length > 1 && parts.every((p) => has(p.codePointAt(0) as number))) {
      out += parts.join('');
      continue;
    }
    const base = parts.filter((p) => !COMBINING_MARK.test(p) && has(p.codePointAt(0) as number));
    if (base.length > 0 && base.length === parts.filter((p) => !COMBINING_MARK.test(p)).length) {
      out += base.join('');
      continue;
    }
    if (COMBINING_MARK.test(ch)) continue; // stray unsupported mark: drop it
    out += has(REPLACEMENT) ? String.fromCodePoint(REPLACEMENT) : '?';
  }
  return out;
}

/** Collapses whitespace for single-line contexts (headers, table labels). */
export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns the IANA zone if Intl accepts it, else 'UTC'. */
export function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(0);
    return tz;
  } catch {
    return 'UTC';
  }
}

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    year, month, day,
    hour: get('hour') % 24,
    minute: get('minute'),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "5 Nov 2026 14:02" in the given zone (24 h clock). */
export function formatDateTime(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) return '—';
  const p = zonedParts(date, timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * The report date is a calendar date that already belongs to the report's
 * timezone ("2026-11-05"), so it is formatted without any zone shift:
 * "Thu 5 Nov 2026". A full ISO timestamp is converted into the zone first.
 * Anything unparseable is printed as given.
 */
export function formatReportDate(reportDate: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate.trim());
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d) {
      return `${WEEKDAYS[check.getUTCDay()]} ${d} ${MONTHS[mo - 1]} ${y}`;
    }
  }
  const parsed = new Date(reportDate);
  if (reportDate.trim() !== '' && !Number.isNaN(parsed.getTime())) {
    const p = zonedParts(parsed, timeZone);
    return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
  }
  return reportDate.trim() || '—';
}

/** 43 → "43", 1250 → "1,250", 0.755 → "0.755", 2.50 → "2.5". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const fixed = n.toFixed(3).replace(/\.?0+$/, '');
  const [int, frac] = fixed.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Quantity + unit as entered: "43 m³", "120" (no unit), "" when no quantity. */
export function formatQuantity(quantity: number | null, unit: string): string {
  if (quantity === null || quantity === undefined) return '';
  const u = oneLine(unit);
  return u ? `${formatNumber(quantity)} ${u}` : formatNumber(quantity);
}

export const yesNo = (v: boolean | null): string => (v === null || v === undefined ? 'Not stated' : v ? 'Yes' : 'No');

/** Fallback label for an enum value that has no entry: "some_value" → "Some value". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export const WEATHER_LABELS: Record<string, string> = {
  sunny: 'Sunny',
  cloudy: 'Cloudy',
  light_rain: 'Light rain',
  heavy_rain: 'Heavy rain',
  windy: 'Windy',
  storm: 'Storm',
  hot: 'Hot',
  cold: 'Cold',
  other: 'Other',
};

export const DELAY_CAUSE_LABELS: Record<string, string> = {
  weather: 'Weather',
  late_materials: 'Late materials',
  equipment_breakdown: 'Equipment breakdown',
  labour_shortage: 'Labour shortage',
  awaiting_information: 'Awaiting information',
  client_or_consultant_instruction: 'Client / consultant instruction',
  inspection_or_authority: 'Inspection / authority',
  utilities: 'Utilities',
  site_access: 'Site access',
  safety_stoppage: 'Safety stoppage',
  subcontractor: 'Subcontractor',
  other: 'Other',
};

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  near_miss: 'Near miss',
  first_aid: 'First aid',
  lost_time: 'Lost-time injury',
  property_damage: 'Property damage',
  environmental: 'Environmental',
  other: 'Other',
};

export const label = (map: Record<string, string>, value: string): string =>
  Object.prototype.hasOwnProperty.call(map, value) ? map[value] : humanize(value);
