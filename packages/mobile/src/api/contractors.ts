import { apiClient } from './client';
import { Contractor } from '../types';

export const contractorsApi = {
  list: async (params?: { isActive?: boolean }): Promise<Contractor[]> => {
    const res = await apiClient.get<{ contractors: Contractor[] }>('/contractors', { params });
    return res.data.contractors ?? [];
  },
};
