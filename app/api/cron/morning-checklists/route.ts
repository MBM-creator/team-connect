import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAppOrigin } from '@/lib/app-url';
import { morningChecklistWindow } from '@/lib/morning-checklist';
import { deliverMorningChecklists, queueMorningChecklists } from '@/lib/morning-checklist-delivery';
import { deliverLoadingReminders } from '@/lib/loading-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Preview deployments must never send live scheduled email.
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ ok: true, skipped: 'not_production' });
  }
  const { due, workDate, mode, slot } = morningChecklistWindow(new Date());
  if (!due) return NextResponse.json({ ok: true, skipped: 'outside_morning_window' });
  try {
    // A plan saved after 06:15 still gets picked up by the next hourly reminder.
    if (mode === 'followup') await queueMorningChecklists(supabaseAdmin, workDate, getAppOrigin());
    const initial = mode === 'morning'
      ? await deliverMorningChecklists(supabaseAdmin, workDate, getAppOrigin())
      : { queued: 0, sent: 0, failed: 0 };
    const reminders = await deliverLoadingReminders(supabaseAdmin, workDate, getAppOrigin(), slot, mode === 'morning');
    const result = { queued: initial.queued, sent: initial.sent + reminders.sent, failed: initial.failed + reminders.failed };
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 500 : 200 });
  } catch {
    console.error('[morning-checklist] Scheduled run failed');
    return NextResponse.json({ ok: false, message: 'Morning checklist email failed' }, { status: 500 });
  }
}
