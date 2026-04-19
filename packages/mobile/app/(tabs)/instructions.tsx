/**
 * Instructions screen — Phase 2
 * Standalone tab for the consultant role (and any role with instructions access).
 * Flow: project picker → instruction list → detail / create.
 * Mirrors the logic inside projects.tsx but scoped to instructions only.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, TextInput,
  ActivityIndicator,
} from 'react-native';
import { projectsApi } from '../../src/api/projects';
import { instructionsApi } from '../../src/api/instructions';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';
import {
  Project, Instruction,
  InstructionType, InstructionPriority, InstructionStatus,
} from '../../src/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_VARIANT: Record<InstructionPriority, 'error' | 'warning' | 'default'> = {
  critical: 'error',
  high:     'warning',
  medium:   'default',
  low:      'default',
};

const STATUS_VARIANT: Record<InstructionStatus, 'success' | 'warning' | 'error' | 'default'> = {
  open:         'warning',
  acknowledged: 'default',
  in_progress:  'default',
  resolved:     'success',
  rejected:     'error',
};

// Roles that can issue new instructions
const ISSUE_ROLES = ['company_admin', 'project_manager', 'consultant'];
// Roles that can update status
const UPDATE_ROLES = ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor'];

const INSTRUCTION_TYPES: InstructionType[] = ['instruction', 'recommendation'];
const PRIORITIES: InstructionPriority[]    = ['low', 'medium', 'high', 'critical'];
const STATUS_TRANSITIONS: Record<InstructionStatus, InstructionStatus[]> = {
  open:         ['acknowledged', 'in_progress', 'rejected'],
  acknowledged: ['in_progress', 'rejected'],
  in_progress:  ['resolved', 'rejected'],
  resolved:     [],
  rejected:     [],
};

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── View type ────────────────────────────────────────────────────────────────

type View =
  | 'projects'
  | 'list'
  | 'detail'
  | 'create';

// ─── Instruction row ──────────────────────────────────────────────────────────

function InstructionRow({ item, onPress }: { item: Instruction; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {cap(item.type)} · {fmtDate(item.issuedDate)}
        </Text>
        {item.issuedBy && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            By {item.issuedBy.firstName} {item.issuedBy.lastName}
          </Text>
        )}
      </View>
      <View style={styles.rowBadges}>
        <Badge label={cap(item.priority)} variant={PRIORITY_VARIANT[item.priority]} />
        <Badge label={cap(item.status.replace('_', ' '))} variant={STATUS_VARIANT[item.status]} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Chip selector ────────────────────────────────────────────────────────────

function ChipSelector<T extends string>({
  options, selected, onSelect,
}: { options: T[]; selected: T; onSelect: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <TouchableOpacity
          key={o}
          style={[styles.chip, selected === o && styles.chipActive]}
          onPress={() => onSelect(o)}
        >
          <Text style={[styles.chipText, selected === o && styles.chipTextActive]}>
            {cap(o.replace('_', ' '))}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: (i: Instruction) => void;
  onCancel: () => void;
}) {
  const [type,     setType]     = useState<InstructionType>('instruction');
  const [priority, setPriority] = useState<InstructionPriority>('medium');
  const [title,    setTitle]    = useState('');
  const [desc,     setDesc]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function handleCreate() {
    if (!title.trim()) { setError('Title is required'); return; }
    setLoading(true);
    setError(null);
    try {
      const inst = await instructionsApi.create(projectId, {
        type, priority, title: title.trim(),
        description: desc.trim() || undefined,
        issuedDate: today,
      });
      onCreated(inst);
    } catch {
      setError('Failed to create instruction');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Text style={styles.backText}>{'← Back'}</Text>
        </TouchableOpacity>

        <Text style={styles.formTitle}>New Instruction</Text>

        <Text style={styles.fieldLabel}>Type</Text>
        <ChipSelector options={INSTRUCTION_TYPES} selected={type} onSelect={setType} />

        <Text style={styles.fieldLabel}>Priority</Text>
        <ChipSelector options={PRIORITIES} selected={priority} onSelect={setPriority} />

        <Text style={styles.fieldLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          placeholder="Short description of instruction"
          placeholderTextColor="#475569"
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Detailed description (optional)"
          placeholderTextColor="#475569"
          multiline
          numberOfLines={5}
          value={desc}
          onChangeText={setDesc}
        />

        {error && <Text style={styles.fieldError}>{error}</Text>}

        <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.submitBtnText}>Create Instruction</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

// ─── Instruction detail ───────────────────────────────────────────────────────

function InstructionDetail({
  instruction: initial,
  projectId,
  canUpdate,
  onBack,
  onUpdated,
}: {
  instruction: Instruction;
  projectId: string;
  canUpdate: boolean;
  onBack: () => void;
  onUpdated: (i: Instruction) => void;
}) {
  const [instruction,   setInstruction]   = useState(initial);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError,   setActionError]   = useState<string | null>(null);

  const transitions = STATUS_TRANSITIONS[instruction.status];

  async function handleTransition(status: InstructionStatus) {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await instructionsApi.updateStatus(
        projectId, instruction.id, status,
      );
      setInstruction(updated);
      onUpdated(updated);
    } catch {
      setActionError('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'← Instructions'}</Text>
        </TouchableOpacity>

        {/* Title + badges */}
        <Text style={styles.detailTitle}>{instruction.title}</Text>
        <View style={styles.detailBadgeRow}>
          <Badge label={cap(instruction.type)}     variant="default" />
          <Badge label={cap(instruction.priority)} variant={PRIORITY_VARIANT[instruction.priority]} />
          <Badge
            label={cap(instruction.status.replace('_', ' '))}
            variant={STATUS_VARIANT[instruction.status]}
          />
        </View>

        {/* Meta */}
        <Card style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Issued</Text>
            <Text style={styles.metaValue}>{fmtDate(instruction.issuedDate)}</Text>
          </View>
          {instruction.targetActionDate && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Target Date</Text>
              <Text style={styles.metaValue}>{fmtDate(instruction.targetActionDate)}</Text>
            </View>
          )}
          {instruction.category && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Category</Text>
              <Text style={styles.metaValue}>{instruction.category}</Text>
            </View>
          )}
          {instruction.issuedBy && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issued By</Text>
              <Text style={styles.metaValue}>
                {instruction.issuedBy.firstName} {instruction.issuedBy.lastName}
              </Text>
            </View>
          )}
        </Card>

        {/* Description */}
        {instruction.description && (
          <Card style={styles.descCard}>
            <Text style={styles.descLabel}>Description</Text>
            <Text style={styles.descText}>{instruction.description}</Text>
          </Card>
        )}

        {/* Status transitions */}
        {canUpdate && transitions.length > 0 && (
          <View style={styles.transitionsWrap}>
            {actionError && <Text style={styles.actionError}>{actionError}</Text>}
            <Text style={styles.transitionsLabel}>Update Status</Text>
            <View style={styles.transitionBtns}>
              {transitions.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.transitionBtn,
                    (t === 'rejected') && styles.transitionBtnDanger,
                    (t === 'resolved') && styles.transitionBtnSuccess,
                  ]}
                  onPress={() => handleTransition(t)}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.transitionBtnText}>
                        {cap(t.replace('_', ' '))}
                      </Text>
                  }
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InstructionsScreen() {
  const user = useAuthStore((s) => s.user)!;

  const canIssue  = ISSUE_ROLES.includes(user.role);
  const canUpdate = UPDATE_ROLES.includes(user.role);

  // Navigation state
  const [view,    setView]    = useState<View>('projects');
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Instruction | null>(null);

  // Projects
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [projLoad,   setProjLoad]   = useState(true);
  const [projError,  setProjError]  = useState<string | null>(null);
  const [projRefresh, setProjRefresh] = useState(false);

  // Instructions
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [instLoad,     setInstLoad]     = useState(false);
  const [instError,    setInstError]    = useState<string | null>(null);
  const [instRefresh,  setInstRefresh]  = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  // ── Load projects ──────────────────────────────────────────────────────────

  async function loadProjects() {
    try {
      setProjError(null);
      setProjects(await projectsApi.list());
    } catch {
      setProjError('Failed to load projects');
    }
  }

  useEffect(() => {
    loadProjects().finally(() => setProjLoad(false));
  }, []);

  // ── Load instructions ──────────────────────────────────────────────────────

  async function loadInstructions(pid: string, status?: string) {
    setInstLoad(true);
    try {
      setInstError(null);
      setInstructions(
        await instructionsApi.list(pid, status ? { status } : undefined),
      );
    } catch {
      setInstError('Failed to load instructions');
    } finally {
      setInstLoad(false);
    }
  }

  // SSE auto-refresh
  const refreshInst = useCallback(() => {
    if (project) void loadInstructions(project.id, statusFilter || undefined);
  }, [project, statusFilter]);
  useSSEEvent('instruction_updated', refreshInst);
  useSSEEvent('instruction_created', refreshInst);

  // ── Navigation helpers ─────────────────────────────────────────────────────

  function openProject(p: Project) {
    setProject(p);
    setStatusFilter('');
    setView('list');
    void loadInstructions(p.id);
  }

  function openInstruction(i: Instruction) {
    setSelected(i);
    setView('detail');
  }

  function handleUpdated(i: Instruction) {
    setInstructions((prev) => prev.map((x) => x.id === i.id ? i : x));
    setSelected(i);
  }

  function handleCreated(i: Instruction) {
    setInstructions((prev) => [i, ...prev]);
    setView('list');
  }

  function goBack() {
    if (view === 'create' || view === 'detail') { setView('list'); return; }
    if (view === 'list')    { setProject(null); setView('projects'); return; }
  }

  // ── Filter change ──────────────────────────────────────────────────────────

  function changeFilter(f: string) {
    setStatusFilter(f);
    if (project) void loadInstructions(project.id, f || undefined);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Create form
  if (view === 'create' && project) {
    return (
      <CreateForm
        projectId={project.id}
        onCreated={handleCreated}
        onCancel={() => setView('list')}
      />
    );
  }

  // Detail
  if (view === 'detail' && selected && project) {
    return (
      <InstructionDetail
        instruction={selected}
        projectId={project.id}
        canUpdate={canUpdate}
        onBack={() => setView('list')}
        onUpdated={handleUpdated}
      />
    );
  }

  // Instruction list for a project
  if (view === 'list' && project) {
    const STATUS_FILTERS = [
      { label: 'All',         value: ''            },
      { label: 'Open',        value: 'open'        },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Resolved',    value: 'resolved'    },
    ];

    return (
      <Screen>
        {/* Header */}
        <View style={styles.listHeader}>
          <TouchableOpacity onPress={goBack} style={styles.backBtnInline}>
            <Text style={styles.backText}>{'←'}</Text>
          </TouchableOpacity>
          <View style={styles.listHeaderText}>
            <Text style={styles.heading}>Instructions</Text>
            <Text style={styles.subheading} numberOfLines={1}>{project.name}</Text>
          </View>
          {canIssue && (
            <TouchableOpacity style={styles.addBtn} onPress={() => setView('create')}>
              <Text style={styles.addBtnText}>+ New</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
              onPress={() => changeFilter(f.value)}
            >
              <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {instLoad ? <LoadingSpinner /> : instError ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{instError}</Text>
            <TouchableOpacity
              onPress={() => loadInstructions(project.id, statusFilter || undefined)}
              style={styles.retryBtn}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : instructions.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No instructions found</Text>
            {canIssue && (
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setView('create')}>
                <Text style={styles.emptyAddText}>Create first instruction</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <FlatList
            data={instructions}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <InstructionRow item={item} onPress={() => openInstruction(item)} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={instRefresh}
                onRefresh={async () => {
                  setInstRefresh(true);
                  await loadInstructions(project.id, statusFilter || undefined);
                  setInstRefresh(false);
                }}
                tintColor="#3b82f6"
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </Screen>
    );
  }

  // Project picker
  if (projLoad) return <LoadingSpinner />;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.heading}>Instructions</Text>
      </View>
      <Text style={styles.pickProjectHint}>Select a project to view instructions</Text>

      {projError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{projError}</Text>
          <TouchableOpacity onPress={loadProjects} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No projects available</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => openProject(item)}
              activeOpacity={0.7}
              style={styles.projectRow}
            >
              <View style={styles.projectLeft}>
                <Text style={styles.projectName}>{item.name}</Text>
              </View>
              <View style={styles.projectRight}>
                <Badge
                  label={cap(item.status)}
                  variant={item.status === 'active' ? 'success' : 'default'}
                />
                <Text style={styles.chevron}>{'›'}</Text>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={projRefresh}
              onRefresh={async () => {
                setProjRefresh(true);
                await loadProjects();
                setProjRefresh(false);
              }}
              tintColor="#3b82f6"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:           { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  heading:          { color: '#f1f5f9', fontSize: 24, fontWeight: '700' },
  subheading:       { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  pickProjectHint:  { color: '#64748b', fontSize: 13, paddingHorizontal: 16, marginBottom: 12 },

  listHeader:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 10 },
  listHeaderText: { flex: 1 },
  backBtnInline:  { padding: 4 },

  addBtn:      { backgroundColor: '#1d4ed8', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText:  { color: '#fff', fontSize: 13, fontWeight: '700' },

  filterBar:         { flexGrow: 0 },
  filterBarContent:  { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterChip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  filterChipActive:  { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff',    fontSize: 12, fontWeight: '600' },

  list:      { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1, backgroundColor: '#1e293b' },

  // Project row
  projectRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, backgroundColor: '#0f172a' },
  projectLeft:  { flex: 1, marginRight: 12 },
  projectRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName:  { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  chevron:      { color: '#475569', fontSize: 22, fontWeight: '300' },

  // Instruction row
  row:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, backgroundColor: '#0f172a' },
  rowLeft:    { flex: 1, marginRight: 10 },
  rowBadges:  { gap: 4, alignItems: 'flex-end' },
  rowTitle:   { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 3 },
  rowMeta:    { color: '#64748b', fontSize: 11, marginTop: 1 },

  // Detail
  detailScroll:   { padding: 16, paddingBottom: 40 },
  backBtn:        { marginBottom: 14 },
  backText:       { color: '#3b82f6', fontSize: 14, fontWeight: '600' },
  detailTitle:    { color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  detailBadgeRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },

  metaCard: { marginBottom: 12 },
  metaRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  metaLabel:{ color: '#94a3b8', fontSize: 13 },
  metaValue:{ color: '#f1f5f9', fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },

  descCard:  { marginBottom: 16 },
  descLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  descText:  { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },

  transitionsWrap:    { marginTop: 8 },
  transitionsLabel:   { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  transitionBtns:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  transitionBtn:      { flex: 1, minWidth: 100, paddingVertical: 12, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  transitionBtnDanger:{ backgroundColor: '#450a0a', borderColor: '#ef4444' },
  transitionBtnSuccess:{ backgroundColor: '#052e16', borderColor: '#22c55e' },
  transitionBtnText:  { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },

  actionError: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 8 },

  // Create form
  formScroll:  { padding: 16, paddingBottom: 40 },
  formTitle:   { color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  fieldLabel:  { color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  fieldError:  { color: '#ef4444', fontSize: 13, marginTop: 8 },

  chips:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  chipActive:    { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  chipText:      { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  chipTextActive:{ color: '#fff',    fontSize: 13, fontWeight: '600' },

  input: {
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
    borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 14,
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },

  submitBtn:     { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Shared
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 16, textAlign: 'center' },
  retryBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  emptyWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText:    { color: '#64748b', fontSize: 15, marginBottom: 16 },
  emptyAddBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  emptyAddText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },
});
