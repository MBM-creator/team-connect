import { describe, expect, it } from 'vitest';
import { canonicalJobNumber, jobNumberLabel } from './job-number';
import { enrichJobsWithSiteLocation } from './job-site-location';
import { buildJobListRowModel, jobMatchesSearch } from './jobs-list';
import { buildJobWorkspaceIdentityModel } from './job-workspace-display';

const project = { project_id: 'project-1', quote_id: 'quote-1', cc_job_id: null,
  cc_job_number: '304', client_id: 'client-1', project_title: 'Paving',
  client_name: 'Alex', client_contact: null, site_address: null,
  status: 'wip' as const, trades: [], sections: [] };

describe('CC-owned job number across job screens', () => {
  it('refreshes a saved job by its stable project UUID', () => {
    const job = { id: 'job-1', name: 'Paving', cc_project_id: 'project-1', cc_job_number: null };
    const [result] = enrichJobsWithSiteLocation([job], [project]);
    expect(result.cc_job_number).toBe('304');
    expect(buildJobWorkspaceIdentityModel({ job, project }).jobReference).toBe('304');
  });
  it('supports existing quote UUID links without matching by title', () => {
    expect(canonicalJobNumber({ cc_quote_id: 'quote-1' }, project)).toBe('304');
    expect(canonicalJobNumber({ cc_project_id: 'other-project' }, project)).toBeNull();
  });
  it('retains the cached value during a sync failure but respects an authoritative null', () => {
    const job = { cc_project_id: 'project-1', cc_job_number: '304' };
    expect(canonicalJobNumber(job, null)).toBe('304');
    expect(canonicalJobNumber(job, { ...project, cc_job_number: null })).toBeNull();
    expect(jobNumberLabel(null)).toBe('Job number not assigned');
  });
  it('includes the canonical number in list display and search', () => {
    const job = { id: 'job-1', name: 'Paving', organisation_id: 'org-1', site_id: null,
      created_at: '', cc_project_id: 'project-1' };
    expect(buildJobListRowModel(job, 'mbm', project).jobNumber).toBe('304');
    expect(jobMatchesSearch(job, '304', project)).toBe(true);
    expect(buildJobListRowModel(job, 'mbm', { ...project, project_id: 'other', quote_id: 'other' }).jobNumber).toBeNull();
  });
});
