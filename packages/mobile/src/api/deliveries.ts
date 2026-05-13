import { apiClient, uploadFile } from './client';
import { DeliveryRecord } from '../types';

export const deliveriesApi = {
  list: async (params?: {
    projectId?:        string;
    siteId?:           string;
    date?:             string;
    search?:           string;
    acceptanceStatus?: string;
    limit?:            number;
    offset?:           number;
  }): Promise<{ records: DeliveryRecord[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> => {
    const { projectId, siteId, ...rest } = params ?? {};
    if (!projectId || !siteId) return { records: [], pagination: { total: 0, limit: 0, offset: 0, hasMore: false } };
    console.log('[deliveriesApi.list] GET', `/projects/${projectId}/sites/${siteId}/deliveries`, rest);
    const res = await apiClient.get<{ deliveries: DeliveryRecord[] }>(
      `/projects/${projectId}/sites/${siteId}/deliveries`,
      { params: rest },
    );
    console.log('[deliveriesApi.list] raw response keys:', Object.keys(res.data ?? {}));
    const deliveries = Array.isArray(res.data?.deliveries) ? res.data.deliveries : [];
    console.log('[deliveriesApi.list] deliveries count:', deliveries.length);
    return {
      records:    deliveries,
      pagination: { total: deliveries.length, limit: deliveries.length, offset: 0, hasMore: false },
    };
  },

  create: async (data: {
    projectId:          string;
    siteId:             string;
    supplierName:       string;
    deliveryDate:       string;
    itemDescription:    string;
    quantityOrdered:    number;
    quantityDelivered:  number;
    unitOfMeasure:      string;
    conditionOnArrival: string;
    receivedById:       string;
    acceptanceStatus?:  string;
    comments?:          string;
    supplierId?:        string;
  }): Promise<DeliveryRecord> => {
    const { projectId, siteId, ...body } = data;
    const res = await apiClient.post<{ record: DeliveryRecord }>(
      `/projects/${projectId}/sites/${siteId}/deliveries`,
      body,
    );
    return res.data.record;
  },

  uploadPhoto: async (deliveryId: string, fileUri: string): Promise<unknown> => {
    return uploadFile(
      `/deliveries/${deliveryId}/photos`,
      fileUri,
      'photo',
      'image/jpeg',
    );
  },
};
