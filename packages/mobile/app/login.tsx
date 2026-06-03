import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, Alert, TextInput, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useAuthStore } from '../src/store/auth.store';
import { authApi } from '../src/api/auth';
import { notificationsApi } from '../src/api/notifications';

// ─── Push notification registration ───────────────────────────────────────────

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  // Pass projectId explicitly so token registration works in development builds
  // and EAS managed builds. The value comes from app.json extra.eas.projectId.
  const projectId =
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? undefined;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenData.data;
}

// ─── Login screen ─────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const router  = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState<{ email?: string; password?: string }>({});
  const [focused,  setFocused]  = useState<'email' | 'password' | null>(null);

  // ── Forgot password ───────────────────────────────────────────────
  function handleForgotPassword() {
    const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
    if (webUrl) {
      void Linking.openURL(`${webUrl}/forgot-password`);
    } else {
      Alert.alert(
        'Reset Password',
        'Contact your company administrator to reset your password, or visit the web app.',
      );
    }
  }

  // ── Validation (unchanged) ─────────────────────────────────────────
  function validate() {
    const e: typeof errors = {};
    if (!email.trim())    e.email    = 'Email is required';
    if (!password.trim()) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Login handler (unchanged) ──────────────────────────────────────
  async function handleLogin() {
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await authApi.login(email.trim().toLowerCase(), password);
      await setAuth(result.user, result.accessToken, result.refreshToken);

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
      style={L.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={L.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── BRAND HEADER ──────────────────────────────────────────── */}
        <View style={L.brand}>
          <View style={L.logoWrap}>
            <View style={L.logoOuter}>
              <View style={L.logoInner}>
                <Text style={L.logoLetter}>C</Text>
              </View>
            </View>
          </View>
          <Text style={L.appName}>ConstructOS</Text>
          <Text style={L.appTagline}>Precision Operations Management</Text>
          <View style={L.taglinePill}>
            <View style={L.taglineDot} />
            <Text style={L.taglinePillText}>Enterprise Construction Platform</Text>
          </View>
        </View>

        {/* ── LOGIN CARD ────────────────────────────────────────────── */}
        <View style={L.card}>
          <View style={L.cardHeader}>
            <Text style={L.cardTitle}>Welcome back</Text>
            <Text style={L.cardSub}>Sign in to your workspace</Text>
          </View>

          {/* Email */}
          <View style={L.fieldGroup}>
            <Text style={L.fieldLabel}>Work Email</Text>
            <View style={[L.inputWrap, focused === 'email' ? L.inputWrapFocused : null, errors.email ? L.inputWrapError : null]}>
              <TextInput
                style={L.input}
                value={email}
                onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: undefined })); }}
                placeholder="you@company.com"
                placeholderTextColor="#1e3a5f"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                editable={!loading}
              />
            </View>
            {errors.email ? <Text style={L.fieldError}>{errors.email}</Text> : null}
          </View>

          {/* Password */}
          <View style={L.fieldGroup}>
            <View style={L.fieldLabelRow}>
              <Text style={L.fieldLabel}>Password</Text>
              <TouchableOpacity onPress={handleForgotPassword}>
                <Text style={L.forgotLink}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={[L.inputWrap, focused === 'password' ? L.inputWrapFocused : null, errors.password ? L.inputWrapError : null]}>
              <TextInput
                style={L.input}
                value={password}
                onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: undefined })); }}
                placeholder="••••••••"
                placeholderTextColor="#1e3a5f"
                secureTextEntry
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                editable={!loading}
              />
            </View>
            {errors.password ? <Text style={L.fieldError}>{errors.password}</Text> : null}
          </View>

          {/* Login button */}
          <TouchableOpacity
            style={[L.loginBtn, loading && L.loginBtnLoading]}
            onPress={() => void handleLogin()}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={L.loginBtnText}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={L.divider}>
            <View style={L.dividerLine} />
            <Text style={L.dividerText}>or</Text>
            <View style={L.dividerLine} />
          </View>

          {/* Request Access */}
          <TouchableOpacity
            style={L.accessBtn}
            onPress={() => Alert.alert('Request Access', 'Contact your company administrator to create an account.')}
            activeOpacity={0.8}
          >
            <Text style={L.accessBtnText}>Request Access</Text>
          </TouchableOpacity>
        </View>

        {/* ── FEATURE PILLS ─────────────────────────────────────────── */}
        <View style={L.pillsRow}>
          {[
            { icon: '🏗', label: 'Site Management' },
            { icon: '📋', label: 'Real-time Ops' },
            { icon: '👷', label: 'Field Ready' },
          ].map((p) => (
            <View key={p.label} style={L.pill}>
              <Text style={L.pillIcon}>{p.icon}</Text>
              <Text style={L.pillText}>{p.label}</Text>
            </View>
          ))}
        </View>

        {/* ── FOOTER ────────────────────────────────────────────────── */}
        <Text style={L.footer}>ConstructOS · Site Management Platform</Text>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const L = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },

  // ── Brand header ──────────────────────────────────────────────────
  brand: { alignItems: 'center', marginBottom: 32 },

  logoWrap: { marginBottom: 18 },
  logoOuter: {
    width: 76, height: 76,
    borderRadius: 20,
    backgroundColor: '#0a1e3d',
    borderWidth: 1,
    borderColor: '#1e3a6e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInner: {
    width: 54, height: 54,
    borderRadius: 14,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },

  appName: {
    color: '#e8f0fe',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 5,
  },
  appTagline: {
    color: '#3d6090',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginBottom: 14,
  },
  taglinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#081628',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#12294a',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  taglineDot:      { width: 5, height: 5, borderRadius: 3, backgroundColor: '#1d4ed8' },
  taglinePillText: { color: '#2d5a9e', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },

  // ── Card ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#0a1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#142240',
    padding: 24,
    marginBottom: 20,
  },

  cardHeader:  { marginBottom: 22 },
  cardTitle:   { color: '#e8f0fe', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  cardSub:     { color: '#2d5070', fontSize: 13 },

  // ── Fields ────────────────────────────────────────────────────────
  fieldGroup: { marginBottom: 16 },

  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  fieldLabel: {
    color: '#3d6090',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 7,
  },
  forgotLink: { color: '#2563eb', fontSize: 12, fontWeight: '500' },

  inputWrap: {
    backgroundColor: '#060e1c',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#112036',
    paddingHorizontal: 14,
    height: 48,
    justifyContent: 'center',
  },
  inputWrapFocused: { borderColor: '#2563eb', backgroundColor: '#070f1e' },
  inputWrapError:   { borderColor: '#7f1d1d' },

  input: {
    color: '#d0e0f5',
    fontSize: 15,
    fontWeight: '400',
    padding: 0,
  },
  fieldError: { color: '#ef4444', fontSize: 11, marginTop: 5, fontWeight: '500' },

  // ── Login button ──────────────────────────────────────────────────
  loginBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 11,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  loginBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Divider ───────────────────────────────────────────────────────
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 18,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#0f2040' },
  dividerText: { color: '#1e3a5f', fontSize: 12, fontWeight: '600' },

  // ── Request Access button ─────────────────────────────────────────
  accessBtn: {
    borderRadius: 11,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#142240',
    backgroundColor: '#070e1c',
  },
  accessBtnText: { color: '#2d5a9e', fontSize: 15, fontWeight: '600' },

  // ── Feature pills ─────────────────────────────────────────────────
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#070e1c',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0f1e35',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillIcon: { fontSize: 12 },
  pillText: { color: '#1e3a5f', fontSize: 11, fontWeight: '600' },

  // ── Footer ────────────────────────────────────────────────────────
  footer: {
    color: '#0f2040',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
});
