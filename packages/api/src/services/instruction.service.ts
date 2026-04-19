import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { InstructionStatus, InstructionPriority, InstructionType } from '@prisma/client';
import { emitToCompany } from './event-emitter.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateInstructionInput {
  type: InstructionType;
  title: string;
  category?: string;
  priority?: InstructionPriority;
  description?: string;
  issuedDate: string;
  targetActionDate?: string;
  siteId?: string;
  contractorId?: string;
  drawingId?: string;
  revisionId?: string;
  milestoneId?: string;
  workPackageId?: string;
}

export interface UpdateInstructionInput {
  title?: string;
  category?: string | null;
  priority?: InstructionPriority;
  status?: InstructionStatus;
  description?: string | null;
  targetActionDate?: string | null;
  contractorResponse?: string | null;
  resolutionNotes?: string | null;
  siteId?: string | null;
  contractorId?: string | null;
  drawingId?: string | null;
  revisionId?: string | null;
  milestoneId?: string | null;
  workPackageId?: string | null;
}

export interface AddAttachmentInput {
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
}

// ─── Selects ──────────────────────────────────────────────────────────────────

const INSTRUCTION_SELECT = {
  id:                 true,
  companyId:          true,
  projectId:          true,
  siteId:             true,
  contractorId:       true,
  issuedById:         true,
  type:               true,
  title:              true,
  category:           true,
  priority:           true,
  status:             true,
  description:        true,
  issuedDate:         true,
  targetActionDate:   true,
  drawingId:          true,
  revisionId:         true,
  milestoneId:        true,
  workPackageId:      true,
  contractorResponse: true,
  resolutionNotes:    true,
  createdAt:          true,
  updatedAt:          true,
  issuedBy:   { select: { id: true, firstName: true, lastName: true, role: true } },
  site:       { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true } },
  drawing:    { select: { id: true, drawingNumber: true, title: true } },
  revision:   { select: { id: true, revisionNumber: true, status: true } },
  milestone:  { select: { id: true, name: true, status: true } },
  workPackage: { select: { id: true, name: true } },
  attachments: {
    select: {
      id: true, fileUrl: true, fileName: true, fileSizeBytes: true, fileType: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// ─── Permission helpers ───────────────────────────────────────────────────────

async function assertProjectMember(projectId: string, actor: RequestUser): Promise<void> {
  if (actor.role === 'company_admin') return;
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: actor.id, companyId: actor.companyId },
    select: { id: true },
  });
  if (!member) throw new ForbiddenError('You are not a member of this project');
}

function canManage(role: string): boolean {
  return ['company_admin', 'project_manager'].includes(role);
}

function canIssue(role: string): boolean {
  return ['company_admin', 'project_manager', 'consultant'].includes(role);
}

function canView(role: string): boolean {
  return ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor', 'finance_officer', 'viewer'].includes(role);
}

// ─── Validate optional links ───────────────────────────────────────────────────

