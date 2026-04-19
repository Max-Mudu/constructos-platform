import { AuthUser } from './types';

// All API calls go through Next.js rewrite proxy → localhost:3001
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

// The access token is held in memory. We read it via a getter so the API
// client never holds a stale reference. The auth store sets this on login.
let _getAccessToken: (() => string | null) | null = null;
let _onUnauthorized: (() => void) | null = null;

export function configureApiClient(
  getToken: () => string | null,
  onUnauthorized: () => void,
) {
  _getAccessToken = getToken;
  _onUnauthorized = onUnauthorized;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const token = _getAccessToken?.();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include', // send httpOnly refresh cookie
  });

  if (res.status === 401 && !retried) {
    // Try to refresh the token once
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, options, true);
    } else {
      _onUnauthorized?.();
      throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
    }
  }

  if (!res.ok) {
    let body: { error?: string; code?: string; details?: Record<string, string[]> } = {};
    try { body = await res.json(); } catch {}
    throw new ApiError(
      res.status,
      body.code ?? 'API_ERROR',
      body.error ?? 'Request failed',
      body.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return false;
    const data: { accessToken: string; user: AuthUser } = await res.json();
    // Import dynamically to avoid circular dependency
    const { useAuthStore } = await import('@/store/auth.store');
    useAuthStore.getState().setAuth(data.user, data.accessToken);
    return true;
  } catch {
    return false;
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: AuthUser; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    companyName: string;
    currency?: string;
    country?: string;
  }) =>
    request<{ user: AuthUser; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: AuthUser }>('/auth/me'),

  refresh: () =>
    request<{ user: AuthUser; accessToken: string }>('/auth/refresh', {
      method: 'POST',
    }),
};

// ─── Company ─────────────────────────────────────────────────────────────────

