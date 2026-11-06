import '../global.css';
import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../src/store/auth.store';
import { getAccessToken, getCachedUser, getRefreshToken } from '../src/auth/secureStorage';
import { authApi } from '../src/api/auth';
import { AuthUser } from '../src/types';
import { notificationsApi } from '../src/api/notifications';
import { registerForPushNotifications } from '../src/utils/push';
import { isFirstLaunchOfInstall } from '../src/utils/localData';
import { SSEProvider } from '../src/providers/SSEProvider';

// Display notifications while the app is in the foreground.
// Must be called before any navigator renders; module-level placement guarantees that.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const segments = useSegments();
  const { user, restoreSession, clearAuth, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
    async function bootstrap() {
      try {
        // iOS Keychain outlives an uninstall; never resurrect a session that
        // belonged to a previous install of the app.
        if (await isFirstLaunchOfInstall()) {
          await clearAuth();
          return;
        }

        const [accessToken, refreshToken] = await Promise.all([
          getAccessToken(),
          getRefreshToken(),
        ]);

        if (!accessToken || !refreshToken) {
          await clearAuth();
          return;
        }

        // Restore with /me. An expired access token is refreshed by the axios
        // interceptor inside this call (rotating the stored pair). Do NOT
        // refresh again here or write back the pair read above: re-using a
        // rotated refresh token makes the API revoke every session.
        try {
          const me = await authApi.me();
          await restoreSession(me);
          // Expo push tokens can change (reinstall, OS restore); the API
          // upserts, so re-registering on every restored session is safe.
          void registerForPushNotifications()
            .then((token) => (token ? notificationsApi.registerPushToken(token, 'expo') : undefined))
            .catch(() => { /* non-fatal */ });
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === undefined || status >= 500) {
            // Offline or API down: keep the tokens. Open with the last known
            // profile if there is one; the server re-checks on the next call.
            const cached = await getCachedUser<AuthUser>();
            if (cached) await restoreSession(cached, { offline: true });
          } else {
            // 401 (refresh rejected — interceptor already signed out), 403, …
            await clearAuth();
          }
        }
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const firstSegment = segments[0] as string | undefined;
    const inAuthGroup = firstSegment === '(auth)' || firstSegment === 'login';
    const inTabsGroup = segments[0] === '(tabs)';

    if (!user && inTabsGroup) {
      router.replace('/login');
    } else if (user && (inAuthGroup || !inTabsGroup)) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, segments, router]);

  return <>{children}</>;
}

// ─── Deep link handler ────────────────────────────────────────────────────────

function routeForNotification(data: Record<string, unknown> | undefined) {
  switch (data?.['entityType']) {
    case 'invoice':     return '/(tabs)/invoices' as const;
    case 'instruction': return '/(tabs)/instructions' as const;
    case 'delivery':    return '/(tabs)/deliveries' as const;
    case 'labour':      return '/(tabs)/labour' as const;
    case 'attendance':  return '/(tabs)/attendance' as const;
    default:            return '/(tabs)/notifications' as const;
  }
}

function NotificationDeepLink() {
  const router    = useRouter();
  const user      = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  // Includes the tap that cold-started the app (a listener registered after
  // launch never sees it) as well as taps while running/backgrounded.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledRef   = useRef<string | null>(null);

  useEffect(() => {
    if (!lastResponse || isLoading || !user) return; // route once signed in
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = lastResponse.notification.request.identifier;
    if (handledRef.current === id) return;
    handledRef.current = id;
    router.push(routeForNotification(
      lastResponse.notification.request.content.data as Record<string, unknown> | undefined,
    ));
  }, [lastResponse, isLoading, user, router]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SSEProvider>
          <AuthGuard>
            <NotificationDeepLink />
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </AuthGuard>
        </SSEProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
