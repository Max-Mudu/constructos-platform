import { apiClient } from './client';
import { Notification } from '../types';

export const notificationsApi = {
  list: async (params?: { isRead?: boolean; limit?: number; offset?: number }): Promise<{
    notifications: Notification[];
    total:         number;
  }> => {
    const res = await apiClient.get('/notifications', { params });
    return res.data as { notifications: Notification[]; total: number };
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await apiClient.get<{ count: number }>('/notifications/count');
    return res.data.count;
  },

  markRead: async (notificationId: string): Promise<void> => {
    await apiClient.post(`/notifications/${notificationId}/read`);
  },

  markAllRead: async (): Promise<void> => {
    await apiClient.post('/notifications/read-all');
  },

  registerPushToken: async (token: string, platform: 'ios' | 'android' | 'expo'): Promise<void> => {
    await apiClient.post('/notifications/push-token', { token, platform });
  },

  unregisterPushToken: async (token: string): Promise<void> => {
    await apiClient.delete(`/notifications/push-token/${encodeURIComponent(token)}`);
  },
};
