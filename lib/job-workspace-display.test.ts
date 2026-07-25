import { describe, expect, it } from 'vitest';
import type { CcProject } from '@/lib/cc-client';
import { formatCcStatusLabel, lifecycleStatusChipTone } from '@/lib/jobs-list';
import {
  buildJobWorkspaceIdentityModel,
  buildJobWorkspaceSections,
  buildJobWorkspaceSummaryFields,
  jobWorkspaceJobsListHref,
  resolveActiveJobWorkspaceSection,
  resolveJobWorkspaceHealth,
  type JobWorkspaceJobInput,
} from '@/lib/job-workspace-display';

function makeJob(
  overrides: Partial<JobWorkspaceJobInput> & Pick<JobWorkspaceJobInput, 'id'>
): JobWorkspaceJobInput {
  return {
    name: overrides.name ?? 'Job',
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<CcProject> & Pick<CcProject, 'project_id'>
): CcProject {
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

describe('job workspace — selected by unique job id', () => {
  it('identity model carries the selected job UUID, not client name', () => {
    const job = makeJob({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Fence front',
      cc_client_name_snapshot: 'Alex Client',
      cc_project_title_snapshot: 'Fence front',
    });

    const model = buildJobWorkspaceIdentityModel({ job, project: null });
    expect(model.jobId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('keeps two jobs for the same client as distinct identity models', () => {
    const jobA = makeJob({
      id: 'job-a-uuid',
      name: 'Fence front',
      cc_client_name_snapshot: 'Alex Client',
      cc_project_title_snapshot: 'Fence front',
      cc_project_id: 'proj-1',
    });
    const jobB = makeJob({
      id: 'job-b-uuid',
      name: 'Fence rear',
      cc_client_name_snapshot: 'Alex Client',
      cc_project_title_snapshot: 'Fence rear',
      cc_project_id: 'proj-2',
    });

    const a = buildJobWorkspaceIdentityModel({
      job: jobA,
      project: makeProject({
        project_id: 'proj-1',
        client_name: 'Alex Client',
        project_title: 'Fence front',
        status: 'wip',
      }),
    });
    const b = buildJobWorkspaceIdentityModel({
      job: jobB,
      project: makeProject({
        project_id: 'proj-2',
        client_name: 'Alex Client',
        project_title: 'Fence rear',
        status: 'wip',
      }),
    });

    expect(a.jobId).toBe('job-a-uuid');
    expect(b.jobId).toBe('job-b-uuid');
    expect(a.jobId).not.toBe(b.jobId);
    expect(a.primaryHeading).toBe('Fence front');
    expect(b.primaryHeading).toBe('Fence rear');
    expect(a.supportingClientName).toBe('Alex Client');
    expect(b.supportingClientName).toBe('Alex Client');
  });
});

describe('job workspace — display hierarchy', () => {
  it('uses project title as primary heading when distinct from client name', () => {
    const model = buildJobWorkspaceIdentityModel({
      job: makeJob({
        id: 'job-1',
        name: 'Rear fence',
        cc_client_name_snapshot: 'Alex Client',
        cc_project_title_snapshot: 'Rear fence',
        cc_job_number: 'J-100',
      }),
      project: makeProject({
        project_id: 'p1',
        client_name: 'Alex Client',
        project_title: 'Rear fence',
        site_address: '12 Smith St, Richmond, VIC 3121',
        status: 'wip',
        client_contact: '0409123456',
      }),
    });

    expect(model.primaryHeading).toBe('Rear fence');
    expect(model.supportingClientName).toBe('Alex Client');
    expect(model.suburb).toBe('Richmond');
    expect(model.lifecycleStatus).toBe('wip');
    expect(model.lifecycleStatusLabel).toBe('WIP');
    expect(model.jobReference).toBe('J-100');
  });

  it('uses client name as primary when no meaningful distinct project title exists', () => {
    const model = buildJobWorkspaceIdentityModel({
      job: makeJob({
        id: 'job-2',
        name: 'Alex Client',
        cc_client_name_snapshot: 'Alex Client',
        cc_project_title_snapshot: 'Alex Client',
      }),
      project: makeProject({
        project_id: 'p2',
        client_name: 'Alex Client',
        project_title: 'Alex Client',
        status: 'planning',
      }),
    });

    expect(model.primaryHeading).toBe('Alex Client');
    expect(model.supportingClientName).toBeNull();
  });

  it('does not repeat the same text as primary and supporting', () => {
    const model = buildJobWorkspaceIdentityModel({
      job: makeJob({
        id: 'job-3',
        name: 'Same Text',
        cc_client_name_snapshot: 'Same Text',
        cc_project_title_snapshot: 'Same Text',
      }),
      project: null,
    });

    expect(model.primaryHeading).toBe('Same Text');
    expect(model.supportingClientName).toBeNull();
  });
});

describe('job workspace — summary fields', () => {
  it('includes address, formatted phone, and stage when available', () => {
    const fields = buildJobWorkspaceSummaryFields({
      job: makeJob({ id: 'job-1', name: 'Job' }),
      project: makeProject({
        project_id: 'p1',
        client_name: 'Alex',
        site_address: '12 Smith St, Richmond, VIC 3121',
        client_contact: '0409123456',
      }),
      activeStageName: 'Fencing',
    });

    expect(fields.map((f) => f.key)).toEqual(['address', 'phone', 'stage']);
    expect(fields.find((f) => f.key === 'phone')).toMatchObject({
      value: '0409 123 456',
      telHref: '0409123456',
    });
    expect(fields.find((f) => f.key === 'stage')?.value).toBe('Fencing');
  });

  it('omits missing optional fields without placeholders', () => {
    const fields = buildJobWorkspaceSummaryFields({
      job: makeJob({ id: 'job-sparse', name: 'Sparse Job' }),
      project: null,
      activeStageName: null,
    });

    expect(fields).toEqual([]);
  });
});

describe('job workspace — lifecycle and health', () => {
  it('reuses shared lifecycle status mapping including WIP', () => {
    const model = buildJobWorkspaceIdentityModel({
      job: makeJob({ id: 'job-wip', name: 'Job' }),
      project: makeProject({ project_id: 'p1', status: 'wip' }),
    });

    expect(model.lifecycleStatusLabel).toBe(formatCcStatusLabel('wip'));
    expect(lifecycleStatusChipTone(model.lifecycleStatus)).toBe('active');
  });

  it('does not invent health without explicit data', () => {
    expect(resolveJobWorkspaceHealth(null)).toBeNull();
    expect(resolveJobWorkspaceHealth(undefined)).toBeNull();
    expect(resolveJobWorkspaceHealth({ label: null })).toBeNull();
    expect(resolveJobWorkspaceHealth({ label: '   ' })).toBeNull();
  });

  it('returns explicit health label only when provided', () => {
    expect(resolveJobWorkspaceHealth({ label: 'Attention required' })).toBe('Attention required');
  });
});

describe('job workspace — navigation', () => {
  it('exposes every top-level workspace destination for the job id', () => {
    const sections = buildJobWorkspaceSections({
      orgSlug: 'mbm',
      jobId: 'job-uuid-1',
      activeStageId: 'stage-1',
    });

    expect(sections.map((s) => s.id)).toEqual(['overview', 'today', 'qa', 'notes']);
    expect(sections.find((s) => s.id === 'overview')?.href).toBe('/t/mbm/jobs/job-uuid-1');
    expect(sections.find((s) => s.id === 'today')?.href).toBe('/t/mbm/jobs/job-uuid-1/today');
    expect(sections.find((s) => s.id === 'qa')?.href).toBe('/t/mbm/jobs/job-uuid-1/qa');
    expect(sections.find((s) => s.id === 'notes')?.href).toContain('/t/mbm/jobs/job-uuid-1/notes');
    expect(sections.find((s) => s.id === 'notes')?.href).toContain('mode=capture');
  });

  it('resolves active section from pathname', () => {
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1')).toBe('overview');
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1/today')).toBe('today');
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1/qa')).toBe('qa');
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1/qa/fencing/run-1')).toBe('qa');
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1/notes?mode=capture')).toBe('notes');
    expect(resolveActiveJobWorkspaceSection('/t/mbm/jobs/job-1/daily-plan')).toBe('today');
  });

  it('preserves back-to-jobs destination', () => {
    expect(jobWorkspaceJobsListHref('mbm')).toBe('/t/mbm/jobs');
  });
});
