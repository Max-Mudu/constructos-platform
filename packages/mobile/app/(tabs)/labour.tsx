/**
 * Labour tab — supervisor / PM / admin only
 * Day 22: real attendance visibility connected through attendanceApi.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { labourApi } from '../../src/api/labour';
import { attendanceApi } from '../../src/api/attendance';
import { workersApi } from '../../src/api/workers';
import { projectsApi } from '../../src/api/projects';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import { enqueue, isNetworkError } from '../../src/utils/offlineQueue';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import {
  LabourEntry,
  Worker,
  Project,
  JobSite,
  AttendanceRecord,
  AttendanceStatus,
} from '../../src/types';

const PAGE_SIZE = 25;

type DateFilter = 'all' | 'today' | 'week' | 'month';
type DisplayAttendanceStatus = AttendanceStatus | 'checked_out' | 'no_checkin';

function normalizeDate(value: string) {
  return value.split('T')[0] ?? value;
}

function makeAttendanceKey(projectId: string, siteId: string, workerId: string, date: string) {
  return `${projectId}:${siteId}:${workerId}:${normalizeDate(date)}`;
}

function getDisplayStatus(record?: AttendanceRecord): DisplayAttendanceStatus {
  if (!record) return 'no_checkin';
  if (record.checkOutTime) return 'checked_out';
  return record.status;
}

function StatusBadge({ status }: { status: DisplayAttendanceStatus }) {
  const config: Record<DisplayAttendanceStatus, { color: string; label: string }> = {
    present:    { color: '#22c55e', label: 'Present' },
    absent:     { color: '#ef4444', label: 'Attendance: Absent' },
    late:       { color: '#f59e0b', label: 'Late' },
    half_day:   { color: '#3b82f6', label: 'Half Day' },
    excused:    { color: '#8b5cf6', label: 'Excused' },
    checked_out:{ color: '#64748b', label: 'Checked Out' },
    no_checkin: { color: '#334155', label: 'No Check-in' },
  };

  const s = config[status];

  return (
    <View style={[styles.statusBadge, { backgroundColor: s.color }]}>
      <Text style={styles.statusBadgeText}>{s.label}</Text>
    </View>
  );
}

function formatTime(value: string | null | undefined) {
  if (!value) return null;

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function getRecordForEntry(
  entry: LabourEntry,
  attendanceMap: Record<string, AttendanceRecord>,
) {
  return attendanceMap[
    makeAttendanceKey(entry.projectId, entry.siteId, entry.workerId, entry.date)
  ];
}

// ─── Create Labour Modal ──────────────────────────────────────────────────────

function CreateLabourModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<JobSite[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0] ?? '');
  const [hours, setHours] = useState('8');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;

    Promise.all([projectsApi.list(), workersApi.list()])
      .then(([p, w]) => {
        setProjects(p);
        setWorkers(w);
      })
      .catch(() => {});
  }, [visible]);

  async function onProjectChange(pid: string) {
    setProjectId(pid);
    setSiteId('');

    try {
      setSites(await projectsApi.listSites(pid));
    } catch {
      setSites([]);
    }
  }

  async function save() {
    if (!projectId || !siteId || !workerId) {
      Alert.alert('Validation', 'Project, site, and worker are required');
      return;
    }

    const dailyRate = parseFloat(rate);
    if (isNaN(dailyRate) || dailyRate <= 0) {
      Alert.alert('Validation', 'Enter a valid daily rate');
      return;
    }

    setSaving(true);

    const data = {
      projectId,
      siteId,
      workerId,
      date,
      hoursWorked: parseFloat(hours) || 8,
      dailyRate,
      notes: notes || undefined,
    };

    try {
      await labourApi.create(data);
      onSaved();
      onClose();
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueue('labour_create', { data });
        Alert.alert('Saved Offline', 'Labour entry queued — will sync when back online.');
        onSaved();
        onClose();
      } else {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to create labour entry';
        Alert.alert('Error', msg);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Labour Entry</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Project *</Text>
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.selectItem, projectId === p.id && styles.selectItemActive]}
              onPress={() => void onProjectChange(p.id)}
            >
              <Text style={styles.selectItemText}>{p.name}</Text>
              {projectId === p.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}

          {sites.length > 0 && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Site *</Text>
              {sites.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.selectItem, siteId === s.id && styles.selectItemActive]}
                  onPress={() => setSiteId(s.id)}
                >
                  <Text style={styles.selectItemText}>{s.name}</Text>
                  {siteId === s.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Worker *</Text>
          {workers.length === 0 ? (
            <Text style={styles.emptyText}>No workers found</Text>
          ) : (
            workers.slice(0, 20).map((w) => (
              <TouchableOpacity
                key={w.id}
                style={[styles.selectItem, workerId === w.id && styles.selectItemActive]}
                onPress={() => setWorkerId(w.id)}
              >
                <Text style={styles.selectItemText}>
                  {w.firstName} {w.lastName} {w.trade ? `(${w.trade})` : ''}
                </Text>
                {workerId === w.id && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))
          )}

          <Input
            label="Date (YYYY-MM-DD)"
            value={date}
            onChangeText={setDate}
            placeholder="2026-04-17"
          />
          <Input
            label="Hours Worked"
            value={hours}
            onChangeText={setHours}
            keyboardType="decimal-pad"
            placeholder="8"
          />
          <Input
            label="Daily Rate"
            value={rate}
            onChangeText={setRate}
            keyboardType="decimal-pad"
            placeholder="1500"
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Any notes..."
            multiline
          />

          <Button title="Create Entry" onPress={save} loading={saving} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

const DATE_FILTERS: Array<{ label: string; value: DateFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
];

function getDateRange(filter: DateFilter): { startDate?: string; endDate?: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0] ?? '';

  if (filter === 'today') {
    return { startDate: fmt(now), endDate: fmt(now) };
  }

  if (filter === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return { startDate: fmt(start), endDate: fmt(now) };
  }

  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: fmt(start), endDate: fmt(now) };
  }

  return {};
}

// ─── Labour List ──────────────────────────────────────────────────────────────

export default function LabourScreen() {
  const { pendingCount, isFlushing, flush } = useOfflineQueue();

  const [entries, setEntries] = useState<LabourEntry[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [offset, setOffset] = useState(0);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  async function loadAttendanceForEntries(labourEntries: LabourEntry[]) {
    if (labourEntries.length === 0) {
      setAttendanceMap({});
      return;
    }

    setAttendanceLoading(true);

    try {
      const comboMap = new Map<string, { projectId: string; siteId: string; date: string }>();

      labourEntries.forEach((entry) => {
        const date = normalizeDate(entry.date);
        const key = `${entry.projectId}:${entry.siteId}:${date}`;

        if (!comboMap.has(key)) {
          comboMap.set(key, {
            projectId: entry.projectId,
            siteId: entry.siteId,
            date,
          });
        }
      });

      const allRecords = await Promise.all(
        Array.from(comboMap.values()).map(async (combo) => {
          try {
            return await attendanceApi.list(combo.projectId, combo.siteId, { date: combo.date });
          } catch {
            return [];
          }
        }),
      );

      const nextMap: Record<string, AttendanceRecord> = {};

      allRecords.flat().forEach((record) => {
        nextMap[
          makeAttendanceKey(record.projectId, record.siteId, record.workerId, record.date)
        ] = record;
      });

      setAttendanceMap(nextMap);
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function load(opts: { reset?: boolean; searchVal?: string; dateF?: DateFilter } = {}) {
    const searchQ = opts.searchVal ?? search;
    const dateF = opts.dateF ?? dateFilter;
    const newOffset = opts.reset ? 0 : offset;
    const range = getDateRange(dateF);

    try {
      const res = await labourApi.list({
        search: searchQ || undefined,
        limit: PAGE_SIZE,
        offset: newOffset,
        ...range,
      });

      const nextEntries =
        opts.reset || newOffset === 0 ? res.entries : [...entries, ...res.entries];

      setEntries(nextEntries);
      setTotal(res.pagination.total);
      setOffset(newOffset + res.entries.length);

      await loadAttendanceForEntries(nextEntries);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    load({ reset: true }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    setOffset(0);
    await load({ reset: true });
    setRefreshing(false);
  }

  async function onLoadMore() {
    if (loadingMore || entries.length >= total) return;
    setLoadingMore(true);
    await load();
    setLoadingMore(false);
  }

  function onSearchChange(text: string) {
    setSearch(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setOffset(0);
      void load({ reset: true, searchVal: text });
    }, 350);
  }

  function onDateFilterChange(f: DateFilter) {
    setDateFilter(f);
    setOffset(0);
    void load({ reset: true, dateF: f });
  }

  if (loading) return <LoadingSpinner />;

  const hasMore = entries.length < total;

  const uniqueWorkerMap = new Map<string, LabourEntry>();

  entries.forEach((entry) => {
    if (!uniqueWorkerMap.has(entry.workerId)) {
      uniqueWorkerMap.set(entry.workerId, entry);
    }
  });

  const uniqueWorkerEntries = Array.from(uniqueWorkerMap.values());

  const presentCount = uniqueWorkerEntries.filter((entry) => {
    const record = getRecordForEntry(entry, attendanceMap);
    const status = getDisplayStatus(record);
    return status === 'present' || status === 'late' || status === 'half_day' || status === 'checked_out';
  }).length;

  const absentCount = uniqueWorkerEntries.filter((entry) => {
    const record = getRecordForEntry(entry, attendanceMap);
    return record?.status === 'absent';
  }).length;

  const lateCount = uniqueWorkerEntries.filter((entry) => {
    const record = getRecordForEntry(entry, attendanceMap);
    return getDisplayStatus(record) === 'late';
  }).length;

  const totalCount = uniqueWorkerEntries.length;

  // ── Labour intelligence ────────────────────────────────────────────────────
  const totalHours    = entries.reduce((s, e) => s + Number(e.hoursWorked), 0);
  const overtimeCount = entries.filter((e) => Number(e.hoursWorked) > 8).length;
  const totalCost     = entries.reduce((s, e) => s + Number(e.dailyRate), 0);
  const currencies    = [...new Set(entries.map((e) => e.currency))];
  const costDisplay   = totalCost > 0
    ? (currencies.length === 1 ? `${currencies[0]!} ${totalCost.toFixed(0)}` : totalCost.toFixed(0))
    : '—';

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Labour</Text>
        <View style={styles.headerRight}>
          {pendingCount > 0 && (
            <TouchableOpacity
              onPress={flush}
              style={styles.pendingBadge}
              disabled={isFlushing}
            >
              {isFlushing ? (
                <ActivityIndicator size="small" color="#f59e0b" />
              ) : (
                <Text style={styles.pendingText}>{pendingCount} pending</Text>
              )}
            </TouchableOpacity>
          )}

          <Button
            title="+ Add"
            onPress={() => setShowModal(true)}
            variant="secondary"
            style={{ height: 36, paddingHorizontal: 12 }}
          />
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search worker..."
          placeholderTextColor="#475569"
          value={search}
          onChangeText={onSearchChange}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => onSearchChange('')} style={styles.searchClear}>
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {DATE_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterChip, dateFilter === f.value && styles.filterChipActive]}
            onPress={() => onDateFilterChange(f.value)}
          >
            <Text
              style={[
                styles.filterChipText,
                dateFilter === f.value && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Labour summary strip ──────────────────────────────────── */}
      {entries.length > 0 && (
        <View style={styles.labourSummaryRow}>
          <View style={styles.labourStatCard}>
            <Text style={styles.labourStatValue}>{totalHours.toFixed(1)}h</Text>
            <Text style={styles.labourStatLabel}>Total Hours</Text>
          </View>
          <View style={[styles.labourStatCard, overtimeCount > 0 ? styles.labourStatCardOT : null]}>
            <Text style={[styles.labourStatValue, overtimeCount > 0 ? styles.labourStatValueOT : null]}>
              {overtimeCount}
            </Text>
            <Text style={styles.labourStatLabel}>Overtime</Text>
          </View>
          <View style={styles.labourStatCard}>
            <Text style={styles.labourStatValue} numberOfLines={1}>{costDisplay}</Text>
            <Text style={styles.labourStatLabel}>Est. Cost</Text>
          </View>
        </View>
      )}

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{totalCount}</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardPresent]}>
          <Text style={styles.summaryLabel}>Present</Text>
          <Text style={styles.summaryValue}>{presentCount}</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardAbsent]}>
          <Text style={styles.summaryLabel}>Absent</Text>
          <Text style={styles.summaryValue}>{absentCount}</Text>
        </View>

        <View style={[styles.summaryCard, styles.summaryCardLate]}>
          <Text style={styles.summaryLabel}>Late</Text>
          <Text style={styles.summaryValue}>{lateCount}</Text>
        </View>
      </View>

      {attendanceLoading && (
        <Text style={styles.attendanceLoadingText}>Loading attendance status...</Text>
      )}

      {total > 0 && (
        <Text style={styles.countText}>
          {total} entries{search ? ` for "${search}"` : ''}
        </Text>
      )}

      {entries.length === 0 ? (
        <EmptyState
          title="No labour entries"
          description={
            search
              ? `No results for "${search}"`
              : 'Tap + Add to create your first labour entry.'
          }
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => {
            const record     = getRecordForEntry(item, attendanceMap);
            const status     = getDisplayStatus(record);
            const checkIn    = formatTime(record?.checkInTime);
            const checkOut   = formatTime(record?.checkOutTime);
            const isOvertime = Number(item.hoursWorked) > 8;

            return (
              <Card style={isOvertime ? [styles.entryCard, styles.entryCardOvertime] : styles.entryCard}>
                <View style={styles.entryRow}>
                  <View style={styles.entryNameWrap}>
                    <Text style={styles.entryName}>
                      {item.worker.firstName} {item.worker.lastName}
                    </Text>
                  </View>

                  <View style={styles.entryBadgeRow}>
                    {isOvertime && (
                      <View style={styles.overtimeBadge}>
                        <Text style={styles.overtimeBadgeText}>Overtime</Text>
                      </View>
                    )}
                    <StatusBadge status={status} />
                  </View>
                </View>

                <Text style={styles.entryMeta}>
                  {normalizeDate(item.date)} · {item.hoursWorked}h
                </Text>

                <Text style={styles.entryMeta}>
                  Rate: {item.dailyRate} {item.currency}
                </Text>

                {item.worker.trade && (
                  <Text style={styles.entryMeta}>{item.worker.trade}</Text>
                )}

                {(checkIn || checkOut) && (
                  <Text style={styles.entryMeta}>
                    {checkIn ? `In: ${checkIn}` : ''}
                    {checkIn && checkOut ? ' · ' : ''}
                    {checkOut ? `Out: ${checkOut}` : ''}
                  </Text>
                )}

                {record?.notes && (
                  <Text style={styles.entryMeta}>Note: {record.notes}</Text>
                )}
              </Card>
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3b82f6"
            />
          }
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            hasMore ? (
              <View style={styles.footer}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color="#3b82f6" />
                ) : (
                  <TouchableOpacity onPress={onLoadMore} style={styles.loadMoreBtn}>
                    <Text style={styles.loadMoreText}>
                      Load More ({total - entries.length} remaining)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
        />
      )}

      <CreateLabourModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => {
          setOffset(0);
          void load({ reset: true });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageTitle: {
    color: '#f1f5f9',
    fontSize: 22,
    fontWeight: '700',
  },

  pendingBadge: {
    backgroundColor: '#451a03',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  pendingText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 14,
    paddingVertical: 10,
  },
  searchClear: {
    padding: 4,
  },
  searchClearText: {
    color: '#64748b',
    fontSize: 14,
  },

  filterBar: {
    flexGrow: 0,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryCardPresent: {
    borderColor: '#22c55e',
  },
  summaryCardAbsent: {
    borderColor: '#ef4444',
  },
  summaryCardLate: {
    borderColor: '#f59e0b',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 4,
  },
  summaryValue: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '700',
  },

  attendanceLoadingText: {
    color: '#94a3b8',
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },

  countText: {
    color: '#64748b',
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },

  list: {
    padding: 16,
    paddingBottom: 32,
  },
  entryCard: {
    marginBottom: 8,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: 12,
  },
  entryNameWrap: {
    flex: 1,
  },
  entryName: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
  },
  entryMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  footer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  loadMoreBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loadMoreText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '600',
  },

  modal: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '700',
  },
  modalClose: {
    color: '#94a3b8',
    fontSize: 20,
    padding: 4,
  },

  fieldLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  selectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 8,
  },
  selectItemActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e3a5f',
  },
  selectItemText: {
    color: '#f1f5f9',
    fontSize: 14,
    flex: 1,
  },
  checkmark: {
    color: '#3b82f6',
    fontSize: 16,
  },
  emptyText: {
    color: '#475569',
    fontSize: 14,
    marginBottom: 8,
  },

  // ── Labour summary strip ───────────────────────────────────────────
  labourSummaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  labourStatCard: {
    flex: 1,
    backgroundColor: '#0a1628',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  labourStatCardOT: {
    borderColor: '#92400e',
    backgroundColor: '#1a0e00',
  },
  labourStatValue: {
    color: '#c8d8f0',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  labourStatValueOT: {
    color: '#f59e0b',
  },
  labourStatLabel: {
    color: '#3d6090',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Overtime card accent ───────────────────────────────────────────
  entryCardOvertime: {
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    backgroundColor: '#110a00',
  },

  // ── Badge row (holds overtime + status badges) ────────────────────
  entryBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },

  // ── Overtime badge ─────────────────────────────────────────────────
  overtimeBadge: {
    backgroundColor: '#451a03',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#92400e',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  overtimeBadgeText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});