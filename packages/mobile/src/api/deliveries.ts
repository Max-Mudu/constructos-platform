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
    const empty = { records: [], pagination: { total: 0, limit: 0, offset: 0, hasMore: false } };
    if (!params?.projectId || !params.siteId) return empty;
    // GET /api/v1/deliveries (mobile.routes) applies projectId/siteId scope,
    // supplier search, date, acceptanceStatus and limit/offset server-side and
    // includes photos. The site route ignores every query param and returns
    // records without `photos`.
    const res = await apiClient.get<{
      records:     DeliveryRecord[];
      pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
    }>('/deliveries', { params });
    const records = (Array.isArray(res.data?.records) ? res.data.records : [])
      .map((r) => ({ ...r, photos: Array.isArray(r.photos) ? r.photos : [] }));
    return {
      records,
      pagination: res.data.pagination ?? { total: records.length, limit: records.length, offset: 0, hasMore: false },
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
    // API responds 201 { delivery }.
    const res = await apiClient.post<{ delivery: DeliveryRecord }>(
      `/projects/${projectId}/sites/${siteId}/deliveries`,
      body,
    );
    return res.data.delivery;
  },

  /** POST /projects/:projectId/sites/:siteId/deliveries/:deliveryId/photos (multipart, field "file"). */
  uploadPhoto: async (
    projectId:  string,
    siteId:     string,
    deliveryId: string,
    fileUri:    string,
    mimeType = 'image/jpeg',
  ): Promise<unknown> => {
    return uploadFile(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/photos`,
      fileUri,
      'file',
      mimeType,
    );
  },
};
