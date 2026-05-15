import { apiClient } from './client';
import { AuthUser, AuthTokens } from '../types';

interface LoginResponse {
  user:         AuthUser;
  accessToken:  string;
  refreshToken: string;
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const url = '/auth/login';
    console.log('[auth] login URL:', (apiClient.defaults.baseURL ?? '') + url);
    console.log('[auth] login payload — email present:', !!email, '| password present:', !!password);
    try {
      const res = await apiClient.post<LoginResponse>(url, { email, password });
      console.log('[auth] login success — userId:', res.data.user?.id, '| role:', res.data.user?.role);
      return res.data;
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: unknown } })?.response;
      console.error('[auth] login error — status:', resp?.status, '| body:', JSON.stringify(resp?.data));
      throw e;
    }
  },

  register: async (data: {
    email:       string;
    password:    string;
    firstName:   string;
    lastName:    string;
    companyName: string;
    currency?:   string;
  }): Promise<LoginResponse> => {
    const res = await apiClient.post<LoginResponse>('/auth/register', data);
    return res.data;
  },

  refresh: async (refreshToken: string): Promise<AuthTokens & { user: AuthUser }> => {
    const res = await apiClient.post('/auth/refresh', { refreshToken });
    return res.data as AuthTokens & { user: AuthUser };
  },

  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post('/auth/logout', { refreshToken });
  },

  me: async (): Promise<AuthUser> => {
    const res = await apiClient.get<{ user: AuthUser }>('/auth/me');
    return res.data.user;
  },
};
