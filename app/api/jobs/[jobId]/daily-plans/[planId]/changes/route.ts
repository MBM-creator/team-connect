import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isValidUuid, validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  DAILY_PLAN_NOT_ACTIVE_FOR_CHANGE_MESSAGE,
  parsePlanChangeBody,
} from '@/lib/daily-plan-execution';
import { normalizeDailyPlanStatus } from '@/lib/daily-plan-shared';
import {
  applyDailyPlanChange,
  assertStaffInOrg,
  loadDailyPlanBundle,
} from '@/lib/daily-plan';
import {
  dailyPlanJsonError,
  dailyPlanServerError,
  logDailyPlanMutationFailure,
  mapDailyPlanMutationFailure,
} from '@/lib/daily-plan-api-errors';

export const runtime = 'nodejs';

export async function POST(
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
    return dailyPlanJsonError('Daily Plan not found', 404, requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return dailyPlanJsonError('Invalid JSON body', 400, requestId);
  }

  const parsed = parsePlanChangeBody(
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  );
  if (!parsed.ok) {
    return dailyPlanJsonError(parsed.message, 400, requestId);
  }

  const { data: plan, error: planError } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, job_id, status, supervisor_staff_profile_id')
    .eq('id', planId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (planError) {
    const err = normalizeSupabaseError(planError);
    logDailyPlanMutationFailure({
      requestId,
      action: 'plan_change',
      orgSlug,
      jobId,
      planId,
      userId: staffAuth.staff.id,
      errorType: err.code ?? 'DP_LOAD',
      message: 'Failed to load Daily Plan',
    });
    return dailyPlanServerError(requestId, err.code ?? 'DP_LOAD', 'Failed to load Daily Plan');
  }
  if (!plan) {
    return dailyPlanJsonError('Daily Plan not found', 404, requestId);
  }
  if (normalizeDailyPlanStatus(plan.status) !== 'active') {
    return dailyPlanJsonError(DAILY_PLAN_NOT_ACTIVE_FOR_CHANGE_MESSAGE, 409, requestId);
  }

  let changeData = { ...parsed.data };

  if (changeData.changeType === 'cancel_planned_outcome' && changeData.affectedOutcomeId) {
    const { data: outcome, error: outcomeError } = await supabaseAdmin
      .from('job_daily_plan_outcomes')
      .select('id, execution_status')
      .eq('id', changeData.affectedOutcomeId)
      .eq('daily_plan_id', planId)
      .maybeSingle();

    if (outcomeError) {
      const err = normalizeSupabaseError(outcomeError);
      logDailyPlanMutationFailure({
        requestId,
        action: 'plan_change',
        orgSlug,
        jobId,
        planId,
        userId: staffAuth.staff.id,
        errorType: err.code ?? 'DP_OUTCOME',
        message: 'Failed to load outcome',
      });
      return dailyPlanServerError(requestId, err.code ?? 'DP_OUTCOME', 'Failed to load outcome');
    }
    if (!outcome) {
      return dailyPlanJsonError('Affected outcome not found on this plan', 404, requestId);
    }
  }

  if (changeData.decisionMakerType === 'current_supervisor') {
    changeData = {
      ...changeData,
      decisionMakerStaffProfileId:
        changeData.decisionMakerStaffProfileId ??
        (plan.supervisor_staff_profile_id as string),
      decisionMakerLabel: changeData.decisionMakerLabel,
    };
  }

  if (changeData.decisionMakerStaffProfileId) {
    const staffCheck = await assertStaffInOrg(
      changeData.decisionMakerStaffProfileId,
      validation.organisationId
    );
    if (!staffCheck.ok) {
      return dailyPlanJsonError(staffCheck.message, 400, requestId);
    }
  }

  const result = await applyDailyPlanChange({
    planId,
    recordedByStaffProfileId: staffAuth.staff.id,
    parsed: changeData,
  });

  if (!result.ok) {
    return mapDailyPlanMutationFailure({
      requestId,
      action: 'plan_change',
      orgSlug,
      jobId,
      planId,
      userId: staffAuth.staff.id,
      conflict: result.conflict,
      message: result.message,
      code: 'code' in result ? result.code : undefined,
    });
  }

  const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
  if (!bundle.ok) {
    logDailyPlanMutationFailure({
      requestId,
      action: 'plan_change',
      orgSlug,
      jobId,
      planId,
      userId: staffAuth.staff.id,
      errorType: bundle.code ?? 'DP_LOAD',
      message: bundle.message,
    });
    return dailyPlanServerError(requestId, bundle.code ?? 'DP_LOAD', bundle.message);
  }

  const res = NextResponse.json({
    ok: true,
    plan: bundle.plan,
    changeId: result.changeId ?? null,
    replacementOutcomeId: result.replacementOutcomeId ?? null,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
