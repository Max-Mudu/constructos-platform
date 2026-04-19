import { apiClient } from './client';
import { Project, JobSite } from '../types';

export const projectsApi = {
  list: async (): Promise<Project[]> => {
    const res = await apiClient.get<{ projects: Project[] }>('/projects');
    return res.data.projects;
  },

  get: async (projectId: string): Promise<Project> => {
    const res = await apiClient.get<{ project: Project }>(`/projects/${projectId}`);
    return res.data.project;
  },

  listSites: async (projectId: string): Promise<JobSite[]> => {
    const res = await apiClient.get<{ sites: JobSite[] }>(`/projects/${projectId}/sites`);
    return res.data.sites;
  },

  getSite: async (projectId: string, siteId: string): Promise<JobSite> => {
    const res = await apiClient.get<{ site: JobSite }>(`/projects/${projectId}/sites/${siteId}`);
    return res.data.site;
  },
};
