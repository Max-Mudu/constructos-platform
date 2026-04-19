import '../global.css';
import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../src/store/auth.store';
import { getAccessToken, getRefreshToken } from '../src/auth/secureStorage';
import { authApi } from '../src/api/auth';
import { SSEProvider } from '../src/providers/SSEProvider';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const segments = useSegments();
  const { user, setAuth, clearAuth, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
    async function bootstrap() {
      try {
        const [accessToken, refreshToken] = await Promise.all([
          getAccessToken(),
          getRefreshToken(),
        ]);

        if (!accessToken || !refreshToken) {
          await clearAuth();
          return;
        }

        // Try restoring session with a /me call; refresh if needed
        try {
          const me = await authApi.me();
          await setAuth(me, accessToken, refreshToken);
        } catch {
          try {
            const result = await authApi.refresh(refreshToken);
            await setAuth(result.user, result.accessToken, result.refreshToken);
          } catch {
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

    const inAuthGroup = segments[0] === '(auth)' || segments[0] === 'login';
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

function NotificationDeepLink() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);

  useEffect(() => {
    // Handle tap on a notification while app is running or cold-started
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!user) return; // not authenticated yet

      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data) { router.push('/(tabs)/notifications'); return; }

      const { entityType } = data;

      // Route to the relevant tab based on entity type
      switch (entityType) {
        case 'invoice':
          router.push('/(tabs)/invoices');
          break;
        case 'instruction':
          router.push('/(tabs)/instructions');
          break;
        case 'delivery':
          router.push('/(tabs)/deliveries');
          break;
        case 'labour':
          router.push('/(tabs)/labour');
          break;
        case 'attendance':
          router.push('/(tabs)/attendance');
          break;
        default:
          router.push('/(tabs)/notifications');
      }
    });

    return () => sub.remove();
  }, [router, user]);

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
