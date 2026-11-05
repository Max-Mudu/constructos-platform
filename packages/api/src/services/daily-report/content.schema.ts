import { z } from 'zod';

/**
 * Daily Site Report content, version 1.
 *
 * Every object is strict, so unknown keys (rate, wage, cost, amount, …) are
 * rejected: the report never carries financial information. Labour wages are
 * financial under the canViewFinancialData policy (report.service.ts), and a
 * daily report is readable by roles without financial access.
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

const txt = (max = 2000) => z.string().trim().max(max).default('');
const num = z.number().finite().nonnegative().nullable().default(null);
const int = z.number().int().nonnegative().nullable().default(null);

export const WeatherCondition = z.enum([
  'sunny', 'cloudy', 'light_rain', 'heavy_rain', 'windy', 'storm', 'hot', 'cold', 'other',
]);

export const DelayCause = z.enum([
  'weather', 'late_materials', 'equipment_breakdown', 'labour_shortage', 'awaiting_information',
  'client_or_consultant_instruction', 'inspection_or_authority', 'utilities', 'site_access',
  'safety_stoppage', 'subcontractor', 'other',
]);

export const IncidentType = z.enum([
  'near_miss', 'first_aid', 'lost_time', 'property_damage', 'environmental', 'other',
]);

const Weather = z.object({
  conditions:           z.array(WeatherCondition).max(5).default([]),
  temperatureC:         z.number().finite().nullable().default(null),
  workStoppedByWeather: z.boolean().nullable().default(null),
  notes:                txt(),
}).strict();

const ManpowerEntry = z.object({
  trade:    txt(100),
  count:    int,
  employer: txt(150), // own staff or subcontractor name — never a pay figure
  notes:    txt(300),
}).strict();

const Manpower = z.object({
  entries:     z.array(ManpowerEntry).max(50).default([]),
  totalOnSite: int, // only as stated by the supervisor; never computed by AI
  notes:       txt(),
}).strict();

const WorkItem = z.object({
  description:     txt(1000),
  location:        txt(200),
  quantity:        num,
  unit:            txt(30),
  progressPercent: z.number().min(0).max(100).nullable().default(null),
}).strict();

const Delay = z.object({
  cause:            DelayCause,
  description:      txt(1000),
  hoursLost:        num,
  responsibleParty: txt(150),
}).strict();

const Incident = z.object({
  type:        IncidentType,
  description: txt(1000),
}).strict();

const Safety = z.object({
  incidentsReported: z.boolean().nullable().default(null),
  incidents:         z.array(Incident).max(20).default([]),
  toolboxTalk:       txt(500),
  notes:             txt(),
}).strict();

const MaterialDelivery = z.object({
  material: txt(200),
  quantity: num,
  unit:     txt(30),
  supplier: txt(150),
  notes:    txt(300),
}).strict(); // no prices

const VisitorInstruction = z.object({
  name:                 txt(150),
  organisation:         txt(150),
  purposeOrInstruction: txt(1000),
}).strict();

const PlanItem = z.object({ description: txt(1000) }).strict();

const sections = {
  weather:              Weather.default({}),
  manpower:             Manpower.default({}),
  workCompleted:        z.array(WorkItem).max(100).default([]),
  delays:               z.array(Delay).max(50).default([]),
  safety:               Safety.default({}),
  materialsDeliveries:  z.array(MaterialDelivery).max(100).default([]),
  visitorsInstructions: z.array(VisitorInstruction).max(50).default([]),
  tomorrowPlan:         z.array(PlanItem).max(50).default([]),
  remarks:              txt(4000),
};

/** Human-reviewed report content, stored in DailyReport.content. */
export const DailyReportContentV1 = z.object({
  ...sections,
  // Sections the person preparing the report has explicitly reviewed.
  reviewedSections: z.array(z.enum(SECTION_KEYS)).max(SECTION_KEYS.length).default([]),
}).strict();
export type DailyReportContentV1 = z.infer<typeof DailyReportContentV1>;

/**
 * AI extraction output, stored only in DailyReport.aiDraft. Same sections as
 * the content, without review state. The AI never writes `content`.
 */
export const DailyReportDraftV1 = z.object(sections).strict();
export type DailyReportDraftV1 = z.infer<typeof DailyReportDraftV1>;

export const emptyContent = (): DailyReportContentV1 => DailyReportContentV1.parse({});
