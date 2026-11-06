import type { DailyReportDraftV1 } from '../content.schema';
import type { UnsupportedNumber } from './types';

/**
 * Provenance check for AI drafts: every number in the draft must appear in
 * the supervisor's notes. Numbers that do not are returned so the UI can mark
 * them "Not found in your notes, check". It never blocks finalising.
 *
 * What counts as "present" in the notes:
 *  - every run of ASCII digits, with an optional decimal part: "27", "2.5",
 *    "08" (= 8). Digits embedded in other text count too, so "43m³" gives 43,
 *    "C30" gives 30, "Y12" gives 12 and "2nd" gives 2. A grade such as C30 is
 *    therefore never reported as a mismatch if the model puts 30 somewhere:
 *    the check is "this number was written by the supervisor", not "this
 *    number was used in the right place". Superscripts (³, ²) are not digits.
 *  - thousands-grouped numbers: "1,200" and "12,500.5" give 1200 and 12500.5.
 *  - English number words: zero to twenty, thirty to ninety, "hundred" (100),
 *    "dozen" (12), hyphenated or spaced compounds ("twenty-five", "twenty
 *    five" → 25), and a small multiplier before hundred / dozen ("two hundred"
 *    → 200, "a dozen" → 12, "two dozen" → 24).
 *  - common Swahili numerals: moja … kumi, ishirini … tisini, mia (100), and
 *    "kumi na <unit>" (11–19).
 *
 * Comparison is numeric (2.50 equals 2.5) and sign-insensitive, so "-2°C"
 * supports a temperatureC of -2.
 *
 * Durations: an hours field (hoursLost) is also supported by a duration the
 * notes state in other words. "an hour", "another hour", "one hour", "1 h"
 * and "60 minutes" all support 1; "45 min" / "forty-five minutes" support
 * 0.75; "half an hour" supports 0.5. These equivalences apply ONLY to
 * hoursLost: "60 minutes" never supports a quantity of 1 anywhere else.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MULTIPLIERS: Record<string, number> = { hundred: 100, dozen: 12 };

const SW_ONES: Record<string, number> = {
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
};
const SW_TENS: Record<string, number> = {
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70, themanini: 80, tisini: 90,
};
const SW_HUNDRED: Record<string, number> = { mia: 100 };

/** Grouped thousands first, then plain digit runs with an optional decimal part. */
const DIGIT_NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function digitNumbers(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(DIGIT_NUMBER)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function wordValue(word: string): number | undefined {
  return ONES[word] ?? TENS[word] ?? MULTIPLIERS[word] ?? SW_ONES[word] ?? SW_TENS[word] ?? SW_HUNDRED[word];
}

function wordNumbers(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '');
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    const value = wordValue(word);
    if (value !== undefined) out.push(value);

    // "twenty five" / "twenty-five" → 25
    if (TENS[word] !== undefined && next !== undefined && ONES[next] !== undefined && ONES[next]! < 10 && ONES[next]! > 0) {
      out.push(TENS[word]! + ONES[next]!);
    }
    // "a dozen", "two hundred", "three dozen"
    if (next !== undefined && MULTIPLIERS[next] !== undefined) {
      const factor = word === 'a' || word === 'one' ? 1 : (ONES[word] ?? TENS[word]);
      if (factor !== undefined && factor > 0) out.push(factor * MULTIPLIERS[next]!);
    }
    // "kumi na mbili" → 12, "ishirini na tano" → 25
    if ((word === 'kumi' || SW_TENS[word] !== undefined) && next === 'na') {
      const unit = words[i + 2];
      if (unit !== undefined && SW_ONES[unit] !== undefined && SW_ONES[unit]! < 10) {
        out.push((SW_ONES[word] ?? SW_TENS[word]!) + SW_ONES[unit]!);
      }
    }
    // "mia mbili" → 200
    if (word === 'mia' && next !== undefined && SW_ONES[next] !== undefined && SW_ONES[next]! < 10) {
      out.push(100 * SW_ONES[next]!);
    }
  }
  return out;
}

/** Every number the notes support, by the rules above. */
export function numbersInText(text: string): Set<number> {
  const set = new Set<number>();
  for (const n of [...digitNumbers(text), ...wordNumbers(text)]) set.add(Math.abs(n));
  return set;
}

const HOUR_UNITS = new Set(['hour', 'hours', 'hr', 'hrs', 'h']);
const MINUTE_UNITS = new Set(['minute', 'minutes', 'min', 'mins']);
const DIGIT_DURATION = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/gi;

