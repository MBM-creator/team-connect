import { describe, expect, it } from 'vitest';
import type { CcProject } from '@/lib/cc-client';
import {
  buildJobListRowModel,
  clearJobsListFilters,
  filterJobsByTab,
  formatCcStatusLabel,
  hasActiveJobsListFilters,
  isCompletedJob,
  jobMatchesSearch,
  jobMatchesStatusFilter,
  lifecycleStatusChipTone,
  projectMatchesSearch,
  statusOptionsForTab,
  type JobsListJob,
} from '@/lib/jobs-list';

function makeJob(overrides: Partial<JobsListJob> & Pick<JobsListJob, 'id'>): JobsListJob {
  return {
    organisation_id: 'org-1',
    name: overrides.name ?? 'Job',
    site_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<CcProject> & Pick<CcProject, 'project_id'>): CcProject {
  return {
    quote_id: null,
    cc_job_id: null,
    cc_job_number: null,
    client_id: 'client-1',
    project_title: 'Project',
    client_name: 'Client',
    client_contact: null,
    site_address: null,
    status: 'wip',
    trades: [],
    sections: [],
    ...overrides,
  };
}

describe('jobs list — Active / Completed mapping', () => {
  it('treats only hidden_from_qa_at jobs as completed', () => {
    const active = makeJob({ id: 'job-active', hidden_from_qa_at: null });
    const completed = makeJob({ id: 'job-done', hidden_from_qa_at: '2026-07-01T12:00:00.000Z' });

    expect(isCompletedJob(active)).toBe(false);
    expect(isCompletedJob(completed)).toBe(true);
    expect(filterJobsByTab([active, completed], 'active').map((j) => j.id)).toEqual(['job-active']);
    expect(filterJobsByTab([active, completed], 'completed').map((j) => j.id)).toEqual(['job-done']);
  });
});

describe('jobs list — same-client jobs remain separate', () => {
  it('keeps multiple jobs for one client when project IDs differ', () => {
    const jobs = [
      makeJob({
        id: 'job-a',
        cc_client_id: 'client-same',
        cc_client_name_snapshot: 'Alex Client',
        cc_project_id: 'project-1',
        cc_project_title_snapshot: 'Fence front',
      }),
      makeJob({
        id: 'job-b',
        cc_client_id: 'client-same',
        cc_client_name_snapshot: 'Alex Client',
        cc_project_id: 'project-2',
        cc_project_title_snapshot: 'Fence rear',
      }),
    ];

    // No client-level merge: both rows stay when filtered only by tab.
    const active = filterJobsByTab(jobs, 'active');
    expect(active).toHaveLength(2);
    expect(active.map((j) => j.id).sort()).toEqual(['job-a', 'job-b']);

    const keys = active.map((j) => j.id);
    expect(new Set(keys).size).toBe(2);
  });

  it('uses unique job id for each rendered row model', () => {
    const jobs = [
      makeJob({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cc_client_name_snapshot: 'Same Client',
        cc_project_title_snapshot: 'Site A',
        cc_project_id: 'proj-a',
      }),
      makeJob({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        cc_client_name_snapshot: 'Same Client',
        cc_project_title_snapshot: 'Site B',
        cc_project_id: 'proj-b',
      }),
    ];

    const rows = jobs.map((job) => buildJobListRowModel(job, 'mbm', null));
    expect(rows.map((r) => r.id)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    expect(rows.every((r) => r.clientName === 'Same Client')).toBe(true);
  });
});

describe('jobs list — search', () => {
  it('matches client name, project title, and suburb/address case-insensitively', () => {
    const job = makeJob({
      id: 'job-1',
      cc_client_name_snapshot: 'Justin Manchester',
      cc_project_title_snapshot: 'Front fence install',
      cc_site_address_snapshot: '64 Glass St, Essendon',
      site_location: 'Essendon',
    });

    expect(jobMatchesSearch(job, 'justin', null)).toBe(true);
    expect(jobMatchesSearch(job, 'FRONT FENCE', null)).toBe(true);
    expect(jobMatchesSearch(job, 'essendon', null)).toBe(true);
    expect(jobMatchesSearch(job, 'glass', null)).toBe(true);
    expect(jobMatchesSearch(job, 'nowhere', null)).toBe(false);
  });

  it('matches available CC projects by client, title, and address', () => {
    const project = makeProject({
      project_id: 'p1',
      client_name: 'Sam Taylor',
      project_title: 'Deck rebuild',
      site_address: '12 High St, Brunswick',
    });

    expect(projectMatchesSearch(project, 'sam')).toBe(true);
    expect(projectMatchesSearch(project, 'deck')).toBe(true);
    expect(projectMatchesSearch(project, 'brunswick')).toBe(true);
    expect(projectMatchesSearch(project, 'xyz')).toBe(false);
  });
});

describe('jobs list — status filter with tab', () => {
  it('derives status options from statuses present in the current tab', () => {
    const options = statusOptionsForTab(['wip', 'deposit_paid', 'wip', null, '']);
    expect(options.map((o) => o.value)).toEqual(['wip', 'deposit_paid']);
    expect(options[0].label).toBe('WIP');
    expect(options[1].label).toBe('Deposit paid');
  });

  it('filters by selected status and allows all statuses', () => {
    expect(jobMatchesStatusFilter('wip', '')).toBe(true);
    expect(jobMatchesStatusFilter('wip', 'wip')).toBe(true);
    expect(jobMatchesStatusFilter('deposit_paid', 'wip')).toBe(false);
    expect(jobMatchesStatusFilter(null, 'wip')).toBe(false);
    expect(jobMatchesStatusFilter(null, '')).toBe(true);
  });

  it('completed tab only includes completed jobs when combining tab + status', () => {
    const jobs = [
      makeJob({ id: 'a', hidden_from_qa_at: null }),
      makeJob({ id: 'b', hidden_from_qa_at: '2026-06-01T00:00:00.000Z' }),
    ];
    const completed = filterJobsByTab(jobs, 'completed');
    expect(completed.map((j) => j.id)).toEqual(['b']);
  });
});

describe('jobs list — optional fields and navigation', () => {
  it('omits empty optional fields from the row model', () => {
    const row = buildJobListRowModel(
      makeJob({
        id: 'job-sparse',
        name: 'Sparse Client',
        cc_client_name_snapshot: 'Sparse Client',
      }),
      'mbm',
      null
    );

    expect(row.clientName).toBe('Sparse Client');
    expect(row.phone).toBeNull();
    expect(row.location).toBeNull();
    expect(row.status).toBeNull();
    // Title hidden when it matches client name
    expect(row.projectTitle).toBeNull();
  });

  it('preserves job open href using job id', () => {
    const row = buildJobListRowModel(
      makeJob({ id: 'job-nav-1', cc_client_name_snapshot: 'Nav Client' }),
      'made-by-mobbs',
      null
    );
    expect(row.href).toBe('/t/made-by-mobbs/jobs/job-nav-1');
  });

  it('shows project title when distinct from client name', () => {
    const row = buildJobListRowModel(
      makeJob({
        id: 'job-title',
        cc_client_name_snapshot: 'Alex Client',
        cc_project_title_snapshot: 'Rear paling fence',
      }),
      'mbm',
      null
    );
    expect(row.clientName).toBe('Alex Client');
    expect(row.projectTitle).toBe('Rear paling fence');
  });
});

describe('jobs list — clear filters', () => {
  it('clearing filters restores empty search and all-status selection', () => {
    expect(hasActiveJobsListFilters('essendon', 'wip')).toBe(true);
    expect(hasActiveJobsListFilters('', '')).toBe(false);
    expect(clearJobsListFilters()).toEqual({ searchQuery: '', statusFilter: '' });
  });

  it('after clear, all tab jobs match again', () => {
    const jobs = [
      makeJob({
        id: 'job-1',
        cc_client_name_snapshot: 'Alpha',
        site_location: 'Essendon',
      }),
      makeJob({
        id: 'job-2',
        cc_client_name_snapshot: 'Beta',
        site_location: 'Brunswick',
      }),
    ];
    const cleared = clearJobsListFilters();
    const restored = filterJobsByTab(jobs, 'active').filter((job) =>
      jobMatchesSearch(job, cleared.searchQuery, null)
    );
    expect(restored).toHaveLength(2);
  });
});

describe('jobs list — lifecycle status chip tones', () => {
  it('maps active/in-progress pipeline stages to active tone', () => {
    expect(lifecycleStatusChipTone('wip')).toBe('active');
    expect(lifecycleStatusChipTone('active')).toBe('active');
  });

  it('maps planning and pre-site milestones to info (not attention)', () => {
    expect(lifecycleStatusChipTone('planning')).toBe('info');
    expect(lifecycleStatusChipTone('quote_accepted')).toBe('info');
    expect(lifecycleStatusChipTone('deposit_paid')).toBe('info');
    expect(lifecycleStatusChipTone('prestart_date_set')).toBe('info');
    expect(lifecycleStatusChipTone('prestart_paid')).toBe('info');
  });

  it('falls back to neutral for unknown or empty status', () => {
    expect(lifecycleStatusChipTone(null)).toBe('neutral');
    expect(lifecycleStatusChipTone(undefined)).toBe('neutral');
    expect(lifecycleStatusChipTone('')).toBe('neutral');
    expect(lifecycleStatusChipTone('unknown_stage')).toBe('neutral');
  });
});

describe('jobs list — status presentation labels', () => {
  it('shows WIP not Wip for the wip lifecycle stage', () => {
    expect(formatCcStatusLabel('wip')).toBe('WIP');
    expect(formatCcStatusLabel('WIP')).toBe('WIP');
  });

  it('title-cases known underscored statuses without changing stored values', () => {
    expect(formatCcStatusLabel('quote_accepted')).toBe('Quote accepted');
    expect(formatCcStatusLabel('deposit_paid')).toBe('Deposit paid');
    expect(formatCcStatusLabel('prestart_date_set')).toBe('Prestart date set');
    expect(formatCcStatusLabel('prestart_paid')).toBe('Prestart paid');
    expect(formatCcStatusLabel('planning')).toBe('Planning');
    expect(formatCcStatusLabel('active')).toBe('Active');
  });

  it('returns null for empty status', () => {
    expect(formatCcStatusLabel(null)).toBeNull();
    expect(formatCcStatusLabel(undefined)).toBeNull();
    expect(formatCcStatusLabel('')).toBeNull();
    expect(formatCcStatusLabel('   ')).toBeNull();
  });
});
