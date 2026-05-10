import { apiClient } from './client';
import { Worker } from '../types';

export const workersApi = {
  list: async (): Promise<Worker[]> => {
    const res = await apiClient.get<{ workers: Worker[] }>('/workers');
    return res.data.workers;
  },

  listBySite: async (projectId: string, siteId: string): Promise<Worker[]> => {
    const res = await apiClient.get<{ workers: Worker[] }>(
      `/projects/${projectId}/sites/${siteId}/workers`,
    );
    return res.data.workers;
  },
};
