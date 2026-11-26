import type { Worker } from '../types';

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
