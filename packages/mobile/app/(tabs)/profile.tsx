import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../../src/store/auth.store';
import { authApi } from '../../src/api/auth';
import { notificationsApi } from '../../src/api/notifications';
import { getRefreshToken } from '../../src/auth/secureStorage';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Badge } from '../../src/components/Badge';

export default function ProfileScreen() {
  const router   = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  const roleLabel = user.role.replace(/_/g, ' ');

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
              // Unregister push token before logging out
              try {
                const tokenData = await Notifications.getExpoPushTokenAsync();
                await notificationsApi.unregisterPushToken(tokenData.data);
              } catch {
                // Non-fatal
              }

              const refreshToken = await getRefreshToken();
              if (refreshToken) {
                await authApi.logout(refreshToken).catch(() => {});
              }
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

  return (
    <Screen scroll>
      {/* Avatar + name */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.fullName}>{user.firstName} {user.lastName}</Text>
        <Text style={styles.email}>{user.email}</Text>
        <Badge label={roleLabel} variant="default" />
      </View>

      {/* Info card */}
      <Card style={styles.infoCard}>
        <InfoRow label="Role"  value={roleLabel} />
        <InfoRow label="Email" value={user.email} />
        {user.canViewFinance && (
          <InfoRow label="Finance Access" value="Enabled" valueColor="#22c55e" />
        )}
      </Card>

      {/* Actions */}
      <Card style={[styles.infoCard, { marginTop: 12 }]}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Button
          title="Log Out"
          onPress={handleLogout}
          variant="destructive"
          loading={loggingOut}
          style={{ marginTop: 8 }}
        />
      </Card>

      <Text style={styles.version}>ConstructOS v1.0.0</Text>
    </Screen>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  label: { color: '#94a3b8', fontSize: 14 },
  value: { color: '#f1f5f9', fontSize: 14, fontWeight: '500', textAlign: 'right', flex: 1, marginLeft: 8 },
});

const styles = StyleSheet.create({
  avatarSection: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1e3a5f',
    borderWidth: 2, borderColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  avatarText: { color: '#3b82f6', fontSize: 26, fontWeight: '700' },
  fullName:   { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  email:      { color: '#94a3b8', fontSize: 14 },

  infoCard:     { marginBottom: 0 },
  sectionTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },

  version: { color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 32 },
});
