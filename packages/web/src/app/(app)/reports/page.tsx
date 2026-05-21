'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { reportApi, projectApi, siteApi, ApiError } from '@/lib/api';
import { ReportData, ReportType, ReportFormat, UserRole } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  FileText, Download, RefreshCw, AlertCircle,
  FileSpreadsheet, File,
} from 'lucide-react';

// ─── Report catalogue ─────────────────────────────────────────────────────────

interface ReportConfig {
  type:        ReportType;
  label:       string;
  description: string;
  roles:       UserRole[];
  isDSR?:      true;       // daily-site-report needs project + site + date
}

const REPORT_CONFIGS: ReportConfig[] = [
  {
    type:        'labour',
    label:       'Labour',
    description: 'Worker hours and daily rates by date range',
    roles:       ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'],
  },
  {
    type:        'budget',
    label:       'Budget',
    description: 'Budget line items, committed amounts and actual spend',
    roles:       ['company_admin', 'finance_officer', 'project_manager'],
  },
  {
    type:        'invoices',
    label:       'Invoices',
    description: 'Invoice status, values and payment progress',
    roles:       ['company_admin', 'finance_officer', 'project_manager', 'contractor', 'consultant'],
  },
  {
    type:        'deliveries',
    label:       'Deliveries',
    description: 'Delivery records, inspection and acceptance status',
    roles:       ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'],
  },
  {
    type:        'contractors',
    label:       'Contractors',
    description: 'Active contractors and their schedule summary',
    roles:       ['company_admin', 'project_manager', 'site_supervisor'],
  },
  {
    type:        'consultants',
    label:       'Consultants',
    description: 'Consultant instructions, priority and resolution status',
    roles:       ['company_admin', 'project_manager', 'consultant'],
  },
  {
    type:        'project-health',
    label:       'Project Health',
    description: 'Project overview with budget, invoices, deliveries and open instructions',
    roles:       ['company_admin', 'finance_officer', 'project_manager'],
  },
  {
    type:        'daily-site-report',
    label:       'Daily Site',
    description: 'Operational snapshot — attendance, deliveries, materials, instructions and schedule for one site',
    roles:       ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'],
    isDSR:       true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ─── Generic report sub-components ───────────────────────────────────────────

function SummaryBadges({ summary }: { summary: ReportData['summary'] }) {
  if (!summary.length) return null;
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {summary.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-center min-w-[100px]">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className="font-semibold text-sm text-foreground">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({ data }: { data: ReportData }) {
  if (!data.rows.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 text-center">
        <FileText className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-semibold text-foreground">No data found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your filters or date range.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {data.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Daily Site Report — operational viewer ───────────────────────────────────

type DSRColor = 'green' | 'amber' | 'red' | 'blue';

const DSR_STYLE: Record<DSRColor, { border: string; bg: string; value: string }> = {
  green: { border: 'border-green-500/40',  bg: 'bg-green-950/25',  value: 'text-green-400'  },
  amber: { border: 'border-amber-500/40',  bg: 'bg-amber-950/25',  value: 'text-amber-400'  },
  red:   { border: 'border-red-500/40',    bg: 'bg-red-950/25',    value: 'text-red-400'    },
  blue:  { border: 'border-blue-500/40',   bg: 'bg-blue-950/25',   value: 'text-blue-400'   },
};

function DSRCard({
  label, value, color, note,
}: {
  label:  string;
  value:  string | number;
  color:  DSRColor;
  note?:  string;
}) {
  const s = DSR_STYLE[color];
  return (
    <div className={`flex-1 min-w-[120px] rounded-xl border ${s.border} ${s.bg} px-4 py-3 flex flex-col items-center text-center`}>
      <span className={`text-3xl font-extrabold ${s.value}`}>{value}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {note && <span className="mt-1.5 text-[9px] text-muted-foreground/60 leading-snug">{note}</span>}
    </div>
  );
}

function DSRSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        {title}
      </p>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

const EXEC_STATUS_STYLE: Record<string, { badge: string; reason: string }> = {
  delayed:     { badge: 'bg-amber-950/40 border-amber-500/40 text-amber-400',  reason: 'text-amber-400'  },
  blocked:     { badge: 'bg-red-950/40 border-red-500/40 text-red-400',        reason: 'text-red-400'    },
  in_progress: { badge: 'bg-blue-950/40 border-blue-500/40 text-blue-400',     reason: 'text-blue-400'   },
  completed:   { badge: 'bg-green-950/40 border-green-500/40 text-green-400',  reason: 'text-green-400'  },
  not_started: { badge: 'bg-slate-900/40 border-slate-500/40 text-slate-400',  reason: 'text-slate-400'  },
};

const ACT_TYPE_LABELS: Record<string, string> = {
  status_change:   'Status Change',
  progress_update: 'Progress Update',
  delay_reason:    'Delay Reason',
  block_reason:    'Block Reason',
  note_update:     'Note Added',
};

function ScheduleActivityList({ data }: { data: ReportData }) {
  const activities = data.rows.filter((r) => r[0]?.startsWith('Activity: '));
  if (activities.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        Schedule Activity Today
      </p>
      <div className="space-y-1.5">
        {activities.map((r, i) => {
          const rawType   = (r[0] ?? '').slice(10);
          const taskTitle = r[1] ?? '';
          const userName  = r[2] ?? '';
          const time      = r[3] ?? '';
          const preview   = r[4] ?? '';
          const typeLabel = ACT_TYPE_LABELS[rawType] ?? rawType.replace(/_/g, ' ');
          return (
            <div key={i} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold text-blue-400">{typeLabel}</span>
                <span className="text-[10px] text-muted-foreground/60">{time}</span>
              </div>
              <p className="text-xs font-medium text-foreground truncate">{taskTitle}</p>
              {userName && <p className="text-[10px] text-muted-foreground/60">{userName}</p>}
              {preview  && <p className="text-[10px] text-muted-foreground/70 italic line-clamp-1">{preview}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleExecList({ data }: { data: ReportData }) {
  const tasks = data.rows.filter((r) => r[0]?.startsWith('Task: '));
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        Schedule Details
      </p>
      <div className="space-y-2">
        {tasks.map((r, i) => {
          const title       = (r[0] ?? '').slice(6);
          const status      = r[1] ?? '';
          const actualPct   = r[2] ? `${r[2]}%` : null;
          const plannedPct  = r[3] ? `${r[3]}%` : null;
          const plannedEnd  = r[4] ?? '';
          const actualStart = r[5] ?? '';
          const actualEnd   = r[6] ?? '';
          const reason      = r[7] ?? '';
          const notes       = r[8] ?? '';
          const s = EXEC_STATUS_STYLE[status] ?? EXEC_STATUS_STYLE['not_started']!;
          const statusLabel = status.replace(/_/g, ' ');
          return (
            <div key={i} className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
              <div className="flex items-start gap-2 mb-1.5">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${s.badge}`}>
                  {statusLabel}
                </span>
                <span className="text-sm font-medium text-foreground leading-tight">{title}</span>
              </div>
              {(actualPct !== null || plannedPct !== null) && (
                <p className="text-xs text-muted-foreground">
                  Progress: {actualPct ?? '—'} actual / {plannedPct ?? '—'} planned
                </p>
              )}
              {(actualStart || actualEnd) && (
                <p className="text-xs text-muted-foreground/60">
                  Actual: {actualStart || '?'}{actualEnd ? ` – ${actualEnd}` : ''}
                </p>
              )}
              {plannedEnd && (
                <p className="text-xs text-muted-foreground/60">Due: {plannedEnd}</p>
              )}
              {reason && (
                <p className={`text-xs mt-1 ${s.reason}`}>
                  {status === 'blocked' ? 'Block' : 'Delay'}: {reason}
                </p>
              )}
              {notes && (
                <p className="text-[11px] text-muted-foreground/70 mt-1 italic line-clamp-2">{notes}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MaterialUsageList({ data }: { data: ReportData }) {
  const usages = data.rows.filter((r) => r[0]?.startsWith('Usage: '));
  if (usages.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        Material Usage Today
      </p>
      <div className="space-y-1.5">
        {usages.map((r, i) => {
          const material = (r[0] ?? '').slice(7);
          const qty      = r[1] ?? '';
          const reason   = r[2] ?? '';
          const area     = r[3] ?? '';
          const user     = r[4] ?? '';
          const note     = r[5] ?? '';
          return (
            <div key={i} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-semibold text-foreground truncate mr-2">{material}</span>
                <span className="text-[11px] font-bold text-green-400 shrink-0">{qty}</span>
              </div>
              {(reason || area) && (
                <p className="text-[10px] text-muted-foreground/70">
                  {reason}{reason && area ? ` · ${area}` : area}
                </p>
              )}
              {user && <p className="text-[10px] text-muted-foreground/60">{user}</p>}
              {note && <p className="text-[10px] text-muted-foreground/70 italic line-clamp-1">{note}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailySiteReportViewer({ data }: { data: ReportData }) {
  const num = (label: string): number => {
    const item = data.summary.find((s) => s.label === label);
    return item ? Number(item.value) : 0;
  };
  const str = (label: string): string =>
    data.summary.find((s) => s.label === label)?.value ?? '0';
  const rowNote = (metric: string): string =>
    data.rows.find((r) => r[0] === metric)?.[2] ?? '';

  const workersOnSite        = num('Workers On Site');
  const workersAbsent        = num('Workers Absent');
  const workersLate          = num('Workers Late');
  const attendanceRateToday  = num('Attendance Rate Today');
  const labourHours          = str('Labour Hours Today');
  const overtimeEntriesToday = num('Overtime Entries Today');
  const lateWorkersToday     = num('Late Workers Today');
  const delivReceived        = num('Deliveries Received Today');
  const delivPending         = num('Deliveries Pending');
  const matTransactions           = num('Material Usage Transactions');
  const lowStock                  = num('Low-Stock Items');
  const pendingDeliveriesForSite  = num('Pending Deliveries For Site');
  const rejectedDeliveriesForSite = num('Rejected Deliveries For Site');
  const damagedDeliveriesForSite  = num('Damaged Deliveries For Site');
  const materialsNoDelivery       = num('Materials With No Delivery');
  const openInstructions          = num('Open Instructions');
  const criticalInstructions = num('Critical Instructions');
  const tasksInProgress      = num('Tasks In Progress');
  const tasksCompleted       = num('Tasks Completed');
  const tasksDelayed         = num('Tasks Delayed');
  const tasksDueToday        = num('Tasks Due Today');
  const tasksOverdue         = num('Tasks Overdue');
  const tasksBlocked         = num('Tasks Blocked');
  const tasksBehindPlan      = num('Tasks Behind Plan');
  const scheduleUpdatesTotal = num('Schedule Updates Today');
  const statusChangesToday   = num('Status Changes Today');
  const progressUpdatesToday = num('Progress Updates Today');
  const delayBlockNotes      = num('Delay/Block Notes Today');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-3">
        <span className="font-medium">{data.subtitle}</span>
        <span>Generated: {new Date(data.generatedAt).toLocaleString()}</span>
      </div>

      {/* ── Attendance ──────────────────────────────────────────────────── */}
      <DSRSection title="Attendance">
        <DSRCard
          label="On Site"
          value={workersOnSite}
          color={workersOnSite > 0 ? 'green' : 'blue'}
          note={rowNote('Workers On Site') || undefined}
        />
        <DSRCard
          label="Absent"
          value={workersAbsent}
          color={workersAbsent > 0 ? 'red' : 'green'}
          note={rowNote('Workers Absent') || undefined}
        />
        <DSRCard
          label="Late"
          value={workersLate}
          color={workersLate > 0 ? 'amber' : 'green'}
        />
      </DSRSection>

      {/* ── Labour ──────────────────────────────────────────────────────── */}
      <DSRSection title="Labour">
        <DSRCard label="Hours Today" value={labourHours} color="blue" />
        <DSRCard
          label="Attendance Rate"
          value={`${attendanceRateToday}%`}
          color={attendanceRateToday < 70 ? 'red' : attendanceRateToday <= 85 ? 'amber' : 'green'}
        />
        <DSRCard
          label="Overtime Entries"
          value={overtimeEntriesToday}
          color={overtimeEntriesToday > 0 ? 'amber' : 'green'}
          note={overtimeEntriesToday > 0 ? 'Hours worked > 8' : undefined}
        />
        <DSRCard
          label="Late Workers"
          value={lateWorkersToday}
          color={lateWorkersToday > 0 ? 'amber' : 'green'}
        />
      </DSRSection>

      {/* ── Deliveries ──────────────────────────────────────────────────── */}
      <DSRSection title="Deliveries">
        <DSRCard label="Received Today" value={delivReceived} color="blue" />
        <DSRCard
          label="Pending"
          value={delivPending}
          color={delivPending > 0 ? 'amber' : 'green'}
          note={delivPending > 0 ? rowNote('Deliveries Pending') || undefined : undefined}
        />
      </DSRSection>

      {/* ── Materials ───────────────────────────────────────────────────── */}
      <DSRSection title="Materials">
        <DSRCard
          label="Usage Transactions"
          value={matTransactions}
          color="blue"
          note={rowNote('Material Usage Transactions') || undefined}
        />
        <DSRCard
          label="Low Stock Items"
          value={lowStock}
          color={lowStock > 0 ? 'amber' : 'green'}
          note={lowStock > 0 ? 'Check inventory' : undefined}
        />
      </DSRSection>

      <MaterialUsageList data={data} />

      {/* ── Procurement ─────────────────────────────────────────────────── */}
      <DSRSection title="Procurement">
        <DSRCard
          label="Pending Deliveries"
          value={pendingDeliveriesForSite}
          color={pendingDeliveriesForSite > 0 ? 'amber' : 'green'}
          note={pendingDeliveriesForSite > 0 ? 'Awaiting inspection' : undefined}
        />
        <DSRCard
          label="Rejected (30d)"
          value={rejectedDeliveriesForSite}
          color={rejectedDeliveriesForSite > 0 ? 'red' : 'green'}
        />
        <DSRCard
          label="Damaged (30d)"
          value={damagedDeliveriesForSite}
          color={damagedDeliveriesForSite > 0 ? 'red' : 'green'}
          note={damagedDeliveriesForSite > 0 ? 'Damaged / partial / incorrect' : undefined}
        />
        <DSRCard
          label="No Reorder"
          value={materialsNoDelivery}
          color={materialsNoDelivery > 0 ? 'red' : 'green'}
          note={materialsNoDelivery > 0 ? 'Low stock — no pending delivery' : undefined}
        />
      </DSRSection>

      {/* ── Instructions ────────────────────────────────────────────────── */}
      <DSRSection title="Instructions">
        <DSRCard
          label="Open"
          value={openInstructions}
          color={openInstructions > 0 ? 'amber' : 'green'}
          note="Open from site details"
        />
        <DSRCard
          label="Critical"
          value={criticalInstructions}
          color={criticalInstructions > 0 ? 'red' : 'green'}
          note={criticalInstructions > 0 ? 'Requires immediate attention' : 'Open from site details'}
        />
      </DSRSection>

      {/* ── Schedule ────────────────────────────────────────────────────── */}
      <DSRSection title="Schedule">
        <DSRCard label="In Progress" value={tasksInProgress} color="blue" />
        <DSRCard
          label="Completed"
          value={tasksCompleted}
          color={tasksCompleted > 0 ? 'green' : 'blue'}
        />
        <DSRCard
          label="Delayed"
          value={tasksDelayed}
          color={tasksDelayed > 0 ? 'red' : 'green'}
          note={tasksDelayed > 0 ? 'Past planned end date' : undefined}
        />
        <DSRCard
          label="Due Today"
          value={tasksDueToday}
          color={tasksDueToday > 0 ? 'amber' : 'green'}
        />
        <DSRCard
          label="Overdue"
          value={tasksOverdue}
          color={tasksOverdue > 0 ? 'red' : 'green'}
        />
        <DSRCard
          label="Blocked"
          value={tasksBlocked}
          color={tasksBlocked > 0 ? 'red' : 'green'}
          note={tasksBlocked > 0 ? 'Investigate blockers' : undefined}
        />
        <DSRCard
          label="Behind Plan"
          value={tasksBehindPlan}
          color={tasksBehindPlan > 0 ? 'amber' : 'green'}
          note={tasksBehindPlan > 0 ? 'Progress 10+ pts below planned' : undefined}
        />
        <DSRCard
          label="Updates Today"
          value={scheduleUpdatesTotal}
          color={scheduleUpdatesTotal > 0 ? 'blue' : 'green'}
        />
        <DSRCard
          label="Status Changes"
          value={statusChangesToday}
          color={statusChangesToday > 0 ? 'amber' : 'green'}
        />
        <DSRCard
          label="Progress Updates"
          value={progressUpdatesToday}
          color={progressUpdatesToday > 0 ? 'blue' : 'green'}
        />
        <DSRCard
          label="Delay/Block Notes"
          value={delayBlockNotes}
          color={delayBlockNotes > 0 ? 'red' : 'green'}
        />
      </DSRSection>

      <ScheduleActivityList data={data} />
      <ScheduleExecList data={data} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);

  const defaultProjectId = user?.defaultProjectId ?? null;
  const defaultSiteId    = user?.defaultSiteId    ?? null;
  const hasDefaults      = !!(defaultProjectId && defaultSiteId);

  const visibleReports = REPORT_CONFIGS.filter(
    (r) => user && r.roles.includes(user.role as UserRole),
  );

  const [activeType,   setActiveType]   = useState<ReportType>(() => visibleReports[0]?.type ?? 'labour');
  const [projectId,    setProjectId]    = useState('');
  const [siteId,       setSiteId]       = useState('');
  const [startDate,    setStartDate]    = useState(monthStart());
  const [endDate,      setEndDate]      = useState(today());
  const [reportData,   setReportData]   = useState<ReportData | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [downloading,  setDownloading]  = useState<ReportFormat | null>(null);
  const [projects,     setProjects]     = useState<Array<{ id: string; name: string }>>([]);
  const [sites,        setSites]        = useState<Array<{ id: string; name: string }>>([]);

  const isDSR = activeType === 'daily-site-report';

  // Effective DSR context — defaults take precedence over manual selectors
  const dsrProjectId = hasDefaults ? defaultProjectId : projectId;
  const dsrSiteId    = hasDefaults ? defaultSiteId    : siteId;

  // Load project list once
  useEffect(() => {
    projectApi.list()
      .then((res) => setProjects(res.projects))
      .catch(() => {});
  }, []);

  // Load site list when DSR is active and a project is chosen
  useEffect(() => {
    if (!isDSR || !projectId) {
      setSites([]);
      if (isDSR) setSiteId('');
      return;
    }
    siteApi.list(projectId)
      .then((res) => setSites(res.sites))
      .catch(() => {});
  }, [projectId, isDSR]);

  // Standard report load (not used for DSR)
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const filters = {
        ...(projectId  && { projectId }),
        ...(siteId     && { siteId }),
        ...(startDate  && { startDate }),
        ...(endDate    && { endDate }),
      };
      const res = await reportApi.get(activeType, filters);
      setReportData(res.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [activeType, projectId, siteId, startDate, endDate]);

  // Auto-load on tab change — skip for DSR (requires explicit Generate)
  useEffect(() => {
    setReportData(null);
    setError('');
    if (!hasDefaults) setSiteId('');
    if (activeType === 'daily-site-report') {
      setStartDate(today());
    } else {
      load();
    }
  }, [activeType]); // eslint-disable-line react-hooks/exhaustive-deps

  // DSR-specific generate
  const generateDSR = useCallback(async () => {
    if (!dsrProjectId || !dsrSiteId || !startDate) return;
    setLoading(true);
    setError('');
    try {
      const res = await reportApi.get('daily-site-report', { projectId: dsrProjectId, siteId: dsrSiteId, startDate });
      setReportData(res.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, [dsrProjectId, dsrSiteId, startDate]);

  const handleDownload = async (format: ReportFormat) => {
    setDownloading(format);
    try {
      const filters = {
        ...(projectId  && { projectId }),
        ...(siteId     && { siteId }),
        ...(startDate  && { startDate }),
        ...(endDate    && { endDate }),
      };
      await reportApi.download(activeType, format, filters);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const activeConfig = REPORT_CONFIGS.find((r) => r.type === activeType);
  const dsrCanGenerate = isDSR && startDate.length === 10 && (hasDefaults || (!!projectId && !!siteId));

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Reports & Exports"
        subtitle="Generate and download reports across all modules"
      />

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-1">
        {visibleReports.map((r) => (
          <button
            key={r.type}
            onClick={() => setActiveType(r.type)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeType === r.type
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Filter bar — DSR ─────────────────────────────────────────────── */}
      {isDSR ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Project + Site selectors — shown only when user has no defaults */}
            {!hasDefaults && (
              <>
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-xs font-medium text-muted-foreground">Project *</label>
                  <select
                    value={projectId}
                    onChange={(e) => { setProjectId(e.target.value); setReportData(null); }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-xs font-medium text-muted-foreground">Site *</label>
                  <select
                    value={siteId}
                    onChange={(e) => { setSiteId(e.target.value); setReportData(null); }}
                    disabled={!projectId || sites.length === 0}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">
                      {!projectId ? 'Select a project first' : sites.length === 0 ? 'No sites found' : 'Select site…'}
                    </option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setReportData(null); }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Generate */}
            <Button
              onClick={generateDSR}
              disabled={!dsrCanGenerate || loading}
              variant="default"
              size="sm"
              className="h-9"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Generate
            </Button>
          </div>
        </div>
      ) : (
        /* ── Filter bar — standard reports ──────────────────────────────── */
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Project filter */}
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Apply */}
            <Button
              onClick={load}
              disabled={loading}
              variant="default"
              size="sm"
              className="h-9"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Apply
            </Button>

            <div className="flex-1" />

            {/* Download buttons */}
            <div className="flex gap-2">
              <Button
                onClick={() => handleDownload('csv')}
                disabled={!!downloading || loading}
                variant="outline"
                size="sm"
                className="h-9"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                {downloading === 'csv' ? 'Downloading…' : 'CSV'}
              </Button>
              <Button
                onClick={() => handleDownload('xlsx')}
                disabled={!!downloading || loading}
                variant="outline"
                size="sm"
                className="h-9"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                {downloading === 'xlsx' ? 'Downloading…' : 'Excel'}
              </Button>
              <Button
                onClick={() => handleDownload('pdf')}
                disabled={!!downloading || loading}
                variant="outline"
                size="sm"
                className="h-9"
              >
                <File className="h-4 w-4 mr-1.5" />
                {downloading === 'pdf' ? 'Downloading…' : 'PDF'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Report content ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {activeConfig?.label} Report
          </h2>
          <p className="text-sm text-muted-foreground">{activeConfig?.description}</p>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
          </div>
        )}

        {/* DSR operational layout */}
        {!loading && reportData && isDSR && (
          <DailySiteReportViewer data={reportData} />
        )}

        {/* Standard report: summary + table */}
        {!loading && reportData && !isDSR && (
          <>
            <SummaryBadges summary={reportData.summary} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{reportData.rows.length} row{reportData.rows.length !== 1 ? 's' : ''}</span>
              <span>Generated: {new Date(reportData.generatedAt).toLocaleString()}</span>
            </div>
            <PreviewTable data={reportData} />
          </>
        )}

        {/* Initial empty state */}
        {!loading && !reportData && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            {isDSR ? (
              <>
                <Download className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-semibold text-foreground">
                  {hasDefaults ? 'Select a date and click Generate' : 'Select project, site and date'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasDefaults
                    ? 'The daily site report will use your default operational context.'
                    : 'Then click Generate to view the daily site report.'}
                </p>
              </>
            ) : (
              <>
                <Download className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-semibold text-foreground">Select filters and click Apply</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use the filters above to customise your report.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
