import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mock = vi.hoisted(() => ({ guard: vi.fn(), from: vi.fn(), eq: vi.fn(), update: vi.fn(), loadedAt: null as string | null, found: true }));
vi.mock('@/lib/guard-staff-api', () => ({ guardStaffApi: mock.guard }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mock.from } }));
import { POST } from './route';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (origin = 'https://team.example.com') => new NextRequest(`https://team.example.com/api/loading-lists/${id}/loaded?orgSlug=mbm`, { method: 'POST', headers: { origin } });
const params = { params: Promise.resolve({ checklistId: id }) };
beforeEach(() => {
  vi.clearAllMocks(); mock.loadedAt = null; mock.found = true;
  mock.guard.mockResolvedValue({ staff: { id: 'creator' }, org: { id: 'mbm' } });
  const query: any = {
    select: () => query,
    eq: (...args: any[]) => { mock.eq(...args); return query; },
    maybeSingle: async () => ({ data: mock.found ? { id, loaded_at: mock.loadedAt } : null, error: null }),
    update: (value: unknown) => { mock.update(value); return query; },
    is: async () => ({ error: null }),
  };
  mock.from.mockReturnValue(query);
});
afterEach(() => vi.useRealTimers());
describe('creator loading confirmation', () => {
  it('requires sign-in before reading or changing a list', async () => {
    mock.guard.mockResolvedValue(NextResponse.json({ ok: false }, { status: 401 }));
    expect((await POST(request(), params)).status).toBe(401);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('scopes both the lookup and update to the creator and records confirmation', async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(mock.eq.mock.calls.filter(([key]) => key === 'staff_profile_id')).toEqual([
      ['staff_profile_id', 'creator'], ['staff_profile_id', 'creator'],
    ]);
    expect(mock.update).toHaveBeenCalledWith({ loaded_at: expect.any(String), loaded_by_staff_profile_id: 'creator' });
  });
  it('refuses someone else’s or a missing list', async () => {
    mock.found = false;
    expect((await POST(request(), params)).status).toBe(404);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('is idempotent and never rewrites the first confirmation', async () => {
    mock.loadedAt = '2026-11-09T01:00:00Z';
    expect(await (await POST(request(), params)).json()).toEqual({ ok: true, loadedAt: mock.loadedAt });
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('refuses cross-origin confirmation', async () => {
    expect((await POST(request('https://attacker.example'), params)).status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
