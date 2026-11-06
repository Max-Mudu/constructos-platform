/**
 * Delivery acceptance status helpers.
 *
 * `acceptanceStatus` is optional on the API (Prisma `AcceptanceStatus?`, zod
 * `.optional()` on create and update) and records created without it — e.g.
 * from the mobile app — come back as null. The web treated it as always set:
 * null rendered as a red "Rejected" badge, and the edit form sent
 * `acceptanceStatus: null` back, which the update schema rejects (422), so a
 * delivery without an acceptance decision could never be edited.
 */
import type { AcceptanceStatus } from './types';

export type AcceptanceValue = AcceptanceStatus | null | undefined;

export function acceptanceDisplay(
  status: AcceptanceValue,
): { label: string; variant: 'active' | 'secondary' | 'destructive' | 'outline' } {
  switch (status) {
    case 'accepted':           return { label: 'Accepted', variant: 'active' };
    case 'partially_accepted': return { label: 'Partially Accepted', variant: 'secondary' };
    case 'rejected':           return { label: 'Rejected', variant: 'destructive' };
    default:                   return { label: 'Not recorded', variant: 'outline' };
  }
}

/**
 * Form value → PATCH fragment. The API cannot clear the field (null is
 * rejected), so an unset value is omitted rather than sent.
 */
export function acceptancePatch(value: string | null | undefined): { acceptanceStatus?: AcceptanceStatus } {
  return value === 'accepted' || value === 'partially_accepted' || value === 'rejected'
    ? { acceptanceStatus: value }
    : {};
}
