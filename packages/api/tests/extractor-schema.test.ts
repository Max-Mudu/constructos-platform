/**
 * Parity between the zod DailyReportDraftV1 and the hand-written JSON Schema
 * sent to the model (DAILY_REPORT_DRAFT_JSON_SCHEMA). No database, no network.
 *
 * Two tiny walkers, no extra dependency:
 *  - compareSchemas(): walks zod and JSON Schema together and reports every
 *    missing / extra key, type mismatch and enum mismatch;
 *  - validateJson(): a structural JSON-Schema check (type, enum, required,
 *    additionalProperties:false) used to run a full fixture through both.
 */
import { z } from 'zod';
import { DailyReportDraftV1 } from '../src/services/daily-report/content.schema';
import { DAILY_REPORT_DRAFT_JSON_SCHEMA } from '../src/services/daily-report/extractor/draft-json-schema';

type Json = Record<string, any>;

function unwrapZod(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; nullable: boolean } {
  let nullable = false;
  let current: z.ZodTypeAny = schema;
  for (;;) {
    const typeName = current._def.typeName as string;
    if (typeName === 'ZodDefault') current = current._def.innerType;
    else if (typeName === 'ZodOptional') current = current._def.innerType;
    else if (typeName === 'ZodEffects') current = current._def.schema;
    else if (typeName === 'ZodNullable') { nullable = true; current = current._def.innerType; }
    else return { inner: current, nullable };
  }
}

function jsonTypes(node: Json): string[] {
  return Array.isArray(node['type']) ? [...node['type']].sort() : [node['type']];
}

