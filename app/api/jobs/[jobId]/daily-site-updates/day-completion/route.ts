import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  findDailyPlanIdByJobDate,
  loadDailyPlanBundle,
  completeDailyPlanWithSiteUpdate,
} from '@/lib/daily-plan';
import {
  buildDailyPlanReportSummary,
  matchDailyPlanForReport,
  parseCarryForwardSelections,
} from '@/lib/daily-plan-report';
import {
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE,
  canEditDailyPlan,
} from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE,
  DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE,
  dailyPlanJsonError,
  dailyPlanServerError,
  logDailyPlanMutationFailure,
  mapUniqueViolationMessage,
} from '@/lib/daily-plan-api-errors';
import {
  mapDailySiteUpdateRow,
  parseDailySiteUpdatePostBodyForApi,
  progressContextToDbSnapshot,
  readProgressContextSnapshot,
  resolveDailySiteUpdateTimezone,
  type DailySiteUpdateDbRow,
} from '@/lib/daily-site-update';
import { isValidReportDate, todayReportDate } from '@/lib/report-date';
import { linkDailySiteUpdateContext } from '@/lib/context-links';

export const runtime = 'nodejs';

const UPDATE_SELECT = `
  id,
  job_id,
  stage_id,
  author_staff_profile_id,
  report_date,
  report_timezone,
  submitted_at,
  created_at,
  progress_today,
  issues_faced,
  issues_faced_none,
  problems_resolved,
  problems_resolved_none,
  prevention_plan,
  prevention_plan_none,
  on_track_status,
  on_track_notes,
  planned_hours_snapshot,
  hours_used_snapshot,
  hours_remaining_snapshot,
  hours_source,
  supersedes_update_id,
  voided_at,
  voided_by_staff_profile_id,
  void_reason,
  daily_plan_id,
  notes_for_tomorrow,
  is_day_completion,
  submission_status,
  staff_profiles!job_daily_site_updates_author_staff_profile_id_fkey(full_name),
  stages(name)
`;

const jsonError = dailyPlanJsonError;
const serverError = dailyPlanServerError;

async function loadPlanMatch(jobId: string, reportDate: string, role: 'field' | 'supervisor' | 'admin') {
  const planId = await findDailyPlanIdByJobDate(jobId, reportDate);
  if (!planId) return matchDailyPlanForReport(null, reportDate);
  const bundle = await loadDailyPlanBundle(planId, role);
  if (!bundle.ok) return matchDailyPlanForReport(null, reportDate);
  return matchDailyPlanForReport(bundle.plan, reportDate);
}

