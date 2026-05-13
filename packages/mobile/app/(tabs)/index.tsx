/**
 * Home / My Day screen
 * Worker: shows today's attendance status + quick check-in
 * Supervisor/PM/Admin: shows today's summary links
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';
import { notificationsApi } from '../../src/api/notifications';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';

const ROLE_LABEL: Record<string, string> = {
  company_admin:   'Company Admin',
  project_manager: 'Project Manager',
  site_supervisor: 'Site Supervisor',
  finance_officer: 'Finance Officer',
  consultant:      'Consultant',
  contractor:      'Contractor',
  worker:          'Worker',
  viewer:          'Viewer',
};

// ─── Worker My Day ────────────────────────────────────────────────────────────

function WorkerMyDay() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user)!;

  const [unreadCount, setUnreadCount] = useState(0);
  const [checkedIn,   setCheckedIn]   = useState(false);
  const [checkingIn,  setCheckingIn]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  const now      = new Date();
  const hour     = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today    = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  async function loadUnread() {
    try {
      const count = await notificationsApi.getUnreadCount();
      setUnreadCount(count);
    } catch { /* non-fatal */ }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadUnread();
    setRefreshing(false);
  }

  useEffect(() => { void loadUnread(); }, []);

  const handleNotification = useCallback(() => {
    setUnreadCount((c) => c + 1);
  }, []);
  useSSEEvent('notification', handleNotification);

  async function handleSelfAttendance() {
    Alert.alert(
      'Check In',
      'Mark yourself as present for today?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check In',
          onPress: async () => {
            setCheckingIn(true);
            try {
              // For self-attendance we need a projectId + siteId.
              // In a real flow the worker selects their active site.
              // Navigate to the self-attendance screen for full selection.
              router.push('/(tabs)/attendance');
            } finally {
              setCheckingIn(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={H.root}>
      {/* ── App bar ──────────────────────────────────────────────────────── */}
      <View style={H.appBar}>
        <Text style={H.appBarTitle}>My Day</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity
            style={H.notifBadge}
            onPress={() => router.push('/(tabs)/notifications')}
            activeOpacity={0.8}
          >
            <Text style={H.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        style={H.scroll}
        contentContainerStyle={H.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {/* ── Greeting ─────────────────────────────────────────────────── */}
        <View style={H.greetingWrap}>
          <Text style={H.greetingText}>{greeting}, {user.firstName ?? 'there'}</Text>
          <Text style={H.greetingDate}>{today}</Text>
          <View style={H.rolePill}>
            <Text style={H.rolePillText}>{ROLE_LABEL[user.role] ?? user.role}</Text>
          </View>
        </View>

        {/* ── Today's Attendance card ───────────────────────────────────── */}
        <View style={H.card}>
          <Text style={H.cardLabel}>TODAY'S ATTENDANCE</Text>
          <View style={H.statusRow}>
            <View style={checkedIn ? H.statusDotGreen : H.statusDotAmber} />
            <Text style={H.statusText}>
              {checkedIn ? 'Checked In' : 'Not Checked In'}
            </Text>
          </View>
          <Text style={H.statusSub}>
            {checkedIn
              ? 'Your attendance has been recorded for today.'
              : 'You have not checked in yet for today.'}
          </Text>
          <TouchableOpacity
            style={checkingIn ? [H.checkInBtn, H.checkInBtnLoading] : H.checkInBtn}
            onPress={() => void handleSelfAttendance()}
            disabled={checkingIn}
            activeOpacity={0.85}
          >
            <Text style={H.checkInBtnText}>
              {checkingIn ? 'Opening…' : checkedIn ? 'Update Attendance' : 'Check In Now'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Quick Actions card ────────────────────────────────────────── */}
        <View style={H.card}>
          <Text style={H.cardLabel}>QUICK ACTIONS</Text>

          <TouchableOpacity
            style={H.actionRow}
            onPress={() => router.push('/(tabs)/attendance')}
            activeOpacity={0.7}
          >
            <Text style={H.actionIcon}>📋</Text>
            <Text style={H.actionText}>View Attendance History</Text>
            <Text style={H.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[H.actionRow, H.actionRowLast]}
            onPress={() => router.push('/(tabs)/notifications')}
            activeOpacity={0.7}
          >
            <Text style={H.actionIcon}>🔔</Text>
            <Text style={H.actionText}>Notifications</Text>
            {unreadCount > 0 ? (
              <View style={H.inlineNotifBadge}>
                <Text style={H.inlineNotifText}>{unreadCount}</Text>
              </View>
            ) : (
              <Text style={H.chevron}>›</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Supervisor / Manager Home ────────────────────────────────────────────────

function SupervisorHome() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user)!;
  const [unread,     setUnread]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const now2      = new Date();
  const hour2     = now2.getHours();
  const greeting2 = hour2 < 12 ? 'Good morning' : hour2 < 18 ? 'Good afternoon' : 'Good evening';
  const today     = now2.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  async function loadData() {
    try {
      setUnread(await notificationsApi.getUnreadCount());
    } catch { /* non-fatal */ }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  useEffect(() => { void loadData(); }, []);

  const handleNotification = useCallback(() => { setUnread((c) => c + 1); }, []);
  useSSEEvent('notification', handleNotification);

  const roleLabel = ROLE_LABEL[user.role] ?? user.role.replace(/_/g, ' ');

  const siteLinks: { icon: string; label: string; route: '/(tabs)/labour' | '/(tabs)/deliveries' | '/(tabs)/attendance' }[] = [
    { icon: '👷', label: 'Labour Entries', route: '/(tabs)/labour'     },
    { icon: '📦', label: 'Deliveries',     route: '/(tabs)/deliveries' },
    { icon: '✅', label: 'Attendance',     route: '/(tabs)/attendance' },
  ];

  return (
    <View style={H.root}>
      {/* ── App bar ──────────────────────────────────────────────────────── */}
      <View style={H.appBar}>
        <Text style={H.appBarTitle}>My Day</Text>
        <View style={H.rolePillAppBar}>
          <Text style={H.rolePillAppBarText}>{roleLabel}</Text>
        </View>
      </View>

      <ScrollView
        style={H.scroll}
        contentContainerStyle={H.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {/* ── Greeting ─────────────────────────────────────────────────── */}
        <View style={H.greetingWrap}>
          <Text style={H.greetingText}>{greeting2}, {user.firstName ?? 'there'}</Text>
          <Text style={H.greetingDate}>{today}</Text>
        </View>

        {/* ── Site Management ───────────────────────────────────────────── */}
        <Text style={H.sectionLabel}>SITE MANAGEMENT</Text>
        <View style={H.card}>
          {siteLinks.map((item, idx) => (
            <TouchableOpacity
              key={item.route}
              style={idx === siteLinks.length - 1 ? [H.actionRow, H.actionRowLast] : H.actionRow}
              onPress={() => router.push(item.route)}
              activeOpacity={0.7}
            >
              <Text style={H.actionIcon}>{item.icon}</Text>
              <Text style={H.actionText}>{item.label}</Text>
              <Text style={H.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Communications ────────────────────────────────────────────── */}
        <Text style={H.sectionLabel}>COMMUNICATIONS</Text>
        <View style={H.card}>
          <TouchableOpacity
            style={[H.actionRow, H.actionRowLast]}
            onPress={() => router.push('/(tabs)/notifications')}
            activeOpacity={0.7}
          >
            <Text style={H.actionIcon}>🔔</Text>
            <Text style={H.actionText}>Notifications</Text>
            {unread > 0 ? (
              <View style={H.inlineNotifBadge}>
                <Text style={H.inlineNotifText}>{unread}</Text>
              </View>
            ) : (
              <Text style={H.chevron}>›</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return user.role === 'worker' ? <WorkerMyDay /> : <SupervisorHome />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const H = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#060d1b' },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },

  // App bar
  appBar: {
    backgroundColor:    '#060d1b',
    borderBottomWidth:  1,
    borderBottomColor:  '#0e1f38',
    paddingTop:         56,
    paddingBottom:      14,
    paddingHorizontal:  20,
    flexDirection:      'row',
    alignItems:         'center',
    justifyContent:     'space-between',
  },
  appBarTitle: {
    color:         '#e8f0fe',
    fontSize:      20,
    fontWeight:    '700',
    letterSpacing: -0.3,
  },

  // Notification badge in app bar (worker view)
  notifBadge: {
    backgroundColor: '#991b1b',
    borderRadius:    12,
    minWidth:        24,
    height:          24,
    paddingHorizontal: 7,
    alignItems:      'center',
    justifyContent:  'center',
  },
  notifBadgeText: { color: '#fca5a5', fontSize: 11, fontWeight: '700' },

  // Role pill in app bar (supervisor view)
  rolePillAppBar: {
    backgroundColor: '#0e1e36',
    borderRadius:    20,
    borderWidth:     1,
    borderColor:     '#1e3a6e',
    paddingHorizontal: 12,
    paddingVertical:   4,
  },
  rolePillAppBarText: { color: '#60a5fa', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  // Greeting section
  greetingWrap: { marginTop: 24, marginBottom: 20 },
  greetingText: {
    color:         '#e8f0fe',
    fontSize:      24,
    fontWeight:    '700',
    letterSpacing: -0.4,
    marginBottom:  4,
  },
  greetingDate: {
    color:        '#3d6090',
    fontSize:     13,
    fontWeight:   '500',
    marginBottom: 12,
  },
  rolePill: {
    alignSelf:       'flex-start',
    backgroundColor: '#0e1e36',
    borderRadius:    20,
    borderWidth:     1,
    borderColor:     '#1e3a6e',
    paddingHorizontal: 12,
    paddingVertical:   4,
  },
  rolePillText: { color: '#60a5fa', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  // Section label (supervisor view)
  sectionLabel: {
    color:         '#3d6090',
    fontSize:      11,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginBottom:  8,
    marginTop:     4,
  },

  // Card container
  card: {
    backgroundColor:  '#0a1628',
    borderRadius:     16,
    borderWidth:      1,
    borderColor:      '#142240',
    paddingHorizontal: 16,
    paddingTop:       14,
    paddingBottom:    4,
    marginBottom:     16,
  },
  cardLabel: {
    color:         '#3d6090',
    fontSize:      11,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginBottom:  12,
  },

  // Attendance status
  statusRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    marginBottom:  6,
  },
  statusDotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e' },
  statusDotAmber: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#f59e0b' },
  statusText:     { color: '#e8f0fe', fontSize: 16, fontWeight: '600' },
  statusSub:      { color: '#3d6090', fontSize: 13, marginBottom: 16 },

  // Check-in button
  checkInBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius:    11,
    height:          48,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    14,
    borderWidth:     1,
    borderColor:     '#2563eb',
  },
  checkInBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  checkInBtnText:    { color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  // Action rows inside cards
  actionRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1e36',
    gap:               12,
  },
  actionRowLast: { borderBottomWidth: 0 },
  actionIcon:    { fontSize: 16, width: 22, textAlign: 'center' },
  actionText:    { color: '#c8d8f0', fontSize: 14, fontWeight: '500', flex: 1 },
  chevron:       { color: '#1e3a5f', fontSize: 20, fontWeight: '300' },

  // Inline notification badge (inside action rows)
  inlineNotifBadge: {
    backgroundColor: '#991b1b',
    borderRadius:    10,
    minWidth:        20,
    height:          20,
    paddingHorizontal: 6,
    alignItems:      'center',
    justifyContent:  'center',
  },
  inlineNotifText: { color: '#fca5a5', fontSize: 11, fontWeight: '700' },
});
