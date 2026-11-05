'use client';

/** Read-only rendering of one report section, with amber chips on unverified numbers. */
import { AlertTriangle } from 'lucide-react';
import type { DailyReportSections, SectionKey } from '@/lib/daily-report-types';
import { sectionIsEmpty } from './content';
import { DELAY_CAUSE_LABELS, INCIDENT_LABELS, WEATHER_LABELS, formatNumber, yesNo } from './labels';
import { UNSUPPORTED_CHIP_LABEL, fieldKey } from './unsupported-numbers';
import { Chip } from './ui';

export function UnsupportedChip({ compact = false }: { compact?: boolean }) {
  return (
    <Chip tone="warning" className="whitespace-normal" title={UNSUPPORTED_CHIP_LABEL}>
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {compact ? 'Check' : UNSUPPORTED_CHIP_LABEL}
    </Chip>
  );
}

function Num({ value, unit, flagged }: { value: number | null; unit?: string; flagged: boolean }) {
  if (value === null) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold tabular-nums text-foreground">{formatNumber(value)}{unit ? ` ${unit}` : ''}</span>
      {flagged && <UnsupportedChip />}
    </span>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-[hsl(var(--text-tertiary))]">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

function Text({ children }: { children: string }) {
  if (!children.trim()) return null;
  return <p className="whitespace-pre-wrap text-sm text-foreground">{children}</p>;
}

const itemCls = 'space-y-1 rounded-lg border border-border bg-background/60 p-2.5';

export function SectionView<K extends SectionKey>({
  section, value, flagged, emptyText = 'Nothing entered',
}: {
  section: K; value: DailyReportSections[K]; flagged: Set<string>; emptyText?: string;
}) {
  if (sectionIsEmpty(section, value)) {
    return <p className="text-sm italic text-[hsl(var(--text-tertiary))]">{emptyText}</p>;
  }
  const f = (...t: (string | number)[]) => flagged.has(fieldKey(section, ...t));

  switch (section) {
    case 'weather': {
      const w = value as DailyReportSections['weather'];
      return (
        <div className="space-y-2">
          {w.conditions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {w.conditions.map((c) => <Chip key={c} tone="neutral">{WEATHER_LABELS[c]}</Chip>)}
            </div>
          )}
          <Line label="Temperature">{w.temperatureC !== null && <Num value={w.temperatureC} unit="°C" flagged={f('temperatureC')} />}</Line>
          <Line label="Work stopped by weather">{w.workStoppedByWeather !== null && yesNo(w.workStoppedByWeather)}</Line>
          <Text>{w.notes}</Text>
        </div>
      );
    }
    case 'manpower': {
      const m = value as DailyReportSections['manpower'];
      return (
        <div className="space-y-2">
          {m.entries.length > 0 && (
            <ul className="space-y-1.5">
              {m.entries.map((e, i) => (
                <li key={i} className={itemCls}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-foreground">{e.trade || 'Trade not stated'}</span>
                    {e.count !== null && <><span aria-hidden className="text-[hsl(var(--text-tertiary))]">×</span><Num value={e.count} flagged={f('entries', i, 'count')} /></>}
                  </div>
                  {e.employer && <p className="text-sm text-muted-foreground">{e.employer}</p>}
                  {e.notes && <p className="text-sm text-muted-foreground">{e.notes}</p>}
                </li>
              ))}
            </ul>
          )}
          <Line label="Total on site">{m.totalOnSite !== null && <Num value={m.totalOnSite} flagged={f('totalOnSite')} />}</Line>
          <Text>{m.notes}</Text>
        </div>
      );
    }
    case 'workCompleted': {
      const items = value as DailyReportSections['workCompleted'];
      return (
        <ul className="space-y-1.5">
          {items.map((w, i) => (
            <li key={i} className={itemCls}>
              <p className="whitespace-pre-wrap text-sm font-medium text-foreground">{w.description || 'No description'}</p>
              <Line label="Location">{w.location}</Line>
              <Line label="Quantity">{w.quantity !== null && <Num value={w.quantity} unit={w.unit} flagged={f(i, 'quantity')} />}</Line>
              <Line label="Progress">{w.progressPercent !== null && <Num value={w.progressPercent} unit="%" flagged={f(i, 'progressPercent')} />}</Line>
            </li>
          ))}
        </ul>
      );
    }
    case 'delays': {
      const items = value as DailyReportSections['delays'];
      return (
        <ul className="space-y-1.5">
          {items.map((d, i) => (
            <li key={i} className={itemCls}>
              <Chip tone="warning">{DELAY_CAUSE_LABELS[d.cause]}</Chip>
              <Text>{d.description}</Text>
              <Line label="Hours lost">{d.hoursLost !== null && <Num value={d.hoursLost} unit="h" flagged={f(i, 'hoursLost')} />}</Line>
              <Line label="Responsible">{d.responsibleParty}</Line>
            </li>
          ))}
        </ul>
      );
    }
    case 'safety': {
      const s = value as DailyReportSections['safety'];
      return (
        <div className="space-y-2">
          <Line label="Incidents reported">{s.incidentsReported !== null && yesNo(s.incidentsReported)}</Line>
          {s.incidents.length > 0 && (
            <ul className="space-y-1.5">
              {s.incidents.map((inc, i) => (
                <li key={i} className={itemCls}>
                  <Chip tone="danger">{INCIDENT_LABELS[inc.type]}</Chip>
                  <Text>{inc.description}</Text>
                </li>
              ))}
            </ul>
          )}
          <Line label="Toolbox talk">{s.toolboxTalk}</Line>
          <Text>{s.notes}</Text>
        </div>
      );
    }
    case 'materialsDeliveries': {
      const items = value as DailyReportSections['materialsDeliveries'];
      return (
        <ul className="space-y-1.5">
          {items.map((m, i) => (
            <li key={i} className={itemCls}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium text-foreground">{m.material || 'Material not stated'}</span>
                {m.quantity !== null && <Num value={m.quantity} unit={m.unit} flagged={f(i, 'quantity')} />}
              </div>
              <Line label="Supplier">{m.supplier}</Line>
              {m.notes && <p className="text-sm text-muted-foreground">{m.notes}</p>}
            </li>
          ))}
        </ul>
      );
    }
    case 'visitorsInstructions': {
      const items = value as DailyReportSections['visitorsInstructions'];
      return (
        <ul className="space-y-1.5">
          {items.map((v, i) => (
            <li key={i} className={itemCls}>
              <p className="text-sm font-medium text-foreground">
                {v.name || 'Visitor'}{v.organisation ? <span className="font-normal text-muted-foreground"> · {v.organisation}</span> : null}
              </p>
              <Text>{v.purposeOrInstruction}</Text>
            </li>
          ))}
        </ul>
      );
    }
    case 'tomorrowPlan': {
      const items = value as DailyReportSections['tomorrowPlan'];
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((p, i) => <li key={i} className="whitespace-pre-wrap">{p.description}</li>)}
        </ul>
      );
    }
    case 'remarks':
      return <Text>{value as string}</Text>;
    default:
      return null;
  }
}
