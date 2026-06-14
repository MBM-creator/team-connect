import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError, isValidUuid } from '@/lib/job-org-validation';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { loadQaRunBundle } from '@/lib/qa-run-bundle';
import { computeV2SectionUiStates } from '@/lib/paving-qa-v2-graph';
import { getIrrigationFinalApprovalBlockers } from '@/lib/irrigation-qa-v1-graph';
import { getFencingFinalApprovalBlockers } from '@/lib/fencing-qa-v1-graph';
import { getSignoffFinalApprovalBlockers } from '@/lib/signoff-qa-v1-graph';
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; runId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, runId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug, ['supervisor', 'admin']);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!isValidUuid(runId)) {
    return jsonError('Run not found', 404, requestId);
  }

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  let body: { reason?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as typeof body) : {};
  } catch {
    body = {};
  }

  const { data: run, error: runErr } = await supabaseAdmin
    .from('paving_qa_runs')
    .select('id, job_id, status, supervisor_final_approved_at')
    .eq('id', runId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (runErr || !run) {
    return jsonError('Run not found', 404, requestId);
  }
  if (run.status !== 'active') {
    return jsonError('Run is not active', 409, requestId);
  }
  if (run.supervisor_final_approved_at) {
    return jsonError('Run already has final approval', 409, requestId);
  }

  const typedBundle = await loadQaRunBundle(runId, jobId);
  if (!typedBundle.ok) {
    return jsonError('Run not found', 404, requestId);
  }

  if (typedBundle.qaType === 'irrigation') {
    const blockers = getIrrigationFinalApprovalBlockers(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    if (blockers.length > 0) {
      const res = NextResponse.json(
        {
          ok: false,
          message: 'Irrigation QA cannot be final-approved until all applicable sections and required evidence are cleared.',
          incompleteSections: blockers.map((s) => ({
            code: s.code,
            title: s.title,
            status: s.status,
            reasons: s.reasons,
          })),
        },
        { status: 409 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  if (typedBundle.qaType === 'fencing') {
    const blockers = getFencingFinalApprovalBlockers(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    if (blockers.length > 0) {
      const res = NextResponse.json(
        {
          ok: false,
          message: 'Fencing QA cannot be final-approved until all applicable sections and required evidence are cleared.',
          incompleteSections: blockers.map((s) => ({
            code: s.code,
            title: s.title,
            status: s.status,
            reasons: s.reasons,
          })),
        },
        { status: 409 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  if (typedBundle.qaType === 'sign_off') {
    const blockers = getSignoffFinalApprovalBlockers(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    if (blockers.length > 0) {
      const res = NextResponse.json(
        {
          ok: false,
          message: 'Supervisor sign-off cannot be final-approved until required evidence is cleared.',
          incompleteSections: blockers.map((s) => ({
            code: s.code,
            title: s.title,
            status: s.status,
            reasons: s.reasons,
          })),
        },
        { status: 409 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  if (typedBundle.qaType === 'paving') {
    const sectionStates = computeV2SectionUiStates(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    const incompleteSections = sectionStates.filter((s) => !s.cleared);
    if (incompleteSections.length > 0) {
      const res = NextResponse.json(
        {
          ok: false,
          message: 'Paving QA cannot be final-approved until all applicable sections are cleared.',
          incompleteSections: incompleteSections.map((s) => ({
            code: s.code,
            title: s.title,
            status: s.status,
          })),
        },
        { status: 409 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  const now = new Date().toISOString();
  const reason = body.reason != null ? String(body.reason).trim() : null;

  const { error: evErr } = await supabaseAdmin.from('paving_qa_supervisor_events').insert({
    run_id: runId,
    issue_id: null,
    action: 'final_approval',
    reason,
    actor_staff_profile_id: staffAuth.staff.id,
    actor_display: staffAuth.staff.full_name,
    actor_role: staffAuth.staff.role,
    created_at: now,
  });

  if (evErr) {
    console.error('[qa/final-approval] event', { requestId, error: normalizeSupabaseError(evErr) });
    return serverError(requestId);
  }

  const { error: updErr } = await supabaseAdmin
    .from('paving_qa_runs')
    .update({
      supervisor_final_approved_at: now,
      supervisor_final_approved_by: staffAuth.staff.id,
      updated_at: now,
      status: 'completed',
      completed_at: now,
    })
    .eq('id', runId);

  if (updErr) {
    console.error('[qa/final-approval] run', { requestId, error: normalizeSupabaseError(updErr) });
    return serverError(requestId);
  }

  const res = NextResponse.json({ ok: true, supervisorFinalApprovedAt: now });
  res.headers.set('x-request-id', requestId);
  return res;
}
