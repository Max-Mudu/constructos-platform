import { apiClient } from './client';
import { Invoice } from '../types';

export const invoicesApi = {
  list: async (params?: { projectId?: string; status?: string }): Promise<Invoice[]> => {
    const res = await apiClient.get<{ invoices: Invoice[] }>('/invoices', { params });
    return res.data.invoices;
  },

  get: async (invoiceId: string): Promise<Invoice> => {
    const res = await apiClient.get<{ invoice: Invoice }>(`/invoices/${invoiceId}`);
    return res.data.invoice;
  },

  approve: async (invoiceId: string): Promise<Invoice> => {
    const res = await apiClient.post<{ invoice: Invoice }>(`/invoices/${invoiceId}/approve`);
    return res.data.invoice;
  },

  dispute: async (invoiceId: string, notes?: string): Promise<Invoice> => {
    const res = await apiClient.post<{ invoice: Invoice }>(`/invoices/${invoiceId}/dispute`, { notes });
    return res.data.invoice;
  },

  submit: async (invoiceId: string): Promise<Invoice> => {
    const res = await apiClient.post<{ invoice: Invoice }>(`/invoices/${invoiceId}/submit`);
    return res.data.invoice;
  },
};
