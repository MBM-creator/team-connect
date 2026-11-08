import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAppOrigin } from '@/lib/app-url';
import { morningChecklistWindow } from '@/lib/morning-checklist';
import { deliverMorningChecklists } from '@/lib/morning-checklist-delivery';

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
  const { due, workDate } = morningChecklistWindow(new Date());
  if (!due) return NextResponse.json({ ok: true, skipped: 'outside_morning_window' });
  try {
    const result = await deliverMorningChecklists(supabaseAdmin, workDate, getAppOrigin());
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 500 : 200 });
  } catch {
    console.error('[morning-checklist] Scheduled run failed');
    return NextResponse.json({ ok: false, message: 'Morning checklist email failed' }, { status: 500 });
  }
}
