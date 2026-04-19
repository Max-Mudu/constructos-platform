import { create } from 'zustand';
import { AuthUser } from '../types';
import { clearTokens, saveTokens } from '../auth/secureStorage';

interface AuthState {
  user:        AuthUser | null;
  accessToken: string | null;
  isLoading:   boolean;

  setAuth:   (user: AuthUser, accessToken: string, refreshToken: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user:        null,
  accessToken: null,
  isLoading:   true,

  setAuth: async (user, accessToken, refreshToken) => {
    await saveTokens(accessToken, refreshToken);
    set({ user, accessToken, isLoading: false });
  },

  clearAuth: async () => {
    await clearTokens();
    set({ user: null, accessToken: null, isLoading: false });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));
