/** Default project/site selection for the site picker. Pure. */

export const LAST_SITE_KEY = 'constructos_daily_last_site';

/**
 * Picks the first preferred id that is available; otherwise auto-selects
 * when exactly one option exists; otherwise null (the user chooses).
 */
export function pickDefaultId(
  options: readonly { id: string }[],
  preferred: readonly (string | null | undefined)[],
): string | null {
  for (const p of preferred) {
    if (p && options.some((o) => o.id === p)) return p;
  }
  return options.length === 1 ? options[0].id : null;
}

export interface LastSite {
  projectId: string;
  siteId: string;
}

export function readLastSite(): LastSite | null {
  try {
    const raw = localStorage.getItem(LAST_SITE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastSite>;
    return typeof v.projectId === 'string' && typeof v.siteId === 'string' ? { projectId: v.projectId, siteId: v.siteId } : null;
  } catch {
    return null;
  }
}

export function writeLastSite(v: LastSite): void {
  try { localStorage.setItem(LAST_SITE_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}