/**
 * A number phrase starting at words[i]: "forty five" → 45, "2" → 2,
 * "half an" → 0.5, "another" → 1 (article: only before the word "hour").
 */
function numberPhraseAt(words: string[], i: number): { value: number; length: number; article: boolean } | null {
  const word = words[i]!;
  const next = words[i + 1];
  if (/^\d/.test(word)) return { value: Number(word), length: 1, article: false };
  if (TENS[word] !== undefined && next !== undefined && ONES[next] !== undefined && ONES[next]! > 0 && ONES[next]! < 10) {
    return { value: TENS[word]! + ONES[next]!, length: 2, article: false };
  }
  if (ONES[word] !== undefined) return { value: ONES[word]!, length: 1, article: false };
  if (TENS[word] !== undefined) return { value: TENS[word]!, length: 1, article: false };
  if (word === 'half') {
    // the "half" of "two and a half hours" belongs to the number before it
    if (words[i - 1] === 'a' && words[i - 2] === 'and') return null;
    return { value: 0.5, length: next === 'an' || next === 'a' ? 2 : 1, article: false };
  }
  // "an hour", "another hour" — but not the "an" of "half an hour"
  if ((word === 'a' || word === 'an' || word === 'another') && words[i - 1] !== 'half') return { value: 1, length: 1, article: true };
  return null;
}

/** Minute phrases ("45 minutes", "forty-five mins"), removed before reading plain numbers for hoursLost. */
const NUMBER_WORD = `(?:${[...Object.keys(TENS), ...Object.keys(ONES)].join('|')})`;
const MINUTE_PHRASE = new RegExp(`(?:\\d+(?:\\.\\d+)?|${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})?)\\s*(?:minutes?|mins?)\\b`, 'gi');

/** Durations stated in the notes, in hours (for hoursLost only; see the header). */
export function durationHoursInText(text: string): Set<number> {
  const hours = new Set<number>();
  for (const m of text.matchAll(DIGIT_DURATION)) {
    const n = Number(m[1]);
    hours.add(MINUTE_UNITS.has(m[2]!.toLowerCase()) ? n / 60 : n);
  }
  // Digit runs stay as tokens so "another 2 hours" is not read as "another hours".
  const words = text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const phrase = numberPhraseAt(words, i);
    if (!phrase) continue;
    let at = i + phrase.length;
    let value = phrase.value;
    // "two and a half hours" → 2.5 (the "and a half" comes before the unit)
    if (words.slice(at, at + 3).join(' ') === 'and a half') { value += 0.5; at += 3; }
    const unit = words[at];
    if (unit === undefined) continue;
    // Words use only spelled-out units; a bare "h" after a letter ("grid A-H") is not "an hour".
    // The article form ("an hour", "another hour") needs the word "hour" itself.
    const wordUnitOk = /^\d/.test(words[i]!) || unit.length > 1;
    if (HOUR_UNITS.has(unit) && wordUnitOk && (!phrase.article || unit === 'hour')) {
      hours.add(value);
      // "an hour and a half" → 1.5
      if (words.slice(at + 1, at + 4).join(' ') === 'and a half') hours.add(value + 0.5);
    } else if (MINUTE_UNITS.has(unit) && !phrase.article) {
      hours.add(value / 60);
    }
  }
  return hours;
}

const HOURS_FIELD = /(^|\.)hoursLost$/;

/** Every finite number in the draft with its JSON path, e.g. "workCompleted[0].quantity". */
export function numbersInDraft(value: unknown, path = ''): UnsupportedNumber[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [{ path, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => numbersInDraft(item, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      numbersInDraft(child, path === '' ? key : `${path}.${key}`));
  }
  return [];
}

const EPSILON = 1e-9;

function isSupported(value: number, supported: Set<number>): boolean {
  const target = Math.abs(value);
  if (supported.has(target)) return true;
  for (const n of supported) if (Math.abs(n - target) < EPSILON) return true;
  return false;
}

/** Numbers in the draft that do not appear in rawInput, in draft order. */
export function findUnsupportedNumbers(draft: DailyReportDraftV1, rawInput: string): UnsupportedNumber[] {
  const text = rawInput ?? '';
  const supported = numbersInText(text);
  const durations = durationHoursInText(text);
  // For hoursLost a minute count is not an hour count: "45 minutes" never supports hoursLost 45.
  const supportedForHours = numbersInText(text.replace(MINUTE_PHRASE, ' '));
  return numbersInDraft(draft).filter((n) => (HOURS_FIELD.test(n.path)
    ? !isSupported(n.value, supportedForHours) && !isSupported(n.value, durations)
    : !isSupported(n.value, supported)));
}
