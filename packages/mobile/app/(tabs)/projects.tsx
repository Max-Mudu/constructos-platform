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
import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  ScrollView, RefreshControl, Linking, TextInput,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getAccessToken } from '../../src/auth/secureStorage';
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

const PROJECT_STATUS: Record<string, { label: string; color: string; accent: string }> = {
  active:    { label: 'In Progress', color: '#3b82f6', accent: '#1d4ed8' },
  on_hold:   { label: 'On Hold',     color: '#f59e0b', accent: '#d97706' },
  delayed:   { label: 'Delayed',     color: '#ef4444', accent: '#dc2626' },
  completed: { label: 'Completed',   color: '#22c55e', accent: '#16a34a' },
  planning:  { label: 'Planning',    color: '#a78bfa', accent: '#7c3aed' },
};

const DISCIPLINE_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  Architectural: { color: '#a78bfa', bg: '#0d0a1a', border: '#2d1f5e' },
  Structural:    { color: '#f59e0b', bg: '#1a1200', border: '#422006' },
  Mechanical:    { color: '#22c55e', bg: '#071a0e', border: '#14532d' },
  Electrical:    { color: '#38bdf8', bg: '#061a26', border: '#0c3a52' },
  Civil:         { color: '#60a5fa', bg: '#0e1e36', border: '#1e3a6e' },
  Plumbing:      { color: '#34d399', bg: '#071a14', border: '#0f3a2a' },
};

const REVISION_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  draft:                   { label: 'Draft',            color: '#64748b', bg: '#0a1628', border: '#142240' },
  issued_for_review:       { label: 'For Review',       color: '#f59e0b', bg: '#1a1200', border: '#422006' },
  issued_for_construction: { label: 'For Construction', color: '#22c55e', bg: '#071a0e', border: '#14532d' },
  superseded:              { label: 'Superseded',       color: '#94a3b8', bg: '#0e1629', border: '#1e293b' },
  archived:                { label: 'Archived',         color: '#475569', bg: '#0a1628', border: '#142240' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critical', color: '#ef4444', bg: '#1a0606', border: '#450a0a' },
  high:     { label: 'High',     color: '#f59e0b', bg: '#1a1200', border: '#422006' },
  medium:   { label: 'Medium',   color: '#3b82f6', bg: '#0e1e36', border: '#1e3a6e' },
  low:      { label: 'Low',      color: '#64748b', bg: '#0a1628', border: '#142240' },
};

const INSTR_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  open:         { label: 'Open',         color: '#f59e0b', bg: '#1a1200', border: '#422006' },
  acknowledged: { label: 'Acknowledged', color: '#3b82f6', bg: '#0e1e36', border: '#1e3a6e' },
  in_progress:  { label: 'In Progress',  color: '#60a5fa', bg: '#0e1e36', border: '#1e3a6e' },
  resolved:     { label: 'Resolved',     color: '#22c55e', bg: '#071a0e', border: '#14532d' },
  rejected:     { label: 'Rejected',     color: '#ef4444', bg: '#1a0606', border: '#450a0a' },
};

function fmtDrawingDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ScreenView =
  | 'projects'
  | 'sites'
  | 'site_detail'
  | 'drawings'
  | 'drawing_detail'
  | 'instructions'
  | 'instruction_detail'
  | 'instruction_create';

const REVISION_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default' | 'outline'> = {
  draft:                   'default',
  issued_for_review:       'warning',
  issued_for_construction: 'success',
  superseded:              'outline',
  archived:                'default',
};