async function validateLinks(
  input: { siteId?: string | null; contractorId?: string | null; drawingId?: string | null; revisionId?: string | null; milestoneId?: string | null; workPackageId?: string | null },
  projectId: string,
  companyId: string,
) {
  if (input.siteId) {
    const site = await prisma.jobSite.findFirst({ where: { id: input.siteId, projectId, companyId }, select: { id: true } });
    if (!site) throw new NotFoundError('Site');
  }
  if (input.contractorId) {
    const contractor = await prisma.contractor.findFirst({ where: { id: input.contractorId, companyId }, select: { id: true } });
    if (!contractor) throw new NotFoundError('Contractor');
  }
  if (input.drawingId) {
    const drawing = await prisma.drawing.findFirst({ where: { id: input.drawingId, projectId, companyId }, select: { id: true } });
    if (!drawing) throw new NotFoundError('Drawing');
  }
  if (input.revisionId && input.drawingId) {
    const revision = await prisma.drawingRevision.findFirst({ where: { id: input.revisionId, drawingId: input.drawingId, companyId }, select: { id: true } });
    if (!revision) throw new NotFoundError('Drawing revision');
  }
  if (input.milestoneId) {
    const milestone = await prisma.scheduleMilestone.findFirst({ where: { id: input.milestoneId, projectId, companyId }, select: { id: true } });
    if (!milestone) throw new NotFoundError('Milestone');
  }
  if (input.workPackageId) {
    const pkg = await prisma.workPackage.findFirst({ where: { id: input.workPackageId, projectId, companyId }, select: { id: true } });
    if (!pkg) throw new NotFoundError('Work package');
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listInstructions(
  projectId: string,
  actor: RequestUser,
  filters: {
    status?: InstructionStatus;
    priority?: InstructionPriority;
    type?: InstructionType;
    siteId?: string;
    contractorId?: string;
    issuedById?: string;
  } = {},
) {
  if (!canView(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const where: Record<string, unknown> = {
    projectId,
    companyId: actor.companyId,
  };

  if (filters.status)       where['status']       = filters.status;
  if (filters.priority)     where['priority']     = filters.priority;
  if (filters.type)         where['type']         = filters.type;
  if (filters.siteId)       where['siteId']       = filters.siteId;
  if (filters.contractorId) where['contractorId'] = filters.contractorId;
  if (filters.issuedById)   where['issuedById']   = filters.issuedById;

  // Contractors can only see instructions directed at them
  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    where['contractorId'] = ownContractor?.id ?? '__none__';
  }

  return prisma.consultantInstruction.findMany({
    where,
    select:  INSTRUCTION_SELECT,
    orderBy: [{ issuedDate: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getInstruction(
  instructionId: string,
  projectId: string,
  actor: RequestUser,
) {
  if (!canView(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const instruction = await prisma.consultantInstruction.findFirst({
    where: { id: instructionId, projectId, companyId: actor.companyId },
    select: INSTRUCTION_SELECT,
  });
  if (!instruction) throw new NotFoundError('Instruction');

  // Contractors can only see their own
  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    if (instruction.contractorId !== ownContractor?.id) {
      throw new ForbiddenError('Access denied');
    }
  }

  return instruction;
}

export async function createInstruction(
  projectId: string,
  input: CreateInstructionInput,
  actor: RequestUser,
) {
  if (!canIssue(actor.role)) throw new ForbiddenError('Only consultants and managers can create instructions');
  await assertProjectMember(projectId, actor);

  await validateLinks(input, projectId, actor.companyId);

  const instruction = await prisma.consultantInstruction.create({
    data: {
      companyId:       actor.companyId,
      projectId,
      issuedById:      actor.id,
      type:            input.type,
      title:           input.title,
      category:        input.category       ?? null,
      priority:        input.priority       ?? 'medium',
      status:          'open',
      description:     input.description    ?? null,
      issuedDate:      new Date(input.issuedDate),
      targetActionDate: input.targetActionDate ? new Date(input.targetActionDate) : null,
      siteId:          input.siteId         ?? null,
      contractorId:    input.contractorId   ?? null,
      drawingId:       input.drawingId      ?? null,
      revisionId:      input.revisionId     ?? null,
      milestoneId:     input.milestoneId    ?? null,
      workPackageId:   input.workPackageId  ?? null,
    },
    select: INSTRUCTION_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'consultant_instruction',
      entityId:     instruction.id,
      changesAfter: instruction as object,
    },
  });

  emitToCompany(actor.companyId, {
    type: 'instruction_updated',
    payload: { instructionId: instruction.id, projectId, action: 'created', status: instruction.status },
  });

  return instruction;
}

export async function updateInstruction(
  instructionId: string,
  projectId: string,
  input: UpdateInstructionInput,
  actor: RequestUser,
) {
  if (!canView(actor.role)) throw new ForbiddenError('Access denied');
  await assertProjectMember(projectId, actor);

  const before = await prisma.consultantInstruction.findFirst({
    where: { id: instructionId, projectId, companyId: actor.companyId },
    select: INSTRUCTION_SELECT,
  });
  if (!before) throw new NotFoundError('Instruction');

  // Contractors can only update their own contractorResponse
  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    if (before.contractorId !== ownContractor?.id) throw new ForbiddenError('Access denied');
    // Contractors can only set contractorResponse
    const allowedKeys: (keyof UpdateInstructionInput)[] = ['contractorResponse'];
    const attempted = Object.keys(input) as (keyof UpdateInstructionInput)[];
    const disallowed = attempted.filter((k) => !allowedKeys.includes(k));
    if (disallowed.length > 0) throw new ForbiddenError('Contractors can only update their response');
  }

  // Site supervisors can only update status
  if (actor.role === 'site_supervisor') {
    const allowedKeys: (keyof UpdateInstructionInput)[] = ['status'];
    const attempted = Object.keys(input) as (keyof UpdateInstructionInput)[];
    const disallowed = attempted.filter((k) => !allowedKeys.includes(k));
    if (disallowed.length > 0) throw new ForbiddenError('Site supervisors can only update status');
  }

  // Consultants can only update instructions they issued
  if (actor.role === 'consultant' && before.issuedById !== actor.id) {
    throw new ForbiddenError('Consultants can only update their own instructions');
  }

  if (input.siteId !== undefined || input.contractorId !== undefined || input.drawingId !== undefined) {
    await validateLinks(input, projectId, actor.companyId);
  }

  const updated = await prisma.consultantInstruction.update({
    where: { id: instructionId },
    data: {
      ...(input.title              !== undefined && { title:              input.title }),
      ...(input.category           !== undefined && { category:           input.category }),
      ...(input.priority           !== undefined && { priority:           input.priority }),
      ...(input.status             !== undefined && { status:             input.status }),
      ...(input.description        !== undefined && { description:        input.description }),
      ...(input.targetActionDate   !== undefined && { targetActionDate:   input.targetActionDate ? new Date(input.targetActionDate) : null }),
      ...(input.contractorResponse !== undefined && { contractorResponse: input.contractorResponse }),
      ...(input.resolutionNotes    !== undefined && { resolutionNotes:    input.resolutionNotes }),
      ...(input.siteId             !== undefined && { siteId:             input.siteId }),
      ...(input.contractorId       !== undefined && { contractorId:       input.contractorId }),
      ...(input.drawingId          !== undefined && { drawingId:          input.drawingId }),
      ...(input.revisionId         !== undefined && { revisionId:         input.revisionId }),
      ...(input.milestoneId        !== undefined && { milestoneId:        input.milestoneId }),
      ...(input.workPackageId      !== undefined && { workPackageId:      input.workPackageId }),
    },
    select: INSTRUCTION_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'consultant_instruction',
      entityId:      instructionId,
      changesBefore: before  as object,
      changesAfter:  updated as object,
    },
  });

  emitToCompany(actor.companyId, {
    type: 'instruction_updated',
    payload: { instructionId, projectId, action: 'updated', status: updated.status },
  });

  return updated;
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export async function addAttachment(
  instructionId: string,
  projectId: string,
  input: AddAttachmentInput,
  actor: RequestUser,
) {
  if (!canIssue(actor.role) && !canManage(actor.role)) {
    throw new ForbiddenError('Access denied');
  }
  await assertProjectMember(projectId, actor);

  const instruction = await prisma.consultantInstruction.findFirst({
    where: { id: instructionId, projectId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!instruction) throw new NotFoundError('Instruction');

  const attachment = await prisma.instructionAttachment.create({
    data: {
      instructionId,
      companyId:    actor.companyId,
      fileUrl:      input.fileUrl,
      fileKey:      input.fileKey,
      fileName:     input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileType:     input.fileType,
      uploadedById: actor.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'instruction_attachment',
      entityId:     attachment.id,
      changesAfter: attachment as object,
    },
  });

  return attachment;
}

// ─── File access check ────────────────────────────────────────────────────────

export async function findAttachmentByFileKey(fileKey: string, companyId: string) {
  return prisma.instructionAttachment.findFirst({
    where: { fileKey, companyId },
    select: { id: true },
  });
}
