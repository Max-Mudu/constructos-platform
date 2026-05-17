import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
  Modal, ScrollView, Alert, TextInput, ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../../src/store/auth.store';
import { projectsApi } from '../../src/api/projects';
import { schedulesApi } from '../../src/api/schedules';
import { contractorsApi } from '../../src/api/contractors';
import { Project, JobSite, ScheduleTask, ScheduleTaskStatus, Contractor, ScheduleActivity } from '../../src/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleFilter = 'today' | 'upcoming' | 'all';

type ScheduleTaskWithContext = ScheduleTask & {
  projectName?: string;
  siteName?:    string;
};

// ─── RBAC ─────────────────────────────────────────────────────────────────────

const WRITE_ROLES    = new Set(['company_admin', 'project_manager', 'contractor']);
const PROGRESS_ROLES = new Set(['company_admin', 'project_manager', 'site_supervisor', 'contractor']);

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ScheduleTaskStatus, { label: string; color: string; bg: string; border: string }> = {
  not_started: { label: 'Not Started', color: '#64748b', bg: '#0a1628', border: '#142240' },
  in_progress: { label: 'In Progress', color: '#3b82f6', bg: '#0e1e36', border: '#1e3a6e' },
  delayed:     { label: 'Delayed',     color: '#f59e0b', bg: '#1a1200', border: '#422006' },
  blocked:     { label: 'Blocked',     color: '#ef4444', bg: '#1a0606', border: '#450a0a' },
  completed:   { label: 'Completed',   color: '#22c55e', bg: '#071a0e', border: '#14532d' },
};

const STATUS_OPTIONS: Array<{ value: ScheduleTaskStatus; label: string }> = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'delayed',     label: 'Delayed'     },
  { value: 'blocked',     label: 'Blocked'     },
  { value: 'completed',   label: 'Completed'   },
];

const FILTERS: Array<{ label: string; value: ScheduleFilter }> = [
  { label: 'Today',    value: 'today'    },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'All Tasks', value: 'all'     },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  return value.split('T')[0] ?? value;
}

function todayString() {
  return new Date().toISOString().split('T')[0] ?? '';
}

function getStatusConfig(status: ScheduleTaskStatus) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started;
}

function isTodayTask(task: ScheduleTaskWithContext) {
  const today = todayString();
  const start = normalizeDate(task.plannedStartDate);
  const end   = normalizeDate(task.plannedEndDate);
  if (start === today) return true;
  if (end   === today) return true;
  if (start && end) return start <= today && end >= today;
  return false;
}

function isUpcomingTask(task: ScheduleTaskWithContext) {
  const today = todayString();
  const start = normalizeDate(task.plannedStartDate);
  if (!start) return false;
  return start > today;
}

function isOnDay(task: ScheduleTaskWithContext, day: string) {
  const start = normalizeDate(task.plannedStartDate);
  const end   = normalizeDate(task.plannedEndDate);
  if (start === day) return true;
  if (end   === day) return true;
  if (start && end) return start <= day && end >= day;
  return false;
}

