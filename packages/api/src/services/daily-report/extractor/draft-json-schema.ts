import { DelayCause, IncidentType, WeatherCondition } from '../content.schema';

/**
 * Hand-written JSON Schema for DailyReportDraftV1, sent to the model as
 * `output_config.format` (structured outputs).
 *
 * Structured-output rules this schema follows:
 *  - every object has `additionalProperties: false` and lists every property
 *    in `required` (the model always emits every key; "unknown" is expressed
 *    as null, "" or []);
 *  - nullable values use type unions (`["number", "null"]`);
 *  - no numeric, string-length or array-length constraints (minimum, maximum,
 *    minLength, maxLength, maxItems …): structured outputs does not support
 *    them. The zod schema (DailyReportDraftV1) enforces them after parsing and
 *    is the only gate for what is stored.
 *
 * Enum values come from the zod enums so the two cannot drift. A parity test
 * (tests/extractor-schema.test.ts) walks the zod schema and this schema and
 * fails when a key, type or enum differs.
 */

type JsonSchema = { readonly [key: string]: unknown };

const text = (description?: string): JsonSchema =>
  description ? { type: 'string', description } : { type: 'string' };

const nullableNumber = (description: string): JsonSchema => ({ type: ['number', 'null'], description });
const nullableInteger = (description: string): JsonSchema => ({ type: ['integer', 'null'], description });
const nullableBoolean = (description: string): JsonSchema => ({ type: ['boolean', 'null'], description });

function object(properties: Record<string, JsonSchema>, description?: string): JsonSchema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const array = (items: JsonSchema, description?: string): JsonSchema =>
  description ? { type: 'array', description, items } : { type: 'array', items };

const AS_WRITTEN = 'Only as written in the notes; null when not stated. Never estimated, totalled, rounded or converted.';

export const DAILY_REPORT_DRAFT_JSON_SCHEMA: JsonSchema = object({
  weather: object({
    conditions: array(
      { type: 'string', enum: [...WeatherCondition.options] },
      'Weather conditions the notes describe; [] when not mentioned.',
    ),
    temperatureC: nullableNumber(`Temperature in °C. ${AS_WRITTEN}`),
    workStoppedByWeather: nullableBoolean('true only if the notes say weather stopped work; false if they say it did not; otherwise null.'),
    notes: text(),
  }),
  manpower: object({
    entries: array(object({
      trade: text('Trade or group in the supervisor\'s words, e.g. fundi, mason, steel fixer, casuals.'),
      count: nullableInteger(`Headcount for this trade. ${AS_WRITTEN}`),
      employer: text('Own staff or the subcontractor name, if stated. Never a pay figure.'),
      notes: text(),
    })),
    totalOnSite: nullableInteger('Total headcount only when the notes state a total. Never computed from the entries.'),
    notes: text(),
  }),
  workCompleted: array(object({
    description: text('The work done, in the supervisor\'s wording.'),
    location: text('Block, floor, gridline or area, if stated.'),
    quantity: nullableNumber(AS_WRITTEN),
    unit: text('Unit exactly as written, e.g. m³, m², blocks, bags.'),
    progressPercent: nullableNumber(`Percent complete. ${AS_WRITTEN}`),
  })),
  delays: array(object({
    cause: { type: 'string', enum: [...DelayCause.options], description: 'Use "other" when the cause is unclear.' },
    description: text(),
    hoursLost: nullableNumber(`Hours lost. ${AS_WRITTEN} Never computed from start and end times.`),
    responsibleParty: text(),
  })),
  safety: object({
    incidentsReported: nullableBoolean('true if an incident is described; false if the notes say there were none; otherwise null.'),
    incidents: array(object({
      type: { type: 'string', enum: [...IncidentType.options] },
      description: text(),
    })),
    toolboxTalk: text('Toolbox talk topic, if stated.'),
    notes: text(),
  }),
  materialsDeliveries: array(object({
    material: text('Material received on site, in the supervisor\'s words.'),
    quantity: nullableNumber(AS_WRITTEN),
    unit: text('Unit exactly as written, e.g. bags, tonnes, lorries, pieces.'),
    supplier: text(),
    notes: text('No prices or costs.'),
  })),
  visitorsInstructions: array(object({
    name: text(),
    organisation: text(),
    purposeOrInstruction: text(),
  })),
  tomorrowPlan: array(object({
    description: text(),
  })),
  remarks: text('Other relevant site remarks. No money, wages, rates or costs.'),
});
