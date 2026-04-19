'use client';

import { useEffect, useState, useCallback } from 'react';
import { reportApi, projectApi, ApiError } from '@/lib/api';
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

// ─── Config ───────────────────────────────────────────────────────────────────

interface ReportConfig {
  type:        ReportType;
  label:       string;
  description: string;
  roles:       UserRole[];
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
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);

  const visibleReports = REPORT_CONFIGS.filter(
    (r) => user && r.roles.includes(user.role as UserRole),
  );

  const [activeType, setActiveType]       = useState<ReportType>(() => visibleReports[0]?.type ?? 'labour');
  const [projectId,  setProjectId]        = useState('');
  const [siteId,     setSiteId]           = useState('');
  const [startDate,  setStartDate]        = useState(monthStart());
  const [endDate,    setEndDate]          = useState(today());
  const [reportData, setReportData]       = useState<ReportData | null>(null);
  const [loading,    setLoading]          = useState(false);
  const [error,      setError]            = useState('');
  const [downloading, setDownloading]     = useState<ReportFormat | null>(null);
  const [projects,   setProjects]         = useState<Array<{ id: string; name: string }>>([]);

  // Load project list for filter dropdown
  useEffect(() => {
    projectApi.list()
      .then((res) => setProjects(res.projects))
      .catch(() => {});
  }, []);

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

  // Load on tab change
  useEffect(() => {
    setReportData(null);
    load();
  }, [activeType]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
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

          {/* Apply button */}
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

          {/* Spacer */}
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

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Report content ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {/* Report title */}
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

        {/* Data */}
        {!loading && reportData && (
          <>
            <SummaryBadges summary={reportData.summary} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{reportData.rows.length} row{reportData.rows.length !== 1 ? 's' : ''}</span>
              <span>Generated: {new Date(reportData.generatedAt).toLocaleString()}</span>
            </div>
            <PreviewTable data={reportData} />
          </>
        )}

        {/* Initial empty state before first load */}
        {!loading && !reportData && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Download className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-semibold text-foreground">Select filters and click Apply</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the filters above to customise your report.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
