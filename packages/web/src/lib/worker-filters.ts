import { Worker } from './types';

/** Distinct trades among the loaded workers, sorted, for the Trade filter. */
export function tradeOptions(workers: Pick<Worker, 'trade'>[]): { label: string; value: string }[] {
  const trades = new Set<string>();
  for (const w of workers) {
    const t = w.trade?.trim();
    if (t) trades.add(t);
  }
  return [...trades]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((t) => ({ label: t, value: t }));
}