function compareSchemas(zodSchema: z.ZodTypeAny, json: Json, path = '$'): string[] {
  const problems: string[] = [];
  const { inner, nullable } = unwrapZod(zodSchema);
  const typeName = inner._def.typeName as string;

  const expectType = (base: string) => {
    const expected = (nullable ? [base, 'null'] : [base]).sort();
    const actual = jsonTypes(json);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${path}: type ${JSON.stringify(actual)} should be ${JSON.stringify(expected)}`);
    }
  };

  switch (typeName) {
    case 'ZodObject': {
      expectType('object');
      const shape = (inner as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      const props: Json = json['properties'] ?? {};
      for (const key of Object.keys(shape)) {
        if (!(key in props)) { problems.push(`${path}.${key}: missing in JSON schema`); continue; }
        problems.push(...compareSchemas(shape[key]!, props[key], `${path}.${key}`));
      }
      for (const key of Object.keys(props)) {
        if (!(key in shape)) problems.push(`${path}.${key}: not in zod schema`);
      }
      const required: string[] = json['required'] ?? [];
      for (const key of Object.keys(shape)) {
        if (!required.includes(key)) problems.push(`${path}.${key}: not required`);
      }
      if (json['additionalProperties'] !== false) problems.push(`${path}: additionalProperties must be false`);
      break;
    }
    case 'ZodArray':
      expectType('array');
      if (!json['items']) problems.push(`${path}: array without items`);
      else problems.push(...compareSchemas((inner as z.ZodArray<z.ZodTypeAny>).element, json['items'], `${path}[]`));
      break;
    case 'ZodEnum': {
      expectType('string');
      const zodValues = [...(inner as z.ZodEnum<[string, ...string[]]>).options].sort();
      const jsonValues = [...(json['enum'] ?? [])].sort();
      if (JSON.stringify(zodValues) !== JSON.stringify(jsonValues)) problems.push(`${path}: enum mismatch`);
      break;
    }
    case 'ZodString':
      expectType('string');
      break;
    case 'ZodNumber':
      expectType((inner as z.ZodNumber).isInt ? 'integer' : 'number');
      break;
    case 'ZodBoolean':
      expectType('boolean');
      break;
    default:
      problems.push(`${path}: unhandled zod type ${typeName}`);
  }
  return problems;
}

function validateJson(schema: Json, value: unknown, path = '$'): string[] {
  const types = jsonTypes(schema);
  const typeOf = (v: unknown): string => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
  };
  const actual = typeOf(value);
  const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
  if (!ok) return [`${path}: ${actual} is not ${types.join('|')}`];
  if (schema['enum'] && !schema['enum'].includes(value)) return [`${path}: not in enum`];

  const problems: string[] = [];
  if (actual === 'object') {
    const obj = value as Record<string, unknown>;
    const props: Json = schema['properties'] ?? {};
    for (const key of schema['required'] ?? []) if (!(key in obj)) problems.push(`${path}.${key}: required`);
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        if (schema['additionalProperties'] === false) problems.push(`${path}.${key}: additional property`);
        continue;
      }
      problems.push(...validateJson(props[key], obj[key], `${path}.${key}`));
    }
  }
  if (actual === 'array') {
    (value as unknown[]).forEach((item, i) => problems.push(...validateJson(schema['items'], item, `${path}[${i}]`)));
  }
  return problems;
}

/** Every key and every section populated (synthetic). */
const FULL_FIXTURE = {
  weather: { conditions: ['cloudy', 'light_rain'], temperatureC: 24.5, workStoppedByWeather: false, notes: 'Drizzle after lunch' },
  manpower: {
    entries: [
      { trade: 'fundis', count: 6, employer: 'Own staff', notes: '' },
      { trade: 'steel fixers', count: 3, employer: 'Mwangi Steel Works', notes: 'Started 8am' },
    ],
    totalOnSite: 9,
    notes: '',
  },
  workCompleted: [
    { description: 'Blockwork to first floor partitions', location: 'Block A, first floor', quantity: 350, unit: 'blocks', progressPercent: 40 },
  ],
  delays: [{ cause: 'late_materials', description: 'Cement arrived at 11am', hoursLost: 2, responsibleParty: 'Simba Hardware' }],
  safety: {
    incidentsReported: true,
    incidents: [{ type: 'first_aid', description: 'Cut finger, treated on site' }],
    toolboxTalk: 'Handling of rebar',
    notes: '',
  },
  materialsDeliveries: [{ material: 'Cement', quantity: 40, unit: 'bags', supplier: 'Simba Hardware', notes: '' }],
  visitorsInstructions: [{ name: 'Eng. Wanjiru', organisation: 'Client PM', purposeOrInstruction: 'Site walk' }],
  tomorrowPlan: [{ description: 'Continue blockwork' }],
  remarks: 'None',
};

describe('DAILY_REPORT_DRAFT_JSON_SCHEMA parity with DailyReportDraftV1', () => {
  it('matches the zod schema key for key, type for type and enum for enum', () => {
    expect(compareSchemas(DailyReportDraftV1, DAILY_REPORT_DRAFT_JSON_SCHEMA as Json)).toEqual([]);
  });

  it('fails when a zod key is missing from the JSON schema (negative control)', () => {
    const broken = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    delete broken['properties'].manpower.properties.totalOnSite;
    broken['properties'].manpower.required = broken['properties'].manpower.required.filter((k: string) => k !== 'totalOnSite');
    expect(compareSchemas(DailyReportDraftV1, broken)).toContain('$.manpower.totalOnSite: missing in JSON schema');

    const brokenTop = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    delete brokenTop['properties'].remarks;
    expect(compareSchemas(DailyReportDraftV1, brokenTop)).toContain('$.remarks: missing in JSON schema');
  });

  it('fails on an extra key, a wrong type, a wrong enum or a non-required key (negative controls)', () => {
    const extra = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    extra['properties'].workCompleted.items.properties.rate = { type: 'number' };
    expect(compareSchemas(DailyReportDraftV1, extra)).toContain('$.workCompleted[].rate: not in zod schema');

    const wrongType = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    wrongType['properties'].manpower.properties.entries.items.properties.count.type = ['number', 'null'];
    expect(compareSchemas(DailyReportDraftV1, wrongType).join('\n')).toMatch(/entries\[\]\.count: type/);

    const wrongEnum = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    wrongEnum['properties'].delays.items.properties.cause.enum.pop();
    expect(compareSchemas(DailyReportDraftV1, wrongEnum)).toContain('$.delays[].cause: enum mismatch');

    const notRequired = structuredClone(DAILY_REPORT_DRAFT_JSON_SCHEMA) as Json;
    notRequired['required'] = notRequired['required'].filter((k: string) => k !== 'safety');
    expect(compareSchemas(DailyReportDraftV1, notRequired)).toContain('$.safety: not required');
  });

  it('uses only structured-output-compatible keywords', () => {
    const forbidden = ['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
      'multipleOf', 'minItems', 'maxItems', 'pattern', 'default', 'oneOf'];
    const found: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Json;
      for (const key of Object.keys(obj)) {
        // property names live under `properties`, not keywords
        if (path.endsWith('.properties')) { walk(obj[key], `${path}.${key}`); continue; }
        if (forbidden.includes(key)) found.push(`${path}.${key}`);
        walk(obj[key], `${path}.${key}`);
      }
      if (obj['type'] === 'object') {
        expect(obj['additionalProperties']).toBe(false);
        expect([...obj['required']].sort()).toEqual(Object.keys(obj['properties']).sort());
      }
    };
    walk(DAILY_REPORT_DRAFT_JSON_SCHEMA, '$');
    expect(found).toEqual([]);
  });

  it('accepts a full fixture under both zod and the JSON schema', () => {
    expect(validateJson(DAILY_REPORT_DRAFT_JSON_SCHEMA as Json, FULL_FIXTURE)).toEqual([]);
    const parsed = DailyReportDraftV1.safeParse(FULL_FIXTURE);
    expect(parsed.success).toBe(true);
    // zod round-trip keeps every value: nothing is silently dropped or defaulted.
    expect(parsed.success && parsed.data).toEqual(FULL_FIXTURE);
  });

  it('rejects the same bad inputs under both (extra money key, wrong enum, wrong type)', () => {
    const withWage = structuredClone(FULL_FIXTURE) as Json;
    withWage['manpower'].entries[0].dailyRate = 1500;
    expect(validateJson(DAILY_REPORT_DRAFT_JSON_SCHEMA as Json, withWage)).toContain('$.manpower.entries[0].dailyRate: additional property');
    expect(DailyReportDraftV1.safeParse(withWage).success).toBe(false);

    const badEnum = structuredClone(FULL_FIXTURE) as Json;
    badEnum['delays'][0].cause = 'bad_luck';
    expect(validateJson(DAILY_REPORT_DRAFT_JSON_SCHEMA as Json, badEnum)).toContain('$.delays[0].cause: not in enum');
    expect(DailyReportDraftV1.safeParse(badEnum).success).toBe(false);

    const badType = structuredClone(FULL_FIXTURE) as Json;
    badType['manpower'].entries[0].count = 6.5;
    expect(validateJson(DAILY_REPORT_DRAFT_JSON_SCHEMA as Json, badType).length).toBeGreaterThan(0);
    expect(DailyReportDraftV1.safeParse(badType).success).toBe(false);
  });
});