const STATUS_PRIORITY_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'default'> = {
  open:          'warning',
  acknowledged:  'default',
  in_progress:   'default',
  resolved:      'success',
  rejected:      'destructive',
  critical:      'destructive',
  high:          'warning',
  medium:        'default',
  low:           'default',
};

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

  const TYPES: InstructionType[] = ['instruction', 'recommendation'];
  const PRIORITIES: InstructionPriority[] = ['low', 'medium', 'high', 'critical'];

  async function save() {
    if (!title.trim()) {
      Alert.alert('Validation', 'Title is required');
      return;
    }

    setSaving(true);

    try {
      const instr = await instructionsApi.create(projectId, {
        type,
        title: title.trim(),
        priority,
        issuedDate,
        description: description.trim() || undefined,
      });

      onSaved(instr);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to create instruction';

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

export default function ProjectsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user)!;

  const [view,              setView]              = useState<ScreenView>('projects');
  const [projects,          setProjects]          = useState<Project[]>([]);
  const [sites,             setSites]             = useState<JobSite[]>([]);
  const [drawings,          setDrawings]          = useState<Drawing[]>([]);
  const [instructions,      setInstructions]      = useState<Instruction[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<Record<string, number> | null>(null);

  const [selectedProject,     setSelectedProject]     = useState<Project | null>(null);
  const [selectedSite,        setSelectedSite]        = useState<JobSite | null>(null);
  const [selectedDrawing,     setSelectedDrawing]     = useState<Drawing | null>(null);
  const [selectedInstruction, setSelectedInstruction] = useState<Instruction | null>(null);
  const [disciplineFilter,    setDisciplineFilter]    = useState<string | null>(null);

  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [projectSearch,  setProjectSearch]  = useState('');
  const [drawingSearch,  setDrawingSearch]  = useState('');

  const canIssueInstructions = ['company_admin', 'project_manager', 'consultant'].includes(user.role);

  async function loadProjects() {
    try {
      setProjects(await projectsApi.list());
    } catch {
      // non-fatal
    }
  }

  async function loadSites(project: Project) {
    try {
      setSites(await projectsApi.listSites(project.id));
    } catch {
      // non-fatal
    }
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
    } catch {
      // non-fatal
    }
  }

  async function loadInstructions(project: Project) {
    try {
      setInstructions(await instructionsApi.list(project.id));
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    loadProjects().finally(() => setLoading(false));
  }, []);

  async function onRefresh() {
    setRefreshing(true);

    if (view === 'projects') {
      await loadProjects();
    } else if (view === 'sites' && selectedProject) {
      await loadSites(selectedProject);
    } else if (view === 'drawings' && selectedProject) {
      await loadDrawings(selectedProject);
    } else if (view === 'instructions' && selectedProject) {
      await loadInstructions(selectedProject);
    }

    setRefreshing(false);
  }

  function goToProject(p: Project) {
    setSelectedProject(p);
    setSites([]);
    setView('sites');
    void loadSites(p);
  }

  function goToSite(s: JobSite) {
    setSelectedSite(s);
    setView('site_detail');

    if (selectedProject) {
      void loadSiteDetail(selectedProject, s);
    }
  }

  function goToDrawings() {
    if (!selectedProject) return;

    setView('drawings');
    void loadDrawings(selectedProject);
  }

  function goToInstructions() {
    if (!selectedProject) return;

    setInstructions([]);
    setView('instructions');
    void loadInstructions(selectedProject);
  }

  function goBack() {
    if (view === 'sites') {
      setView('projects');
      setSelectedProject(null);
    } else if (view === 'site_detail') {
      setView('sites');
      setSelectedSite(null);
    } else if (view === 'drawings') {
      setView('site_detail');
      setDrawings([]);
    } else if (view === 'drawing_detail') {
      setView('drawings');
      setSelectedDrawing(null);
    } else if (view === 'instructions') {
      setView('site_detail');
      setInstructions([]);
    } else if (view === 'instruction_detail') {
      setView('instructions');
      setSelectedInstruction(null);
    } else if (view === 'instruction_create') {
      setView('instructions');
    }
  }

  function Breadcrumb() {
    if (view === 'projects') return null;

    return (
      <TouchableOpacity onPress={goBack} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingSpinner />;

  if (view === 'projects') {
    const filtered = projectSearch.trim()
      ? projects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
      : projects;

    return (
      <View style={P.root}>
        {/* ── App bar ─────────────────────────────────────────────── */}
        <View style={P.appBar}>
          <View>
            <Text style={P.appBarTitle}>Active Projects</Text>
            <Text style={P.appBarSub}>{projects.length} project{projects.length !== 1 ? 's' : ''}</Text>
          </View>
          <View style={P.countBadge}>
            <Text style={P.countBadgeText}>{projects.length}</Text>
          </View>
        </View>

        {/* ── Search bar ──────────────────────────────────────────── */}
        <View style={P.searchWrap}>
          <Text style={P.searchIcon}>⌕</Text>
          <TextInput
            style={P.searchInput}
            value={projectSearch}
            onChangeText={setProjectSearch}
            placeholder="Search projects…"
            placeholderTextColor="#1e3a5f"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {projectSearch.length > 0 ? (
            <TouchableOpacity onPress={() => setProjectSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={P.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Project list ─────────────────────────────────────────── */}
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          contentContainerStyle={P.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#3b82f6" />
          }
          ListEmptyComponent={
            <View style={P.empty}>
              {projects.length === 0 ? (
                <>
                  <Text style={P.emptyTitle}>No projects</Text>
                  <Text style={P.emptySub}>No projects are assigned to your account.</Text>
                </>
              ) : (
                <>
                  <Text style={P.emptyTitle}>No results</Text>
                  <Text style={P.emptySub}>No projects match &ldquo;{projectSearch}&rdquo;.</Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const cfg = PROJECT_STATUS[item.status] ?? { label: item.status.replace(/_/g, ' '), color: '#3d6090', accent: '#1e3a5f' };
            return (
              <View style={P.card}>
                {/* Left accent bar */}
                <View style={[P.cardAccent, { backgroundColor: cfg.accent }]} />
                <View style={P.cardBody}>
                  {/* Status pill */}
                  <View style={P.cardTop}>
                    <View style={[P.statusPill, { borderColor: cfg.color + '55' }]}>
                      <View style={[P.statusDot, { backgroundColor: cfg.color }]} />
                      <Text style={[P.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>

                  {/* Project name */}
                  <Text style={P.cardName} numberOfLines={2}>{item.name}</Text>

                  {/* View Details */}
                  <TouchableOpacity
                    style={P.viewBtn}
                    onPress={() => goToProject(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={P.viewBtnText}>View Details</Text>
                    <Text style={P.viewBtnArrow}>›</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      </View>
    );
  }

  if (view === 'sites') {
    return (
      <Screen>
        <Breadcrumb />

        <View style={styles.header}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {selectedProject?.name ?? 'Project'}
          </Text>
        </View>

        <Text style={styles.subLabel}>Sites</Text>

        {sites.length === 0 ? (
          <EmptyState title="No sites" description="No sites found for this project." />
        ) : (
          <FlatList
            data={sites}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => goToSite(item)} activeOpacity={0.75}>
                <Card style={styles.listCard}>
                  <View style={styles.listRow}>
                    <Text style={styles.listTitle}>{item.name}</Text>
                    <Badge
                      label={item.status ?? 'active'}
                      variant={item.status === 'active' ? 'success' : 'default'}
                    />
                  </View>
                  <Text style={styles.listSub}>Tap to view site detail →</Text>
                </Card>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
          />
        )}
      </Screen>
    );
  }

  if (view === 'site_detail') {
    const site       = selectedSite;
    const project    = selectedProject;
    const present    = attendanceSummary?.['present']  ?? 0;
    const absent     = attendanceSummary?.['absent']   ?? 0;
    const total      = attendanceSummary
      ? Object.values(attendanceSummary).reduce((a, b) => a + b, 0)
      : 0;
    const hasAttendance = attendanceSummary !== null;
    const siteCfg    = PROJECT_STATUS[site?.status ?? 'active']
      ?? { label: (site?.status ?? 'Active').replace(/_/g, ' '), color: '#3b82f6', accent: '#1d4ed8' };

    return (
      <View style={SD.root}>
        {/* ── App bar with back ───────────────────────────────────── */}
        <View style={SD.appBar}>
          <TouchableOpacity
            style={SD.backBtn}
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={SD.backArrow}>‹</Text>
            <Text style={SD.backText}>Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={SD.scroll}
          contentContainerStyle={SD.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Breadcrumb ────────────────────────────────────────── */}
          <Text style={SD.breadcrumb}>{project?.name ?? 'Project'}</Text>

          {/* ── Site title + status ───────────────────────────────── */}
          <View style={SD.titleBlock}>
            <Text style={SD.siteTitle} numberOfLines={2}>{site?.name ?? 'Site'}</Text>
            <View style={[SD.statusPill, { borderColor: siteCfg.color + '55' }]}>
              <View style={[SD.statusDot, { backgroundColor: siteCfg.color }]} />
              <Text style={[SD.statusText, { color: siteCfg.color }]}>{siteCfg.label}</Text>
            </View>
          </View>

          {/* ── Today's Attendance ────────────────────────────────── */}
          <Text style={SD.sectionLabel}>Today&apos;s Attendance</Text>
          <View style={SD.attendanceCard}>
            <View style={SD.attendanceRow}>
              <View style={SD.attendanceStat}>
                <Text style={[SD.attendanceValue, SD.presentColor]}>
                  {hasAttendance ? present : '—'}
                </Text>
                <Text style={SD.attendanceLabel}>Present</Text>
              </View>
              <View style={SD.attendanceDivider} />
              <View style={SD.attendanceStat}>
                <Text style={[SD.attendanceValue, SD.absentColor]}>
                  {hasAttendance ? absent : '—'}
                </Text>
                <Text style={SD.attendanceLabel}>Absent</Text>
              </View>
              <View style={SD.attendanceDivider} />
              <View style={SD.attendanceStat}>
                <Text style={SD.attendanceValue}>
                  {hasAttendance ? total : '—'}
                </Text>
                <Text style={SD.attendanceLabel}>Total</Text>
              </View>
            </View>
            <TouchableOpacity
              style={SD.musterBtn}
              onPress={() => router.push('/(tabs)/attendance')}
              activeOpacity={0.8}
            >
              <Text style={SD.musterBtnText}>View Muster Roll</Text>
              <Text style={SD.musterBtnArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* ── 2×2 Resource grid ─────────────────────────────────── */}
          <Text style={SD.sectionLabel}>Site Resources</Text>
          <View style={SD.grid}>
            <ResourceTile icon="📐" title="Drawings"     sub="PDFs & revisions"   onPress={goToDrawings}    />
            <ResourceTile icon="📋" title="Instructions" sub="Site directives"     onPress={goToInstructions} />
            <ResourceTile
              icon="📅"
              title="Schedule"
              sub="Contractor tasks"
              onPress={() => Alert.alert('Schedule', 'View the full schedule in the Schedule tab.')}
            />
            <ResourceTile
              icon="👷"
              title="Labour"
              sub="Hours & wages"
              onPress={() => Alert.alert('Labour', 'Labour register is available on the web platform.')}
            />
          </View>

          {/* ── Site Information ──────────────────────────────────── */}
          <Text style={SD.sectionLabel}>Site Information</Text>
          <View style={SD.infoCard}>
            <SDInfoRow label="Site"    value={site?.name    ?? '—'} />
            <SDInfoRow label="Project" value={project?.name ?? '—'} />
            <SDInfoRow label="Status"  value={siteCfg.label}        last />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (view === 'drawings') {
    const disciplines = Array.from(
      new Set(drawings.map((d) => d.discipline).filter(Boolean) as string[]),
    ).sort();

    const filtered = drawings.filter((d) => {
      const matchesDiscipline = !disciplineFilter || d.discipline === disciplineFilter;
      const q = drawingSearch.trim().toLowerCase();
      const matchesSearch = !q
        || d.title.toLowerCase().includes(q)
        || d.drawingNumber.toLowerCase().includes(q)
        || (d.discipline ?? '').toLowerCase().includes(q);
      return matchesDiscipline && matchesSearch;
    });

    return (
      <View style={DR.root}>
        {/* ── App bar ────────────────────────────────────────────── */}
        <View style={DR.appBar}>
          <TouchableOpacity
            style={DR.backBtn}
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={DR.backArrow}>‹</Text>
            <Text style={DR.backText}>Back</Text>
          </TouchableOpacity>
          <View style={DR.appBarCenter}>
            <Text style={DR.appBarTitle}>Drawings</Text>
            {selectedProject ? <Text style={DR.appBarSub}>{selectedProject.name}</Text> : null}
          </View>
          <View style={DR.countBadge}>
            <Text style={DR.countBadgeText}>{filtered.length}</Text>
          </View>
        </View>

        {/* ── Search bar ─────────────────────────────────────────── */}
        <View style={DR.searchWrap}>
          <Text style={DR.searchIcon}>⌕</Text>
          <TextInput
            style={DR.searchInput}
            value={drawingSearch}
            onChangeText={setDrawingSearch}
            placeholder="Search drawings…"
            placeholderTextColor="#1e3a5f"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {drawingSearch.length > 0 ? (
            <TouchableOpacity onPress={() => setDrawingSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={DR.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Discipline filter chips ────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={DR.filterRow}
          style={DR.filterScroll}
        >
          <TouchableOpacity
            style={disciplineFilter === null ? [DR.filterChip, DR.filterChipActive] : DR.filterChip}
            onPress={() => setDisciplineFilter(null)}
            activeOpacity={0.8}
          >
            <Text style={disciplineFilter === null ? [DR.filterChipText, DR.filterChipTextActive] : DR.filterChipText}>
              All Drawings
            </Text>
          </TouchableOpacity>
          {disciplines.map((disc) => (
            <TouchableOpacity
              key={disc}
              style={disciplineFilter === disc ? [DR.filterChip, DR.filterChipActive] : DR.filterChip}
              onPress={() => setDisciplineFilter(disciplineFilter === disc ? null : disc)}
              activeOpacity={0.8}
            >
              <Text style={disciplineFilter === disc ? [DR.filterChipText, DR.filterChipTextActive] : DR.filterChipText}>
                {disc}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Drawing list ───────────────────────────────────────── */}
        <FlatList
          data={filtered}
          keyExtractor={(d) => d.id}
          contentContainerStyle={DR.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#3b82f6" />
          }
          ListEmptyComponent={
            <View style={DR.empty}>
              <Text style={DR.emptyTitle}>No drawings</Text>
              <Text style={DR.emptySub}>
                {drawings.length === 0
                  ? 'No drawings found for this project.'
                  : 'No drawings match your search or filter.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const rev       = item.latestRevision;
            const discCfg   = DISCIPLINE_COLOR[item.discipline ?? ''] ?? { color: '#3b82f6', bg: '#0e1e36', border: '#1e3a6e' };
            const revStCfg  = rev ? (REVISION_STATUS_CONFIG[rev.status] ?? { label: rev.status.replace(/_/g, ' '), color: '#3d6090', bg: '#0a1628', border: '#142240' }) : null;
            return (
              <TouchableOpacity
                style={DR.card}
                onPress={() => {
                  setSelectedDrawing(item);
                  setView('drawing_detail');
                }}
                activeOpacity={0.8}
              >
                {/* Left discipline accent */}
                <View style={[DR.cardAccent, { backgroundColor: discCfg.color }]} />

                <View style={DR.cardBody}>
                  {/* Row 1: drawing number + discipline badge */}
                  <View style={DR.cardTop}>
                    <Text style={DR.drawingNumber} numberOfLines={1}>{item.drawingNumber}</Text>
                    {item.discipline ? (
                      <View style={[DR.disciplineBadge, { backgroundColor: discCfg.bg, borderColor: discCfg.border }]}>
                        <Text style={[DR.disciplineBadgeText, { color: discCfg.color }]}>{item.discipline}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Row 2: title */}
                  <Text style={DR.cardTitle} numberOfLines={2}>{item.title}</Text>

                  {/* Row 3: revision pills + issue date */}
                  <View style={DR.cardBottom}>
                    <View style={DR.revRow}>
                      {rev ? (
                        <>
                          <View style={DR.revNumPill}>
                            <Text style={DR.revNumText}>Rev {rev.revisionNumber}</Text>
                          </View>
                          {revStCfg ? (
                            <View style={[DR.revStatusPill, { backgroundColor: revStCfg.bg, borderColor: revStCfg.border }]}>
                              <Text style={[DR.revStatusText, { color: revStCfg.color }]}>{revStCfg.label}</Text>
                            </View>
                          ) : null}
                        </>
                      ) : (
                        <View style={DR.noRevPill}>
                          <Text style={DR.noRevText}>No revision</Text>
                        </View>
                      )}
                    </View>
                    {rev?.issueDate ? (
                      <View style={DR.datePill}>
                        <Text style={DR.datePillLabel}>ISSUED</Text>
                        <Text style={DR.datePillValue}>{fmtDrawingDate(rev.issueDate)}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <Text style={DR.chevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  }

  if (view === 'drawing_detail' && selectedDrawing) {
    const rev = selectedDrawing.latestRevision;

    async function openPdf() {
      if (!rev) return;

      const pdfUrl = rev.fileUrl.startsWith('http')
        ? rev.fileUrl
        : `${BASE_URL}${rev.fileUrl}`;

      const safeFileName = `${selectedDrawing?.drawingNumber ?? 'drawing'}-rev-${rev.revisionNumber}.pdf`
        .replace(/[^a-zA-Z0-9.-]/g, '_');

      const localUri = `${FileSystem.cacheDirectory}${safeFileName}`;

      // Open from local cache if already downloaded and looks like a real PDF.
      const existing = await FileSystem.getInfoAsync(localUri);
      if (existing.exists && existing.size > 1000) {
        try {
          const canShare = await Sharing.isAvailableAsync();
          if (!canShare) {
            Alert.alert('Error', 'PDF sharing is not available on this device.');
            return;
          }
          await Sharing.shareAsync(localUri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Open Drawing PDF',
          });
        } catch {
          Alert.alert('Error', 'Could not open the drawing PDF.');
        }
        return;
      }
      // Cached file is too small (likely a previous error response) — purge it.
      if (existing.exists) {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
      }

      // File not cached — download it now.
      try {
        const token = await getAccessToken();
        console.log('[openPdf] URL:', pdfUrl);
        console.log('[openPdf] token present:', !!token);

        const result = await FileSystem.downloadAsync(pdfUrl, localUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        console.log('[openPdf] download status:', result.status);

        if (result.status !== 200) {
          Alert.alert('Error', `Download failed with status: ${result.status}`);
          return;
        }

        const fileInfo = await FileSystem.getInfoAsync(result.uri);
        console.log('[openPdf] file size:', fileInfo.exists ? fileInfo.size : 'missing');

        if (!fileInfo.exists || fileInfo.size < 1000) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true });
          Alert.alert('Error', 'Downloaded file is not a valid PDF.');
          return;
        }

        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          Alert.alert('Error', 'PDF sharing is not available on this device.');
          return;
        }

        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Open Drawing PDF',
        });
      } catch (err) {
        console.log('[openPdf] error:', err);
        Alert.alert('Error', 'Could not download PDF. Check console logs.');
      }
    }

    const discCfg = selectedDrawing.discipline
      ? (DISCIPLINE_COLOR[selectedDrawing.discipline] ?? { color: '#60a5fa', bg: '#0e1e36', border: '#1e3a6e' })
      : null;
    const revCfg = rev
      ? (REVISION_STATUS_CONFIG[rev.status] ?? { label: rev.status.replace(/_/g, ' '), color: '#3d6090', bg: '#0a1628', border: '#142240' })
      : null;

    return (
      <View style={DD.root}>
        {/* ── App bar ────────────────────────────────────────────── */}
        <View style={DD.appBar}>
          <TouchableOpacity
            style={DD.backBtn}
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={DD.backArrow}>‹</Text>
            <Text style={DD.backText}>Back</Text>
          </TouchableOpacity>
          {discCfg ? (
            <View style={[DD.disciplinePill, { backgroundColor: discCfg.bg, borderColor: discCfg.border }]}>
              <Text style={[DD.disciplinePillText, { color: discCfg.color }]}>
                {selectedDrawing.discipline}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          style={DD.scroll}
          contentContainerStyle={DD.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ───────────────────────────────────────────────── */}
          <Text style={DD.heroNumber}>{selectedDrawing.drawingNumber}</Text>
          <Text style={DD.heroTitle}>{selectedDrawing.title}</Text>

          {/* ── Document preview card ─────────────────────────────── */}
          <View style={DD.previewCard}>
            <View style={DD.previewBody}>
              <View style={DD.previewIconWrap}>
                <Text style={DD.previewIconText}>📐</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={DD.previewDrawingNum}>{selectedDrawing.drawingNumber}</Text>
                <Text style={DD.previewRevLine}>
                  {rev ? `Revision ${rev.revisionNumber}` : 'No revision on file'}
                </Text>
              </View>
              {revCfg ? (
                <View style={[DD.previewStatusBadge, { backgroundColor: revCfg.bg, borderColor: revCfg.border }]}>
                  <View style={[DD.previewStatusDot, { backgroundColor: revCfg.color }]} />
                  <Text style={[DD.previewStatusText, { color: revCfg.color }]}>{revCfg.label}</Text>
                </View>
              ) : null}
            </View>

            {rev ? (
              <TouchableOpacity style={DD.openPdfBtn} onPress={() => void openPdf()} activeOpacity={0.85}>
                <Text style={DD.openPdfBtnText}>Open Drawing PDF</Text>
                <Text style={DD.openPdfBtnArrow}>↗</Text>
              </TouchableOpacity>
            ) : (
              <View style={DD.noPdfNote}>
                <Text style={DD.noPdfNoteText}>No PDF available for this drawing</Text>
              </View>
            )}
          </View>

          {/* ── Drawing Details ───────────────────────────────────── */}
          <Text style={DD.sectionLabel}>Drawing Details</Text>
          <View style={DD.detailCard}>
            <DDRow label="Drawing No." value={selectedDrawing.drawingNumber} />
            {selectedDrawing.discipline ? (
              <DDRow label="Discipline" value={selectedDrawing.discipline} />
            ) : null}
            {rev ? (
              <>
                <DDRow label="Latest Revision" value={`Rev ${rev.revisionNumber}`} />
                <DDRow
                  label="Status"
                  value={revCfg?.label ?? rev.status.replace(/_/g, ' ')}
                  statusColor={revCfg?.color}
                />
                {rev.issueDate ? (
                  <DDRow label="Issue Date" value={fmtDrawingDate(rev.issueDate)} />
                ) : null}
                <DDRow
                  label="File Size"
                  value={fmtFileSize(rev.fileSizeBytes)}
                  last={!rev.notes}
                />
                {rev.notes ? (
                  <DDRow label="Notes" value={rev.notes} last />
                ) : null}
              </>
            ) : (
              <DDRow label="Revisions" value="None uploaded yet" last />
            )}
          </View>

          {/* ── Revision History ──────────────────────────────────── */}
          {selectedDrawing.revisions.length > 0 ? (
            <>
              <Text style={DD.sectionLabel}>
                Revision History ({selectedDrawing.revisions.length})
              </Text>
              <View style={DD.revCard}>
                {selectedDrawing.revisions.map((r, idx) => {
                  const rCfg   = REVISION_STATUS_CONFIG[r.status] ?? { label: r.status.replace(/_/g, ' '), color: '#3d6090', bg: '#0a1628', border: '#142240' };
                  const isLast = idx === selectedDrawing.revisions.length - 1;
                  return (
                    <View key={r.id} style={[DD.revRow, isLast ? null : DD.revRowBorder]}>
                      <View style={DD.revNumBadge}>
                        <Text style={DD.revNumBadgeText}>R{r.revisionNumber}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={DD.revFileName} numberOfLines={1}>{r.fileName}</Text>
                        {r.issueDate ? (
                          <Text style={DD.revDate}>{fmtDrawingDate(r.issueDate)}</Text>
                        ) : null}
                      </View>
                      <View style={[DD.revStatusBadge, { backgroundColor: rCfg.bg, borderColor: rCfg.border }]}>
                        <Text style={[DD.revStatusText, { color: rCfg.color }]}>{rCfg.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (view === 'instructions') {
    const openCount     = instructions.filter((i) => i.status === 'open' || i.status === 'acknowledged' || i.status === 'in_progress').length;
    const urgentCount   = instructions.filter((i) => i.priority === 'critical' || i.priority === 'high').length;
    const resolvedCount = instructions.filter((i) => i.status === 'resolved').length;
    const resolutionPct = instructions.length > 0 ? Math.round((resolvedCount / instructions.length) * 100) : 0;

    return (
      <View style={IL.root}>
        {/* ── App bar ─────────────────────────────────────────────── */}
        <View style={IL.appBar}>
          <TouchableOpacity
            style={IL.backBtn}
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={IL.backArrow}>‹</Text>
            <Text style={IL.backText}>Back</Text>
          </TouchableOpacity>
          <View style={IL.appBarCenter}>
            <Text style={IL.appBarTitle}>Instructions</Text>
            {selectedProject ? <Text style={IL.appBarSub}>{selectedProject.name}</Text> : null}
          </View>
          {canIssueInstructions ? (
            <TouchableOpacity style={IL.newBtn} onPress={() => setView('instruction_create')} activeOpacity={0.8}>
              <Text style={IL.newBtnText}>+ New</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Instruction list ────────────────────────────────────── */}
        <FlatList
          data={instructions}
          keyExtractor={(i) => i.id}
          contentContainerStyle={IL.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#3b82f6" />
          }
          ListHeaderComponent={
            <>
              {/* Summary card */}
              {instructions.length > 0 ? (
                <View style={IL.summaryCard}>
                  <Text style={IL.summaryTitle}>Project Instructions</Text>
                  <View style={IL.summaryRow}>
                    <View style={IL.summaryStat}>
                      <Text style={[IL.summaryValue, { color: '#f59e0b' }]}>{openCount}</Text>
                      <Text style={IL.summaryLabel}>Open</Text>
                    </View>
                    <View style={IL.summaryDivider} />
                    <View style={IL.summaryStat}>
                      <Text style={[IL.summaryValue, { color: '#ef4444' }]}>{urgentCount}</Text>
                      <Text style={IL.summaryLabel}>Urgent</Text>
                    </View>
                    <View style={IL.summaryDivider} />
                    <View style={IL.summaryStat}>
                      <Text style={[IL.summaryValue, { color: '#22c55e' }]}>{resolutionPct}%</Text>
                      <Text style={IL.summaryLabel}>Resolved</Text>
                    </View>
                  </View>
                  <View style={IL.progressWrap}>
                    <View style={IL.progressBg}>
                      <View style={[IL.progressFill, { width: `${resolutionPct}%` as `${number}%` }]} />
                    </View>
                    <Text style={IL.progressLabel}>{resolvedCount} of {instructions.length} resolved</Text>
                  </View>
                </View>
              ) : null}

              {/* Field log hint card */}
              <View style={IL.infoCard}>
                <Text style={IL.infoCardIcon}>📋</Text>
                <View style={{ flex: 1 }}>
                  <Text style={IL.infoCardTitle}>Field Instructions</Text>
                  <Text style={IL.infoCardSub}>Tap any instruction to view details and update status</Text>
                </View>
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={IL.empty}>
              <Text style={IL.emptyTitle}>No instructions</Text>
              <Text style={IL.emptySub}>No instructions found for this project.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const priorityCfg = PRIORITY_CONFIG[item.priority]    ?? { label: item.priority,             color: '#3d6090', bg: '#0a1628', border: '#142240' };
            const statusCfg   = INSTR_STATUS_CONFIG[item.status]  ?? { label: item.status.replace(/_/g, ' '), color: '#3d6090', bg: '#0a1628', border: '#142240' };
            const isUrgent    = item.priority === 'critical' || item.priority === 'high';
            return (
              <TouchableOpacity
                style={isUrgent ? [IL.card, IL.cardUrgent] : IL.card}
                onPress={() => {
                  setSelectedInstruction(item);
                  setView('instruction_detail');
                }}
                activeOpacity={0.8}
              >
                {/* Left accent colored by priority */}
                <View style={[IL.cardAccent, { backgroundColor: priorityCfg.color }]} />

                <View style={IL.cardBody}>
                  {/* Badges row */}
                  <View style={IL.cardBadgeRow}>
                    <View style={[IL.priorityBadge, { backgroundColor: priorityCfg.bg, borderColor: priorityCfg.border }]}>
                      <View style={[IL.badgeDot, { backgroundColor: priorityCfg.color }]} />
                      <Text style={[IL.priorityBadgeText, { color: priorityCfg.color }]}>{priorityCfg.label}</Text>
                    </View>
                    <View style={[IL.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
                      <Text style={[IL.statusBadgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                    </View>
                    <View style={IL.typePill}>
                      <Text style={IL.typePillText}>{item.type}</Text>
                    </View>
                  </View>

                  {/* Title */}
                  <Text style={IL.cardTitle} numberOfLines={2}>{item.title}</Text>

                  {/* Description */}
                  {item.description ? (
                    <Text style={IL.cardDesc} numberOfLines={2}>{item.description}</Text>
                  ) : null}

                  {/* Footer */}
                  <View style={IL.cardFooter}>
                    <Text style={IL.cardDate}>Issued {item.issuedDate}</Text>
                    {item.targetActionDate ? (
                      <Text style={[IL.cardDate, { color: '#f59e0b' }]}>Due {item.targetActionDate}</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={IL.chevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  }

  if (view === 'instruction_detail' && selectedInstruction) {
    const instr = selectedInstruction;

    async function updateStatus(status: string) {
      if (!selectedProject) return;

      try {
        const updated = await instructionsApi.updateStatus(selectedProject.id, instr.id, status);
        setSelectedInstruction(updated);
        setInstructions((prev) => prev.map((i) => i.id === updated.id ? updated : i));
      } catch {
        Alert.alert('Error', 'Failed to update status');
      }
    }

    const priorityCfg     = PRIORITY_CONFIG[instr.priority]    ?? { label: instr.priority,                   color: '#3d6090', bg: '#0a1628', border: '#142240' };
    const statusCfg       = INSTR_STATUS_CONFIG[instr.status]  ?? { label: instr.status.replace(/_/g, ' '), color: '#3d6090', bg: '#0a1628', border: '#142240' };
    const canUpdateStatus = ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor'].includes(user.role);
    const instrRef        = `#${(instr.id.split('-')[0] ?? instr.id.slice(0, 8)).toUpperCase()}`;

    return (
      <View style={IDT.root}>
        {/* ── App bar ─────────────────────────────────────────────── */}
        <View style={IDT.appBar}>
          <TouchableOpacity
            style={IDT.backBtn}
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={IDT.backArrow}>‹</Text>
            <Text style={IDT.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={IDT.appBarTitle} numberOfLines={1}>Instruction Detail</Text>
        </View>

        <ScrollView style={IDT.scroll} contentContainerStyle={IDT.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ── Hero card ──────────────────────────────────────────── */}
          <View style={IDT.heroCard}>
            {/* Reference + type */}
            <View style={IDT.heroTopRow}>
              <Text style={IDT.heroRef}>{instrRef}</Text>
              <View style={IDT.typePill}>
                <Text style={IDT.typePillText}>{instr.type}</Text>
              </View>
            </View>

            {/* Title */}
            <Text style={IDT.heroTitle}>{instr.title}</Text>

            {/* Priority + status badges */}
            <View style={IDT.heroBadgeRow}>
              <View style={[IDT.priorityBadge, { backgroundColor: priorityCfg.bg, borderColor: priorityCfg.border }]}>
                <View style={[IDT.badgeDot, { backgroundColor: priorityCfg.color }]} />
                <Text style={[IDT.badgeText, { color: priorityCfg.color }]}>{priorityCfg.label}</Text>
              </View>
              <View style={[IDT.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
                <View style={[IDT.badgeDot, { backgroundColor: statusCfg.color }]} />
                <Text style={[IDT.badgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              </View>
            </View>

            {/* Issued / due strip */}
            <View style={IDT.dateStrip}>
              <Text style={IDT.dateStripLabel}>ISSUED</Text>
              <Text style={IDT.dateStripValue}>{instr.issuedDate}</Text>
              {instr.targetActionDate ? (
                <>
                  <View style={IDT.dateStripDivider} />
                  <Text style={IDT.dateStripLabel}>DUE</Text>
                  <Text style={[IDT.dateStripValue, { color: '#f59e0b' }]}>{instr.targetActionDate}</Text>
                </>
              ) : null}
            </View>
          </View>

          {/* ── Description ────────────────────────────────────────── */}
          {instr.description ? (
            <>
              <Text style={IDT.sectionLabel}>Description</Text>
              <View style={IDT.descCard}>
                <Text style={IDT.descText}>{instr.description}</Text>
              </View>
            </>
          ) : null}

          {/* ── Instruction Details ────────────────────────────────── */}
          <Text style={IDT.sectionLabel}>Instruction Details</Text>
          <View style={IDT.detailCard}>
            <IDTRow label="Priority"  value={priorityCfg.label} valueColor={priorityCfg.color} />
            <IDTRow label="Status"    value={statusCfg.label}   valueColor={statusCfg.color}   />
            <IDTRow label="Issued By" value={`${instr.issuedBy.firstName} ${instr.issuedBy.lastName}`} />
            {instr.targetActionDate ? (
              <IDTRow label="Target Date" value={instr.targetActionDate} valueColor="#f59e0b" />
            ) : null}
            {instr.category ? (
              <IDTRow label="Category" value={instr.category} />
            ) : null}
            <IDTRow label="Type" value={instr.type.charAt(0).toUpperCase() + instr.type.slice(1)} last />
          </View>

          {/* ── Actions ─────────────────────────────────────────────── */}
          {canUpdateStatus ? (
            <>
              <Text style={IDT.sectionLabel}>Actions</Text>
              <View style={IDT.actionsCard}>
                {/* Acknowledge Receipt */}
                <TouchableOpacity
                  style={instr.status === 'acknowledged' ? [IDT.actionRow, IDT.actionRowDone] : IDT.actionRow}
                  onPress={instr.status !== 'acknowledged' ? () => void updateStatus('acknowledged') : undefined}
                  disabled={instr.status === 'acknowledged'}
                  activeOpacity={0.8}
                >
                  <View style={IDT.actionIconWrap}>
                    <Text style={IDT.actionIcon}>✓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={instr.status === 'acknowledged' ? [IDT.actionLabel, IDT.actionLabelDone] : IDT.actionLabel}>
                      Acknowledge Receipt
                    </Text>
                    <Text style={IDT.actionSub}>
                      {instr.status === 'acknowledged' ? 'Acknowledged' : 'Confirm you have received this instruction'}
                    </Text>
                  </View>
                  <Text style={instr.status === 'acknowledged' ? IDT.actionDoneCheck : IDT.actionChevron}>
                    {instr.status === 'acknowledged' ? '✓' : '›'}
                  </Text>
                </TouchableOpacity>

                <View style={IDT.actionDivider} />

                {/* Mark as In Progress */}
                {instr.status !== 'in_progress' && instr.status !== 'resolved' ? (
                  <>
                    <TouchableOpacity
                      style={IDT.actionRow}
                      onPress={() => void updateStatus('in_progress')}
                      activeOpacity={0.8}
                    >
                      <View style={IDT.actionIconWrap}>
                        <Text style={IDT.actionIcon}>⚙</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={IDT.actionLabel}>Mark as In Progress</Text>
                        <Text style={IDT.actionSub}>Update status to in progress</Text>
                      </View>
                      <Text style={IDT.actionChevron}>›</Text>
                    </TouchableOpacity>
                    <View style={IDT.actionDivider} />
                  </>
                ) : null}

                {/* Request Clarification — UI only, disabled */}
                <TouchableOpacity style={[IDT.actionRow, IDT.actionRowDisabled]} disabled activeOpacity={1}>
                  <View style={[IDT.actionIconWrap, IDT.actionIconWrapDisabled]}>
                    <Text style={[IDT.actionIcon, IDT.actionIconDisabled]}>?</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[IDT.actionLabel, IDT.actionLabelDisabled]}>Request Clarification</Text>
                    <Text style={IDT.actionSub}>Coming soon</Text>
                  </View>
                  <Text style={[IDT.actionChevron, { color: '#0e1e36' }]}>›</Text>
                </TouchableOpacity>

                <View style={IDT.actionDivider} />

                {/* Mark as Resolved */}
                <TouchableOpacity
                  style={instr.status === 'resolved' ? [IDT.actionRow, IDT.actionRowDone] : [IDT.actionRow, IDT.actionRowResolve]}
                  onPress={instr.status !== 'resolved' ? () => void updateStatus('resolved') : undefined}
                  disabled={instr.status === 'resolved'}
                  activeOpacity={0.8}
                >
                  <View style={[IDT.actionIconWrap, instr.status !== 'resolved' ? IDT.actionIconWrapResolve : null]}>
                    <Text style={[IDT.actionIcon, instr.status !== 'resolved' ? { color: '#22c55e' } : null]}>✓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={instr.status === 'resolved' ? [IDT.actionLabel, IDT.actionLabelDone] : [IDT.actionLabel, { color: '#22c55e' }]}>
                      Mark as Resolved
                    </Text>
                    <Text style={IDT.actionSub}>
                      {instr.status === 'resolved' ? 'Already resolved' : 'Close this instruction as completed'}
                    </Text>
                  </View>
                  <Text style={instr.status === 'resolved' ? IDT.actionDoneCheck : [IDT.actionChevron, { color: '#22c55e' }]}>
                    {instr.status === 'resolved' ? '✓' : '›'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (view === 'instruction_create') {
    return (
      <Screen>
        <Breadcrumb />

        {selectedProject && (
          <InstructionCreateForm
            projectId={selectedProject.id}
            onSaved={(instr) => {
              setInstructions((prev) => [instr, ...prev]);
              setView('instructions');
            }}
            onCancel={() => setView('instructions')}
          />
        )}
      </Screen>
    );
  }

  return null;
}

function ResourceTile({ icon, title, sub, onPress }: {
  icon: string; title: string; sub: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={SD.tile} onPress={onPress} activeOpacity={0.8}>
      <Text style={SD.tileIcon}>{icon}</Text>
      <Text style={SD.tileTitle}>{title}</Text>
      <Text style={SD.tileSub}>{sub}</Text>
      <Text style={SD.tileArrow}>›</Text>
    </TouchableOpacity>
  );
}

function SDInfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[SD.infoRow, last ? null : SD.infoRowBorder]}>
      <Text style={SD.infoLabel}>{label}</Text>
      <Text style={SD.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function DDRow({ label, value, statusColor, last }: {
  label: string; value: string; statusColor?: string; last?: boolean;
}) {
  return (
    <View style={[DD.detailRow, last ? null : DD.detailRowBorder]}>
      <Text style={DD.detailLabel}>{label}</Text>
      <Text
        style={[DD.detailValue, statusColor ? { color: statusColor } : null]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function IDTRow({ label, value, valueColor, last }: {
  label: string; value: string; valueColor?: string; last?: boolean;
}) {
  return (
    <View style={[IDT.detailRow, last ? null : IDT.detailRowBorder]}>
      <Text style={IDT.detailLabel}>{label}</Text>
      <Text
        style={[IDT.detailValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  label: {
    color: '#94a3b8',
    fontSize: 13,
  },
  value: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 4,
  },
  pageTitle: {
    color: '#f1f5f9',
    fontSize: 22,
    fontWeight: '700',
    padding: 16,
    paddingBottom: 4,
  },
  subLabel: {
    color: '#94a3b8',
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  listCard: {
    marginBottom: 8,
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  listTitle: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  listSub: {
    color: '#94a3b8',
    fontSize: 12,
  },
  listMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaChip: {
    color: '#94a3b8',
    fontSize: 12,
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  summaryCard: {
    marginHorizontal: 16,
  },
  cardTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  summaryItem: {
    alignItems: 'center',
    minWidth: 50,
  },
  summaryValue: {
    color: '#f1f5f9',
    fontSize: 20,
    fontWeight: '700',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 2,
  },
  mutedText: {
    color: '#475569',
    fontSize: 13,
  },
  actionCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionCardTitle: {
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '600',
  },
  actionCardSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  actionArrow: {
    position: 'absolute',
    right: 16,
    top: '50%',
    color: '#475569',
    fontSize: 16,
  },
  backBtn: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  descText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  statusBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  revRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  revNumber: {
    color: '#f1f5f9',
    fontSize: 13,
  },
  drawingCount: {
    color: '#64748b',
    fontSize: 13,
    paddingRight: 16,
    alignSelf: 'flex-end',
    paddingBottom: 4,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#1e3a5f',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#3b82f6',
  },
  drawingCard: {
    marginBottom: 10,
  },
  drawingCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  drawingNumber: {
    color: '#f1f5f9',
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  drawingTitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  drawingCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  revBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  revDate: {
    color: '#64748b',
    fontSize: 11,
  },
  formPad: {
    padding: 20,
  },
  formTitle: {
    color: '#f1f5f9',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  chipActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e3a5f',
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#3b82f6',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
});

// ─── Projects list view styles ────────────────────────────────────────────────

const P = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  appBarTitle: { color: '#e8f0fe', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  appBarSub:   { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 1 },
  countBadge: {
    backgroundColor: '#0e1e36',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBadgeText: { color: '#3b82f6', fontSize: 13, fontWeight: '700' },

  // Search bar
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#142240',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 8,
  },
  searchIcon:  { color: '#1e3a5f', fontSize: 18 },
  searchInput: { flex: 1, color: '#d0e0f5', fontSize: 14, padding: 0 },
  searchClear: { color: '#1e3a5f', fontSize: 14, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },

  // Project card
  card: {
    flexDirection: 'row',
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardAccent: { width: 4 },
  cardBody:   { flex: 1, padding: 16, gap: 10 },

  cardTop: { flexDirection: 'row', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: '#060d1b',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  cardName: {
    color: '#e8f0fe',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 22,
  },

  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: '#0e1e36',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  viewBtnText:  { color: '#60a5fa', fontSize: 13, fontWeight: '600' },
  viewBtnArrow: { color: '#3b82f6', fontSize: 18, lineHeight: 18 },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 64, gap: 8 },
  emptyTitle: { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  emptySub:   { color: '#1e3a5f', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Site detail view styles ──────────────────────────────────────────────────

const SD = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#060d1b' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { color: '#3b82f6', fontSize: 26, lineHeight: 28, fontWeight: '300' },
  backText:  { color: '#3b82f6', fontSize: 15, fontWeight: '500' },

  // Breadcrumb
  breadcrumb: {
    color: '#2d5070',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 18,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  // Title block
  titleBlock: { marginBottom: 20, gap: 10 },
  siteTitle:  { color: '#e8f0fe', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, lineHeight: 32 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: '#060d1b',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  // Section label
  sectionLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },

  // Attendance card
  attendanceCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 20,
    overflow: 'hidden',
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  attendanceStat:   { flex: 1, alignItems: 'center', gap: 4 },
  attendanceDivider: { width: 1, height: 40, backgroundColor: '#0e1e36' },
  attendanceValue: { color: '#e8f0fe', fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  attendanceLabel: { color: '#3d6090', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  presentColor:    { color: '#22c55e' },
  absentColor:     { color: '#ef4444' },

  musterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#070f1e',
    borderTopWidth: 1,
    borderTopColor: '#0e1e36',
    paddingVertical: 12,
  },
  musterBtnText:  { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
  musterBtnArrow: { color: '#3b82f6', fontSize: 18, lineHeight: 18 },

  // 2x2 Resource grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  tile: {
    width: '47.5%',
    backgroundColor: '#0a1628',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 16,
    gap: 4,
  },
  tileIcon:  { fontSize: 22, marginBottom: 4 },
  tileTitle: { color: '#e8f0fe', fontSize: 14, fontWeight: '700' },
  tileSub:   { color: '#2d5070', fontSize: 11, fontWeight: '500' },
  tileArrow: { color: '#1e3a5f', fontSize: 20, marginTop: 8, alignSelf: 'flex-end' },

  // Site info card
  infoCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 8 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: '#0e1e36' },
  infoLabel: { color: '#3d6090', fontSize: 13, fontWeight: '500', flex: 1 },
  infoValue: { color: '#c8d8f0', fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 2 },
});

// ─── Drawings list view styles ────────────────────────────────────────────────

const DR = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  backBtn:       { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backArrow:     { color: '#3b82f6', fontSize: 26, lineHeight: 28, fontWeight: '300' },
  backText:      { color: '#3b82f6', fontSize: 15, fontWeight: '500' },
  appBarCenter:  { flex: 1 },
  appBarTitle:   { color: '#e8f0fe', fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  appBarSub:     { color: '#2d5070', fontSize: 11, fontWeight: '500', marginTop: 1 },
  countBadge: {
    backgroundColor: '#0e1e36',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  countBadgeText: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#142240',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 44,
    gap: 8,
  },
  searchIcon:  { color: '#1e3a5f', fontSize: 18 },
  searchInput: { flex: 1, color: '#d0e0f5', fontSize: 14, padding: 0 },
  searchClear: { color: '#1e3a5f', fontSize: 14, fontWeight: '700' },

  // Filter chips
  filterScroll: { maxHeight: 50, borderBottomWidth: 1, borderBottomColor: '#0e1f38' },
  filterRow:    { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
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

  // Drawing card
  card: {
    flexDirection: 'row',
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
  cardAccent: { width: 4, alignSelf: 'stretch' },
  cardBody:   { flex: 1, padding: 14, gap: 8 },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawingNumber: {
    flex: 1,
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  disciplineBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  disciplineBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },

  cardTitle: { color: '#e8f0fe', fontSize: 14, fontWeight: '600', lineHeight: 20 },

  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  revRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },

  revNumPill: {
    backgroundColor: '#0e1e36',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  revNumText: { color: '#60a5fa', fontSize: 10, fontWeight: '700' },

  revStatusPill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  revStatusText: { fontSize: 10, fontWeight: '700' },

  noRevPill: {
    backgroundColor: '#0a1628',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  noRevText: { color: '#1e3a5f', fontSize: 10, fontWeight: '700' },

  datePill:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  datePillLabel: { color: '#1e3a5f', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  datePillValue: { color: '#3d6090', fontSize: 11, fontWeight: '600' },

  chevron: { color: '#1e3a5f', fontSize: 22, fontWeight: '300', paddingRight: 14 },

  // Empty
  empty:      { alignItems: 'center', paddingTop: 56, gap: 8 },
  emptyTitle: { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  emptySub:   { color: '#1e3a5f', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Drawing detail view styles ───────────────────────────────────────────────

const DD = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#060d1b' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backArrow: { color: '#3b82f6', fontSize: 26, lineHeight: 28, fontWeight: '300' },
  backText:  { color: '#3b82f6', fontSize: 15, fontWeight: '500' },

  disciplinePill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  disciplinePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  // Hero
  heroNumber: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 4,
  },
  heroTitle: {
    color: '#e8f0fe',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 30,
    marginBottom: 20,
  },

  // Preview card
  previewCard: {
    backgroundColor: '#0a1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 24,
    overflow: 'hidden',
  },
  previewBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
  },
  previewIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#0e1e36',
    borderWidth: 1,
    borderColor: '#1e3a6e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIconText:   { fontSize: 24 },
  previewDrawingNum: { color: '#60a5fa', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  previewRevLine:    { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },
  previewStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewStatusDot:  { width: 5, height: 5, borderRadius: 3 },
  previewStatusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },

  // Open PDF button
  openPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1d4ed8',
    borderTopWidth: 1,
    borderTopColor: '#2563eb',
    paddingVertical: 15,
  },
  openPdfBtnText:  { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  openPdfBtnArrow: { color: '#93c5fd', fontSize: 16, fontWeight: '700' },

  noPdfNote: {
    backgroundColor: '#070f1e',
    borderTopWidth: 1,
    borderTopColor: '#0e1e36',
    paddingVertical: 14,
    alignItems: 'center',
  },
  noPdfNoteText: { color: '#1e3a5f', fontSize: 13, fontWeight: '500' },

  // Section label
  sectionLabel: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Detail card
  detailCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 8 },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: '#0e1e36' },
  detailLabel: { color: '#3d6090', fontSize: 13, fontWeight: '500', flex: 1 },
  detailValue: { color: '#c8d8f0', fontSize: 13, fontWeight: '600', flex: 2, textAlign: 'right' },

  // Revision history card
  revCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  revRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  revRowBorder:  { borderBottomWidth: 1, borderBottomColor: '#0e1e36' },
  revNumBadge: {
    backgroundColor: '#0e1e36',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  revNumBadgeText: { color: '#60a5fa', fontSize: 11, fontWeight: '800' },
  revFileName:     { color: '#c8d8f0', fontSize: 13, fontWeight: '600' },
  revDate:         { color: '#2d5070', fontSize: 11, fontWeight: '500', marginTop: 2 },
  revStatusBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  revStatusText: { fontSize: 10, fontWeight: '700' },
});

// ─── Instructions list view styles ────────────────────────────────────────────

const IL = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backArrow:    { color: '#3b82f6', fontSize: 26, lineHeight: 28, fontWeight: '300' },
  backText:     { color: '#3b82f6', fontSize: 15, fontWeight: '500' },
  appBarCenter: { flex: 1 },
  appBarTitle:  { color: '#e8f0fe', fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  appBarSub:    { color: '#2d5070', fontSize: 11, fontWeight: '500', marginTop: 1 },
  newBtn: {
    backgroundColor: '#0e1e36',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newBtnText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 48 },

  // Summary card
  summaryCard: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 16,
    marginBottom: 12,
  },
  summaryTitle:   { color: '#3d6090', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14 },
  summaryRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  summaryStat:    { flex: 1, alignItems: 'center', gap: 3 },
  summaryValue:   { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel:   { color: '#3d6090', fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryDivider: { width: 1, height: 36, backgroundColor: '#0e1e36' },

  progressWrap:  { gap: 6 },
  progressBg:    { height: 5, backgroundColor: '#0e1e36', borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: 5, backgroundColor: '#22c55e', borderRadius: 3 },
  progressLabel: { color: '#2d5070', fontSize: 11, fontWeight: '500', textAlign: 'right' },

  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#070f1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0e1e36',
    padding: 12,
    marginBottom: 14,
  },
  infoCardIcon:  { fontSize: 20 },
  infoCardTitle: { color: '#2d5a9e', fontSize: 13, fontWeight: '600' },
  infoCardSub:   { color: '#1e3a5f', fontSize: 11, fontWeight: '500', marginTop: 2 },

  // Instruction card
  card: {
    flexDirection: 'row',
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    marginBottom: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
  cardUrgent: { borderColor: '#2a1000' },
  cardAccent: { width: 4, alignSelf: 'stretch' },
  cardBody:   { flex: 1, padding: 14, gap: 7 },

  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeDot:          { width: 5, height: 5, borderRadius: 3 },
  priorityBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },

  statusBadge: {
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '700' },

  typePill: {
    backgroundColor: '#060d1b',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#0e1e36',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typePillText: { color: '#1e3a5f', fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },

  cardTitle: { color: '#e8f0fe', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  cardDesc:  { color: '#3d6090', fontSize: 12, lineHeight: 17 },

  cardFooter: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  cardDate:   { color: '#1e3a5f', fontSize: 11, fontWeight: '500' },

  chevron: { color: '#1e3a5f', fontSize: 22, fontWeight: '300', paddingRight: 14 },

  // Empty
  empty:      { alignItems: 'center', paddingTop: 56, gap: 8 },
  emptyTitle: { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  emptySub:   { color: '#1e3a5f', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});

// ─── Instruction detail view styles ──────────────────────────────────────────

const IDT = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#060d1b' },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backArrow:   { color: '#3b82f6', fontSize: 26, lineHeight: 28, fontWeight: '300' },
  backText:    { color: '#3b82f6', fontSize: 15, fontWeight: '500' },
  appBarTitle: { flex: 1, color: '#e8f0fe', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },

  // Hero card
  heroCard: {
    backgroundColor: '#0a1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 18,
    marginTop: 18,
    marginBottom: 20,
    gap: 12,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroRef:    { color: '#2d5070', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  typePill: {
    backgroundColor: '#070f1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0e1e36',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typePillText: { color: '#1e3a5f', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTitle:    { color: '#e8f0fe', fontSize: 20, fontWeight: '800', letterSpacing: -0.3, lineHeight: 26 },

  heroBadgeRow:  { flexDirection: 'row', gap: 8 },
  priorityBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  statusBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  badgeDot:      { width: 6, height: 6, borderRadius: 3 },
  badgeText:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  dateStrip:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#060d1b', borderRadius: 10, padding: 10, flexWrap: 'wrap' },
  dateStripLabel:   { color: '#1e3a5f', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  dateStripValue:   { color: '#3d6090', fontSize: 12, fontWeight: '600' },
  dateStripDivider: { width: 1, height: 14, backgroundColor: '#0e1e36' },

  // Section label
  sectionLabel: { color: '#3d6090', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  // Description card
  descCard: { backgroundColor: '#0a1628', borderRadius: 14, borderWidth: 1, borderColor: '#142240', padding: 16, marginBottom: 20 },
  descText: { color: '#c8d8f0', fontSize: 14, lineHeight: 22 },

  // Detail card
  detailCard:      { backgroundColor: '#0a1628', borderRadius: 16, borderWidth: 1, borderColor: '#142240', paddingHorizontal: 16, marginBottom: 20 },
  detailRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 8 },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: '#0e1e36' },
  detailLabel:     { color: '#3d6090', fontSize: 13, fontWeight: '500', flex: 1 },
  detailValue:     { color: '#c8d8f0', fontSize: 13, fontWeight: '600', flex: 2, textAlign: 'right' },

  // Actions card
  actionsCard:       { backgroundColor: '#0a1628', borderRadius: 16, borderWidth: 1, borderColor: '#142240', marginBottom: 20, overflow: 'hidden' },
  actionRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  actionRowDone:     { opacity: 0.5 },
  actionRowDisabled: { opacity: 0.32 },
  actionRowResolve:  { backgroundColor: '#071a0e' },

  actionIconWrap: {
    width: 38, height: 38,
    borderRadius: 10,
    backgroundColor: '#0e1e36',
    borderWidth: 1,
    borderColor: '#1e3a6e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconWrapDisabled: { backgroundColor: '#060d1b', borderColor: '#0e1e36' },
  actionIconWrapResolve:  { backgroundColor: '#0a2e18', borderColor: '#14532d' },

  actionIcon:          { fontSize: 16, color: '#3b82f6' },
  actionIconDisabled:  { color: '#0e1e36' },
  actionLabel:         { color: '#c8d8f0', fontSize: 14, fontWeight: '600' },
  actionLabelDone:     { color: '#3d6090' },
  actionLabelDisabled: { color: '#1e3a5f' },
  actionSub:           { color: '#1e3a5f', fontSize: 11, fontWeight: '500', marginTop: 2 },
  actionChevron:       { color: '#2d5070', fontSize: 20, fontWeight: '300' },
  actionDoneCheck:     { color: '#3d6090', fontSize: 16, fontWeight: '700' },
  actionDivider:       { height: 1, backgroundColor: '#0e1e36', marginLeft: 68 },
});