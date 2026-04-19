import { apiClient } from './client';
import { Instruction, InstructionType, InstructionPriority } from '../types';

export const instructionsApi = {
  list: async (
    projectId: string,
    params?: { status?: string; priority?: string; siteId?: string },
  ): Promise<Instruction[]> => {
    const res = await apiClient.get<{ instructions: Instruction[] }>(
      `/projects/${projectId}/instructions`,
      { params },
    );
    return res.data.instructions;
  },

  get: async (projectId: string, instructionId: string): Promise<Instruction> => {
    const res = await apiClient.get<{ instruction: Instruction }>(
      `/projects/${projectId}/instructions/${instructionId}`,
    );
    return res.data.instruction;
  },

  create: async (
    projectId: string,
    data: {
      type:             InstructionType;
      title:            string;
      priority:         InstructionPriority;
      issuedDate:       string;
      description?:     string;
      category?:        string;
      targetActionDate?: string;
      siteId?:          string;
    },
  ): Promise<Instruction> => {
    const res = await apiClient.post<{ instruction: Instruction }>(
      `/projects/${projectId}/instructions`,
      data,
    );
    return res.data.instruction;
  },

  updateStatus: async (
    projectId: string,
    instructionId: string,
    status: string,
    resolutionNotes?: string,
  ): Promise<Instruction> => {
    const res = await apiClient.patch<{ instruction: Instruction }>(
      `/projects/${projectId}/instructions/${instructionId}`,
      { status, resolutionNotes },
    );
    return res.data.instruction;
  },
};
