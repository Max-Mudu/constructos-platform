/**
 * Mapping of aiDraft.unsupportedNumbers (numbers the AI produced that do not
 * appear in the supervisor's notes) onto sections and fields, so the UI can
 * show an amber "Not found in your notes — check" chip next to each one.
 */
import { SECTION_KEYS, type SectionKey, type UnsupportedNumber } from '@/lib/daily-report-types';

export const UNSUPPORTED_CHIP_LABEL = 'Not found in your notes — check';

export type PathToken = string | number;

/** "workCompleted[0].quantity" → ['workCompleted', 0, 'quantity']. Returns null when malformed. */
export function parsePath(path: string): PathToken[] | null {
  if (typeof path !== 'string' || path.trim() === '') return null;
  const tokens: PathToken[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|(\.)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m.index !== pos) return null;
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }
  if (pos !== path.length || tokens.length === 0 || typeof tokens[0] !== 'string') return null;
  return tokens;
}

/** Canonical form: "workCompleted.0.quantity". */
export function normalizePath(path: string): string | null {
  const t = parsePath(path);
  return t ? t.join('.') : null;
}

export function sectionOfPath(path: string): SectionKey | null {
  const t = parsePath(path);
  if (!t) return null;
  const head = t[0] as string;
  return (SECTION_KEYS as readonly string[]).includes(head) ? (head as SectionKey) : null;
}

/** Reads a value at a parsed path from a JSON-shaped object. */
export function getAtPath(obj: unknown, path: string): unknown {
  const t = parsePath(path);
  if (!t) return undefined;
  let cur: unknown = obj;
  for (const k of t) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

export interface FlaggedNumber {
  section: SectionKey;
  /** Canonical dotted path, e.g. "workCompleted.0.quantity". */
  key: string;
  path: string;
  value: number;
}

/** Groups unsupported numbers by section, dropping malformed or unknown paths. */
export function groupUnsupportedBySection(list: readonly UnsupportedNumber[] | null | undefined): Record<SectionKey, FlaggedNumber[]> {
  const out = Object.fromEntries(SECTION_KEYS.map((k) => [k, [] as FlaggedNumber[]])) as Record<SectionKey, FlaggedNumber[]>;
  for (const u of list ?? []) {
    if (!u || typeof u.value !== 'number') continue;
    const section = sectionOfPath(u.path);
    const key = normalizePath(u.path);
    if (!section || !key) continue;
    if (out[section].some((f) => f.key === key)) continue;
    out[section].push({ section, key, path: u.path, value: u.value });
  }
  return out;
}

/**
 * Which flagged numbers are still present in a given section object (the AI
 * suggestion, or the current content after the user accepted it). A number
 * the user has since changed is no longer flagged.
 */
export function flaggedKeysIn(
  sections: unknown,
  list: readonly UnsupportedNumber[] | null | undefined,
  section?: SectionKey,
): Set<string> {
  const keys = new Set<string>();
  const grouped = groupUnsupportedBySection(list);
  for (const k of section ? [section] : SECTION_KEYS) {
    for (const f of grouped[k]) {
      if (getAtPath(sections, f.path) === f.value) keys.add(f.key);
    }
  }
  return keys;
}

/** Builds the canonical key an editor field uses to look up its flag. */
export function fieldKey(...tokens: PathToken[]): string {
  return tokens.join('.');
}
