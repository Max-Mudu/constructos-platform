/**
 * Projects screen — Phase 2
 * State machine: projects → project detail (sites) → site detail
 *   → drawings list → drawing detail (PDF viewer)
 *   → instructions list → instruction detail
 *
 * RBAC:
 *  - All non-worker roles can view
 *  - Only admin/PM/consultant can create instructions
 *  - Finance info hidden unless canViewFinance
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  ScrollView, RefreshControl, Modal, Linking,
} from 'react-native';
import { projectsApi } from '../../src/api/projects';
import { drawingsApi } from '../../src/api/drawings';
import { instructionsApi } from '../../src/api/instructions';
import { attendanceApi } from '../../src/api/attendance';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Badge } from '../../src/components/Badge';
import { Input } from '../../src/components/Input';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import {
  Project, JobSite, Drawing, Instruction,
  InstructionType, InstructionPriority,
} from '../../src/types';

const BASE_URL = process.env['EXPO_PUBLIC_API_URL']?.replace('/api/v1', '') ?? 'http://10.0.2.2:3000';

// ─── Type helpers ─────────────────────────────────────────────────────────────

type View =
  | 'projects'
  | 'sites'
  | 'site_detail'
  | 'drawings'
  | 'drawing_detail'
  | 'instructions'
  | 'instruction_detail'
  | 'instruction_create';

const STATUS_PRIORITY_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'default'> = {
  open:          'warning',
  acknowledged:  'default',
  in_progress:   'default',
  resolved:      'success',
  rejected:      'destructive',
  critical:      'destructive',
  high:          'warning',
  medium:        'default',
  low:           'outline' as 'default',
};

// ─── Instruction Create Form ──────────────────────────────────────────────────

function InstructionCreateForm({
  projectId,
  onSaved,
  onCancel,
}: {
  projectId: string;
  onSaved: (instr: Instruction) => void;
  onCancel: () => void;
}) {
  const [type,        setType]        = useState<InstructionType>('instruction');
  const [title,       setTitle]       = useState('');
  const [priority,    setPriority]    = useState<InstructionPriority>('medium');
  const [description, setDescription] = useState('');
  const [issuedDate,  setIssuedDate]  = useState(new Date().toISOString().split('T')[0]!);
  const [saving,      setSaving]      = useState(false);

  const TYPES:      InstructionType[]     = ['instruction', 'recommendation'];
  const PRIORITIES: InstructionPriority[] = ['low', 'medium', 'high', 'critical'];

  async function save() {
    if (!title.trim()) {
      Alert.alert('Validation', 'Title is required');
      return;
    }
    setSaving(true);
    try {
      const instr = await instructionsApi.create(projectId, {
        type, title: title.trim(), priority, issuedDate,
        description: description.trim() || undefined,
      });
      onSaved(instr);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create instruction';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.formPad} keyboardShouldPersistTaps="handled">
      <Text style={styles.formTitle}>New Instruction</Text>

      <Text style={styles.fieldLabel}>Type</Text>
      <View style={styles.chipRow}>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.chip, type === t && styles.chipActive]}
            onPress={() => setType(t)}
          >
            <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Title *" value={title} onChangeText={setTitle} placeholder="Instruction title..." />
      <Input label="Description" value={description} onChangeText={setDescription} placeholder="Details..." multiline />

      <Text style={styles.fieldLabel}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.chip, priority === p && styles.chipActive]}
            onPress={() => setPriority(p)}
          >
            <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Issued Date" value={issuedDate} onChangeText={setIssuedDate} placeholder="2026-04-16" />

      <View style={styles.btnRow}>
        <Button title="Cancel" onPress={onCancel} variant="secondary" style={{ flex: 1 }} />
        <Button title="Create" onPress={save} loading={saving} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProjectsScreen() {
  const user = useAuthStore((s) => s.user)!;

  const [view,              setView]              = useState<View>('projects');
  const [projects,          setProjects]          = useState<Project[]>([]);
  const [sites,             setSites]             = useState<JobSite[]>([]);
  const [drawings,          setDrawings]          = useState<Drawing[]>([]);
  const [instructions,      setInstructions]      = useState<Instruction[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<Record<string, number> | null>(null);

  const [selectedProject,     setSelectedProject]     = useState<Project | null>(null);
  const [selectedSite,        setSelectedSite]        = useState<JobSite | null>(null);
  const [selectedDrawing,     setSelectedDrawing]     = useState<Drawing | null>(null);
  const [selectedInstruction, setSelectedInstruction] = useState<Instruction | null>(null);

  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canIssueInstructions = ['company_admin', 'project_manager', 'consultant'].includes(user.role);

  // ── Load helpers ────────────────────────────────────────────────────────────

  async function loadProjects() {
    try {
      setProjects(await projectsApi.list());
    } catch { /* non-fatal */ }
  }

  async function loadSites(project: Project) {
    try {
      setSites(await projectsApi.listSites(project.id));
    } catch { /* non-fatal */ }
  }

  async function loadSiteDetail(project: Project, site: JobSite) {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      const summary = await attendanceApi.list(project.id, site.id, { date: today });
      const counts: Record<string, number> = {};
      for (const r of summary) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }
      setAttendanceSummary(counts);
    } catch {
      setAttendanceSummary(null);
    }
  }

  async function loadDrawings(project: Project) {
    try {
      setDrawings(await drawingsApi.list(project.id));
    } catch { /* non-fatal */ }
  }

  async function loadInstructions(project: Project) {
    try {
      setInstructions(await instructionsApi.list(project.id));
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    loadProjects().finally(() => setLoading(false));
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    if (view === 'projects')                     await loadProjects();
    else if (view === 'sites' && selectedProject) await loadSites(selectedProject);
    else if ((view === 'drawings') && selectedProject)      await loadDrawings(selectedProject);
    else if ((view === 'instructions') && selectedProject)  await loadInstructions(selectedProject);
    setRefreshing(false);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  function goToProject(p: Project) {
    setSelectedProject(p);
    setSites([]);
    setView('sites');
    void loadSites(p);
  }

  function goToSite(s: JobSite) {
    setSelectedSite(s);
    setView('site_detail');
    void loadSiteDetail(selectedProject!, s);
  }

  function goToDrawings() {
    setDrawings([]);
    setView('drawings');
    void loadDrawings(selectedProject!);
  }

  function goToInstructions() {
    setInstructions([]);
    setView('instructions');
    void loadInstructions(selectedProject!);
  }

  function goBack() {
    if (view === 'sites')               { setView('projects'); setSelectedProject(null); }
    else if (view === 'site_detail')    { setView('sites'); setSelectedSite(null); }
    else if (view === 'drawings')       { setView('site_detail'); setDrawings([]); }
    else if (view === 'drawing_detail') { setView('drawings'); setSelectedDrawing(null); }
    else if (view === 'instructions')   { setView('site_detail'); setInstructions([]); }
    else if (view === 'instruction_detail')  { setView('instructions'); setSelectedInstruction(null); }
    else if (view === 'instruction_create')  { setView('instructions'); }
  }

  // ── Breadcrumb ──────────────────────────────────────────────────────────────

  function Breadcrumb() {
    if (view === 'projects') return null;
    return (
      <TouchableOpacity onPress={goBack} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;

  // ── Projects list ────────────────────────────────────────────────────────────

  if (view === 'projects') {
    return (
      <Screen>
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Projects</Text>
        </View>
        {projects.length === 0
          ? <EmptyState title="No projects" description="No projects assigned to your account." />
          : (
            <FlatList
              data={projects}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => goToProject(item)} activeOpacity={0.75}>
                  <Card style={styles.listCard}>
                    <View style={styles.listRow}>
                      <Text style={styles.listTitle} numberOfLines={1}>{item.name}</Text>
                      <Badge
                        label={item.status}
                        variant={item.status === 'active' ? 'success' : item.status === 'on_hold' ? 'warning' : 'default'}
                      />
                    </View>
                    <Text style={styles.listSub}>Tap to view sites →</Text>
                  </Card>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
            />
          )
        }
      </Screen>
    );
  }

  // ── Sites list ────────────────────────────────────────────────────────────

  if (view === 'sites') {
    return (
      <Screen>
        <Breadcrumb />
        <View style={styles.header}>
          <Text style={styles.pageTitle} numberOfLines={1}>{selectedProject!.name}</Text>
        </View>
        <Text style={styles.subLabel}>Sites</Text>
        {sites.length === 0
          ? <EmptyState title="No sites" description="No sites found for this project." />
          : (
            <FlatList
              data={sites}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => goToSite(item)} activeOpacity={0.75}>
                  <Card style={styles.listCard}>
                    <View style={styles.listRow}>
                      <Text style={styles.listTitle}>{item.name}</Text>
                      <Badge label={item.status ?? 'active'} variant={item.status === 'active' ? 'success' : 'default'} />
                    </View>
                    <Text style={styles.listSub}>Tap to view site detail →</Text>
                  </Card>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
            />
          )
        }
      </Screen>
    );
  }

  // ── Site detail ────────────────────────────────────────────────────────────

  if (view === 'site_detail') {
    return (
      <Screen scroll>
        <Breadcrumb />
        <Text style={styles.pageTitle}>{selectedSite!.name}</Text>
        <Text style={styles.subLabel}>{selectedProject!.name}</Text>

        {/* Attendance summary */}
        <Card style={[styles.summaryCard, { marginTop: 16 }]}>
          <Text style={styles.cardTitle}>Today's Attendance</Text>
          {attendanceSummary === null
            ? <Text style={styles.mutedText}>No data</Text>
            : Object.keys(attendanceSummary).length === 0
              ? <Text style={styles.mutedText}>No records today</Text>
              : (
                <View style={styles.summaryRow}>
                  {Object.entries(attendanceSummary).map(([status, count]) => (
                    <View key={status} style={styles.summaryItem}>
                      <Text style={styles.summaryValue}>{count}</Text>
                      <Text style={styles.summaryLabel}>{status.replace('_', ' ')}</Text>
                    </View>
                  ))}
                </View>
              )
          }
        </Card>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Site Resources</Text>

        <TouchableOpacity style={styles.actionCard} onPress={goToDrawings} activeOpacity={0.75}>
          <Text style={styles.actionCardTitle}>Drawings</Text>
          <Text style={styles.actionCardSub}>View and access drawing PDFs</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={goToInstructions} activeOpacity={0.75}>
          <Text style={styles.actionCardTitle}>Instructions</Text>
          <Text style={styles.actionCardSub}>View and manage site instructions</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  // ── Drawings list ──────────────────────────────────────────────────────────

  if (view === 'drawings') {
    return (
      <Screen>
        <Breadcrumb />
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Drawings</Text>
        </View>
        {drawings.length === 0
          ? <EmptyState title="No drawings" description="No drawings found for this project." />
          : (
            <FlatList
              data={drawings}
              keyExtractor={(d) => d.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setSelectedDrawing(item); setView('drawing_detail'); }}
                  activeOpacity={0.75}
                >
                  <Card style={styles.listCard}>
                    <View style={styles.listRow}>
                      <Text style={styles.listTitle} numberOfLines={1}>
                        {item.drawingNumber} — {item.title}
                      </Text>
                    </View>
                    <View style={styles.listMeta}>
                      {item.discipline && <Text style={styles.metaChip}>{item.discipline}</Text>}
                      {item.latestRevision && (
                        <Badge
                          label={`Rev ${item.latestRevision.revisionNumber}`}
                          variant="default"
                        />
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
            />
          )
        }
      </Screen>
    );
  }

  // ── Drawing detail + PDF viewer ────────────────────────────────────────────

  if (view === 'drawing_detail' && selectedDrawing) {
    const rev = selectedDrawing.latestRevision;

    function openPdf() {
      if (!rev) return;
      const pdfUrl = rev.fileUrl.startsWith('http')
        ? rev.fileUrl
        : `${BASE_URL}${rev.fileUrl}`;
      Linking.openURL(pdfUrl).catch(() =>
        Alert.alert('Error', 'Could not open the drawing PDF.'),
      );
    }

    return (
      <Screen scroll>
        <Breadcrumb />
        <Text style={styles.pageTitle}>{selectedDrawing.drawingNumber}</Text>
        <Text style={styles.subLabel}>{selectedDrawing.title}</Text>

        <Card style={[styles.summaryCard, { marginTop: 16 }]}>
          <InfoRow label="Drawing No." value={selectedDrawing.drawingNumber} />
          <InfoRow label="Title"       value={selectedDrawing.title} />
          {selectedDrawing.discipline && <InfoRow label="Discipline" value={selectedDrawing.discipline} />}
        </Card>

        {rev ? (
          <Card style={[styles.summaryCard, { marginTop: 12 }]}>
            <Text style={styles.cardTitle}>Latest Revision</Text>
            <InfoRow label="Revision"  value={`Rev ${rev.revisionNumber}`} />
            <InfoRow label="Status"    value={rev.status.replace(/_/g, ' ')} />
            {rev.issueDate && <InfoRow label="Issue Date" value={rev.issueDate} />}
            {rev.notes     && <InfoRow label="Notes"      value={rev.notes} />}
            <Button
              title="Open Drawing PDF"
              onPress={openPdf}
              style={{ marginTop: 12 }}
            />
          </Card>
        ) : (
          <Card style={[styles.summaryCard, { marginTop: 12 }]}>
            <Text style={styles.mutedText}>No revisions uploaded yet.</Text>
          </Card>
        )}

        {selectedDrawing.revisions.length > 1 && (
          <Card style={[styles.summaryCard, { marginTop: 12 }]}>
            <Text style={styles.cardTitle}>All Revisions ({selectedDrawing.revisions.length})</Text>
            {selectedDrawing.revisions.map((r) => (
              <View key={r.id} style={styles.revRow}>
                <Text style={styles.revNumber}>Rev {r.revisionNumber}</Text>
                <Badge label={r.status.replace(/_/g, ' ')} variant="default" />
              </View>
            ))}
          </Card>
        )}
      </Screen>
    );
  }

  // ── Instructions list ──────────────────────────────────────────────────────

  if (view === 'instructions') {
    return (
      <Screen>
        <Breadcrumb />
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Instructions</Text>
          {canIssueInstructions && (
            <Button
              title="+ New"
              onPress={() => setView('instruction_create')}
              variant="secondary"
              style={{ height: 36, paddingHorizontal: 12 }}
            />
          )}
        </View>

        {instructions.length === 0
          ? <EmptyState title="No instructions" description="No instructions for this project." />
          : (
            <FlatList
              data={instructions}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { setSelectedInstruction(item); setView('instruction_detail'); }}
                  activeOpacity={0.75}
                >
                  <Card style={styles.listCard}>
                    <View style={styles.listRow}>
                      <Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text>
                      <Badge
                        label={item.priority}
                        variant={STATUS_PRIORITY_VARIANT[item.priority] ?? 'default'}
                      />
                    </View>
                    <View style={[styles.listMeta, { marginTop: 6 }]}>
                      <Badge
                        label={item.status.replace('_', ' ')}
                        variant={STATUS_PRIORITY_VARIANT[item.status] ?? 'default'}
                      />
                      <Text style={styles.listSub}>{item.type} · {item.issuedDate}</Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
            />
          )
        }
      </Screen>
    );
  }

  // ── Instruction detail ─────────────────────────────────────────────────────

  if (view === 'instruction_detail' && selectedInstruction) {
    const instr = selectedInstruction;

    async function updateStatus(status: string) {
      try {
        const updated = await instructionsApi.updateStatus(selectedProject!.id, instr.id, status);
        setSelectedInstruction(updated);
        setInstructions((prev) => prev.map((i) => i.id === updated.id ? updated : i));
      } catch {
        Alert.alert('Error', 'Failed to update status');
      }
    }

    return (
      <Screen scroll>
        <Breadcrumb />
        <Text style={styles.pageTitle} numberOfLines={2}>{instr.title}</Text>

        <Card style={[styles.summaryCard, { marginTop: 16 }]}>
          <View style={styles.badgeRow}>
            <Badge label={instr.type} variant="default" />
            <Badge label={instr.priority} variant={STATUS_PRIORITY_VARIANT[instr.priority] ?? 'default'} />
            <Badge label={instr.status.replace('_', ' ')} variant={STATUS_PRIORITY_VARIANT[instr.status] ?? 'default'} />
          </View>
          <InfoRow label="Issued Date" value={instr.issuedDate} />
          {instr.targetActionDate && <InfoRow label="Target Date" value={instr.targetActionDate} />}
          {instr.category && <InfoRow label="Category" value={instr.category} />}
          <InfoRow
            label="Issued By"
            value={`${instr.issuedBy.firstName} ${instr.issuedBy.lastName}`}
          />
        </Card>

        {instr.description && (
          <Card style={[styles.summaryCard, { marginTop: 12 }]}>
            <Text style={styles.cardTitle}>Description</Text>
            <Text style={styles.descText}>{instr.description}</Text>
          </Card>
        )}

        {/* Status actions */}
        {['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor'].includes(user.role) && (
          <Card style={[styles.summaryCard, { marginTop: 12 }]}>
            <Text style={styles.cardTitle}>Update Status</Text>
            <View style={styles.statusBtnRow}>
              {instr.status !== 'acknowledged' && (
                <Button title="Acknowledge" onPress={() => void updateStatus('acknowledged')} variant="secondary" style={{ flex: 1 }} />
              )}
              {instr.status !== 'in_progress' && (
                <Button title="In Progress" onPress={() => void updateStatus('in_progress')} variant="secondary" style={{ flex: 1 }} />
              )}
              {instr.status !== 'resolved' && (
                <Button title="Resolve" onPress={() => void updateStatus('resolved')} style={{ flex: 1 }} />
              )}
            </View>
          </Card>
        )}
      </Screen>
    );
  }

  // ── Instruction create ─────────────────────────────────────────────────────

  if (view === 'instruction_create') {
    return (
      <Screen>
        <Breadcrumb />
        <InstructionCreateForm
          projectId={selectedProject!.id}
          onSaved={(instr) => {
            setInstructions((prev) => [instr, ...prev]);
            setView('instructions');
          }}
          onCancel={() => setView('instructions')}
        />
      </Screen>
    );
  }

  return null;
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  label: { color: '#94a3b8', fontSize: 13 },
  value: { color: '#f1f5f9', fontSize: 13, fontWeight: '500', flex: 1, textAlign: 'right', marginLeft: 8 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 4 },
  pageTitle:   { color: '#f1f5f9', fontSize: 22, fontWeight: '700', padding: 16, paddingBottom: 4 },
  subLabel:    { color: '#94a3b8', fontSize: 13, paddingHorizontal: 16, marginBottom: 4 },
  sectionTitle: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginHorizontal: 16, marginTop: 20, marginBottom: 8 },

  listContent: { padding: 16, paddingBottom: 32 },
  listCard:    { marginBottom: 8 },
  listRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  listTitle:   { color: '#f1f5f9', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  listSub:     { color: '#94a3b8', fontSize: 12 },
  listMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaChip:    { color: '#94a3b8', fontSize: 12, backgroundColor: '#334155', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },

  summaryCard: { marginHorizontal: 16 },
  cardTitle:   { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  summaryRow:  { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  summaryItem: { alignItems: 'center', minWidth: 50 },
  summaryValue: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: '#94a3b8', fontSize: 10, marginTop: 2 },
  mutedText:   { color: '#475569', fontSize: 13 },

  actionCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#1e293b', borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: '#334155',
  },
  actionCardTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  actionCardSub:   { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  actionArrow:     { position: 'absolute', right: 16, top: '50%', color: '#475569', fontSize: 16 },

  backBtn:  { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  backText: { color: '#3b82f6', fontSize: 14, fontWeight: '500' },

  badgeRow:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  descText:      { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  statusBtnRow:  { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },

  revRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#334155' },
  revNumber: { color: '#f1f5f9', fontSize: 13 },

  formPad:   { padding: 20 },
  formTitle: { color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  fieldLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  chipRow:   { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  chipActive: { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  chipText:   { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#3b82f6' },
  btnRow:    { flexDirection: 'row', gap: 12, marginTop: 8 },
});
