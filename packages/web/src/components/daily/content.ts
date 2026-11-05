/**
 * Pure helpers for Daily Report content: defaults, normalisation and
 * sanitising. sanitizeContent() rebuilds every object from the known V1
 * fields only, so nothing outside the schema (for example a rate or wage
 * someone pasted into a payload) can ever be sent to the API.
 */
import {
  DELAY_CAUSES,
  INCIDENT_TYPES,
  SECTION_KEYS,
  WEATHER_CONDITIONS,
  type DailyReportContentV1,
  type DailyReportSections,
  type Delay,
  type DelayCause,
  type Incident,
  type IncidentType,
  type ManpowerEntry,
  type MaterialDelivery,
  type PlanItem,
  type SectionKey,
  type VisitorInstruction,
  type WeatherCondition,
  type WorkItem,
} from '@/lib/daily-report-types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

export function emptySection<K extends SectionKey>(key: K): DailyReportSections[K] {
  const empty: DailyReportSections = {
    weather: { conditions: [], temperatureC: null, workStoppedByWeather: null, notes: '' },
    manpower: { entries: [], totalOnSite: null, notes: '' },
    workCompleted: [],
    delays: [],
    safety: { incidentsReported: null, incidents: [], toolboxTalk: '', notes: '' },
    materialsDeliveries: [],
    visitorsInstructions: [],
    tomorrowPlan: [],
    remarks: '',
  };
  return empty[key];
}

export function emptyContent(): DailyReportContentV1 {
  const c = {} as DailyReportSections;
  for (const k of SECTION_KEYS) (c as unknown as Obj)[k] = emptySection(k);
  return { ...c, reviewedSections: [] };
}

export const emptyManpowerEntry = (): ManpowerEntry => ({ trade: '', count: null, employer: '', notes: '' });
export const emptyWorkItem = (): WorkItem => ({ description: '', location: '', quantity: null, unit: '', progressPercent: null });
export const emptyDelay = (): Delay => ({ cause: 'other', description: '', hoursLost: null, responsibleParty: '' });
export const emptyIncident = (): Incident => ({ type: 'near_miss', description: '' });
export const emptyMaterial = (): MaterialDelivery => ({ material: '', quantity: null, unit: '', supplier: '', notes: '' });
export const emptyVisitor = (): VisitorInstruction => ({ name: '', organisation: '', purposeOrInstruction: '' });
export const emptyPlanItem = (): PlanItem => ({ description: '' });

