import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError, isValidUuid } from '@/lib/job-org-validation';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message, requestId }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(requestId: string, errorCode: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, errorCode, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; planId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, planId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  if (!isValidUuid(planId)) return jsonError('Plan not found', 404, requestId);

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) {
    validation.headers.set('x-request-id', requestId);
    return validation;
  }

  const { data: plan, error: planError } = await supabaseAdmin
    .from('job_plan_documents')
    .select('id, storage_path')
    .eq('id', planId)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .single();

  if (planError || !plan) return jsonError('Plan not found', 404, requestId);

  const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([plan.storage_path]);
  if (removeError) {
    const supabaseErr = normalizeSupabaseError(removeError);
    console.error('[api/jobs/[jobId]/plans/[planId]] DELETE storage failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'PLAN_REMOVE', 'Failed to remove plan');
  }

  const { error: updateError } = await supabaseAdmin
    .from('job_plan_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', planId);

  if (updateError) {
    const supabaseErr = normalizeSupabaseError(updateError);
    console.error('[api/jobs/[jobId]/plans/[planId]] DELETE row failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'PLAN_DELETE', 'Failed to delete plan record');
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set('x-request-id', requestId);
  return res;
}
