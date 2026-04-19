import { apiClient } from './client';
import { LabourEntry } from '../types';

export interface LabourListParams {
  projectId?:  string;
  siteId?:     string;
  workerId?:   string;
  date?:       string;
  startDate?:  string;
  endDate?:    string;
  search?:     string;
  limit?:      number;
  offset?:     number;
}

export interface LabourListResponse {
  entries:    LabourEntry[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

export const labourApi = {
  list: async (params?: LabourListParams): Promise<LabourListResponse> => {
    const res = await apiClient.get<LabourListResponse>('/labour', { params });
    return res.data;
  },

  create: async (data: {
    projectId:   string;
    siteId:      string;
    workerId:    string;
    date:        string;
    hoursWorked: number;
    dailyRate:   number;
    currency?:   string;
    notes?:      string;
  }): Promise<LabourEntry> => {
    const res = await apiClient.post<{ entry: LabourEntry }>('/labour', data);
    return res.data.entry;
  },
};
