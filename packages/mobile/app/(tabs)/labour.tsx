/**
 * Labour tab — supervisor / PM / admin only
 * Phase 3: search bar, filter chips, pagination, offline queue for creates.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal,
  ScrollView, RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import { labourApi } from '../../src/api/labour';
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
import { LabourEntry, Worker, Project, JobSite } from '../../src/types';

const PAGE_SIZE = 25;

// ─── Create Labour Modal (with offline queue fallback) ────────────────────────

function CreateLabourModal({
  visible, onClose, onSaved,
}: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [sites,     setSites]     = useState<JobSite[]>([]);
  const [workers,   setWorkers]   = useState<Worker[]>([]);
  const [projectId, setProjectId] = useState('');
  const [siteId,    setSiteId]    = useState('');
  const [workerId,  setWorkerId]  = useState('');
  const [date,      setDate]      = useState(new Date().toISOString().split('T')[0]!);
  const [hours,     setHours]     = useState('8');
  const [rate,      setRate]      = useState('');
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (!visible) return;
    Promise.all([projectsApi.list(), workersApi.list()]).then(([p, w]) => {
      setProjects(p); setWorkers(w);
    }).catch(() => {});
  }, [visible]);

  async function onProjectChange(pid: string) {
    setProjectId(pid); setSiteId('');
    try { setSites(await projectsApi.listSites(pid)); } catch { setSites([]); }
  }

  async function save() {
    if (!projectId || !siteId || !workerId) {
      Alert.alert('Validation', 'Project, site, and worker are required'); return;
    }
    const dailyRate = parseFloat(rate);
    if (isNaN(dailyRate) || dailyRate <= 0) {
      Alert.alert('Validation', 'Enter a valid daily rate'); return;
    }
    setSaving(true);
    const data = {
      projectId, siteId, workerId,
      date, hoursWorked: parseFloat(hours) || 8, dailyRate,
      notes: notes || undefined,
    };
    try {
      await labourApi.create(data);
      onSaved(); onClose();
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueue('labour_create', { data });
        Alert.alert('Saved Offline', 'Labour entry queued — will sync when back online.');
        onSaved(); onClose();
      } else {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? 'Failed to create labour entry';
        Alert.alert('Error', msg);
      }
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Labour Entry</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
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
          {workers.length === 0
            ? <Text style={styles.emptyText}>No workers found</Text>
            : workers.slice(0, 20).map((w) => (
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
          }

          <Input label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-04-17" />
          <Input label="Hours Worked" value={hours} onChangeText={setHours} keyboardType="decimal-pad" placeholder="8" />
          <Input label="Daily Rate" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="1500" />
          <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Any notes..." multiline />

          <Button title="Create Entry" onPress={save} loading={saving} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

type DateFilter = 'all' | 'today' | 'week' | 'month';

const DATE_FILTERS: Array<{ label: string; value: DateFilter }> = [
  { label: 'All',        value: 'all'   },
  { label: 'Today',      value: 'today' },
  { label: 'This Week',  value: 'week'  },
  { label: 'This Month', value: 'month' },
];

function getDateRange(filter: DateFilter): { startDate?: string; endDate?: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0]!;
  if (filter === 'today') return { startDate: fmt(now), endDate: fmt(now) };
  if (filter === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
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

  const [entries,    setEntries]    = useState<LabourEntry[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showModal,  setShowModal]  = useState(false);
  const [search,     setSearch]     = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [offset,     setOffset]     = useState(0);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  async function load(opts: { reset?: boolean; searchVal?: string; dateF?: DateFilter } = {}) {
    const searchQ  = opts.searchVal ?? search;
    const dateF    = opts.dateF     ?? dateFilter;
    const newOffset = opts.reset ? 0 : offset;
    const range    = getDateRange(dateF);

    try {
      const res = await labourApi.list({
        search: searchQ || undefined,
        limit:  PAGE_SIZE,
        offset: newOffset,
        ...range,
      });
      if (opts.reset || newOffset === 0) {
        setEntries(res.entries);
      } else {
        setEntries((prev) => [...prev, ...res.entries]);
      }
      setTotal(res.pagination.total);
      setOffset(newOffset + res.entries.length);
    } catch { /* non-fatal */ }
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

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Labour</Text>
        <View style={styles.headerRight}>
          {pendingCount > 0 && (
            <TouchableOpacity onPress={flush} style={styles.pendingBadge} disabled={isFlushing}>
              {isFlushing
                ? <ActivityIndicator size="small" color="#f59e0b" />
                : <Text style={styles.pendingText}>{pendingCount} pending</Text>
              }
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

      {/* Search bar */}
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

      {/* Date filter chips */}
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
            <Text style={[styles.filterChipText, dateFilter === f.value && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count */}
      {total > 0 && (
        <Text style={styles.countText}>{total} entries{search ? ` for "${search}"` : ''}</Text>
      )}

      {entries.length === 0
        ? (
          <EmptyState
            title="No labour entries"
            description={search ? `No results for "${search}"` : 'Tap + Add to create your first labour entry.'}
          />
        )
        : (
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            renderItem={({ item }) => (
              <Card style={styles.entryCard}>
                <View style={styles.entryRow}>
                  <Text style={styles.entryName}>
                    {item.worker.firstName} {item.worker.lastName}
                  </Text>
                  <Text style={styles.entryHours}>{item.hoursWorked}h</Text>
                </View>
                <Text style={styles.entryMeta}>
                  {item.date} · Rate: {item.dailyRate} {item.currency}
                </Text>
                {item.worker.trade && (
                  <Text style={styles.entryMeta}>{item.worker.trade}</Text>
                )}
              </Card>
            )}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              hasMore ? (
                <View style={styles.footer}>
                  {loadingMore
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : <TouchableOpacity onPress={onLoadMore} style={styles.loadMoreBtn}>
                        <Text style={styles.loadMoreText}>Load More ({total - entries.length} remaining)</Text>
                      </TouchableOpacity>
                  }
                </View>
              ) : null
            }
          />
        )
      }

      <CreateLabourModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => { setOffset(0); void load({ reset: true }); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle:   { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },

  pendingBadge: { backgroundColor: '#451a03', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#f59e0b' },
  pendingText:  { color: '#f59e0b', fontSize: 11, fontWeight: '700' },

  searchRow:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12 },
  searchInput:     { flex: 1, color: '#f1f5f9', fontSize: 14, paddingVertical: 10 },
  searchClear:     { padding: 4 },
  searchClearText: { color: '#64748b', fontSize: 14 },

  filterBar:         { flexGrow: 0 },
  filterBarContent:  { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterChip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  filterChipActive:  { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff',    fontSize: 12, fontWeight: '600' },

  countText: { color: '#64748b', fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },

  list:       { padding: 16, paddingBottom: 32 },
  entryCard:  { marginBottom: 8 },
  entryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  entryName:  { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  entryHours: { color: '#3b82f6', fontSize: 14, fontWeight: '700' },
  entryMeta:  { color: '#94a3b8', fontSize: 12, marginTop: 2 },

  footer:       { alignItems: 'center', paddingVertical: 16 },
  loadMoreBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  loadMoreText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },

  modal: { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle:  { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  modalClose:  { color: '#94a3b8', fontSize: 20, padding: 4 },

  fieldLabel:       { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  selectItem:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 8 },
  selectItemActive: { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  selectItemText:   { color: '#f1f5f9', fontSize: 14, flex: 1 },
  checkmark:        { color: '#3b82f6', fontSize: 16 },
  emptyText:        { color: '#475569', fontSize: 14, marginBottom: 8 },
});
