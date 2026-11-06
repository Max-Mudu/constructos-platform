import { create } from 'zustand';
import { AuthUser } from '../types';
import { clearTokens, getAccessToken, saveCachedUser, saveTokens } from '../auth/secureStorage';
import { clearLocalCompanyData } from '../utils/localData';

interface AuthState {
  user:        AuthUser | null;
  accessToken: string | null;
  isLoading:   boolean;

  setAuth:   (user: AuthUser, accessToken: string, refreshToken: string) => Promise<void>;
  /**
   * Adopt a restored session WITHOUT rewriting the stored tokens. The refresh
   * interceptor may have rotated them while the profile was being fetched;
   * writing back a pair read earlier would store a revoked refresh token.
   */
  restoreSession: (user: AuthUser, opts?: { offline?: boolean }) => Promise<void>;
  clearAuth: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setUser:   (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user:        null,
  accessToken: null,
  isLoading:   true,

  setAuth: async (user, accessToken, refreshToken) => {
    await saveTokens(accessToken, refreshToken);
    await saveCachedUser(user);
    set({ user, accessToken, isLoading: false });
  },

  restoreSession: async (user, opts) => {
    const accessToken = await getAccessToken();
    if (!opts?.offline) await saveCachedUser(user);
    set({ user, accessToken, isLoading: false });
  },

  clearAuth: async () => {
    await Promise.all([clearTokens(), clearLocalCompanyData()]);
    set({ user: null, accessToken: null, isLoading: false });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setUser: (user) => {
    void saveCachedUser(user);
    set({ user });
  },
}));
