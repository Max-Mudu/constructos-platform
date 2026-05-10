import * as FileSystem from 'expo-file-system';
import { apiClient } from './client';
import { Drawing, DrawingRevision } from '../types';

interface RawDrawing extends Omit<Drawing, 'latestRevision'> {
  currentRevisionId: string | null;
  revisions: DrawingRevision[];
}

function normalize(raw: RawDrawing): Drawing {
  const latestRevision =
    raw.revisions.find((r) => r.id === raw.currentRevisionId) ??
    raw.revisions[0] ??
    null;
  return { ...raw, latestRevision };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(projectId: string): string {
  return (FileSystem.documentDirectory ?? '') + `drawings_cache_${projectId}.json`;
}

async function readCache(projectId: string): Promise<Drawing[] | null> {
  try {
    const path = cacheKey(projectId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as Drawing[];
  } catch {
    return null;
  }
}

async function writeCache(projectId: string, drawings: Drawing[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(cacheKey(projectId), JSON.stringify(drawings));
  } catch {
    // Non-fatal — cache write failure must not break the fetch result.
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const drawingsApi = {
  list: async (
    projectId: string,
    params?: { discipline?: string; status?: string; search?: string },
  ): Promise<Drawing[]> => {
    try {
      const res = await apiClient.get<{ drawings: RawDrawing[] }>(
        `/projects/${projectId}/drawings`,
        { params },
      );
      const drawings = res.data.drawings.map(normalize);
      await writeCache(projectId, drawings);
      return drawings;
    } catch (err) {
      const cached = await readCache(projectId);
      if (cached !== null) return cached;
      throw err;
    }
  },

  get: async (projectId: string, drawingId: string): Promise<Drawing> => {
    const res = await apiClient.get<{ drawing: RawDrawing }>(
      `/projects/${projectId}/drawings/${drawingId}`,
    );
    return normalize(res.data.drawing);
  },
};
