import { FastifyInstance } from 'fastify';
import { prisma } from '../../src/utils/prisma';
import { hashPassword } from '../../src/utils/hash';
import { UserRole } from '@prisma/client';

export interface TestCompany {
  id: string;
  name: string;
  slug: string;
}

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
  accessToken: string;
}

export interface TestProject {
  id: string;
  companyId: string;
  name: string;
}

export interface TestSite {
  id: string;
  projectId: string;
  companyId: string;
  name: string;
}

/**
 * Creates a company and a company_admin user for that company.
 * Returns both plus a JWT accessToken for the admin.
 */
export async function createTestCompany(
  app: FastifyInstance,
  slug: string,
): Promise<{ company: TestCompany; admin: TestUser }> {
  const company = await prisma.company.create({
    data: {
      name: `Test Company ${slug}`,
      slug,
      currency: 'USD',
    },
  });

  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email: `admin-${slug}@test.com`,
      passwordHash: await hashPassword('TestPass1'),
      firstName: 'Admin',
      lastName: slug,
      role: 'company_admin',
      canViewFinance: true,
    },
  });

  const accessToken = app.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    canViewFinance: user.canViewFinance,
  });

  return {
    company: { id: company.id, name: company.name, slug: company.slug },
    admin: {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      canViewFinance: user.canViewFinance,
      accessToken,
    },
  };
}

/**
 * Creates a user with the given role in the given company.
 * Returns user data plus a signed JWT accessToken.
 */
export async function createTestUser(
  app: FastifyInstance,
  companyId: string,
  role: UserRole,
  suffix: string,
  options: { canViewFinance?: boolean; siteId?: string } = {},
): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      companyId,
      email: `${role}-${suffix}@test.com`,
      passwordHash: await hashPassword('TestPass1'),
      firstName: role,
      lastName: suffix,
      role,
      canViewFinance: options.canViewFinance ?? false,
    },
  });

  const accessToken = app.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    canViewFinance: user.canViewFinance,
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    canViewFinance: user.canViewFinance,
    accessToken,
  };
}

/**
 * Creates a project in the given company.
 */
export async function createTestProject(
  companyId: string,
  name = 'Test Project',
): Promise<TestProject> {
  const project = await prisma.project.create({
    data: {
      companyId,
      name,
      status: 'active',
    },
  });
  return { id: project.id, companyId: project.companyId, name: project.name };
}

/**
 * Creates a job site in the given project.
 */
export async function createTestSite(
  companyId: string,
  projectId: string,
  name = 'Test Site',
): Promise<TestSite> {
  const site = await prisma.jobSite.create({
    data: {
      companyId,
      projectId,
      name,
    },
  });
  return { id: site.id, projectId: site.projectId, companyId: site.companyId, name: site.name };
}

/**
 * Assigns a user to a project (creates project_member row).
 */
export async function assignUserToProject(
  companyId: string,
  projectId: string,
  userId: string,
  siteId?: string,
): Promise<void> {
  await prisma.projectMember.create({
    data: {
      companyId,
      projectId,
      userId,
      siteId: siteId ?? null,
    },
  });
}

export interface TestSupplier {
  id: string;
  companyId: string;
  name: string;
}

/**
 * Creates a supplier in the given company.
 */
export async function createTestSupplier(
  companyId: string,
  overrides: Partial<{
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
  }> = {},
): Promise<TestSupplier> {
  const supplier = await prisma.supplier.create({
    data: {
      companyId,
      name:          overrides.name          ?? 'Test Supplier Ltd',
      contactPerson: overrides.contactPerson ?? 'Test Contact',
      email:         overrides.email         ?? null,
      phone:         overrides.phone         ?? null,
    },
  });
  return { id: supplier.id, companyId: supplier.companyId, name: supplier.name };
}

export interface TestWorker {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
}

export interface TestLabourEntry {
  id: string;
  companyId: string;
  projectId: string;
  siteId: string;
  workerId: string;
}

/**
 * Creates a worker in the given company.
 */
