import { apiClient } from './client';
import { AttendanceRecord, AttendanceStatus } from '../types';

export const attendanceApi = {
  list: async (
    projectId: string,
    siteId: string,
    params?: { date?: string; workerId?: string; status?: string },
  ): Promise<AttendanceRecord[]> => {
    const res = await apiClient.get<{ records: AttendanceRecord[] }>(
      `/projects/${projectId}/sites/${siteId}/attendance`,
      { params },
    );
    return res.data.records;
  },

  create: async (
    projectId: string,
    siteId: string,
    data: {
      workerId:     string;
      date:         string;
      status:       AttendanceStatus;
      checkInTime?: string;
      checkOutTime?: string;
      notes?:       string;
    },
  ): Promise<AttendanceRecord> => {
    const res = await apiClient.post<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance`,
      data,
    );
    return res.data.record;
  },

  update: async (
    projectId: string,
    siteId: string,
    recordId: string,
    data: {
      status?:       AttendanceStatus;
      checkInTime?:  string | null;
      checkOutTime?: string | null;
      notes?:        string | null;
    },
  ): Promise<AttendanceRecord> => {
    const res = await apiClient.patch<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance/${recordId}`,
      data,
    );
    return res.data.record;
  },

  // Worker self-service: POST /projects/:projectId/sites/:siteId/attendance/self
  selfAttendance: async (
    projectId: string,
    siteId: string,
    data?: { checkInTime?: string; notes?: string },
  ): Promise<AttendanceRecord> => {
    const res = await apiClient.post<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance/self`,
      data ?? {},
    );
    return res.data.record;
  },
};
