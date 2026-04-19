import { apiClient } from './client';
import * as FileSystem from 'expo-file-system';
import { getAccessToken } from '../auth/secureStorage';

export type ReportType =
  | 'labour'
  | 'budget'
  | 'invoices'
  | 'deliveries'
  | 'contractors'
  | 'consultants'
  | 'project-health';

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

const BASE_URL = (process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000/api/v1').replace(/\/api\/v1$/, '');

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
    const token = await getAccessToken();
    const ext   = format === 'pdf' ? 'pdf' : 'csv';
    const dest  = FileSystem.cacheDirectory + `${type}-report.${ext}`;

    // Build query string manually
    const params = new URLSearchParams({ format, ...(filters as Record<string, string>) });
    const url = `${BASE_URL}/api/v1/reports/${type}?${params.toString()}`;

    const result = await FileSystem.downloadAsync(url, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (result.status !== 200) {
      throw new Error(`Failed to download report (${result.status})`);
    }

    return result.uri;
  },
};
