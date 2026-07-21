import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isValidReportDate, todayReportDate } from '@/lib/report-date';
import { DAILY_PLAN_WORK_TIMEZONE } from '@/lib/daily-plan-shared';
import {
  buildSiteOperationsJobRow,
  buildSiteOperationsMetrics,
  canViewSiteOperations,
  filterSiteOperationsRows,
  sortSiteOperationsRows,
  type SiteOpsJobInput,
} from '@/lib/site-operations';

export const runtime = 'nodejs';

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

type JobRow = {
  id: string;
  name: string;
  active_stage_id: string | null;
  cc_client_name_snapshot: string | null;
  cc_project_title_snapshot: string | null;
};

type PlanRow = {
  id: string;
  job_id: string;
  status: string;
  supervisor_staff_profile_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_daily_site_update_id: string | null;
  supervisor: { full_name: string } | { full_name: string }[] | null;
};

type OutcomeStatusRow = {
  daily_plan_id: string;
  execution_status: string;
};

type PlanIdRow = {
  daily_plan_id: string;
};

type DsuRow = {
  id: string;
  job_id: string;
  is_day_completion: boolean | null;
  submission_status: string | null;
  submitted_at: string | null;
  created_at: string;
};

function supervisorName(plan: PlanRow): string | null {
  const s = plan.supervisor;
  if (!s) return null;
  if (Array.isArray(s)) return s[0]?.full_name?.trim() || null;
  return s.full_name?.trim() || null;
}

