'use client';

/**
 * Compact editors for the 9 report sections. Only the V1 content fields are
 * editable — manpower is trade / count / employer / notes, with no pay
 * fields anywhere.
 */
import { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DELAY_CAUSES, INCIDENT_TYPES, LIMITS, WEATHER_CONDITIONS,
  type DailyReportSections, type DelayCause, type IncidentType, type SectionKey,
} from '@/lib/daily-report-types';
import { cn } from '@/lib/utils';
import {
  emptyDelay, emptyIncident, emptyManpowerEntry, emptyMaterial, emptyPlanItem, emptyVisitor, emptyWorkItem,
  NUMBER_FIELD_DECIMALS, parseNumberInput,
} from './content';
import { DELAY_CAUSE_LABELS, INCIDENT_LABELS, WEATHER_LABELS } from './labels';
import { UnsupportedChip } from './SectionView';
import { fieldKey } from './unsupported-numbers';
import { DButton, FieldLabel, SelectInput, TextArea, TextInput } from './ui';

// ─── Field primitives ────────────────────────────────────────────────────────

function NumberField({
  label, value, onChange, integer = false, max, allowNegative = false, unit, flagged = false,
}: {
  label: string; value: number | null; onChange: (n: number | null) => void;
  integer?: boolean; max?: number; allowNegative?: boolean; unit?: string; flagged?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  // Counts (the API's integer fields) take whole numbers; every other number
  // field keeps decimals, up to NUMBER_FIELD_DECIMALS places.
  const opts = { integer, max, allowNegative, maxDecimals: integer ? undefined : NUMBER_FIELD_DECIMALS };
  // Follow outside changes (e.g. "start from suggestion") without fighting the user's typing.
  useEffect(() => {
    if (parseNumberInput(text, opts) !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = text.trim() !== '' && parseNumberInput(text, opts) === null;
  const hint = integer
    ? `Enter a whole number${max !== undefined ? ` up to ${max}` : ''}.`
    : `Enter a number with up to ${NUMBER_FIELD_DECIMALS} decimal places${max !== undefined ? `, up to ${max}` : ''}.`;
  return (
    <div>
      <FieldLabel htmlFor={id} hint={unit}>{label}</FieldLabel>
      <TextInput
        id={id}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNumberInput(e.target.value, opts));
        }}
        className={cn(invalid && 'border-destructive', flagged && 'border-warning')}
      />
      {invalid && <p className="mt-1 text-xs text-destructive">{hint}</p>}
      {flagged && <div className="mt-1.5"><UnsupportedChip /></div>}
    </div>
  );
}

function TextField({
  label, value, onChange, max, multiline = false, placeholder,
}: {
  label: string; value: string; onChange: (s: string) => void; max: number; multiline?: boolean; placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <TextArea id={id} rows={3} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <TextInput id={id} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opts: { v: boolean | null; t: string }[] = [{ v: true, t: 'Yes' }, { v: false, t: 'No' }, { v: null, t: 'Not stated' }];
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-foreground">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              'min-h-[44px] rounded-xl border text-sm font-medium transition-colors',
              value === o.v ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent/60',
            )}
          >
            {o.t}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Rows<T>({
  items, onChange, make, addLabel, max, render, itemLabel,
}: {
  items: T[]; onChange: (items: T[]) => void; make: () => T; addLabel: string; max: number; itemLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">{itemLabel} {i + 1}</span>
            <DButton
              size="sm"
              variant="ghost"
              className="-mr-2 text-destructive hover:text-destructive"
              aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Remove
            </DButton>
          </div>
          {render(item, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
        </div>
      ))}
      {items.length < max && (
        <DButton variant="secondary" block onClick={() => onChange([...items, make()])}>
          <Plus className="h-4 w-4" aria-hidden /> {addLabel}
        </DButton>
      )}
    </div>
  );
}

// ─── Section editors ─────────────────────────────────────────────────────────

type EditorProps<K extends SectionKey> = {
  value: DailyReportSections[K];
  onChange: (v: DailyReportSections[K]) => void;
  flagged: Set<string>;
};

