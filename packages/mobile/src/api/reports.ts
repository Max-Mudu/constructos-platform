import { apiClient } from './client';
import * as FileSystem from 'expo-file-system/legacy';
import { getAccessToken } from '../auth/secureStorage';
import { API_BASE_URL } from '../constants/api';

export type ReportType =
  | 'labour'
  | 'budget'
  | 'invoices'
  | 'deliveries'
  | 'contractors'
  | 'consultants'
  | 'project-health'
  | 'daily-site-report';

export type ReportFormat = 'json' | 'csv' | 'pdf';

export interface ReportFilters {
  projectId?:  string;
  siteId?:     string;
  startDate?:  string;
  endDate?:    string;
}

export interface ReportSummaryItem { label: string; value: string }

export interface ReportData {
  title:       string;
  subtitle:    string;
  generatedAt: string;
  filters:     Record<string, string>;
  summary:     ReportSummaryItem[];
  columns:     string[];
  rows:        string[][];
}

export const reportsApi = {
  /** Fetch report as JSON for in-app display. */
  getJson: async (type: ReportType, filters?: ReportFilters): Promise<ReportData> => {
    const res = await apiClient.get<{ report: ReportData }>(`/reports/${type}`, {
      params: { format: 'json', ...filters },
    });
    return res.data.report;
  },

  /**
   * Downloads a PDF or CSV report to the device cache directory.
   * Returns the local file URI so the caller can open it.
   */
  downloadFile: async (
    type: ReportType,
    format: 'pdf' | 'csv',
    filters?: ReportFilters,
  ): Promise<string> => {
    const ext   = format === 'pdf' ? 'pdf' : 'csv';
    const dest  = FileSystem.cacheDirectory + `${type}-report.${ext}`;

    // Build query string manually — only set defined filter values
    const params = new URLSearchParams({ format });
    if (filters?.projectId)  params.set('projectId',  filters.projectId);
    if (filters?.siteId)     params.set('siteId',      filters.siteId);
    if (filters?.startDate)  params.set('startDate',   filters.startDate);
    if (filters?.endDate)    params.set('endDate',      filters.endDate);
    const url = `${API_BASE_URL}/reports/${type}?${params.toString()}`;

    const download = async () => {
      const token = await getAccessToken();
      return FileSystem.downloadAsync(url, dest, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    };

    let result = await download();
    if (result.status === 401) {
      // downloadAsync bypasses the axios refresh interceptor. One cheap
      // authenticated call lets the interceptor refresh an expired access
      // token (or end the session if the refresh token is invalid); retry once.
      await apiClient.get('/auth/me');
      result = await download();
    }

    if (result.status !== 200) {
      // downloadAsync writes the error body to `dest`; don't leave it behind.
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
      throw new Error(`Failed to download report (${result.status})`);
    }

    return result.uri;
  },
};
