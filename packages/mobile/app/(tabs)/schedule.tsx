import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuthStore } from '../../src/store/auth.store';
import { projectsApi } from '../../src/api/projects';
import { schedulesApi } from '../../src/api/schedules';
import { contractorsApi } from '../../src/api/contractors';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import { Project, JobSite, ScheduleTask, ScheduleTaskStatus, Contractor } from '../../src/types';

type ScheduleFilter = 'today' | 'upcoming' | 'all';

type ScheduleTaskWithContext = ScheduleTask & {
  projectName?: string;
  siteName?: string;
};

const WRITE_ROLES    = new Set(['company_admin', 'project_manager', 'contractor']);
const PROGRESS_ROLES = new Set(['company_admin', 'project_manager', 'site_supervisor', 'contractor']);

const FILTERS: Array<{ label: string; value: ScheduleFilter }> = [
  { label: 'Today',    value: 'today'    },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'All',      value: 'all'      },
];

const STATUS_OPTIONS: Array<{ value: ScheduleTaskStatus; label: string; color: string }> = [
  { value: 'not_started', label: 'Not Started', color: '#64748b' },
  { value: 'in_progress', label: 'In Progress', color: '#3b82f6' },
  { value: 'delayed',     label: 'Delayed',     color: '#f59e0b' },
  { value: 'blocked',     label: 'Blocked',     color: '#ef4444' },
  { value: 'completed',   label: 'Completed',   color: '#22c55e' },
];

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  return value.split('T')[0] ?? value;
}

function todayString() {
  return new Date().toISOString().split('T')[0] ?? '';
}

function getStatusConfig(status: ScheduleTaskStatus) {
  const config: Record<ScheduleTaskStatus, { label: string; color: string }> = {
    not_started: { label: 'Not Started', color: '#64748b' },
    in_progress: { label: 'In Progress', color: '#3b82f6' },
    delayed:     { label: 'Delayed',     color: '#f59e0b' },
    blocked:     { label: 'Blocked',     color: '#ef4444' },
    completed:   { label: 'Completed',   color: '#22c55e' },
  };
  return config[status] ?? config.not_started;
}

function StatusBadge({ status }: { status: ScheduleTaskStatus }) {
  const s = getStatusConfig(status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: s.color }]}>
      <Text style={styles.statusBadgeText}>{s.label}</Text>
    </View>
  );
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

// ─── Update Task Modal ────────────────────────────────────────────────────────