export async function createTestWorker(
  companyId: string,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    trade: string;
    dailyWage: number;
    isActive: boolean;
  }> = {},
): Promise<TestWorker> {
  const worker = await prisma.worker.create({
    data: {
      companyId,
      firstName: overrides.firstName ?? 'Test',
      lastName:  overrides.lastName  ?? 'Worker',
      trade:     overrides.trade,
      dailyWage: overrides.dailyWage ?? 1500,
      currency:  'USD',
      isActive:  overrides.isActive  ?? true,
      employmentStatus: 'active',
    },
  });
  return { id: worker.id, companyId: worker.companyId, firstName: worker.firstName, lastName: worker.lastName };
}

/**
 * Assigns a worker to a project site.
 */
export async function assignWorkerToSite(
  companyId: string,
  projectId: string,
  siteId: string,
  workerId: string,
  assignedById: string,
): Promise<void> {
  await prisma.workerAssignment.create({
    data: { companyId, projectId, siteId, workerId, assignedById },
  });
}

/**
 * Creates a labour entry for the given worker/site.
 */
export async function createTestLabourEntry(
  companyId: string,
  projectId: string,
  siteId: string,
  workerId: string,
  registeredById: string,
  overrides: Partial<{ date: Date; hoursWorked: number; dailyRate: number }> = {},
): Promise<TestLabourEntry> {
  const entry = await prisma.labourEntry.create({
    data: {
      companyId,
      projectId,
      siteId,
      workerId,
      registeredById,
      date:        overrides.date        ?? new Date('2026-04-07'),
      hoursWorked: overrides.hoursWorked ?? 8,
      dailyRate:   overrides.dailyRate   ?? 1500,
      currency:    'USD',
    },
  });
  return { id: entry.id, companyId, projectId, siteId, workerId };
}

export interface TestAttendanceRecord {
  id: string;
  companyId: string;
  projectId: string;
  siteId: string;
  workerId: string;
}

export interface TestDailyTarget {
  id: string;
  companyId: string;
  projectId: string;
  siteId: string;
}

/**
 * Creates an attendance record.
 */
export async function createTestAttendanceRecord(
  companyId: string,
  projectId: string,
  siteId: string,
  workerId: string,
  recordedById: string,
  overrides: Partial<{
    date: Date;
    status: import('@prisma/client').AttendanceStatus;
    checkInTime: string;
    checkOutTime: string;
    notes: string;
  }> = {},
): Promise<TestAttendanceRecord> {
  const record = await prisma.attendanceRecord.create({
    data: {
      companyId,
      projectId,
      siteId,
      workerId,
      recordedById,
      date:   overrides.date   ?? new Date('2026-04-07'),
      status: overrides.status ?? 'present',
      checkInTime:  overrides.checkInTime  ?? null,
      checkOutTime: overrides.checkOutTime ?? null,
      notes:        overrides.notes        ?? null,
    },
  });
  return { id: record.id, companyId, projectId, siteId, workerId };
}

/**
 * Creates a daily target.
 */
export async function createTestTarget(
  companyId: string,
  projectId: string,
  siteId: string,
  setById: string,
  overrides: Partial<{
    date: Date;
    description: string;
    targetValue: number;
    targetUnit: string;
    actualValue: number;
    workerId: string;
    notes: string;
  }> = {},
): Promise<TestDailyTarget> {
  const target = await prisma.dailyTarget.create({
    data: {
      companyId,
      projectId,
      siteId,
      setById,
      date:        overrides.date        ?? new Date('2026-04-07'),
      description: overrides.description ?? 'Test target',
      targetValue: overrides.targetValue ?? 50,
      targetUnit:  overrides.targetUnit  ?? 'm³',
      actualValue: overrides.actualValue ?? null,
      workerId:    overrides.workerId    ?? null,
      notes:       overrides.notes       ?? null,
    },
  });
  return { id: target.id, companyId, projectId, siteId };
}

export interface TestDelivery {
  id: string;
  projectId: string;
  siteId: string;
  companyId: string;
}

/**
 * Creates a delivery record for testing.
 */
