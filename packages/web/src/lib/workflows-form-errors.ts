/**
 * Turns an API save error into what a form can actually show.
 *
 * The API answers invalid input with 422 `{ error: 'Validation failed',
 * details: { field: [message, ...] } }`. Forms render inline errors for only
 * some fields; a detail for any other field (notes over 2000 characters, a
 * zero quantity, a null enum, ...) used to vanish, so the save button simply
 * re-enabled with no message. Every detail a form does not render inline is
 * now listed in the banner message.
 */
import { ApiError } from './api';

export interface FormErrorState {
  /** Per-field messages, for the fields the form renders inline. */
  fieldErrors: Record<string, string[]>;
  /** Banner text; empty when every problem is shown next to its field. */
  message: string;
}

/** "quantityOrdered" → "Quantity ordered", "emergency_contact" → "Emergency contact". */
export function humanizeField(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return 'Form';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Same list as the New Worker, New Budget and New Invoice forms. */
export const WAGE_CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS'] as const;

/**
 * Options for a worker's wage currency. The edit form used to offer only
 * KES/USD/EUR/GBP, so a ZAR/AED/NGN/GHS worker's form displayed "KES" and the
 * real currency could not be re-selected. A stored code outside the list is
 * kept as an option so it is shown truthfully.
 */
export function currencyOptions(current: string | null | undefined): string[] {
  const list: string[] = [...WAGE_CURRENCIES];
  if (current && /^[A-Z]{3}$/.test(current) && !list.includes(current)) list.unshift(current);
  return list;
}

export function formErrorState(
  err: unknown,
  inlineFields: readonly string[],
  fallback: string,
  labels: Readonly<Record<string, string>> = {},
): FormErrorState {
  if (!(err instanceof ApiError)) return { fieldErrors: {}, message: fallback };

  const details = err.details ?? {};
  const entries = Object.entries(details).filter(
    ([, msgs]) => Array.isArray(msgs) && msgs.length > 0,
  );
  if (entries.length === 0) {
    return { fieldErrors: {}, message: err.message || fallback };
  }

  const inline = new Set(inlineFields);
  const fieldErrors: Record<string, string[]> = {};
  const hidden: string[] = [];
  for (const [key, msgs] of entries) {
    if (inline.has(key)) fieldErrors[key] = msgs;
    else hidden.push(`${labels[key] ?? humanizeField(key)}: ${msgs[0]}`);
  }

  const message = hidden.length === 0
    ? ''
    : `Please fix the following — ${hidden.join('; ')}`;
  return { fieldErrors, message };
}
