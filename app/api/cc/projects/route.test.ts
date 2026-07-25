import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB_ID = '99999999-9999-4999-8999-999999999999';
const PROJECT_LINKED = '11111111-1111-4111-8111-111111111111';
const PROJECT_OTHER = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

const guardStaffApi = vi.fn();
const validateJobForOrg = vi.fn();
const fetchCcProjects = vi.fn();

vi.mock('@/lib/guard-staff-api', () => ({
  guardStaffApi: (...args: unknown[]) => guardStaffApi(...args),
}));

vi.mock('@/lib/job-org-validation', () => ({
  validateJobForOrg: (...args: unknown[]) => validateJobForOrg(...args),
}));

vi.mock('@/lib/cc-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cc-client')>('@/lib/cc-client');
  return {
    ...actual,
    fetchCcProjects: (...args: unknown[]) => fetchCcProjects(...args),
  };
});

function makeProject(projectId: string) {
  return {
    project_id: projectId,
    quote_id: null,
    cc_job_id: null,
    cc_job_number: null,
    client_id: CLIENT_ID,
    project_title: `Project ${projectId.slice(0, 8)}`,
    client_name: 'Client',
    client_contact: '0400111222',
    site_address: '10 Example Rd',
    status: 'wip' as const,
    trades: ['fencing' as const],
    sections: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Fence', trade: 'fencing' as const }],
  };
}

describe('GET /api/cc/projects', () => {
  const original = process.env.CC_INTEGRATION_ORG_IDS;

  beforeEach(() => {
    guardStaffApi.mockReset();
    validateJobForOrg.mockReset();
    fetchCcProjects.mockReset();
    process.env.CC_INTEGRATION_ORG_IDS = ORG_A;
    process.env.CC_BASE_URL = 'https://cc.example.test';
    fetchCcProjects.mockResolvedValue([makeProject(PROJECT_LINKED), makeProject(PROJECT_OTHER)]);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CC_INTEGRATION_ORG_IDS;
    else process.env.CC_INTEGRATION_ORG_IDS = original;
  });

  async function getRoute() {
    return import('./route');
  }

  it('rejects missing orgSlug with 400', async () => {
    guardStaffApi.mockResolvedValue(
      NextResponse.json({ ok: false, message: 'orgSlug is required' }, { status: 400 })
    );
    const { GET } = await getRoute();
    const res = await GET(new NextRequest('http://localhost/api/cc/projects'));
    expect(res.status).toBe(400);
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests with 401', async () => {
    guardStaffApi.mockResolvedValue(
      NextResponse.json({ ok: false, message: 'Sign in required' }, { status: 401 })
    );
    const { GET } = await getRoute();
    const res = await GET(
      new NextRequest('http://localhost/api/cc/projects?orgSlug=other')
    );
    expect(res.status).toBe(401);
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('rejects authenticated users without organisation access with 403', async () => {
    guardStaffApi.mockResolvedValue(
      NextResponse.json(
        { ok: false, message: 'You do not have access to this organisation' },
        { status: 403 }
      )
    );
    const { GET } = await getRoute();
    const res = await GET(
      new NextRequest('http://localhost/api/cc/projects?orgSlug=other')
    );
    expect(res.status).toBe(403);
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('fails closed for unlisted organisations without fetching upstream', async () => {
    guardStaffApi.mockResolvedValue({
      staff: { id: 'u1', org_id: ORG_B, full_name: 'X', email: 'x@y.z', role: 'admin', active: true },
      org: { id: ORG_B, slug: 'other', name: 'Other' },
      user: { id: 'u1', email: 'x@y.z' },
    });
    const { GET } = await getRoute();
    const res = await GET(
      new NextRequest('http://localhost/api/cc/projects?orgSlug=other')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.projects).toEqual([]);
    expect(body.ccUnavailable).toBe(true);
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('returns operational selection feed for an allowlisted org', async () => {
    guardStaffApi.mockResolvedValue({
      staff: { id: 'u1', org_id: ORG_A, full_name: 'X', email: 'x@y.z', role: 'admin', active: true },
      org: { id: ORG_A, slug: 'madebymobbs', name: 'Made By Mobbs' },
      user: { id: 'u1', email: 'x@y.z' },
    });
    const { GET } = await getRoute();
    const res = await GET(
      new NextRequest('http://localhost/api/cc/projects?orgSlug=madebymobbs')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.projects).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('total_inc_gst');
    expect(JSON.stringify(body)).not.toContain('variations');
    expect(fetchCcProjects).toHaveBeenCalledWith(ORG_A, expect.any(String));
  });

  it('linked-job mode returns only the authorised linked project', async () => {
    guardStaffApi.mockResolvedValue({
      staff: { id: 'u1', org_id: ORG_A, full_name: 'X', email: 'x@y.z', role: 'field', active: true },
      org: { id: ORG_A, slug: 'madebymobbs', name: 'Made By Mobbs' },
      user: { id: 'u1', email: 'x@y.z' },
    });
    validateJobForOrg.mockResolvedValue({
      ok: true,
      organisationId: ORG_A,
      job: {
        id: JOB_ID,
        name: 'Job',
        active_stage_id: null,
        cc_project_id: PROJECT_LINKED,
        cc_quote_id: null,
        cc_job_id: null,
        cc_client_id: CLIENT_ID,
        cc_project_title_snapshot: 'Linked',
        cc_client_name_snapshot: 'Client',
      },
    });

    const { GET } = await getRoute();
    const res = await GET(
      new NextRequest(
        `http://localhost/api/cc/projects?orgSlug=madebymobbs&jobId=${JOB_ID}&projectId=${PROJECT_OTHER}`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].project_id).toBe(PROJECT_LINKED);
    expect(body.projects[0].project_id).not.toBe(PROJECT_OTHER);
  });
});
