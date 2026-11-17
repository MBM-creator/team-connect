import { NextRequest, NextResponse } from 'next/server';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isValidUuid, validateJobForOrg } from '@/lib/job-org-validation';
import { parseChecklistDecision } from '@/lib/checklist-decision';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; planId: string; kind: string; itemId: string }> },
) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, message: 'Invalid request origin' }, { status: 403 });
  }
  const { jobId, planId, kind, itemId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const auth = await guardStaffApi(orgSlug, ['supervisor', 'admin']);
  if (auth instanceof NextResponse) return auth;
  if (![jobId, planId, itemId].every(isValidUuid) || !['materials', 'equipment'].includes(kind)) {
    return NextResponse.json({ ok: false, message: 'Checklist item not found' }, { status: 404 });
  }
  const job = await validateJobForOrg(jobId, orgSlug, 'checklist-status');
  if (job instanceof NextResponse) return job;
  const plan = await supabaseAdmin.from('job_daily_plans').select('id,status')
    .eq('id', planId).eq('job_id', jobId).maybeSingle();
  if (plan.error) return NextResponse.json({ ok: false, message: 'Could not load daily plan' }, { status: 500 });
  if (!plan.data) return NextResponse.json({ ok: false, message: 'Daily plan not found' }, { status: 404 });
  if (plan.data.status === 'completed') {
    return NextResponse.json({ ok: false, message: 'Completed daily plans are read-only' }, { status: 409 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body' }, { status: 400 });
  }
  const decision = parseChecklistDecision(body);
  if (!decision.ok) return NextResponse.json({ ok: false, message: decision.message }, { status: 400 });

  const table = kind === 'materials' ? 'job_daily_plan_materials' : 'job_daily_plan_equipment';
  const saved = await supabaseAdmin.from(table)
    .update({ checklist_status: decision.status, checklist_reason: decision.reason })
    .eq('id', itemId).eq('daily_plan_id', planId)
    .select('id,checklist_status,checklist_reason').maybeSingle();
  if (saved.error) return NextResponse.json({ ok: false, message: 'Failed to save checklist status' }, { status: 500 });
  if (!saved.data) return NextResponse.json({ ok: false, message: 'Checklist item not found' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    item: { id: saved.data.id, checklistStatus: saved.data.checklist_status, checklistReason: saved.data.checklist_reason },
  });
}
