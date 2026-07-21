import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import { isValidReportDate } from '@/lib/report-date';
import {
  canEditDailyPlan,
  duplicateDailyPlanMessage,
  parseDailyPlanUpsertBody,
} from '@/lib/daily-plan-shared';
import {
  assertStaffInOrg,
  DAILY_PLAN_SELECT,
  findDailyPlanIdByJobDate,
  loadDailyPlanBundle,
  replaceDailyPlanChildren,
  resolveDailyPlanTimezone,
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
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const workDate = request.nextUrl.searchParams.get('workDate')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  if (!workDate) {
    return jsonError('workDate is required', 400, requestId);
  }
  if (!isValidReportDate(workDate)) {
    return jsonError('workDate must be YYYY-MM-DD', 400, requestId);
  }

  const planId = await findDailyPlanIdByJobDate(jobId, workDate);
  if (!planId) {
    const res = NextResponse.json({
      ok: true,
      plan: null,
      workDate,
      workTimezone: resolveDailyPlanTimezone(),
      canEdit: canEditDailyPlan(staffAuth.staff.role),
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
  if (!bundle.ok) {
    return serverError(requestId, bundle.code ?? 'DP_LOAD', bundle.message);
  }

  const res = NextResponse.json({
    ok: true,
    plan: bundle.plan,
    workDate,
    workTimezone: resolveDailyPlanTimezone(),
    canEdit: canEditDailyPlan(staffAuth.staff.role),
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

  const staffAuth = await guardStaffApi(orgSlug, ['supervisor', 'admin']);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const parsed = parseDailyPlanUpsertBody(body, {
    mode: 'create',
    defaultSupervisorStaffProfileId: staffAuth.staff.id,
  });
  if (!parsed.ok) {
    return jsonError(parsed.message, 400, requestId);
  }

  const supervisorId = parsed.data.supervisorStaffProfileId ?? staffAuth.staff.id;
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
    targetWorkDate: parsed.data.workDate,
    outcomes: parsed.data.outcomes,
    confirmDuplicateCarryForwardIds: parsed.data.confirmDuplicateCarryForwardIds,
  });
  if (!sourceCheck.ok) {
    return jsonError(sourceCheck.message, sourceCheck.status ?? 400, requestId, {
      code: sourceCheck.code,
      needsConfirmationIds: sourceCheck.needsConfirmationIds,
    });
  }

  const existingId = await findDailyPlanIdByJobDate(jobId, parsed.data.workDate);
  if (existingId) {
    return jsonError(duplicateDailyPlanMessage(existingId), 409, requestId, {
      existingPlanId: existingId,
    });
  }

  const workTimezone = resolveDailyPlanTimezone();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('job_daily_plans')
    .insert({
      job_id: jobId,
      work_date: parsed.data.workDate,
      work_timezone: workTimezone,
      supervisor_staff_profile_id: supervisorId,
      created_by_staff_profile_id: staffAuth.staff.id,
      risks_constraints: parsed.data.risksConstraints,
      contingency_plan: parsed.data.contingencyPlan,
      general_notes: parsed.data.generalNotes,
    })
    .select(DAILY_PLAN_SELECT)
    .single();

  if (insertError || !inserted) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    if (supabaseErr.code === '23505') {
      const conflictId = await findDailyPlanIdByJobDate(jobId, parsed.data.workDate);
      return jsonError(duplicateDailyPlanMessage(conflictId), 409, requestId, {
        existingPlanId: conflictId,
      });
    }
    console.error('[api/jobs/[jobId]/daily-plans] POST failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'DP_INSERT', 'Failed to save Daily Plan');
  }

  const children = await replaceDailyPlanChildren(inserted.id as string, parsed.data);
  if (!children.ok) {
    await supabaseAdmin.from('job_daily_plans').delete().eq('id', inserted.id);
    return serverError(requestId, children.code ?? 'DP_CHILDREN', children.message);
  }

  const bundle = await loadDailyPlanBundle(inserted.id as string, staffAuth.staff.role);
  if (!bundle.ok) {
    return serverError(requestId, bundle.code ?? 'DP_LOAD', bundle.message);
  }

  const res = NextResponse.json({ ok: true, plan: bundle.plan }, { status: 201 });
  res.headers.set('x-request-id', requestId);
  return res;
}
