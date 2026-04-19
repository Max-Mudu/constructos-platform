import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { DrawingStatus } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDrawingInput {
  drawingNumber: string;
  title: string;
  discipline?: string;
  siteId?: string;
}

export interface UpdateDrawingInput {
  title?: string;
  discipline?: string | null;
  siteId?: string | null;
}

export interface UploadRevisionInput {
  revisionNumber: string;
  status: DrawingStatus;
  issueDate?: string;
  notes?: string;
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
}

export interface ApproveRevisionInput {
  issueDate?: string;
}

export interface AddCommentInput {
  text: string;
}

// ─── Selects ──────────────────────────────────────────────────────────────────

const DRAWING_SELECT = {
  id:                true,
  companyId:         true,
  projectId:         true,
  siteId:            true,
  drawingNumber:     true,
  title:             true,
  discipline:        true,
  currentRevisionId: true,
  createdById:       true,
  createdAt:         true,
  updatedAt:         true,
  site:     { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  revisions: {
    select: {
      id:             true,
      revisionNumber: true,
      status:         true,
      issueDate:      true,
      uploadedById:   true,
      approvedById:   true,
      approvedAt:     true,
      notes:          true,
      fileUrl:        true,
      fileName:       true,
      fileSizeBytes:  true,
      fileType:       true,
      createdAt:      true,
      updatedAt:      true,
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      approvedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

const REVISION_SELECT = {
  id:             true,
  drawingId:      true,
  companyId:      true,
  revisionNumber: true,
  fileUrl:        true,
  fileKey:        true,
  fileName:       true,
  fileSizeBytes:  true,
  fileType:       true,
  status:         true,
  issueDate:      true,
  uploadedById:   true,
  approvedById:   true,
  approvedAt:     true,
  notes:          true,
  createdAt:      true,
  updatedAt:      true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

const COMMENT_SELECT = {
  id:        true,
  companyId: true,
  drawingId: true,
  revisionId: true,
  userId:    true,
  text:      true,
  createdAt: true,
  updatedAt: true,
  user:      { select: { id: true, firstName: true, lastName: true, role: true } },
} as const;

// ─── Permission helpers ───────────────────────────────────────────────────────

function canManageDrawings(role: string): boolean {
  return ['company_admin', 'project_manager'].includes(role);
}

function canViewDrawings(role: string): boolean {
  return ['company_admin', 'project_manager', 'site_supervisor',
          'consultant', 'contractor', 'finance_officer', 'viewer'].includes(role);
}

async function assertProjectMember(projectId: string, actor: RequestUser): Promise<void> {
  if (actor.role === 'company_admin') return; // admins always have access

  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: actor.id, companyId: actor.companyId },
    select: { id: true },
  });
  if (!member) throw new ForbiddenError('You are not a member of this project');
}

async function findDrawing(drawingId: string, projectId: string, companyId: string) {
  const drawing = await prisma.drawing.findFirst({
    where: { id: drawingId, projectId, companyId },
    select: DRAWING_SELECT,
  });
  if (!drawing) throw new NotFoundError('Drawing');
  return drawing;
}

// ─── Drawings CRUD ────────────────────────────────────────────────────────────

export async function listDrawings(
  projectId: string,
  actor: RequestUser,
  filters: { discipline?: string; status?: DrawingStatus; siteId?: string; search?: string } = {},
) {
  if (!canViewDrawings(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const where: Record<string, unknown> = {
    projectId,
    companyId: actor.companyId,
  };

  if (filters.siteId)     where['siteId']     = filters.siteId;
  if (filters.discipline) where['discipline'] = filters.discipline;
  if (filters.search) {
    where['OR'] = [
      { title:         { contains: filters.search, mode: 'insensitive' } },
      { drawingNumber: { contains: filters.search, mode: 'insensitive' } },
      { discipline:    { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const drawings = await prisma.drawing.findMany({
    where,
    select: DRAWING_SELECT,
    orderBy: [{ drawingNumber: 'asc' }],
  });

  // Apply status filter on the current revision
  if (filters.status) {
    return drawings.filter((d) => {
      const current = d.revisions.find((r) => r.id === d.currentRevisionId);
      return current?.status === filters.status;
    });
  }

  return drawings;
}

export async function getDrawing(drawingId: string, projectId: string, actor: RequestUser) {
  if (!canViewDrawings(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  return findDrawing(drawingId, projectId, actor.companyId);
}

export async function createDrawing(
  projectId: string,
  input: CreateDrawingInput,
  actor: RequestUser,
) {
  if (!canManageDrawings(actor.role)) throw new ForbiddenError('Only project managers and admins can create drawings');
  await assertProjectMember(projectId, actor);

  // Validate site belongs to project
  if (input.siteId) {
    const site = await prisma.jobSite.findFirst({
      where: { id: input.siteId, projectId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!site) throw new NotFoundError('Site');
  }

  const drawing = await prisma.drawing.create({
    data: {
      companyId:    actor.companyId,
      projectId,
      siteId:       input.siteId    ?? null,
      drawingNumber: input.drawingNumber,
      title:        input.title,
      discipline:   input.discipline ?? null,
      createdById:  actor.id,
    },
    select: DRAWING_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'drawing',
      entityId:     drawing.id,
      changesAfter: drawing as object,
    },
  });

  return drawing;
}

export async function updateDrawing(
  drawingId: string,
  projectId: string,
  input: UpdateDrawingInput,
  actor: RequestUser,
) {
  if (!canManageDrawings(actor.role)) throw new ForbiddenError('Only project managers and admins can edit drawings');
  await assertProjectMember(projectId, actor);

  const before = await findDrawing(drawingId, projectId, actor.companyId);

  if (input.siteId) {
    const site = await prisma.jobSite.findFirst({
      where: { id: input.siteId, projectId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!site) throw new NotFoundError('Site');
  }

  const updated = await prisma.drawing.update({
    where: { id: drawingId },
    data: {
      ...(input.title      !== undefined && { title:      input.title }),
      ...(input.discipline !== undefined && { discipline: input.discipline }),
      ...(input.siteId     !== undefined && { siteId:     input.siteId }),
    },
    select: DRAWING_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'drawing',
      entityId:      drawingId,
      changesBefore: before   as object,
      changesAfter:  updated  as object,
    },
  });

  return updated;
}

export async function deleteDrawing(drawingId: string, projectId: string, actor: RequestUser) {
  if (!canManageDrawings(actor.role)) throw new ForbiddenError('Only project managers and admins can delete drawings');
  await assertProjectMember(projectId, actor);

  const drawing = await findDrawing(drawingId, projectId, actor.companyId);

  await prisma.drawing.delete({ where: { id: drawingId } });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'drawing',
      entityId:      drawingId,
      changesBefore: drawing as object,
    },
  });
}

// ─── Revisions ────────────────────────────────────────────────────────────────

export async function uploadRevision(
  drawingId: string,
  projectId: string,
  input: UploadRevisionInput,
  actor: RequestUser,
) {
  if (!canManageDrawings(actor.role)) throw new ForbiddenError('Only project managers and admins can upload revisions');
  await assertProjectMember(projectId, actor);

  await findDrawing(drawingId, projectId, actor.companyId);

  const revision = await prisma.drawingRevision.create({
    data: {
      drawingId,
      companyId:      actor.companyId,
      revisionNumber: input.revisionNumber,
      fileUrl:        input.fileUrl,
      fileKey:        input.fileKey,
      fileName:       input.fileName,
      fileSizeBytes:  input.fileSizeBytes,
      fileType:       input.fileType,
      status:         input.status,
      issueDate:      input.issueDate ? new Date(input.issueDate) : null,
      uploadedById:   actor.id,
      notes:          input.notes ?? null,
    },
    select: REVISION_SELECT,
  });

  // If the new revision is issued_for_construction, auto-set as current
  if (input.status === 'issued_for_construction') {
    await prisma.drawing.update({
      where: { id: drawingId },
      data:  { currentRevisionId: revision.id },
    });
  }

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'drawing_revision',
      entityId:     revision.id,
      changesAfter: revision as object,
    },
  });

  return revision;
}

export async function approveRevision(
  revisionId: string,
  drawingId: string,
  projectId: string,
  input: ApproveRevisionInput,
  actor: RequestUser,
) {
  if (!canManageDrawings(actor.role)) throw new ForbiddenError('Only project managers and admins can approve revisions');
  await assertProjectMember(projectId, actor);

  await findDrawing(drawingId, projectId, actor.companyId);

  const revision = await prisma.drawingRevision.findFirst({
    where: { id: revisionId, drawingId, companyId: actor.companyId },
    select: REVISION_SELECT,
  });
  if (!revision) throw new NotFoundError('Revision');

  const now = new Date();

  // Mark all other revisions of this drawing as superseded
  await prisma.drawingRevision.updateMany({
    where: {
      drawingId,
      companyId: actor.companyId,
      id:        { not: revisionId },
      status:    { in: ['issued_for_construction', 'issued_for_review'] },
    },
    data: { status: 'superseded' },
  });

  const updated = await prisma.drawingRevision.update({
    where: { id: revisionId },
    data: {
      status:      'issued_for_construction',
      approvedById: actor.id,
      approvedAt:  now,
      issueDate:   input.issueDate ? new Date(input.issueDate) : revision.issueDate ?? now,
    },
    select: REVISION_SELECT,
  });

  // Set as current revision on drawing
  await prisma.drawing.update({
    where: { id: drawingId },
    data:  { currentRevisionId: revisionId },
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'drawing_revision',
      entityId:      revisionId,
      changesBefore: revision as object,
      changesAfter:  updated  as object,
    },
  });

  return updated;
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function listComments(
  revisionId: string,
  drawingId: string,
  projectId: string,
  actor: RequestUser,
) {
  if (!canViewDrawings(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const revision = await prisma.drawingRevision.findFirst({
    where: { id: revisionId, drawingId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!revision) throw new NotFoundError('Revision');

  return prisma.drawingComment.findMany({
    where:   { revisionId, drawingId, companyId: actor.companyId },
    select:  COMMENT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export async function addComment(
  revisionId: string,
  drawingId: string,
  projectId: string,
  input: AddCommentInput,
  actor: RequestUser,
) {
  if (!canViewDrawings(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const revision = await prisma.drawingRevision.findFirst({
    where: { id: revisionId, drawingId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!revision) throw new NotFoundError('Revision');

  const comment = await prisma.drawingComment.create({
    data: {
      companyId:  actor.companyId,
      drawingId,
      revisionId,
      userId:     actor.id,
      text:       input.text,
    },
    select: COMMENT_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'drawing_comment',
      entityId:     comment.id,
      changesAfter: comment as object,
    },
  });

  return comment;
}

// ─── File access check (for /uploads/* handler) ───────────────────────────────

export async function findRevisionByFileKey(
  fileKey: string,
  companyId: string,
) {
  return prisma.drawingRevision.findFirst({
    where: { fileKey, companyId },
    select: { id: true },
  });
}
