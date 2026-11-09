import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/morning-checklist-delivery', () => ({ deliverMorningChecklists: vi.fn(), queueMorningChecklists: vi.fn().mockResolvedValue(0) }));
vi.mock('@/lib/loading-reminders', () => ({ deliverLoadingReminders: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }) }));
import { deliverLoadingReminders } from '@/lib/loading-reminders';
import { deliverMorningChecklists } from '@/lib/morning-checklist-delivery';
import { GET } from './route';

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); });
function request(token?: string) {
  return new NextRequest('https://team.example.com/api/cron/morning-checklists', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
function setup(date = '2026-11-08T19:15:00Z') {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.useFakeTimers(); vi.setSystemTime(new Date(date));
}
describe('scheduled email endpoint', () => {
  it('rejects unauthenticated callers and fails closed without a secret', async () => {
    setup();
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('incorrect'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request())).status).toBe(401);
    expect(deliverMorningChecklists).not.toHaveBeenCalled();
  });
  it('never sends from preview deployments', async () => {
    setup(); vi.stubEnv('VERCEL_ENV', 'preview');
    expect(await (await GET(request('test-secret'))).json()).toMatchObject({ skipped: 'not_production' });
    expect(deliverMorningChecklists).not.toHaveBeenCalled();
  });
  it('ignores the daylight-saving fallback invocation and Sundays', async () => {
    setup('2026-11-08T20:15:00Z');
    await GET(request('test-secret'));
    vi.setSystemTime(new Date('2026-11-14T19:15:00Z'));
    await GET(request('test-secret'));
    expect(deliverMorningChecklists).not.toHaveBeenCalled();
  });
  it('sends for the correct Melbourne date and reports provider failures', async () => {
    setup();
    vi.mocked(deliverMorningChecklists).mockResolvedValue({ queued: 1, sent: 1, failed: 0 });
    expect((await GET(request('test-secret'))).status).toBe(200);
    expect(deliverMorningChecklists).toHaveBeenCalledWith({}, '2026-11-09', expect.any(String));
    vi.mocked(deliverMorningChecklists).mockResolvedValue({ queued: 1, sent: 0, failed: 1 });
    expect((await GET(request('test-secret'))).status).toBe(500);
  });
  it('sends an hourly reminder without sending another initial email', async () => {
    setup('2026-11-08T20:30:00Z');
    expect((await GET(request('test-secret'))).status).toBe(200);
    expect(deliverMorningChecklists).not.toHaveBeenCalled();
    expect(deliverLoadingReminders).toHaveBeenCalledWith({}, '2026-11-09', expect.any(String), '2026-11-09T07:30', false);
  });
});
