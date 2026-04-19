/**
 * Dashboard screen — Phase 2
 * Mirrors the web dashboard: aggregated company-wide stats.
 * Finance section only shown for canViewFinance roles.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { dashboardApi } from '../../src/api/dashboard';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';
import { DashboardStats } from '../../src/types';

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router       = useRouter();
  const user         = useAuthStore((s) => s.user)!;
  const [stats,      setStats]      = useState<DashboardStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setStats(await dashboardApi.getStats());
    } catch {
      setError('Failed to load dashboard');
    }
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Auto-refresh on relevant SSE mutations
  const refreshOnEvent = useCallback(() => { void load(); }, []);
  useSSEEvent('delivery_created',   refreshOnEvent);
  useSSEEvent('labour_created',     refreshOnEvent);
  useSSEEvent('invoice_updated',    refreshOnEvent);
  useSSEEvent('instruction_updated', refreshOnEvent);

  if (loading) return <LoadingSpinner />;

  if (error || !stats) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error ?? 'No data'}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.heading}>Dashboard</Text>
            <Text style={styles.subheading}>{today}</Text>
          </View>
          {stats.notifications.unread > 0 && (
            <Badge label={`${stats.notifications.unread} alerts`} variant="warning" />
          )}
        </View>

        {/* Projects */}
        <SectionHeader title="Projects" />
        <View style={styles.tileRow}>
          <StatTile label="Total"    value={stats.projects.total}    accent />
          <StatTile label="Active"   value={stats.projects.active}   />
          <StatTile label="Planning" value={stats.projects.planning} />
        </View>

        {stats.projects.recent.length > 0 && (
          <Card style={styles.recentCard}>
            <Text style={styles.cardTitle}>Recent Projects</Text>
            {stats.projects.recent.slice(0, 3).map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.recentRow}
                onPress={() => router.push('/(tabs)/projects')}
              >
                <Text style={styles.recentName} numberOfLines={1}>{p.name}</Text>
                <Badge
                  label={p.status}
                  variant={p.status === 'active' ? 'success' : 'default'}
                />
              </TouchableOpacity>
            ))}
          </Card>
        )}

        {/* Workforce */}
        <SectionHeader title="Workforce" />
        <View style={styles.tileRow}>
          <StatTile label="Workers"     value={stats.workers.total}           />
          <StatTile label="Active"      value={stats.workers.active}          />
          <StatTile
            label="Today Present"
            value={`${stats.attendance.todayPresent}/${stats.attendance.todayTotal}`}
            sub={`${stats.attendance.todayRate.toFixed(0)}%`}
            accent
          />
        </View>
        <View style={styles.tileRow}>
          <StatTile label="Week Hours"  value={stats.labour.thisWeekHours.toFixed(0)} />
          <StatTile label="Month Cost"  value={stats.labour.thisMonthCost.toFixed(0)} />
        </View>

        {/* Deliveries */}
        <SectionHeader title="Deliveries" />
        <View style={styles.tileRow}>
          <StatTile label="This Month"    value={stats.deliveries.thisMonthCount}         />
          <StatTile label="Total"         value={stats.deliveries.totalCount}             />
          <StatTile
            label="Pending Check"
            value={stats.deliveries.pendingInspectionCount}
            accent={stats.deliveries.pendingInspectionCount > 0}
          />
        </View>

        {/* Instructions */}
        <SectionHeader title="Instructions" />
        <View style={styles.tileRow}>
          <StatTile
            label="Open"
            value={stats.instructions.open}
            accent={stats.instructions.open > 0}
          />
          <StatTile
            label="Critical"
            value={stats.instructions.critical}
            accent={stats.instructions.critical > 0}
          />
        </View>

        {/* Invoices */}
        {(user.canViewFinance || user.role === 'company_admin' || user.role === 'finance_officer' || user.role === 'project_manager') && (
          <>
            <SectionHeader title="Invoices" />
            <View style={styles.tileRow}>
              <StatTile label="Total"    value={stats.invoices.total}                    />
              <StatTile label="Pending"  value={stats.invoices.pendingApproval} accent={stats.invoices.pendingApproval > 0} />
              <StatTile label="Overdue"  value={stats.invoices.overdueCount}    accent={stats.invoices.overdueCount > 0}    />
            </View>
          </>
        )}

        {/* Budget */}
        {user.canViewFinance && (
          <>
            <SectionHeader title="Budget" />
            <View style={styles.tileRow}>
              <StatTile label="Budgeted"  value={stats.budget.totalBudgeted.toFixed(0)}  />
              <StatTile label="Spent"     value={stats.budget.totalSpent.toFixed(0)}     />
              <StatTile
                label="Remaining"
                value={stats.budget.totalRemaining.toFixed(0)}
                accent={stats.budget.totalRemaining < 0}
              />
            </View>
          </>
        )}

        {/* Finance (admin/finance only) */}
        {stats.finance && (
          <>
            <SectionHeader title="Finance" />
            <View style={styles.tileRow}>
              <StatTile label="Total Inflows"  value={stats.finance.totalInflows.toFixed(0)}     />
              <StatTile label="This Month"     value={stats.finance.inflowsThisMonth.toFixed(0)} />
              <StatTile
                label="Net Position"
                value={stats.finance.netPosition.toFixed(0)}
                accent
              />
            </View>
          </>
        )}

      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 20,
  },
  heading:    { color: '#f1f5f9', fontSize: 24, fontWeight: '700' },
  subheading: { color: '#94a3b8', fontSize: 13, marginTop: 2 },

  sectionTitle: {
    color: '#64748b', fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
    marginTop: 20, marginBottom: 8,
  },

  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tile: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#334155',
    alignItems: 'center', minHeight: 64,
  },
  tileAccent: { borderColor: '#3b82f6', backgroundColor: '#172554' },
  tileValue:  { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  tileLabel:  { color: '#94a3b8', fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  tileSub:    { color: '#64748b', fontSize: 10, marginTop: 1 },

  recentCard:  { marginBottom: 0 },
  cardTitle:   { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  recentRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#334155' },
  recentName:  { color: '#f1f5f9', fontSize: 13, fontWeight: '500', flex: 1, marginRight: 8 },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 16 },
  retryBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },
});
