import { BLOCKING_ISSUE_STATUSES } from '@/lib/qa-evidence-graph';
import type { QaType } from '@/lib/qa-run-bundle';
import {
  bundleHasIncompleteEvidence,
  computeSectionStatesFromBundle,
  countMissingEvidenceSections,
  type GenericSectionState,
} from './compute-section-states';
import { inferMissingQaTypes } from './infer-qa-type';
import { qaEvidencePath, qaRunPath, qaSupervisorPath, qaTypeLabel, urgencyLabel } from './qa-links';
import type { DashboardStatusFilter, JobAttentionRow, JobAttentionUrgency } from './types';

const URGENCY_RANK: Record<JobAttentionUrgency, number> = {
  blocked_by_issue: 1,
  submitted_not_cleared: 2,
  missing_evidence: 3,
  stale_activity: 4,
  possible_missing_run: 5,
};

type JobRow = {
  id: string;
  name: string;
  active_stage_id: string | null;
  cc_project_title_snapshot: string | null;
  cc_client_name_snapshot: string | null;
};

type RunRow = {
  id: string;
  job_id: string;
  status: string;
  qa_type: string;
  updated_at: string;
  started_at: string;
  completed_at: string | null;
  supervisor_final_approved_at: string | null;
};

type StageRow = {
  id: string;
  job_id: string;
  name: string;
  cc_section_trade?: string | null;
  checklist_templates?: { name: string } | { name: string }[] | null;
};

type BundleOk = Extract<Awaited<ReturnType<typeof import('@/lib/qa-run-bundle').loadQaRunBundle>>, { ok: true }>;

function templateName(stage: StageRow | undefined): string {
  const template = stage?.checklist_templates;
  if (Array.isArray(template)) return template[0]?.name ?? '';
  return template?.name ?? '';
}

function latestTimestamp(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestTime = 0;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time > bestTime) {
      bestTime = time;
      best = value;
    }
  }
  return best;
}

function currentSection(states: GenericSectionState[]): GenericSectionState | null {
  const submitted = states.find((s) => s.submissionStatus === 'submitted' && !s.cleared);
  if (submitted) return submitted;
  const blocked = states.find((s) => s.status === 'blocked' || s.hasBlockingIssue);
  if (blocked) return blocked;
  const pending = states.find((s) => !s.cleared);
  return pending ?? states[states.length - 1] ?? null;
}

function staleDays(lastActivityAt: string | null, thresholdDays = 3): boolean {
  if (!lastActivityAt) return true;
  const time = new Date(lastActivityAt).getTime();
  if (Number.isNaN(time)) return true;
  return Date.now() - time > thresholdDays * 24 * 60 * 60 * 1000;
}

function matchesStatusFilter(
  filter: DashboardStatusFilter,
  runStatus: string | null,
  urgency: JobAttentionUrgency,
  hasIncompleteEvidence: boolean
): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return runStatus === 'active';
  if (filter === 'blocked') return urgency === 'blocked_by_issue';
  if (filter === 'needs_review') {
    return urgency === 'submitted_not_cleared' || urgency === 'blocked_by_issue';
  }
  if (filter === 'complete') return runStatus === 'completed';
  if (filter === 'missing_evidence') {
    return urgency === 'missing_evidence' || hasIncompleteEvidence;
  }
  return true;
}

