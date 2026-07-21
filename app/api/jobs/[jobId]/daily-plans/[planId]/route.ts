import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isValidUuid, validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  DAILY_PLAN_BASELINE_LOCKED_MESSAGE,
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  normalizeDailyPlanStatus,
  parseDailyPlanUpsertBody,
} from '@/lib/daily-plan-shared';
import {
  assertStaffInOrg,
  loadDailyPlanBundle,
  replaceDailyPlanChildren,
  validateSourceCarryForwardsForUpsert,
} from '@/lib/daily-plan';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400, requestId?: string, extra?: Record<string, unknown>) {
  const res = NextResponse.json({ ok: false, message, requestId, ...extra }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(requestId: string, errorCode: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, errorCode, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; planId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, planId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  if (!isValidUuid(planId)) {
    return jsonError('Daily Plan not found', 404, requestId);
  }

  const { data: planRow, error } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, job_id')
    .eq('id', planId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (error) {
    const supabaseErr = normalizeSupabaseError(error);
    return serverError(requestId, supabaseErr.code ?? 'DP_LOAD', 'Failed to load Daily Plan');
  }
  if (!planRow) {
    return jsonError('Daily Plan not found', 404, requestId);
  }

  const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
  if (!bundle.ok) {
    return jsonError(bundle.message, 404, requestId);
  }

  const res = NextResponse.json({ ok: true, plan: bundle.plan });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; planId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, planId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug, ['supervisor', 'admin']);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  if (!isValidUuid(planId)) {
    return jsonError('Daily Plan not found', 404, requestId);
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, job_id, work_date, supervisor_staff_profile_id, status')
    .eq('id', planId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (existingError) {
    const supabaseErr = normalizeSupabaseError(existingError);
    return serverError(requestId, supabaseErr.code ?? 'DP_LOAD', 'Failed to load Daily Plan');
  }
  if (!existing) {
    return jsonError('Daily Plan not found', 404, requestId);
  }

  const planStatus = normalizeDailyPlanStatus(existing.status);
  if (planStatus === 'completed') {
    return jsonError(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE, 409, requestId);
  }
  if (planStatus !== 'draft') {
    return jsonError(DAILY_PLAN_BASELINE_LOCKED_MESSAGE, 409, requestId);
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  // Work date is immutable on edit; always use the stored date for validation continuity.
  const parsed = parseDailyPlanUpsertBody(
    {
      ...body,
      workDate: existing.work_date,
    },
    {
      mode: 'edit',
      defaultSupervisorStaffProfileId: existing.supervisor_staff_profile_id as string,
    }
  );
  if (!parsed.ok) {
    return jsonError(parsed.message, 400, requestId);
  }

  const supervisorId =
    parsed.data.supervisorStaffProfileId ?? (existing.supervisor_staff_profile_id as string);
  const supervisorCheck = await assertStaffInOrg(supervisorId, validation.organisationId);
  if (!supervisorCheck.ok) {
    return jsonError(supervisorCheck.message, 400, requestId);
  }

  for (const crew of parsed.data.crewResponsibilities) {
    if (crew.staffProfileId) {
      const crewCheck = await assertStaffInOrg(crew.staffProfileId, validation.organisationId);
      if (!crewCheck.ok) {
        return jsonError('Crew member is not in this organisation', 400, requestId);
      }
    }
  }

  const sourceCheck = await validateSourceCarryForwardsForUpsert({
    jobId,
    organisationId: validation.organisationId,
    targetWorkDate: existing.work_date as string,
    excludePlanId: planId,
    outcomes: parsed.data.outcomes,
    confirmDuplicateCarryForwardIds: parsed.data.confirmDuplicateCarryForwardIds,
  });
  if (!sourceCheck.ok) {
    return jsonError(sourceCheck.message, sourceCheck.status ?? 400, requestId, {
      code: sourceCheck.code,
      needsConfirmationIds: sourceCheck.needsConfirmationIds,
    });
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from('job_daily_plans')
    .update({
      supervisor_staff_profile_id: supervisorId,
      risks_constraints: parsed.data.risksConstraints,
      contingency_plan: parsed.data.contingencyPlan,
      general_notes: parsed.data.generalNotes,
    })
    .eq('id', planId)
    .eq('job_id', jobId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (updateError) {
    const supabaseErr = normalizeSupabaseError(updateError);
    console.error('[api/jobs/[jobId]/daily-plans/[planId]] PATCH failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'DP_UPDATE', 'Failed to save Daily Plan');
  }

  if (!updatedRow) {
    return jsonError(DAILY_PLAN_BASELINE_LOCKED_MESSAGE, 409, requestId);
  }

  const children = await replaceDailyPlanChildren(planId, parsed.data);
  if (!children.ok) {
    return serverError(requestId, children.code ?? 'DP_CHILDREN', children.message);
  }

  const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
  if (!bundle.ok) {
    return serverError(requestId, bundle.code ?? 'DP_LOAD', bundle.message);
  }

  const res = NextResponse.json({ ok: true, plan: bundle.plan });
  res.headers.set('x-request-id', requestId);
  return res;
}
