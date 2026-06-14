import { BLOCKING_ISSUE_STATUSES, TERMINAL_ISSUE_STATUSES } from '@/lib/qa-evidence-graph';
import { isInRange } from './dates';
import type { SupervisorActivityRow, SupervisorActivityStatus } from './types';

type StaffRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

type SubmissionRow = {
  run_id: string;
  submitted_by: string | null;
  submitted_at: string | null;
  submission_status: string;
};

type PhotoRow = {
  run_id: string;
  uploaded_by: string | null;
  created_at: string;
};

type EventRow = {
  run_id: string;
  actor_staff_profile_id: string | null;
  created_at: string;
  action: string;
};

type IssueRow = {
  run_id: string;
  status: string;
};

const CLEAR_ACTIONS = new Set(['approve_to_proceed', 'final_approval', 'approve_rectification']);

function latestIso(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

function deriveStatus(input: {
  sectionsSubmittedInRange: number;
  sectionsClearedInRange: number;
  photoCountInRange: number;
  qaRunsTouchedInRange: number;
  openIssuesCount: number;
  lastQaActivityAt: string | null;
  rangeStart: Date;
}): SupervisorActivityStatus {
  if (
    input.sectionsSubmittedInRange === 0 &&
    input.sectionsClearedInRange === 0 &&
    input.photoCountInRange === 0 &&
    input.qaRunsTouchedInRange === 0
  ) {
    return 'no_activity';
  }

  if (input.openIssuesCount > 0 || input.sectionsSubmittedInRange > input.sectionsClearedInRange) {
    return 'needs_review';
  }

  if (!input.lastQaActivityAt || !isInRange(input.lastQaActivityAt, input.rangeStart, new Date())) {
    return 'behind';
  }

  return 'good';
}

export function computeSupervisorActivityRows(input: {
  staff: StaffRow[];
  submissions: SubmissionRow[];
  photos: PhotoRow[];
  events: EventRow[];
  issues: IssueRow[];
  rangeStart: Date;
  rangeEnd: Date;
  todayStart: Date;
}): SupervisorActivityRow[] {
  const supervisors = input.staff.filter((s) => s.role === 'supervisor' || s.role === 'admin');

  const metrics = new Map<
    string,
    {
      runsToday: Set<string>;
      runsInRange: Set<string>;
      sectionsSubmitted: number;
      sectionsCleared: number;
      photos: number;
      lastActivity: string | null;
    }
  >();

  function ensure(staffId: string) {
    if (!metrics.has(staffId)) {
      metrics.set(staffId, {
        runsToday: new Set(),
        runsInRange: new Set(),
        sectionsSubmitted: 0,
        sectionsCleared: 0,
        photos: 0,
        lastActivity: null,
      });
    }
    return metrics.get(staffId)!;
  }

  for (const submission of input.submissions) {
    if (submission.submission_status !== 'submitted' || !submission.submitted_at || !submission.submitted_by) {
      continue;
    }
    if (!isInRange(submission.submitted_at, input.rangeStart, input.rangeEnd)) continue;
    const m = ensure(submission.submitted_by);
    m.sectionsSubmitted += 1;
    m.runsInRange.add(submission.run_id);
    m.lastActivity = latestIso(m.lastActivity, submission.submitted_at);
    if (isInRange(submission.submitted_at, input.todayStart, input.rangeEnd)) {
      m.runsToday.add(submission.run_id);
    }
  }

  for (const photo of input.photos) {
    if (!photo.uploaded_by || !isInRange(photo.created_at, input.rangeStart, input.rangeEnd)) continue;
    const m = ensure(photo.uploaded_by);
    m.photos += 1;
    m.runsInRange.add(photo.run_id);
    m.lastActivity = latestIso(m.lastActivity, photo.created_at);
    if (isInRange(photo.created_at, input.todayStart, input.rangeEnd)) {
      m.runsToday.add(photo.run_id);
    }
  }

  for (const event of input.events) {
    if (!event.actor_staff_profile_id || !isInRange(event.created_at, input.rangeStart, input.rangeEnd)) continue;
    const m = ensure(event.actor_staff_profile_id);
    m.runsInRange.add(event.run_id);
    m.lastActivity = latestIso(m.lastActivity, event.created_at);
    if (CLEAR_ACTIONS.has(event.action)) {
      m.sectionsCleared += 1;
    }
    if (isInRange(event.created_at, input.todayStart, input.rangeEnd)) {
      m.runsToday.add(event.run_id);
    }
  }

  const openIssuesByRun = new Map<string, number>();
  for (const issue of input.issues) {
    if (TERMINAL_ISSUE_STATUSES.includes(issue.status as (typeof TERMINAL_ISSUE_STATUSES)[number])) continue;
    if (!BLOCKING_ISSUE_STATUSES.includes(issue.status as (typeof BLOCKING_ISSUE_STATUSES)[number])) continue;
    openIssuesByRun.set(issue.run_id, (openIssuesByRun.get(issue.run_id) ?? 0) + 1);
  }

  return supervisors.map((supervisor) => {
    const m = metrics.get(supervisor.id) ?? {
      runsToday: new Set<string>(),
      runsInRange: new Set<string>(),
      sectionsSubmitted: 0,
      sectionsCleared: 0,
      photos: 0,
      lastActivity: null,
    };

    let openIssuesCount = 0;
    for (const runId of m.runsInRange) {
      openIssuesCount += openIssuesByRun.get(runId) ?? 0;
    }

    const row: SupervisorActivityRow = {
      staffId: supervisor.id,
      name: supervisor.full_name,
      email: supervisor.email,
      activeAssignedJobs: null,
      qaRunsTouchedToday: m.runsToday.size,
      qaRunsTouchedInRange: m.runsInRange.size,
      sectionsSubmittedInRange: m.sectionsSubmitted,
      sectionsClearedInRange: m.sectionsCleared,
      openIssuesCount,
      lastQaActivityAt: m.lastActivity,
      photoCountInRange: m.photos,
      status: 'no_activity',
    };

    row.status = deriveStatus({
      sectionsSubmittedInRange: row.sectionsSubmittedInRange,
      sectionsClearedInRange: row.sectionsClearedInRange,
      photoCountInRange: row.photoCountInRange,
      qaRunsTouchedInRange: row.qaRunsTouchedInRange,
      openIssuesCount: row.openIssuesCount,
      lastQaActivityAt: row.lastQaActivityAt,
      rangeStart: input.rangeStart,
    });

    return row;
  });
}