function WeatherEditor({ value, onChange, flagged }: EditorProps<'weather'>) {
  const toggle = (c: (typeof WEATHER_CONDITIONS)[number]) => {
    const has = value.conditions.includes(c);
    if (!has && value.conditions.length >= 5) return;
    onChange({ ...value, conditions: has ? value.conditions.filter((x) => x !== c) : [...value.conditions, c] });
  };
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Conditions <span className="font-normal text-[hsl(var(--text-tertiary))]">(up to 5)</span></legend>
        <div className="flex flex-wrap gap-2">
          {WEATHER_CONDITIONS.map((c) => {
            const on = value.conditions.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c)}
                className={cn(
                  'min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors',
                  on ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent/60',
                )}
              >
                {WEATHER_LABELS[c]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <NumberField label="Temperature" unit="°C" allowNegative value={value.temperatureC}
        onChange={(n) => onChange({ ...value, temperatureC: n })} flagged={flagged.has(fieldKey('weather', 'temperatureC'))} />
      <TriState label="Did weather stop work?" value={value.workStoppedByWeather} onChange={(v) => onChange({ ...value, workStoppedByWeather: v })} />
      <TextField label="Notes" multiline max={LIMITS.notes} value={value.notes} onChange={(s) => onChange({ ...value, notes: s })} />
    </div>
  );
}

function ManpowerEditor({ value, onChange, flagged }: EditorProps<'manpower'>) {
  return (
    <div className="space-y-4">
      <Rows
        items={value.entries}
        onChange={(entries) => onChange({ ...value, entries })}
        make={emptyManpowerEntry}
        addLabel="Add trade"
        itemLabel="Trade"
        max={50}
        render={(e, up, i) => (
          <>
            <TextField label="Trade" placeholder="e.g. Mason, Steel fixer, Helper" max={LIMITS.trade} value={e.trade} onChange={(s) => up({ trade: s })} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Number of people" integer value={e.count} onChange={(n) => up({ count: n })}
                flagged={flagged.has(fieldKey('manpower', 'entries', i, 'count'))} />
              <TextField label="Employer" placeholder="Own staff / subcontractor" max={LIMITS.short} value={e.employer} onChange={(s) => up({ employer: s })} />
            </div>
            <TextField label="Notes" max={LIMITS.entryNotes} value={e.notes} onChange={(s) => up({ notes: s })} />
          </>
        )}
      />
      <NumberField label="Total people on site (as counted)" integer value={value.totalOnSite}
        onChange={(n) => onChange({ ...value, totalOnSite: n })} flagged={flagged.has(fieldKey('manpower', 'totalOnSite'))} />
      <TextField label="Notes" multiline max={LIMITS.notes} value={value.notes} onChange={(s) => onChange({ ...value, notes: s })} />
    </div>
  );
}

function WorkEditor({ value, onChange, flagged }: EditorProps<'workCompleted'>) {
  return (
    <Rows
      items={value} onChange={onChange} make={emptyWorkItem} addLabel="Add work item" itemLabel="Item" max={100}
      render={(w, up, i) => (
        <>
          <TextField label="Work done" multiline max={LIMITS.description} value={w.description} onChange={(s) => up({ description: s })} />
          <TextField label="Location" placeholder="e.g. Level 2, east wing" max={LIMITS.location} value={w.location} onChange={(s) => up({ location: s })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Quantity" value={w.quantity} onChange={(n) => up({ quantity: n })} flagged={flagged.has(fieldKey('workCompleted', i, 'quantity'))} />
            <TextField label="Unit" placeholder="m², m³, no." max={LIMITS.unit} value={w.unit} onChange={(s) => up({ unit: s })} />
          </div>
          <NumberField label="Progress" unit="%" max={100} value={w.progressPercent} onChange={(n) => up({ progressPercent: n })}
            flagged={flagged.has(fieldKey('workCompleted', i, 'progressPercent'))} />
        </>
      )}
    />
  );
}

function DelaysEditor({ value, onChange, flagged }: EditorProps<'delays'>) {
  return (
    <Rows
      items={value} onChange={onChange} make={emptyDelay} addLabel="Add delay" itemLabel="Delay" max={50}
      render={(d, up, i) => (
        <>
          <div>
            <FieldLabel htmlFor={`delay-cause-${i}`}>Cause</FieldLabel>
            <SelectInput id={`delay-cause-${i}`} value={d.cause} onChange={(e) => up({ cause: e.target.value as DelayCause })}>
              {DELAY_CAUSES.map((c) => <option key={c} value={c}>{DELAY_CAUSE_LABELS[c]}</option>)}
            </SelectInput>
          </div>
          <TextField label="What happened" multiline max={LIMITS.description} value={d.description} onChange={(s) => up({ description: s })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Hours lost" value={d.hoursLost} onChange={(n) => up({ hoursLost: n })} flagged={flagged.has(fieldKey('delays', i, 'hoursLost'))} />
            <TextField label="Responsible" max={LIMITS.short} value={d.responsibleParty} onChange={(s) => up({ responsibleParty: s })} />
          </div>
        </>
      )}
    />
  );
}

function SafetyEditor({ value, onChange }: EditorProps<'safety'>) {
  return (
    <div className="space-y-4">
      <TriState label="Any incidents today?" value={value.incidentsReported} onChange={(v) => onChange({ ...value, incidentsReported: v })} />
      <Rows
        items={value.incidents}
        onChange={(incidents) => onChange({ ...value, incidents })}
        make={emptyIncident} addLabel="Add incident" itemLabel="Incident" max={20}
        render={(inc, up, i) => (
          <>
            <div>
              <FieldLabel htmlFor={`inc-type-${i}`}>Type</FieldLabel>
              <SelectInput id={`inc-type-${i}`} value={inc.type} onChange={(e) => up({ type: e.target.value as IncidentType })}>
                {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_LABELS[t]}</option>)}
              </SelectInput>
            </div>
            <TextField label="What happened" multiline max={LIMITS.description} value={inc.description} onChange={(s) => up({ description: s })} />
          </>
        )}
      />
      <TextField label="Toolbox talk topic" max={LIMITS.toolboxTalk} value={value.toolboxTalk} onChange={(s) => onChange({ ...value, toolboxTalk: s })} />
      <TextField label="Notes" multiline max={LIMITS.notes} value={value.notes} onChange={(s) => onChange({ ...value, notes: s })} />
    </div>
  );
}

function MaterialsEditor({ value, onChange, flagged }: EditorProps<'materialsDeliveries'>) {
  return (
    <Rows
      items={value} onChange={onChange} make={emptyMaterial} addLabel="Add delivery" itemLabel="Delivery" max={100}
      render={(m, up, i) => (
        <>
          <TextField label="Material" placeholder="e.g. Cement 50 kg bags" max={200} value={m.material} onChange={(s) => up({ material: s })} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Quantity" value={m.quantity} onChange={(n) => up({ quantity: n })} flagged={flagged.has(fieldKey('materialsDeliveries', i, 'quantity'))} />
            <TextField label="Unit" placeholder="bags, t, m³" max={LIMITS.unit} value={m.unit} onChange={(s) => up({ unit: s })} />
          </div>
          <TextField label="Supplier" max={LIMITS.short} value={m.supplier} onChange={(s) => up({ supplier: s })} />
          <TextField label="Notes" max={LIMITS.entryNotes} value={m.notes} onChange={(s) => up({ notes: s })} />
        </>
      )}
    />
  );
}

function VisitorsEditor({ value, onChange }: EditorProps<'visitorsInstructions'>) {
  return (
    <Rows
      items={value} onChange={onChange} make={emptyVisitor} addLabel="Add visitor or instruction" itemLabel="Entry" max={50}
      render={(v, up) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Name" max={LIMITS.short} value={v.name} onChange={(s) => up({ name: s })} />
            <TextField label="Organisation" max={LIMITS.short} value={v.organisation} onChange={(s) => up({ organisation: s })} />
          </div>
          <TextField label="Purpose or instruction" multiline max={LIMITS.description} value={v.purposeOrInstruction} onChange={(s) => up({ purposeOrInstruction: s })} />
        </>
      )}
    />
  );
}

