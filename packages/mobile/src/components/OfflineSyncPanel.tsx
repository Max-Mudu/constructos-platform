/**
 * What happened to the entries saved on this phone without a connection:
 * how many are waiting, each failed one with its reason and Retry / Dismiss,
 * and a line when entries were synced in the last half hour. Renders nothing
 * when there is nothing to report. Shows all of the signed-in user's queued
 * entries (labour and attendance) wherever it is placed.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { describeEntry, QueueEntry } from '../utils/offlineQueue';

const TYPE_LABEL: Record<QueueEntry['type'], string> = {
  labour_create:     'Labour',
  attendance_create: 'Attendance',
  attendance_self:   'Check-in',
};

function waitingReason(pending: QueueEntry[]): string {
  const reason = pending.find((e) => e.lastError)?.lastError;
  return reason ? `${reason}. Retrying automatically.` : 'Will be sent automatically.';
}

export function OfflineSyncPanel({ onSynced }: { onSynced?: () => void }) {
  const { pending, failed, recentlySynced, lastSyncedAt, isFlushing, flush, retry, dismiss } = useOfflineQueue();

  // Reload the screen's list when entries reach the server.
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen.current !== undefined && lastSyncedAt !== seen.current) onSynced?.();
    seen.current = lastSyncedAt;
  }, [lastSyncedAt, onSynced]);

  if (pending.length === 0 && failed.length === 0 && recentlySynced.length === 0) return null;

  function confirmDismiss(entry: QueueEntry) {
    Alert.alert(
      'Dismiss entry?',
      `${describeEntry(entry)}\n\nIt will be removed from this phone and not sent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => { void dismiss(entry.id).catch(() => Alert.alert('Error', 'Could not dismiss the entry.')); },
        },
      ],
    );
  }

  return (
    <View style={S.root} accessibilityLabel="Offline entries">
      {pending.length > 0 && (
        <View style={[S.box, S.pendingBox]}>
          <View style={S.flex}>
            <Text style={S.pendingTitle}>
              {pending.length} {pending.length === 1 ? 'entry' : 'entries'} waiting to sync
            </Text>
            <Text style={S.sub}>{waitingReason(pending)}</Text>
          </View>
          <TouchableOpacity
            style={S.syncBtn}
            onPress={() => { void flush(); }}
            disabled={isFlushing}
            accessibilityRole="button"
            accessibilityLabel="Sync now"
          >
            {isFlushing
              ? <ActivityIndicator size="small" color="#f59e0b" />
              : <Text style={S.syncText}>Sync now</Text>}
          </TouchableOpacity>
        </View>
      )}

      {failed.map((entry) => (
        <View key={entry.id} style={[S.box, S.failedBox]}>
          <Text style={S.failedTitle}>
            Not synced · {TYPE_LABEL[entry.type]}
          </Text>
          <Text style={S.label}>{describeEntry(entry)}</Text>
          <Text style={S.reason}>{entry.failure?.message ?? 'Could not be sent.'}</Text>
          <View style={S.actions}>
            <TouchableOpacity
              style={S.actionBtn}
              onPress={() => { void retry(entry.id).catch(() => Alert.alert('Error', 'Could not retry the entry.')); }}
              disabled={isFlushing}
              accessibilityRole="button"
              accessibilityLabel={`Retry ${describeEntry(entry)}`}
            >
              <Text style={S.retryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={S.actionBtn}
              onPress={() => confirmDismiss(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${describeEntry(entry)}`}
            >
              <Text style={S.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {pending.length === 0 && failed.length === 0 && recentlySynced.length > 0 && (
        <View style={[S.box, S.syncedBox]}>
          <Text style={S.syncedText}>
            ✓ {recentlySynced.length} offline {recentlySynced.length === 1 ? 'entry' : 'entries'} synced
          </Text>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root:        { paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  box:         { borderRadius: 10, borderWidth: 1, padding: 12 },
  flex:        { flex: 1 },
  pendingBox:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a1200', borderColor: '#92400e' },
  pendingTitle:{ color: '#f59e0b', fontSize: 13, fontWeight: '700' },
  sub:         { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  syncBtn:     { borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 84, alignItems: 'center' },
  syncText:    { color: '#f59e0b', fontSize: 12, fontWeight: '700' },
  failedBox:   { backgroundColor: '#1a0606', borderColor: '#7f1d1d' },
  failedTitle: { color: '#ef4444', fontSize: 13, fontWeight: '700' },
  label:       { color: '#f1f5f9', fontSize: 13, marginTop: 4 },
  reason:      { color: '#fca5a5', fontSize: 12, marginTop: 4 },
  actions:     { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn:   { borderWidth: 1, borderColor: '#334155', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  retryText:   { color: '#60a5fa', fontSize: 12, fontWeight: '700' },
  dismissText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  syncedBox:   { backgroundColor: '#071a0e', borderColor: '#14532d' },
  syncedText:  { color: '#22c55e', fontSize: 12, fontWeight: '700' },
});
