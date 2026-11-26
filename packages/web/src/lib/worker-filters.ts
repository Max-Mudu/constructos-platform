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

/**
 * Workers that new attendance or labour can be recorded for. The API refuses
 * a worker who is not active (isActive and employment status 'active') with
 * 422 WORKER_INACTIVE, so the attendance and labour pickers offer only these.
 * A field missing from a partial record does not hide the worker: the API
 * still decides.
 */
export function bookableWorkers<T extends Partial<Pick<Worker, 'isActive' | 'employmentStatus'>>>(workers: T[]): T[] {
  return workers.filter((w) => w.isActive !== false && (w.employmentStatus ?? 'active') === 'active');
}