function PlanEditor({ value, onChange }: EditorProps<'tomorrowPlan'>) {
  return (
    <Rows
      items={value} onChange={onChange} make={emptyPlanItem} addLabel="Add plan item" itemLabel="Plan" max={50}
      render={(p, up) => (
        <TextField label="Planned work" multiline max={LIMITS.description} value={p.description} onChange={(s) => up({ description: s })} />
      )}
    />
  );
}

function RemarksEditor({ value, onChange }: EditorProps<'remarks'>) {
  return <TextField label="Remarks" multiline max={LIMITS.remarks} value={value} onChange={onChange} />;
}

export function SectionEditor<K extends SectionKey>({
  section, value, onChange, flagged,
}: {
  section: K; value: DailyReportSections[K]; onChange: (v: DailyReportSections[K]) => void; flagged: Set<string>;
}) {
  // Each editor is typed per section; the casts only bridge the generic K.
  const p = { value, onChange, flagged } as unknown as EditorProps<never>;
  switch (section) {
    case 'weather': return <WeatherEditor {...(p as unknown as EditorProps<'weather'>)} />;
    case 'manpower': return <ManpowerEditor {...(p as unknown as EditorProps<'manpower'>)} />;
    case 'workCompleted': return <WorkEditor {...(p as unknown as EditorProps<'workCompleted'>)} />;
    case 'delays': return <DelaysEditor {...(p as unknown as EditorProps<'delays'>)} />;
    case 'safety': return <SafetyEditor {...(p as unknown as EditorProps<'safety'>)} />;
    case 'materialsDeliveries': return <MaterialsEditor {...(p as unknown as EditorProps<'materialsDeliveries'>)} />;
    case 'visitorsInstructions': return <VisitorsEditor {...(p as unknown as EditorProps<'visitorsInstructions'>)} />;
    case 'tomorrowPlan': return <PlanEditor {...(p as unknown as EditorProps<'tomorrowPlan'>)} />;
    case 'remarks': return <RemarksEditor {...(p as unknown as EditorProps<'remarks'>)} />;
    default: return null;
  }
}
