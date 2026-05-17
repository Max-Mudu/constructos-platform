// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'company_admin'
  | 'project_manager'
  | 'site_supervisor'
  | 'finance_officer'
  | 'consultant'
  | 'contractor'
  | 'worker'
  | 'viewer';

export interface AuthUser {
  id:             string;
  email:          string;
  firstName:      string;
  lastName:       string;
  role:           UserRole;
  companyId:      string;
  canViewFinance: boolean;
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
}

// ─── Projects & Sites ─────────────────────────────────────────────────────────

export interface Project {
  id:        string;
  companyId: string;
  name:      string;
  status:    string;
}

export interface JobSite {
  id:        string;
  projectId: string;
  companyId: string;
  name:      string;
  status:    string;
}

// ─── Workers ──────────────────────────────────────────────────────────────────

export interface Worker {
  id:        string;
  companyId: string;
  firstName: string;
  lastName:  string;
  trade:     string | null;
  isActive:  boolean;
}

// ─── Attendance ───────────────────────────────────────────────────────────────

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
  worker: { id: string; firstName: string; lastName: string; trade: string | null };
}

// ─── Labour ───────────────────────────────────────────────────────────────────

export interface LabourEntry {
  id:          string;
  companyId:   string;
  projectId:   string;
  siteId:      string;
  workerId:    string;
  date:        string;
  hoursWorked: number;
  dailyRate:   number;
  currency:    string;
  notes:       string | null;
  worker: { id: string; firstName: string; lastName: string; trade: string | null };
}

// ─── Deliveries ───────────────────────────────────────────────────────────────

export type InspectionStatus = 'pending' | 'passed' | 'failed' | 'waived';
export type AcceptanceStatus = 'accepted' | 'partially_accepted' | 'rejected';
export type DeliveryCondition = 'good' | 'damaged' | 'partial' | 'incorrect';

export interface DeliveryRecord {
  id:                  string;
  companyId:           string;
  projectId:           string;
  siteId:              string;
  supplierName:        string;
  supplierContact:     string | null;
  deliveryDate:        string;
  deliveryTime:        string | null;
  driverName:          string | null;
  vehicleRegistration: string | null;
  purchaseOrderNumber: string | null;
  deliveryNoteNumber:  string | null;
  invoiceNumber:       string | null;
  itemDescription:     string;
  unitOfMeasure:       string;
  quantityOrdered:     number;
  quantityDelivered:   number;
  conditionOnArrival:  DeliveryCondition;
  inspectionStatus:    InspectionStatus;
  acceptanceStatus:    AcceptanceStatus | null;
  rejectionReason:     string | null;
  discrepancyNotes:    string | null;
  receivedById:        string;
  receivedBy:          { id: string; firstName: string; lastName: string; email: string } | null;
  comments:            string | null;
  notes?:              string | null;  // legacy alias — may not be populated
  photos:              DeliveryPhoto[];
  documents:           DeliveryDocument[];
  createdAt:           string;
  updatedAt:           string;
}

export interface DeliveryPhoto {
  id:            string;
  fileUrl:       string;
  fileName:      string;
  fileSizeBytes: number;
}

export interface DeliveryDocument {
  id:            string;
  fileUrl:       string;
  fileName:      string;
  fileSizeBytes: number;
  fileType:      string;
}

// ─── Notifications ────────────────────────────────────────────────────────────

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

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  projects: {
    total: number; active: number; onHold: number;
    planning: number; completed: number; archived: number;
    recent: Array<{ id: string; name: string; status: string; updatedAt: string }>;
  };
  workers:     { total: number; active: number };
  attendance:  { todayTotal: number; todayPresent: number; todayRate: number };
  labour:      { thisWeekHours: number; thisMonthCost: number };
  invoices:    { total: number; totalValue: number; totalPaid: number; outstanding: number; overdueCount: number; pendingApproval: number };
  budget:      { totalBudgeted: number; totalSpent: number; totalRemaining: number; budgetsCount: number; overspendCount: number };
  deliveries:  { thisMonthCount: number; pendingInspectionCount: number; totalCount: number };
  contractors: { total: number; activeSchedules: number };
  instructions:{ open: number; critical: number };
  notifications:{ unread: number };
  lowStockInventory?: {
    count: number;
    items: Array<{
      id:                string;
      materialName:      string;
      currentQuantity:   number;
      unitOfMeasure:     string;
      lowStockThreshold: number;
      siteName:          string;
    }>;
  };
  schedule?: {
    overdueTasks:    number;
    dueTodayTasks:   number;
    blockedTasks:    number;
    delayedTasks:    number;
    behindPlanTasks: number;
  };
  labourAlerts?: {
    absentToday:          number;
    lateToday:            number;
    overtimeEntriesToday: number;
    attendanceRateToday:  number;
    zeroWorkforceToday:   boolean;
  };
  procurementAlerts?: {
    pendingDeliveriesCount:  number;
    rejectedLast30dCount:    number;
    damagedLast30dCount:     number;
    lowStockNoDeliveryCount: number;
    lowStockSeverityItems: Array<{
      materialName:      string;
      currentQuantity:   number;
      lowStockThreshold: number;
      unitOfMeasure:     string;
      siteName:          string;
    }>;
  };
  finance?:    { totalInflows: number; inflowsThisMonth: number; netPosition: number };
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'submitted' | 'approved' | 'disputed' | 'paid' | 'cancelled' | 'overdue';