export async function createTestDelivery(
  companyId: string,
  projectId: string,
  siteId: string,
  receivedById: string,
  overrides: Partial<{
    supplierName: string;
    itemDescription: string;
    deliveryDate: Date;
  }> = {},
): Promise<TestDelivery> {
  const record = await prisma.deliveryRecord.create({
    data: {
      companyId,
      projectId,
      siteId,
      supplierName: overrides.supplierName ?? 'Test Supplier Ltd',
      deliveryDate: overrides.deliveryDate ?? new Date('2026-04-01'),
      itemDescription: overrides.itemDescription ?? 'Portland Cement 50kg bags',
      unitOfMeasure: 'bags',
      quantityOrdered: 100,
      quantityDelivered: 100,
      conditionOnArrival: 'good',
      inspectionStatus: 'pending',
      acceptanceStatus: 'accepted',
      receivedById,
    },
  });
  return { id: record.id, projectId, siteId, companyId };
}

/**
 * Creates a contractor in the given company.
 */
export async function createTestContractor(
  companyId: string,
  name = 'Test Contractor',
  userId?: string,
): Promise<{ id: string; companyId: string; name: string }> {
  const contractor = await prisma.contractor.create({
    data: {
      companyId,
      userId:              userId ?? null,
      name,
      tradeSpecialization: 'General',
    },
  });
  return { id: contractor.id, companyId: contractor.companyId, name: contractor.name };
}

/**
 * Creates a work package on a site.
 */
export async function createTestWorkPackage(
  companyId: string,
  projectId: string,
  siteId: string,
  contractorId: string,
  createdById: string,
  name = 'Test Work Package',
): Promise<{ id: string; companyId: string; projectId: string; siteId: string }> {
  const pkg = await prisma.workPackage.create({
    data: {
      companyId,
      projectId,
      siteId,
      contractorId,
      name,
      status: 'not_started',
      createdById,
    },
  });
  return { id: pkg.id, companyId: pkg.companyId, projectId: pkg.projectId, siteId: pkg.siteId };
}

/**
 * Creates a schedule task on a site.
 */
export async function createTestScheduleTask(
  companyId: string,
  projectId: string,
  siteId: string,
  contractorId: string,
  createdById: string,
  workPackageId?: string,
  title = 'Test Task',
): Promise<{ id: string; companyId: string; projectId: string; siteId: string; title: string }> {
  const task = await prisma.scheduleTask.create({
    data: {
      companyId,
      projectId,
      siteId,
      contractorId,
      workPackageId: workPackageId ?? null,
      title,
      status: 'not_started',
      createdById,
    },
  });
  return { id: task.id, companyId: task.companyId, projectId: task.projectId, siteId: task.siteId, title: task.title };
}

/**
 * Clears all test data in FK-safe order.
 */
/**
 * Delete order must respect FK constraints: children before parents.
 *
 * Dependency chain (child → parent):
 *   auditLog          → company, user
 *   notification      → company, user
 *   deliveryPhoto     → deliveryRecord
 *   deliveryDocument  → deliveryRecord
 *   deliveryRecord    → project, jobSite, user, budgetLineItem, invoice
 *   invoiceLineItem   → invoice
 *   invoice           → company, project, contractor, budgetLineItem
 *   marketingBudget   → budgetLineItem
 *   consultantCost    → budgetLineItem
 *   budgetLineItem    → budget
 *   variationOrder    → budget, project
 *   budget            → company, project
 *   drawingRevision   → drawing, user
 *   drawing           → company, project
 *   consultantAssign  → company, project, user
 *   financeInflow     → company, project, user   ← must be before project
 *   contractorMilest  → contractorSchedule
 *   contractorSchedule→ company, project, contractor
 *   contractor        → company
 *   dailyTarget       → company, project, jobSite, user
 *   attendanceRecord  → company, project, jobSite, worker
 *   labourEntry       → company, project, jobSite, worker, user
 *   worker            → company
 *   projectMember     → company, project, user, jobSite
 *   jobSite           → company, project
 *   project           → company
 *   pushToken         → user, company
 *   refreshToken      → user
 *   user              → company
 *   company           → (root)
 */