export function buildJobAttentionRows(input: {
  orgSlug: string;
  jobs: JobRow[];
  stages: StageRow[];
  runs: RunRow[];
  bundlesByRunId: Map<string, BundleOk>;
  lastActivityByRunId: Map<string, string | null>;
  openIssueCountByRunId: Map<string, number>;
  supervisorNameByStaffId: Map<string, string>;
  lastSupervisorByRunId: Map<string, string | null>;
  filters: {
    qaType: QaType | 'all';
    status: DashboardStatusFilter;
    search: string;
  };
}): JobAttentionRow[] {
  const stageById = new Map(input.stages.map((s) => [s.id, s]));
  const runsByJob = new Map<string, RunRow[]>();
  for (const run of input.runs) {
    if (!runsByJob.has(run.job_id)) runsByJob.set(run.job_id, []);
    runsByJob.get(run.job_id)!.push(run);
  }

  const search = input.filters.search.trim().toLowerCase();
  const rows: JobAttentionRow[] = [];

  for (const job of input.jobs) {
    const stage = job.active_stage_id ? stageById.get(job.active_stage_id) : undefined;
    const jobRuns = runsByJob.get(job.id) ?? [];
    const activeRuns = jobRuns.filter((r) => r.status === 'active');
    const activeTypes = new Set(activeRuns.map((r) => r.qa_type));

    const missingTypes = inferMissingQaTypes(
      stage
        ? {
            name: stage.name,
            cc_section_trade: stage.cc_section_trade,
            templateName: templateName(stage),
          }
        : null,
      activeTypes
    );

    for (const missingType of missingTypes) {
      if (input.filters.qaType !== 'all' && input.filters.qaType !== missingType) continue;
      const hay = [
        job.name,
        job.cc_project_title_snapshot ?? '',
        job.cc_client_name_snapshot ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (search && !hay.includes(search)) continue;

      const urgency: JobAttentionUrgency = 'possible_missing_run';
      if (!matchesStatusFilter(input.filters.status, null, urgency, false)) continue;

      rows.push({
        jobId: job.id,
        jobName: job.name,
        clientName: job.cc_client_name_snapshot,
        projectTitle: job.cc_project_title_snapshot,
        activeStageName: stage?.name ?? null,
        qaType: missingType,
        qaTypeLabel: qaTypeLabel(missingType),
        runId: null,
        runStatus: null,
        currentSectionStatus: null,
        currentSectionTitle: null,
        supervisorName: null,
        supervisorStaffId: null,
        lastActivityAt: null,
        issueCount: 0,
        missingEvidenceCount: 0,
        urgency,
        urgencyLabel: urgencyLabel(urgency),
        links: {
          job: `/t/${input.orgSlug}/jobs/${job.id}`,
          qaRun: `/t/${input.orgSlug}/jobs/${job.id}/qa`,
          evidence: null,
          supervisor: null,
          notes: `/t/${input.orgSlug}/jobs/${job.id}`,
        },
      });
    }

    for (const run of jobRuns) {
      const qaType = run.qa_type as QaType;
      if (input.filters.qaType !== 'all' && input.filters.qaType !== qaType) continue;

      const hay = [
        job.name,
        job.cc_project_title_snapshot ?? '',
        job.cc_client_name_snapshot ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (search && !hay.includes(search)) continue;

      const bundle = input.bundlesByRunId.get(run.id);
      const states = bundle ? computeSectionStatesFromBundle(bundle) : [];
      const hasBlocking = bundle
        ? bundle.issues.some((issue) => BLOCKING_ISSUE_STATUSES.includes(issue.status as (typeof BLOCKING_ISSUE_STATUSES)[number]))
        : false;
      const submittedNotCleared = states.some(
        (s) => s.submissionStatus === 'submitted' && !s.cleared
      );
      const incompleteEvidence = bundle ? bundleHasIncompleteEvidence(bundle) : false;
      const missingEvidenceCount = countMissingEvidenceSections(states);
      const lastActivityAt = input.lastActivityByRunId.get(run.id) ?? latestTimestamp(run.updated_at, run.started_at);
      const section = currentSection(states);

      let urgency: JobAttentionUrgency = 'stale_activity';
      if (hasBlocking) urgency = 'blocked_by_issue';
      else if (submittedNotCleared) urgency = 'submitted_not_cleared';
      else if (incompleteEvidence && run.status === 'active') urgency = 'missing_evidence';
      else if (run.status === 'active' && staleDays(lastActivityAt)) urgency = 'stale_activity';
      else if (run.status !== 'active') continue;

      if (!matchesStatusFilter(input.filters.status, run.status, urgency, incompleteEvidence)) continue;

      const supervisorStaffId = input.lastSupervisorByRunId.get(run.id) ?? null;
      rows.push({
        jobId: job.id,
        jobName: job.name,
        clientName: job.cc_client_name_snapshot,
        projectTitle: job.cc_project_title_snapshot,
        activeStageName: stage?.name ?? null,
        qaType,
        qaTypeLabel: qaTypeLabel(qaType),
        runId: run.id,
        runStatus: run.status,
        currentSectionStatus: section?.status ?? null,
        currentSectionTitle: section?.title ?? null,
        supervisorName: supervisorStaffId ? input.supervisorNameByStaffId.get(supervisorStaffId) ?? null : null,
        supervisorStaffId,
        lastActivityAt,
        issueCount: input.openIssueCountByRunId.get(run.id) ?? 0,
        missingEvidenceCount,
        urgency,
        urgencyLabel: urgencyLabel(urgency),
        links: {
          job: `/t/${input.orgSlug}/jobs/${job.id}`,
          qaRun: qaRunPath(input.orgSlug, job.id, run.id, qaType),
          evidence: qaEvidencePath(input.orgSlug, job.id, run.id),
          supervisor: qaSupervisorPath(input.orgSlug, job.id, run.id, qaType),
          notes: `/t/${input.orgSlug}/jobs/${job.id}`,
        },
      });
    }
  }

  return rows.sort((a, b) => {
    const rankDelta = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (rankDelta !== 0) return rankDelta;
    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return aTime - bTime;
  });
}

export function countUnresolvedIssues(openIssueCountByRunId: Map<string, number>): number {
  let total = 0;
  for (const count of openIssueCountByRunId.values()) total += count;
  return total;
}

export function countSectionsAwaitingReview(bundlesByRunId: Map<string, BundleOk>): number {
  let total = 0;
  for (const bundle of bundlesByRunId.values()) {
    const states = computeSectionStatesFromBundle(bundle);
    total += states.filter((s) => s.submissionStatus === 'submitted' && !s.cleared).length;
  }
  return total;
}

export function countJobsMissingEvidence(rows: JobAttentionRow[]): number {
  const jobIds = new Set<string>();
  for (const row of rows) {
    if (row.urgency === 'missing_evidence' || row.missingEvidenceCount > 0) {
      jobIds.add(row.jobId);
    }
  }
  return jobIds.size;
}
