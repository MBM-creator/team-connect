import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, validateStageBelongsToJob, normalizeSupabaseError } from '@/lib/job-org-validation';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { validateSetupV2 } from '@/lib/paving-qa-v2-setup';
import { validateIrrigationSetupV1 } from '@/lib/irrigation-qa-v1-setup';
import { validateFencingSetupV1 } from '@/lib/fencing-qa-v1-setup';
import { validateSignoffSetupV1 } from '@/lib/signoff-qa-v1-setup';
import { loadCcProjectForJob } from '@/lib/cc-project-context';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(requestId: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  const { data: rows, error } = await supabaseAdmin
    .from('paving_qa_runs')
    .select(
      'id, job_id, stage_id, status, qa_type, setup, setup_version, started_at, updated_at, completed_at, supervisor_final_approved_at'
    )
    .eq('job_id', jobId)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[qa/runs GET]', { requestId, error: normalizeSupabaseError(error) });
    return serverError(requestId);
  }

  const ccProject = await loadCcProjectForJob(v.job, v.organisationId, requestId);
  const res = NextResponse.json({
    ok: true,
    job: v.job,
    ccProject,
    runs: rows ?? [],
    viewerRole: staffAuth.staff.role,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  // Only supervisor or admin may create new QA runs
  if (staffAuth.staff.role !== 'supervisor' && staffAuth.staff.role !== 'admin') {
    return jsonError('Only supervisors and admins can create QA runs', 403, requestId);
  }

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  let body: { setup?: unknown; stageId?: string | null; qaType?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as typeof body) : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const qaType =
    body.qaType === 'irrigation' || body.qaType === 'fencing' || body.qaType === 'sign_off'
      ? body.qaType
      : 'paving';
  const setupParsed = qaType === 'irrigation'
    ? validateIrrigationSetupV1(body.setup ?? {})
    : qaType === 'fencing'
      ? validateFencingSetupV1(body.setup ?? {})
      : qaType === 'sign_off'
        ? validateSignoffSetupV1(body.setup ?? {})
        : validateSetupV2(body.setup ?? {});
  if (!setupParsed.ok) {
    const first = setupParsed.errors[0];
    return jsonError(first?.message ?? 'Invalid setup', 400, requestId);
  }
  const setup = setupParsed.setup;

  const stageOk = await validateStageBelongsToJob(body.stageId, jobId, requestId);
  if (stageOk instanceof NextResponse) {
    stageOk.headers.set('x-request-id', requestId);
    return stageOk;
  }
  const stageId =
    body.stageId != null && String(body.stageId).trim() !== ''
      ? String(body.stageId).trim()
      : null;

  const { data: activeRows, error: activeErr } = await supabaseAdmin
    .from('paving_qa_runs')
    .select('id')
    .eq('job_id', jobId)
    .eq('qa_type', qaType)
    .eq('status', 'active')
    .limit(1);

  if (activeErr) {
    console.error('[qa/runs POST] active check', { requestId, error: normalizeSupabaseError(activeErr) });
    return serverError(requestId);
  }
  if (activeRows && activeRows.length > 0) {
    return jsonError(`An active ${qaType} QA run already exists for this job`, 409, requestId);
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('paving_qa_runs')
    .insert({
      job_id: jobId,
      stage_id: stageId,
      status: 'active',
      qa_type: qaType,
      setup,
      setup_version: qaType === 'paving' ? 2 : 1,
      started_at: now,
      updated_at: now,
      started_by: staffAuth.staff.id,
    })
    .select(
      'id, job_id, stage_id, status, qa_type, setup, setup_version, started_at, updated_at, completed_at, supervisor_final_approved_at'
    )
    .single();

  if (insErr || !inserted) {
    console.error('[qa/runs POST] insert', { requestId, error: normalizeSupabaseError(insErr ?? null) });
    return serverError(requestId);
  }

  const res = NextResponse.json({ ok: true, run: inserted }, { status: 201 });
  res.headers.set('x-request-id', requestId);
  return res;
}
