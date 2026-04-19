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
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Badge } from '../../src/components/Badge';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';

// ─── Worker My Day ────────────────────────────────────────────────────────────

function WorkerMyDay() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user)!;

  const [unreadCount, setUnreadCount] = useState(0);
  const [checkedIn,   setCheckedIn]   = useState(false);
  const [checkingIn,  setCheckingIn]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  const now     = new Date();
  const hour    = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today   = now.toLocaleDateString('en-GB', {
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

  // Listen for new notifications via SSE
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
    <Screen scroll>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}, {user.firstName}</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        {unreadCount > 0 && (
          <Badge label={`${unreadCount} alerts`} variant="warning" />
        )}
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Today's Status</Text>
        <Text style={styles.cardSub}>
          {checkedIn ? 'You have checked in today' : 'You have not checked in yet'}
        </Text>
        <Button
          title={checkedIn ? 'Update Attendance' : 'Check In Now'}
          onPress={handleSelfAttendance}
          loading={checkingIn}
          style={{ marginTop: 12 }}
        />
      </Card>

      <Card style={[styles.card, { marginTop: 12 }]}>
        <Text style={styles.cardTitle}>Quick Actions</Text>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => router.push('/(tabs)/attendance')}
        >
          <Text style={styles.actionText}>View Attendance History</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => router.push('/(tabs)/notifications')}
        >
          <Text style={styles.actionText}>Notifications</Text>
          {unreadCount > 0 && <Badge label={String(unreadCount)} variant="warning" />}
        </TouchableOpacity>
      </Card>
    </Screen>
  );
}

// ─── Supervisor / Manager Home ────────────────────────────────────────────────

function SupervisorHome() {
  const router       = useRouter();
  const user         = useAuthStore((s) => s.user)!;
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const now2     = new Date();
  const hour2    = now2.getHours();
  const greeting2 = hour2 < 12 ? 'Good morning' : hour2 < 18 ? 'Good afternoon' : 'Good evening';
  const today    = now2.toLocaleDateString('en-GB', {
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

  const roleLabel = user.role.replace(/_/g, ' ');

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting2}, {user.firstName}</Text>
            <Text style={styles.date}>{today}</Text>
          </View>
          <Badge label={roleLabel} variant="default" />
        </View>

        <Text style={styles.sectionTitle}>Site Management</Text>

        {[
          { label: 'Labour Entries',  route: '/(tabs)/labour'    as const },
          { label: 'Deliveries',      route: '/(tabs)/deliveries' as const },
          { label: 'Attendance',      route: '/(tabs)/attendance' as const },
        ].map((item) => (
          <TouchableOpacity
            key={item.route}
            style={styles.navCard}
            onPress={() => router.push(item.route)}
            activeOpacity={0.75}
          >
            <Text style={styles.navCardText}>{item.label}</Text>
            <Text style={styles.actionArrow}>→</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.navCard, { marginTop: 4 }]}
          onPress={() => router.push('/(tabs)/notifications')}
          activeOpacity={0.75}
        >
          <Text style={styles.navCardText}>Notifications</Text>
          {unread > 0
            ? <Badge label={String(unread)} variant="warning" />
            : <Text style={styles.actionArrow}>→</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return user.role === 'worker' ? <WorkerMyDay /> : <SupervisorHome />;
}

const styles = StyleSheet.create({
  scrollContent: { padding: 16, paddingBottom: 32 },

  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   20,
  },
  greeting: { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },
  date:     { color: '#94a3b8', fontSize: 13, marginTop: 2 },

  card:      { marginBottom: 0 },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardSub:   { color: '#94a3b8', fontSize: 13 },

  sectionTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 8 },

  navCard: {
    backgroundColor: '#1e293b',
    borderRadius:    10,
    padding:         16,
    borderWidth:     1,
    borderColor:     '#334155',
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    marginBottom:    8,
  },
  navCardText: { color: '#f1f5f9', fontSize: 15, fontWeight: '500' },

  actionRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  actionText:  { color: '#f1f5f9', fontSize: 14 },
  actionArrow: { color: '#64748b', fontSize: 16 },
});
