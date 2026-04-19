export type UserRole =
  | 'super_admin'
  | 'company_admin'
  | 'finance_officer'
  | 'project_manager'
  | 'site_supervisor'
  | 'contractor'
  | 'consultant'
  | 'worker'
  | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  currency: string;
  timezone: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  description: string | null;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  createdAt: string;
  _count?: { jobSites: number; projectMembers: number };
}

export interface JobSite {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  isActive: boolean;
  createdAt: string;
}

export type DeliveryCondition = 'good' | 'damaged' | 'partial' | 'incorrect';
export type InspectionStatus = 'pending' | 'passed' | 'failed' | 'waived';
export type AcceptanceStatus = 'accepted' | 'partially_accepted' | 'rejected';

export interface DeliveryRecord {
  id: string;
  companyId: string;
  projectId: string;
  siteId: string;
  supplierName: string;
  supplierContact: string | null;
  deliveryDate: string;
  deliveryTime: string | null;
  driverName: string | null;
  vehicleRegistration: string | null;
  purchaseOrderNumber: string | null;
  deliveryNoteNumber: string | null;
  invoiceNumber: string | null;
  itemDescription: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  quantityDelivered: number;
  conditionOnArrival: DeliveryCondition;
  inspectionStatus: InspectionStatus;
  acceptanceStatus: AcceptanceStatus;
  rejectionReason: string | null;
  discrepancyNotes: string | null;
  receivedById: string;
  budgetLineItemId: string | null;
  supplierInvoiceId: string | null;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  receivedBy: { id: string; firstName: string; lastName: string; email: string };
  photos: DeliveryPhoto[];
  documents: DeliveryDocument[];
}

