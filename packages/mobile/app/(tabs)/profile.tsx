import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Switch,
  Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../../src/store/auth.store';
import { authApi } from '../../src/api/auth';
import { notificationsApi } from '../../src/api/notifications';
import { getRefreshToken } from '../../src/auth/secureStorage';
import { Project, JobSite } from '../../src/types';
import { projectsApi } from '../../src/api/projects';

const ROLE_LABEL: Record<string, string> = {
  company_admin:    'Company Admin',
  project_manager:  'Project Manager',
  site_supervisor:  'Site Supervisor',
  finance_officer:  'Finance Officer',
  consultant:       'Consultant',
  contractor:       'Contractor',
  worker:           'Worker',
  viewer:           'Viewer',
};

export default function ProfileScreen() {
  const router = useRouter();
  const { user, clearAuth, setUser } = useAuthStore();
  const [loggingOut, setLoggingOut] = useState(false);

  // Settings state — UI only
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [darkMode,        setDarkMode]        = useState(true);
  const [locationOn,      setLocationOn]      = useState(false);

  // Workspace state
  const [selProjectId, setSelProjectId]           = useState(user?.defaultProjectId ?? '');
  const [selSiteId, setSelSiteId]                 = useState(user?.defaultSiteId ?? '');
  const [projects, setProjects]                   = useState<Project[]>([]);
  const [sites, setSites]                         = useState<JobSite[]>([]);
  const [sitesLoading, setSitesLoading]           = useState(false);
  const [showProjPicker, setShowProjPicker]       = useState(false);
  const [showSitePicker, setShowSitePicker]       = useState(false);
  const [projPickerLoading, setProjPickerLoading] = useState(false);
  const [wsSaving, setWsSaving]                   = useState(false);
  const [wsClearing, setWsClearing]               = useState(false);
  const [wsMsg, setWsMsg]                         = useState('');
  const [wsMsgOk, setWsMsgOk]                     = useState(true);

  // Load sites for the current default project on mount (so picker is ready)
  useEffect(() => {
    const pid = user?.defaultProjectId;
    if (!pid) return;
    setSitesLoading(true);
    projectsApi.listSites(pid)
      .then(setSites)
      .catch(() => {})
      .finally(() => setSitesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) {
    return (
      <View style={S.root}>
        <View style={S.appBar}>
          <Text style={S.appBarTitle}>Profile</Text>
        </View>
        <View style={S.emptyWrap}>
          <Text style={S.emptyText}>No user data. Please log in again.</Text>
        </View>
      </View>
    );
  }

  // ── Workspace computed values ─────────────────────────────────────────────
  const wsHasDefaults = !!(user.defaultProjectId && user.defaultSiteId);
  const wsHasChanged  = selProjectId !== (user.defaultProjectId ?? '') || selSiteId !== (user.defaultSiteId ?? '');
  const wsCanSave     = !!(selProjectId && selSiteId && wsHasChanged && !wsSaving);

  // ── Workspace handlers ────────────────────────────────────────────────────
  async function openProjectPicker() {
    setShowProjPicker(true);
    if (projects.length === 0) {
      setProjPickerLoading(true);
      try {
        const list = await projectsApi.list();
        setProjects(list);
      } catch {
        setShowProjPicker(false);
        setWsMsg('Failed to load projects');
        setWsMsgOk(false);
      } finally {
        setProjPickerLoading(false);
      }
    }
  }

  function handleSelectProject(pid: string) {
    setSelProjectId(pid);
    setSelSiteId('');
    setSites([]);
    setShowProjPicker(false);
    setSitesLoading(true);
    projectsApi.listSites(pid)
      .then(setSites)
      .catch(() => {})
      .finally(() => setSitesLoading(false));
  }

  function handleSelectSite(sid: string) {
    setSelSiteId(sid);
    setShowSitePicker(false);
  }

  async function handleSaveWorkspace() {
    if (!selProjectId || !selSiteId) return;
    setWsSaving(true);
    setWsMsg('');
    try {
      const updated = await authApi.updateDefaults({ defaultProjectId: selProjectId, defaultSiteId: selSiteId });
      setUser(updated);
      setWsMsg('Workspace saved.');
      setWsMsgOk(true);
      setTimeout(() => setWsMsg(''), 3000);
    } catch {
      setWsMsg('Failed to save workspace');
      setWsMsgOk(false);
    } finally {
      setWsSaving(false);
    }
  }

  async function handleClearWorkspace() {
    setWsClearing(true);
    setWsMsg('');
    try {
      const updated = await authApi.updateDefaults({ defaultProjectId: null, defaultSiteId: null });
      setUser(updated);
      setSelProjectId('');
      setSelSiteId('');
      setSites([]);
      setWsMsg('Workspace cleared.');
      setWsMsgOk(true);
      setTimeout(() => setWsMsg(''), 3000);
    } catch {
      setWsMsg('Failed to clear workspace');
      setWsMsgOk(false);
    } finally {
      setWsClearing(false);
    }
  }

  const firstName  = user.firstName?.trim() || 'User';
  const lastName   = user.lastName?.trim()  || '';
  const fullName   = `${firstName} ${lastName}`.trim();
  const email      = user.email?.trim()     || '—';
  const roleKey    = user.role              || 'viewer';
  const roleLabel  = ROLE_LABEL[roleKey]    ?? roleKey.replace(/_/g, ' ');
  const initials   = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const isVerified = roleKey !== 'viewer';

  // ── Logout ──────────────────────────────────────────────────────────────
  async function handleLogout() {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              try {
                const tokenData = await Notifications.getExpoPushTokenAsync();
                await notificationsApi.unregisterPushToken(tokenData.data);
              } catch { /* non-fatal */ }

              const refreshToken = await getRefreshToken();
              if (refreshToken) await authApi.logout(refreshToken).catch(() => {});
            } finally {
              await clearAuth();
              router.replace('/login');
              setLoggingOut(false);
            }
          },
        },
      ],
    );
  }

  function stub(title: string) {
    Alert.alert(title, 'This feature is coming soon.');
  }

  return (
    <View style={S.root}>
      {/* ── App bar ──────────────────────────────────────────────────── */}
      <View style={S.appBar}>
        <Text style={S.appBarTitle}>Profile</Text>
      </View>

      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile card ─────────────────────────────────────────── */}
        <View style={S.profileCard}>
          {/* Avatar */}
          <View style={S.avatarOuter}>
            <View style={S.avatarInner}>
              <Text style={S.avatarText}>{initials}</Text>
            </View>
          </View>

          {/* Name + role */}
          <Text style={S.fullName}>{fullName}</Text>
          <View style={S.rolePill}>
            <Text style={S.rolePillText}>{roleLabel}</Text>
          </View>

          {/* Verified / Finance pills */}
          <View style={S.pillsRow}>
            {isVerified ? (
              <View style={S.verifiedPill}>
                <View style={S.pillDot} />
                <Text style={S.verifiedPillText}>Verified Staff</Text>
              </View>
            ) : null}
            {user.canViewFinance ? (
              <View style={S.financePill}>
                <View style={[S.pillDot, S.pillDotGold]} />
                <Text style={S.financePillText}>Finance Access</Text>
              </View>
            ) : null}
          </View>

          {/* Edit Profile — UI only */}
          <TouchableOpacity style={S.editBtn} onPress={() => stub('Edit Profile')} activeOpacity={0.8}>
            <Text style={S.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* ── Information ──────────────────────────────────────────── */}
        <SectionCard title="Information">
          <InfoRow icon="✉" label="Email" value={email} />
          <InfoRow icon="🏢" label="Role"  value={roleLabel} last />
        </SectionCard>

        {/* ── Default Workspace ────────────────────────────────────── */}
        <SectionCard title="Default Workspace">
          <View style={W.desc}>
            <Text style={W.descText}>
              This workspace opens automatically when using operational modules.
            </Text>
          </View>

          {/* Project row */}
          <TouchableOpacity
            style={[R.row, R.rowBorder]}
            onPress={() => void openProjectPicker()}
            activeOpacity={0.7}
          >
            <Text style={R.rowIcon}>🏗</Text>
            <Text style={[R.rowLabel, { flex: 1 }]}>Project</Text>
            {projPickerLoading ? (
              <ActivityIndicator size="small" color="#3d6090" />
            ) : (
              <Text style={[R.rowValue, selProjectId ? W.valueSet : null]} numberOfLines={1}>
                {selProjectId
                  ? (projects.find((p) => p.id === selProjectId)?.name ?? 'Loading…')
                  : 'Not set'}
              </Text>
            )}
            <Text style={R.chevron}>›</Text>
          </TouchableOpacity>

          {/* Site row */}
          <TouchableOpacity
            style={[R.row, !selProjectId ? W.rowDisabled : null]}
            onPress={() => setShowSitePicker(true)}
            disabled={!selProjectId || sitesLoading}
            activeOpacity={0.7}
          >
            <Text style={R.rowIcon}>📍</Text>
            <Text style={[R.rowLabel, { flex: 1 }]}>Site</Text>
            {sitesLoading ? (
              <ActivityIndicator size="small" color="#3d6090" />
            ) : (
              <Text style={[R.rowValue, selSiteId ? W.valueSet : null]} numberOfLines={1}>
                {selSiteId
                  ? (sites.find((s) => s.id === selSiteId)?.name ?? 'Loading…')
                  : (selProjectId ? 'Select site' : 'Select project first')}
              </Text>
            )}
            <Text style={[R.chevron, !selProjectId ? W.chevronDisabled : null]}>›</Text>
          </TouchableOpacity>

          {/* Actions */}
          <View style={W.actions}>
            <TouchableOpacity
              style={[W.saveBtn, !wsCanSave ? W.saveBtnDisabled : null]}
              onPress={() => void handleSaveWorkspace()}
              disabled={!wsCanSave}
              activeOpacity={0.85}
            >
              <Text style={W.saveBtnText}>{wsSaving ? 'Saving…' : 'Save workspace'}</Text>
            </TouchableOpacity>
            {wsHasDefaults && !wsSaving && (
              <TouchableOpacity
                style={W.clearBtn}
                onPress={() => void handleClearWorkspace()}
                disabled={wsClearing}
                activeOpacity={0.85}
              >
                <Text style={W.clearBtnText}>{wsClearing ? '…' : 'Clear'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {wsMsg ? (
            <Text style={wsMsgOk ? W.msgOk : W.msgErr}>{wsMsg}</Text>
          ) : null}
        </SectionCard>

        {/* ── App Settings ─────────────────────────────────────────── */}
        <SectionCard title="App Settings">
          <ToggleRow
            icon="🔔"
            label="Notifications"
            value={notificationsOn}
            onToggle={setNotificationsOn}
          />
          <ToggleRow
            icon="🌙"
            label="Dark Mode"
            value={darkMode}
            onToggle={setDarkMode}
          />
          <ToggleRow
            icon="📍"
            label="Location Services"
            value={locationOn}
            onToggle={setLocationOn}
            last
          />
        </SectionCard>

        {/* ── Support & Legal ───────────────────────────────────────── */}
        <SectionCard title="Support & Legal">
          <LinkRow icon="❓" label="Help Center" onPress={() => stub('Help Center')} />
          <LinkRow icon="📄" label="Terms of Service" onPress={() => stub('Terms of Service')} />
          <LinkRow icon="🔒" label="Privacy Policy"   onPress={() => stub('Privacy Policy')} />
          <LinkRow icon="🚩" label="Report a Bug"     onPress={() => stub('Report a Bug')} last />
        </SectionCard>

        {/* ── Logout ───────────────────────────────────────────────── */}
        <TouchableOpacity
          style={loggingOut ? [S.logoutBtn, S.logoutBtnLoading] : S.logoutBtn}
          onPress={() => void handleLogout()}
          disabled={loggingOut}
          activeOpacity={0.85}
        >
          <Text style={S.logoutBtnText}>
            {loggingOut ? 'Logging out…' : 'Log Out'}
          </Text>
        </TouchableOpacity>

        <Text style={S.version}>ConstructOS · v1.0.0</Text>
      </ScrollView>

      {/* ── Project picker modal ─────────────────────────────────────── */}
      <Modal
        visible={showProjPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowProjPicker(false)}
      >
        <View style={M.backdrop}>
          <View style={M.sheet}>
            <View style={M.header}>
              <Text style={M.title}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjPicker(false)} style={M.closeBtn} activeOpacity={0.7}>
                <Text style={M.closeTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            {projPickerLoading ? (
              <View style={M.loadingWrap}>
                <ActivityIndicator size="large" color="#3b82f6" />
              </View>
            ) : (
              <FlatList
                data={projects}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[M.item, item.id === selProjectId ? M.itemActive : null]}
                    onPress={() => handleSelectProject(item.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[M.itemText, item.id === selProjectId ? M.itemTextActive : null]}>
                      {item.name}
                    </Text>
                    {item.id === selProjectId && <Text style={M.check}>✓</Text>}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={M.empty}>No projects found</Text>}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ── Site picker modal ────────────────────────────────────────── */}
      <Modal
        visible={showSitePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSitePicker(false)}
      >
        <View style={M.backdrop}>
          <View style={M.sheet}>
            <View style={M.header}>
              <Text style={M.title}>Select Site</Text>
              <TouchableOpacity onPress={() => setShowSitePicker(false)} style={M.closeBtn} activeOpacity={0.7}>
                <Text style={M.closeTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={sites}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[M.item, item.id === selSiteId ? M.itemActive : null]}
                  onPress={() => handleSelectSite(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[M.itemText, item.id === selSiteId ? M.itemTextActive : null]}>
                    {item.name}
                  </Text>
                  {item.id === selSiteId && <Text style={M.check}>✓</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={M.empty}>No sites found</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={C.card}>
      <Text style={C.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[R.row, last ? null : R.rowBorder]}>
      <Text style={R.rowIcon}>{icon}</Text>
      <Text style={R.rowLabel}>{label}</Text>
      <Text style={R.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ToggleRow({
  icon, label, value, onToggle, last,
}: {
  icon: string; label: string; value: boolean; onToggle: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[R.row, last ? null : R.rowBorder]}>
      <Text style={R.rowIcon}>{icon}</Text>
      <Text style={[R.rowLabel, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#112036', true: '#1d4ed8' }}
        thumbColor={value ? '#60a5fa' : '#3d6090'}
        ios_backgroundColor="#112036"
      />
    </View>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[R.row, last ? null : R.rowBorder]} onPress={onPress} activeOpacity={0.7}>
      <Text style={R.rowIcon}>{icon}</Text>
      <Text style={[R.rowLabel, { flex: 1 }]}>{label}</Text>
      <Text style={R.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#060d1b' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

  // App bar
  appBar: {
    backgroundColor: '#060d1b',
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  appBarTitle: {
    color: '#e8f0fe',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  // Empty state
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:  { color: '#3d6090', fontSize: 14 },

  // Profile card
  profileCard: {
    backgroundColor: '#0a1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#142240',
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 14,
  },

  avatarOuter: {
    width: 92, height: 92,
    borderRadius: 46,
    backgroundColor: '#0e1e36',
    borderWidth: 2,
    borderColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarInner: {
    width: 76, height: 76,
    borderRadius: 38,
    backgroundColor: '#1a3260',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#60a5fa', fontSize: 30, fontWeight: '800' },

  fullName: {
    color: '#e8f0fe',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
  },

  rolePill: {
    backgroundColor: '#0e1e36',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 12,
  },
  rolePillText: { color: '#60a5fa', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },

  pillsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },

  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#071628',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f2a18',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedPillText: { color: '#22c55e', fontSize: 11, fontWeight: '600' },

  financePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a1200',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a1e00',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  financePillText: { color: '#f59e0b', fontSize: 11, fontWeight: '600' },

  pillDot:     { width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' },
  pillDotGold: { backgroundColor: '#f59e0b' },

  editBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    backgroundColor: '#0e1e36',
    paddingHorizontal: 24,
    paddingVertical: 9,
  },
  editBtnText: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },

  // Logout
  logoutBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 13,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  logoutBtnLoading: { backgroundColor: '#450a0a', borderColor: '#450a0a' },
  logoutBtnText: { color: '#fca5a5', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  version: {
    color: '#1e3a5f',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
});

const C = StyleSheet.create({
  card: {
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#142240',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    marginBottom: 14,
  },
  cardTitle: {
    color: '#3d6090',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
});

const R = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#0e1e36',
  },
  rowIcon:  { fontSize: 16, width: 22, textAlign: 'center' },
  rowLabel: { color: '#c8d8f0', fontSize: 14, fontWeight: '500' },
  rowValue: { color: '#3d6090', fontSize: 14, flex: 1, textAlign: 'right' },
  chevron:  { color: '#1e3a5f', fontSize: 20, fontWeight: '300' },
});

// ── Workspace section styles ───────────────────────────────────────────────────

const W = StyleSheet.create({
  desc:          { paddingTop: 0, paddingBottom: 10 },
  descText:      { color: '#3d6090', fontSize: 12, lineHeight: 17 },
  valueSet:      { color: '#c8d8f0' },
  rowDisabled:   { opacity: 0.38 },
  chevronDisabled: { color: '#0e1e36' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 16,
    paddingBottom: 4,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#142240',
  },
  saveBtnText:   { color: '#fff', fontSize: 14, fontWeight: '600' },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a6e',
    backgroundColor: '#0a1628',
    alignItems: 'center',
  },
  clearBtnText:  { color: '#60a5fa', fontSize: 14, fontWeight: '500' },
  msgOk: {
    color: '#22c55e', fontSize: 12, textAlign: 'center',
    paddingVertical: 8, fontWeight: '500',
  },
  msgErr: {
    color: '#f87171', fontSize: 12, textAlign: 'center',
    paddingVertical: 8, fontWeight: '500',
  },
});

// ── Picker modal styles ────────────────────────────────────────────────────────

const M = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0a1628',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#142240',
    maxHeight: '65%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#142240',
  },
  title:    { color: '#e8f0fe', fontSize: 16, fontWeight: '700' },
  closeBtn: { padding: 6 },
  closeTxt: { color: '#3d6090', fontSize: 18 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1e36',
  },
  itemActive:     { backgroundColor: '#0d1e38' },
  itemText:       { flex: 1, color: '#c8d8f0', fontSize: 15 },
  itemTextActive: { color: '#60a5fa', fontWeight: '600' },
  check:          { color: '#3b82f6', fontSize: 16, fontWeight: '700', marginLeft: 8 },
  loadingWrap:    { paddingVertical: 40, alignItems: 'center' },
  empty:          { color: '#3d6090', fontSize: 14, textAlign: 'center', padding: 24 },
});
