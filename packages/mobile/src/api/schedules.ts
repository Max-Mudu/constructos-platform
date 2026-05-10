import { apiClient } from './client';
import { ScheduleTask, ScheduleTaskStatus } from '../types';

export interface CreateTaskInput {
  contractorId:       string;
  title:              string;
  description?:       string;
  area?:              string;
  materialsRequired?: string;
  equipmentRequired?: string;
  plannedStartDate?:  string;
  plannedEndDate?:    string;
}

export interface UpdateTaskInput {
  status?:          ScheduleTaskStatus;
  actualProgress?:  number | null;
  delayReason?:     string | null;
  comments?:        string | null;
}

type ScheduleListResponse =
  | { tasks: ScheduleTask[] }
  | { data: ScheduleTask[] }
  | { schedules: ScheduleTask[] }
  | ScheduleTask[];

function normalizeScheduleResponse(data: ScheduleListResponse): ScheduleTask[] {
  if (Array.isArray(data)) return data;
  if ('tasks' in data && Array.isArray(data.tasks)) return data.tasks;
  if ('data' in data && Array.isArray(data.data)) return data.data;
  if ('schedules' in data && Array.isArray(data.schedules)) return data.schedules;
  return [];
}

export const schedulesApi = {
  listTasks: async (
    projectId: string,
    siteId: string,
    params?: {
      status?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ScheduleTask[]> => {
    const possiblePaths = [
      `/projects/${projectId}/sites/${siteId}/schedule/tasks`,
      `/projects/${projectId}/sites/${siteId}/schedules/tasks`,
      `/projects/${projectId}/sites/${siteId}/schedule`,
      `/projects/${projectId}/sites/${siteId}/schedules`,
    ];

    for (const path of possiblePaths) {
      try {
        const res = await apiClient.get<ScheduleListResponse>(path, { params });
        return normalizeScheduleResponse(res.data);
      } catch {
        // Try next possible schedule route.
      }
    }

    return [];
  },

  createTask: async (
    projectId: string,
    siteId: string,
    data: CreateTaskInput,
  ): Promise<ScheduleTask> => {
    const res = await apiClient.post<{ task: ScheduleTask }>(
      `/projects/${projectId}/sites/${siteId}/schedule/tasks`,
      data,
    );
    return res.data.task;
  },

  updateTask: async (
    projectId: string,
    siteId: string,
    taskId: string,
    data: UpdateTaskInput,
  ): Promise<ScheduleTask> => {
    const res = await apiClient.patch<{ task: ScheduleTask }>(
      `/projects/${projectId}/sites/${siteId}/schedule/tasks/${taskId}`,
      data,
    );
    return res.data.task;
  },
};
