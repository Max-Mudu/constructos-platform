import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The app renders money in one locale; only the *currency* varies, per company.
// Intl derives the symbol, its placement and the default fraction digits from the
// currency code, so no symbol is ever written by hand here or at any call site.
const MONEY_LOCALE = 'en-US';

/**
 * Formats a monetary value in an explicit currency.
 *
 * `currency` is required on purpose: the company's configured currency is the
 * source of truth, so omitting it is a compile error rather than a silent
 * fallback to USD. Pass any Intl option to vary presentation — for example
 * `{ notation: 'compact' }` for "KES 2.5M", or `{ maximumFractionDigits: 0 }`.
 *
 * `style` and `currency` are applied after the caller's options so they cannot
 * be overridden by accident.
 */
export function formatMoney(
  value: number,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    ...options,
    style: 'currency',
    currency,
  }).format(value);
}
