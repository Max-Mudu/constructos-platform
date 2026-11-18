/**
 * Name of the cached PDF for one drawing revision.
 *
 * The revision id is part of the name: drawing numbers ("A-101") and revision
 * numbers ("1") repeat across projects, so a name made of those two alone
 * would open another project's cached drawing for a user who can see both.
 *
 * Pure (no React Native imports) so it can be exercised with plain Node.
 */
export function drawingPdfFileName(
  drawingNumber: string | null | undefined,
  revision: { id: string; revisionNumber: string },
): string {
  return `${drawingNumber || 'drawing'}-rev-${revision.revisionNumber}-${revision.id}.pdf`
    .replace(/[^a-zA-Z0-9.-]/g, '_');
}
