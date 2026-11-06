import type { WorkPackage } from '@/lib/types';

export interface WorkPackageGroups {
  /** Packages belonging to the selected contractor. */
  own:    WorkPackage[];
  /** Packages belonging to any other contractor (still selectable). */
  others: WorkPackage[];
}

/**
 * Split a site's work packages for the "new schedule task" picker.
 *
 * The picker used to list every package on the site with no indication of
 * whose it was, so a task for contractor A was easily filed under contractor
 * B's package. A manager may still deliberately choose another contractor's
 * package, so nothing is hidden: the selected contractor's packages come
 * first and the rest are listed separately with their contractor's name.
 * With no contractor selected every package is in `others`.
 */
export function groupWorkPackagesForContractor(
  packages: WorkPackage[],
  contractorId: string,
): WorkPackageGroups {
  const own:    WorkPackage[] = [];
  const others: WorkPackage[] = [];
  for (const p of packages) {
    if (contractorId && p.contractorId === contractorId) own.push(p);
    else others.push(p);
  }
  return { own, others };
}

/** Option label for a package that belongs to someone other than the selected contractor. */
export function otherContractorPackageLabel(p: WorkPackage): string {
  const who = p.contractor?.name;
  return who ? `${p.name} — ${who}` : p.name;
}