export interface DeliveryPhoto {
  id: string;
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

export interface DeliveryDocument {
  id: string;
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
  uploadedById: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  companyId: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkerEmploymentStatus = 'active' | 'inactive' | 'suspended';

export interface Worker {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  idNumber: string | null;
  trade: string | null;
  dailyWage: string | null;  // Prisma Decimal → string
  currency: string;
  employmentStatus: WorkerEmploymentStatus;
  isActive: boolean;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  assignments?: {
    id: string;
    projectId: string;
    siteId: string;
    assignedAt: string;
    project: { id: string; name: string };
    site: { id: string; name: string };
  }[];
}

export interface LabourEntry {
  id: string;
  companyId: string;
  projectId: string;
  siteId: string;
  workerId: string;
  registeredById: string;
  date: string;
  hoursWorked: string;  // Prisma Decimal → string
  dailyRate: string;    // Prisma Decimal → string
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  worker: { id: string; firstName: string; lastName: string; trade: string | null };
  registeredBy: { id: string; firstName: string; lastName: string };
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'excused';

export interface AttendanceRecord {
  id:           string;
  companyId:    string;
  projectId:    string;
  siteId:       string;
  workerId:     string;
  date:         string;
  status:       AttendanceStatus;
  checkInTime:  string | null;
  checkOutTime: string | null;
  notes:        string | null;
  recordedById: string;
  createdAt:    string;
  updatedAt:    string;
  worker:       { id: string; firstName: string; lastName: string; trade: string | null };
  recordedBy:   { id: string; firstName: string; lastName: string };
}

export interface AttendanceSummary {
  total:    number;
  present:  number;
  absent:   number;
  late:     number;
  half_day: number;
  excused:  number;
}

export interface DailyTarget {
  id:            string;
  companyId:     string;
  projectId:     string;
  siteId:        string;
  workerId:      string | null;
  date:          string;
  description:   string;
  targetValue:   string;   // Prisma Decimal → string
  targetUnit:    string;
  actualValue:   string | null;
  notes:         string | null;
  setById:       string;
  approvedById:  string | null;
  approvedAt:    string | null;
  completionPct: number | null;
  createdAt:     string;
  updatedAt:     string;
  setBy:         { id: string; firstName: string; lastName: string };
  approvedBy:    { id: string; firstName: string; lastName: string } | null;
  worker:        { id: string; firstName: string; lastName: string; trade: string | null } | null;
}

export interface TargetSummary {
  total:         number;
  approved:      number;
  withActual:    number;
  avgCompletion: number;
}

export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, string[]>;
}

// ─── Contractor & Schedule ────────────────────────────────────────────────────

export interface Contractor {
  id:                  string;
  companyId:           string;
  userId:              string | null;
  name:                string;
  contactPerson:       string | null;
  email:               string | null;
  phone:               string | null;
  registrationNumber:  string | null;
  tradeSpecialization: string | null;
  isActive:            boolean;
  createdAt:           string;
  updatedAt:           string;
}

export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'delayed' | 'blocked' | 'completed';
export type MilestoneStatus    = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface WorkPackage {
  id:           string;
  companyId:    string;
  projectId:    string;
  siteId:       string;
  contractorId: string;
  name:         string;
  description:  string | null;
  area:         string | null;
  startDate:    string | null;
  endDate:      string | null;
  status:       ScheduleTaskStatus;
  createdById:  string;
  createdAt:    string;
  updatedAt:    string;
  contractor:   { id: string; name: string; tradeSpecialization: string | null };
  createdBy:    { id: string; firstName: string; lastName: string };
}

export interface ScheduleMilestone {
  id:          string;
  companyId:   string;
  projectId:   string;
  siteId:      string;
  taskId:      string;
  name:        string;
  description: string | null;
  plannedDate: string;
  actualDate:  string | null;
  status:      MilestoneStatus;
  createdAt:   string;
  updatedAt:   string;
}

export interface ScheduleTask {
  id:                string;
  companyId:         string;
  projectId:         string;
  siteId:            string;
  contractorId:      string;
  workPackageId:     string | null;
  title:             string;
  description:       string | null;
  area:              string | null;
  materialsRequired: string | null;
  equipmentRequired: string | null;
  plannedStartDate:  string | null;
  plannedEndDate:    string | null;
  actualStartDate:   string | null;
  actualEndDate:     string | null;
  plannedProgress:   string | null;
  actualProgress:    string | null;
  status:            ScheduleTaskStatus;
  delayReason:       string | null;
  comments:          string | null;
  createdById:       string;
  createdAt:         string;
  updatedAt:         string;
  contractor:        { id: string; name: string; tradeSpecialization: string | null };
  workPackage:       { id: string; name: string; area: string | null } | null;
  createdBy:         { id: string; firstName: string; lastName: string };
  milestones:        ScheduleMilestone[];
  outgoingDeps:      Array<{ dependsOnTask: { id: string; title: string; status: ScheduleTaskStatus } }>;
  incomingDeps:      Array<{ task:          { id: string; title: string; status: ScheduleTaskStatus } }>;
}

export interface WeeklyPlanItem {
  id:          string;
  plannedHours: string | null;
  notes:       string | null;
  task:        { id: string; title: string; status: ScheduleTaskStatus; area: string | null };
}

export interface WeeklyPlan {
  id:            string;
  companyId:     string;
  projectId:     string;
  siteId:        string;
  contractorId:  string;
  weekStartDate: string;
  notes:         string | null;
  createdById:   string;
  createdAt:     string;
  updatedAt:     string;
  contractor:    { id: string; name: string };
  createdBy:     { id: string; firstName: string; lastName: string };
  items:         WeeklyPlanItem[];
}

export interface ScheduleSummary {
  tasks: {
    total:      number;
    notStarted: number;
    inProgress: number;
    delayed:    number;
    blocked:    number;
    completed:  number;
    avgProgress: number;
  };
  packages: {
    total: number;
  };
}

// ─── Drawings ─────────────────────────────────────────────────────────────────

export type DrawingStatus =
  | 'draft'
  | 'issued_for_review'
  | 'issued_for_construction'
  | 'superseded'
  | 'archived';

export interface DrawingRevision {
  id:             string;
  drawingId:      string;
  companyId:      string;
  revisionNumber: string;
  fileUrl:        string;
  fileName:       string;
  fileSizeBytes:  number;
  fileType:       string;
  status:         DrawingStatus;
  issueDate:      string | null;
  uploadedById:   string;
  approvedById:   string | null;
  approvedAt:     string | null;
  notes:          string | null;
  createdAt:      string;
  updatedAt:      string;
  uploadedBy:     { id: string; firstName: string; lastName: string };
  approvedBy:     { id: string; firstName: string; lastName: string } | null;
}

export interface DrawingComment {
  id:         string;
  companyId:  string;
  drawingId:  string;
  revisionId: string;
  userId:     string;
  text:       string;
  createdAt:  string;
  updatedAt:  string;
  user:       { id: string; firstName: string; lastName: string; role: string };
}

export interface Drawing {
  id:                string;
  companyId:         string;
  projectId:         string;
  siteId:            string | null;
  drawingNumber:     string;
  title:             string;
  discipline:        string | null;
  currentRevisionId: string | null;
  createdById:       string;
  createdAt:         string;
  updatedAt:         string;
  site:              { id: string; name: string } | null;
  createdBy:         { id: string; firstName: string; lastName: string };
  revisions:         DrawingRevision[];
}

// ─── Consultant Instructions ──────────────────────────────────────────────────

export type InstructionStatus   = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
export type InstructionPriority = 'low' | 'medium' | 'high' | 'critical';
export type InstructionType     = 'instruction' | 'recommendation';

export interface InstructionAttachment {
  id:            string;
  fileUrl:       string;
  fileName:      string;
  fileSizeBytes: number;
  fileType:      string;
  createdAt:     string;
}

export interface ConsultantInstruction {
  id:                 string;
  companyId:          string;
  projectId:          string;
  siteId:             string | null;
  contractorId:       string | null;
  issuedById:         string;
  type:               InstructionType;
  title:              string;
  category:           string | null;
  priority:           InstructionPriority;
  status:             InstructionStatus;
  description:        string | null;
  issuedDate:         string;
  targetActionDate:   string | null;
  drawingId:          string | null;
  revisionId:         string | null;
  milestoneId:        string | null;
  workPackageId:      string | null;
  contractorResponse: string | null;
  resolutionNotes:    string | null;
  createdAt:          string;
  updatedAt:          string;
  issuedBy:    { id: string; firstName: string; lastName: string; role: string };
  site:        { id: string; name: string } | null;
  contractor:  { id: string; name: string } | null;
  drawing:     { id: string; drawingNumber: string; title: string } | null;
  revision:    { id: string; revisionNumber: string; status: DrawingStatus } | null;
  milestone:   { id: string; name: string; status: string } | null;
  workPackage: { id: string; name: string } | null;
  attachments: InstructionAttachment[];
}

// ─── Budget & Cost Control ────────────────────────────────────────────────────

export type BudgetStatus   = 'draft' | 'approved' | 'locked';
export type BudgetCategory =
  | 'labour'
  | 'materials'
  | 'equipment'
  | 'subcontractors'
  | 'consultants'
  | 'marketing'
  | 'overheads'
  | 'permits_statutory'
  | 'variations'
  | 'contingency';
export type VariationDirection = 'addition' | 'omission';
export type VariationStatus    = 'pending' | 'approved' | 'rejected';

export interface ConsultantCostEntry {
  id:             string;
  consultantType: string;
  consultantName: string;
  firmName:       string | null;
  feeAgreed:      string;   // Decimal → string
  feePaid:        string;
  feeOutstanding: string;
  currency:       string;
}

export interface MarketingBudgetEntry {
  id:             string;
  campaignName:   string;
  channel:        string;
  vendorAgency:   string | null;
  budgetedAmount: string;
  actualSpend:    string;
  paidAmount:     string;
  expectedRoi:    string | null;
  notes:          string | null;
}

export interface BudgetLineItem {
  id:              string;
  budgetId:        string;
  companyId:       string;
  projectId:       string;
  category:        BudgetCategory;
  description:     string;
  quantity:        string | null;
  unit:            string | null;
  unitRate:        string | null;
  budgetedAmount:  string;
  committedAmount: string;
  actualSpend:     string;
  currency:        string;
  notes:           string | null;
  createdAt:       string;
  updatedAt:       string;
  consultantCostEntry:  ConsultantCostEntry | null;
  marketingBudgetEntry: MarketingBudgetEntry | null;
}

export interface VariationOrder {
  id:              string;
  budgetId:        string;
  referenceNumber: string;
  description:     string;
  amount:          string;
  direction:       VariationDirection;
  status:          VariationStatus;
  requestedById:   string;
  approvedById:    string | null;
  approvedAt:      string | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface Budget {
  id:           string;
  companyId:    string;
  projectId:    string;
  name:         string;
  currency:     string;
  notes:        string | null;
  status:       BudgetStatus;
  createdById:  string | null;
  approvedById: string | null;
  approvedAt:   string | null;
  createdAt:    string;
  updatedAt:    string;
  project:      { id: string; name: string; code: string | null };
  createdBy:    { id: string; firstName: string; lastName: string } | null;
  approvedBy:   { id: string; firstName: string; lastName: string } | null;
  lineItems:    BudgetLineItem[];
  variationOrders: VariationOrder[];
}

export interface BudgetListItem {
  id:          string;
  companyId:   string;
  projectId:   string;
  name:        string;
  currency:    string;
  status:      BudgetStatus;
  approvedAt:  string | null;
  createdAt:   string;
  updatedAt:   string;
  project:     { id: string; name: string; code: string | null };
  createdBy:   { id: string; firstName: string; lastName: string } | null;
  approvedBy:  { id: string; firstName: string; lastName: string } | null;
  lineItems:   Array<{
    id:              string;
    category:        BudgetCategory;
    budgetedAmount:  string;
    committedAmount: string;
    actualSpend:     string;
  }>;
}

export interface BudgetSummary {
  totalBudgeted:   number;
  totalCommitted:  number;
  totalSpent:      number;
  totalRemaining:  number;
  variance:        number;
  overspend:       boolean;
  variationImpact: number;
  adjustedBudget:  number;
  categories: Record<string, { budgeted: number; committed: number; spent: number }>;
}

// ─── Invoicing & Payments ──────────────────────────────────────────────────────

export type InvoiceStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'disputed'
  | 'cancelled';

export type InvoiceVendorType =
  | 'contractor'
  | 'consultant'
  | 'supplier'
  | 'marketing'
  | 'internal'
  | 'other';

export interface InvoicePayment {
  id:          string;
  invoiceId:   string;
  companyId:   string;
  amount:      string;   // Decimal → string
  currency:    string;
  paymentDate: string;
  method:      string;
  reference:   string | null;
  notes:       string | null;
  recordedById: string;
  createdAt:   string;
  recordedBy:  { id: string; firstName: string; lastName: string };
}

export interface InvoiceLineItem {
  id:          string;
  invoiceId:   string;
  companyId:   string;
  description: string;
  quantity:    string;   // Decimal → string
  unitRate:    string;
  amount:      string;
  notes:       string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface Invoice {
  id:                     string;
  companyId:              string;
  projectId:              string;
  siteId:                 string | null;
  invoiceNumber:          string;
  vendorType:             InvoiceVendorType;
  contractorId:           string | null;
  supplierId:             string | null;
  consultantUserId:       string | null;
  vendorName:             string;
  budgetLineItemId:       string | null;
  variationOrderId:       string | null;
  deliveryRecordId:       string | null;
  labourEntryId:          string | null;
  marketingBudgetEntryId: string | null;
  consultantCostEntryId:  string | null;
  subtotal:               string;
  taxAmount:              string;
  totalAmount:            string;
  paidAmount:             string;
  currency:               string;
  issueDate:              string;
  dueDate:                string;
  status:                 InvoiceStatus;
  approvedById:           string | null;
  approvedAt:             string | null;
  paidAt:                 string | null;
  notes:                  string | null;
  createdById:            string | null;
  createdAt:              string;
  updatedAt:              string;
  project:         { id: string; name: string; code: string | null };
  site:            { id: string; name: string } | null;
  contractor:      { id: string; name: string; tradeSpecialization: string | null } | null;
  supplier:        { id: string; name: string; contactPerson: string | null } | null;
  consultantUser:  { id: string; firstName: string; lastName: string; consultantType: string | null } | null;
  createdBy:       { id: string; firstName: string; lastName: string } | null;
  approvedBy:      { id: string; firstName: string; lastName: string } | null;
  budgetLineItem:  { id: string; category: string; description: string } | null;
  variationOrder:  { id: string; referenceNumber: string; description: string; amount: string } | null;
  deliveryRecord:  { id: string; deliveryNoteNumber: string | null; itemDescription: string; deliveryDate: string } | null;
  labourEntry:     { id: string; date: string; hoursWorked: string; currency: string; worker: { id: string; firstName: string; lastName: string } } | null;
  marketingBudgetEntry: { id: string; campaignName: string; channel: string; vendorAgency: string | null } | null;
  consultantCostEntry:  { id: string; consultantName: string; consultantType: string; feeAgreed: string } | null;
  lineItems:       InvoiceLineItem[];
  payments:        InvoicePayment[];
}

export interface InvoiceListItem {
  id:            string;
  companyId:     string;
  projectId:     string;
  invoiceNumber: string;
  vendorType:    InvoiceVendorType;
  vendorName:    string;
  totalAmount:   string;
  paidAmount:    string;
  currency:      string;
  issueDate:     string;
  dueDate:       string;
  status:        InvoiceStatus;
  createdAt:     string;
  project:       { id: string; name: string; code: string | null };
  site:          { id: string; name: string } | null;
  contractor:    { id: string; name: string } | null;
  supplier:      { id: string; name: string } | null;
  payments:      Array<{ amount: string }>;
  _count:        { lineItems: number };
}

export interface InvoiceSummary {
  totalCount:       number;
  totalValue:       number;
  totalPaid:        number;
  totalOutstanding: number;
  overdueCount:     number;
  overdueValue:     number;
  byStatus:         Record<string, { count: number; value: number }>;
  byVendorType:     Record<string, { count: number; value: number }>;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  | 'instruction_created'
  | 'instruction_updated'
  | 'budget_approved'
  | 'invoice_status_changed'
  | 'delivery_received'
  | 'drawing_approved'
  | 'system';

export interface Notification {
  id:         string;
  companyId:  string;
  userId:     string;
  type:       string;
  title:      string;
  body:       string;
  entityType: string | null;
  entityId:   string | null;
  isRead:     boolean;
  readAt:     string | null;
  createdAt:  string;
}

export interface NotificationPreference {
  id:        string | null;
  userId:    string;
  companyId: string;
  type:      NotificationType;
  enabled:   boolean;
  updatedAt: string | null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  projects: {
    total:     number;
    active:    number;
    onHold:    number;
    planning:  number;
    completed: number;
    archived:  number;
    recent: Array<{
      id:        string;
      name:      string;
      code:      string | null;
      status:    string;
      location:  string | null;
      updatedAt: string;
    }>;
  };
  workers: {
    total:  number;
    active: number;
  };
  attendance: {
    todayTotal:   number;
    todayPresent: number;
    todayRate:    number;
  };
  labour: {
    thisWeekHours: number;
    thisMonthCost: number;
  };
  invoices: {
    total:           number;
    totalValue:      number;
    totalPaid:       number;
    outstanding:     number;
    overdueCount:    number;
    pendingApproval: number;
  };
  budget: {
    totalBudgeted:  number;
    totalSpent:     number;
    totalRemaining: number;
    budgetsCount:   number;
    overspendCount: number;
  };
  deliveries: {
    thisMonthCount:         number;
    pendingInspectionCount: number;
    totalCount:             number;
  };
  contractors: {
    total:           number;
    activeSchedules: number;
  };
  instructions: {
    open:     number;
    critical: number;
  };
  notifications: {
    unread: number;
  };
  finance?: {
    totalInflows:     number;
    inflowsThisMonth: number;
    netPosition:      number;
  };
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export type ReportType =
  | 'labour'
  | 'budget'
  | 'invoices'
  | 'deliveries'
  | 'contractors'
  | 'consultants'
  | 'project-health';

export type ReportFormat = 'json' | 'csv' | 'xlsx' | 'pdf';

export interface ReportData {
  title:       string;
  subtitle:    string;
  generatedAt: string;
  filters:     Record<string, string>;
  summary:     Array<{ label: string; value: string }>;
  columns:     string[];
  rows:        string[][];
}