function getWeekDays(): { date: string; day: string; dayNum: number }[] {
  const today     = new Date();
  const dayOfWeek = today.getDay();
  const monday    = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date:   d.toISOString().split('T')[0]!,
      day:    labels[d.getDay()] ?? 'Mo',
      dayNum: d.getDate(),
    };
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtActivityLine(type: ScheduleActivity['type'], oldValue: string | null, newValue: string | null): string {
  const fmtStatus = (s: string) => s.replace(/_/g, ' ');
  switch (type) {
    case 'status_change':
      return oldValue
        ? `Status: ${fmtStatus(oldValue)} → ${fmtStatus(newValue ?? '')}`
        : `Status set to ${fmtStatus(newValue ?? '')}`;
    case 'progress_update':
      return oldValue !== null
        ? `Progress: ${oldValue}% → ${newValue ?? '0'}%`
        : `Progress updated to ${newValue ?? '0'}%`;
    case 'delay_reason':
      return `Delay: ${newValue ?? ''}`;
    case 'block_reason':
      return `Blocked: ${newValue ?? ''}`;
    case 'note_update':
      return `Note: ${(newValue ?? '').slice(0, 80)}${(newValue ?? '').length > 80 ? '…' : ''}`;
    default:
      return newValue ?? '';
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ScheduleTaskStatus }) {
  const cfg = getStatusConfig(status);
  return (
    <View style={[SB.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <View style={[SB.dot, { backgroundColor: cfg.color }]} />
      <Text style={[SB.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const SB = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  text:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});

// ─── Update Task Modal ────────────────────────────────────────────────────────

function UpdateTaskModal({
  visible, task, onClose, onUpdated,
}: {
  visible:   boolean;
  task:      ScheduleTaskWithContext | null;
  onClose:   () => void;
  onUpdated: () => void;
}) {
  const [status,          setStatus]          = useState<ScheduleTaskStatus>('not_started');
  const [progressText,    setProgressText]    = useState('');
  const [actualStartDate, setActualStartDate] = useState('');
  const [actualEndDate,   setActualEndDate]   = useState('');
  const [delayReason,     setDelayReason]     = useState('');
  const [comments,        setComments]        = useState('');
  const [saving,          setSaving]          = useState(false);
  const [activity,        setActivity]        = useState<ScheduleActivity[]>([]);

  useEffect(() => {
    if (task) {
      setStatus(task.status);
      setProgressText(task.actualProgress != null ? String(task.actualProgress) : '');
      setActualStartDate(normalizeDate(task.actualStartDate) ?? '');
      setActualEndDate(normalizeDate(task.actualEndDate) ?? '');
      setDelayReason(task.delayReason ?? '');
      setComments(task.comments ?? '');
      setActivity([]);
      void schedulesApi.getActivity(task.projectId, task.siteId, task.id).then(setActivity);
    }
  }, [task]);

  function handleStatusChange(next: ScheduleTaskStatus) {
    setStatus(next);
    if (next === 'completed') setProgressText('100');
  }

  async function handleSave() {
    if (!task) return;
    const needsReason = status === 'delayed' || status === 'blocked';
    if (needsReason && !delayReason.trim()) {
      Alert.alert('Validation', `Please enter a reason for the ${status} status.`);
      return;
    }
    const rawProgress  = parseFloat(progressText);
    const actualProgress =
      status === 'completed'                                              ? 100
      : !isNaN(rawProgress) && rawProgress >= 0 && rawProgress <= 100   ? rawProgress
      : null;
    setSaving(true);
    try {
      await schedulesApi.updateTask(task.projectId, task.siteId, task.id, {
        status,
        actualProgress,
        actualStartDate: actualStartDate.trim() || null,
        actualEndDate:   actualEndDate.trim()   || null,
        delayReason:     needsReason ? (delayReason.trim() || null) : null,
        comments:        comments.trim() || null,
      });
      onUpdated();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to update task';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  const showProgress = status === 'in_progress' || status === 'completed';
  const showReason   = status === 'delayed' || status === 'blocked';
  const cfg          = getStatusConfig(status);
  const progressVal  = Math.min(100, Math.max(0, parseFloat(progressText) || 0));

  if (!task) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={UM.root}>
        {/* Header */}
        <View style={UM.header}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={UM.headerEyebrow}>Update Task Progress</Text>
            <Text style={UM.title} numberOfLines={2}>{task.title}</Text>
            {task.siteName ? (
              <Text style={UM.subtitle}>
                {task.siteName}{task.projectName ? ` · ${task.projectName}` : ''}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={UM.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={UM.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={UM.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Status */}
          <Text style={UM.sectionLabel}>Task Status</Text>
          <View style={UM.statusGrid}>
            {STATUS_OPTIONS.map((opt) => {
              const c        = STATUS_CONFIG[opt.value];
              const isActive = status === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={isActive
                    ? [UM.statusChip, { backgroundColor: c.bg, borderColor: c.border }]
                    : UM.statusChip
                  }
                  onPress={() => handleStatusChange(opt.value)}
                  activeOpacity={0.8}
                >
                  <View style={[UM.statusDot, { backgroundColor: isActive ? c.color : '#1e3a5f' }]} />
                  <Text style={[UM.statusChipText, isActive ? { color: c.color } : null]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Progress */}
          {showProgress ? (
            <View style={UM.section}>
              <Text style={UM.sectionLabel}>Completion Progress</Text>
              {/* Live progress bar */}
              <View style={UM.progressPreviewWrap}>
                <View style={UM.progressPreviewBg}>
                  <View
                    style={[
                      UM.progressPreviewFill,
                      { width: `${progressVal}%` as `${number}%`, backgroundColor: cfg.color },
                    ]}
                  />
                </View>
                <Text style={[UM.progressPreviewPct, { color: cfg.color }]}>{progressVal}%</Text>
              </View>
              {/* Stepper row */}
              <View style={UM.progressRow}>
                <TouchableOpacity
                  style={UM.stepperBtn}
                  onPress={() => setProgressText(String(Math.max(0, progressVal - 5)))}
                  activeOpacity={0.8}
                >
                  <Text style={UM.stepperBtnText}>−5</Text>
                </TouchableOpacity>
                <View style={UM.progressInputWrap}>
                  <TextInput
                    style={UM.progressInput}
                    value={progressText}
                    onChangeText={setProgressText}
                    placeholder="0"
                    placeholderTextColor="#1e3a5f"
                    keyboardType="numeric"
                    textAlign="center"
                  />
                  <Text style={UM.progressInputSuffix}>%</Text>
                </View>
                <TouchableOpacity
                  style={UM.stepperBtn}
                  onPress={() => setProgressText(String(Math.min(100, progressVal + 5)))}
                  activeOpacity={0.8}
                >
                  <Text style={UM.stepperBtnText}>+5</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Execution dates */}
          <View style={UM.section}>
            <Text style={UM.sectionLabel}>Actual Start Date (YYYY-MM-DD)</Text>
            <View style={UM.inputWrap}>
              <TextInput
                style={UM.input}
                value={actualStartDate}
                onChangeText={setActualStartDate}
                placeholder="e.g. 2025-06-01"
                placeholderTextColor="#1e3a5f"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
            </View>
          </View>

          {(status === 'in_progress' || status === 'completed') ? (
            <View style={UM.section}>
              <Text style={UM.sectionLabel}>Actual End Date (YYYY-MM-DD)</Text>
              <View style={UM.inputWrap}>
                <TextInput
                  style={UM.input}
                  value={actualEndDate}
                  onChangeText={setActualEndDate}
                  placeholder="e.g. 2025-06-15"
                  placeholderTextColor="#1e3a5f"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                />
              </View>
            </View>
          ) : null}

          {/* Delay / block reason */}
          {showReason ? (
            <View style={UM.section}>
              <Text style={UM.sectionLabel}>
                {status === 'blocked' ? 'Block Reason *' : 'Delay Reason *'}
              </Text>
              <View style={[UM.inputWrap, UM.inputMulti]}>
                <TextInput
                  style={[UM.input, { height: 72, textAlignVertical: 'top' }]}
                  value={delayReason}
                  onChangeText={setDelayReason}
                  placeholder="Describe the cause…"
                  placeholderTextColor="#1e3a5f"
                  multiline
                />
              </View>
            </View>
          ) : null}

          {/* Execution Notes */}
          <View style={UM.section}>
            <Text style={UM.sectionLabel}>Execution Notes (optional)</Text>
            <View style={[UM.inputWrap, UM.inputMulti]}>
              <TextInput
                style={[UM.input, { height: 72, textAlignVertical: 'top' }]}
                value={comments}
                onChangeText={setComments}
                placeholder="Site observations, materials used, issues…"
                placeholderTextColor="#1e3a5f"
                multiline
              />
            </View>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={saving ? [UM.saveBtn, { marginTop: 24 }, UM.saveBtnLoading] : [UM.saveBtn, { marginTop: 24 }]}
            onPress={() => void handleSave()}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={UM.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={UM.discardBtn} onPress={onClose} disabled={saving} activeOpacity={0.7}>
            <Text style={UM.discardBtnText}>Discard Changes</Text>
          </TouchableOpacity>

          {/* ── Activity Timeline ──────────────────────────────────── */}
          {activity.length > 0 && (
            <View style={UM.timelineSection}>
              <Text style={UM.timelineHeader}>Activity</Text>
              {activity.map((a) => (
                <View key={a.id} style={UM.timelineRow}>
                  <View style={UM.timelineDot} />
                  <View style={UM.timelineBody}>
                    <Text style={UM.timelineText}>
                      {fmtActivityLine(a.type, a.oldValue, a.newValue)}
                    </Text>
                    <Text style={UM.timelineMeta}>
                      {a.user.firstName} {a.user.lastName} · {fmtTimeAgo(a.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({
  visible, onClose, sites, projects, contractors, onCreated,
}: {
  visible:     boolean;
  onClose:     () => void;
  sites:       JobSite[];
  projects:    Project[];
  contractors: Contractor[];
  onCreated:   () => void;
}) {
  const [siteId,       setSiteId]       = useState('');
  const [contractorId, setContractorId] = useState('');
  const [title,        setTitle]        = useState('');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [area,         setArea]         = useState('');
  const [saving,       setSaving]       = useState(false);

  function reset() {
    setSiteId(''); setContractorId(''); setTitle('');
    setStartDate(''); setEndDate(''); setArea('');
  }

  function handleClose() { reset(); onClose(); }

  async function handleSave() {
    if (!title.trim())    { Alert.alert('Validation', 'Task title is required'); return; }
    if (!siteId)          { Alert.alert('Validation', 'Please select a site'); return; }
    if (!contractorId)    { Alert.alert('Validation', 'Please select a contractor'); return; }
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;
    setSaving(true);
    try {
      await schedulesApi.createTask(site.projectId, site.id, {
        contractorId,
        title:            title.trim(),
        area:             area.trim()      || undefined,
        plannedStartDate: startDate.trim() || undefined,
        plannedEndDate:   endDate.trim()   || undefined,
      });
      reset();
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to create task';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={UM.root}>
        <View style={UM.header}>
          <Text style={UM.title}>New Schedule Task</Text>
          <TouchableOpacity style={UM.closeBtn} onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={UM.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={UM.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={UM.fieldLabel}>Site *</Text>
          {sites.length === 0 ? (
            <Text style={UM.emptyNote}>No sites available</Text>
          ) : (
            sites.map((s) => {
              const project = projects.find((p) => p.id === s.projectId);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={siteId === s.id ? [UM.selectRow, UM.selectRowActive] : UM.selectRow}
                  onPress={() => setSiteId(s.id)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={UM.selectName}>{s.name}</Text>
                    {project ? <Text style={UM.selectSub}>{project.name}</Text> : null}
                  </View>
                  {siteId === s.id ? <Text style={UM.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            })
          )}

          <Text style={[UM.fieldLabel, { marginTop: 16 }]}>Contractor *</Text>
          {contractors.length === 0 ? (
            <Text style={UM.emptyNote}>No active contractors found</Text>
          ) : (
            contractors.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={contractorId === c.id ? [UM.selectRow, UM.selectRowActive] : UM.selectRow}
                onPress={() => setContractorId(c.id)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={UM.selectName}>{c.name}</Text>
                  {c.tradeSpecialization ? <Text style={UM.selectSub}>{c.tradeSpecialization}</Text> : null}
                </View>
                {contractorId === c.id ? <Text style={UM.check}>✓</Text> : null}
              </TouchableOpacity>
            ))
          )}

          {[
            { label: 'Title *', value: title, onChange: setTitle, placeholder: 'e.g. Lay foundation slab', keyboard: 'default' as const },
            { label: 'Area (optional)', value: area, onChange: setArea, placeholder: 'e.g. Block A, Level 2', keyboard: 'default' as const },
            { label: 'Planned Start (YYYY-MM-DD)', value: startDate, onChange: setStartDate, placeholder: '2025-06-01', keyboard: 'numbers-and-punctuation' as const },
            { label: 'Planned End (YYYY-MM-DD)',   value: endDate,   onChange: setEndDate,   placeholder: '2025-06-15', keyboard: 'numbers-and-punctuation' as const },
          ].map(({ label, value, onChange, placeholder, keyboard }) => (
            <View key={label} style={[UM.fieldGroup, { marginTop: 12 }]}>
              <Text style={UM.fieldLabel}>{label}</Text>
              <View style={UM.inputWrap}>
                <TextInput
                  style={UM.input}
                  value={value}
                  onChangeText={onChange}
                  placeholder={placeholder}
                  placeholderTextColor="#1e3a5f"
                  keyboardType={keyboard}
                  autoCapitalize="none"
                />
              </View>
            </View>
          ))}

          <View style={UM.btnRow}>
            <TouchableOpacity style={UM.cancelBtn} onPress={handleClose} disabled={saving} activeOpacity={0.8}>
              <Text style={UM.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={saving ? [UM.saveBtn, { flex: 2 }, UM.saveBtnLoading] : [UM.saveBtn, { flex: 2 }]}
              onPress={() => void handleSave()}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={UM.saveBtnText}>{saving ? 'Creating…' : 'Create Task'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Risk helpers ─────────────────────────────────────────────────────────────

function getTaskAccent(task: ScheduleTaskWithContext, today: string): {
  borderLeftColor: string;
  backgroundColor?: string;
  opacity?: number;
} {
  if (task.status === 'completed') {
    return { borderLeftColor: '#14532d', opacity: 0.55 };
  }
  const end      = normalizeDate(task.plannedEndDate);
  const isOverdue = end !== null && end < today;
  if (isOverdue || task.status === 'blocked') {
    return { borderLeftColor: '#ef4444', backgroundColor: '#0f0608' };
  }
  if (task.status === 'delayed') {
    return { borderLeftColor: '#f59e0b', backgroundColor: '#100900' };
  }
  if (
    task.actualProgress !== null && task.plannedProgress !== null &&
    task.actualProgress < task.plannedProgress - 10
  ) {
    return { borderLeftColor: '#f59e0b', backgroundColor: '#100900' };
  }
  return { borderLeftColor: getStatusConfig(task.status).color };
}

function RiskChip({ label, count, color }: { label: string; count: number; color: 'red' | 'amber' }) {
  const c = color === 'red'
    ? { bg: '#1a0606', border: '#450a0a', text: '#f87171' }
    : { bg: '#1a1200', border: '#422006', text: '#fbbf24' };
  return (
    <View style={[A.riskChip, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[A.riskChipCount, { color: c.text }]}>{count}</Text>
      <Text style={[A.riskChipLabel, { color: c.text }]}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const user      = useAuthStore((s) => s.user);
  const canCreate = user && WRITE_ROLES.has(user.role);
  const canUpdate = user && PROGRESS_ROLES.has(user.role);

  const [projects,     setProjects]     = useState<Project[]>([]);
  const [sites,        setSites]        = useState<JobSite[]>([]);
  const [tasks,        setTasks]        = useState<ScheduleTaskWithContext[]>([]);
  const [contractors,  setContractors]  = useState<Contractor[]>([]);
  const [filter,       setFilter]       = useState<ScheduleFilter>('today');
  const [selectedDay,  setSelectedDay]  = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [showCreate,   setShowCreate]   = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduleTaskWithContext | null>(null);
  const [showUpdate,   setShowUpdate]   = useState(false);

  const weekDays = useMemo(() => getWeekDays(), []);
  const todayStr = todayString();

  async function load() {
    try {
      const projectList = await projectsApi.list();
      setProjects(projectList);

      const allSites: JobSite[] = [];
      for (const project of projectList) {
        try {
          const projectSites = await projectsApi.listSites(project.id);
          allSites.push(...projectSites);
        } catch { /* skip */ }
      }
      setSites(allSites);

      const allTasks: ScheduleTaskWithContext[] = [];
      for (const site of allSites) {
        const project = projectList.find((p) => p.id === site.projectId);
        try {
          const siteTasks = await schedulesApi.listTasks(site.projectId, site.id);
          siteTasks.forEach((task) => {
            allTasks.push({ ...task, projectName: project?.name, siteName: site.name });
          });
        } catch { /* skip */ }
      }

      allTasks.sort((a, b) => {
        const aDate = normalizeDate(a.plannedStartDate) ?? '9999-12-31';
        const bDate = normalizeDate(b.plannedStartDate) ?? '9999-12-31';
        return aDate.localeCompare(bDate);
      });
      setTasks(allTasks);

      if (canCreate) {
        try {
          const cl = await contractorsApi.list({ isActive: true });
          setContractors(cl);
        } catch { /* non-fatal */ }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openUpdate(task: ScheduleTaskWithContext) {
    setSelectedTask(task);
    setShowUpdate(true);
  }

  function closeUpdate() {
    setShowUpdate(false);
    setSelectedTask(null);
  }

  const visibleTasks = useMemo(() => {
    if (selectedDay)          return tasks.filter((t) => isOnDay(t, selectedDay));
    if (filter === 'today')   return tasks.filter(isTodayTask);
    if (filter === 'upcoming') return tasks.filter(isUpcomingTask);
    return tasks;
  }, [filter, selectedDay, tasks]);

  const upcomingDeadlines = useMemo(() => {
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekStr = week.toISOString().split('T')[0]!;
    return tasks
      .filter((t) => {
        const end = normalizeDate(t.plannedEndDate);
        return end && end >= todayStr && end <= weekStr && t.status !== 'completed';
      })
      .slice(0, 3);
  }, [tasks, todayStr]);

  const riskSummary = useMemo(() => {
    const today = todayStr;
    return {
      overdue:    tasks.filter((t) => t.status !== 'completed' && normalizeDate(t.plannedEndDate) !== null && (normalizeDate(t.plannedEndDate) as string) < today).length,
      dueToday:   tasks.filter((t) => t.status !== 'completed' && normalizeDate(t.plannedEndDate) === today).length,
      blocked:    tasks.filter((t) => t.status === 'blocked').length,
      delayed:    tasks.filter((t) => t.status === 'delayed').length,
      behindPlan: tasks.filter((t) => t.actualProgress !== null && t.plannedProgress !== null && t.actualProgress < t.plannedProgress - 10).length,
    };
  }, [tasks, todayStr]);
  const hasRisk = riskSummary.overdue > 0 || riskSummary.dueToday > 0 || riskSummary.blocked > 0 || riskSummary.delayed > 0 || riskSummary.behindPlan > 0;

  // Date range label (week)
  const weekStart = weekDays[0];
  const weekEnd   = weekDays[6];
  const dateRangeLabel = weekStart && weekEnd
    ? `${fmtDate(weekStart.date)} – ${fmtDate(weekEnd.date)}`
    : '';

  if (loading) {
    return (
      <View style={A.root}>
        <View style={A.appBar}>
          <Text style={A.appBarTitle}>Weekly Schedule</Text>
        </View>
        <View style={A.center}>
          <ActivityIndicator color="#3b82f6" size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={A.root}>
      {/* ── App bar ───────────────────────────────────────────── */}
      <View style={A.appBar}>
        <View>
          <Text style={A.appBarTitle}>Weekly Schedule</Text>
          <Text style={A.appBarDate}>{dateRangeLabel}</Text>
        </View>
        <View style={A.appBarRight}>
          <View style={A.taskCountBadge}>
            <Text style={A.taskCountText}>{tasks.length}</Text>
          </View>
          {canCreate ? (
            <TouchableOpacity style={A.createBtn} onPress={() => setShowCreate(true)} activeOpacity={0.8}>
              <Text style={A.createBtnText}>+ Task</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Week day selector ─────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={A.weekRow}
        style={A.weekScroll}
      >
        {weekDays.map((wd) => {
          const isToday    = wd.date === todayStr;
          const isSelected = selectedDay === wd.date;
          const dayTasks   = tasks.filter((t) => isOnDay(t, wd.date));
          return (
            <TouchableOpacity
              key={wd.date}
              style={isSelected ? [A.dayBtn, A.dayBtnSelected] : isToday ? [A.dayBtn, A.dayBtnToday] : A.dayBtn}
              onPress={() => setSelectedDay(isSelected ? null : wd.date)}
              activeOpacity={0.8}
            >
              <Text style={isSelected ? [A.dayLabel, A.dayLabelSelected] : isToday ? [A.dayLabel, A.dayLabelToday] : A.dayLabel}>
                {wd.day}
              </Text>
              <Text style={isSelected ? [A.dayNum, A.dayNumSelected] : isToday ? [A.dayNum, A.dayNumToday] : A.dayNum}>
                {wd.dayNum}
              </Text>
              {dayTasks.length > 0 ? (
                <View style={isSelected ? [A.dayDot, A.dayDotSelected] : A.dayDot} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Filter chips ──────────────────────────────────────── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={A.filterRow} style={A.filterScroll}>
        {FILTERS.map((item) => {
          const isActive = !selectedDay && filter === item.value;
          return (
            <TouchableOpacity
              key={item.value}
              style={isActive ? [A.filterChip, A.filterChipActive] : A.filterChip}
              onPress={() => { setFilter(item.value); setSelectedDay(null); }}
              activeOpacity={0.8}
            >
              <Text style={isActive ? [A.filterChipText, A.filterChipTextActive] : A.filterChipText}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Risk strip ───────────────────────────────────────── */}
      {hasRisk ? (
        <View style={A.riskStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={A.riskRow}>
            {riskSummary.overdue    > 0 ? <RiskChip label="Overdue"     count={riskSummary.overdue}    color="red"   /> : null}
            {riskSummary.blocked    > 0 ? <RiskChip label="Blocked"     count={riskSummary.blocked}    color="red"   /> : null}
            {riskSummary.dueToday   > 0 ? <RiskChip label="Due Today"   count={riskSummary.dueToday}   color="amber" /> : null}
            {riskSummary.delayed    > 0 ? <RiskChip label="Delayed"     count={riskSummary.delayed}    color="amber" /> : null}
            {riskSummary.behindPlan > 0 ? <RiskChip label="Behind Plan" count={riskSummary.behindPlan} color="amber" /> : null}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Task list ─────────────────────────────────────────── */}
      <FlatList
        data={visibleTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={A.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#3b82f6" />
        }
        ListHeaderComponent={
          upcomingDeadlines.length > 0 ? (
            <View style={A.deadlinesCard}>
              <Text style={A.deadlinesTitle}>⚠ Upcoming Deadlines</Text>
              {upcomingDeadlines.map((t) => {
                const cfg = getStatusConfig(t.status);
                return (
                  <View key={t.id} style={A.deadlineRow}>
                    <View style={[A.deadlineAccent, { backgroundColor: cfg.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={A.deadlineName} numberOfLines={1}>{t.title}</Text>
                      <Text style={A.deadlineSub}>{t.siteName ?? '—'} · Due {fmtDate(t.plannedEndDate)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={A.empty}>
            <Text style={A.emptyTitle}>No tasks</Text>
            <Text style={A.emptySub}>
              {selectedDay
                ? 'No tasks scheduled for this day.'
                : filter === 'today'
                  ? 'No tasks scheduled for today.'
                  : 'No scheduled tasks found.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const cfg         = getStatusConfig(item.status);
          const accent      = getTaskAccent(item, todayStr);
          const progress    = item.actualProgress ?? 0;
          const start       = normalizeDate(item.plannedStartDate);
          const end         = normalizeDate(item.plannedEndDate);
          const actualStart = normalizeDate(item.actualStartDate);
          const actualEnd   = normalizeDate(item.actualEndDate);
          const hasActualDates = actualStart !== null || actualEnd !== null;

          const card = (
            <View style={[A.taskCard, accent]}>
              {/* Top row */}
              <View style={A.taskTop}>
                <View style={A.taskTitleBlock}>
                  <Text style={A.taskTitle} numberOfLines={2}>{item.title}</Text>
                  {item.siteName ? (
                    <Text style={A.taskLocation}>
                      {item.siteName}{item.projectName ? ` · ${item.projectName}` : ''}
                    </Text>
                  ) : null}
                </View>
                <StatusBadge status={item.status} />
              </View>

              {/* Progress bar */}
              {(item.status === 'in_progress' || item.status === 'completed') && (
                <View style={A.progressWrap}>
                  <View style={A.progressBg}>
                    <View style={[A.progressFill, { width: `${progress}%` as `${number}%`, backgroundColor: cfg.color }]} />
                  </View>
                  <Text style={[A.progressPct, { color: cfg.color }]}>{progress}%</Text>
                </View>
              )}

              {/* Meta row */}
              <View style={A.metaRow}>
                {item.contractor?.name ? (
                  <View style={A.metaPill}>
                    <Text style={A.metaPillText}>👷 {item.contractor.name}</Text>
                  </View>
                ) : null}
                {item.area ? (
                  <View style={A.metaPill}>
                    <Text style={A.metaPillText}>📍 {item.area}</Text>
                  </View>
                ) : null}
              </View>

              {/* Date row */}
              <View style={A.dateRow}>
                <View style={A.datePill}>
                  <Text style={A.datePillLabel}>START</Text>
                  <Text style={A.datePillValue}>{fmtDate(start)}</Text>
                </View>
                <View style={A.dateDivider} />
                <View style={A.datePill}>
                  <Text style={A.datePillLabel}>END</Text>
                  <Text style={A.datePillValue}>{fmtDate(end)}</Text>
                </View>
              </View>

              {/* Actual execution dates */}
              {hasActualDates ? (
                <View style={A.actualDateRow}>
                  {actualStart ? (
                    <View style={A.datePill}>
                      <Text style={A.actualDateLabel}>ACT.START</Text>
                      <Text style={A.actualDateValue}>{fmtDate(actualStart)}</Text>
                    </View>
                  ) : null}
                  {actualStart && actualEnd ? <View style={A.dateDivider} /> : null}
                  {actualEnd ? (
                    <View style={A.datePill}>
                      <Text style={A.actualDateLabel}>ACT.END</Text>
                      <Text style={A.actualDateValue}>{fmtDate(actualEnd)}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Delay/block reason */}
              {item.delayReason ? (
                <Text style={item.status === 'blocked' ? A.blockText : A.delayText}>
                  {item.status === 'blocked' ? '🚫 Block: ' : '⚠ Delay: '}{item.delayReason}
                </Text>
              ) : null}

              {/* Execution notes preview */}
              {item.comments ? (
                <Text style={A.execNotesText} numberOfLines={2}>{item.comments}</Text>
              ) : null}

              {/* Update hint */}
              {canUpdate ? (
                <Text style={A.tapHint}>Tap to update status →</Text>
              ) : null}
            </View>
          );

          return canUpdate ? (
            <TouchableOpacity activeOpacity={0.8} onPress={() => openUpdate(item)}>
              {card}
            </TouchableOpacity>
          ) : card;
        }}
      />

      {/* Modals */}
      {canCreate ? (
        <CreateTaskModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          sites={sites}
          projects={projects}
          contractors={contractors}
          onCreated={() => void onRefresh()}
        />
      ) : null}

      <UpdateTaskModal
        visible={showUpdate}
        task={selectedTask}
        onClose={closeUpdate}
        onUpdated={() => void onRefresh()}
      />
    </View>
  );
}

// ─── Main screen styles ───────────────────────────────────────────────────────

const A = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#060d1b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // App bar
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  appBarTitle: { color: '#e8f0fe', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  appBarDate:  { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskCountBadge: {
    backgroundColor: '#0a1628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  taskCountText: { color: '#3d6090', fontSize: 12, fontWeight: '700' },
  createBtn: {
    backgroundColor: '#0e1e36',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  createBtnText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },

  // Week day selector
  weekScroll: { maxHeight: 80, borderBottomWidth: 1, borderBottomColor: '#0e1f38' },
  weekRow:    { paddingHorizontal: 12, paddingVertical: 10, gap: 6, alignItems: 'center' },
  dayBtn: {
    width: 46,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    gap: 2,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  dayBtnToday:    { backgroundColor: '#0a1628', borderColor: '#142240' },
  dayBtnSelected: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  dayLabel:         { color: '#2d5070', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  dayLabelToday:    { color: '#3d6090' },
  dayLabelSelected: { color: '#bfdbfe' },
  dayNum:           { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  dayNumToday:      { color: '#c8d8f0' },
  dayNumSelected:   { color: '#fff' },
  dayDot:           { width: 4, height: 4, borderRadius: 2, backgroundColor: '#3b82f6', marginTop: 2 },
  dayDotSelected:   { backgroundColor: '#bfdbfe' },

  // Filters
  filterScroll: { maxHeight: 50, borderBottomWidth: 1, borderBottomColor: '#0e1f38' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
  },
  filterChipActive:     { backgroundColor: '#0e1e36', borderColor: '#3b82f6' },
  filterChipText:       { color: '#3d6090', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#60a5fa' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },

  // Deadlines card
  deadlinesCard: {
    backgroundColor: '#100c00',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a1e00',
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  deadlinesTitle: { color: '#f59e0b', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  deadlineRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deadlineAccent: { width: 3, height: 36, borderRadius: 2 },
  deadlineName:   { color: '#c8d8f0', fontSize: 13, fontWeight: '600' },
  deadlineSub:    { color: '#6b7280', fontSize: 11, marginTop: 1 },

  // Task card
  taskCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  taskTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  taskTitleBlock: { flex: 1, gap: 3 },
  taskTitle:      { color: '#e8f0fe', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  taskLocation:   { color: '#2d5070', fontSize: 11, fontWeight: '500' },

  // Progress
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBg:   { flex: 1, height: 5, backgroundColor: '#0e1e36', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  progressPct:  { fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },

  // Meta
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: {
    backgroundColor: '#070f1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0e1e36',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaPillText: { color: '#3d6090', fontSize: 11, fontWeight: '500' },

  // Dates
  dateRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datePill:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  datePillLabel: { color: '#1e3a5f', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  datePillValue: { color: '#c8d8f0', fontSize: 12, fontWeight: '600' },
  dateDivider:   { width: 1, height: 16, backgroundColor: '#0e1e36' },

  // Actual execution dates
  actualDateRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actualDateLabel: { color: '#16a34a', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  actualDateValue: { color: '#86efac', fontSize: 12, fontWeight: '600' },

  delayText:    { color: '#f59e0b', fontSize: 12, fontWeight: '500' },
  blockText:    { color: '#f87171', fontSize: 12, fontWeight: '500' },
  execNotesText:{ color: '#475569', fontSize: 11, fontStyle: 'italic', lineHeight: 16 },
  tapHint:      { color: '#1e3a5f', fontSize: 11, textAlign: 'right' },

  // Risk strip
  riskStrip: { borderBottomWidth: 1, borderBottomColor: '#0e1f38', backgroundColor: '#060d1b', paddingVertical: 8 },
  riskRow:   { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  riskChip:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  riskChipCount: { fontSize: 14, fontWeight: '800' },
  riskChipLabel: { fontSize: 11, fontWeight: '600' },

  // Empty
  empty:      { alignItems: 'center', paddingTop: 56, gap: 8 },
  emptyTitle: { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  emptySub:   { color: '#1e3a5f', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Modal styles (shared between Update + Create) ────────────────────────────

const UM = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
  },
  title:    { color: '#e8f0fe', fontSize: 18, fontWeight: '800', flex: 1 },
  subtitle: { color: '#2d5070', fontSize: 12, marginTop: 4 },
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
  content: { padding: 20, paddingBottom: 56 },

  fieldLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
  },
  emptyNote: { color: '#1e3a5f', fontSize: 13, marginBottom: 12 },
  fieldGroup: {},

  // Status grid
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  statusChip: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
  },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { color: '#3d6090', fontSize: 13, fontWeight: '600' },

  // Text inputs
  inputWrap: {
    backgroundColor: '#060e1c',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#112036',
    paddingHorizontal: 14,
    height: 50,
    justifyContent: 'center',
  },
  inputMulti: { height: 88, alignItems: 'flex-start', paddingTop: 12 },
  input:      { color: '#d0e0f5', fontSize: 15, padding: 0 },

  // Select rows
  selectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 13,
    marginBottom: 8,
  },
  selectRowActive: { borderColor: '#3b82f6', backgroundColor: '#0e1e36' },
  selectName:      { color: '#c8d8f0', fontSize: 14, fontWeight: '600' },
  selectSub:       { color: '#2d5070', fontSize: 12, marginTop: 2 },
  check:           { color: '#3b82f6', fontSize: 16, fontWeight: '700' },

  // Header eyebrow
  headerEyebrow: {
    color: '#1d4ed8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },

  // Section
  section:      { marginTop: 22 },
  sectionLabel: {
    color: '#2d5a9e',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Progress preview bar
  progressPreviewWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  progressPreviewBg:   { flex: 1, height: 8, backgroundColor: '#0e1e36', borderRadius: 4, overflow: 'hidden' },
  progressPreviewFill: { height: 8, borderRadius: 4 },
  progressPreviewPct:  { fontSize: 14, fontWeight: '800', width: 44, textAlign: 'right' },

  // Stepper row
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 58,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
  },
  stepperBtnText: { color: '#60a5fa', fontSize: 15, fontWeight: '800' },
  progressInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: '#060e1c',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#112036',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  progressInput:       { flex: 1, color: '#e8f0fe', fontSize: 24, fontWeight: '800', padding: 0 },
  progressInputSuffix: { color: '#3d6090', fontSize: 18, fontWeight: '700' },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelBtn: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#142240',
    backgroundColor: '#0a1628',
  },
  cancelBtnText: { color: '#3d6090', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#1d4ed8',
  },
  saveBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  saveBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  discardBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  discardBtnText: { color: '#2d5070', fontSize: 14, fontWeight: '600' },

  // Activity timeline
  timelineSection: { marginTop: 28, borderTopWidth: 1, borderTopColor: '#0d2040', paddingTop: 16 },
  timelineHeader:  { color: '#2d5a9e', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  timelineRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  timelineDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1d4ed8', marginTop: 5, flexShrink: 0 },
  timelineBody:    { flex: 1 },
  timelineText:    { color: '#93b4d8', fontSize: 12, fontWeight: '500', lineHeight: 17 },
  timelineMeta:    { color: '#2d5070', fontSize: 10, marginTop: 2 },
});
