import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { CcProject } from '@/lib/cc-client';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  guard: vi.fn(),
  projects: vi.fn(),
  allowed: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock('@/lib/guard-staff-api', () => ({ guardStaffApi: mocks.guard }));
vi.mock('@/lib/cc-client', async () => ({
  ...await vi.importActual<typeof import('@/lib/cc-client')>('@/lib/cc-client'),
  fetchCcProjects: mocks.projects,
}));
vi.mock('@/lib/cc-integration-access', () => ({
  isCcIntegrationOrgAllowed: mocks.allowed,
  ccIntegrationUnavailableWarning: () => 'Unavailable',
}));

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const project: CcProject = {
  project_id: PROJECT_ID, quote_id: null, cc_job_id: null, cc_job_number: null,
  client_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', project_title: 'Garden renovation', client_name: 'Client',
  client_contact: null, site_address: '10 Example Road', status: 'wip',
  trades: ['fencing'],
  sections: [{ id: STAGE_ID, name: 'Fencing', trade: 'fencing' }],
};
const job = {
  id: JOB_ID, organisation_id: ORG_ID, name: project.project_title,
  cc_project_id: PROJECT_ID, cc_quote_id: null, cc_job_id: null,
  cc_job_number: null, active_stage_id: STAGE_ID,
};

// Queue the database operations and fail on any unexpected table access,
// including stage reads, writes or deletion.
function queueQuery(table: string, data: unknown) {
  const result = { data, error: null };
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  mocks.from.mockImplementationOnce((actualTable: string) => {
    expect(actualTable).toBe(table);
    return query;
  });
  return query;
}

function patchRequest(projectId: string | null) {
  return new NextRequest(`http://localhost/api/jobs/${JOB_ID}/cc-mapping?orgSlug=madebymobbs`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cc_project_id: projectId }),
  });
}

describe('Client Connect job operations preserve stages without importing sections', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.from.mockImplementation((table: string) => { throw new Error(`Unexpected table: ${table}`); });
    mocks.guard.mockResolvedValue({ org: { id: ORG_ID } });
    mocks.allowed.mockReturnValue(true);
    mocks.projects.mockResolvedValue([project]);
  });

  it.each([false, true])('refreshes jobs (existing=%s) without touching stages or active stage', async (existing) => {
    queueQuery('organisations', { id: ORG_ID });
    queueQuery('jobs', existing ? [job] : []);
    const write = queueQuery('jobs', { ...job, active_stage_id: existing ? STAGE_ID : null });
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/jobs?orgSlug=madebymobbs'));
    expect(response.status).toBe(200);
    expect((await response.json()).jobs[0].active_stage_id).toBe(existing ? STAGE_ID : null);
    expect(existing ? write.update : write.insert).toHaveBeenCalledWith(expect.objectContaining({ cc_project_id: PROJECT_ID }));
    expect((existing ? write.update : write.insert).mock.calls[0][0]).not.toHaveProperty('active_stage_id');
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['organisations', 'jobs', 'jobs']);
  });

  it('creates a linked job with sections but no imported stages', async () => {
    queueQuery('organisations', { id: ORG_ID });
    queueQuery('jobs', []);
    const write = queueQuery('jobs', { ...job, active_stage_id: null });
    const { POST } = await import('./route');
    const response = await POST(new NextRequest('http://localhost/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgSlug: 'madebymobbs', ccProjectId: PROJECT_ID }),
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).job.active_stage_id).toBeNull();
    expect(write.insert.mock.calls[0][0]).not.toHaveProperty('active_stage_id');
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['organisations', 'jobs', 'jobs']);
  });

  it.each([PROJECT_ID, null])('updates project link to %s without modifying existing stages', async (projectId) => {
    queueQuery('organisations', { id: ORG_ID });
    queueQuery('jobs', { id: JOB_ID });
    if (projectId) queueQuery('jobs', []);
    const write = queueQuery('jobs', { ...job, cc_project_id: projectId });
    const { PATCH } = await import('./[jobId]/cc-mapping/route');
    const response = await PATCH(patchRequest(projectId), { params: Promise.resolve({ jobId: JOB_ID }) });
    expect(response.status).toBe(200);
    expect((await response.json()).job.active_stage_id).toBe(STAGE_ID);
    expect(write.update.mock.calls[0][0]).not.toHaveProperty('active_stage_id');
    expect(mocks.from.mock.calls.every(([table]) => table !== 'stages')).toBe(true);
  });

  it('retains staff authorisation before reading or updating project links', async () => {
    mocks.guard.mockResolvedValue(NextResponse.json({ ok: false }, { status: 403 }));
    const { PATCH } = await import('./[jobId]/cc-mapping/route');
    const response = await PATCH(patchRequest(PROJECT_ID), { params: Promise.resolve({ jobId: JOB_ID }) });
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.projects).not.toHaveBeenCalled();
  });
});
