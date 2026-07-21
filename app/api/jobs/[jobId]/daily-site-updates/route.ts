import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  mapDailySiteUpdateRow,
  parseDailySiteUpdatePostBodyForApi,
  progressContextToDbSnapshot,
  readProgressContextSnapshot,
  resolveDailySiteUpdateTimezone,
  type DailySiteUpdateDbRow,
} from '@/lib/daily-site-update';
import { linkDailySiteUpdateContext } from '@/lib/context-links';
import { isValidReportDate } from '@/lib/report-date';
import { isSupervisorOrAdminRole } from '@/lib/staff-auth';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const reportDate = request.nextUrl.searchParams.get('reportDate')?.trim() ?? '';
  const includeVoided = request.nextUrl.searchParams.get('includeVoided') === '1';
  const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20;

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  if (reportDate && !isValidReportDate(reportDate)) {
    return jsonError('reportDate must be YYYY-MM-DD', 400, requestId);
  }

  if (includeVoided && !isSupervisorOrAdminRole(staffAuth.staff.role)) {
    return jsonError('Insufficient permissions to include voided updates', 403, requestId);
  }

  let query = supabaseAdmin
    .from('job_daily_site_updates')
    .select(UPDATE_SELECT)
    .eq('job_id', jobId)
    .order('submitted_at', { ascending: false })
    .limit(limit);

  if (reportDate) {
    query = query.eq('report_date', reportDate);
  }
  if (!includeVoided) {
    query = query.is('voided_at', null);
  }
  query = query.neq('submission_status', 'draft');

  const { data: rows, error } = await query;
  if (error) {
    const supabaseErr = normalizeSupabaseError(error);
    console.error('[api/jobs/[jobId]/daily-site-updates] GET failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'DSU_LIST', 'Failed to load daily site updates');
  }

  const updates = (rows ?? []).map((row) =>
    mapDailySiteUpdateRow(row as DailySiteUpdateDbRow, staffAuth.staff.role)
  );

  const res = NextResponse.json({ ok: true, updates });
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
      planned_hours_snapshot: dbProgress.planned_hours_snapshot,
      hours_used_snapshot: dbProgress.hours_used_snapshot,
      hours_remaining_snapshot: dbProgress.hours_remaining_snapshot,
      hours_source: dbProgress.hours_source,
    })
    .select(UPDATE_SELECT)
    .single();

  if (insertError || !inserted) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/jobs/[jobId]/daily-site-updates] POST failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'DSU_INSERT', 'Failed to save daily site update');
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
  } catch (linkError) {
    console.error('[api/jobs/[jobId]/daily-site-updates] context link failed:', {
      requestId,
      linkError,
    });
  }

  const update = mapDailySiteUpdateRow(
    inserted as DailySiteUpdateDbRow,
    staffAuth.staff.role
  );

  const res = NextResponse.json(
    {
      ok: true,
      update,
      savedAtJobLevelOnly: stageId == null,
    },
    { status: 201 }
  );
  res.headers.set('x-request-id', requestId);
  return res;
}
