import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_ID = '11111111-1111-4111-8111-111111111111';

const guardStaffApi = vi.fn();
const fetchCcProjects = vi.fn();
const syncCcProjectStagesForJob = vi.fn();
const from = vi.fn();

vi.mock('@/lib/guard-staff-api', () => ({
  guardStaffApi: (...args: unknown[]) => guardStaffApi(...args),
}));

vi.mock('@/lib/cc-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cc-client')>('@/lib/cc-client');
  return {
    ...actual,
    fetchCcProjects: (...args: unknown[]) => fetchCcProjects(...args),
  };
});

vi.mock('@/lib/sync-cc-project-stages', () => ({
  syncCcProjectStagesForJob: (...args: unknown[]) => syncCcProjectStagesForJob(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

describe('GET /api/jobs fast list', () => {
  beforeEach(() => {
    guardStaffApi.mockReset();
    fetchCcProjects.mockReset();
    syncCcProjectStagesForJob.mockReset();
    from.mockReset();

    guardStaffApi.mockResolvedValue({
      staff: {
        id: 'staff-1',
        org_id: ORG_ID,
        full_name: 'Admin',
        email: 'admin@example.test',
        role: 'admin',
        active: true,
      },
      org: { id: ORG_ID, slug: 'madebymobbs', name: 'Made By Mobbs' },
      user: { id: 'staff-1', email: 'admin@example.test' },
    });

    const savedJobs = [
      {
        id: JOB_ID,
        organisation_id: ORG_ID,
        name: 'Richmond garden',
        site_id: null,
        created_at: '2026-10-01T00:00:00.000Z',
        active_stage_id: null,
        cc_project_id: null,
        cc_quote_id: null,
        cc_job_id: null,
        cc_job_number: null,
        cc_client_id: null,
        cc_project_title_snapshot: 'Richmond garden',
        cc_client_name_snapshot: 'Example Client',
        cc_site_address_snapshot: '10 Example Street, Richmond VIC 3121',
        hidden_from_qa_at: null,
      },
    ];

    from.mockImplementation((table: string) => {
      if (table !== 'jobs') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            is: vi.fn().mockResolvedValue({ data: savedJobs, error: null }),
          }),
        }),
      };
    });
  });

  it('returns saved jobs without waiting for Client Connect or writing stages', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/jobs?orgSlug=madebymobbs&sync=false')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.viewerRole).toBe('admin');
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].site_location).toBe('Richmond VIC 3121');
    expect(fetchCcProjects).not.toHaveBeenCalled();
    expect(syncCcProjectStagesForJob).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('jobs');
  });
});
