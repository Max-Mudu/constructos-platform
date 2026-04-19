/**
 * Reports screen — Phase 3
 * Available to company_admin, finance_officer, project_manager.
 * Allows viewing reports as in-app tables and downloading as PDF or CSV.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { useAuthStore } from '../../src/store/auth.store';
import { reportsApi, ReportType, ReportFormat, ReportData } from '../../src/api/reports';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';

// ─── Report catalogue (RBAC per role) ─────────────────────────────────────────

interface ReportMeta {
  type:        ReportType;
  title:       string;
  description: string;
  roles:       string[];
}

const REPORTS: ReportMeta[] = [
  { type: 'labour',         title: 'Labour Report',        description: 'Hours, wages and worker activity',      roles: ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'] },
  { type: 'deliveries',     title: 'Deliveries Report',    description: 'Material deliveries and status',        roles: ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'] },
  { type: 'invoices',       title: 'Invoices Report',      description: 'All invoices and payment status',       roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'budget',         title: 'Budget Report',        description: 'Budget vs actuals by project',          roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'contractors',    title: 'Contractors Report',   description: 'Contractor schedules and progress',     roles: ['company_admin', 'project_manager', 'site_supervisor']                    },
  { type: 'consultants',    title: 'Consultants Report',   description: 'Consultant costs and instructions',     roles: ['company_admin', 'finance_officer', 'project_manager']                    },
  { type: 'project-health', title: 'Project Health',       description: 'Overall project health dashboard',      roles: ['company_admin', 'finance_officer', 'project_manager']                    },
];

// ─── In-app report viewer ─────────────────────────────────────────────────────

function ReportViewer({ report, onClose }: { report: ReportData; onClose: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.viewerScroll} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backText}>{'← Reports'}</Text>
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
          {/* Header */}
          <View style={styles.tableHeader}>
            {report.columns.map((col, i) => (
              <Text key={i} style={[styles.tableHeaderCell, { flex: i === 0 ? 2 : 1 }]}>
                {col}
              </Text>
            ))}
          </View>
          {/* Rows */}
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

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard({
  meta,
  onView,
  onDownload,
}: {
  meta:        ReportMeta;
  onView:      () => void;
  onDownload:  (format: 'pdf' | 'csv') => void;
}) {
  return (
    <Card style={styles.reportCard}>
      <View style={styles.reportCardTop}>
        <View style={styles.reportCardText}>
          <Text style={styles.reportCardTitle}>{meta.title}</Text>
          <Text style={styles.reportCardDesc}>{meta.description}</Text>
        </View>
      </View>
      <View style={styles.reportCardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onView}>
          <Text style={styles.actionBtnText}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onDownload('pdf')}>
          <Text style={styles.actionBtnText}>PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onDownload('csv')}>
          <Text style={styles.actionBtnText}>CSV</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const user = useAuthStore((s) => s.user)!;

  const [loading,       setLoading]       = useState<ReportType | null>(null);
  const [downloading,   setDownloading]   = useState<string | null>(null);
  const [reportData,    setReportData]    = useState<ReportData | null>(null);

  // Filter reports by role
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

      // Open the downloaded file
      // On Android: get a shareable content URI
      if (localUri.startsWith('file://') || localUri.startsWith('/')) {
        // Try to get a content URI for Android, fall back to file URI
        try {
          const contentUri = await FileSystem.getContentUriAsync(localUri);
          await Linking.openURL(contentUri);
        } catch {
          await Linking.openURL(localUri);
        }
      } else {
        await Linking.openURL(localUri);
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'Download failed';
      Alert.alert('Download Failed', msg);
    } finally {
      setDownloading(null);
    }
  }

  // Show in-app report viewer
  if (reportData) {
    return (
      <Screen>
        <ReportViewer report={reportData} onClose={() => setReportData(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.heading}>Reports</Text>
      </View>
      <Text style={styles.subheading}>Select a report to view or export</Text>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {visibleReports.map((meta) => {
          const isViewing    = loading === meta.type;
          const isDownloadPDF = downloading === `${meta.type}-pdf`;
          const isDownloadCSV = downloading === `${meta.type}-csv`;
          const isBusy       = isViewing || isDownloadPDF || isDownloadCSV;

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
                  onPress={() => void handleView(meta.type)}
                  disabled={isBusy}
                >
                  {isViewing
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : <Text style={styles.actionBtnText}>View</Text>
                  }
                </TouchableOpacity>
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

  // Viewer
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

  tableCard:        { marginBottom: 16, padding: 0, overflow: 'hidden' },
  tableHeader:      { flexDirection: 'row', backgroundColor: '#0f172a', paddingHorizontal: 12, paddingVertical: 8 },
  tableHeaderCell:  { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  tableRow:         { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  tableRowAlt:      { backgroundColor: '#0f172a' },
  tableCell:        { color: '#cbd5e1', fontSize: 11 },
  tableTruncated:   { color: '#64748b', fontSize: 11, textAlign: 'center', padding: 10 },

  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 32 },
});
