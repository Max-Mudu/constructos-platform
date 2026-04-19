import { apiClient } from './client';
import { DashboardStats } from '../types';

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const res = await apiClient.get<{ stats: DashboardStats }>('/dashboard');
    return res.data.stats;
  },
};