export const companyApi = {
  get: () => request<{ company: import('./types').Company }>('/companies/me'),

  update: (data: Partial<{ name: string; country: string; currency: string; timezone: string }>) =>
    request<{ company: import('./types').Company }>('/companies/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectApi = {
  list: () => request<{ projects: import('./types').Project[] }>('/projects'),

  get: (projectId: string) =>
    request<{ project: import('./types').Project }>(`/projects/${projectId}`),

  create: (data: { name: string; code?: string; description?: string; location?: string }) =>
    request<{ project: import('./types').Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, data: Partial<import('./types').Project>) =>
    request<{ project: import('./types').Project }>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  archive: (projectId: string) =>
    request<{ project: import('./types').Project }>(`/projects/${projectId}`, {
      method: 'DELETE',
    }),
};

// ─── Job Sites ────────────────────────────────────────────────────────────────

export const siteApi = {
  list: (projectId: string) =>
    request<{ sites: import('./types').JobSite[] }>(`/projects/${projectId}/sites`),

  get: (projectId: string, siteId: string) =>
    request<{ site: import('./types').JobSite }>(`/projects/${projectId}/sites/${siteId}`),

  create: (projectId: string, data: { name: string; address?: string }) =>
    request<{ site: import('./types').JobSite }>(`/projects/${projectId}/sites`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─── Suppliers ───────────────────────────────────────────────────────────────

export const supplierApi = {
  list: (includeInactive = false) =>
    request<{ suppliers: import('./types').Supplier[] }>(
      `/suppliers${includeInactive ? '?includeInactive=true' : ''}`,
    ),

  get: (supplierId: string) =>
    request<{ supplier: import('./types').Supplier }>(`/suppliers/${supplierId}`),

  create: (data: {
    name: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    address?: string;
  }) =>
    request<{ supplier: import('./types').Supplier }>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    supplierId: string,
    data: Partial<{
      name: string;
      contactPerson: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      isActive: boolean;
    }>,
  ) =>
    request<{ supplier: import('./types').Supplier }>(`/suppliers/${supplierId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (supplierId: string) =>
    request<void>(`/suppliers/${supplierId}`, { method: 'DELETE' }),
};

// ─── Workers ─────────────────────────────────────────────────────────────────

type Worker = import('./types').Worker;

export const workerApi = {
  list: (params: { search?: string; trade?: string; isActive?: boolean; siteId?: string; projectId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.search    !== undefined) qs.set('search',    params.search);
    if (params.trade     !== undefined) qs.set('trade',     params.trade);
    if (params.isActive  !== undefined) qs.set('isActive',  String(params.isActive));
    if (params.siteId    !== undefined) qs.set('siteId',    params.siteId);
    if (params.projectId !== undefined) qs.set('projectId', params.projectId);
    const q = qs.toString();
    return request<{ workers: Worker[] }>(`/workers${q ? `?${q}` : ''}`);
  },

  get: (workerId: string) =>
    request<{ worker: Worker }>(`/workers/${workerId}`),

  create: (data: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    idNumber?: string;
    trade?: string;
    dailyWage?: number;
    currency?: string;
    employmentStatus?: import('./types').WorkerEmploymentStatus;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    notes?: string;
  }) =>
    request<{ worker: Worker }>('/workers', { method: 'POST', body: JSON.stringify(data) }),

  update: (workerId: string, data: Partial<{
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    idNumber: string | null;
    trade: string | null;
    dailyWage: number | null;
    currency: string;
    employmentStatus: import('./types').WorkerEmploymentStatus;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    notes: string | null;
  }>) =>
    request<{ worker: Worker }>(`/workers/${workerId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deactivate: (workerId: string) =>
    request<void>(`/workers/${workerId}`, { method: 'DELETE' }),

  listSiteWorkers: (projectId: string, siteId: string) =>
    request<{ workers: Worker[] }>(`/projects/${projectId}/sites/${siteId}/workers`),

  assignToSite: (projectId: string, siteId: string, workerId: string) =>
    request<{ assignment: object }>(`/projects/${projectId}/sites/${siteId}/workers`, {
      method: 'POST',
      body: JSON.stringify({ workerId }),
    }),

  removeFromSite: (projectId: string, siteId: string, workerId: string) =>
    request<void>(`/projects/${projectId}/sites/${siteId}/workers/${workerId}`, { method: 'DELETE' }),
};

// ─── Labour Entries ───────────────────────────────────────────────────────────

type LabourEntry = import('./types').LabourEntry;

export const labourApi = {
  list: (projectId: string, siteId: string, params: {
    date?: string; startDate?: string; endDate?: string; workerId?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.date)      qs.set('date',      params.date);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate)   qs.set('endDate',   params.endDate);
    if (params.workerId)  qs.set('workerId',  params.workerId);
    const q = qs.toString();
    return request<{ entries: LabourEntry[] }>(
      `/projects/${projectId}/sites/${siteId}/labour${q ? `?${q}` : ''}`,
    );
  },

  get: (projectId: string, siteId: string, entryId: string) =>
    request<{ entry: LabourEntry }>(`/projects/${projectId}/sites/${siteId}/labour/${entryId}`),

  create: (projectId: string, siteId: string, data: {
    workerId: string;
    date: string;
    hoursWorked: number;
    dailyRate: number;
    currency?: string;
    notes?: string;
  }) =>
    request<{ entry: LabourEntry }>(`/projects/${projectId}/sites/${siteId}/labour`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, siteId: string, entryId: string, data: Partial<{
    hoursWorked: number;
    dailyRate: number;
    currency: string;
    notes: string | null;
  }>) =>
    request<{ entry: LabourEntry }>(`/projects/${projectId}/sites/${siteId}/labour/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, siteId: string, entryId: string) =>
    request<void>(`/projects/${projectId}/sites/${siteId}/labour/${entryId}`, { method: 'DELETE' }),
};

// ─── Attendance ───────────────────────────────────────────────────────────────

type AttendanceRecord = import('./types').AttendanceRecord;
type AttendanceSummary = import('./types').AttendanceSummary;
type AttendanceStatus = import('./types').AttendanceStatus;

export const attendanceApi = {
  list: (
    projectId: string,
    siteId: string,
    params: { date?: string; startDate?: string; endDate?: string; workerId?: string; status?: AttendanceStatus } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.date)      qs.set('date',      params.date);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate)   qs.set('endDate',   params.endDate);
    if (params.workerId)  qs.set('workerId',  params.workerId);
    if (params.status)    qs.set('status',    params.status);
    const q = qs.toString();
    return request<{ records: AttendanceRecord[] }>(
      `/projects/${projectId}/sites/${siteId}/attendance${q ? `?${q}` : ''}`,
    );
  },

  summary: (projectId: string, siteId: string, date?: string) => {
    const q = date ? `?date=${date}` : '';
    return request<{ summary: AttendanceSummary; date: string }>(
      `/projects/${projectId}/sites/${siteId}/attendance/summary${q}`,
    );
  },

  get: (projectId: string, siteId: string, recordId: string) =>
    request<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance/${recordId}`,
    ),

  create: (
    projectId: string,
    siteId: string,
    data: {
      workerId: string;
      date: string;
      status: AttendanceStatus;
      checkInTime?: string;
      checkOutTime?: string;
      notes?: string;
    },
  ) =>
    request<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (
    projectId: string,
    siteId: string,
    recordId: string,
    data: Partial<{
      status: AttendanceStatus;
      checkInTime: string | null;
      checkOutTime: string | null;
      notes: string | null;
    }>,
  ) =>
    request<{ record: AttendanceRecord }>(
      `/projects/${projectId}/sites/${siteId}/attendance/${recordId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  delete: (projectId: string, siteId: string, recordId: string) =>
    request<void>(
      `/projects/${projectId}/sites/${siteId}/attendance/${recordId}`,
      { method: 'DELETE' },
    ),
};

// ─── Daily Targets ────────────────────────────────────────────────────────────

type DailyTarget = import('./types').DailyTarget;
type TargetSummary = import('./types').TargetSummary;

export const targetsApi = {
  list: (
    projectId: string,
    siteId: string,
    params: { date?: string; startDate?: string; endDate?: string; workerId?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.date)      qs.set('date',      params.date);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate)   qs.set('endDate',   params.endDate);
    if (params.workerId)  qs.set('workerId',  params.workerId);
    const q = qs.toString();
    return request<{ targets: DailyTarget[] }>(
      `/projects/${projectId}/sites/${siteId}/targets${q ? `?${q}` : ''}`,
    );
  },

  summary: (projectId: string, siteId: string, date?: string) => {
    const q = date ? `?date=${date}` : '';
    return request<{ summary: TargetSummary; date: string }>(
      `/projects/${projectId}/sites/${siteId}/targets/summary${q}`,
    );
  },

  get: (projectId: string, siteId: string, targetId: string) =>
    request<{ target: DailyTarget }>(
      `/projects/${projectId}/sites/${siteId}/targets/${targetId}`,
    ),

  create: (
    projectId: string,
    siteId: string,
    data: {
      date: string;
      description: string;
      targetValue: number;
      targetUnit: string;
      actualValue?: number;
      workerId?: string;
      notes?: string;
    },
  ) =>
    request<{ target: DailyTarget }>(
      `/projects/${projectId}/sites/${siteId}/targets`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (
    projectId: string,
    siteId: string,
    targetId: string,
    data: Partial<{
      description: string;
      targetValue: number;
      targetUnit: string;
      actualValue: number | null;
      workerId: string | null;
      notes: string | null;
    }>,
  ) =>
    request<{ target: DailyTarget }>(
      `/projects/${projectId}/sites/${siteId}/targets/${targetId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  approve: (projectId: string, siteId: string, targetId: string) =>
    request<{ target: DailyTarget }>(
      `/projects/${projectId}/sites/${siteId}/targets/${targetId}/approve`,
      { method: 'POST' },
    ),

  delete: (projectId: string, siteId: string, targetId: string) =>
    request<void>(
      `/projects/${projectId}/sites/${siteId}/targets/${targetId}`,
      { method: 'DELETE' },
    ),
};

// ─── Deliveries ───────────────────────────────────────────────────────────────

type DeliveryRecord = import('./types').DeliveryRecord;

export const deliveryApi = {
  list: (projectId: string, siteId: string) =>
    request<{ deliveries: DeliveryRecord[] }>(
      `/projects/${projectId}/sites/${siteId}/deliveries`,
    ),

  get: (projectId: string, siteId: string, deliveryId: string) =>
    request<{ delivery: DeliveryRecord }>(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`,
    ),

  create: (
    projectId: string,
    siteId: string,
    data: {
      supplierName: string;
      supplierContact?: string;
      deliveryDate: string;
      deliveryTime?: string;
      driverName?: string;
      vehicleRegistration?: string;
      purchaseOrderNumber?: string;
      deliveryNoteNumber?: string;
      invoiceNumber?: string;
      itemDescription: string;
      unitOfMeasure: string;
      quantityOrdered: number;
      quantityDelivered: number;
      conditionOnArrival?: import('./types').DeliveryCondition;
      inspectionStatus?: import('./types').InspectionStatus;
      acceptanceStatus?: import('./types').AcceptanceStatus;
      rejectionReason?: string;
      discrepancyNotes?: string;
      receivedById: string;
      budgetLineItemId?: string;
      comments?: string;
    },
  ) =>
    request<{ delivery: DeliveryRecord }>(
      `/projects/${projectId}/sites/${siteId}/deliveries`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (
    projectId: string,
    siteId: string,
    deliveryId: string,
    data: Partial<{
      supplierName: string;
      supplierContact: string | null;
      deliveryDate: string;
      deliveryTime: string | null;
      driverName: string | null;
      vehicleRegistration: string | null;
      purchaseOrderNumber: string | null;
      deliveryNoteNumber: string | null;
      invoiceNumber: string | null;
      itemDescription: string;
      unitOfMeasure: string;
      quantityOrdered: number;
      quantityDelivered: number;
      conditionOnArrival: import('./types').DeliveryCondition;
      inspectionStatus: import('./types').InspectionStatus;
      acceptanceStatus: import('./types').AcceptanceStatus;
      rejectionReason: string | null;
      discrepancyNotes: string | null;
      budgetLineItemId: string | null;
      comments: string | null;
    }>,
  ) =>
    request<{ delivery: DeliveryRecord }>(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  delete: (projectId: string, siteId: string, deliveryId: string) =>
    request<void>(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`,
      { method: 'DELETE' },
    ),

  uploadPhoto: (projectId: string, siteId: string, deliveryId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    // Bypass JSON content-type — browser sets multipart boundary automatically
    const token = _getAccessToken?.();
    return fetch(`${BASE}/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/photos`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.code ?? 'API_ERROR', body.error ?? 'Upload failed');
      }
      return res.json() as Promise<{ photo: import('./types').DeliveryPhoto }>;
    });
  },

  deletePhoto: (projectId: string, siteId: string, deliveryId: string, photoId: string) =>
    request<void>(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/photos/${photoId}`,
      { method: 'DELETE' },
    ),

  uploadDocument: (projectId: string, siteId: string, deliveryId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const token = _getAccessToken?.();
    return fetch(`${BASE}/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/documents`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.code ?? 'API_ERROR', body.error ?? 'Upload failed');
      }
      return res.json() as Promise<{ document: import('./types').DeliveryDocument }>;
    });
  },

  deleteDocument: (projectId: string, siteId: string, deliveryId: string, documentId: string) =>
    request<void>(
      `/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/documents/${documentId}`,
      { method: 'DELETE' },
    ),
};

// ─── Contractors ──────────────────────────────────────────────────────────────

export const contractorApi = {
  list: (params: { isActive?: boolean; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.isActive !== undefined) q.set('isActive', String(params.isActive));
    if (params.search)                 q.set('search', params.search);
    const qs = q.toString();
    return request<{ contractors: import('./types').Contractor[] }>(
      `/contractors${qs ? `?${qs}` : ''}`,
    );
  },

  get: (contractorId: string) =>
    request<{ contractor: import('./types').Contractor }>(`/contractors/${contractorId}`),

  create: (data: {
    name: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    registrationNumber?: string;
    tradeSpecialization?: string;
  }) =>
    request<{ contractor: import('./types').Contractor }>('/contractors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (contractorId: string, data: {
    name?: string;
    contactPerson?: string | null;
    email?: string | null;
    phone?: string | null;
    registrationNumber?: string | null;
    tradeSpecialization?: string | null;
    isActive?: boolean;
  }) =>
    request<{ contractor: import('./types').Contractor }>(`/contractors/${contractorId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deactivate: (contractorId: string) =>
    request<void>(`/contractors/${contractorId}`, { method: 'DELETE' }),
};

// ─── Schedule ─────────────────────────────────────────────────────────────────

const scheduleBase = (projectId: string, siteId: string) =>
  `/projects/${projectId}/sites/${siteId}/schedule`;

export const scheduleApi = {
  // Summary
  getSummary: (projectId: string, siteId: string) =>
    request<{ summary: import('./types').ScheduleSummary }>(
      `${scheduleBase(projectId, siteId)}/summary`,
    ),

  // Work packages
  listPackages: (projectId: string, siteId: string, params: { contractorId?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.contractorId) q.set('contractorId', params.contractorId);
    if (params.status)       q.set('status', params.status);
    const qs = q.toString();
    return request<{ packages: import('./types').WorkPackage[] }>(
      `${scheduleBase(projectId, siteId)}/packages${qs ? `?${qs}` : ''}`,
    );
  },

  createPackage: (projectId: string, siteId: string, data: {
    contractorId: string;
    name: string;
    description?: string;
    area?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    request<{ package: import('./types').WorkPackage }>(
      `${scheduleBase(projectId, siteId)}/packages`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  updatePackage: (projectId: string, siteId: string, packageId: string, data: {
    name?: string;
    description?: string | null;
    area?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    status?: string;
  }) =>
    request<{ package: import('./types').WorkPackage }>(
      `${scheduleBase(projectId, siteId)}/packages/${packageId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  deletePackage: (projectId: string, siteId: string, packageId: string) =>
    request<void>(
      `${scheduleBase(projectId, siteId)}/packages/${packageId}`,
      { method: 'DELETE' },
    ),

  // Tasks
  listTasks: (projectId: string, siteId: string, params: { workPackageId?: string; contractorId?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.workPackageId) q.set('workPackageId', params.workPackageId);
    if (params.contractorId)  q.set('contractorId',  params.contractorId);
    if (params.status)        q.set('status',         params.status);
    const qs = q.toString();
    return request<{ tasks: import('./types').ScheduleTask[] }>(
      `${scheduleBase(projectId, siteId)}/tasks${qs ? `?${qs}` : ''}`,
    );
  },

  createTask: (projectId: string, siteId: string, data: {
    contractorId: string;
    workPackageId?: string;
    title: string;
    description?: string;
    area?: string;
    materialsRequired?: string;
    equipmentRequired?: string;
    plannedStartDate?: string;
    plannedEndDate?: string;
    plannedProgress?: number;
    dependsOnTaskIds?: string[];
  }) =>
    request<{ task: import('./types').ScheduleTask }>(
      `${scheduleBase(projectId, siteId)}/tasks`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  getTask: (projectId: string, siteId: string, taskId: string) =>
    request<{ task: import('./types').ScheduleTask }>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}`,
    ),

  updateTask: (projectId: string, siteId: string, taskId: string, data: {
    title?: string;
    description?: string | null;
    area?: string | null;
    materialsRequired?: string | null;
    equipmentRequired?: string | null;
    plannedStartDate?: string | null;
    plannedEndDate?: string | null;
    actualStartDate?: string | null;
    actualEndDate?: string | null;
    plannedProgress?: number | null;
    actualProgress?: number | null;
    status?: string;
    delayReason?: string | null;
    comments?: string | null;
  }) =>
    request<{ task: import('./types').ScheduleTask }>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  deleteTask: (projectId: string, siteId: string, taskId: string) =>
    request<void>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}`,
      { method: 'DELETE' },
    ),

  // Milestones
  createMilestone: (projectId: string, siteId: string, taskId: string, data: {
    name: string;
    description?: string;
    plannedDate: string;
  }) =>
    request<{ milestone: import('./types').ScheduleMilestone }>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}/milestones`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  updateMilestone: (projectId: string, siteId: string, taskId: string, milestoneId: string, data: {
    name?: string;
    description?: string | null;
    plannedDate?: string;
    actualDate?: string | null;
    status?: string;
  }) =>
    request<{ milestone: import('./types').ScheduleMilestone }>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}/milestones/${milestoneId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  deleteMilestone: (projectId: string, siteId: string, taskId: string, milestoneId: string) =>
    request<void>(
      `${scheduleBase(projectId, siteId)}/tasks/${taskId}/milestones/${milestoneId}`,
      { method: 'DELETE' },
    ),

  // Weekly plans
  listWeeklyPlans: (projectId: string, siteId: string, contractorId?: string) => {
    const q = contractorId ? `?contractorId=${contractorId}` : '';
    return request<{ plans: import('./types').WeeklyPlan[] }>(
      `${scheduleBase(projectId, siteId)}/weekly-plans${q}`,
    );
  },

  createWeeklyPlan: (projectId: string, siteId: string, data: {
    contractorId: string;
    weekStartDate: string;
    notes?: string;
    items: Array<{ taskId: string; plannedHours?: number; notes?: string }>;
  }) =>
    request<{ plan: import('./types').WeeklyPlan }>(
      `${scheduleBase(projectId, siteId)}/weekly-plans`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
};

// ─── Drawings ─────────────────────────────────────────────────────────────────

const drawingBase = (projectId: string) => `/projects/${projectId}/drawings`;

export const drawingApi = {
  list: (projectId: string, params: { discipline?: string; status?: string; siteId?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.discipline) q.set('discipline', params.discipline);
    if (params.status)     q.set('status',     params.status);
    if (params.siteId)     q.set('siteId',     params.siteId);
    if (params.search)     q.set('search',     params.search);
    const qs = q.toString();
    return request<{ drawings: import('./types').Drawing[] }>(
      `${drawingBase(projectId)}${qs ? `?${qs}` : ''}`,
    );
  },

  get: (projectId: string, drawingId: string) =>
    request<{ drawing: import('./types').Drawing }>(`${drawingBase(projectId)}/${drawingId}`),

  create: (projectId: string, data: {
    drawingNumber: string;
    title: string;
    discipline?: string;
    siteId?: string;
  }) =>
    request<{ drawing: import('./types').Drawing }>(
      drawingBase(projectId),
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (projectId: string, drawingId: string, data: {
    title?: string;
    discipline?: string | null;
    siteId?: string | null;
  }) =>
    request<{ drawing: import('./types').Drawing }>(
      `${drawingBase(projectId)}/${drawingId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  delete: (projectId: string, drawingId: string) =>
    request<void>(`${drawingBase(projectId)}/${drawingId}`, { method: 'DELETE' }),

  uploadRevision: (projectId: string, drawingId: string, formData: FormData) =>
    request<{ revision: import('./types').DrawingRevision }>(
      `${drawingBase(projectId)}/${drawingId}/revisions`,
      { method: 'POST', body: formData, headers: {} },
    ),

  approveRevision: (projectId: string, drawingId: string, revisionId: string, data: { issueDate?: string }) =>
    request<{ revision: import('./types').DrawingRevision }>(
      `${drawingBase(projectId)}/${drawingId}/revisions/${revisionId}/approve`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  listComments: (projectId: string, drawingId: string, revisionId: string) =>
    request<{ comments: import('./types').DrawingComment[] }>(
      `${drawingBase(projectId)}/${drawingId}/revisions/${revisionId}/comments`,
    ),

  addComment: (projectId: string, drawingId: string, revisionId: string, text: string) =>
    request<{ comment: import('./types').DrawingComment }>(
      `${drawingBase(projectId)}/${drawingId}/revisions/${revisionId}/comments`,
      { method: 'POST', body: JSON.stringify({ text }) },
    ),
};

// ─── Consultant Instructions ──────────────────────────────────────────────────

const instructionBase = (projectId: string) => `/projects/${projectId}/instructions`;

export const instructionApi = {
  list: (projectId: string, params: { status?: string; priority?: string; type?: string; siteId?: string; contractorId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status)       q.set('status',       params.status);
    if (params.priority)     q.set('priority',     params.priority);
    if (params.type)         q.set('type',         params.type);
    if (params.siteId)       q.set('siteId',       params.siteId);
    if (params.contractorId) q.set('contractorId', params.contractorId);
    const qs = q.toString();
    return request<{ instructions: import('./types').ConsultantInstruction[] }>(
      `${instructionBase(projectId)}${qs ? `?${qs}` : ''}`,
    );
  },

  get: (projectId: string, instructionId: string) =>
    request<{ instruction: import('./types').ConsultantInstruction }>(
      `${instructionBase(projectId)}/${instructionId}`,
    ),

  create: (projectId: string, data: {
    type: string;
    title: string;
    category?: string;
    priority?: string;
    description?: string;
    issuedDate: string;
    targetActionDate?: string;
    siteId?: string;
    contractorId?: string;
    drawingId?: string;
    revisionId?: string;
    milestoneId?: string;
    workPackageId?: string;
  }) =>
    request<{ instruction: import('./types').ConsultantInstruction }>(
      instructionBase(projectId),
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (projectId: string, instructionId: string, data: {
    title?: string;
    category?: string | null;
    priority?: string;
    status?: string;
    description?: string | null;
    targetActionDate?: string | null;
    siteId?: string | null;
    contractorId?: string | null;
    drawingId?: string | null;
    revisionId?: string | null;
    milestoneId?: string | null;
    workPackageId?: string | null;
    contractorResponse?: string | null;
    resolutionNotes?: string | null;
  }) =>
    request<{ instruction: import('./types').ConsultantInstruction }>(
      `${instructionBase(projectId)}/${instructionId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  uploadAttachment: (projectId: string, instructionId: string, formData: FormData) =>
    request<{ attachment: import('./types').InstructionAttachment }>(
      `${instructionBase(projectId)}/${instructionId}/attachments`,
      { method: 'POST', body: formData, headers: {} },
    ),
};

// ─── Budget & Cost Control ────────────────────────────────────────────────────

export const budgetApi = {
  list: (params: { projectId?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.projectId) q.set('projectId', params.projectId);
    if (params.status)    q.set('status',    params.status);
    const qs = q.toString();
    return request<{ budgets: import('./types').BudgetListItem[] }>(
      `/budgets${qs ? `?${qs}` : ''}`,
    );
  },

  get: (budgetId: string) =>
    request<{ budget: import('./types').Budget; summary: import('./types').BudgetSummary }>(
      `/budgets/${budgetId}`,
    ),

  create: (data: { projectId: string; name: string; currency?: string; notes?: string }) =>
    request<{ budget: import('./types').Budget }>(
      '/budgets',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  update: (budgetId: string, data: { name?: string; currency?: string; notes?: string | null }) =>
    request<{ budget: import('./types').Budget }>(
      `/budgets/${budgetId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  delete: (budgetId: string) =>
    request<void>(`/budgets/${budgetId}`, { method: 'DELETE' }),

  approve: (budgetId: string) =>
    request<{ budget: import('./types').Budget }>(
      `/budgets/${budgetId}/approve`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  lock: (budgetId: string) =>
    request<{ budget: import('./types').Budget }>(
      `/budgets/${budgetId}/lock`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  addLineItem: (budgetId: string, data: {
    category: string;
    description: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    budgetedAmount: number;
    committedAmount?: number;
    actualSpend?: number;
    currency?: string;
    notes?: string;
    consultant?: {
      consultantType: string;
      consultantName: string;
      firmName?: string;
      feeAgreed: number;
      feePaid?: number;
      feeOutstanding?: number;
    };
    marketing?: {
      campaignName: string;
      channel: string;
      vendorAgency?: string;
      budgetedAmount: number;
      actualSpend?: number;
      paidAmount?: number;
      expectedRoi?: string;
      notes?: string;
    };
  }) =>
    request<{ lineItem: import('./types').BudgetLineItem }>(
      `/budgets/${budgetId}/line-items`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  updateLineItem: (budgetId: string, lineItemId: string, data: {
    description?: string;
    quantity?: number | null;
    unit?: string | null;
    unitRate?: number | null;
    budgetedAmount?: number;
    committedAmount?: number;
    actualSpend?: number;
    notes?: string | null;
    consultant?: {
      consultantType?: string;
      consultantName?: string;
      firmName?: string | null;
      feeAgreed?: number;
      feePaid?: number;
      feeOutstanding?: number;
    };
    marketing?: {
      campaignName?: string;
      channel?: string;
      vendorAgency?: string | null;
      budgetedAmount?: number;
      actualSpend?: number;
      paidAmount?: number;
      expectedRoi?: string | null;
      notes?: string | null;
    };
  }) =>
    request<{ lineItem: import('./types').BudgetLineItem }>(
      `/budgets/${budgetId}/line-items/${lineItemId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  deleteLineItem: (budgetId: string, lineItemId: string) =>
    request<void>(`/budgets/${budgetId}/line-items/${lineItemId}`, { method: 'DELETE' }),

  addVariation: (budgetId: string, data: {
    referenceNumber: string;
    description: string;
    amount: number;
    direction?: 'addition' | 'omission';
  }) =>
    request<{ variation: import('./types').VariationOrder }>(
      `/budgets/${budgetId}/variations`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  updateVariation: (budgetId: string, variationId: string, data: {
    referenceNumber?: string;
    description?: string;
    amount?: number;
    direction?: 'addition' | 'omission';
    status?: 'pending' | 'approved' | 'rejected';
  }) =>
    request<{ variation: import('./types').VariationOrder }>(
      `/budgets/${budgetId}/variations/${variationId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
};

// ─── Invoices ─────────────────────────────────────────────────────────────────

export const invoiceApi = {
  list: (params?: {
    projectId?: string;
    status?: string;
    vendorType?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.projectId)  qs.set('projectId',  params.projectId);
    if (params?.status)     qs.set('status',     params.status);
    if (params?.vendorType) qs.set('vendorType', params.vendorType);
    if (params?.search)     qs.set('search',     params.search);
    if (params?.dateFrom)   qs.set('dateFrom',   params.dateFrom);
    if (params?.dateTo)     qs.set('dateTo',     params.dateTo);
    const query = qs.toString();
    return request<{ invoices: import('./types').InvoiceListItem[] }>(
      `/invoices${query ? `?${query}` : ''}`,
    );
  },

  summary: (projectId?: string) => {
    const qs = projectId ? `?projectId=${projectId}` : '';
    return request<{ summary: import('./types').InvoiceSummary }>(`/invoices/summary${qs}`);
  },

  get: (invoiceId: string) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}`),

  create: (data: {
    projectId:       string;
    siteId?:         string;
    invoiceNumber:   string;
    vendorType:      import('./types').InvoiceVendorType;
    contractorId?:   string;
    supplierId?:     string;
    consultantUserId?: string;
    vendorName:      string;
    budgetLineItemId?: string;
    variationOrderId?: string;
    deliveryRecordId?: string;
    labourEntryId?:  string;
    marketingBudgetEntryId?: string;
    consultantCostEntryId?:  string;
    subtotal:        number;
    taxAmount?:      number;
    totalAmount:     number;
    currency?:       string;
    issueDate:       string;
    dueDate:         string;
    notes?:          string;
    lineItems?: Array<{ description: string; quantity: number; unitRate: number; amount: number; notes?: string }>;
  }) =>
    request<{ invoice: import('./types').Invoice }>('/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (invoiceId: string, data: {
    invoiceNumber?:  string;
    vendorName?:     string;
    siteId?:         string | null;
    contractorId?:   string | null;
    supplierId?:     string | null;
    consultantUserId?: string | null;
    budgetLineItemId?: string | null;
    variationOrderId?: string | null;
    deliveryRecordId?: string | null;
    subtotal?:       number;
    taxAmount?:      number;
    totalAmount?:    number;
    currency?:       string;
    issueDate?:      string;
    dueDate?:        string;
    notes?:          string | null;
  }) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (invoiceId: string) =>
    request<void>(`/invoices/${invoiceId}`, { method: 'DELETE' }),

  submit: (invoiceId: string) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}/submit`, { method: 'POST' }),

  approve: (invoiceId: string) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}/approve`, { method: 'POST' }),

  dispute: (invoiceId: string, notes?: string) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  cancel: (invoiceId: string) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}/cancel`, { method: 'POST' }),

  addLineItem: (invoiceId: string, data: {
    description: string;
    quantity:    number;
    unitRate:    number;
    amount:      number;
    notes?:      string;
  }) =>
    request<{ invoice: import('./types').Invoice }>(`/invoices/${invoiceId}/line-items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteLineItem: (invoiceId: string, lineItemId: string) =>
    request<void>(`/invoices/${invoiceId}/line-items/${lineItemId}`, { method: 'DELETE' }),

  recordPayment: (invoiceId: string, data: {
    amount:      number;
    paymentDate: string;
    method:      string;
    reference?:  string;
    notes?:      string;
  }) =>
    request<{ payment: import('./types').InvoicePayment }>(`/invoices/${invoiceId}/payments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deletePayment: (invoiceId: string, paymentId: string) =>
    request<void>(`/invoices/${invoiceId}/payments/${paymentId}`, { method: 'DELETE' }),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const notificationApi = {
  list: (params: { isRead?: boolean; type?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.isRead  !== undefined) q.set('isRead',  String(params.isRead));
    if (params.type)                  q.set('type',    params.type);
    if (params.limit   !== undefined) q.set('limit',   String(params.limit));
    if (params.offset  !== undefined) q.set('offset',  String(params.offset));
    const qs = q.toString();
    return request<{ notifications: import('./types').Notification[]; total: number }>(
      `/notifications${qs ? `?${qs}` : ''}`,
    );
  },

  count: () =>
    request<{ count: number }>('/notifications/count'),

  markRead: (notificationId: string) =>
    request<{ notification: import('./types').Notification }>(
      `/notifications/${notificationId}/read`,
      { method: 'POST' },
    ),

  markAllRead: () =>
    request<{ count: number }>('/notifications/read-all', { method: 'POST' }),

  delete: (notificationId: string) =>
    request<void>(`/notifications/${notificationId}`, { method: 'DELETE' }),

  getPreferences: () =>
    request<{ preferences: import('./types').NotificationPreference[] }>(
      '/notifications/preferences',
    ),

  updatePreferences: (
    preferences: Array<{ type: string; enabled: boolean }>,
  ) =>
    request<{ preferences: import('./types').NotificationPreference[] }>(
      '/notifications/preferences',
      { method: 'PUT', body: JSON.stringify({ preferences }) },
    ),
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const dashboardApi = {
  get: () =>
    request<{ stats: import('./types').DashboardStats }>('/dashboard'),
};

// ─── Reports ──────────────────────────────────────────────────────────────────

export const reportApi = {
  /** Fetch report data as JSON (for preview table). */
  get: (
    type: import('./types').ReportType,
    params: {
      projectId?: string;
      siteId?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams({ format: 'json' });
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.siteId)    qs.set('siteId',    params.siteId);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate)   qs.set('endDate',   params.endDate);
    return request<{ report: import('./types').ReportData }>(`/reports/${type}?${qs}`);
  },

  /**
   * Download a report binary (csv / xlsx / pdf).
   * Triggers browser save-file dialog.
   */
  download: async (
    type: import('./types').ReportType,
    format: import('./types').ReportFormat,
    params: {
      projectId?: string;
      siteId?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<void> => {
    const qs = new URLSearchParams({ format });
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.siteId)    qs.set('siteId',    params.siteId);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate)   qs.set('endDate',   params.endDate);

    const token = _getAccessToken?.();
    const res = await fetch(`${BASE}/reports/${type}?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        (body as { code?: string }).code ?? 'DOWNLOAD_ERROR',
        (body as { error?: string }).error ?? 'Download failed',
      );
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${type}-report.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// ─── Activity feed ────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id:         string;
  action:     string;
  entityType: string;
  entityId:   string;
  userEmail:  string;
  userRole:   string;
  createdAt:  string;
}

export const activityApi = {
  list: (params: { limit?: number; entityType?: string; startDate?: string; endDate?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit)      qs.set('limit',      String(params.limit));
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.startDate)  qs.set('startDate',  params.startDate);
    if (params.endDate)    qs.set('endDate',     params.endDate);
    const q = qs.toString();
    return request<{ activities: ActivityEntry[] }>(`/activity${q ? `?${q}` : ''}`);
  },
};
