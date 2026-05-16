/**
 * Reports screen — Phase 3 + 1C (Daily Site Report)
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { useAuthStore } from '../../src/store/auth.store';
import { reportsApi, ReportType, ReportFormat, ReportData } from '../../src/api/reports';
import { projectsApi } from '../../src/api/projects';
import { Project, JobSite } from '../../src/types';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';

// ─── Report catalogue (RBAC per role) ─────────────────────────────────────────

interface ReportMeta {
  type:          ReportType;
  title:         string;
  description:   string;
  roles:         string[];
  needsFilters?: boolean;
}

const REPORTS: ReportMeta[] = [
  { type: 'labour',         title: 'Labour Report',       description: 'Hours, wages and worker activity',                                           roles: ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'] },
  { type: 'deliveries',     title: 'Deliveries Report',   description: 'Material deliveries and status',                                             roles: ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'] },
  { type: 'invoices',       title: 'Invoices Report',     description: 'All invoices and payment status',                                            roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'budget',         title: 'Budget Report',       description: 'Budget vs actuals by project',                                               roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'contractors',    title: 'Contractors Report',  description: 'Contractor schedules and progress',                                          roles: ['company_admin', 'project_manager', 'site_supervisor']                    },
  { type: 'consultants',    title: 'Consultants Report',  description: 'Consultant costs and instructions',                                          roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'project-health', title: 'Project Health',      description: 'Overall project health dashboard',                                           roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  {
    type:         'daily-site-report',
    title:        'Daily Site Report',
    description:  'Attendance, deliveries, materials, instructions and schedule for one site',
    roles:        ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'],
    needsFilters: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const d   = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── In-app report viewer ─────────────────────────────────────────────────────

function ReportViewer({
  report,
  onClose,
  backLabel = '← Reports',
}: {
  report:     ReportData;
  onClose:    () => void;
  backLabel?: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.viewerScroll} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backText}>{backLabel}</Text>
      </TouchableOpacity>

      <Text style={styles.reportTitle}>{report.title}</Text>
      <Text style={styles.reportSubtitle}>{report.subtitle}</Text>
      <Text style={styles.reportMeta}>
        Generated {new Date(report.generatedAt).toLocaleString()}
      </Text>

      {/* Summary tiles */}
      {report.summary.length > 0 && (
        <View style={styles.summaryGrid}>
          {report.summary.map((s, i) => (
            <View key={i} style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{s.value}</Text>
              <Text style={styles.summaryLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Data table */}
      {report.columns.length > 0 && report.rows.length > 0 && (
        <Card style={styles.tableCard}>
          <View style={styles.tableHeader}>
            {report.columns.map((col, i) => (
              <Text key={i} style={[styles.tableHeaderCell, { flex: i === 0 ? 2 : 1 }]}>
                {col}
              </Text>
            ))}
          </View>
          {report.rows.slice(0, 50).map((row, ri) => (
            <View key={ri} style={[styles.tableRow, ri % 2 === 0 && styles.tableRowAlt]}>
              {row.map((cell, ci) => (
                <Text
                  key={ci}
                  style={[styles.tableCell, { flex: ci === 0 ? 2 : 1 }]}
                  numberOfLines={2}
                >
                  {cell}
                </Text>
              ))}
            </View>
          ))}
          {report.rows.length > 50 && (
            <Text style={styles.tableTruncated}>
              Showing first 50 of {report.rows.length} rows. Export as CSV for full data.
            </Text>
          )}
        </Card>
      )}

      {report.rows.length === 0 && (
        <Text style={styles.emptyText}>No data available for this report.</Text>
      )}
    </ScrollView>
  );
}

// ─── Daily Site Report — specialized operational viewer ──────────────────────

type DSRCardColor = 'green' | 'amber' | 'red' | 'blue';

const DSR_PALETTE: Record<DSRCardColor, { border: string; bg: string; textColor: string }> = {
  green: { border: '#22c55e', bg: '#052e16', textColor: '#4ade80' },
  amber: { border: '#f59e0b', bg: '#431407', textColor: '#fbbf24' },
  red:   { border: '#ef4444', bg: '#450a0a', textColor: '#f87171' },
  blue:  { border: '#3b82f6', bg: '#172554', textColor: '#93c5fd' },
};

// Complete verbatim copy of every role's tab list from (tabs)/_layout.tsx.
// If the layout changes, update this block to match.
const ROLE_TABS: Record<string, string[]> = {
  company_admin:   ['dashboard', 'projects', 'inventory', 'schedule', 'invoices', 'reports', 'notifications', 'profile'],
  project_manager: ['dashboard', 'projects', 'labour', 'deliveries', 'inventory', 'schedule', 'reports', 'notifications', 'profile'],
  site_supervisor: ['index', 'labour', 'deliveries', 'inventory', 'attendance', 'schedule', 'profile'],
  finance_officer: ['dashboard', 'deliveries', 'inventory', 'invoices', 'reports', 'notifications', 'profile'],
  consultant:      ['dashboard', 'projects', 'instructions', 'notifications', 'profile'],
  worker:          ['index', 'attendance', 'schedule', 'notifications', 'profile'],
  contractor:      ['dashboard', 'projects', 'schedule', 'attendance', 'notifications', 'profile'],
  viewer:          ['dashboard', 'projects', 'schedule', 'attendance', 'notifications', 'profile'],
};

function canNav(role: string, tab: string): boolean {
  return (ROLE_TABS[role] ?? []).includes(tab);
}

function DSRCard({
  label,
  value,
  color,
  note,
  onPress,
}: {
  label:    string;
  value:    string;
  color:    DSRCardColor;
  note?:    string;
  onPress?: () => void;
}) {
  const c = DSR_PALETTE[color];
  const body = (
    <>
      <Text style={[dsr2.cardValue, { color: c.textColor }]}>{value}</Text>
      <Text style={dsr2.cardLabel}>{label}</Text>
      {!!note && <Text style={dsr2.cardNote}>{note}</Text>}
      {!!onPress && <Text style={dsr2.cardTap}>Tap to view →</Text>}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        style={[dsr2.card, { borderColor: c.border, backgroundColor: c.bg }]}
        onPress={onPress}
        activeOpacity={0.72}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return (
    <View style={[dsr2.card, { borderColor: c.border, backgroundColor: c.bg }]}>
      {body}
    </View>
  );
}

function DSRSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={dsr2.section}>
      <Text style={dsr2.sectionTitle}>{title}</Text>
      <View style={dsr2.cardGrid}>{children}</View>
    </View>
  );
}

function DailySiteReportViewer({
  report,
  onClose,
}: {
  report:  ReportData;
  onClose: () => void;
}) {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const role   = user?.role ?? null;

  const num = (label: string): number => {
    const item = report.summary.find((s) => s.label === label);
    return item ? Number(item.value) : 0;
  };
  const str = (label: string): string =>
    report.summary.find((s) => s.label === label)?.value ?? '0';
  const rowNote = (metric: string): string =>
    report.rows.find((r) => r[0] === metric)?.[2] ?? '';

  const nav = (tab: string) => {
    const ok = role !== null && canNav(role, tab);
    return ok
      ? () => router.push(`/(tabs)/${tab}` as Parameters<typeof router.push>[0])
      : undefined;
  };

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

  return (
    <ScrollView contentContainerStyle={styles.viewerScroll} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backText}>{'← Daily Site Report'}</Text>
      </TouchableOpacity>

      <Text style={styles.reportTitle}>{report.title}</Text>
      <Text style={styles.reportSubtitle}>{report.subtitle}</Text>
      <Text style={styles.reportMeta}>
        Generated {new Date(report.generatedAt).toLocaleString()}
      </Text>

      {/* ── Attendance ─────────────────────────────────────────────────────── */}
      <DSRSection title="Attendance">
        <DSRCard
          label="On Site"
          value={String(workersOnSite)}
          color={workersOnSite > 0 ? 'green' : 'blue'}
          note={rowNote('Workers On Site') || undefined}
          onPress={nav('attendance')}
        />
        <DSRCard
          label="Absent"
          value={String(workersAbsent)}
          color={workersAbsent > 0 ? 'red' : 'green'}
          note={rowNote('Workers Absent') || undefined}
          onPress={nav('attendance')}
        />
        <DSRCard
          label="Late"
          value={String(workersLate)}
          color={workersLate > 0 ? 'amber' : 'green'}
          onPress={nav('attendance')}
        />
      </DSRSection>

      {/* ── Labour ─────────────────────────────────────────────────────────── */}
      <DSRSection title="Labour">
        <DSRCard
          label="Hours Today"
          value={labourHours}
          color="blue"
          onPress={nav('labour')}
        />
        <DSRCard
          label="Attendance Rate"
          value={`${attendanceRateToday}%`}
          color={attendanceRateToday < 70 ? 'red' : attendanceRateToday <= 85 ? 'amber' : 'green'}
          onPress={nav('attendance')}
        />
        <DSRCard
          label="Overtime Entries"
          value={String(overtimeEntriesToday)}
          color={overtimeEntriesToday > 0 ? 'amber' : 'green'}
          note={overtimeEntriesToday > 0 ? 'Hours worked > 8' : undefined}
          onPress={nav('labour')}
        />
        <DSRCard
          label="Late Workers"
          value={String(lateWorkersToday)}
          color={lateWorkersToday > 0 ? 'amber' : 'green'}
          onPress={nav('attendance')}
        />
      </DSRSection>

      {/* ── Deliveries ─────────────────────────────────────────────────────── */}
      <DSRSection title="Deliveries">
        <DSRCard
          label="Received Today"
          value={String(delivReceived)}
          color="blue"
          onPress={nav('deliveries')}
        />
        <DSRCard
          label="Pending"
          value={String(delivPending)}
          color={delivPending > 0 ? 'amber' : 'green'}
          note={delivPending > 0 ? rowNote('Deliveries Pending') || undefined : undefined}
          onPress={nav('deliveries')}
        />
      </DSRSection>

      {/* ── Materials ──────────────────────────────────────────────────────── */}
      <DSRSection title="Materials">
        <DSRCard
          label="Usage Transactions"
          value={String(matTransactions)}
          color="blue"
          note={rowNote('Material Usage Transactions') || undefined}
          onPress={nav('inventory')}
        />
        <DSRCard
          label="Low Stock Items"
          value={String(lowStock)}
          color={lowStock > 0 ? 'amber' : 'green'}
          note={lowStock > 0 ? 'Check inventory' : undefined}
          onPress={nav('inventory')}
        />
      </DSRSection>

      {/* ── Procurement ────────────────────────────────────────────────────── */}
      <DSRSection title="Procurement">
        <DSRCard
          label="Pending Deliveries"
          value={String(pendingDeliveriesForSite)}
          color={pendingDeliveriesForSite > 0 ? 'amber' : 'green'}
          note={pendingDeliveriesForSite > 0 ? 'Awaiting inspection' : undefined}
          onPress={nav('deliveries')}
        />
        <DSRCard
          label="Rejected (30d)"
          value={String(rejectedDeliveriesForSite)}
          color={rejectedDeliveriesForSite > 0 ? 'red' : 'green'}
          onPress={nav('deliveries')}
        />
        <DSRCard
          label="Damaged (30d)"
          value={String(damagedDeliveriesForSite)}
          color={damagedDeliveriesForSite > 0 ? 'red' : 'green'}
          note={damagedDeliveriesForSite > 0 ? 'Damaged / partial / incorrect' : undefined}
          onPress={nav('deliveries')}
        />
        <DSRCard
          label="No Reorder"
          value={String(materialsNoDelivery)}
          color={materialsNoDelivery > 0 ? 'red' : 'green'}
          note={materialsNoDelivery > 0 ? 'Low stock — no pending delivery' : undefined}
          onPress={nav('inventory')}
        />
      </DSRSection>

      {/* ── Instructions — non-clickable for all DSR roles ──────────────────
           The instructions tab is only visible to the consultant role, which
           cannot access the daily-site-report. No safe direct route exists. */}
      <DSRSection title="Instructions">
        <DSRCard
          label="Open"
          value={String(openInstructions)}
          color={openInstructions > 0 ? 'amber' : 'green'}
          note="Open from site details"
        />
        <DSRCard
          label="Critical"
          value={String(criticalInstructions)}
          color={criticalInstructions > 0 ? 'red' : 'green'}
          note={criticalInstructions > 0 ? 'Requires immediate attention' : 'Open from site details'}
        />
      </DSRSection>

      {/* ── Schedule ───────────────────────────────────────────────────────── */}
      <DSRSection title="Schedule">
        <DSRCard
          label="In Progress"
          value={String(tasksInProgress)}
          color="blue"
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Completed"
          value={String(tasksCompleted)}
          color={tasksCompleted > 0 ? 'green' : 'blue'}
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Delayed"
          value={String(tasksDelayed)}
          color={tasksDelayed > 0 ? 'red' : 'green'}
          note={tasksDelayed > 0 ? 'Past planned end date' : undefined}
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Due Today"
          value={String(tasksDueToday)}
          color={tasksDueToday > 0 ? 'amber' : 'green'}
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Overdue"
          value={String(tasksOverdue)}
          color={tasksOverdue > 0 ? 'red' : 'green'}
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Blocked"
          value={String(tasksBlocked)}
          color={tasksBlocked > 0 ? 'red' : 'green'}
          note={tasksBlocked > 0 ? 'Investigate blockers' : undefined}
          onPress={nav('schedule')}
        />
        <DSRCard
          label="Behind Plan"
          value={String(tasksBehindPlan)}
          color={tasksBehindPlan > 0 ? 'amber' : 'green'}
          note={tasksBehindPlan > 0 ? 'Progress 10+ pts below planned' : undefined}
          onPress={nav('schedule')}
        />
      </DSRSection>
    </ScrollView>
  );
}

// ─── Daily Site Report — form + viewer ───────────────────────────────────────

function DailySiteReportView({ onBack }: { onBack: () => void }) {
  const [projects,        setProjects]        = useState<Project[]>([]);
  const [sites,           setSites]           = useState<JobSite[]>([]);
  const [projectId,       setProjectId]       = useState('');
  const [siteId,          setSiteId]          = useState('');
  const [date,            setDate]            = useState(todayLocal);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingReport,   setLoadingReport]   = useState(false);
  const [report,          setReport]          = useState<ReportData | null>(null);

  useEffect(() => {
    void projectsApi.list()
      .then(setProjects)
      .catch(() => Alert.alert('Error', 'Failed to load projects.'))
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => {
    if (!projectId) { setSites([]); setSiteId(''); return; }
    setSiteId('');
    setSites([]);
    void projectsApi.listSites(projectId)
      .then(setSites)
      .catch(() => Alert.alert('Error', 'Failed to load sites.'));
  }, [projectId]);

  async function generate() {
    if (!projectId || !siteId || !date) return;
    setLoadingReport(true);
    try {
      const data = await reportsApi.getJson('daily-site-report', {
        projectId,
        siteId,
        startDate: date,
      });
      setReport(data);
    } catch {
      Alert.alert('Error', 'Failed to generate report. Check that the date is valid (YYYY-MM-DD).');
    } finally {
      setLoadingReport(false);
    }
  }

  const canGenerate = !!projectId && !!siteId && date.length === 10;

  if (report) {
    return <DailySiteReportViewer report={report} onClose={() => setReport(null)} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.viewerScroll} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>{'← Reports'}</Text>
      </TouchableOpacity>

      <Text style={styles.reportTitle}>Daily Site Report</Text>
      <Text style={styles.reportSubtitle}>
        Attendance, deliveries, materials, instructions and schedule for one site
      </Text>

      {/* ── Project ─────────────────────────────────────────────────────── */}
      <Text style={dsr.sectionLabel}>Project</Text>
      {loadingProjects ? (
        <ActivityIndicator color="#3b82f6" style={dsr.spinner} />
      ) : projects.length === 0 ? (
        <Text style={dsr.noItems}>No projects available.</Text>
      ) : (
        <View style={dsr.chipRow}>
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[dsr.chip, projectId === p.id && dsr.chipSelected]}
              onPress={() => setProjectId(p.id)}
            >
              <Text style={[dsr.chipText, projectId === p.id && dsr.chipTextSelected]}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Site ─────────────────────────────────────────────────────────── */}
      {projectId !== '' && (
        <>
          <Text style={dsr.sectionLabel}>Site</Text>
          {sites.length === 0 ? (
            <Text style={dsr.noItems}>No sites for this project.</Text>
          ) : (
            <View style={dsr.chipRow}>
              {sites.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[dsr.chip, siteId === s.id && dsr.chipSelected]}
                  onPress={() => setSiteId(s.id)}
                >
                  <Text style={[dsr.chipText, siteId === s.id && dsr.chipTextSelected]}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {/* ── Date ─────────────────────────────────────────────────────────── */}
      <Text style={dsr.sectionLabel}>Date</Text>
      <TextInput
        style={dsr.dateInput}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#64748b"
        maxLength={10}
      />

      {/* ── Prompt / Generate ─────────────────────────────────────────────── */}
      {!canGenerate ? (
        <Text style={dsr.prompt}>
          Select project, site and date to generate the report.
        </Text>
      ) : (
        <TouchableOpacity
          style={[dsr.generateBtn, loadingReport && dsr.generateBtnBusy]}
          onPress={() => void generate()}
          disabled={loadingReport}
        >
          {loadingReport
            ? <ActivityIndicator color="#fff" />
            : <Text style={dsr.generateBtnText}>Generate Report</Text>
          }
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const user = useAuthStore((s) => s.user)!;

  const [view,        setView]        = useState<'list' | 'daily-site-form'>('list');
  const [loading,     setLoading]     = useState<ReportType | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [reportData,  setReportData]  = useState<ReportData | null>(null);

  const visibleReports = REPORTS.filter((r) => r.roles.includes(user.role));

  async function handleView(type: ReportType) {
    setLoading(type);
    try {
      const data = await reportsApi.getJson(type);
      setReportData(data);
    } catch {
      Alert.alert('Error', 'Failed to load report. Please try again.');
    } finally {
      setLoading(null);
    }
  }

  async function handleDownload(type: ReportType, format: 'pdf' | 'csv') {
    const key = `${type}-${format}`;
    setDownloading(key);
    try {
      const localUri = await reportsApi.downloadFile(type, format);
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri);
        await Linking.openURL(contentUri);
      } catch {
        await Linking.openURL(localUri);
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'Download failed';
      Alert.alert('Download Failed', msg);
    } finally {
      setDownloading(null);
    }
  }

  // ── Daily Site Report form ───────────────────────────────────────────────
  if (view === 'daily-site-form') {
    return (
      <Screen>
        <DailySiteReportView onBack={() => setView('list')} />
      </Screen>
    );
  }

  // ── Standard report viewer ───────────────────────────────────────────────
  if (reportData) {
    return (
      <Screen>
        <ReportViewer report={reportData} onClose={() => setReportData(null)} />
      </Screen>
    );
  }

  // ── Report catalogue ─────────────────────────────────────────────────────
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.heading}>Reports</Text>
      </View>
      <Text style={styles.subheading}>Select a report to view or export</Text>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {visibleReports.map((meta) => {
          const isViewing     = loading === meta.type;
          const isDownloadPDF = downloading === `${meta.type}-pdf`;
          const isDownloadCSV = downloading === `${meta.type}-csv`;
          const isBusy        = isViewing || isDownloadPDF || isDownloadCSV;

          return (
            <Card key={meta.type} style={styles.reportCard}>
              <View style={styles.reportCardTop}>
                <View style={styles.reportCardText}>
                  <Text style={styles.reportCardTitle}>{meta.title}</Text>
                  <Text style={styles.reportCardDesc}>{meta.description}</Text>
                </View>
              </View>
              <View style={styles.reportCardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, isBusy && styles.actionBtnDisabled]}
                  onPress={meta.needsFilters
                    ? () => setView('daily-site-form')
                    : () => void handleView(meta.type)
                  }
                  disabled={isBusy && !meta.needsFilters}
                >
                  {isViewing
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : <Text style={styles.actionBtnText}>View</Text>
                  }
                </TouchableOpacity>
                {!meta.needsFilters && (
                  <>
                    <TouchableOpacity
                      style={[styles.actionBtn, isBusy && styles.actionBtnDisabled]}
                      onPress={() => void handleDownload(meta.type, 'pdf')}
                      disabled={isBusy}
                    >
                      {isDownloadPDF
                        ? <ActivityIndicator size="small" color="#3b82f6" />
                        : <Text style={styles.actionBtnText}>PDF</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, isBusy && styles.actionBtnDisabled]}
                      onPress={() => void handleDownload(meta.type, 'csv')}
                      disabled={isBusy}
                    >
                      {isDownloadCSV
                        ? <ActivityIndicator size="small" color="#3b82f6" />
                        : <Text style={styles.actionBtnText}>CSV</Text>
                      }
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </Card>
          );
        })}

        {visibleReports.length === 0 && (
          <Text style={styles.emptyText}>No reports available for your role.</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  heading:    { color: '#f1f5f9', fontSize: 24, fontWeight: '700' },
  subheading: { color: '#64748b', fontSize: 13, paddingHorizontal: 16, marginBottom: 12 },
  scroll:     { padding: 16, paddingBottom: 40 },

  reportCard:        { marginBottom: 12 },
  reportCardTop:     { marginBottom: 10 },
  reportCardText:    { flex: 1 },
  reportCardTitle:   { color: '#f1f5f9', fontSize: 15, fontWeight: '700', marginBottom: 3 },
  reportCardDesc:    { color: '#94a3b8', fontSize: 12 },
  reportCardActions: { flexDirection: 'row', gap: 8 },

  actionBtn:         { flex: 1, paddingVertical: 9, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', minHeight: 36 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText:     { color: '#3b82f6', fontSize: 13, fontWeight: '700' },

  viewerScroll:   { padding: 16, paddingBottom: 40 },
  backBtn:        { marginBottom: 16 },
  backText:       { color: '#3b82f6', fontSize: 14, fontWeight: '600' },
  reportTitle:    { color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  reportSubtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  reportMeta:     { color: '#64748b', fontSize: 11, marginBottom: 16 },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  summaryTile: { flex: 1, minWidth: 100, backgroundColor: '#1e293b', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  summaryValue:{ color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 2 },
  summaryLabel:{ color: '#94a3b8', fontSize: 10, fontWeight: '600', textAlign: 'center', textTransform: 'uppercase' },

  tableCard:       { marginBottom: 16, padding: 0, overflow: 'hidden' },
  tableHeader:     { flexDirection: 'row', backgroundColor: '#0f172a', paddingHorizontal: 12, paddingVertical: 8 },
  tableHeaderCell: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  tableRow:        { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  tableRowAlt:     { backgroundColor: '#0f172a' },
  tableCell:       { color: '#cbd5e1', fontSize: 11 },
  tableTruncated:  { color: '#64748b', fontSize: 11, textAlign: 'center', padding: 10 },

  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 32 },
});

const dsr = StyleSheet.create({
  sectionLabel:     { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip:             { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b' },
  chipSelected:     { borderColor: '#3b82f6', backgroundColor: '#172554' },
  chipText:         { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#93c5fd' },
  dateInput:        { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: '#f1f5f9', fontSize: 14 },
  generateBtn:      { backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  generateBtnBusy:  { opacity: 0.7 },
  generateBtnText:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  prompt:           { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 28 },
  noItems:          { color: '#64748b', fontSize: 13, marginTop: 4 },
  spinner:          { marginVertical: 12 },
});

const dsr2 = StyleSheet.create({
  section:      { marginBottom: 20 },
  sectionTitle: { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  cardGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card:         { flex: 1, minWidth: 100, borderRadius: 10, padding: 12, borderWidth: 1.5, alignItems: 'center' },
  cardValue:    { fontSize: 26, fontWeight: '800', marginBottom: 2 },
  cardLabel:    { color: '#94a3b8', fontSize: 10, fontWeight: '600', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardNote:     { color: '#64748b', fontSize: 9, textAlign: 'center', marginTop: 4 },
  cardTap:      { color: '#3b82f6', fontSize: 9, fontWeight: '600', textAlign: 'center', marginTop: 6, letterSpacing: 0.3 },
});