export async function clearDatabase(): Promise<void> {
  // Leaf-level dependents first
  await prisma.auditLog.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.notification.deleteMany();
  // Delivery children before delivery records; delivery records before invoice/budgetLineItem
  await prisma.deliveryPhoto.deleteMany();
  await prisma.deliveryDocument.deleteMany();
  await prisma.deliveryRecord.deleteMany();
  await prisma.invoicePayment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.marketingBudgetEntry.deleteMany();
  await prisma.consultantCostEntry.deleteMany();
  await prisma.budgetLineItem.deleteMany();
  await prisma.variationOrder.deleteMany();
  await prisma.budget.deleteMany();
  // Drawings & instructions
  await prisma.instructionAttachment.deleteMany();
  await prisma.consultantInstruction.deleteMany();
  await prisma.drawingComment.deleteMany();
  await prisma.drawingRevision.deleteMany();
  await prisma.drawing.deleteMany();
  await prisma.consultantAssignment.deleteMany();
  await prisma.financeInflow.deleteMany();           // references project — must be before project
  await prisma.weeklyPlanItem.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.scheduleDependency.deleteMany();
  await prisma.scheduleMilestone.deleteMany();
  await prisma.scheduleTask.deleteMany();
  await prisma.workPackage.deleteMany();
  await prisma.contractorMilestone.deleteMany();
  await prisma.contractorSchedule.deleteMany();
  await prisma.contractor.deleteMany();
  await prisma.dailyTarget.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.labourEntry.deleteMany();
  await prisma.workerAssignment.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.jobSite.deleteMany();
  await prisma.project.deleteMany();                 // now safe — no children remaining
  await prisma.pushToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();                 // now safe — no children remaining
}

// ─── Drawing fixtures ─────────────────────────────────────────────────────────

export interface TestDrawing {
  id:        string;
  companyId: string;
  projectId: string;
}

export interface TestDrawingRevision {
  id:       string;
  drawingId: string;
  companyId: string;
}

export async function createTestDrawing(
  companyId: string,
  projectId: string,
  createdById: string,
  overrides: Partial<{ drawingNumber: string; title: string; discipline: string; siteId: string }> = {},
): Promise<TestDrawing> {
  const drawing = await prisma.drawing.create({
    data: {
      companyId,
      projectId,
      siteId:       overrides.siteId       ?? null,
      drawingNumber: overrides.drawingNumber ?? `DWG-${Date.now()}`,
      title:        overrides.title         ?? 'Test Drawing',
      discipline:   overrides.discipline    ?? null,
      createdById,
    },
  });
  return { id: drawing.id, companyId: drawing.companyId, projectId: drawing.projectId };
}

export async function createTestRevision(
  drawingId: string,
  companyId: string,
  uploadedById: string,
  overrides: Partial<{ revisionNumber: string; status: import('@prisma/client').DrawingStatus }> = {},
): Promise<TestDrawingRevision> {
  const revision = await prisma.drawingRevision.create({
    data: {
      drawingId,
      companyId,
      revisionNumber: overrides.revisionNumber ?? 'A',
      fileUrl:        '/uploads/drawings/test.pdf',
      fileKey:        `drawings/test-${Date.now()}.pdf`,
      fileName:       'test.pdf',
      fileSizeBytes:  1024,
      fileType:       'application/pdf',
      status:         overrides.status ?? 'draft',
      uploadedById,
    },
  });
  return { id: revision.id, drawingId: revision.drawingId, companyId: revision.companyId };
}

// ─── Budget fixtures ──────────────────────────────────────────────────────────

export interface TestBudget {
  id:        string;
  companyId: string;
  projectId: string;
}

export interface TestLineItem {
  id:       string;
  budgetId: string;
  companyId: string;
}

export async function createTestBudget(
  companyId: string,
  projectId: string,
  overrides: Partial<{
    name: string;
    status: import('@prisma/client').BudgetStatus;
    currency: string;
    createdById: string;
  }> = {},
): Promise<TestBudget> {
  const budget = await prisma.budget.create({
    data: {
      companyId,
      projectId,
      name:     overrides.name     ?? 'Test Budget',
      status:   overrides.status   ?? 'draft',
      currency: overrides.currency ?? 'USD',
      createdById: overrides.createdById ?? null,
    },
  });
  return { id: budget.id, companyId: budget.companyId, projectId: budget.projectId };
}

export async function createTestLineItem(
  budgetId: string,
  companyId: string,
  projectId: string,
  overrides: Partial<{
    category: import('@prisma/client').BudgetCategory;
    description: string;
    budgetedAmount: number;
    committedAmount: number;
    actualSpend: number;
  }> = {},
): Promise<TestLineItem> {
  const item = await prisma.budgetLineItem.create({
    data: {
      budgetId,
      companyId,
      projectId,
      category:        overrides.category        ?? 'labour',
      description:     overrides.description     ?? 'Test line item',
      budgetedAmount:  overrides.budgetedAmount  ?? 10000,
      committedAmount: overrides.committedAmount ?? 0,
      actualSpend:     overrides.actualSpend     ?? 0,
      currency:        'USD',
    },
  });
  return { id: item.id, budgetId: item.budgetId, companyId: item.companyId };
}

