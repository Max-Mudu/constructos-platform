import { apiClient, revokeServerSession } from './client';
import { LogoutOutcome } from './logoutFlow';
import { AuthUser, AuthTokens } from '../types';

interface LoginResponse {
  user:         AuthUser;
  accessToken:  string;
  refreshToken: string;
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const res = await apiClient.post<LoginResponse>('/auth/login', { email, password });
    return res.data;
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
    const res = await apiClient.post<AuthTokens & { user: AuthUser }>('/auth/refresh', { refreshToken });
    return res.data;
  },

  /**
   * Revoke this device's session on the server, refreshing once if the access
   * token has expired. Never throws; clear local tokens afterwards regardless.
   */
  logout: (): Promise<LogoutOutcome> => revokeServerSession(),

  me: async (): Promise<AuthUser> => {
    const res = await apiClient.get<{ user: AuthUser }>('/auth/me');
    return res.data.user;
  },

  updateDefaults: async (data: {
    defaultProjectId: string | null;
    defaultSiteId:    string | null;
  }): Promise<AuthUser> => {
    const res = await apiClient.patch<{ user: AuthUser }>('/auth/me/defaults', data);
    return res.data.user;
  },
};
