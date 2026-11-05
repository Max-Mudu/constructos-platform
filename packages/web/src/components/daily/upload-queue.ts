/**
 * Photo upload queue state. Photos are resized and uploaded one at a time
 * (phones on site often have weak signal); each item shows progress and can
 * be retried or dismissed on failure. Pure reducer, unit tested.
 */
import { LIMITS } from '@/lib/daily-report-types';

export type UploadStatus = 'queued' | 'resizing' | 'uploading' | 'failed';

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  status: UploadStatus;
  /** 0..1 while uploading */
  progress: number;
  error: string | null;
  /** Errors such as "not a JPEG/PNG" cannot be fixed by retrying. */
  retryable: boolean;
}

export type UploadAction =
  | { type: 'add'; items: { id: string; file: File }[] }
  | { type: 'start'; id: string }
  | { type: 'resized'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done'; id: string }
  | { type: 'fail'; id: string; error: string; retryable: boolean }
  | { type: 'retry'; id: string }
  | { type: 'dismiss'; id: string };

export function uploadReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'add':
      return [
        ...state,
        ...action.items.map((i) => ({
          id: i.id, file: i.file, name: i.file.name || 'photo', status: 'queued' as const,
          progress: 0, error: null, retryable: true,
        })),
      ];
    case 'start':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'resizing', progress: 0, error: null } : i));
    case 'resized':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'uploading', progress: 0 } : i));
    case 'progress':
      return state.map((i) => (i.id === action.id && i.status === 'uploading'
        ? { ...i, progress: Math.max(i.progress, Math.min(1, Math.max(0, action.progress))) }
        : i));
    case 'done':
      return state.filter((i) => i.id !== action.id);
    case 'fail':
      return state.map((i) => (i.id === action.id
        ? { ...i, status: 'failed', error: action.error, retryable: action.retryable }
        : i));
    case 'retry':
      return state.map((i) => (i.id === action.id && i.status === 'failed' && i.retryable
        ? { ...i, status: 'queued', progress: 0, error: null }
        : i));
    case 'dismiss':
      return state.filter((i) => i.id !== action.id);
    default:
      return state;
  }
}

/** Next item to process, or null while one is already in flight. */
export function nextQueued(state: readonly UploadItem[]): UploadItem | null {
  if (state.some((i) => i.status === 'resizing' || i.status === 'uploading')) return null;
  return state.find((i) => i.status === 'queued') ?? null;
}

/** How many of `incoming` files fit under the 30-photo limit. */
export function photoSlotsLeft(existing: number, pending: number, limit: number = LIMITS.photosPerReport): number {
  return Math.max(0, limit - existing - pending);
}

/** Pending items that still count towards the limit (everything not dismissed). */
export function pendingCount(state: readonly UploadItem[]): number {
  return state.length;
}
