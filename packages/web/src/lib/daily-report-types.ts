/**
 * Daily Site Report V1 — web-side types.
 *
 * Mirrors packages/api/src/services/daily-report/content.schema.ts and the
 * HTTP contract for /projects/:projectId/sites/:siteId/daily-reports. The web
 * package does not import across packages, so keep this file in step with the
 * API schema by hand.
 *
 * Nothing here carries money: no rates, wages, costs or prices. The API
 * schema is strict and rejects unknown keys, and sanitizeContent() in
 * components/daily/content.ts rebuilds every object from these fields only.
 */

export const CONTENT_SCHEMA_VERSION = 1;

export const SECTION_KEYS = [
  'weather',
  'manpower',
  'workCompleted',
  'delays',
  'safety',
  'materialsDeliveries',
  'visitorsInstructions',
  'tomorrowPlan',
  'remarks',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const WEATHER_CONDITIONS = [
  'sunny', 'cloudy', 'light_rain', 'heavy_rain', 'windy', 'storm', 'hot', 'cold', 'other',
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export const DELAY_CAUSES = [
  'weather', 'late_materials', 'equipment_breakdown', 'labour_shortage', 'awaiting_information',
  'client_or_consultant_instruction', 'inspection_or_authority', 'utilities', 'site_access',
  'safety_stoppage', 'subcontractor', 'other',
] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];

export const INCIDENT_TYPES = [
  'near_miss', 'first_aid', 'lost_time', 'property_damage', 'environmental', 'other',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Field length limits from the API schema (txt(max)). */
export const LIMITS = {
  rawInput: 20_000,
  caption: 300,
  reopenReasonMin: 5,
  reopenReasonMax: 500,
  photosPerReport: 30,
  photoBytes: 10 * 1024 * 1024,
  notes: 2000,
  remarks: 4000,
  short: 150,
  trade: 100,
  unit: 30,
  location: 200,
  description: 1000,
  entryNotes: 300,
  toolboxTalk: 500,
} as const;

export interface Weather {
  conditions: WeatherCondition[];
  temperatureC: number | null;
  workStoppedByWeather: boolean | null;
  notes: string;
}

export interface ManpowerEntry {
  trade: string;
  count: number | null;
  /** Own staff or subcontractor name — never a pay figure. */
  employer: string;
  notes: string;
}

export interface Manpower {
  entries: ManpowerEntry[];
  /** Only as stated by the supervisor; never computed. */
  totalOnSite: number | null;
  notes: string;
}

export interface WorkItem {
  description: string;
  location: string;
  quantity: number | null;
  unit: string;
  progressPercent: number | null;
}

export interface Delay {
  cause: DelayCause;
  description: string;
  hoursLost: number | null;
  responsibleParty: string;
}

export interface Incident {
  type: IncidentType;
  description: string;
}

export interface Safety {
  incidentsReported: boolean | null;
  incidents: Incident[];
  toolboxTalk: string;
  notes: string;
}

export interface MaterialDelivery {
  material: string;
  quantity: number | null;
  unit: string;
  supplier: string;
  notes: string;
}

export interface VisitorInstruction {
  name: string;
  organisation: string;
  purposeOrInstruction: string;
}

export interface PlanItem {
  description: string;
}

export interface DailyReportSections {
  weather: Weather;
  manpower: Manpower;
  workCompleted: WorkItem[];
  delays: Delay[];
  safety: Safety;
  materialsDeliveries: MaterialDelivery[];
  visitorsInstructions: VisitorInstruction[];
  tomorrowPlan: PlanItem[];
  remarks: string;
}

/** Human-reviewed content, stored in DailyReport.content. */
export interface DailyReportContentV1 extends DailyReportSections {
  reviewedSections: SectionKey[];
}

/** AI extraction output (aiDraft.draft): same sections, no review state. */
export type DailyReportDraftV1 = DailyReportSections;

export type ReportStatus = 'draft' | 'final';
export type ExtractionStatus = 'not_requested' | 'succeeded' | 'failed';

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface DailyReportSummary {
  id: string;
  /** YYYY-MM-DD */
  reportDate: string;
  reportNumber: number;
  /** "DR-0007" */
  displayNumber: string;
  status: ReportStatus;
  revision: number;
  photoCount: number;
  preparedBy: PersonRef;
  finalisedAt: string | null;
  updatedAt: string;
}

export interface DailyReportPhoto {
  id: string;
  caption: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
  /** Short-lived signed URL (~5 min). */
  url: string;
  urlExpiresAt: string;
}

export interface DailyReportRevisionSummary {
  revision: number;
  finalisedAt: string;
  finalisedBy: PersonRef;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface UnsupportedNumber {
  /** e.g. "workCompleted[0].quantity" */
  path: string;
  value: number;
}

export interface AiDraft {
  draft: DailyReportDraftV1;
  unsupportedNumbers: UnsupportedNumber[];
}

export interface DailyReport extends DailyReportSummary {
  project: { id: string; name: string };
  site: { id: string; name: string };
  content: DailyReportContentV1;
  contentSchemaVersion: 1;
  // Editor roles only (omitted for finance_officer / viewer):
  rawInput?: string;
  aiDraft?: AiDraft | null;
  extractionStatus?: ExtractionStatus;
  extractionError?: string | null;
  aiModel?: string | null;
  photos: DailyReportPhoto[];
  revisions: DailyReportRevisionSummary[];
  finalisedBy: PersonRef | null;
  canEdit: boolean;
  canReopen: boolean;
}

export interface DailyReportListResponse {
  reports: DailyReportSummary[];
  nextCursor: string | null;
}

export interface DailyReportListQuery {
  date?: string;
  status?: ReportStatus;
  cursor?: string;
  /** ≤ 50 */
  limit?: number;
}

/** Roles from api/src/services/daily-report/policy.ts (UI hints only). */
export const DAILY_REPORT_VIEW_ROLES = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer',
] as const;
export const DAILY_REPORT_EDIT_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
export const DAILY_REPORT_REOPEN_ROLES = ['company_admin', 'project_manager'] as const;

export function roleCanEditDailyReports(role: string): boolean {
  return (DAILY_REPORT_EDIT_ROLES as readonly string[]).includes(role);
}

export function roleCanViewDailyReports(role: string): boolean {
  return (DAILY_REPORT_VIEW_ROLES as readonly string[]).includes(role);
}