function countByPlanId(rows: PlanIdRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.daily_plan_id, (map.get(row.daily_plan_id) ?? 0) + 1);
  }
  return map;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const workDateParam = request.nextUrl.searchParams.get('workDate')?.trim() ?? '';
  const planStatus = request.nextUrl.searchParams.get('planStatus')?.trim() ?? null;
  const attention = request.nextUrl.searchParams.get('attention')?.trim() ?? null;
  const supervisorId = request.nextUrl.searchParams.get('supervisor')?.trim() ?? null;
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? null;

  if (!orgSlug) {
    return jsonError('orgSlug is required', 400, requestId);
  }

  const staffAuth = await guardStaffApi(orgSlug, ['admin']);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!canViewSiteOperations(staffAuth.staff.role)) {
    return jsonError('Forbidden', 403, requestId);
  }

  const workDate = workDateParam || todayReportDate(DAILY_PLAN_WORK_TIMEZONE);
  if (!isValidReportDate(workDate)) {
    return jsonError('workDate must be YYYY-MM-DD', 400, requestId);
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id, name, slug')
    .eq('slug', orgSlug)
    .maybeSingle();

  if (orgError || !org) {
    return jsonError('Invalid organisation', 400, requestId);
  }

  const { data: jobsData, error: jobsError } = await supabaseAdmin
    .from('jobs')
    .select('id, name, active_stage_id, cc_client_name_snapshot, cc_project_title_snapshot')
    .eq('organisation_id', org.id)
    .is('hidden_from_qa_at', null)
    .order('name', { ascending: true });

  if (jobsError) {
    console.error('[api/site-operations/daily] jobs load failed', { requestId, jobsError });
    return serverError(requestId, 'SO_JOBS', 'Failed to load jobs');
  }

  const jobs = (jobsData ?? []) as JobRow[];
  const jobIds = jobs.map((j) => j.id);

  if (jobIds.length === 0) {
    const res = NextResponse.json({
      ok: true,
      workDate,
      workTimezone: DAILY_PLAN_WORK_TIMEZONE,
      org: { id: org.id, name: org.name, slug: org.slug },
      metrics: buildSiteOperationsMetrics([]),
      jobs: [],
      supervisors: [],
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: plansData, error: plansError } = await supabaseAdmin
    .from('job_daily_plans')
    .select(
      `
      id,
      job_id,
      status,
      supervisor_staff_profile_id,
      started_at,
      completed_at,
      completed_daily_site_update_id,
      supervisor:staff_profiles!job_daily_plans_supervisor_staff_profile_id_fkey(full_name)
    `
    )
    .eq('work_date', workDate)
    .in('job_id', jobIds);

  if (plansError) {
    console.error('[api/site-operations/daily] plans load failed', { requestId, plansError });
    return serverError(requestId, 'SO_PLANS', 'Failed to load Daily Plans');
  }

  const plans = (plansData ?? []) as PlanRow[];
  const planByJobId = new Map(plans.map((p) => [p.job_id, p]));
  const planIds = plans.map((p) => p.id);

  let outcomeRows: OutcomeStatusRow[] = [];
  let replacementRows: OutcomeStatusRow[] = [];
  let changeCounts = new Map<string, number>();
  let carryCounts = new Map<string, number>();

  if (planIds.length > 0) {
    const [outcomesRes, replacementsRes, changesRes, carryRes] = await Promise.all([
      supabaseAdmin
        .from('job_daily_plan_outcomes')
        .select('daily_plan_id, execution_status')
        .in('daily_plan_id', planIds),
      supabaseAdmin
        .from('job_daily_plan_replacement_outcomes')
        .select('daily_plan_id, execution_status')
        .in('daily_plan_id', planIds),
      supabaseAdmin
        .from('job_daily_plan_changes')
        .select('daily_plan_id')
        .in('daily_plan_id', planIds),
      supabaseAdmin
        .from('job_daily_plan_carry_forwards')
        .select('daily_plan_id')
        .in('daily_plan_id', planIds)
        .eq('carry_forward', true),
    ]);

    if (outcomesRes.error) {
      console.error('[api/site-operations/daily] outcomes load failed', {
        requestId,
        error: outcomesRes.error,
      });
      return serverError(requestId, 'SO_OUTCOMES', 'Failed to load plan outcomes');
    }
    if (replacementsRes.error) {
      console.error('[api/site-operations/daily] replacements load failed', {
        requestId,
        error: replacementsRes.error,
      });
      return serverError(requestId, 'SO_REPLACEMENTS', 'Failed to load replacement outcomes');
    }
    if (changesRes.error) {
      console.error('[api/site-operations/daily] changes load failed', {
        requestId,
        error: changesRes.error,
      });
      return serverError(requestId, 'SO_CHANGES', 'Failed to load plan changes');
    }
    if (carryRes.error) {
      console.error('[api/site-operations/daily] carry-forwards load failed', {
        requestId,
        error: carryRes.error,
      });
      return serverError(requestId, 'SO_CARRY', 'Failed to load carry-forwards');
    }

    outcomeRows = (outcomesRes.data ?? []) as OutcomeStatusRow[];
    replacementRows = (replacementsRes.data ?? []) as OutcomeStatusRow[];
    changeCounts = countByPlanId((changesRes.data ?? []) as PlanIdRow[]);
    carryCounts = countByPlanId((carryRes.data ?? []) as PlanIdRow[]);
  }

  const { data: dsuData, error: dsuError } = await supabaseAdmin
    .from('job_daily_site_updates')
    .select('id, job_id, is_day_completion, submission_status, submitted_at, created_at')
    .eq('report_date', workDate)
    .in('job_id', jobIds)
    .is('voided_at', null);

  if (dsuError) {
    console.error('[api/site-operations/daily] DSU load failed', { requestId, dsuError });
    return serverError(requestId, 'SO_DSU', 'Failed to load Daily Site Updates');
  }

  const dsuByJobId = new Map<
    string,
    {
      midDaySubmittedCount: number;
      dayCompletionDraft: boolean;
      dayCompletionSubmitted: boolean;
      dayCompletionUpdateId: string | null;
      latestSubmittedAt: string | null;
    }
  >();

  for (const row of (dsuData ?? []) as DsuRow[]) {
    const existing = dsuByJobId.get(row.job_id) ?? {
      midDaySubmittedCount: 0,
      dayCompletionDraft: false,
      dayCompletionSubmitted: false,
      dayCompletionUpdateId: null,
      latestSubmittedAt: null,
    };

    const isDayCompletion = row.is_day_completion === true;
    const isSubmitted = row.submission_status !== 'draft';
    const isDraft = row.submission_status === 'draft';

    if (isDayCompletion && isSubmitted) {
      existing.dayCompletionSubmitted = true;
      existing.dayCompletionUpdateId = row.id;
    } else if (isDayCompletion && isDraft) {
      existing.dayCompletionDraft = true;
      if (!existing.dayCompletionUpdateId) existing.dayCompletionUpdateId = row.id;
    } else if (!isDayCompletion && isSubmitted) {
      existing.midDaySubmittedCount += 1;
    }

    const ts = row.submitted_at ?? row.created_at;
    if (
      ts &&
      (!existing.latestSubmittedAt ||
        new Date(ts).getTime() > new Date(existing.latestSubmittedAt).getTime())
    ) {
      existing.latestSubmittedAt = ts;
    }

    dsuByJobId.set(row.job_id, existing);
  }

  const outcomesByPlan = new Map<string, Array<{ executionStatus: string }>>();
  for (const row of outcomeRows) {
    const list = outcomesByPlan.get(row.daily_plan_id) ?? [];
    list.push({ executionStatus: row.execution_status });
    outcomesByPlan.set(row.daily_plan_id, list);
  }

  const replacementsByPlan = new Map<string, Array<{ executionStatus: string }>>();
  for (const row of replacementRows) {
    const list = replacementsByPlan.get(row.daily_plan_id) ?? [];
    list.push({ executionStatus: row.execution_status });
    replacementsByPlan.set(row.daily_plan_id, list);
  }

  const emptyDsu = {
    midDaySubmittedCount: 0,
    dayCompletionDraft: false,
    dayCompletionSubmitted: false,
    dayCompletionUpdateId: null,
    latestSubmittedAt: null,
  };

  const inputs: SiteOpsJobInput[] = jobs.map((job) => {
    const plan = planByJobId.get(job.id) ?? null;
    return {
      jobId: job.id,
      jobName: job.name,
      clientName: job.cc_client_name_snapshot,
      projectTitle: job.cc_project_title_snapshot,
      workDate,
      plan: plan
        ? {
            id: plan.id,
            status: plan.status,
            supervisorStaffProfileId: plan.supervisor_staff_profile_id,
            supervisorName: supervisorName(plan),
            startedAt: plan.started_at,
            completedAt: plan.completed_at,
            completedDailySiteUpdateId: plan.completed_daily_site_update_id,
          }
        : null,
      outcomes: plan ? outcomesByPlan.get(plan.id) ?? [] : [],
      replacements: plan ? replacementsByPlan.get(plan.id) ?? [] : [],
      changeCount: plan ? changeCounts.get(plan.id) ?? 0 : 0,
      carryForwardCount: plan ? carryCounts.get(plan.id) ?? 0 : 0,
      dsu: dsuByJobId.get(job.id) ?? emptyDsu,
    };
  });

  const allRows = inputs.map((input) => buildSiteOperationsJobRow(input));
  const filtered = filterSiteOperationsRows(allRows, {
    planStatus,
    attention,
    supervisorId,
    q,
  });
  const jobsOut = sortSiteOperationsRows(filtered);
  const metrics = buildSiteOperationsMetrics(allRows);

  const supervisorMap = new Map<string, string>();
  for (const row of allRows) {
    if (row.supervisorStaffProfileId && row.supervisorName) {
      supervisorMap.set(row.supervisorStaffProfileId, row.supervisorName);
    }
  }
  const supervisors = [...supervisorMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const res = NextResponse.json({
    ok: true,
    workDate,
    workTimezone: DAILY_PLAN_WORK_TIMEZONE,
    org: { id: org.id, name: org.name, slug: org.slug },
    metrics,
    jobs: jobsOut,
    supervisors,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
