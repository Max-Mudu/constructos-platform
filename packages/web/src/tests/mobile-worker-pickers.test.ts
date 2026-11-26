/**
 * The Android attendance and labour pickers use the mobile copy of the
 * active-worker filter (packages/mobile/src/utils/workers.ts). The mobile
 * package has no test runner, so its pure helper is tested here.
 */
import { bookableWorkers } from '../../../mobile/src/utils/workers';

type W = { id: string; isActive?: boolean; employmentStatus?: 'active' | 'inactive' | 'suspended' };

describe('mobile bookableWorkers', () => {
  it('keeps only workers that are active with an active employment status', () => {
    const workers: W[] = [
      { id: 'active', isActive: true, employmentStatus: 'active' },
      { id: 'deactivated', isActive: false, employmentStatus: 'inactive' },
      { id: 'suspended', isActive: false, employmentStatus: 'suspended' },
      { id: 'registered-inactive', isActive: true, employmentStatus: 'inactive' },
      { id: 'flag-off', isActive: false, employmentStatus: 'active' },
    ];
    expect(bookableWorkers(workers).map((w) => w.id)).toEqual(['active']);
  });

  it('does not hide a worker whose status fields are missing (the API still decides)', () => {
    expect(bookableWorkers<W>([{ id: 'partial' }]).map((w) => w.id)).toEqual(['partial']);
  });

  it('keeps the order of the list', () => {
    const workers: W[] = [
      { id: 'b', isActive: true, employmentStatus: 'active' },
      { id: 'x', isActive: false, employmentStatus: 'inactive' },
      { id: 'a', isActive: true, employmentStatus: 'active' },
    ];
    expect(bookableWorkers(workers).map((w) => w.id)).toEqual(['b', 'a']);
  });
});
