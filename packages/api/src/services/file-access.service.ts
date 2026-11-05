import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { RequestUser } from '../types';
import { getAccessibleProjectIds, getAccessibleSiteIds } from '../middleware/requireProjectAccess';

/**
 * Authorisation for GET /uploads/* (locally stored files).
 *
 * A file key is served only when the caller could read the record that owns
 * it through that record's own routes. The role lists below mirror the
 * VIEW_ROLES preHandlers in delivery.routes.ts, drawing.routes.ts and
 * instruction.routes.ts — keep them in sync.
 */
const DELIVERY_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer',
];
const DRAWING_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor', 'finance_officer', 'viewer',
];
const INSTRUCTION_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor', 'finance_officer', 'viewer',
];

type Owner =
  | { kind: 'delivery'; projectId: string; siteId: string }
  | { kind: 'drawing'; projectId: string }
  | { kind: 'instruction'; projectId: string; contractorId: string | null };

/** Resolves every record that references `fileKey` inside the caller's company. */
async function findOwners(fileKey: string, companyId: string): Promise<Owner[]> {
  const [photo, document, revision, attachment] = await Promise.all([
    prisma.deliveryPhoto.findFirst({
      where:  { fileKey, companyId, deliveryRecord: { companyId } },
      select: { deliveryRecord: { select: { projectId: true, siteId: true } } },
    }),
    prisma.deliveryDocument.findFirst({
      where:  { fileKey, companyId, deliveryRecord: { companyId } },
      select: { deliveryRecord: { select: { projectId: true, siteId: true } } },
    }),
    prisma.drawingRevision.findFirst({
      where:  { fileKey, companyId, drawing: { companyId } },
      select: { drawing: { select: { projectId: true } } },
    }),
    prisma.instructionAttachment.findFirst({
      where:  { fileKey, companyId, instruction: { companyId } },
      select: { instruction: { select: { projectId: true, contractorId: true } } },
    }),
  ]);

  const owners: Owner[] = [];
  if (photo)    owners.push({ kind: 'delivery', ...photo.deliveryRecord });
  if (document) owners.push({ kind: 'delivery', ...document.deliveryRecord });
  if (revision) owners.push({ kind: 'drawing', projectId: revision.drawing.projectId });
  if (attachment) {
    owners.push({
      kind:         'instruction',
      projectId:    attachment.instruction.projectId,
      contractorId: attachment.instruction.contractorId,
    });
  }
  return owners;
}

async function canAccessOwner(
  owner: Owner,
  user: RequestUser,
  projectIds: () => Promise<string[] | null>,
): Promise<boolean> {
  const viewRoles =
    owner.kind === 'delivery' ? DELIVERY_VIEW_ROLES
    : owner.kind === 'drawing' ? DRAWING_VIEW_ROLES
    : INSTRUCTION_VIEW_ROLES;
  if (!viewRoles.includes(user.role)) return false;

  // Company-wide roles get null (every project in their company); everyone
  // else needs an active (removedAt = null) project_members row.
  const accessible = await projectIds();
  if (accessible !== null && !accessible.includes(owner.projectId)) return false;

  if (owner.kind !== 'delivery' && user.role === 'finance_officer') {
    // drawing.service / instruction.service assertProjectMember exempt only
    // company_admin, so a finance_officer needs membership to read the record
    // — and therefore its files.
    const member = await prisma.projectMember.findFirst({
      where:  { projectId: owner.projectId, userId: user.id, companyId: user.companyId, removedAt: null },
      select: { id: true },
    });
    if (!member) return false;
  }

  if (owner.kind === 'delivery') {
    // Same rule as delivery.service checkSiteAccess: a site-scoped supervisor
    // sees only their assigned sites.
    const siteIds = await getAccessibleSiteIds(owner.projectId, user.id, user.role);
    if (siteIds !== null && !siteIds.includes(owner.siteId)) return false;
  }

  if (owner.kind === 'instruction' && user.role === 'contractor') {
    // Same rule as instruction.service getInstruction: contractors see only
    // instructions directed at their own contractor record.
    const ownContractor = await prisma.contractor.findFirst({
      where:  { userId: user.id, companyId: user.companyId },
      select: { id: true },
    });
    if (!ownContractor || owner.contractorId !== ownContractor.id) return false;
  }

  return true;
}

/**
 * True when `user` may download the stored file `fileKey`. Callers must answer
 * every false with the same 404 used for unknown keys so a denied caller
 * cannot distinguish "exists but forbidden" from "does not exist".
 */
export async function canAccessUploadedFile(fileKey: string, user: RequestUser): Promise<boolean> {
  const owners = await findOwners(fileKey, user.companyId);
  if (owners.length === 0) return false;

  let cached: Promise<string[] | null> | undefined;
  const projectIds = () => {
    if (!cached) cached = getAccessibleProjectIds(user.companyId, user.id, user.role);
    return cached;
  };

  for (const owner of owners) {
    if (await canAccessOwner(owner, user, projectIds)) return true;
  }
  return false;
}
