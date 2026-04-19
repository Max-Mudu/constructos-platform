/**
 * Attendance tab
 * Worker: self-attendance flow (select project/site → check in)
 * Supervisor/PM: attendance list with ability to mark attendance
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal,
  ScrollView, RefreshControl,
} from 'react-native';
import { useAuthStore } from '../../src/store/auth.store';
import { attendanceApi } from '../../src/api/attendance';
import { projectsApi } from '../../src/api/projects';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import { Input } from '../../src/components/Input';
import { enqueue, isNetworkError } from '../../src/utils/offlineQueue';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import { AttendanceRecord, AttendanceStatus, Project, JobSite } from '../../src/types';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_VARIANTS: Record<AttendanceStatus, 'success' | 'destructive' | 'warning' | 'default' | 'outline'> = {
  present:  'success',
  late:     'warning',
  half_day: 'warning',
  absent:   'destructive',
  excused:  'outline',
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present:  'Present',
  late:     'Late',
  half_day: 'Half Day',
  absent:   'Absent',
  excused:  'Excused',
};

// ─── Worker self-attendance ───────────────────────────────────────────────────

function WorkerAttendance() {
  const { pendingCount, isFlushing, flush } = useOfflineQueue();
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [sites,      setSites]      = useState<JobSite[]>([]);
  const [selected,   setSelected]   = useState<{ project: Project; site: JobSite } | null>(null);
  const [checkInTime, setCheckInTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [done,       setDone]       = useState(false);
  const [doneOffline, setDoneOffline] = useState(false);

  useEffect(() => {
    projectsApi.list()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function loadSites(project: Project) {
    try {
      const s = await projectsApi.listSites(project.id);
      setSites(s);
    } catch {
      Alert.alert('Error', 'Failed to load sites');
    }
  }

  async function handleCheckIn() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await attendanceApi.selfAttendance(
        selected.project.id,
        selected.site.id,
        checkInTime ? { checkInTime } : undefined,
      );
      setDone(true);
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        await enqueue('attendance_self', {
          projectId: selected.project.id,
          siteId:    selected.site.id,
          checkInTime: checkInTime || null,
        });
        setDoneOffline(true);
      } else {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to record attendance';
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  if (doneOffline) {
    return (
      <Screen>
        <View style={styles.doneWrap}>
          <Text style={[styles.doneIcon, { color: '#f59e0b' }]}>⏳</Text>
          <Text style={styles.doneTitle}>Saved Offline</Text>
          <Text style={styles.doneSub}>No internet connection. Your attendance has been queued and will sync automatically when you're back online.</Text>
          <Button title="OK" onPress={() => setDoneOffline(false)} style={{ marginTop: 24, width: 160 }} />
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View style={styles.doneWrap}>
          <Text style={styles.doneIcon}>✓</Text>
          <Text style={styles.doneTitle}>Attendance Recorded</Text>
          <Text style={styles.doneSub}>You have been marked as present today.</Text>
          {pendingCount > 0 && (
            <TouchableOpacity onPress={flush} style={styles.syncBtn} disabled={isFlushing}>
              <Text style={styles.syncBtnText}>
                {isFlushing ? 'Syncing...' : `Sync ${pendingCount} pending`}
              </Text>
            </TouchableOpacity>
          )}
          <Button title="Done" onPress={() => setDone(false)} style={{ marginTop: 24, width: 160 }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.pageTitle}>Self Attendance</Text>
      <Text style={styles.pageSub}>Select your site and check in for today</Text>

      {/* Step 1 — Select Project */}
      <Text style={styles.stepLabel}>1. Select Project</Text>
      {projects.length === 0
        ? <Text style={styles.emptyText}>No projects assigned</Text>
        : projects.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.selectItem, selected?.project.id === p.id && styles.selectItemActive]}
            onPress={() => {
              setSelected(null);
              setSites([]);
              void loadSites(p);
              setSelected({ project: p, site: null as unknown as JobSite });
            }}
          >
            <Text style={styles.selectItemText}>{p.name}</Text>
            {selected?.project.id === p.id && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))
      }

      {/* Step 2 — Select Site */}
      {sites.length > 0 && (
        <>
          <Text style={[styles.stepLabel, { marginTop: 16 }]}>2. Select Site</Text>
          {sites.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.selectItem, selected?.site?.id === s.id && styles.selectItemActive]}
              onPress={() => setSelected((prev) => prev ? { ...prev, site: s } : null)}
            >
              <Text style={styles.selectItemText}>{s.name}</Text>
              {selected?.site?.id === s.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Step 3 — Check In */}
      {selected?.site && (
        <>
          <Text style={[styles.stepLabel, { marginTop: 16 }]}>3. Check In</Text>
          <Input
            label="Check-in Time (optional, HH:MM)"
            value={checkInTime}
            onChangeText={setCheckInTime}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
          />
          <Button
            title="Mark Me Present"
            onPress={handleCheckIn}
            loading={submitting}
          />
        </>
      )}
    </Screen>
  );
}

// ─── Supervisor attendance list ───────────────────────────────────────────────