function UpdateTaskModal({
  visible,
  task,
  onClose,
  onUpdated,
}: {
  visible:   boolean;
  task:      ScheduleTaskWithContext | null;
  onClose:   () => void;
  onUpdated: () => void;
}) {
  const [status,       setStatus]       = useState<ScheduleTaskStatus>('not_started');
  const [progressText, setProgressText] = useState('');
  const [delayReason,  setDelayReason]  = useState('');
  const [comments,     setComments]     = useState('');
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    if (task) {
      setStatus(task.status);
      setProgressText(task.actualProgress != null ? String(task.actualProgress) : '');
      setDelayReason(task.delayReason ?? '');
      setComments(task.comments ?? '');
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
      status === 'completed'                                  ? 100
      : !isNaN(rawProgress) && rawProgress >= 0 && rawProgress <= 100 ? rawProgress
      : null;

    setSaving(true);
    try {
      await schedulesApi.updateTask(task.projectId, task.siteId, task.id, {
        status,
        actualProgress,
        delayReason: needsReason ? (delayReason.trim() || null) : null,
        comments:    comments.trim() || null,
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

  if (!task) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{task.title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          {task.siteName ? (
            <Text style={styles.modalSubtitle}>
              {task.siteName}{task.projectName ? ` · ${task.projectName}` : ''}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>Status</Text>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.selectItem, status === opt.value && styles.selectItemActive]}
              onPress={() => handleStatusChange(opt.value)}
            >
              <View style={styles.statusOptionRow}>
                <View style={[styles.statusDot, { backgroundColor: opt.color }]} />
                <Text style={styles.selectItemText}>{opt.label}</Text>
              </View>
              {status === opt.value && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}

          {showProgress && (
            <Input
              label="Actual Progress % (0–100)"
              value={progressText}
              onChangeText={setProgressText}
              placeholder="e.g. 65"
              keyboardType="numeric"
              containerStyle={{ marginTop: 16 }}
            />
          )}

          {showReason && (
            <Input
              label={status === 'blocked' ? 'Blocked reason *' : 'Delay reason *'}
              value={delayReason}
              onChangeText={setDelayReason}
              placeholder="Describe what is causing the delay or block"
              containerStyle={{ marginTop: 4 }}
            />
          )}

          <Input
            label="Comments (optional)"
            value={comments}
            onChangeText={setComments}
            placeholder="Any notes for the site team"
            containerStyle={{ marginTop: 4 }}
          />

          <Button
            title="Save Update"
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: 8 }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({
  visible,
  onClose,
  sites,
  projects,
  contractors,
  onCreated,
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
    setSiteId('');
    setContractorId('');
    setTitle('');
    setStartDate('');
    setEndDate('');
    setArea('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Validation', 'Task title is required');
      return;
    }
    if (!siteId) {
      Alert.alert('Validation', 'Please select a site');
      return;
    }
    if (!contractorId) {
      Alert.alert('Validation', 'Please select a contractor');
      return;
    }

    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    setSaving(true);
    try {
      await schedulesApi.createTask(site.projectId, site.id, {
        contractorId,
        title:            title.trim(),
        area:             area.trim() || undefined,
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
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Schedule Task</Text>
          <TouchableOpacity onPress={handleClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          {/* Site selector */}
          <Text style={styles.fieldLabel}>Site *</Text>
          {sites.length === 0
            ? <Text style={styles.emptyNote}>No sites available</Text>
            : sites.map((s) => {
                const project = projects.find((p) => p.id === s.projectId);
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.selectItem, siteId === s.id && styles.selectItemActive]}
                    onPress={() => setSiteId(s.id)}
                  >
                    <View>
                      <Text style={styles.selectItemText}>{s.name}</Text>
                      {project && (
                        <Text style={styles.selectItemSub}>{project.name}</Text>
                      )}
                    </View>
                    {siteId === s.id && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })
          }

          {/* Contractor selector */}
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Contractor *</Text>
          {contractors.length === 0
            ? <Text style={styles.emptyNote}>No active contractors found</Text>
            : contractors.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.selectItem, contractorId === c.id && styles.selectItemActive]}
                  onPress={() => setContractorId(c.id)}
                >
                  <View>
                    <Text style={styles.selectItemText}>{c.name}</Text>
                    {c.tradeSpecialization && (
                      <Text style={styles.selectItemSub}>{c.tradeSpecialization}</Text>
                    )}
                  </View>
                  {contractorId === c.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))
          }

          {/* Task fields */}
          <Input
            label="Title *"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Lay foundation slab"
            containerStyle={{ marginTop: 16 }}
          />
          <Input
            label="Area (optional)"
            value={area}
            onChangeText={setArea}
            placeholder="e.g. Block A, Level 2"
          />
          <Input
            label="Planned Start (YYYY-MM-DD)"
            value={startDate}
            onChangeText={setStartDate}
            placeholder="2025-06-01"
            keyboardType="numbers-and-punctuation"
          />
          <Input
            label="Planned End (YYYY-MM-DD)"
            value={endDate}
            onChangeText={setEndDate}
            placeholder="2025-06-15"
            keyboardType="numbers-and-punctuation"
          />

          <Button title="Create Task" onPress={handleSave} loading={saving} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const user = useAuthStore((s) => s.user);
  const canCreate = user && WRITE_ROLES.has(user.role);
  const canUpdate = user && PROGRESS_ROLES.has(user.role);

  const [projects,      setProjects]      = useState<Project[]>([]);
  const [sites,         setSites]         = useState<JobSite[]>([]);
  const [tasks,         setTasks]         = useState<ScheduleTaskWithContext[]>([]);
  const [contractors,   setContractors]   = useState<Contractor[]>([]);
  const [filter,        setFilter]        = useState<ScheduleFilter>('today');
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [showCreate,    setShowCreate]    = useState(false);
  const [selectedTask,  setSelectedTask]  = useState<ScheduleTaskWithContext | null>(null);
  const [showUpdate,    setShowUpdate]    = useState(false);

  async function load() {
    try {
      const projectList = await projectsApi.list();
      setProjects(projectList);

      const allSites: JobSite[] = [];
      for (const project of projectList) {
        try {
          const projectSites = await projectsApi.listSites(project.id);
          allSites.push(...projectSites);
        } catch {
          // skip
        }
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
        } catch {
          // skip
        }
      }

      allTasks.sort((a, b) => {
        const aDate = normalizeDate(a.plannedStartDate) ?? '9999-12-31';
        const bDate = normalizeDate(b.plannedStartDate) ?? '9999-12-31';
        return aDate.localeCompare(bDate);
      });
      setTasks(allTasks);

      // Load contractors for create form (non-fatal)
      if (canCreate) {
        try {
          const cl = await contractorsApi.list({ isActive: true });
          setContractors(cl);
        } catch {
          // non-fatal
        }
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
    if (filter === 'today')    return tasks.filter(isTodayTask);
    if (filter === 'upcoming') return tasks.filter(isUpcomingTask);
    return tasks;
  }, [filter, tasks]);

  if (loading) return <LoadingSpinner />;

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.pageTitle}>Schedule</Text>
          <Text style={styles.pageSubtitle}>
            {sites.length} site{sites.length === 1 ? '' : 's'} · {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </Text>
        </View>
        {canCreate && (
          <Button
            title="+ Task"
            onPress={() => setShowCreate(true)}
            variant="secondary"
            style={{ height: 36, paddingHorizontal: 14 }}
          />
        )}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((item) => (
          <TouchableOpacity
            key={item.value}
            style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
            onPress={() => setFilter(item.value)}
          >
            <Text style={[styles.filterChipText, filter === item.value && styles.filterChipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {visibleTasks.length === 0 ? (
        <EmptyState
          title="No schedule tasks"
          description={
            filter === 'today'
              ? 'No scheduled tasks for today.'
              : 'No scheduled tasks found.'
          }
        />
      ) : (
        <FlatList
          data={visibleTasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          renderItem={({ item }) => {
            const start = normalizeDate(item.plannedStartDate);
            const end   = normalizeDate(item.plannedEndDate);

            const cardContent = (
              <Card style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={styles.taskTitleWrap}>
                    <Text style={styles.taskTitle}>{item.title}</Text>
                    <Text style={styles.taskLocation}>
                      {item.siteName ?? 'Site'}{item.projectName ? ` · ${item.projectName}` : ''}
                    </Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>

                {item.description ? (
                  <Text style={styles.taskDescription}>{item.description}</Text>
                ) : null}

                <View style={styles.metaBlock}>
                  <Text style={styles.metaText}>Start: {start ?? 'Not set'}</Text>
                  <Text style={styles.metaText}>End: {end ?? 'Not set'}</Text>
                </View>

                {item.contractor?.name ? (
                  <Text style={styles.metaText}>Contractor: {item.contractor.name}</Text>
                ) : null}

                {item.area ? (
                  <Text style={styles.metaText}>Area: {item.area}</Text>
                ) : null}

                {item.actualProgress != null ? (
                  <Text style={styles.metaText}>Progress: {item.actualProgress}%</Text>
                ) : null}

                {item.materialsRequired ? (
                  <Text style={styles.metaText}>Materials: {item.materialsRequired}</Text>
                ) : null}

                {item.equipmentRequired ? (
                  <Text style={styles.metaText}>Equipment: {item.equipmentRequired}</Text>
                ) : null}

                {item.delayReason ? (
                  <Text style={styles.warningText}>Delay: {item.delayReason}</Text>
                ) : null}

                {(item.milestones?.length ?? 0) > 0 ? (
                  <Text style={styles.metaText}>Milestones: {item.milestones.length}</Text>
                ) : null}

                {canUpdate && (
                  <Text style={styles.tapHint}>Tap to update status</Text>
                )}
              </Card>
            );

            if (canUpdate) {
              return (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => openUpdate(item)}
                >
                  {cardContent}
                </TouchableOpacity>
              );
            }
            return cardContent;
          }}
        />
      )}

      {canCreate && (
        <CreateTaskModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          sites={sites}
          projects={projects}
          contractors={contractors}
          onCreated={() => void onRefresh()}
        />
      )}

      <UpdateTaskModal
        visible={showUpdate}
        task={selectedTask}
        onClose={closeUpdate}
        onUpdated={() => void onRefresh()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingHorizontal: 16,
    paddingTop:     16,
    paddingBottom:  8,
  },
  pageTitle: {
    color:      '#f1f5f9',
    fontSize:   22,
    fontWeight: '700',
  },
  pageSubtitle: {
    color:    '#94a3b8',
    fontSize: 13,
    marginTop: 4,
  },

  filterRow: {
    flexDirection:    'row',
    gap:              8,
    paddingHorizontal: 16,
    paddingBottom:    8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderRadius:      20,
    backgroundColor:   '#1e293b',
    borderWidth:       1,
    borderColor:       '#334155',
  },
  filterChipActive:     { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },

  list:     { padding: 16, paddingBottom: 32 },
  taskCard: { marginBottom: 10 },
  taskHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    gap:            12,
    marginBottom:   8,
  },
  taskTitleWrap:   { flex: 1 },
  taskTitle:       { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  taskLocation:    { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  taskDescription: { color: '#cbd5e1', fontSize: 13, marginBottom: 8 },
  metaBlock:       { marginTop: 4 },
  metaText:        { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  warningText:     { color: '#f59e0b', fontSize: 12, marginTop: 6, fontWeight: '600' },
  statusBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  statusBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tapHint:         { color: '#475569', fontSize: 11, marginTop: 8, textAlign: 'right' },

  // Modal
  modal:       { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle:    { color: '#f1f5f9', fontSize: 18, fontWeight: '700', flex: 1, marginRight: 12 },
  modalSubtitle: { color: '#64748b', fontSize: 13, marginBottom: 16 },
  modalClose:    { color: '#94a3b8', fontSize: 20, padding: 4 },
  modalBody:     { padding: 20 },

  fieldLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  emptyNote:  { color: '#475569', fontSize: 13, marginBottom: 12 },
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
  selectItemActive:  { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  selectItemText:    { color: '#f1f5f9', fontSize: 14 },
  selectItemSub:     { color: '#64748b', fontSize: 12, marginTop: 2 },
  checkmark:         { color: '#3b82f6', fontSize: 16 },
  statusOptionRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot:         { width: 10, height: 10, borderRadius: 5 },
});
