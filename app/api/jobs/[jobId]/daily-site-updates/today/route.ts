import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import { loadCcProjectForJob } from '@/lib/cc-project-context';
import {
  mapDailySiteUpdateRow,
  loadQaEvidenceWarning,
  NO_ACTIVE_STAGE_WARNING,
  readProgressContextSnapshot,
  resolveDailySiteUpdateTimezone,
  type DailySiteUpdateDbRow,
} from '@/lib/daily-site-update';
import { todayReportDate } from '@/lib/report-date';
import { findDailyPlanIdByJobDate, loadDailyPlanBundle } from '@/lib/daily-plan';
import { matchDailyPlanForReport } from '@/lib/daily-plan-report';

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
  staff_profiles!job_daily_site_updates_author_staff_profile_id_fkey(full_name),
  stages(name)
`;

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

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  const reportTimezone = resolveDailySiteUpdateTimezone();
  const reportDate = todayReportDate(reportTimezone);

  let activeStage: {
    id: string;
    name: string;
    cc_section_trade: string | null;
    quoted_labour_hours: number | null;
  } | null = null;

  if (validation.job.active_stage_id) {
    const { data: stageRow, error: stageError } = await supabaseAdmin
      .from('stages')
      .select('id, name, cc_section_trade, quoted_labour_hours')
      .eq('id', validation.job.active_stage_id)
      .eq('job_id', jobId)
      .maybeSingle();

    if (stageError) {
      const supabaseErr = normalizeSupabaseError(stageError);
      console.error('[api/jobs/[jobId]/daily-site-updates/today] stage fetch failed:', {
        requestId,
        supabaseError: supabaseErr,
      });
    } else if (stageRow) {
      activeStage = {
        id: stageRow.id as string,
        name: String(stageRow.name),
        cc_section_trade: (stageRow.cc_section_trade as string | null) ?? null,
        quoted_labour_hours:
          stageRow.quoted_labour_hours == null ? null : Number(stageRow.quoted_labour_hours),
      };
    }
  }

  const progressContext = await readProgressContextSnapshot(activeStage?.id ?? null);
  const hasProgressContext =
    progressContext.plannedHours != null ||
    progressContext.hoursUsed != null ||
    progressContext.hoursRemaining != null;

  const ccProject = await loadCcProjectForJob(validation.job, validation.organisationId, requestId);
  const qaEvidenceWarning = await loadQaEvidenceWarning(jobId, requestId);

  const { data: recentRows, error: recentError } = await supabaseAdmin
    .from('job_daily_site_updates')
    .select(UPDATE_SELECT)
    .eq('job_id', jobId)
    .is('voided_at', null)
    .neq('submission_status', 'draft')
    .order('submitted_at', { ascending: false })
    .limit(10);

  if (recentError) {
    const supabaseErr = normalizeSupabaseError(recentError);
    console.error('[api/jobs/[jobId]/daily-site-updates/today] recent list failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'DSU_TODAY', 'Failed to load daily site updates');
  }

  const recentUpdates = (recentRows ?? []).map((row) =>
    mapDailySiteUpdateRow(row as DailySiteUpdateDbRow, staffAuth.staff.role)
  );

  let dailyPlanMatch = matchDailyPlanForReport(null, reportDate);
  const planId = await findDailyPlanIdByJobDate(jobId, reportDate);
  if (planId) {
    const bundle = await loadDailyPlanBundle(planId, staffAuth.staff.role);
    if (bundle.ok) {
      dailyPlanMatch = matchDailyPlanForReport(bundle.plan, reportDate);
    }
  }

  const res = NextResponse.json({
    ok: true,
    job: validation.job,
    ccProject,
    activeStage,
    noActiveStage: validation.job.active_stage_id == null,
    noActiveStageWarning: validation.job.active_stage_id == null ? NO_ACTIVE_STAGE_WARNING : null,
    progressContext: hasProgressContext ? progressContext : null,
    qaEvidenceWarning,
    recentUpdates,
    reportDate,
    reportTimezone,
    viewerRole: staffAuth.staff.role,
    dailyPlanMatch,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
