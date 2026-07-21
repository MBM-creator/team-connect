import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isValidUuid, validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  DAILY_PLAN_ALREADY_ACTIVE_MESSAGE,
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  getDailyPlanStartDateError,
  normalizeDailyPlanStatus,
  parseDailyPlanUpsertBody,
} from '@/lib/daily-plan-shared';
import {
  loadDailyPlanBundle,
  resolveDailyPlanTimezone,
  startDailyPlanAtomically,
} from '@/lib/daily-plan';
import {
  dailyPlanJsonError,
  dailyPlanServerError,
  logDailyPlanMutationFailure,
  mapDailyPlanMutationFailure,
} from '@/lib/daily-plan-api-errors';

export const runtime = 'nodejs';

const jsonError = dailyPlanJsonError;
const serverError = dailyPlanServerError;

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
    return jsonError('Daily Plan not found', 404, requestId);
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('job_daily_plans')
    .select(
      'id, job_id, work_date, work_timezone, status, supervisor_staff_profile_id, risks_constraints, contingency_plan, general_notes'
    )
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

  const status = normalizeDailyPlanStatus(existing.status);
  if (status === 'completed') {
    return jsonError(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE, 409, requestId);
  }
  if (status !== 'draft') {
    return jsonError(DAILY_PLAN_ALREADY_ACTIVE_MESSAGE, 409, requestId);
  }

  const workTimezone =
    typeof existing.work_timezone === 'string' && existing.work_timezone.trim()
      ? existing.work_timezone
      : resolveDailyPlanTimezone();
  const workDate = String(existing.work_date);
  // Start Day only when the stored work date equals today in Australia/Melbourne.
  const dateError = getDailyPlanStartDateError(workDate, workTimezone);
  if (dateError) {
    return jsonError(dateError, 400, requestId);
  }

  const [outcomesRes, crewRes, materialsRes, equipmentRes] = await Promise.all([
    supabaseAdmin
      .from('job_daily_plan_outcomes')
      .select('description, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_crew_responsibilities')
      .select('crew_member_name, responsibility, staff_profile_id, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_materials')
      .select('description, quantity, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_equipment')
      .select('description, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
  ]);

  if (outcomesRes.error || crewRes.error || materialsRes.error || equipmentRes.error) {
    return serverError(requestId, 'DP_CHILDREN', 'Failed to load Daily Plan details');
  }

  const parsed = parseDailyPlanUpsertBody(
    {
      workDate,
      supervisorStaffProfileId: existing.supervisor_staff_profile_id,
      outcomes: (outcomesRes.data ?? []).map((o) => ({ description: o.description })),
      crewResponsibilities: (crewRes.data ?? []).map((c) => ({
        crewMemberName: c.crew_member_name,
        responsibility: c.responsibility,
        staffProfileId: c.staff_profile_id,
      })),
      materials: (materialsRes.data ?? []).map((m) => ({
        description: m.description,
        quantity: m.quantity,
      })),
      equipment: (equipmentRes.data ?? []).map((e) => ({ description: e.description })),
      risksConstraints: existing.risks_constraints,
      contingencyPlan: existing.contingency_plan,
      generalNotes: existing.general_notes,
    },
    {
      mode: 'edit',
      defaultSupervisorStaffProfileId: existing.supervisor_staff_profile_id as string,
    }
  );
  if (!parsed.ok) {
    return jsonError(parsed.message, 400, requestId);
  }
  if (!parsed.data.supervisorStaffProfileId && !existing.supervisor_staff_profile_id) {
    return jsonError('Supervisor is required', 400, requestId);
  }

  const started = await startDailyPlanAtomically(planId, staffAuth.staff.id);
  if (!started.ok) {
    return mapDailyPlanMutationFailure({
      requestId,
      action: 'start_day',
      orgSlug,
      jobId,
      planId,
      userId: staffAuth.staff.id,
      conflict: started.conflict,
      message: started.message,
      code: 'code' in started ? started.code : undefined,
    });
  }

  const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
  if (!bundle.ok) {
    logDailyPlanMutationFailure({
      requestId,
      action: 'start_day',
      orgSlug,
      jobId,
      planId,
      userId: staffAuth.staff.id,
      errorType: bundle.code ?? 'DP_LOAD',
      message: bundle.message,
    });
    return serverError(requestId, bundle.code ?? 'DP_LOAD', bundle.message);
  }

  const res = NextResponse.json({ ok: true, plan: bundle.plan });
  res.headers.set('x-request-id', requestId);
  return res;
}
