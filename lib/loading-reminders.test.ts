import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverLoadingReminders } from './loading-reminders';
import { sendChecklistQueue } from './morning-checklist-delivery';
import { loadingEmailHtml } from './loading-list';

const send = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

type Row = Record<string, any>;
/** A small transactional query fake: assertions exercise the delivery code's observable effects. */
function database() {
  const tables: Record<string, Row[]> = {
    morning_checklist_emails: [{ id: 'list', staff_profile_id: 'owner', work_date: '2026-11-07',
      recipient: 'owner@example.com', sender: 'Team <team@example.com>', subject: 'Saturday tools',
      body_text: 'Bring wet saw', confirmation_url: null, status: 'sent', loaded_at: null,
      created_at: '2026-11-07T00:00:00Z', updated_at: '2026-11-07T00:00:00Z' }],
    staff_profiles: [{ id: 'owner', email: 'owner@example.com', active: true, organisations: { slug: 'mbm' } }],
    loading_checklist_reminders: [],
  };
  const db = { from(table: string) {
    let filters: Array<(r: Row) => boolean> = [];
    let mutation: Row | undefined;
    let inserts: Row[] | undefined;
    let conflict: string[] = [];
    let single = false;
    const query: any = {
      select() { return query; }, order() { return query; }, limit() { return query; },
      eq(key: string, value: unknown) { filters.push(r => r[key] === value); return query; },
      neq(key: string, value: unknown) { filters.push(r => r[key] !== value); return query; },
      is(key: string, value: unknown) { filters.push(r => r[key] === value); return query; },
      lte(key: string, value: string) { filters.push(r => r[key] <= value); return query; },
      lt(key: string, value: string) { filters.push(r => r[key] < value); return query; },
      update(value: Row) { mutation = value; return query; },
      upsert(value: Row | Row[], options: { onConflict: string }) {
        inserts = Array.isArray(value) ? value : [value]; conflict = options.onConflict.split(','); return query;
      },
      maybeSingle() { single = true; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (inserts) for (const value of inserts) {
          if (!tables[table].some(r => conflict.every(key => r[key] === value[key]))) {
            tables[table].push({ id: `reminder-${tables[table].length}`, status: 'pending',
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...value });
          }
        }
        const matched = tables[table].filter(r => filters.every(filter => filter(r)));
        if (mutation) for (const row of matched) Object.assign(row, mutation);
        const data = matched.map(r => ({ ...r }));
        return Promise.resolve(resolve({ data: single ? data[0] ?? null : data, error: null }));
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { db, tables };
}

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T20:30:00Z'));
  send.mockReset().mockResolvedValue({ data: { id: 'provider-id' }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('loading reminder lifecycle', () => {
  const run = (db: SupabaseClient, slot = '2026-11-09T07:30') =>
    deliverLoadingReminders(db, '2026-11-09', 'https://team.example.com', slot, false);
  it('carries an outstanding list across working days, sends once per hour and includes confirmation', async () => {
    const { db, tables } = database();
    expect(await run(db)).toEqual({ sent: 1, failed: 0 });
    expect(await run(db)).toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain('Bring wet saw');
    expect(send.mock.calls[0][0].html).toContain('Mark as loaded');
    expect(send.mock.calls[0][0].to).toEqual(['owner@example.com']);
    expect(await run(db, '2026-11-09T08:30')).toEqual({ sent: 1, failed: 0 });
    expect(tables.loading_checklist_reminders).toHaveLength(2);
  });
  it('stops immediately after the creator confirms loading', async () => {
    const { db, tables } = database();
    await run(db);
    tables.morning_checklist_emails[0].loaded_at = '2026-11-08T20:31:00Z';
    expect(await run(db, '2026-11-09T08:30')).toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('retries a provider failure with the same snapshot and idempotency key', async () => {
    const { db } = database();
    send.mockResolvedValueOnce({ data: null, error: { message: 'temporary failure' } });
    expect(await run(db)).toEqual({ sent: 0, failed: 1 });
    vi.setSystemTime(new Date('2026-11-08T20:40:00Z'));
    expect(await run(db)).toEqual({ sent: 1, failed: 0 });
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });
  it('suppresses an already queued reminder when loading is confirmed before delivery', async () => {
    const { db, tables } = database();
    await run(db);
    const row = tables.loading_checklist_reminders[0];
    row.status = 'failed';
    tables.morning_checklist_emails[0].loaded_at = '2026-11-08T20:31:00Z';
    expect(await sendChecklistQueue(db, 'loading_checklist_reminders', [{ ...row }] as any, 'test-key'))
      .toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('never sends to a deactivated creator or a changed address', async () => {
    const { db, tables } = database();
    tables.staff_profiles[0].active = false;
    await run(db);
    tables.staff_profiles[0].active = true;
    tables.staff_profiles[0].email = 'someone-else@example.com';
    await run(db);
    expect(send).not.toHaveBeenCalled();
  });
  it('does not double-send when another worker has claimed the same queue snapshot', async () => {
    const { db, tables } = database();
    await run(db);
    const row = tables.loading_checklist_reminders[0];
    row.status = 'failed';
    const snapshot = { ...row };
    row.status = 'sending';
    row.updated_at = new Date().toISOString();
    await sendChecklistQueue(db, 'loading_checklist_reminders', [snapshot] as any, 'test-key');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('escapes checklist text in the HTML email', () => {
    const html = loadingEmailHtml('<script>alert(1)</script>', 'https://team.example.com/list');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
