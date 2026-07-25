import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCcProjectForJob } from '@/lib/cc-project-context';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

const fetchCcProjects = vi.fn();

vi.mock('@/lib/cc-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cc-client')>('@/lib/cc-client');
  return {
    ...actual,
    fetchCcProjects: (...args: unknown[]) => fetchCcProjects(...args),
  };
});

describe('loadCcProjectForJob', () => {
  const original = process.env.CC_INTEGRATION_ORG_IDS;

  beforeEach(() => {
    fetchCcProjects.mockReset();
    process.env.CC_INTEGRATION_ORG_IDS = ORG_A;
    fetchCcProjects.mockResolvedValue([
      {
        project_id: PROJECT_ID,
        quote_id: QUOTE_ID,
        cc_job_id: null,
        cc_job_number: null,
        client_id: CLIENT_ID,
        project_title: 'Linked',
        client_name: 'Client',
        client_contact: null,
        site_address: null,
        status: 'wip',
        trades: ['fencing'],
        sections: [],
      },
    ]);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CC_INTEGRATION_ORG_IDS;
    else process.env.CC_INTEGRATION_ORG_IDS = original;
  });

  it('returns null without calling upstream when org is not allowlisted', async () => {
    const result = await loadCcProjectForJob(
      { cc_project_id: PROJECT_ID, cc_quote_id: QUOTE_ID },
      ORG_B,
      'req'
    );
    expect(result).toBeNull();
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('returns null for unlinked jobs without calling upstream', async () => {
    const result = await loadCcProjectForJob({}, ORG_A, 'req');
    expect(result).toBeNull();
    expect(fetchCcProjects).not.toHaveBeenCalled();
  });

  it('returns the linked operational project for an allowlisted org', async () => {
    const result = await loadCcProjectForJob(
      { cc_project_id: PROJECT_ID, cc_quote_id: QUOTE_ID },
      ORG_A,
      'req'
    );
    expect(result?.project_id).toBe(PROJECT_ID);
    expect(result).not.toHaveProperty('variations');
    expect(fetchCcProjects).toHaveBeenCalledWith(ORG_A, 'req');
  });

  it('swallows Client Connect failures so standalone workflows continue', async () => {
    fetchCcProjects.mockRejectedValueOnce(new Error('CC down'));
    const result = await loadCcProjectForJob({ cc_project_id: PROJECT_ID }, ORG_A, 'req');
    expect(result).toBeNull();
  });
});
