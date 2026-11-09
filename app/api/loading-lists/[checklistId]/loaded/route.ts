import { NextRequest, NextResponse } from 'next/server';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest, { params }: { params: Promise<{ checklistId: string }> }) {
  const orgSlug = request.nextUrl.searchParams.get('orgSlug') ?? '';
  const auth = await guardStaffApi(orgSlug);
  if (auth instanceof NextResponse) return auth;
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, message: 'Invalid request origin' }, { status: 403 });
  }
  const { checklistId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(checklistId)) {
    return NextResponse.json({ ok: false, message: 'List not found' }, { status: 404 });
  }
  // No admin override: each creator confirms their own loading list.
  const list = await supabaseAdmin.from('morning_checklist_emails').select('id,loaded_at')
    .eq('id', checklistId).eq('staff_profile_id', auth.staff.id).maybeSingle();
  if (list.error) return NextResponse.json({ ok: false, message: 'Could not load checklist' }, { status: 500 });
  if (!list.data) return NextResponse.json({ ok: false, message: 'List not found' }, { status: 404 });
  if (list.data.loaded_at) return NextResponse.json({ ok: true, loadedAt: list.data.loaded_at });
  const loadedAt = new Date().toISOString();
  const saved = await supabaseAdmin.from('morning_checklist_emails').update({
    loaded_at: loadedAt, loaded_by_staff_profile_id: auth.staff.id,
  }).eq('id', checklistId).eq('staff_profile_id', auth.staff.id).is('loaded_at', null);
  if (saved.error) return NextResponse.json({ ok: false, message: 'Could not confirm loading' }, { status: 500 });
  return NextResponse.json({ ok: true, loadedAt });
}
