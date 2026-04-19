import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { notificationsApi } from '../../src/api/notifications';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import { Notification } from '../../src/types';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [markingAll,    setMarkingAll]    = useState(false);

  async function load() {
    try {
      const { notifications: n } = await notificationsApi.list({ limit: 50 });
      setNotifications(n);
    } catch { /* non-fatal */ }
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  // Live updates via SSE
  const handleNewNotification = useCallback((payload: Record<string, unknown>) => {
    const n: Notification = {
      id:         payload['id'] as string,
      companyId:  '',
      userId:     '',
      type:       payload['type']       as string,
      title:      payload['title']      as string,
      body:       payload['body']       as string,
      entityType: payload['entityType'] as string | null ?? null,
      entityId:   payload['entityId']   as string | null ?? null,
      isRead:     false,
      readAt:     null,
      createdAt:  payload['createdAt']  as string,
    };
    setNotifications((prev) => [n, ...prev]);
  }, []);
  useSSEEvent('notification', handleNewNotification);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function markRead(id: string) {
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => n.id === id ? { ...n, isRead: true } : n),
      );
    } catch { /* non-fatal */ }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch { /* non-fatal */ }
    finally { setMarkingAll(false); }
  }

  if (loading) return <LoadingSpinner />;

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.pageTitle}>Notifications</Text>
          {unread > 0 && (
            <Text style={styles.unreadCount}>{unread} unread</Text>
          )}
        </View>
        {unread > 0 && (
          <Button
            title="Mark all read"
            onPress={markAllRead}
            loading={markingAll}
            variant="ghost"
            style={{ height: 32 }}
          />
        )}
      </View>

      {notifications.length === 0
        ? <EmptyState title="No notifications" description="You're all caught up!" />
        : (
          <FlatList
            data={notifications}
            keyExtractor={(n) => n.id}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => void markRead(item.id)} activeOpacity={0.8}>
                <Card style={[styles.notifCard, !item.isRead && styles.unreadCard]}>
                  {!item.isRead && <View style={styles.unreadDot} />}
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  <Text style={styles.notifBody}>{item.body}</Text>
                  <Text style={styles.notifTime}>
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </Card>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
          />
        )
      }
    </Screen>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16 },
  pageTitle:    { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },
  unreadCount:  { color: '#94a3b8', fontSize: 13, marginTop: 2 },

  notifCard:  { marginBottom: 8, paddingLeft: 20 },
  unreadCard: { borderColor: '#3b82f6' },
  unreadDot:  { position: 'absolute', left: 8, top: '50%', width: 6, height: 6, borderRadius: 3, backgroundColor: '#3b82f6' },

  notifTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  notifBody:  { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  notifTime:  { color: '#475569', fontSize: 11 },
});