/** GET: day-completion context for a report date (plan match + draft if any). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const reportTimezone = resolveDailySiteUpdateTimezone();
  const reportDateParam = request.nextUrl.searchParams.get('reportDate')?.trim() ?? '';
  const reportDate =
    reportDateParam && isValidReportDate(reportDateParam)
      ? reportDateParam
      : todayReportDate(reportTimezone);

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  const planMatch = await loadPlanMatch(jobId, reportDate, staffAuth.staff.role);

  const { data: draftRow } = await supabaseAdmin
    .from('job_daily_site_updates')
    .select(UPDATE_SELECT)
    .eq('job_id', jobId)
    .eq('report_date', reportDate)
    .eq('is_day_completion', true)
    .eq('submission_status', 'draft')
    .is('voided_at', null)
    .maybeSingle();

  const draft = draftRow
    ? mapDailySiteUpdateRow(draftRow as DailySiteUpdateDbRow, staffAuth.staff.role)
    : null;

  let completedUpdate: ReturnType<typeof mapDailySiteUpdateRow> | null = null;
  if (planMatch.kind === 'completed' && planMatch.plan.completedDailySiteUpdateId) {
    const { data: completedRow } = await supabaseAdmin
      .from('job_daily_site_updates')
      .select(UPDATE_SELECT)
      .eq('id', planMatch.plan.completedDailySiteUpdateId)
      .maybeSingle();
    if (completedRow) {
      completedUpdate = mapDailySiteUpdateRow(
        completedRow as DailySiteUpdateDbRow,
        staffAuth.staff.role
      );
    }
  }

  const summary =
    planMatch.kind === 'active' || planMatch.kind === 'completed'
      ? planMatch.summary
      : planMatch.kind === 'draft'
        ? buildDailyPlanReportSummary(planMatch.plan)
        : null;

  const res = NextResponse.json({
    ok: true,
    reportDate,
    reportTimezone,
    planMatch,
    summary,
    draft: draft ?? completedUpdate,
    canCompleteDay: canEditDailyPlan(staffAuth.staff.role),
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

/** PUT: save day-completion draft (does not complete the Daily Plan). */
export async function PUT(
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
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const reportTimezone = resolveDailySiteUpdateTimezone();
  const parsed = parseDailySiteUpdatePostBodyForApi(body, reportTimezone);
  if (!parsed.ok) {
    return jsonError(parsed.message, 400, requestId);
  }

  const notesForTomorrow =
    body.notesForTomorrow == null
      ? null
      : String(body.notesForTomorrow).trim().slice(0, 5000) || null;

  const planMatch = await loadPlanMatch(jobId, parsed.data.reportDate, staffAuth.staff.role);
  if (planMatch.kind === 'completed') {
    return jsonError(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE, 409, requestId);
  }

  const planId =
    planMatch.kind === 'active' || planMatch.kind === 'draft' ? planMatch.plan.id : null;

  const stageId = validation.job.active_stage_id;
  const progressSnapshot = await readProgressContextSnapshot(stageId);
  const dbProgress = progressContextToDbSnapshot(progressSnapshot);

  const { data: existingDraft } = await supabaseAdmin
    .from('job_daily_site_updates')
    .select('id')
    .eq('job_id', jobId)
    .eq('report_date', parsed.data.reportDate)
    .eq('is_day_completion', true)
    .eq('submission_status', 'draft')
    .is('voided_at', null)
    .maybeSingle();

  const payload = {
    job_id: jobId,
    stage_id: stageId,
    author_staff_profile_id: staffAuth.staff.id,
    report_date: parsed.data.reportDate,
    report_timezone: reportTimezone,
    progress_today: parsed.data.progressToday,
    issues_faced: parsed.data.issuesFaced,
    issues_faced_none: parsed.data.issuesFacedNone,
    problems_resolved: parsed.data.problemsResolved,
    problems_resolved_none: parsed.data.problemsResolvedNone,
    prevention_plan: parsed.data.preventionPlan,
    prevention_plan_none: parsed.data.preventionPlanNone,
    on_track_status: parsed.data.onTrackStatus,
    on_track_notes: parsed.data.onTrackNotes,
    notes_for_tomorrow: notesForTomorrow,
    planned_hours_snapshot: dbProgress.planned_hours_snapshot,
    hours_used_snapshot: dbProgress.hours_used_snapshot,
    hours_remaining_snapshot: dbProgress.hours_remaining_snapshot,
    hours_source: dbProgress.hours_source,
    daily_plan_id: planId,
    is_day_completion: true,
    submission_status: 'draft' as const,
    submitted_at: new Date().toISOString(),
  };

  let saved: DailySiteUpdateDbRow | null = null;
  if (existingDraft?.id) {
    const { data, error } = await supabaseAdmin
      .from('job_daily_site_updates')
      .update(payload)
      .eq('id', existingDraft.id)
      .select(UPDATE_SELECT)
      .single();
    if (error || !data) {
      const err = normalizeSupabaseError(error);
      const unique = mapUniqueViolationMessage(
        err.code,
        DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE
      );
      if (unique) {
        return jsonError(unique.message, 409, requestId);
      }
      logDailyPlanMutationFailure({
        requestId,
        action: 'day_completion_draft',
        orgSlug,
        jobId,
        planId: planId ?? undefined,
        userId: staffAuth.staff.id,
        errorType: err.code ?? 'DSU_DRAFT',
        message: 'Failed to save day-completion draft',
      });
      return serverError(requestId, err.code ?? 'DSU_DRAFT', 'Failed to save day-completion draft');
    }
    saved = data as DailySiteUpdateDbRow;
  } else {
    const { data, error } = await supabaseAdmin
      .from('job_daily_site_updates')
      .insert(payload)
      .select(UPDATE_SELECT)
      .single();
    if (error || !data) {
      const err = normalizeSupabaseError(error);
      const unique = mapUniqueViolationMessage(
        err.code,
        DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE
      );
      if (unique) {
        return jsonError(unique.message, 409, requestId);
      }
      logDailyPlanMutationFailure({
        requestId,
        action: 'day_completion_draft',
        orgSlug,
        jobId,
        planId: planId ?? undefined,
        userId: staffAuth.staff.id,
        errorType: err.code ?? 'DSU_DRAFT',
        message: 'Failed to save day-completion draft',
      });
      return serverError(requestId, err.code ?? 'DSU_DRAFT', 'Failed to save day-completion draft');
    }
    saved = data as DailySiteUpdateDbRow;
  }

  // Persist provisional carry-forwards against the draft update (replace set).
  if (planMatch.kind === 'active' && Array.isArray(body.carryForwards)) {
    const summary = buildDailyPlanReportSummary(planMatch.plan);
    const cfParsed = parseCarryForwardSelections(body.carryForwards, summary.carryForwardEligible);
    if (!cfParsed.ok) {
      return jsonError(cfParsed.message, 400, requestId);
    }
    await supabaseAdmin
      .from('job_daily_plan_carry_forwards')
      .delete()
      .eq('daily_site_update_id', saved.id);
    if (cfParsed.data.length > 0) {
      const { error: cfError } = await supabaseAdmin.from('job_daily_plan_carry_forwards').insert(
        cfParsed.data.map((cf) => ({
          daily_plan_id: planMatch.plan.id,
          daily_site_update_id: saved!.id,
          outcome_id: cf.outcomeId,
          replacement_outcome_id: cf.replacementOutcomeId,
          carry_forward: cf.carryForward,
          note: cf.note,
          recorded_by_staff_profile_id: staffAuth.staff.id,
        }))
      );
      if (cfError) {
        const err = normalizeSupabaseError(cfError);
        return serverError(requestId, err.code ?? 'CF_SAVE', 'Failed to save carry-forward selections');
      }
    }
  }

  const res = NextResponse.json({
    ok: true,
    draft: mapDailySiteUpdateRow(saved, staffAuth.staff.role),
    planMatch,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

/** POST: final day completion — submits report and completes active Daily Plan atomically. */
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
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const reportTimezone = resolveDailySiteUpdateTimezone();
  const parsed = parseDailySiteUpdatePostBodyForApi(body, reportTimezone);
  if (!parsed.ok) {
    return jsonError(parsed.message, 400, requestId);
  }

  const notesForTomorrow =
    body.notesForTomorrow == null
      ? null
      : String(body.notesForTomorrow).trim().slice(0, 5000) || null;

  const planMatch = await loadPlanMatch(jobId, parsed.data.reportDate, staffAuth.staff.role);

  // Draft plan exists: do not allow a submitted day-completion that would block later atomic completion.
  if (planMatch.kind === 'draft') {
    return jsonError(DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE, 400, requestId, {
      plan: planMatch.plan,
    });
  }

  // Legacy path: no Daily Plan for this job/date — submit day-completion DSU only.
  if (planMatch.kind === 'none') {
    const stageId = validation.job.active_stage_id;
    const progressSnapshot = await readProgressContextSnapshot(stageId);
    const dbProgress = progressContextToDbSnapshot(progressSnapshot);
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('job_daily_site_updates')
      .insert({
        job_id: jobId,
        stage_id: stageId,
        author_staff_profile_id: staffAuth.staff.id,
        report_date: parsed.data.reportDate,
        report_timezone: reportTimezone,
        progress_today: parsed.data.progressToday,
        issues_faced: parsed.data.issuesFaced,
        issues_faced_none: parsed.data.issuesFacedNone,
        problems_resolved: parsed.data.problemsResolved,
        problems_resolved_none: parsed.data.problemsResolvedNone,
        prevention_plan: parsed.data.preventionPlan,
        prevention_plan_none: parsed.data.preventionPlanNone,
        on_track_status: parsed.data.onTrackStatus,
        on_track_notes: parsed.data.onTrackNotes,
        notes_for_tomorrow: notesForTomorrow,
        planned_hours_snapshot: dbProgress.planned_hours_snapshot,
        hours_used_snapshot: dbProgress.hours_used_snapshot,
        hours_remaining_snapshot: dbProgress.hours_remaining_snapshot,
        hours_source: dbProgress.hours_source,
        daily_plan_id: null,
        is_day_completion: true,
        submission_status: 'submitted',
      })
      .select(UPDATE_SELECT)
      .single();

    if (insertError || !inserted) {
      const err = normalizeSupabaseError(insertError);
      const unique = mapUniqueViolationMessage(
        err.code,
        'A Daily Report has already been completed for this date.'
      );
      if (unique) {
        return jsonError(unique.message, 409, requestId);
      }
      logDailyPlanMutationFailure({
        requestId,
        action: 'day_completion_submit',
        orgSlug,
        jobId,
        userId: staffAuth.staff.id,
        errorType: err.code ?? 'DSU_COMPLETE',
        message: 'Failed to submit Daily Report',
      });
      return serverError(requestId, err.code ?? 'DSU_COMPLETE', 'Failed to submit Daily Report');
    }

    try {
      await linkDailySiteUpdateContext({
        updateId: inserted.id,
        organisationId: validation.organisationId,
        jobId,
        stageId,
        reportDate: parsed.data.reportDate,
        staffProfileId: staffAuth.staff.id,
        ccProjectId: validation.job.cc_project_id,
        ccJobId: validation.job.cc_job_id,
      });
    } catch {
      // non-fatal
    }

    const res = NextResponse.json({
      ok: true,
      update: mapDailySiteUpdateRow(inserted as DailySiteUpdateDbRow, staffAuth.staff.role),
      plan: null,
      planCompleted: false,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (planMatch.kind === 'completed') {
    return jsonError(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE, 409, requestId, {
      plan: planMatch.plan,
    });
  }

  const summary = planMatch.summary;
  if (!summary.readyForReportCompletion) {
    return jsonError(DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE, 400, requestId, {
      unresolvedOutcomes: summary.unresolvedOutcomes,
    });
  }

  const cfParsed = parseCarryForwardSelections(
    body.carryForwards ?? [],
    summary.carryForwardEligible
  );
  if (!cfParsed.ok) {
    return jsonError(cfParsed.message, 400, requestId);
  }

  const stageId = validation.job.active_stage_id;
  const progressSnapshot = await readProgressContextSnapshot(stageId);
  const dbProgress = progressContextToDbSnapshot(progressSnapshot);

  const { data: existingDraft } = await supabaseAdmin
    .from('job_daily_site_updates')
    .select('id')
    .eq('job_id', jobId)
    .eq('report_date', parsed.data.reportDate)
    .eq('is_day_completion', true)
    .eq('submission_status', 'draft')
    .is('voided_at', null)
    .maybeSingle();

  const completed = await completeDailyPlanWithSiteUpdate({
    jobId,
    planId: planMatch.plan.id,
    actorStaffProfileId: staffAuth.staff.id,
    stageId,
    reportDate: parsed.data.reportDate,
    reportTimezone,
    progressToday: parsed.data.progressToday,
    issuesFaced: parsed.data.issuesFaced,
    issuesFacedNone: parsed.data.issuesFacedNone,
    problemsResolved: parsed.data.problemsResolved,
    problemsResolvedNone: parsed.data.problemsResolvedNone,
    preventionPlan: parsed.data.preventionPlan,
    preventionPlanNone: parsed.data.preventionPlanNone,
    onTrackStatus: parsed.data.onTrackStatus,
    onTrackNotes: parsed.data.onTrackNotes,
    notesForTomorrow,
    plannedHoursSnapshot: dbProgress.planned_hours_snapshot,
    hoursUsedSnapshot: dbProgress.hours_used_snapshot,
    hoursRemainingSnapshot: dbProgress.hours_remaining_snapshot,
    hoursSource: dbProgress.hours_source,
    carryForwards: cfParsed.data,
    draftUpdateId: existingDraft?.id ?? null,
  });

  if (!completed.ok) {
    if (completed.conflict) {
      return jsonError(completed.message, 409, requestId);
    }
    logDailyPlanMutationFailure({
      requestId,
      action: 'day_completion_submit',
      orgSlug,
      jobId,
      planId: planMatch.plan.id,
      userId: staffAuth.staff.id,
      errorType: completed.code ?? 'DP_COMPLETE',
      message: completed.message,
    });
    return jsonError(completed.message, 400, requestId, {
      unresolvedCount: completed.unresolvedCount,
    });
  }

  const bundle = await loadDailyPlanBundle(planMatch.plan.id, staffAuth.staff.role);
  let update = null;
  if (completed.updateId) {
    const { data: updateRow } = await supabaseAdmin
      .from('job_daily_site_updates')
      .select(UPDATE_SELECT)
      .eq('id', completed.updateId)
      .maybeSingle();
    if (updateRow) {
      update = mapDailySiteUpdateRow(updateRow as DailySiteUpdateDbRow, staffAuth.staff.role);
      try {
        await linkDailySiteUpdateContext({
          updateId: completed.updateId,
          organisationId: validation.organisationId,
          jobId,
          stageId,
          reportDate: parsed.data.reportDate,
          staffProfileId: staffAuth.staff.id,
          ccProjectId: validation.job.cc_project_id,
          ccJobId: validation.job.cc_job_id,
        });
      } catch {
        // non-fatal
      }
    }
  }

  const res = NextResponse.json({
    ok: true,
    update,
    plan: bundle.ok ? bundle.plan : null,
    planCompleted: true,
    alreadyCompleted: completed.alreadyCompleted,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
