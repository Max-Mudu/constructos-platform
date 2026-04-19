import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { ScheduleTaskStatus, MilestoneStatus } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateWorkPackageInput {
  contractorId: string;
  name: string;
  description?: string;
  area?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateWorkPackageInput {
  name?: string;
  description?: string | null;
  area?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: ScheduleTaskStatus;
}

export interface CreateTaskInput {
  contractorId: string;
  workPackageId?: string;
  title: string;
  description?: string;
  area?: string;
  materialsRequired?: string;
  equipmentRequired?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  plannedProgress?: number;
  dependsOnTaskIds?: string[];
}

export interface UpdateTaskInput {
  workPackageId?: string | null;
  title?: string;
  description?: string | null;
  area?: string | null;
  materialsRequired?: string | null;
  equipmentRequired?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  plannedProgress?: number | null;
  actualProgress?: number | null;
  status?: ScheduleTaskStatus;
  delayReason?: string | null;
  comments?: string | null;
}

export interface CreateMilestoneInput {
  name: string;
  description?: string;
  plannedDate: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string | null;
  plannedDate?: string;
  actualDate?: string | null;
  status?: MilestoneStatus;
}

export interface CreateWeeklyPlanInput {
  contractorId: string;
  weekStartDate: string;
  notes?: string;
  items: Array<{ taskId: string; plannedHours?: number; notes?: string }>;
}

// ─── Selects ──────────────────────────────────────────────────────────────────

const PACKAGE_SELECT = {
  id:           true,
  companyId:    true,
  projectId:    true,
  siteId:       true,
  contractorId: true,
  name:         true,
  description:  true,
  area:         true,
  startDate:    true,
  endDate:      true,
  status:       true,
  createdById:  true,
  createdAt:    true,
  updatedAt:    true,
  contractor: { select: { id: true, name: true, tradeSpecialization: true } },
  createdBy:  { select: { id: true, firstName: true, lastName: true } },
} as const;

const TASK_SELECT = {
  id:                true,
  companyId:         true,
  projectId:         true,
  siteId:            true,
  contractorId:      true,
  workPackageId:     true,
  title:             true,
  description:       true,
  area:              true,
  materialsRequired: true,
  equipmentRequired: true,
  plannedStartDate:  true,
  plannedEndDate:    true,
  actualStartDate:   true,
  actualEndDate:     true,
  plannedProgress:   true,
  actualProgress:    true,
  status:            true,
  delayReason:       true,
  comments:          true,
  createdById:       true,
  createdAt:         true,
  updatedAt:         true,
  contractor:   { select: { id: true, name: true, tradeSpecialization: true } },
  workPackage:  { select: { id: true, name: true, area: true } },
  createdBy:    { select: { id: true, firstName: true, lastName: true } },
  milestones:   {
    select: {
      id: true, name: true, description: true,
      plannedDate: true, actualDate: true, status: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: { plannedDate: 'asc' as const },
  },
  outgoingDeps: {
    select: { dependsOnTask: { select: { id: true, title: true, status: true } } },
  },
  incomingDeps: {
    select: { task: { select: { id: true, title: true, status: true } } },
  },
} as const;

const MILESTONE_SELECT = {
  id:          true,
  companyId:   true,
  projectId:   true,
  siteId:      true,
  taskId:      true,
  name:        true,
  description: true,
  plannedDate: true,
  actualDate:  true,
  status:      true,
  createdAt:   true,
  updatedAt:   true,
} as const;

const WEEKLY_PLAN_SELECT = {
  id:            true,
  companyId:     true,
  projectId:     true,
  siteId:        true,
  contractorId:  true,
  weekStartDate: true,
  notes:         true,
  createdById:   true,
  createdAt:     true,
  updatedAt:     true,
  contractor: { select: { id: true, name: true } },
  createdBy:  { select: { id: true, firstName: true, lastName: true } },
  items: {
    select: {
      id: true, plannedHours: true, notes: true,
      task: { select: { id: true, title: true, status: true, area: true } },
    },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkSiteAccess(
  siteId: string,
  projectId: string,
  actor: RequestUser,
): Promise<void> {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);
  if (accessibleSiteIds !== null && !accessibleSiteIds.includes(siteId)) {
    throw new NotFoundError('Site');
  }
}

async function resolveContractorAccess(
  contractorId: string,
  actor: RequestUser,
): Promise<void> {
  // Contractors can only manage their own records
  if (actor.role === 'contractor') {
    const ownRecord = await prisma.contractor.findFirst({
      where: { id: contractorId, userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    if (!ownRecord) throw new ForbiddenError('You can only manage your own schedules');
  }
}

// ─── Work Packages ────────────────────────────────────────────────────────────

export async function listWorkPackages(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  filters: { contractorId?: string; status?: ScheduleTaskStatus } = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  const where: Record<string, unknown> = {
    projectId,
    siteId,
    companyId: actor.companyId,
  };

  if (filters.contractorId) where['contractorId'] = filters.contractorId;
  if (filters.status)       where['status']       = filters.status;

  // Contractors see only their own packages
  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    where['contractorId'] = ownContractor?.id ?? '__none__';
  }

  // Consultants see all (read-only enforced at route level)
  return prisma.workPackage.findMany({
    where,
    select: PACKAGE_SELECT,
    orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
  });
}

export async function getWorkPackage(
  packageId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const pkg = await prisma.workPackage.findFirst({
    where: { id: packageId, projectId, siteId, companyId: actor.companyId },
    select: PACKAGE_SELECT,
  });
  if (!pkg) throw new NotFoundError('Work package');
  return pkg;
}

export async function createWorkPackage(
  projectId: string,
  siteId: string,
  input: CreateWorkPackageInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  await resolveContractorAccess(input.contractorId, actor);

  // Verify contractor belongs to company
  const contractor = await prisma.contractor.findFirst({
    where: { id: input.contractorId, companyId: actor.companyId, isActive: true },
    select: { id: true },
  });
  if (!contractor) throw new NotFoundError('Contractor');

  const pkg = await prisma.workPackage.create({
    data: {
      companyId:    actor.companyId,
      projectId,
      siteId,
      contractorId: input.contractorId,
      name:         input.name,
      description:  input.description  ?? null,
      area:         input.area         ?? null,
      startDate:    input.startDate    ? new Date(input.startDate) : null,
      endDate:      input.endDate      ? new Date(input.endDate)   : null,
      createdById:  actor.id,
    },
    select: PACKAGE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'work_package',
      entityId:     pkg.id,
      changesAfter: pkg as object,
    },
  });

  return pkg;
}

export async function updateWorkPackage(
  packageId: string,
  projectId: string,
  siteId: string,
  input: UpdateWorkPackageInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.workPackage.findFirst({
    where: { id: packageId, projectId, siteId, companyId: actor.companyId },
    select: PACKAGE_SELECT,
  });
  if (!before) throw new NotFoundError('Work package');

  await resolveContractorAccess(before.contractorId, actor);

  const updated = await prisma.workPackage.update({
    where: { id: packageId },
    data: {
      ...(input.name        !== undefined && { name:        input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.area        !== undefined && { area:        input.area }),
      ...(input.startDate   !== undefined && { startDate:   input.startDate ? new Date(input.startDate) : null }),
      ...(input.endDate     !== undefined && { endDate:     input.endDate   ? new Date(input.endDate)   : null }),
      ...(input.status      !== undefined && { status:      input.status }),
    },
    select: PACKAGE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'work_package',
      entityId:      packageId,
      changesBefore: before  as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteWorkPackage(
  packageId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const pkg = await prisma.workPackage.findFirst({
    where: { id: packageId, projectId, siteId, companyId: actor.companyId },
    select: PACKAGE_SELECT,
  });
  if (!pkg) throw new NotFoundError('Work package');

  await prisma.workPackage.delete({ where: { id: packageId } });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'work_package',
      entityId:      packageId,
      changesBefore: pkg as object,
    },
  });
}

// ─── Schedule Tasks ───────────────────────────────────────────────────────────

export async function listTasks(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  filters: {
    workPackageId?: string;
    contractorId?: string;
    status?: ScheduleTaskStatus;
  } = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  const where: Record<string, unknown> = {
    projectId,
    siteId,
    companyId: actor.companyId,
  };

  if (filters.workPackageId) where['workPackageId'] = filters.workPackageId;
  if (filters.contractorId)  where['contractorId']  = filters.contractorId;
  if (filters.status)        where['status']        = filters.status;

  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    where['contractorId'] = ownContractor?.id ?? '__none__';
  }

  return prisma.scheduleTask.findMany({
    where,
    select: TASK_SELECT,
    orderBy: [{ plannedStartDate: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function getTask(
  taskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const task = await prisma.scheduleTask.findFirst({
    where: { id: taskId, projectId, siteId, companyId: actor.companyId },
    select: TASK_SELECT,
  });
  if (!task) throw new NotFoundError('Schedule task');
  return task;
}

export async function createTask(
  projectId: string,
  siteId: string,
  input: CreateTaskInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  await resolveContractorAccess(input.contractorId, actor);

  const contractor = await prisma.contractor.findFirst({
    where: { id: input.contractorId, companyId: actor.companyId, isActive: true },
    select: { id: true },
  });
  if (!contractor) throw new NotFoundError('Contractor');

  if (input.workPackageId) {
    const pkg = await prisma.workPackage.findFirst({
      where: { id: input.workPackageId, siteId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!pkg) throw new NotFoundError('Work package');
  }

  // Validate dependency task IDs
  const depIds = input.dependsOnTaskIds ?? [];
  if (depIds.length > 0) {
    const depTasks = await prisma.scheduleTask.findMany({
      where: { id: { in: depIds }, siteId, companyId: actor.companyId },
      select: { id: true },
    });
    if (depTasks.length !== depIds.length) throw new NotFoundError('Dependency task');
  }

  const task = await prisma.scheduleTask.create({
    data: {
      companyId:         actor.companyId,
      projectId,
      siteId,
      contractorId:      input.contractorId,
      workPackageId:     input.workPackageId   ?? null,
      title:             input.title,
      description:       input.description     ?? null,
      area:              input.area            ?? null,
      materialsRequired: input.materialsRequired ?? null,
      equipmentRequired: input.equipmentRequired ?? null,
      plannedStartDate:  input.plannedStartDate ? new Date(input.plannedStartDate) : null,
      plannedEndDate:    input.plannedEndDate   ? new Date(input.plannedEndDate)   : null,
      plannedProgress:   input.plannedProgress  ?? null,
      createdById:       actor.id,
    },
    select: TASK_SELECT,
  });

  // Create dependency rows
  if (depIds.length > 0) {
    await prisma.scheduleDependency.createMany({
      data: depIds.map((depId) => ({
        companyId:       actor.companyId,
        taskId:          task.id,
        dependsOnTaskId: depId,
      })),
    });
  }

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'schedule_task',
      entityId:     task.id,
      changesAfter: task as object,
    },
  });

  // Re-fetch with deps included
  return getTask(task.id, projectId, siteId, actor);
}

export async function updateTask(
  taskId: string,
  projectId: string,
  siteId: string,
  input: UpdateTaskInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.scheduleTask.findFirst({
    where: { id: taskId, projectId, siteId, companyId: actor.companyId },
    select: TASK_SELECT,
  });
  if (!before) throw new NotFoundError('Schedule task');

  // site_supervisor can only update progress/status/comments/delayReason
  if (actor.role === 'site_supervisor') {
    const allowedFields: (keyof UpdateTaskInput)[] = [
      'actualProgress', 'actualStartDate', 'actualEndDate',
      'status', 'delayReason', 'comments',
    ];
    const attempted = Object.keys(input) as (keyof UpdateTaskInput)[];
    const disallowed = attempted.filter((k) => !allowedFields.includes(k));
    if (disallowed.length > 0) {
      throw new ForbiddenError('Site supervisors can only update progress, status, and comments');
    }
  }

  if (input.workPackageId) {
    const pkg = await prisma.workPackage.findFirst({
      where: { id: input.workPackageId, siteId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!pkg) throw new NotFoundError('Work package');
  }

  const updated = await prisma.scheduleTask.update({
    where: { id: taskId },
    data: {
      ...(input.workPackageId    !== undefined && { workPackageId:    input.workPackageId }),
      ...(input.title            !== undefined && { title:            input.title }),
      ...(input.description      !== undefined && { description:      input.description }),
      ...(input.area             !== undefined && { area:             input.area }),
      ...(input.materialsRequired !== undefined && { materialsRequired: input.materialsRequired }),
      ...(input.equipmentRequired !== undefined && { equipmentRequired: input.equipmentRequired }),
      ...(input.plannedStartDate !== undefined && { plannedStartDate: input.plannedStartDate ? new Date(input.plannedStartDate) : null }),
      ...(input.plannedEndDate   !== undefined && { plannedEndDate:   input.plannedEndDate   ? new Date(input.plannedEndDate)   : null }),
      ...(input.actualStartDate  !== undefined && { actualStartDate:  input.actualStartDate  ? new Date(input.actualStartDate)  : null }),
      ...(input.actualEndDate    !== undefined && { actualEndDate:    input.actualEndDate    ? new Date(input.actualEndDate)    : null }),
      ...(input.plannedProgress  !== undefined && { plannedProgress:  input.plannedProgress }),
      ...(input.actualProgress   !== undefined && { actualProgress:   input.actualProgress }),
      ...(input.status           !== undefined && { status:           input.status }),
      ...(input.delayReason      !== undefined && { delayReason:      input.delayReason }),
      ...(input.comments         !== undefined && { comments:         input.comments }),
    },
    select: TASK_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'schedule_task',
      entityId:      taskId,
      changesBefore: before  as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteTask(
  taskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const task = await prisma.scheduleTask.findFirst({
    where: { id: taskId, projectId, siteId, companyId: actor.companyId },
    select: { id: true, title: true },
  });
  if (!task) throw new NotFoundError('Schedule task');

  await prisma.scheduleTask.delete({ where: { id: taskId } });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'schedule_task',
      entityId:      taskId,
      changesBefore: task as object,
    },
  });
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export async function addDependency(
  taskId: string,
  dependsOnTaskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  // Verify both tasks exist in the same site
  const [task, depTask] = await Promise.all([
    prisma.scheduleTask.findFirst({ where: { id: taskId,          siteId, companyId: actor.companyId }, select: { id: true } }),
    prisma.scheduleTask.findFirst({ where: { id: dependsOnTaskId, siteId, companyId: actor.companyId }, select: { id: true } }),
  ]);
  if (!task)    throw new NotFoundError('Schedule task');
  if (!depTask) throw new NotFoundError('Dependency task');
  if (taskId === dependsOnTaskId) throw new ForbiddenError('A task cannot depend on itself');

  return prisma.scheduleDependency.upsert({
    where:  { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    create: { companyId: actor.companyId, taskId, dependsOnTaskId },
    update: {},
  });
}

export async function removeDependency(
  taskId: string,
  dependsOnTaskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const dep = await prisma.scheduleDependency.findUnique({
    where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
  });
  if (!dep) throw new NotFoundError('Dependency');

  await prisma.scheduleDependency.delete({
    where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
  });
}

// ─── Milestones ───────────────────────────────────────────────────────────────

export async function listMilestones(
  taskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const task = await prisma.scheduleTask.findFirst({
    where: { id: taskId, projectId, siteId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError('Schedule task');

  return prisma.scheduleMilestone.findMany({
    where:   { taskId, companyId: actor.companyId },
    select:  MILESTONE_SELECT,
    orderBy: { plannedDate: 'asc' },
  });
}

export async function createMilestone(
  taskId: string,
  projectId: string,
  siteId: string,
  input: CreateMilestoneInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const task = await prisma.scheduleTask.findFirst({
    where: { id: taskId, projectId, siteId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError('Schedule task');

  const milestone = await prisma.scheduleMilestone.create({
    data: {
      companyId:   actor.companyId,
      projectId,
      siteId,
      taskId,
      name:        input.name,
      description: input.description ?? null,
      plannedDate: new Date(input.plannedDate),
    },
    select: MILESTONE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'schedule_milestone',
      entityId:     milestone.id,
      changesAfter: milestone as object,
    },
  });

  return milestone;
}

export async function updateMilestone(
  milestoneId: string,
  taskId: string,
  projectId: string,
  siteId: string,
  input: UpdateMilestoneInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.scheduleMilestone.findFirst({
    where: { id: milestoneId, taskId, companyId: actor.companyId },
    select: MILESTONE_SELECT,
  });
  if (!before) throw new NotFoundError('Milestone');

  const updated = await prisma.scheduleMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(input.name        !== undefined && { name:        input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.plannedDate !== undefined && { plannedDate: new Date(input.plannedDate) }),
      ...(input.actualDate  !== undefined && { actualDate:  input.actualDate ? new Date(input.actualDate) : null }),
      ...(input.status      !== undefined && { status:      input.status }),
    },
    select: MILESTONE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'schedule_milestone',
      entityId:      milestoneId,
      changesBefore: before  as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteMilestone(
  milestoneId: string,
  taskId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const milestone = await prisma.scheduleMilestone.findFirst({
    where: { id: milestoneId, taskId, companyId: actor.companyId },
    select: MILESTONE_SELECT,
  });
  if (!milestone) throw new NotFoundError('Milestone');

  await prisma.scheduleMilestone.delete({ where: { id: milestoneId } });
}

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

export async function listWeeklyPlans(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  contractorId?: string,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const where: Record<string, unknown> = { projectId, siteId, companyId: actor.companyId };

  if (contractorId) where['contractorId'] = contractorId;

  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    where['contractorId'] = ownContractor?.id ?? '__none__';
  }

  return prisma.weeklyPlan.findMany({
    where,
    select: WEEKLY_PLAN_SELECT,
    orderBy: { weekStartDate: 'desc' },
  });
}

export async function createWeeklyPlan(
  projectId: string,
  siteId: string,
  input: CreateWeeklyPlanInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  await resolveContractorAccess(input.contractorId, actor);

  const contractor = await prisma.contractor.findFirst({
    where: { id: input.contractorId, companyId: actor.companyId, isActive: true },
    select: { id: true },
  });
  if (!contractor) throw new NotFoundError('Contractor');

  // Normalise weekStartDate to Monday
  const weekStart = new Date(input.weekStartDate);

  const plan = await prisma.weeklyPlan.create({
    data: {
      companyId:    actor.companyId,
      projectId,
      siteId,
      contractorId: input.contractorId,
      weekStartDate: weekStart,
      notes:        input.notes ?? null,
      createdById:  actor.id,
      items: {
        create: input.items.map((item) => ({
          taskId:      item.taskId,
          plannedHours: item.plannedHours ?? null,
          notes:       item.notes ?? null,
        })),
      },
    },
    select: WEEKLY_PLAN_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'weekly_plan',
      entityId:     plan.id,
      changesAfter: plan as object,
    },
  });

  return plan;
}

export async function getWeeklyPlan(
  planId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const plan = await prisma.weeklyPlan.findFirst({
    where: { id: planId, projectId, siteId, companyId: actor.companyId },
    select: WEEKLY_PLAN_SELECT,
  });
  if (!plan) throw new NotFoundError('Weekly plan');
  return plan;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getScheduleSummary(
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const where: Record<string, unknown> = {
    projectId,
    siteId,
    companyId: actor.companyId,
  };

  if (actor.role === 'contractor') {
    const ownContractor = await prisma.contractor.findFirst({
      where: { userId: actor.id, companyId: actor.companyId },
      select: { id: true },
    });
    where['contractorId'] = ownContractor?.id ?? '__none__';
  }

  const [tasks, packages] = await Promise.all([
    prisma.scheduleTask.findMany({
      where,
      select: { status: true, actualProgress: true, plannedProgress: true },
    }),
    prisma.workPackage.findMany({
      where,
      select: { status: true },
    }),
  ]);

  const total         = tasks.length;
  const notStarted    = tasks.filter((t) => t.status === 'not_started').length;
  const inProgress    = tasks.filter((t) => t.status === 'in_progress').length;
  const delayed       = tasks.filter((t) => t.status === 'delayed').length;
  const blocked       = tasks.filter((t) => t.status === 'blocked').length;
  const completed     = tasks.filter((t) => t.status === 'completed').length;
  const withProgress  = tasks.filter((t) => t.actualProgress !== null);
  const avgProgress   = withProgress.length > 0
    ? Math.round(
        withProgress.reduce((sum, t) => sum + parseFloat(String(t.actualProgress)), 0)
        / withProgress.length,
      )
    : 0;

  return {
    tasks:    { total, notStarted, inProgress, delayed, blocked, completed, avgProgress },
    packages: { total: packages.length },
  };
}
