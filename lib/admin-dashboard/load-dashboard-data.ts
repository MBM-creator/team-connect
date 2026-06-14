import { supabaseAdmin } from '@/lib/supabase-admin';
import { detectRunVersion } from '@/lib/paving-qa-dispatch';
import { validateFencingSetupV1 } from '@/lib/fencing-qa-v1-setup';
import { validateIrrigationSetupV1 } from '@/lib/irrigation-qa-v1-setup';
import { validateSignoffSetupV1 } from '@/lib/signoff-qa-v1-setup';
import type { IssueSnapshot, SubmissionSnapshot } from '@/lib/qa-evidence-graph';
import type { QaRunBundle, QaType } from '@/lib/qa-run-bundle';
import { buildActivityFeed } from './build-activity-feed';
import {
  buildJobAttentionRows,
  countJobsMissingEvidence,
  countSectionsAwaitingReview,
  countUnresolvedIssues,
} from './compute-run-attention';
import { computeSupervisorActivityRows } from './compute-supervisor-activity';
import { resolveDateRange, startOfTodayUtc, startOfWeekUtc } from './dates';
import type { AdminDashboardData, DashboardFilters } from './types';

type RunRow = {
  id: string;
  job_id: string;
  stage_id: string | null;
  status: string;
  qa_type: string;
  setup: unknown;
  setup_version: number | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  supervisor_final_approved_at: string | null;
};

function normalizeQaType(value: string | null | undefined): QaType {
  if (value === 'irrigation' || value === 'fencing' || value === 'sign_off') return value;
  return 'paving';
}

function buildBundle(run: RunRow, submissions: SubmissionSnapshot[], issues: IssueSnapshot[], photoRows: { section_code: string; item_key: string }[]): Extract<QaRunBundle, { ok: true }> | null {
  const runRow = {
    id: run.id,
    job_id: run.job_id,
    stage_id: run.stage_id,
    status: run.status,
    qa_type: normalizeQaType(run.qa_type),
    setup: run.setup,
    setup_version: run.setup_version,
    started_at: run.started_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at,
    supervisor_final_approved_at: run.supervisor_final_approved_at,
  };

  if (runRow.qa_type === 'irrigation') {
    const parsed = validateIrrigationSetupV1(run.setup);
    if (!parsed.ok) return null;
    return {
      ok: true,
      qaType: 'irrigation',
      version: 1,
      run: runRow,
      setup: parsed.setup,
      submissions,
      issues,
      photoRows,
    };
  }

  if (runRow.qa_type === 'fencing') {
    const parsed = validateFencingSetupV1(run.setup);
    if (!parsed.ok) return null;
    return {
      ok: true,
      qaType: 'fencing',
      version: 1,
      run: runRow,
      setup: parsed.setup,
      submissions,
      issues,
      photoRows,
    };
  }

  if (runRow.qa_type === 'sign_off') {
    const parsed = validateSignoffSetupV1(run.setup);
    if (!parsed.ok) return null;
    return {
      ok: true,
      qaType: 'sign_off',
      version: 1,
      run: runRow,
      setup: parsed.setup,
      submissions,
      issues,
      photoRows,
    };
  }

  const versionInfo = detectRunVersion(run.setup, run.setup_version);
  if (versionInfo.version === 2) {
    return {
      ok: true,
      qaType: 'paving',
      version: 2,
      run: runRow,
      setup: versionInfo.setup,
      submissions,
      issues,
      photoRows,
    };
  }

  return null;
}