/** Rebuilds one section from known fields only, filling defaults. */
export function sanitizeSection<K extends SectionKey>(key: K, raw: unknown): DailyReportSections[K] {
  const v = raw;
  switch (key) {
    case 'weather': {
      const o = isObj(v) ? v : {};
      const conditions = arr(o.conditions)
        .filter((c): c is WeatherCondition => (WEATHER_CONDITIONS as readonly string[]).includes(c as string));
      return {
        conditions: Array.from(new Set(conditions)).slice(0, 5),
        temperatureC: numOrNull(o.temperatureC),
        workStoppedByWeather: boolOrNull(o.workStoppedByWeather),
        notes: str(o.notes),
      } as DailyReportSections[K];
    }
    case 'manpower': {
      const o = isObj(v) ? v : {};
      return {
        entries: arr(o.entries).filter(isObj).map((e) => ({
          trade: str(e.trade), count: numOrNull(e.count), employer: str(e.employer), notes: str(e.notes),
        })),
        totalOnSite: numOrNull(o.totalOnSite),
        notes: str(o.notes),
      } as DailyReportSections[K];
    }
    case 'workCompleted':
      return arr(v).filter(isObj).map((e) => ({
        description: str(e.description), location: str(e.location), quantity: numOrNull(e.quantity),
        unit: str(e.unit), progressPercent: numOrNull(e.progressPercent),
      })) as DailyReportSections[K];
    case 'delays':
      return arr(v).filter(isObj).map((e) => ({
        cause: oneOf<DelayCause>(DELAY_CAUSES, e.cause, 'other'), description: str(e.description),
        hoursLost: numOrNull(e.hoursLost), responsibleParty: str(e.responsibleParty),
      })) as DailyReportSections[K];
    case 'safety': {
      const o = isObj(v) ? v : {};
      return {
        incidentsReported: boolOrNull(o.incidentsReported),
        incidents: arr(o.incidents).filter(isObj).map((e) => ({
          type: oneOf<IncidentType>(INCIDENT_TYPES, e.type, 'other'), description: str(e.description),
        })),
        toolboxTalk: str(o.toolboxTalk),
        notes: str(o.notes),
      } as DailyReportSections[K];
    }
    case 'materialsDeliveries':
      return arr(v).filter(isObj).map((e) => ({
        material: str(e.material), quantity: numOrNull(e.quantity), unit: str(e.unit),
        supplier: str(e.supplier), notes: str(e.notes),
      })) as DailyReportSections[K];
    case 'visitorsInstructions':
      return arr(v).filter(isObj).map((e) => ({
        name: str(e.name), organisation: str(e.organisation), purposeOrInstruction: str(e.purposeOrInstruction),
      })) as DailyReportSections[K];
    case 'tomorrowPlan':
      return arr(v).filter(isObj).map((e) => ({ description: str(e.description) })) as DailyReportSections[K];
    case 'remarks':
      return str(v) as DailyReportSections[K];
    default:
      return emptySection(key);
  }
}

/** Full content rebuilt from known fields only. Unknown keys are dropped. */
export function sanitizeContent(raw: unknown): DailyReportContentV1 {
  const o = isObj(raw) ? raw : {};
  const c = {} as DailyReportSections;
  for (const k of SECTION_KEYS) (c as unknown as Obj)[k] = sanitizeSection(k, o[k]);
  const reviewed = arr(o.reviewedSections)
    .filter((s): s is SectionKey => (SECTION_KEYS as readonly string[]).includes(s as string));
  return { ...c, reviewedSections: SECTION_KEYS.filter((k) => reviewed.includes(k)) };
}

/** Draft (AI output) rebuilt from known fields only. */
export function sanitizeDraft(raw: unknown): DailyReportSections {
  const { reviewedSections: _ignored, ...rest } = sanitizeContent(raw);
  void _ignored;
  return rest;
}

const isBlank = (s: string) => s.trim() === '';

/** True when a section holds nothing a reader would see. */
export function sectionIsEmpty<K extends SectionKey>(key: K, value: DailyReportSections[K]): boolean {
  const v = sanitizeSection(key, value) as unknown;
  switch (key) {
    case 'weather': {
      const w = v as DailyReportSections['weather'];
      return w.conditions.length === 0 && w.temperatureC === null && w.workStoppedByWeather === null && isBlank(w.notes);
    }
    case 'manpower': {
      const m = v as DailyReportSections['manpower'];
      return m.entries.length === 0 && m.totalOnSite === null && isBlank(m.notes);
    }
    case 'safety': {
      const s = v as DailyReportSections['safety'];
      return s.incidentsReported === null && s.incidents.length === 0 && isBlank(s.toolboxTalk) && isBlank(s.notes);
    }
    case 'remarks':
      return isBlank(v as string);
    default:
      return (v as unknown[]).length === 0;
  }
}

/** Order-sensitive structural equality for JSON-shaped values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as Obj);
  const kb = Object.keys(b as Obj);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Obj)[k], (b as Obj)[k]));
}

/** Parses a numeric text field: '' → null, otherwise a finite non-negative number or null. */
export function parseNumberInput(text: string, opts: { allowNegative?: boolean; integer?: boolean; max?: number } = {}): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (!opts.allowNegative && n < 0) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return opts.integer ? Math.round(n) : n;
}
