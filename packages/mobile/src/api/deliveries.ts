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
    const res = await apiClient.get<{ records: DeliveryRecord[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }>('/deliveries', { params });
    return res.data;
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
    acceptanceStatus:   string;
    notes?:             string;
    supplierId?:        string;
  }): Promise<DeliveryRecord> => {
    const res = await apiClient.post<{ record: DeliveryRecord }>('/deliveries', data);
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