export function parseDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  const qaTypeRaw = searchParams.get('qaType')?.trim() ?? 'all';
  const qaType =
    qaTypeRaw === 'paving' ||
    qaTypeRaw === 'irrigation' ||
    qaTypeRaw === 'fencing' ||
    qaTypeRaw === 'sign_off'
      ? qaTypeRaw
      : 'all';

  const statusRaw = searchParams.get('status')?.trim() ?? 'all';
  const status =
    statusRaw === 'active' ||
    statusRaw === 'blocked' ||
    statusRaw === 'needs_review' ||
    statusRaw === 'complete' ||
    statusRaw === 'missing_evidence'
      ? statusRaw
      : 'all';

  const rangeRaw = searchParams.get('range')?.trim() ?? '7d';
  const range = rangeRaw === 'today' || rangeRaw === '30d' ? rangeRaw : '7d';

  return {
    qaType,
    supervisorId: searchParams.get('supervisorId')?.trim() || 'all',
    status,
    range,
    search: searchParams.get('search')?.trim() ?? '',
  };
}

export async function loadAdminDashboardData(orgId: string, orgSlug: string, filters: DashboardFilters): Promise<AdminDashboardData> {
  const { start: rangeStart, end: rangeEnd } = resolveDateRange(filters.range);
  const rangeStartIso = rangeStart.toISOString();
  const todayStart = startOfTodayUtc();
  const weekStart = startOfWeekUtc();

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from('jobs')
    .select(
      'id, name, active_stage_id, cc_project_title_snapshot, cc_client_name_snapshot, hidden_from_qa_at'
    )
    .eq('organisation_id', orgId)
    .is('hidden_from_qa_at', null)
    .order('created_at', { ascending: false });

  if (jobsError) throw jobsError;

  const jobsList = (jobs ?? []).filter((j) => !j.hidden_from_qa_at);
  const jobIds = jobsList.map((j) => j.id as string);
  if (jobIds.length === 0) {
    return {
      filters,
      rangeStart: rangeStartIso,
      rangeEnd: rangeEnd.toISOString(),
      cards: {
        activeQaRuns: 0,
        jobsNeedingAttention: 0,
        unresolvedQaIssues: 0,
        sectionsAwaitingReview: 0,
        jobsMissingEvidence: 0,
        completedQaRunsThisWeek: 0,
        supervisorsActiveToday: 0,
        supervisorsActiveThisWeek: 0,
      },
      supervisorActivityLabel: 'QA activity by supervisor',
      supervisors: [],
      jobsNeedingAttention: [],
      activityFeed: [],
    };
  }

  const { data: stages } = await supabaseAdmin
    .from('stages')
    .select('id, job_id, name, cc_section_trade, checklist_templates(name)')
    .in('job_id', jobIds);

  const { data: runsRaw, error: runsError } = await supabaseAdmin
    .from('paving_qa_runs')
    .select(
      'id, job_id, stage_id, status, qa_type, setup, setup_version, started_at, updated_at, completed_at, supervisor_final_approved_at'
    )
    .in('job_id', jobIds)
    .or(
      `status.eq.active,updated_at.gte.${rangeStartIso},started_at.gte.${rangeStartIso},completed_at.gte.${rangeStartIso},supervisor_final_approved_at.gte.${rangeStartIso}`
    );

  if (runsError) throw runsError;

  let runs = (runsRaw ?? []) as RunRow[];
  if (filters.qaType !== 'all') {
    runs = runs.filter((run) => normalizeQaType(run.qa_type) === filters.qaType);
  }

  const runIds = runs.map((run) => run.id);
  const submissionsRaw =
    runIds.length === 0
      ? []
      : (
          await supabaseAdmin
            .from('paving_qa_section_submissions')
            .select('id, run_id, section_code, submission_status, answers, submitted_at, submitted_by, updated_at')
            .in('run_id', runIds)
        ).data ?? [];

  const issuesRaw =
    runIds.length === 0
      ? []
      : (
          await supabaseAdmin
            .from('paving_qa_issues')
            .select('id, run_id, section_code, item_key, severity, status, title, created_at, updated_at')
            .in('run_id', runIds)
        ).data ?? [];

  const photosRaw =
    runIds.length === 0
      ? []
      : (
          await supabaseAdmin
            .from('paving_qa_photos')
            .select('id, run_id, section_code, item_key, created_at, uploaded_by')
            .in('run_id', runIds)
        ).data ?? [];

  const eventsRaw =
    runIds.length === 0
      ? []
      : (
          await supabaseAdmin
            .from('paving_qa_supervisor_events')
            .select('id, run_id, issue_id, action, created_at, actor_staff_profile_id')
            .in('run_id', runIds)
            .gte('created_at', rangeStartIso)
        ).data ?? [];

  const { data: staffRaw } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, full_name, email, role, active')
    .eq('org_id', orgId)
    .eq('active', true);

  const staffList = staffRaw ?? [];
  const staffMap = new Map(staffList.map((s) => [s.id as string, s.full_name as string]));

  const submissionsByRun = new Map<string, SubmissionSnapshot[]>();
  for (const row of submissionsRaw) {
    const runId = row.run_id as string;
    if (!submissionsByRun.has(runId)) submissionsByRun.set(runId, []);
    submissionsByRun.get(runId)!.push({
      section_code: row.section_code as string,
      submission_status: row.submission_status as string,
      answers: (row.answers as Record<string, { result?: string; note?: string }>) ?? {},
      submitted_at: row.submitted_at as string | null,
    });
  }

  const issuesByRun = new Map<string, IssueSnapshot[]>();
  const openIssueCountByRunId = new Map<string, number>();
  for (const row of issuesRaw) {
    const runId = row.run_id as string;
    if (!issuesByRun.has(runId)) issuesByRun.set(runId, []);
    issuesByRun.get(runId)!.push({
      id: row.id as string,
      section_code: row.section_code as string,
      item_key: row.item_key as string,
      severity: row.severity as string,
      status: row.status as string,
      title: (row.title as string) ?? null,
    });
    if (!['resolved_approved', 'proceed_approved'].includes(row.status as string)) {
      openIssueCountByRunId.set(runId, (openIssueCountByRunId.get(runId) ?? 0) + 1);
    }
  }

  const photosByRun = new Map<string, { section_code: string; item_key: string }[]>();
  for (const row of photosRaw) {
    const runId = row.run_id as string;
    if (!photosByRun.has(runId)) photosByRun.set(runId, []);
    photosByRun.get(runId)!.push({
      section_code: row.section_code as string,
      item_key: row.item_key as string,
    });
  }

  const lastActivityByRunId = new Map<string, string | null>();
  const lastSupervisorByRunId = new Map<string, string | null>();

  for (const run of runs) {
    let last: string | null = run.updated_at ?? run.started_at;
    for (const submission of submissionsRaw.filter((s) => s.run_id === run.id)) {
      if (submission.submitted_at) {
        last =
          !last || new Date(submission.submitted_at).getTime() > new Date(last).getTime()
            ? (submission.submitted_at as string)
            : last;
      }
    }
    for (const photo of photosRaw.filter((p) => p.run_id === run.id)) {
      last =
        !last || new Date(photo.created_at as string).getTime() > new Date(last).getTime()
          ? (photo.created_at as string)
          : last;
    }
    lastActivityByRunId.set(run.id, last);
  }

  for (const event of eventsRaw) {
    if (!event.actor_staff_profile_id) continue;
    lastSupervisorByRunId.set(event.run_id as string, event.actor_staff_profile_id as string);
  }

  const bundlesByRunId = new Map<string, Extract<QaRunBundle, { ok: true }>>();
  for (const run of runs) {
    const bundle = buildBundle(
      run,
      submissionsByRun.get(run.id) ?? [],
      issuesByRun.get(run.id) ?? [],
      photosByRun.get(run.id) ?? []
    );
    if (bundle) bundlesByRunId.set(run.id, bundle);
  }

  let jobsNeedingAttention = buildJobAttentionRows({
    orgSlug,
    jobs: jobsList.map((j) => ({
      id: j.id as string,
      name: j.name as string,
      active_stage_id: (j.active_stage_id as string | null) ?? null,
      cc_project_title_snapshot: (j.cc_project_title_snapshot as string | null) ?? null,
      cc_client_name_snapshot: (j.cc_client_name_snapshot as string | null) ?? null,
    })),
    stages: (stages ?? []) as Array<{
      id: string;
      job_id: string;
      name: string;
      cc_section_trade?: string | null;
      checklist_templates?: { name: string } | { name: string }[] | null;
    }>,
    runs,
    bundlesByRunId,
    lastActivityByRunId,
    openIssueCountByRunId,
    supervisorNameByStaffId: staffMap,
    lastSupervisorByRunId,
    filters: {
      qaType: filters.qaType,
      status: filters.status,
      search: filters.search,
    },
  });

  if (filters.supervisorId !== 'all') {
    jobsNeedingAttention = jobsNeedingAttention.filter(
      (row) => row.supervisorStaffId === filters.supervisorId
    );
  }

  let supervisors = computeSupervisorActivityRows({
    staff: staffList as Array<{ id: string; full_name: string; email: string; role: string }>,
    submissions: submissionsRaw as Array<{
      run_id: string;
      submitted_by: string | null;
      submitted_at: string | null;
      submission_status: string;
    }>,
    photos: photosRaw as Array<{ run_id: string; uploaded_by: string | null; created_at: string }>,
    events: eventsRaw as Array<{
      run_id: string;
      actor_staff_profile_id: string | null;
      created_at: string;
      action: string;
    }>,
    issues: issuesRaw as Array<{ run_id: string; status: string }>,
    rangeStart,
    rangeEnd,
    todayStart,
  });

  if (filters.supervisorId !== 'all') {
    supervisors = supervisors.filter((row) => row.staffId === filters.supervisorId);
  }

  const activeSupervisorsToday = supervisors.filter((row) => row.qaRunsTouchedToday > 0).length;
  const activeSupervisorsWeek = supervisors.filter((row) => row.qaRunsTouchedInRange > 0).length;

  const completedThisWeek = runs.filter(
    (run) =>
      run.status === 'completed' &&
      run.completed_at &&
      new Date(run.completed_at).getTime() >= weekStart.getTime()
  ).length;

  const activityFeed = buildActivityFeed({
    orgSlug,
    jobs: new Map(jobsList.map((j) => [j.id as string, { name: j.name as string }])),
    staff: staffMap,
    runs: runs.map((run) => ({
      id: run.id,
      job_id: run.job_id,
      qa_type: normalizeQaType(run.qa_type),
    })),
    submissions: submissionsRaw as Array<{
      id: string;
      run_id: string;
      section_code: string;
      submission_status: string;
      submitted_at: string | null;
      submitted_by: string | null;
    }>,
    photos: photosRaw as Array<{
      id: string;
      run_id: string;
      section_code: string;
      item_key: string;
      created_at: string;
      uploaded_by: string | null;
    }>,
    issues: issuesRaw as Array<{
      id: string;
      run_id: string;
      section_code: string;
      item_key: string;
      status: string;
      title: string | null;
      created_at: string;
      updated_at: string;
    }>,
    events: eventsRaw as Array<{
      id: string;
      run_id: string;
      issue_id: string | null;
      action: string;
      created_at: string;
      actor_staff_profile_id: string | null;
    }>,
    rangeStart,
    rangeEnd,
  });

  return {
    filters,
    rangeStart: rangeStartIso,
    rangeEnd: rangeEnd.toISOString(),
    cards: {
      activeQaRuns: runs.filter((run) => run.status === 'active').length,
      jobsNeedingAttention: new Set(jobsNeedingAttention.map((row) => row.jobId)).size,
      unresolvedQaIssues: countUnresolvedIssues(openIssueCountByRunId),
      sectionsAwaitingReview: countSectionsAwaitingReview(bundlesByRunId),
      jobsMissingEvidence: countJobsMissingEvidence(jobsNeedingAttention),
      completedQaRunsThisWeek: completedThisWeek,
      supervisorsActiveToday: activeSupervisorsToday,
      supervisorsActiveThisWeek: activeSupervisorsWeek,
    },
    supervisorActivityLabel: 'QA activity by supervisor',
    supervisors,
    jobsNeedingAttention,
    activityFeed,
  };
}
