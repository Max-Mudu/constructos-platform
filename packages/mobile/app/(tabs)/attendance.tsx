/**
 * Attendance tab
 * Worker: self-attendance flow (select project/site → check in)
 * Supervisor/PM: daily attendance list with mark + check-out
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal,
  ScrollView, RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../../src/store/auth.store';
import { attendanceApi } from '../../src/api/attendance';
import { projectsApi } from '../../src/api/projects';
import { workersApi } from '../../src/api/workers';
import { enqueue, isNetworkError } from '../../src/utils/offlineQueue';
import { useOfflineQueue } from '../../src/hooks/useOfflineQueue';
import { AttendanceRecord, AttendanceStatus, Project, JobSite, Worker } from '../../src/types';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present:  'Present',
  late:     'Late',
  half_day: 'Half Day',
  absent:   'Absent',
  excused:  'Excused',
};

const STATUS_COLORS: Record<AttendanceStatus, { bg: string; border: string; text: string }> = {
  present:  { bg: '#071a0e', border: '#14532d', text: '#22c55e' },
  late:     { bg: '#1a1200', border: '#422006', text: '#f59e0b' },
  half_day: { bg: '#1a1200', border: '#422006', text: '#f59e0b' },
  absent:   { bg: '#1a0606', border: '#450a0a', text: '#ef4444' },
  excused:  { bg: '#0e1e36', border: '#1e3a6e', text: '#60a5fa' },
};

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'excused'];

// ─── Worker self-attendance ───────────────────────────────────────────────────

function WorkerAttendance({
  defaultProjectId: defProjId,
  defaultSiteId: defSiteId,
}: {
  defaultProjectId?: string | null;
  defaultSiteId?:    string | null;
}) {
  const { pendingCount, isFlushing, flush } = useOfflineQueue();
  const hasDefaults = !!(defProjId && defSiteId);

  const [projects,    setProjects]    = useState<Project[]>([]);
  const [sites,       setSites]       = useState<JobSite[]>([]);
  const [selected,    setSelected]    = useState<{ project: Project; site: JobSite } | null>(
    hasDefaults
      ? {
          project: { id: defProjId!, companyId: '', name: '', status: '' },
          site:    { id: defSiteId!, projectId: defProjId!, companyId: '', name: '', status: '' },
        }
      : null,
  );
  const [checkInTime, setCheckInTime] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [loading,     setLoading]     = useState(!hasDefaults);
  const [done,        setDone]        = useState(false);
  const [doneOffline, setDoneOffline] = useState(false);

  const now   = new Date();
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    if (hasDefaults) return;
    projectsApi.list()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          projectId:   selected.project.id,
          siteId:      selected.site.id,
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

  if (loading) {
    return (
      <View style={W.root}>
        <View style={W.appBar}>
          <Text style={W.appBarTitle}>My Attendance</Text>
          <Text style={W.appBarDate}>{today}</Text>
        </View>
        <View style={W.center}>
          <ActivityIndicator color="#3b82f6" size="large" />
        </View>
      </View>
    );
  }

  if (doneOffline) {
    return (
      <View style={W.root}>
        <View style={W.appBar}>
          <Text style={W.appBarTitle}>My Attendance</Text>
          <Text style={W.appBarDate}>{today}</Text>
        </View>
        <View style={W.center}>
          <View style={W.doneCard}>
            <Text style={W.doneIcon}>⏳</Text>
            <Text style={[W.doneTitle, { color: '#f59e0b' }]}>Saved Offline</Text>
            <Text style={W.doneSub}>
              No internet connection. Your attendance has been queued and will sync automatically when you are back online.
            </Text>
            <TouchableOpacity style={W.doneBtn} onPress={() => setDoneOffline(false)} activeOpacity={0.8}>
              <Text style={W.doneBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (done) {
    return (
      <View style={W.root}>
        <View style={W.appBar}>
          <Text style={W.appBarTitle}>My Attendance</Text>
          <Text style={W.appBarDate}>{today}</Text>
        </View>
        <View style={W.center}>
          <View style={W.doneCard}>
            <Text style={W.doneIcon}>✓</Text>
            <Text style={W.doneTitle}>Attendance Recorded</Text>
            <Text style={W.doneSub}>You have been marked as present today.</Text>
            {pendingCount > 0 && (
              <TouchableOpacity style={W.syncBtn} onPress={flush} disabled={isFlushing} activeOpacity={0.8}>
                <Text style={W.syncBtnText}>
                  {isFlushing ? 'Syncing…' : `Sync ${pendingCount} pending`}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={W.doneBtn} onPress={() => setDone(false)} activeOpacity={0.8}>
              <Text style={W.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={W.root}>
      <View style={W.appBar}>
        <Text style={W.appBarTitle}>My Attendance</Text>
        <Text style={W.appBarDate}>{today}</Text>
      </View>

      <ScrollView
        style={W.scroll}
        contentContainerStyle={W.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Steps 1 & 2: project/site selection — hidden for users with defaults */}
        {!hasDefaults && (
          <>
            <Text style={W.stepLabel}>1 — Select Project</Text>
            {projects.length === 0 ? (
              <Text style={W.emptyText}>No projects assigned.</Text>
            ) : (
              projects.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={selected?.project.id === p.id ? [W.selectItem, W.selectItemActive] : W.selectItem}
                  onPress={() => {
                    setSelected(null);
                    setSites([]);
                    void loadSites(p);
                    setSelected({ project: p, site: null as unknown as JobSite });
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={W.selectItemText}>{p.name}</Text>
                  {selected?.project.id === p.id ? <Text style={W.check}>✓</Text> : null}
                </TouchableOpacity>
              ))
            )}

            {sites.length > 0 && (
              <>
                <Text style={[W.stepLabel, { marginTop: 20 }]}>2 — Select Site</Text>
                {sites.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={selected?.site?.id === s.id ? [W.selectItem, W.selectItemActive] : W.selectItem}
                    onPress={() => setSelected((prev) => prev ? { ...prev, site: s } : null)}
                    activeOpacity={0.8}
                  >
                    <Text style={W.selectItemText}>{s.name}</Text>
                    {selected?.site?.id === s.id ? <Text style={W.check}>✓</Text> : null}
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {/* Step 3 (check-in): shown immediately for defaults users, after site selection for others */}
        {selected?.site && (
          <>
            <Text style={[W.stepLabel, { marginTop: 20 }]}>3 — Check In</Text>
            <View style={W.timeWrap}>
              <Text style={W.timeLabel}>Check-in Time (optional, HH:MM)</Text>
              <TextInput
                style={W.timeInput}
                value={checkInTime}
                onChangeText={setCheckInTime}
                placeholder="08:00"
                placeholderTextColor="#1e3a5f"
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <TouchableOpacity
              style={submitting ? [W.checkInBtn, W.checkInBtnLoading] : W.checkInBtn}
              onPress={() => void handleCheckIn()}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={W.checkInBtnText}>
                {submitting ? 'Recording…' : 'Mark Me Present'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Mark Attendance modal ────────────────────────────────────────────────────

function MarkAttendanceModal({
  visible, onClose, projectId, siteId, onSaved,
}: {
  visible:   boolean;
  onClose:   () => void;
  projectId: string;
  siteId:    string;
  onSaved:   () => void;
}) {
  const [workers,        setWorkers]        = useState<Worker[]>([]);
  const [workerId,       setWorkerId]       = useState('');
  const [workerSearch,   setWorkerSearch]   = useState('');
  const [status,         setStatus]         = useState<AttendanceStatus>('present');
  const [checkInTime,    setCheckInTime]    = useState('');
  const [notes,          setNotes]          = useState('');
  const [saving,         setSaving]         = useState(false);
  const [loadingWorkers, setLoadingWorkers] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWorkerId('');
    setWorkerSearch('');
    setStatus('present');
    setCheckInTime('');
    setNotes('');
    setLoadingWorkers(true);
    workersApi.listBySite(projectId, siteId)
      .then(setWorkers)
      .catch(() => {})
      .finally(() => setLoadingWorkers(false));
  }, [visible, projectId, siteId]);

  async function save() {
    if (!workerId) {
      Alert.alert('Validation', 'Please select a worker');
      return;
    }
    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0]!;
      await attendanceApi.create(projectId, siteId, {
        workerId,
        date:       today,
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

  const selectedWorker = workers.find((w) => w.id === workerId) ?? null;
  const filteredWorkers = workerSearch.trim()
    ? workers.filter((w) =>
        `${w.firstName} ${w.lastName}`.toLowerCase().includes(workerSearch.toLowerCase()) ||
        (w.trade ?? '').toLowerCase().includes(workerSearch.toLowerCase()),
      )
    : workers;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={M.root}>

        {/* ── Header ───────────────────────────────────────────── */}
        <View style={M.header}>
          <View>
            <Text style={M.title}>Mark Attendance</Text>
            <Text style={M.subtitle}>Select worker and status</Text>
          </View>
          <TouchableOpacity
            style={M.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={M.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={M.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Worker picker ─────────────────────────────────── */}
          <Text style={M.fieldLabel}>Worker</Text>

          {/* Selected worker card — shown when one is picked */}
          {selectedWorker ? (
            <View style={M.selectedCard}>
              <View style={M.selectedAvatar}>
                <Text style={M.selectedAvatarText}>
                  {`${selectedWorker.firstName.charAt(0)}${selectedWorker.lastName.charAt(0)}`.toUpperCase()}
                </Text>
              </View>
              <View style={M.selectedInfo}>
                <Text style={M.selectedName}>{selectedWorker.firstName} {selectedWorker.lastName}</Text>
                {selectedWorker.trade ? (
                  <Text style={M.selectedTrade}>{selectedWorker.trade}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={M.changeBtn}
                onPress={() => { setWorkerId(''); setWorkerSearch(''); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={M.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Search field */}
              <View style={M.searchWrap}>
                <Text style={M.searchIcon}>⌕</Text>
                <TextInput
                  style={M.searchInput}
                  value={workerSearch}
                  onChangeText={setWorkerSearch}
                  placeholder="Search by name or trade…"
                  placeholderTextColor="#1e3a5f"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {workerSearch.length > 0 ? (
                  <TouchableOpacity onPress={() => setWorkerSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={M.searchClear}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Worker list */}
              {loadingWorkers ? (
                <ActivityIndicator color="#3b82f6" style={{ marginVertical: 20 }} />
              ) : filteredWorkers.length === 0 ? (
                <Text style={M.emptyText}>
                  {workers.length === 0
                    ? 'No workers assigned to this site yet.'
                    : 'No workers match your search.'}
                </Text>
              ) : (
                filteredWorkers.map((w) => {
                  const initials = `${w.firstName.charAt(0)}${w.lastName.charAt(0)}`.toUpperCase();
                  return (
                    <TouchableOpacity
                      key={w.id}
                      style={M.workerRow}
                      onPress={() => setWorkerId(w.id)}
                      activeOpacity={0.8}
                    >
                      <View style={M.avatar}>
                        <Text style={M.avatarText}>{initials}</Text>
                      </View>
                      <View style={M.workerInfo}>
                        <Text style={M.workerName}>{w.firstName} {w.lastName}</Text>
                        {w.trade ? <Text style={M.workerTrade}>{w.trade}</Text> : null}
                      </View>
                      <Text style={M.workerArrow}>›</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </>
          )}

          {/* ── Status ───────────────────────────────────────── */}
          <Text style={[M.fieldLabel, { marginTop: 24 }]}>Attendance Status</Text>
          <View style={M.statusGrid}>
            {STATUSES.map((s) => {
              const cfg      = STATUS_COLORS[s];
              const isActive = status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={isActive
                    ? [M.statusChip, { backgroundColor: cfg.bg, borderColor: cfg.border }]
                    : M.statusChip
                  }
                  onPress={() => setStatus(s)}
                  activeOpacity={0.8}
                >
                  <View style={[M.statusDot, { backgroundColor: isActive ? cfg.text : '#1e3a5f' }]} />
                  <Text style={isActive ? [M.statusChipText, { color: cfg.text }] : M.statusChipText}>
                    {STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Check-in time ────────────────────────────────── */}
          <Text style={[M.fieldLabel, { marginTop: 20 }]}>Check-in Time</Text>
          <View style={M.inputWrap}>
            <Text style={M.inputIcon}>🕐</Text>
            <TextInput
              style={M.input}
              value={checkInTime}
              onChangeText={setCheckInTime}
              placeholder="08:00  (optional)"
              placeholderTextColor="#1e3a5f"
              keyboardType="numbers-and-punctuation"
            />
          </View>

          {/* ── Notes ────────────────────────────────────────── */}
          <Text style={[M.fieldLabel, { marginTop: 16 }]}>Notes</Text>
          <View style={[M.inputWrap, M.inputWrapMulti]}>
            <TextInput
              style={[M.input, { height: 72, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes…"
              placeholderTextColor="#1e3a5f"
              multiline
            />
          </View>

          {/* ── Button row ───────────────────────────────────── */}
          <View style={M.btnRow}>
            <TouchableOpacity
              style={M.cancelBtn}
              onPress={onClose}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={M.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[M.saveBtn, saving ? M.saveBtnLoading : null]}
              onPress={() => void save()}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={M.saveBtnText}>{saving ? 'Saving…' : 'Save Attendance'}</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Supervisor attendance ────────────────────────────────────────────────────

function SupervisorAttendance({
  defaultProjectId: defProjId,
  defaultSiteId: defSiteId,
}: {
  defaultProjectId?: string | null;
  defaultSiteId?:    string | null;
}) {
  const hasDefaults = !!(defProjId && defSiteId);

  const [records,       setRecords]       = useState<AttendanceRecord[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [sites,         setSites]         = useState<JobSite[]>([]);
  const [selProj,       setSelProj]       = useState<Project | null>(null);
  const [selSite,       setSelSite]       = useState<JobSite | null>(null);
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);

  const now   = new Date();
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    if (hasDefaults) {
      // Fast path: load default project/site and their records in parallel
      Promise.all([
        projectsApi.get(defProjId!),
        projectsApi.getSite(defProjId!, defSiteId!),
        attendanceApi.list(defProjId!, defSiteId!),
      ]).then(([proj, site, recs]) => {
        setSelProj(proj);
        setSelSite(site);
        setRecords(recs);
      }).catch(() => {}).finally(() => setLoading(false));
    } else {
      // Legacy path: list all projects, auto-select first
      projectsApi.list().then((p) => {
        setProjects(p);
        if (p.length > 0) {
          setSelProj(p[0]!);
          void loadSites(p[0]!.id);
        }
      }).finally(() => setLoading(false));
    }
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

  async function handleCheckOut(record: AttendanceRecord) {
    if (!selProj || !selSite) return;
    setCheckingOutId(record.id);
    const now2       = new Date();
    const checkOutTime = `${String(now2.getHours()).padStart(2, '0')}:${String(now2.getMinutes()).padStart(2, '0')}`;
    try {
      await attendanceApi.update(selProj.id, selSite.id, record.id, { checkOutTime });
      await loadRecords(selProj.id, selSite.id);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save check-out time';
      Alert.alert('Error', msg);
    } finally {
      setCheckingOutId(null);
    }
  }

  // Summary stats
  const totalCrew     = records.length;
  const strictPresent = records.filter((r) => r.status === 'present').length;
  const halfDay       = records.filter((r) => r.status === 'half_day').length;
  const late          = records.filter((r) => r.status === 'late').length;
  const absent        = records.filter((r) => r.status === 'absent').length;
  const onSite        = strictPresent + late + halfDay;
  const attendanceRate = totalCrew > 0 ? Math.round((onSite / totalCrew) * 100) : 0;
  const rateColor      = attendanceRate < 70 ? '#ef4444' : attendanceRate <= 85 ? '#f59e0b' : '#22c55e';

  if (loading) {
    return (
      <View style={S.root}>
        <View style={S.appBar}>
          <Text style={S.appBarTitle}>Daily Attendance</Text>
          <Text style={S.appBarDate}>{today}</Text>
        </View>
        <View style={S.center}>
          <ActivityIndicator color="#3b82f6" size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={S.root}>
      {/* ── App bar ─────────────────────────────────────────────── */}
      <View style={S.appBar}>
        <Text style={S.appBarTitle}>Daily Attendance</Text>
        <Text style={S.appBarDate}>{today}</Text>
      </View>

      <FlatList
        data={records}
        keyExtractor={(r) => r.id}
        extraData={checkingOutId}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#3b82f6" />
        }
        ListHeaderComponent={
          <View style={S.listHeader}>
            {/* Project / site context pills */}
            {(selProj || selSite) && (
              <View style={S.contextRow}>
                {selProj ? <View style={S.contextPill}><Text style={S.contextPillText}>{selProj.name}</Text></View> : null}
                {selSite  ? <View style={S.contextPill}><Text style={S.contextPillText}>{selSite.name}</Text></View>  : null}
              </View>
            )}

            {/* Mark Attendance button */}
            {selProj && selSite ? (
              <TouchableOpacity style={S.markBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
                <Text style={S.markBtnPlus}>+</Text>
                <Text style={S.markBtnText}>Mark Attendance</Text>
              </TouchableOpacity>
            ) : null}

            {/* Attendance summary strip */}
            <View style={S.summaryGrid}>
              <SummaryCard label="Rate"    value={`${attendanceRate}%`} color={rateColor} />
              <SummaryCard label="Present" value={onSite}               color="#60a5fa" />
              <SummaryCard label="Late"    value={late}                  color={late   > 0 ? '#f59e0b' : '#22c55e'} />
              <SummaryCard label="Absent"  value={absent}               color={absent > 0 ? '#f59e0b' : '#22c55e'} />
            </View>

            {records.length > 0 ? (
              <Text style={S.crewLabel}>Crew Roster</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={S.empty}>
            <Text style={S.emptyTitle}>No records today</Text>
            <Text style={S.emptySub}>Tap + Mark Attendance to add the first entry.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const initials      = `${item.worker.firstName.charAt(0)}${item.worker.lastName.charAt(0)}`.toUpperCase();
          const cfg           = STATUS_COLORS[item.status];
          const isCheckingOut = checkingOutId === item.id;
          const accent        = getCardAccent(item.status);

          return (
            <View style={accent ? [S.card, accent] : S.card}>
              {/* Top row: avatar + name/trade + status badge */}
              <View style={S.cardTop}>
                <View style={S.avatar}>
                  <Text style={S.avatarText}>{initials}</Text>
                </View>
                <View style={S.cardMid}>
                  <Text style={S.workerName}>{item.worker.firstName} {item.worker.lastName}</Text>
                  {item.worker.trade ? (
                    <Text style={S.workerTrade}>{item.worker.trade}</Text>
                  ) : null}
                </View>
                <View style={[S.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                  <Text style={[S.statusBadgeText, { color: cfg.text }]}>
                    {STATUS_LABELS[item.status]}
                  </Text>
                </View>
              </View>

              {/* Times row */}
              <View style={S.timesRow}>
                {item.checkInTime ? (
                  <View style={S.timePill}>
                    <Text style={S.timePillLabel}>IN</Text>
                    <Text style={S.timePillValue}>{item.checkInTime}</Text>
                  </View>
                ) : null}

                {item.checkOutTime ? (
                  <View style={S.timePill}>
                    <Text style={S.timePillLabel}>OUT</Text>
                    <Text style={S.timePillValue}>{item.checkOutTime}</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={isCheckingOut ? [S.checkOutBtn, S.checkOutBtnDisabled] : S.checkOutBtn}
                    onPress={() => void handleCheckOut(item)}
                    disabled={isCheckingOut}
                    activeOpacity={0.8}
                  >
                    <Text style={S.checkOutBtnText}>
                      {isCheckingOut ? 'Saving…' : 'Check Out'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Notes */}
              {item.notes ? (
                <Text style={S.notes} numberOfLines={2}>{item.notes}</Text>
              ) : null}
            </View>
          );
        }}
        contentContainerStyle={S.listContent}
      />

      {selProj && selSite ? (
        <MarkAttendanceModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          projectId={selProj.id}
          siteId={selSite.id}
          onSaved={() => void loadRecords(selProj.id, selSite.id)}
        />
      ) : null}
    </View>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={SC.card}>
      <Text style={[SC.value, { color }]}>{value}</Text>
      <Text style={SC.label}>{label}</Text>
    </View>
  );
}

// ─── Per-card accent based on status ─────────────────────────────────────────

function getCardAccent(status: AttendanceStatus): object | null {
  if (status === 'absent')  return { borderLeftWidth: 3, borderLeftColor: '#ef4444', backgroundColor: '#0f0608' };
  if (status === 'late')    return { borderLeftWidth: 3, borderLeftColor: '#f59e0b', backgroundColor: '#0f0900' };
  if (status === 'excused') return { opacity: 0.5 };
  return null;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function AttendanceScreen() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const defaultProjectId = user.defaultProjectId ?? null;
  const defaultSiteId    = user.defaultSiteId    ?? null;
  return user.role === 'worker'
    ? <WorkerAttendance defaultProjectId={defaultProjectId} defaultSiteId={defaultSiteId} />
    : <SupervisorAttendance defaultProjectId={defaultProjectId} defaultSiteId={defaultSiteId} />;
}

// ─── Styles: Worker self-attendance ──────────────────────────────────────────

const W = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#060d1b' },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center' },

  appBar: {
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  appBarTitle: { color: '#e8f0fe', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  appBarDate:  { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },

  stepLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 20,
  },
  emptyText: { color: '#1e3a5f', fontSize: 14 },

  selectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 8,
  },
  selectItemActive: { borderColor: '#3b82f6', backgroundColor: '#0e1e36' },
  selectItemText:   { color: '#c8d8f0', fontSize: 14, fontWeight: '500', flex: 1 },
  check:            { color: '#3b82f6', fontSize: 16, fontWeight: '700' },

  timeWrap:  { marginBottom: 14 },
  timeLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 7,
  },
  timeInput: {
    backgroundColor: '#060e1c',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#112036',
    paddingHorizontal: 14,
    height: 48,
    color: '#d0e0f5',
    fontSize: 15,
  },

  checkInBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  checkInBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  checkInBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700' },

  doneCard: {
    backgroundColor: '#0a1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 28,
    alignItems: 'center',
    marginHorizontal: 24,
    gap: 10,
  },
  doneIcon:  { fontSize: 48, color: '#22c55e' },
  doneTitle: { color: '#e8f0fe', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  doneSub:   { color: '#3d6090', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  doneBtn: {
    marginTop: 8,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  syncBtn: {
    backgroundColor: '#1a0800',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  syncBtnText: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },
});

// ─── Styles: Supervisor main view ─────────────────────────────────────────────

const S = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#060d1b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  appBar: {
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  appBarTitle: { color: '#e8f0fe', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  appBarDate:  { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },

  listContent: { paddingBottom: 48 },
  listHeader:  { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 14 },

  contextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contextPill: {
    backgroundColor: '#0a1628',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  contextPillText: { color: '#3d6090', fontSize: 12, fontWeight: '600' },

  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    height: 52,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  markBtnPlus: { color: '#fff', fontSize: 22, fontWeight: '300', lineHeight: 26 },
  markBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  summaryGrid: { flexDirection: 'row', gap: 10 },

  crewLabel: {
    color: '#6a90b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 2,
  },

  card: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0e1e36',
    borderWidth: 1,
    borderColor: '#1e3a6e',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#60a5fa', fontSize: 16, fontWeight: '700' },

  cardMid:     { flex: 1, gap: 2 },
  workerName:  { color: '#e8f0fe', fontSize: 15, fontWeight: '700' },
  workerTrade: { color: '#3d6090', fontSize: 12, fontWeight: '500' },

  statusBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  timesRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#070f1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0e1e36',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  timePillLabel: { color: '#1e3a5f', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  timePillValue: { color: '#c8d8f0', fontSize: 13, fontWeight: '600' },

  checkOutBtn: {
    backgroundColor: '#0e1e36',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  checkOutBtnDisabled: { opacity: 0.5 },
  checkOutBtnText:     { color: '#3b82f6', fontSize: 13, fontWeight: '600' },

  notes: { color: '#2d5070', fontSize: 12, fontStyle: 'italic' },

  empty:      { alignItems: 'center', paddingTop: 64, gap: 8 },
  emptyTitle: { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  emptySub:   { color: '#1e3a5f', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Styles: Summary card ─────────────────────────────────────────────────────

const SC = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#0a1628',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#142240',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  value: { fontSize: 28, fontWeight: '800', letterSpacing: -1 },
  label: {
    color: '#2d5070',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

// ─── Styles: Modal ────────────────────────────────────────────────────────────

const M = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#060d1b' },
  content: { padding: 20, paddingBottom: 56 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
  },
  title:    { color: '#e8f0fe', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },
  closeBtn: {
    width: 34, height: 34,
    borderRadius: 17,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#3d6090', fontSize: 15, fontWeight: '600' },

  // Field label
  fieldLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  emptyText: { color: '#1e3a5f', fontSize: 14, paddingVertical: 8 },

  // Selected worker card
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0e1e36',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3b82f6',
    padding: 14,
  },
  selectedAvatar: {
    width: 48, height: 48,
    borderRadius: 24,
    backgroundColor: '#1a3260',
    borderWidth: 1,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedAvatarText: { color: '#60a5fa', fontSize: 18, fontWeight: '800' },
  selectedInfo:       { flex: 1, gap: 2 },
  selectedName:       { color: '#e8f0fe', fontSize: 15, fontWeight: '700' },
  selectedTrade:      { color: '#3b82f6', fontSize: 12, fontWeight: '500' },
  changeBtn: {
    backgroundColor: '#0a1628',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  changeBtnText: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 14,
    height: 46,
    gap: 8,
    marginBottom: 10,
  },
  searchIcon:  { color: '#1e3a5f', fontSize: 18 },
  searchInput: { flex: 1, color: '#d0e0f5', fontSize: 14, padding: 0 },
  searchClear: { color: '#1e3a5f', fontSize: 13, fontWeight: '700' },

  // Worker list row
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0a1628',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#142240',
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  avatar: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: '#0e1e36',
    borderWidth: 1,
    borderColor: '#1e3a6e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText:  { color: '#3d6090', fontSize: 15, fontWeight: '700' },
  workerInfo:  { flex: 1, gap: 2 },
  workerName:  { color: '#c8d8f0', fontSize: 14, fontWeight: '600' },
  workerTrade: { color: '#2d5070', fontSize: 12 },
  workerArrow: { color: '#1e3a5f', fontSize: 20 },

  // Status grid — 2 per row
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  statusChip: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 13,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
  },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { color: '#3d6090', fontSize: 14, fontWeight: '600' },

  // Inputs
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060e1c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#112036',
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
    marginBottom: 4,
  },
  inputWrapMulti: { height: 96, alignItems: 'flex-start', paddingTop: 12 },
  inputIcon:      { fontSize: 16 },
  input:          { flex: 1, color: '#d0e0f5', fontSize: 15, padding: 0 },

  // Button row
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#142240',
    backgroundColor: '#0a1628',
  },
  cancelBtnText: { color: '#3d6090', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 2,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
  },
  saveBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  saveBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },
});