export interface InvoiceLineItem {
  id:          string;
  description: string;
  quantity:    number;
  unitPrice:   number;
  totalPrice:  number;
}

export interface Invoice {
  id:            string;
  companyId:     string;
  projectId:     string;
  invoiceNumber: string;
  vendorType:    string;
  vendorName:    string;
  subtotal:      number;
  taxAmount:     number;
  totalAmount:   number;
  paidAmount:    number;
  currency:      string;
  issueDate:     string;
  dueDate:       string;
  status:        InvoiceStatus;
  notes:         string | null;
  lineItems:     InvoiceLineItem[];
}

// ─── Drawings ─────────────────────────────────────────────────────────────────

export type DrawingStatus = 'draft' | 'issued_for_review' | 'issued_for_construction' | 'superseded' | 'archived';

export interface DrawingRevision {
  id:             string;
  drawingId:      string;
  revisionNumber: string;
  status:         DrawingStatus;
  fileUrl:        string;
  fileName:       string;
  fileSizeBytes:  number;
  issueDate:      string | null;
  notes:          string | null;
  uploadedAt:     string;
}

export interface Drawing {
  id:            string;
  companyId:     string;
  projectId:     string;
  drawingNumber: string;
  title:         string;
  discipline:    string | null;
  latestRevision: DrawingRevision | null;
  revisions:     DrawingRevision[];
}

// ─── Instructions ─────────────────────────────────────────────────────────────

export type InstructionStatus   = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
export type InstructionPriority = 'low' | 'medium' | 'high' | 'critical';
export type InstructionType     = 'instruction' | 'recommendation';

export interface Instruction {
  id:               string;
  companyId:        string;
  projectId:        string;
  type:             InstructionType;
  title:            string;
  category:         string | null;
  priority:         InstructionPriority;
  status:           InstructionStatus;
  description:      string | null;
  issuedDate:       string;
  targetActionDate: string | null;
  siteId:           string | null;
  issuedBy: { id: string; firstName: string; lastName: string };
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'delayed' | 'blocked' | 'completed';

export type ScheduleActivityType = 'status_change' | 'progress_update' | 'delay_reason' | 'block_reason' | 'note_update';

export interface ScheduleActivity {
  id:        string;
  type:      ScheduleActivityType;
  oldValue:  string | null;
  newValue:  string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; role: string };
}

export interface ScheduleMilestone {
  id:          string;
  taskId:      string;
  name:        string;
  description: string | null;
  plannedDate: string;
  actualDate:  string | null;
  status:      'pending' | 'in_progress' | 'completed' | 'cancelled';
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
  plannedProgress:   number | null;
  actualProgress:    number | null;
  status:            ScheduleTaskStatus;
  delayReason:       string | null;
  comments:          string | null;
  contractor:        { id: string; name: string; tradeSpecialization: string | null } | null;
  workPackage:       { id: string; name: string; area: string | null } | null;
  milestones:        ScheduleMilestone[];
}

// ─── Contractors ──────────────────────────────────────────────────────────────

export interface Contractor {
  id:                  string;
  companyId:           string;
  name:                string;
  contactPerson:       string | null;
  email:               string | null;
  phone:               string | null;
  tradeSpecialization: string | null;
  isActive:            boolean;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export type InventoryTxType =
  | 'delivery_in'
  | 'usage_out'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'transfer_in'
  | 'transfer_out';

export interface SiteInventoryItem {
  id:                string;
  companyId:         string;
  siteId:            string;
  materialName:      string;
  unitOfMeasure:     string;
  currentQuantity:   number;
  lowStockThreshold: number | null;
  isLowStock?:       boolean;
  createdAt:         string;
  updatedAt:         string;
  site:              { id: string; name: string };
}

export interface InventoryTransaction {
  id:             string;
  type:           InventoryTxType;
  quantity:       number;
  unitOfMeasure:  string;
  note:           string | null;
  usageReason:    string | null;
  workArea:       string | null;
  scheduleTaskId: string | null;
  createdAt:      string;
  delivery:       { id: string; supplierName: string; deliveryDate: string } | null;
  performedBy:    { id: string; firstName: string; lastName: string } | null;
}

export interface SiteInventoryItemDetail extends SiteInventoryItem {
  transactions: InventoryTransaction[];
}

// ─── API Response shapes ──────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data:   T[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface ApiError {
  error:   string;
  code:    string;
  details?: Record<string, string[]>;
}
