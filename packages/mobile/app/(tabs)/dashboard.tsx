/**
 * Dashboard screen — operations command center.
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
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';
import { DashboardStats } from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

// ─── AppBar ───────────────────────────────────────────────────────────────────

function AppBar({
  firstName, unread, onProfile,
}: {
  firstName: string;
  unread:    number;
  onProfile: () => void;
}) {
  return (
    <View style={D.appBar}>
      <View style={D.appBarBrand}>
        <View style={D.appBarLogoBox}>
          <Text style={D.appBarLogoText}>C</Text>
        </View>
        <Text style={D.appBarTitle}>ConstructOS</Text>
      </View>
      <View style={D.appBarRight}>
        <TouchableOpacity style={D.avatarWrap} onPress={onProfile} activeOpacity={0.8}>
          {unread > 0 ? <View style={D.avatarBadge} /> : null}
          <Text style={D.avatarInitial}>{firstName[0]?.toUpperCase() ?? 'U'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, sub, urgent, onPress,
}: {
  icon:     string;
  label:    string;
  value:    string | number;
  sub?:     string;
  urgent?:  boolean;
  onPress?: () => void;
}) {
  const inner = (
    <View style={[D.metricCard, urgent ? D.metricCardUrgent : null]}>
      <View style={[D.metricIconBadge, urgent ? D.metricIconBadgeUrgent : null]}>
        <Text style={D.metricIconText}>{icon}</Text>
      </View>
      <Text style={[D.metricValue, urgent ? D.metricValueUrgent : null]}>{value}</Text>
      <Text style={D.metricLabel}>{label}</Text>
      {sub ? (
        <Text style={[D.metricSub, urgent ? D.metricSubUrgent : null]}>{sub}</Text>
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={D.metricWrap} onPress={onPress} activeOpacity={0.72}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={D.metricWrap}>{inner}</View>;
}

// ─── AlertCard ────────────────────────────────────────────────────────────────

function AlertCard({
  accentColor, title, body,
}: {
  accentColor: string;
  title:       string;
  body:        string;
}) {
  return (
    <View style={D.alertCard}>
      <View style={[D.alertAccentBar, { backgroundColor: accentColor }]} />
      <View style={D.alertCardInner}>
        <Text style={D.alertCardTitle}>{title}</Text>
        <Text style={D.alertCardBody}>{body}</Text>
      </View>
      <View style={[D.alertIndicator, { backgroundColor: accentColor }]} />
    </View>
  );
}

// ─── LowStockCard ────────────────────────────────────────────────────────────

function LowStockCard({
  count, items, onPress,
}: {
  count:   number;
  items:   Array<{ id: string; materialName: string; currentQuantity: number; unitOfMeasure: string; lowStockThreshold: number; siteName: string }>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={D.lowStockCard} onPress={onPress} activeOpacity={0.78}>
      <View style={D.lowStockHead}>
        <View style={D.lowStockTitleRow}>
          <Text style={D.lowStockIcon}>⚠</Text>
          <Text style={D.lowStockTitle}>Low Stock Alerts</Text>
        </View>
        <Text style={D.lowStockCount}>
          {count} material{count !== 1 ? 's' : ''} need attention
        </Text>
      </View>
      <View style={D.lowStockDivider} />
      {items.slice(0, 3).map((item) => (
        <View key={item.id} style={D.lowStockRow}>
          <View style={D.lowStockRowLeft}>
            <Text style={D.lowStockMaterial} numberOfLines={1}>{item.materialName}</Text>
            <Text style={D.lowStockSite} numberOfLines={1}>{item.siteName}</Text>
          </View>
          <View style={D.lowStockRowRight}>
            <Text style={D.lowStockQty}>{item.currentQuantity} {item.unitOfMeasure}</Text>
            <Text style={D.lowStockLimit}>limit {item.lowStockThreshold}</Text>
          </View>
        </View>
      ))}
      <Text style={D.lowStockTap}>Tap to manage inventory ›</Text>
    </TouchableOpacity>
  );
}

// ─── ScheduleRiskCard ─────────────────────────────────────────────────────────

function ScheduleRiskCard({
  data, onPress,
}: {
  data:    NonNullable<DashboardStats['schedule']>;
  onPress: () => void;
}) {
  const total =
    data.overdueTasks + data.dueTodayTasks +
    data.blockedTasks + data.delayedTasks + data.behindPlanTasks;
  return (
    <TouchableOpacity style={D.schCard} onPress={onPress} activeOpacity={0.78}>
      <View style={D.schHead}>
        <View style={D.schTitleRow}>
          <Text style={D.schIcon}>⏱</Text>
          <Text style={D.schTitle}>Schedule Risk</Text>
        </View>
        <Text style={D.schSub}>
          {total} issue{total !== 1 ? 's' : ''} need attention
        </Text>
      </View>
      <View style={D.schDivider} />
      <View style={D.schGrid}>
        {data.overdueTasks > 0 ? (
          <View style={D.schPill}>
            <Text style={[D.schPillVal, D.schRed]}>{data.overdueTasks}</Text>
            <Text style={D.schPillLbl}>Overdue</Text>
          </View>
        ) : null}
        {data.blockedTasks > 0 ? (
          <View style={D.schPill}>
            <Text style={[D.schPillVal, D.schRed]}>{data.blockedTasks}</Text>
            <Text style={D.schPillLbl}>Blocked</Text>
          </View>
        ) : null}
        {data.dueTodayTasks > 0 ? (
          <View style={D.schPill}>
            <Text style={[D.schPillVal, D.schAmber]}>{data.dueTodayTasks}</Text>
            <Text style={D.schPillLbl}>Due Today</Text>
          </View>
        ) : null}
        {data.delayedTasks > 0 ? (
          <View style={D.schPill}>
            <Text style={[D.schPillVal, D.schAmber]}>{data.delayedTasks}</Text>
            <Text style={D.schPillLbl}>Delayed</Text>
          </View>
        ) : null}
        {data.behindPlanTasks > 0 ? (
          <View style={D.schPill}>
            <Text style={[D.schPillVal, D.schAmber]}>{data.behindPlanTasks}</Text>
            <Text style={D.schPillLbl}>Behind Plan</Text>
          </View>
        ) : null}
      </View>
      <Text style={D.schTap}>Tap to view schedule ›</Text>
    </TouchableOpacity>
  );
}

// ─── LabourAlertsCard ─────────────────────────────────────────────────────────

function LabourAlertsCard({
  data, onPress,
}: {
  data:    NonNullable<DashboardStats['labourAlerts']>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={D.labCard} onPress={onPress} activeOpacity={0.78}>
      <View style={D.labHead}>
        <View style={D.labTitleRow}>
          <Text style={D.labIcon}>👷</Text>
          <Text style={D.labTitle}>Labour Alerts</Text>
        </View>
        <Text style={D.labSub}>Workforce issues today</Text>
      </View>
      <View style={D.labDivider} />
      <View style={D.labGrid}>
        {data.zeroWorkforceToday ? (
          <View style={D.labPill}>
            <Text style={[D.labPillVal, D.labRed]}>!</Text>
            <Text style={D.labPillLbl}>No Workers</Text>
          </View>
        ) : null}
        {data.attendanceRateToday < 70 && !data.zeroWorkforceToday ? (
          <View style={D.labPill}>
            <Text style={[D.labPillVal, D.labRed]}>{data.attendanceRateToday}%</Text>
            <Text style={D.labPillLbl}>Attendance</Text>
          </View>
        ) : null}
        {data.absentToday > 0 ? (
          <View style={D.labPill}>
            <Text style={[D.labPillVal, D.labAmber]}>{data.absentToday}</Text>
            <Text style={D.labPillLbl}>Absent</Text>
          </View>
        ) : null}
        {data.lateToday > 0 ? (
          <View style={D.labPill}>
            <Text style={[D.labPillVal, D.labAmber]}>{data.lateToday}</Text>
            <Text style={D.labPillLbl}>Late</Text>
          </View>
        ) : null}
        {data.overtimeEntriesToday > 0 ? (
          <View style={D.labPill}>
            <Text style={[D.labPillVal, D.labAmber]}>{data.overtimeEntriesToday}</Text>
            <Text style={D.labPillLbl}>Overtime</Text>
          </View>
        ) : null}
      </View>
      <Text style={D.labTap}>Tap to view attendance ›</Text>
    </TouchableOpacity>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: {
  title:     string;
  action?:   string;
  onAction?: () => void;
}) {
  return (
    <View style={D.sectionHeader}>
      <Text style={D.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <TouchableOpacity onPress={onAction}>
          <Text style={D.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── ProjectRow ───────────────────────────────────────────────────────────────

function ProjectRow({
  name, status, onPress,
}: {
  name:    string;
  status:  string;
  onPress: () => void;
}) {
  const dotColor =
    status === 'active'  ? '#16a34a' :
    status === 'on_hold' ? '#d97706' : '#1e3a5f';
  return (
    <TouchableOpacity style={D.projectRow} onPress={onPress} activeOpacity={0.68}>
      <View style={[D.projectDot, { backgroundColor: dotColor }]} />
      <View style={D.projectContent}>
        <Text style={D.projectName} numberOfLines={1}>{name}</Text>
        <Text style={D.projectStatus}>{status.replace(/_/g, ' ')}</Text>
      </View>
      <Text style={D.projectArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router       = useRouter();
  const user         = useAuthStore((s) => s.user);   // no ! — null is valid at runtime
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
  useSSEEvent('delivery_created',    refreshOnEvent);
  useSSEEvent('labour_created',      refreshOnEvent);
  useSSEEvent('invoice_updated',     refreshOnEvent);
  useSSEEvent('instruction_updated', refreshOnEvent);

  if (loading) return <LoadingSpinner />;

  // Guard: auth store initialises with null; re-renders during logout also set null
  if (!user) return null;

  if (error || !stats) {
    return (
      <Screen>
        <View style={D.errorWrap}>
          <Text style={D.errorText}>{error ?? 'No data'}</Text>
          <TouchableOpacity onPress={() => void load()} style={D.retryBtn}>
            <Text style={D.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const now      = new Date();
  const hour     = now.getHours();
  const greeting =
    hour >= 5 && hour < 12  ? 'Good morning'   :
    hour >= 12 && hour < 17 ? 'Good afternoon' :
    hour >= 17 && hour < 22 ? 'Good evening'   :
                               'Good night';
  const today    = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const canViewInvoices = (
    user.canViewFinance ||
    user.role === 'company_admin' ||
    user.role === 'finance_officer' ||
    user.role === 'project_manager'
  );

  // Safe reads — API may return partial shapes even when the stats object exists
  const criticalCount      = stats.instructions?.critical          ?? 0;
  const openCount          = stats.instructions?.open              ?? 0;
  const pendingInspections = stats.deliveries?.pendingInspectionCount ?? 0;
  const overdueInvoices    = stats.invoices?.overdueCount          ?? 0;
  const presentToday       = stats.attendance?.todayPresent        ?? 0;
  const totalToday         = stats.attendance?.todayTotal          ?? 0;
  const activeSites        = stats.projects?.active                ?? 0;
  const totalProjects      = stats.projects?.total                 ?? 0;
  const recentProjects     = stats.projects?.recent                ?? [];
  const budgetRemaining    = stats.budget?.totalRemaining          ?? 0;

  const hasCritical  = criticalCount      > 0;
  const hasPending   = pendingInspections > 0;
  const hasOverdue   = canViewInvoices && overdueInvoices > 0;
  const hasAlerts    = hasCritical || hasPending || hasOverdue;

  const lowStockItems = stats.lowStockInventory?.items ?? [];
  const lowStockCount = stats.lowStockInventory?.count ?? 0;

  const scheduleSummary  = stats.schedule;
  const scheduleRiskTotal =
    (scheduleSummary?.overdueTasks    ?? 0) +
    (scheduleSummary?.dueTodayTasks   ?? 0) +
    (scheduleSummary?.blockedTasks    ?? 0) +
    (scheduleSummary?.delayedTasks    ?? 0) +
    (scheduleSummary?.behindPlanTasks ?? 0);
  const hasScheduleRisk = scheduleRiskTotal > 0;

  const labourSummary   = stats.labourAlerts;
  const hasLabourAlerts = !!(labourSummary && (
    labourSummary.absentToday          > 0 ||
    labourSummary.lateToday            > 0 ||
    labourSummary.overtimeEntriesToday > 0 ||
    labourSummary.attendanceRateToday  < 70 ||
    labourSummary.zeroWorkforceToday
  ));

  const currentProject = recentProjects[0];

  return (
    <Screen>
      {/* ── APP BAR (sticky, outside scroll) ───────────────────────── */}
      <AppBar
        firstName={user.firstName ?? ''}
        unread={stats.notifications?.unread ?? 0}
        onProfile={() => router.push('/(tabs)/profile')}
      />

      <ScrollView
        contentContainerStyle={D.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >

        {/* ── GREETING ──────────────────────────────────────────────── */}
        <View style={D.greetingBlock}>
          <Text style={D.greetingLine}>{greeting},</Text>
          <Text style={D.greetingName}>{user.firstName}</Text>
          <Text style={D.greetingDate}>{today}</Text>
        </View>

        {/* ── SITE PILL ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={D.sitePill}
          onPress={() => router.push('/(tabs)/projects')}
          activeOpacity={0.78}
        >
          <Text style={D.sitePillPin}>📍</Text>
          <Text style={D.sitePillText} numberOfLines={1}>
            {currentProject ? currentProject.name : 'All Projects'}
          </Text>
          <Text style={D.sitePillChev}>›</Text>
        </TouchableOpacity>

        {/* ── QUICK ACTIONS ─────────────────────────────────────────── */}
        <View style={D.quickRow}>
          <TouchableOpacity
            style={D.quickPrimary}
            onPress={() => router.push('/(tabs)/attendance')}
            activeOpacity={0.85}
          >
            <Text style={D.quickPrimaryIcon}>✓</Text>
            <Text style={D.quickPrimaryLabel}>Mark Attendance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={D.quickSecondary}
            onPress={() => router.push('/(tabs)/schedule')}
            activeOpacity={0.8}
          >
            <Text style={D.quickSecondaryIcon}>▦</Text>
            <Text style={D.quickSecondaryLabel}>View Schedule</Text>
          </TouchableOpacity>
        </View>

        {/* ── 2×2 METRIC GRID ───────────────────────────────────────── */}
        <SectionHeader title="Overview" />
        <View style={D.metricsGrid}>
          <View style={D.metricsRow}>
            <MetricCard
              icon="🏗"
              label="Active Sites"
              value={activeSites}
              sub={`${totalProjects} total`}
              onPress={() => router.push('/(tabs)/projects')}
            />
            <MetricCard
              icon="👷"
              label="Workers Present"
              value={presentToday}
              sub={`of ${totalToday} today`}
              onPress={() => router.push('/(tabs)/attendance')}
            />
          </View>
          <View style={D.metricsRow}>
            <MetricCard
              icon="📋"
              label="Open Instructions"
              value={openCount}
              sub="Open from site details"
              urgent={hasCritical}
            />
            <MetricCard
              icon="⚠"
              label="Critical Items"
              value={criticalCount}
              sub="need attention"
              urgent={hasCritical}
            />
          </View>
        </View>

        {/* ── CRITICAL ALERTS ───────────────────────────────────────── */}
        {hasAlerts ? (
          <>
            <SectionHeader title="Critical Alerts" />
            {hasCritical ? (
              <AlertCard
                accentColor="#ef4444"
                title={`${criticalCount} Critical Instruction${criticalCount !== 1 ? 's' : ''}`}
                body="Immediate review required — tap to manage"
              />
            ) : null}
            {hasPending ? (
              <AlertCard
                accentColor="#f59e0b"
                title={`${pendingInspections} Delivery Inspection${pendingInspections !== 1 ? 's' : ''} Pending`}
                body="Deliveries awaiting quality check"
              />
            ) : null}
            {hasOverdue ? (
              <AlertCard
                accentColor="#f97316"
                title={`${overdueInvoices} Overdue Invoice${overdueInvoices !== 1 ? 's' : ''}`}
                body="Payment action required"
              />
            ) : null}
          </>
        ) : null}

        {/* ── LOW STOCK ALERTS ──────────────────────────────────────── */}
        {lowStockCount > 0 ? (
          <LowStockCard
            count={lowStockCount}
            items={lowStockItems}
            onPress={() => router.push('/(tabs)/inventory')}
          />
        ) : null}

        {/* ── SCHEDULE RISK ─────────────────────────────────────────── */}
        {hasScheduleRisk && scheduleSummary ? (
          <ScheduleRiskCard
            data={scheduleSummary}
            onPress={() => router.push('/(tabs)/schedule')}
          />
        ) : null}

        {/* ── LABOUR ALERTS ─────────────────────────────────────────── */}
        {hasLabourAlerts && labourSummary ? (
          <LabourAlertsCard
            data={labourSummary}
            onPress={() => router.push('/(tabs)/attendance')}
          />
        ) : null}

        {/* ── ONGOING PROJECTS ──────────────────────────────────────── */}
        {recentProjects.length > 0 ? (
          <>
            <SectionHeader
              title="Ongoing Projects"
              action="See all"
              onAction={() => router.push('/(tabs)/projects')}
            />
            <View style={D.projectsCard}>
              {recentProjects.slice(0, 4).map((p) => (
                <ProjectRow
                  key={p.id}
                  name={p.name}
                  status={p.status}
                  onPress={() => router.push('/(tabs)/projects')}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* ── FINANCE STRIP (role-gated) ────────────────────────────── */}
        {canViewInvoices && stats.finance ? (
          <>
            <SectionHeader title="Finance" />
            <View style={D.financeStrip}>
              <View style={D.financeStat}>
                <Text style={D.financeVal}>{fmt(stats.finance.netPosition ?? 0)}</Text>
                <Text style={D.financeLbl}>Net Position</Text>
              </View>
              <View style={D.financeSep} />
              <View style={D.financeStat}>
                <Text style={D.financeVal}>{fmt(stats.finance.inflowsThisMonth ?? 0)}</Text>
                <Text style={D.financeLbl}>This Month</Text>
              </View>
              <View style={D.financeSep} />
              <View style={D.financeStat}>
                <Text style={[D.financeVal, budgetRemaining < 0 ? D.financeValNeg : null]}>
                  {fmt(budgetRemaining)}
                </Text>
                <Text style={D.financeLbl}>Remaining</Text>
              </View>
            </View>
          </>
        ) : null}

        <View style={D.bottomPad} />
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const D = StyleSheet.create({
  scroll: { paddingBottom: 0 },

  // ── App bar ───────────────────────────────────────────────────────
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0d1e35',
    backgroundColor: '#060d1b',
  },
  appBarBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appBarLogoBox: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#1d4ed8',
    alignItems: 'center', justifyContent: 'center',
  },
  appBarLogoText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  appBarTitle:    { color: '#c5d8f0', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  appBarRight:   { flexDirection: 'row', alignItems: 'center', gap: 10 },

  avatarWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#0f2040', borderWidth: 1.5, borderColor: '#2563eb',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute', top: -1, right: -1,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#ef4444', borderWidth: 1.5, borderColor: '#060d1b',
  },
  avatarInitial: { color: '#60a5fa', fontSize: 14, fontWeight: '700' },

  // ── Greeting ──────────────────────────────────────────────────────
  greetingBlock: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6 },
  greetingLine: { color: '#7aafd0', fontSize: 13, fontWeight: '500' },
  greetingName: {
    color: '#dde9f8', fontSize: 26, fontWeight: '800',
    letterSpacing: -0.3, marginTop: 2,
  },
  greetingDate: { color: '#4a7ab5', fontSize: 12, marginTop: 4 },

  // ── Site pill ─────────────────────────────────────────────────────
  sitePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 18,
    marginTop: 14,
    backgroundColor: '#0a1728',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  sitePillPin:  { fontSize: 12 },
  sitePillText: { color: '#3d6090', fontSize: 13, fontWeight: '600', flex: 1 },
  sitePillChev: { color: '#1e3a5f', fontSize: 16, fontWeight: '500' },

  // ── Quick actions ─────────────────────────────────────────────────
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 16,
    marginBottom: 4,
  },
  quickPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  quickPrimaryIcon:  { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  quickPrimaryLabel: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  quickSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0a1628',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#162338',
  },
  quickSecondaryIcon:  { color: '#3d6090', fontSize: 15 },
  quickSecondaryLabel: { color: '#3d6090', fontSize: 14, fontWeight: '600' },

  // ── Section header ────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 18,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#3d6090', fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  sectionAction: { color: '#2563eb', fontSize: 12, fontWeight: '600' },

  // ── Metrics 2×2 ───────────────────────────────────────────────────
  metricsGrid: { paddingHorizontal: 18, gap: 10 },
  metricsRow:  { flexDirection: 'row', gap: 10 },
  metricWrap:  { flex: 1 },

  metricCard: {
    backgroundColor: '#0a1628',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#142238',
    padding: 16,
    minHeight: 110,
  },
  metricCardUrgent: {
    backgroundColor: '#0f0608',
    borderColor: '#3d0a0a',
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },

  metricIconBadge: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#0f2040',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  metricIconBadgeUrgent: { backgroundColor: '#200808' },
  metricIconText: { fontSize: 16 },

  metricValue: {
    color: '#d0e4f8', fontSize: 26, fontWeight: '800',
    letterSpacing: -0.3, marginBottom: 3,
  },
  metricValueUrgent: { color: '#f87171' },
  metricLabel: {
    color: '#2a4a70', fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  metricSub:       { color: '#1a3050', fontSize: 10, marginTop: 3 },
  metricSubUrgent: { color: '#7f1d1d', fontSize: 10, marginTop: 3 },

  // ── Alert cards ───────────────────────────────────────────────────
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    marginBottom: 8,
    backgroundColor: '#090f1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#112030',
    overflow: 'hidden',
  },
  alertAccentBar: { width: 4, alignSelf: 'stretch' },
  alertCardInner: { flex: 1, paddingHorizontal: 14, paddingVertical: 13 },
  alertCardTitle: {
    color: '#c5d8f0', fontSize: 13, fontWeight: '700', marginBottom: 3,
  },
  alertCardBody:  { color: '#2d4f78', fontSize: 12 },
  alertIndicator: {
    width: 8, height: 8, borderRadius: 4,
    marginRight: 14, opacity: 0.8,
  },

  // ── Projects card ─────────────────────────────────────────────────
  projectsCard: {
    marginHorizontal: 18,
    backgroundColor: '#080e1c',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f1e35',
    overflow: 'hidden',
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0d1b2e',
    gap: 12,
  },
  projectDot:     { width: 7, height: 7, borderRadius: 4 },
  projectContent: { flex: 1 },
  projectName:    { color: '#6a90b8', fontSize: 13, fontWeight: '600' },
  projectStatus:  { color: '#1e3655', fontSize: 10, marginTop: 2, textTransform: 'capitalize' },
  projectArrow:   { color: '#1a3050', fontSize: 20, fontWeight: '300' },

  // ── Finance strip ─────────────────────────────────────────────────
  financeStrip: {
    flexDirection: 'row',
    marginHorizontal: 18,
    backgroundColor: '#07101f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#112030',
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  financeStat:   { flex: 1, alignItems: 'center' },
  financeSep:    { width: 1, backgroundColor: '#0f1e35' },
  financeVal:    { color: '#4a7ab5', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  financeValNeg: { color: '#f87171' },
  financeLbl: {
    color: '#1e3655', fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
  },

  // ── Error ─────────────────────────────────────────────────────────
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#0c1829', borderRadius: 8,
    paddingHorizontal: 20, paddingVertical: 10,
    borderWidth: 1, borderColor: '#162338',
  },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  bottomPad: { height: 36 },

  // ── Low Stock Card ────────────────────────────────────────────
  lowStockCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#1c1000',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#92400e',
    overflow: 'hidden',
  },
  lowStockHead:     { padding: 14, paddingBottom: 10 },
  lowStockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  lowStockIcon:     { color: '#f59e0b', fontSize: 13 },
  lowStockTitle:    { color: '#f59e0b', fontSize: 14, fontWeight: '800' },
  lowStockCount:    { color: '#b45309', fontSize: 12, fontWeight: '500' },
  lowStockDivider:  { height: 1, backgroundColor: '#3d1c00', marginHorizontal: 0 },
  lowStockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a1200',
  },
  lowStockRowLeft:  { flex: 1, marginRight: 12 },
  lowStockMaterial: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  lowStockSite:     { color: '#78350f', fontSize: 11, marginTop: 2 },
  lowStockRowRight: { alignItems: 'flex-end' },
  lowStockQty:      { color: '#f59e0b', fontSize: 14, fontWeight: '700' },
  lowStockLimit:    { color: '#78350f', fontSize: 10, marginTop: 1 },
  lowStockTap:      { color: '#92400e', fontSize: 11, textAlign: 'center', padding: 10, fontWeight: '600' },

  // ── Schedule Risk Card ────────────────────────────────────────────
  schCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#060d1b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    overflow: 'hidden',
  },
  schHead:     { padding: 14, paddingBottom: 10 },
  schTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  schIcon:     { fontSize: 13 },
  schTitle:    { color: '#93c5fd', fontSize: 14, fontWeight: '800' },
  schSub:      { color: '#1e4070', fontSize: 12, fontWeight: '500' },
  schDivider:  { height: 1, backgroundColor: '#0d1e35' },
  schGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    paddingBottom: 6,
  },
  schPill:    { alignItems: 'center', minWidth: 60, paddingHorizontal: 4 },
  schPillVal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  schPillLbl: {
    color: '#2a4a70', fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2,
  },
  schRed:   { color: '#f87171' },
  schAmber: { color: '#fbbf24' },
  schTap:   { color: '#1e3a5f', fontSize: 11, textAlign: 'center', padding: 10, fontWeight: '600' },

  // ── Labour Alerts Card ────────────────────────────────────────────
  labCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#060d1b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    overflow: 'hidden',
  },
  labHead:     { padding: 14, paddingBottom: 10 },
  labTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  labIcon:     { fontSize: 13 },
  labTitle:    { color: '#93c5fd', fontSize: 14, fontWeight: '800' },
  labSub:      { color: '#1e4070', fontSize: 12, fontWeight: '500' },
  labDivider:  { height: 1, backgroundColor: '#0d1e35' },
  labGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    paddingBottom: 6,
  },
  labPill:    { alignItems: 'center', minWidth: 60, paddingHorizontal: 4 },
  labPillVal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  labPillLbl: {
    color: '#2a4a70', fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2,
  },
  labRed:   { color: '#f87171' },
  labAmber: { color: '#fbbf24' },
  labTap:   { color: '#1e3a5f', fontSize: 11, textAlign: 'center', padding: 10, fontWeight: '600' },
});