function MarkAttendanceModal({
  visible,
  onClose,
  projectId,
  siteId,
  onSaved,
}: {
  visible:   boolean;
  onClose:   () => void;
  projectId: string;
  siteId:    string;
  onSaved:   () => void;
}) {
  const [workerId,    setWorkerId]    = useState('');
  const [status,      setStatus]      = useState<AttendanceStatus>('present');
  const [checkInTime, setCheckInTime] = useState('');
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);

  const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'excused'];

  async function save() {
    if (!workerId.trim()) {
      Alert.alert('Validation', 'Worker ID is required');
      return;
    }
    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0]!;
      await attendanceApi.create(projectId, siteId, {
        workerId: workerId.trim(),
        date:     today,
        status,
        checkInTime:  checkInTime || undefined,
        notes:        notes       || undefined,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save attendance';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Mark Attendance</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Input
            label="Worker ID"
            value={workerId}
            onChangeText={setWorkerId}
            placeholder="Worker UUID"
            autoCapitalize="none"
          />
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusRow}>
            {STATUSES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.statusChip, status === s && styles.statusChipActive]}
                onPress={() => setStatus(s)}
              >
                <Text style={[styles.statusChipText, status === s && styles.statusChipTextActive]}>
                  {STATUS_LABELS[s]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input
            label="Check-in Time (HH:MM, optional)"
            value={checkInTime}
            onChangeText={setCheckInTime}
            placeholder="08:00"
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional notes..."
            multiline
          />
          <Button title="Save Attendance" onPress={save} loading={saving} />
        </ScrollView>
      </View>
    </Modal>
  );
}

function SupervisorAttendance() {
  const [records,   setRecords]   = useState<AttendanceRecord[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [sites,     setSites]     = useState<JobSite[]>([]);
  const [selProj,   setSelProj]   = useState<Project | null>(null);
  const [selSite,   setSelSite]   = useState<JobSite | null>(null);

  useEffect(() => {
    projectsApi.list().then((p) => {
      setProjects(p);
      if (p.length > 0) {
        setSelProj(p[0]!);
        void loadSites(p[0]!.id);
      }
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSites(projectId: string) {
    const s = await projectsApi.listSites(projectId);
    setSites(s);
    if (s.length > 0) {
      setSelSite(s[0]!);
      void loadRecords(projectId, s[0]!.id);
    }
  }

  async function loadRecords(projectId: string, siteId: string) {
    try {
      const r = await attendanceApi.list(projectId, siteId);
      setRecords(r);
    } catch { /* non-fatal */ }
  }

  async function onRefresh() {
    if (!selProj || !selSite) return;
    setRefreshing(true);
    await loadRecords(selProj.id, selSite.id);
    setRefreshing(false);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <Screen>
      <View style={styles.listHeader}>
        <Text style={styles.pageTitle}>Attendance</Text>
        {selProj && selSite && (
          <Button
            title="+ Mark"
            onPress={() => setShowModal(true)}
            variant="secondary"
            style={{ height: 36, paddingHorizontal: 12 }}
          />
        )}
      </View>

      {records.length === 0
        ? (
          <EmptyState
            title="No records"
            description="No attendance records for today. Tap + Mark to add one."
          />
        )
        : (
          <FlatList
            data={records}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => (
              <Card style={styles.recordCard}>
                <View style={styles.recordRow}>
                  <Text style={styles.recordName}>
                    {item.worker.firstName} {item.worker.lastName}
                  </Text>
                  <Badge label={STATUS_LABELS[item.status]} variant={STATUS_VARIANTS[item.status]} />
                </View>
                {item.checkInTime && (
                  <Text style={styles.recordMeta}>Check-in: {item.checkInTime}</Text>
                )}
                {item.notes && (
                  <Text style={styles.recordMeta}>{item.notes}</Text>
                )}
              </Card>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
          />
        )
      }

      {selProj && selSite && (
        <MarkAttendanceModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          projectId={selProj.id}
          siteId={selSite.id}
          onSaved={() => void loadRecords(selProj.id, selSite.id)}
        />
      )}
    </Screen>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function AttendanceScreen() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return user.role === 'worker' ? <WorkerAttendance /> : <SupervisorAttendance />;
}

const styles = StyleSheet.create({
  pageTitle: { color: '#f1f5f9', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  pageSub:   { color: '#94a3b8', fontSize: 13, marginBottom: 20 },
  stepLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  emptyText: { color: '#475569', fontSize: 14 },
  selectItem: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    backgroundColor: '#1e293b',
    borderRadius:   8,
    padding:        14,
    borderWidth:    1,
    borderColor:    '#334155',
    marginBottom:   8,
  },
  selectItemActive:    { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  selectItemText:      { color: '#f1f5f9', fontSize: 14 },
  checkmark:           { color: '#3b82f6', fontSize: 16 },

  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },

  recordCard: { marginBottom: 8 },
  recordRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recordName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  recordMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },

  doneWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  doneIcon:  { fontSize: 56, color: '#22c55e', marginBottom: 12 },
  doneTitle: { color: '#f1f5f9', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  doneSub:   { color: '#94a3b8', fontSize: 14, textAlign: 'center' },
  syncBtn:   { marginTop: 12, backgroundColor: '#451a03', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: '#f59e0b' },
  syncBtnText: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },

  modal: { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle:  { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  modalClose:  { color: '#94a3b8', fontSize: 20, padding: 4 },

  fieldLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  statusRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      8,
    backgroundColor:   '#1e293b',
    borderWidth:       1,
    borderColor:       '#334155',
  },
  statusChipActive:     { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  statusChipText:       { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  statusChipTextActive: { color: '#3b82f6' },
});
