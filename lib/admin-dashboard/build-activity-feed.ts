import { TERMINAL_ISSUE_STATUSES } from '@/lib/qa-evidence-graph';
import type { QaType } from '@/lib/qa-run-bundle';
import { isInRange } from './dates';
import { qaRunPath, qaSupervisorPath } from './qa-links';
import type { ActivityFeedItem, ActivityFeedKind } from './types';

type JobMap = Map<string, { name: string }>;
type StaffMap = Map<string, string>;

type SubmissionRow = {
  id: string;
  run_id: string;
  section_code: string;
  submission_status: string;
  submitted_at: string | null;
  submitted_by: string | null;
};

type PhotoRow = {
  id: string;
  run_id: string;
  section_code: string;
  item_key: string;
  created_at: string;
  uploaded_by: string | null;
};

type IssueRow = {
  id: string;
  run_id: string;
  section_code: string;
  item_key: string;
  status: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  run_id: string;
  issue_id: string | null;
  action: string;
  created_at: string;
  actor_staff_profile_id: string | null;
};

type RunMeta = {
  id: string;
  job_id: string;
  qa_type: QaType;
};

function sectionTitle(code: string): string {
  return code.replace(/_/g, ' ');
}

export function buildActivityFeed(input: {
  orgSlug: string;
  jobs: JobMap;
  staff: StaffMap;
  runs: RunMeta[];
  submissions: SubmissionRow[];
  photos: PhotoRow[];
  issues: IssueRow[];
  events: EventRow[];
  rangeStart: Date;
  rangeEnd: Date;
  limit?: number;
}): ActivityFeedItem[] {
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const items: ActivityFeedItem[] = [];

  function push(item: Omit<ActivityFeedItem, 'id'> & { id?: string }) {
    items.push({ ...item, id: item.id ?? `${item.kind}-${items.length}` });
  }

  for (const submission of input.submissions) {
    if (submission.submission_status !== 'submitted' || !submission.submitted_at) continue;
    if (!isInRange(submission.submitted_at, input.rangeStart, input.rangeEnd)) continue;
    const run = runById.get(submission.run_id);
    if (!run) continue;
    const job = input.jobs.get(run.job_id);
    if (!job) continue;
    push({
      id: `submission-${submission.id}`,
      kind: 'section_submitted',
      label: 'Section submitted',
      actorName: submission.submitted_by ? input.staff.get(submission.submitted_by) ?? null : null,
      jobId: run.job_id,
      jobName: job.name,
      runId: run.id,
      sectionCode: submission.section_code,
      sectionTitle: sectionTitle(submission.section_code),
      timestamp: submission.submitted_at,
      href: `${qaRunPath(input.orgSlug, run.job_id, run.id, run.qa_type)}/${submission.section_code}`,
    });
  }

  for (const issue of input.issues) {
    const run = runById.get(issue.run_id);
    if (!run) continue;
    const job = input.jobs.get(run.job_id);
    if (!job) continue;

    if (isInRange(issue.created_at, input.rangeStart, input.rangeEnd)) {
      push({
        id: `issue-created-${issue.id}`,
        kind: 'issue_raised',
        label: issue.title ? `Issue raised: ${issue.title}` : 'Issue raised',
        actorName: null,
        jobId: run.job_id,
        jobName: job.name,
        runId: run.id,
        sectionCode: issue.section_code,
        sectionTitle: sectionTitle(issue.section_code),
        timestamp: issue.created_at,
        href: qaSupervisorPath(input.orgSlug, run.job_id, run.id, run.qa_type),
      });
    }

    if (
      isInRange(issue.updated_at, input.rangeStart, input.rangeEnd) &&
      TERMINAL_ISSUE_STATUSES.includes(issue.status as (typeof TERMINAL_ISSUE_STATUSES)[number]) &&
      issue.updated_at !== issue.created_at
    ) {
      push({
        id: `issue-resolved-${issue.id}`,
        kind: 'issue_rectified',
        label: 'Issue rectified / approved',
        actorName: null,
        jobId: run.job_id,
        jobName: job.name,
        runId: run.id,
        sectionCode: issue.section_code,
        sectionTitle: sectionTitle(issue.section_code),
        timestamp: issue.updated_at,
        href: qaSupervisorPath(input.orgSlug, run.job_id, run.id, run.qa_type),
      });
    }
  }

  for (const photo of input.photos) {
    if (!isInRange(photo.created_at, input.rangeStart, input.rangeEnd)) continue;
    const run = runById.get(photo.run_id);
    if (!run) continue;
    const job = input.jobs.get(run.job_id);
    if (!job) continue;
    push({
      id: `photo-${photo.id}`,
      kind: 'photo_uploaded',
      label: 'Photo uploaded',
      actorName: photo.uploaded_by ? input.staff.get(photo.uploaded_by) ?? null : null,
      jobId: run.job_id,
      jobName: job.name,
      runId: run.id,
      sectionCode: photo.section_code,
      sectionTitle: sectionTitle(photo.section_code),
      timestamp: photo.created_at,
      href: `${qaRunPath(input.orgSlug, run.job_id, run.id, run.qa_type)}/${photo.section_code}`,
    });
  }

  for (const event of input.events) {
    if (!isInRange(event.created_at, input.rangeStart, input.rangeEnd)) continue;
    const run = runById.get(event.run_id);
    if (!run) continue;
    const job = input.jobs.get(run.job_id);
    if (!job) continue;

    const kind: ActivityFeedKind =
      event.action === 'final_approval' ? 'final_approval' : 'supervisor_approved';

    push({
      id: `event-${event.id}`,
      kind,
      label:
        event.action === 'final_approval'
          ? 'Final approval completed'
          : `Supervisor action: ${event.action.replace(/_/g, ' ')}`,
      actorName: event.actor_staff_profile_id
        ? input.staff.get(event.actor_staff_profile_id) ?? null
        : null,
      jobId: run.job_id,
      jobName: job.name,
      runId: run.id,
      sectionCode: null,
      sectionTitle: null,
      timestamp: event.created_at,
      href: qaSupervisorPath(input.orgSlug, run.job_id, run.id, run.qa_type),
    });
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, input.limit ?? 50);
}
