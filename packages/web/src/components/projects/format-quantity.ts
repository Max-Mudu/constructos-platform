/**
 * Display a stored quantity. Prisma Decimal columns arrive as strings
 * ("12.500"), so `q.toLocaleString()` printed the raw string without
 * grouping; numbers are formatted with grouping and up to 3 decimals.
 * A non-numeric value is shown as-is rather than as "NaN".
 */
export function formatQuantity(q: string | number | null | undefined): string {
  if (q === null || q === undefined || q === '') return '—';
  const n = typeof q === 'number' ? q : Number(q);
  if (!Number.isFinite(n)) return String(q);
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
