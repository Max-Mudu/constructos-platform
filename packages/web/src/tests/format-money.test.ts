import { formatMoney } from '@/lib/utils';

// Intl separates a currency *code* from the number with a non-breaking space
// (U+00A0) — correct typography, awkward to read in an assertion. Normalise it
// so the expected strings below stay legible.
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

describe('formatMoney', () => {
  it('formats KES using its ISO code', () => {
    expect(norm(formatMoney(1500, 'KES'))).toBe('KES 1,500.00');
  });

  it('formats USD using its symbol', () => {
    expect(norm(formatMoney(1500, 'USD'))).toBe('$1,500.00');
  });

  it('formats GBP using its symbol', () => {
    expect(norm(formatMoney(1500, 'GBP'))).toBe('£1,500.00');
  });

  it('formats zero in the given currency', () => {
    expect(norm(formatMoney(0, 'KES'))).toBe('KES 0.00');
    expect(norm(formatMoney(0, 'USD'))).toBe('$0.00');
  });

  it('produces compact output through Intl, not hand-built K/M strings', () => {
    expect(norm(formatMoney(2_500_000, 'KES', { notation: 'compact' }))).toBe('KES 2.5M');
    expect(norm(formatMoney(2_500_000, 'GBP', { notation: 'compact' }))).toBe('£2.5M');
  });

  // Guards the original dashboard bug: a literal "$" in the compact branch meant
  // every value over 1,000 rendered as dollars regardless of the currency.
  it('never emits a dollar sign for a non-USD currency, compact included', () => {
    expect(formatMoney(1500, 'KES')).not.toContain('$');
    expect(formatMoney(2_500_000, 'KES', { notation: 'compact' })).not.toContain('$');
    expect(formatMoney(2_500_000, 'GBP', { notation: 'compact' })).not.toContain('$');
  });

  it('passes caller options through to Intl', () => {
    expect(norm(formatMoney(1500, 'KES', { maximumFractionDigits: 0 }))).toBe('KES 1,500');
  });

  it('does not let options override the requested currency', () => {
    expect(norm(formatMoney(1500, 'KES', { currency: 'USD' }))).toBe('KES 1,500.00');
  });
});
