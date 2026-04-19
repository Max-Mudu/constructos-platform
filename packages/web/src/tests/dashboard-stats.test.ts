/**
 * Unit tests for dashboard stat derivation logic.
 * These mirror the computations in dashboard/page.tsx so we can verify
 * the filtering and aggregation without rendering the full component.
 */

import { Project } from '@/lib/types';

type ProjectStatus = Project['status'];

function deriveStats(projects: Project[]) {
  const activeProjects = projects.filter((p) => p.status === 'active').length;
  const totalSites = projects.reduce(
    (sum, p) => sum + (p._count?.jobSites ?? 0),
    0,
  );
  return { activeProjects, totalSites };
}

function makeProject(
  overrides: Partial<Project> & { status: ProjectStatus },
): Project {
  return {
    id: 'p-1',
    companyId: 'c-1',
    name: 'Test',
    code: null,
    description: null,
    startDate: null,
    endDate: null,
    location: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('dashboard stat derivation', () => {
  it('counts zero when no projects', () => {
    expect(deriveStats([])).toEqual({ activeProjects: 0, totalSites: 0 });
  });

  it('counts only active projects', () => {
    const projects = [
      makeProject({ id: 'p-1', status: 'active' }),
      makeProject({ id: 'p-2', status: 'planning' }),
      makeProject({ id: 'p-3', status: 'completed' }),
      makeProject({ id: 'p-4', status: 'active' }),
    ];
    expect(deriveStats(projects).activeProjects).toBe(2);
  });

  it('sums job site counts across all projects', () => {
    const projects = [
      makeProject({ id: 'p-1', status: 'active', _count: { jobSites: 3, projectMembers: 0 } }),
      makeProject({ id: 'p-2', status: 'planning', _count: { jobSites: 1, projectMembers: 0 } }),
      makeProject({ id: 'p-3', status: 'completed', _count: { jobSites: 5, projectMembers: 0 } }),
    ];
    expect(deriveStats(projects).totalSites).toBe(9);
  });

  it('handles missing _count gracefully (treats as 0)', () => {
    const projects = [
      makeProject({ id: 'p-1', status: 'active' }), // no _count
      makeProject({ id: 'p-2', status: 'active', _count: { jobSites: 2, projectMembers: 0 } }),
    ];
    expect(deriveStats(projects).totalSites).toBe(2);
  });

  it('all on_hold projects count as 0 active', () => {
    const projects = [
      makeProject({ id: 'p-1', status: 'on_hold' }),
      makeProject({ id: 'p-2', status: 'on_hold' }),
    ];
    expect(deriveStats(projects).activeProjects).toBe(0);
  });

  it('archived projects are not counted as active', () => {
    const projects = [
      makeProject({ id: 'p-1', status: 'archived' }),
      makeProject({ id: 'p-2', status: 'active' }),
    ];
    expect(deriveStats(projects).activeProjects).toBe(1);
  });
});
