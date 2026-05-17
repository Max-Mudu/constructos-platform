import { apiClient } from './client';
import { SiteInventoryItem, SiteInventoryItemDetail } from '../types';

export const inventoryApi = {
  list: async (projectId: string, siteId: string): Promise<SiteInventoryItem[]> => {
    if (!projectId || !siteId) return [];
    const res = await apiClient.get<{ inventory: SiteInventoryItem[] }>(
      `/projects/${projectId}/sites/${siteId}/inventory`,
    );
    return Array.isArray(res.data?.inventory) ? res.data.inventory : [];
  },

  get: async (
    projectId: string,
    siteId: string,
    inventoryId: string,
  ): Promise<SiteInventoryItemDetail> => {
    const res = await apiClient.get<{ item: SiteInventoryItemDetail }>(
      `/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}`,
    );
    return res.data.item;
  },

  recordUsage: async (
    projectId:   string,
    siteId:      string,
    inventoryId: string,
    body: {
      quantity:        number;
      note?:           string;
      usageReason?:    string;
      workArea?:       string;
      scheduleTaskId?: string;
    },
  ): Promise<SiteInventoryItem> => {
    const res = await apiClient.post<{ item: SiteInventoryItem }>(
      `/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}/use`,
      body,
    );
    return res.data.item;
  },

  updateThreshold: async (
    projectId:   string,
    siteId:      string,
    inventoryId: string,
    threshold:   number | null,
  ): Promise<SiteInventoryItem> => {
    const res = await apiClient.patch<{ item: SiteInventoryItem }>(
      `/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}`,
      { lowStockThreshold: threshold },
    );
    return res.data.item;
  },
};
