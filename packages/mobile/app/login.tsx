import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useAuthStore } from '../src/store/auth.store';
import { authApi } from '../src/api/auth';
import { notificationsApi } from '../src/api/notifications';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
}

export default function LoginScreen() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState<{ email?: string; password?: string }>({});

  function validate() {
    const e: typeof errors = {};
    if (!email.trim())    e.email    = 'Email is required';
    if (!password.trim()) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await authApi.login(email.trim().toLowerCase(), password);
      await setAuth(result.user, result.accessToken, result.refreshToken);

      // Register push token silently in background
      try {
        const pushToken = await registerForPushNotifications();
        if (pushToken) {
          await notificationsApi.registerPushToken(pushToken, 'expo');
        }
      } catch {
        // Non-fatal — push registration failure should not block login
      }

      router.replace('/(tabs)');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Login failed. Please check your credentials.';
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoRow}>
          <View style={styles.logoBox}>
            <Text style={styles.logoLetter}>C</Text>
          </View>
          <View>
            <Text style={styles.appName}>ConstructOS</Text>
            <Text style={styles.appTagline}>Field Management</Text>
          </View>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.heading}>Sign in to your account</Text>
          <Text style={styles.sub}>Enter your work email and password</Text>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.email}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              error={errors.password}
            />
            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={loading}
              style={styles.submitBtn}
            />
          </View>
        </View>

        <Text style={styles.footer}>ConstructOS — Site Management Platform</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f172a' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 40 },
  logoBox: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { color: '#fff', fontSize: 22, fontWeight: '700' },
  appName:    { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  appTagline: { color: '#94a3b8', fontSize: 13, marginTop: 1 },

  card: {
    backgroundColor: '#1e293b',
    borderRadius:    16,
    padding:         24,
    borderWidth:     1,
    borderColor:     '#334155',
  },
  heading: { color: '#f1f5f9', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sub:     { color: '#94a3b8', fontSize: 14, marginBottom: 24 },
  form:    { gap: 0 },
  submitBtn: { marginTop: 8 },

  footer: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 32 },
});
