/**
 * The new-task work-package picker groups packages by the selected contractor
 * so a task is not silently filed under another contractor's package.
 */
import * as fs from 'fs';
import * as path from 'path';
import { groupWorkPackagesForContractor, otherContractorPackageLabel } from '@/lib/workflows-schedule';
import type { WorkPackage } from '@/lib/types';

function pkg(id: string, contractorId: string, contractorName: string): WorkPackage {
  return {
    id, companyId: 'c', projectId: 'p', siteId: 's', contractorId, name: `Pkg ${id}`,
    description: null, area: null, startDate: null, endDate: null, status: 'not_started' as WorkPackage['status'],
    createdById: 'u', createdAt: '', updatedAt: '',
    contractor: { id: contractorId, name: contractorName, tradeSpecialization: null },
    createdBy: { id: 'u', firstName: 'A', lastName: 'B' },
  };
}

const PACKAGES = [pkg('1', 'ca', 'Alpha Builders'), pkg('2', 'cb', 'Beta Electric'), pkg('3', 'ca', 'Alpha Builders')];

describe('groupWorkPackagesForContractor', () => {
  it('puts the selected contractor\'s packages first and keeps the rest', () => {
    const g = groupWorkPackagesForContractor(PACKAGES, 'ca');
    expect(g.own.map((p) => p.id)).toEqual(['1', '3']);
    expect(g.others.map((p) => p.id)).toEqual(['2']);
  });

  it('with no contractor selected, nothing is labelled as the contractor\'s own', () => {
    const g = groupWorkPackagesForContractor(PACKAGES, '');
    expect(g.own).toEqual([]);
    expect(g.others).toHaveLength(3);
  });

  it('a contractor with no packages gets none of the others\' packages as own', () => {
    const g = groupWorkPackagesForContractor(PACKAGES, 'cz');
    expect(g.own).toEqual([]);
    expect(g.others).toHaveLength(3);
  });

  it('labels another contractor\'s package with the contractor name', () => {
    expect(otherContractorPackageLabel(PACKAGES[1])).toBe('Pkg 2 — Beta Electric');
  });
});

describe('new schedule task page', () => {
  const PAGE = path.resolve(__dirname, '..', 'app', '(app)', 'projects', '[projectId]', 'sites', '[siteId]', 'schedules', 'new', 'page.tsx');
  const src = fs.readFileSync(PAGE, 'utf8');

  it('uses the contractor grouping for the package picker', () => {
    expect(src).toMatch(/groupWorkPackagesForContractor\(packages, form\.contractorId\)/);
  });

  it('does not swallow a failed load of contractors / packages', () => {
    expect(src).not.toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(src).toMatch(/setLoadError\(/);
  });
});
