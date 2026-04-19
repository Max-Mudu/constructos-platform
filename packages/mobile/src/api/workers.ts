import { apiClient } from './client';
import { Worker } from '../types';

export const workersApi = {
  list: async (): Promise<Worker[]> => {
    const res = await apiClient.get<{ workers: Worker[] }>('/workers');
    return res.data.workers;
  },
};
