import { apiClient } from './client';
import { Drawing } from '../types';

export const drawingsApi = {
  list: async (
    projectId: string,
    params?: { discipline?: string; status?: string; search?: string },
  ): Promise<Drawing[]> => {
    const res = await apiClient.get<{ drawings: Drawing[] }>(
      `/projects/${projectId}/drawings`,
      { params },
    );
    return res.data.drawings;
  },

  get: async (projectId: string, drawingId: string): Promise<Drawing> => {
    const res = await apiClient.get<{ drawing: Drawing }>(
      `/projects/${projectId}/drawings/${drawingId}`,
    );
    return res.data.drawing;
  },
};