export async function createTestInstruction(
  companyId: string,
  projectId: string,
  issuedById: string,
  overrides: Partial<{
    type: import('@prisma/client').InstructionType;
    title: string;
    priority: import('@prisma/client').InstructionPriority;
    status: import('@prisma/client').InstructionStatus;
    contractorId: string;
    siteId: string;
  }> = {},
): Promise<{ id: string; companyId: string; projectId: string }> {
  const instr = await prisma.consultantInstruction.create({
    data: {
      companyId,
      projectId,
      issuedById,
      type:        overrides.type        ?? 'instruction',
      title:       overrides.title       ?? 'Test Instruction',
      priority:    overrides.priority    ?? 'medium',
      status:      overrides.status      ?? 'open',
      issuedDate:  new Date('2026-04-09'),
      siteId:      overrides.siteId      ?? null,
      contractorId: overrides.contractorId ?? null,
    },
  });
  return { id: instr.id, companyId: instr.companyId, projectId: instr.projectId };
}

// ─── Notification fixtures ────────────────────────────────────────────────────

export interface TestNotification {
  id:        string;
  companyId: string;
  userId:    string;
}

export async function createTestNotification(
  companyId: string,
  userId: string,
  overrides: Partial<{
    type:       string;
    title:      string;
    body:       string;
    entityType: string;
    entityId:   string;
    isRead:     boolean;
  }> = {},
): Promise<TestNotification> {
  const notification = await prisma.notification.create({
    data: {
      companyId,
      userId,
      type:       overrides.type       ?? 'system',
      title:      overrides.title      ?? 'Test Notification',
      body:       overrides.body       ?? 'This is a test notification.',
      entityType: overrides.entityType ?? null,
      entityId:   overrides.entityId   ?? null,
      isRead:     overrides.isRead     ?? false,
    },
  });
  return { id: notification.id, companyId: notification.companyId, userId: notification.userId };
}

// ─── Invoice fixtures ──────────────────────────────────────────────────────────

export interface TestInvoice {
  id:        string;
  companyId: string;
  projectId: string;
}

export async function createTestInvoice(
  companyId: string,
  projectId: string,
  overrides: Partial<{
    invoiceNumber:     string;
    vendorType:        import('@prisma/client').InvoiceVendorType;
    vendorName:        string;
    subtotal:          number;
    taxAmount:         number;
    totalAmount:       number;
    status:            import('@prisma/client').InvoiceStatus;
    currency:          string;
    issueDate:         Date;
    dueDate:           Date;
    contractorId:      string;
    supplierId:        string;
    consultantUserId:  string;
    budgetLineItemId:  string;
    createdById:       string;
  }> = {},
): Promise<TestInvoice> {
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      projectId,
      invoiceNumber:  overrides.invoiceNumber  ?? `INV-${Date.now()}`,
      vendorType:     overrides.vendorType     ?? 'contractor',
      vendorName:     overrides.vendorName     ?? 'Test Vendor Ltd',
      subtotal:       overrides.subtotal       ?? 10000,
      taxAmount:      overrides.taxAmount      ?? 0,
      totalAmount:    overrides.totalAmount    ?? overrides.subtotal ?? 10000,
      paidAmount:     0,
      currency:       overrides.currency       ?? 'USD',
      issueDate:      overrides.issueDate      ?? new Date('2026-04-01'),
      dueDate:        overrides.dueDate        ?? new Date('2026-04-30'),
      status:         overrides.status         ?? 'draft',
      contractorId:   overrides.contractorId   ?? null,
      supplierId:     overrides.supplierId     ?? null,
      consultantUserId: overrides.consultantUserId ?? null,
      budgetLineItemId: overrides.budgetLineItemId ?? null,
      createdById:    overrides.createdById    ?? null,
    },
  });
  return { id: invoice.id, companyId: invoice.companyId, projectId: invoice.projectId };
}
