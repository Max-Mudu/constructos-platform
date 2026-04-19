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

export interface DeliveryRecord {
  id:                 string;
  companyId:          string;
  projectId:          string;
  siteId:             string;
  supplierName:       string;
  deliveryDate:       string;
  itemDescription:    string;
  quantityOrdered:    number;
  quantityDelivered:  number;
  unitOfMeasure:      string;
  conditionOnArrival: string;
  inspectionStatus:   string;
  acceptanceStatus:   string;
  notes:              string | null;
  photos:             DeliveryPhoto[];
}

export interface DeliveryPhoto {
  id:       string;
  fileUrl:  string;
  fileName: string;
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
