import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCcProjectsCacheForTests,
  fetchCcProjects,
  toCcProjectOperationalSummary,
  type CcProject,
} from '@/lib/cc-client';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const CLIENT_A = '33333333-3333-4333-8333-333333333333';

function upstreamProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    project_id: PROJECT_A,
    quote_id: null,
    client_id: CLIENT_A,
    project_title: 'Site A',
    client_name: 'Client A',
    client_contact: '0400000000',
    site_address: '1 Test St',
    status: 'wip',
    trades: ['fencing'],
    sections: [],
    variations: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        variation_id: '55555555-5555-4555-8555-555555555555',
        quote_id: null,
        number: 1,
        title: 'Extra',
        status: 'accepted',
        variation_status: 'accepted',
        total_inc_gst: 12500,
        accepted_at: '2026-01-01',
        section_id: null,
        section_name: null,
        section_trade: null,
        team_signed_at: null,
        client_signed_at: null,
        href: '/quotes/x/variations',
      },
    ],
    ...overrides,
  };
}

describe('fetchCcProjects', () => {
  const originalBase = process.env.CC_BASE_URL;
  const originalKey = process.env.CC_INTERNAL_API_KEY;

  beforeEach(() => {
    clearCcProjectsCacheForTests();
    process.env.CC_BASE_URL = 'https://cc.example.test';
    process.env.CC_INTERNAL_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            projects: [upstreamProject()],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
  });

  afterEach(() => {
    clearCcProjectsCacheForTests();
    vi.unstubAllGlobals();
    if (originalBase === undefined) delete process.env.CC_BASE_URL;
    else process.env.CC_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.CC_INTERNAL_API_KEY;
    else process.env.CC_INTERNAL_API_KEY = originalKey;
  });

  it('strips commercial variations from the operational model', async () => {
    const projects = await fetchCcProjects(ORG_A, 'req-1');
    expect(projects).toHaveLength(1);
    expect(projects[0]).not.toHaveProperty('variations');
    expect(JSON.stringify(projects)).not.toContain('total_inc_gst');
    expect(JSON.stringify(projects)).not.toContain('12500');
    expect(projects[0].project_id).toBe(PROJECT_A);
    expect(projects[0].trades).toEqual(['fencing']);
  });

  it('scopes cache by organisation id and does not cross-serve', async () => {
    const fetchMock = vi.mocked(fetch);
    await fetchCcProjects(ORG_A, 'req-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Warm org A cache, then fail live fetch — org A may fall back to its cache.
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const cachedA = await fetchCcProjects(ORG_A, 'req-a2');
    expect(cachedA[0]?.project_id).toBe(PROJECT_A);

    // Org B must not receive org A's cached feed when live fetch fails.
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchCcProjects(ORG_B, 'req-b')).rejects.toThrow(/network down|Failed to reach/);
  });

  it('keeps project_id and quote_id distinct in the operational summary', () => {
    const project: CcProject = {
      project_id: PROJECT_A,
      quote_id: PROJECT_B,
      cc_job_id: null,
      cc_job_number: null,
      client_id: CLIENT_A,
      project_title: 'Title',
      client_name: 'Client',
      client_contact: null,
      site_address: null,
      status: 'wip',
      trades: [],
      sections: [],
    };
    const summary = toCcProjectOperationalSummary(project);
    expect(summary.project_id).toBe(PROJECT_A);
    expect(summary.quote_id).toBe(PROJECT_B);
    expect(summary.project_id).not.toBe(summary.quote_id);
  });
});
