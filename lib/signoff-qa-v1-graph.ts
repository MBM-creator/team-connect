import {
  getApplicableSignoffSectionCodes,
  getSignoffSectionDefinition,
  type SignoffSectionCode,
} from './signoff-qa-v1-catalog';
import type { SignoffQaSetupV1 } from './signoff-qa-v1-types';
import {
  buildPhotoCounts,
  buildSubmissionMap,
  BLOCKING_ISSUE_STATUSES,
  TERMINAL_ISSUE_STATUSES,
  type IssueSnapshot,
  type PhotoCounts,
  type SubmissionSnapshot,
} from './qa-evidence-graph';

export type { IssueSnapshot, SubmissionSnapshot };

export type SignoffSectionStatus =
  | 'pending'
  | 'submitted'
  | 'cleared'
  | 'issue_raised'
  | 'rectification_required'
  | 'rectified_awaiting_supervisor'
  | 'supervisor_approved_to_proceed'
  | 'blocked_by_unresolved_issue';

export type SignoffSectionUiState = {
  code: SignoffSectionCode;
  title: string;
  description: string;
  applicable: boolean;
  status: SignoffSectionStatus;
  cleared: boolean;
  clearReasons: string[];
  predecessors: SignoffSectionCode[];
  blockedBy: { section: SignoffSectionCode; reason: string }[] | null;
  hasBlockingIssue: boolean;
  submissionStatus: string | null;
  submittedAt: string | null;
};

function photoKey(section: string, itemKey: string): string {
  return `${section}:${itemKey}`;
}

function issuesForSection(code: string, issues: IssueSnapshot[]): IssueSnapshot[] {
  return issues.filter((issue) => issue.section_code === code);
}

function hasBlockingIssue(code: string, issues: IssueSnapshot[]): boolean {
  return issuesForSection(code, issues).some((issue) =>
    BLOCKING_ISSUE_STATUSES.includes(issue.status as (typeof BLOCKING_ISSUE_STATUSES)[number])
  );
}

function firstBlockingIssueStatus(code: string, issues: IssueSnapshot[]): string | null {
  return (
    issuesForSection(code, issues).find((issue) =>
      BLOCKING_ISSUE_STATUSES.includes(issue.status as (typeof BLOCKING_ISSUE_STATUSES)[number])
    )?.status ?? null
  );
}

function hasProceedApprovedIssue(code: string, issues: IssueSnapshot[]): boolean {
  return issuesForSection(code, issues).some((issue) => issue.status === 'proceed_approved');
}

export function getSignoffPredecessors(_section: SignoffSectionCode, _setup: SignoffQaSetupV1): SignoffSectionCode[] {
  return [];
}

type ClearResult = { cleared: true } | { cleared: false; reasons: string[] };

export function isSignoffSectionCleared(
  code: SignoffSectionCode,
  submission: SubmissionSnapshot | undefined,
  photoCounts: PhotoCounts,
  issues: IssueSnapshot[]
): ClearResult {
  const def = getSignoffSectionDefinition(code);
  if (!def) return { cleared: true };

  const reasons: string[] = [];
  const validResults = ['pass', 'fail', 'not_required'];
  const answers = submission?.answers ?? {};

  if (!submission || submission.submission_status === 'draft') {
    return { cleared: false, reasons: ['No crew submission'] };
  }
  if (submission.submission_status === 'returned') {
    return { cleared: false, reasons: ['Supervisor returned this section for more evidence'] };
  }
  if (submission.submission_status !== 'submitted') {
    return { cleared: false, reasons: ['Submission not in submitted state'] };
  }

  for (const item of def.items) {
    const result = (answers[item.key]?.result ?? '') as string;
    if (!validResults.includes(result)) {
      reasons.push(`${item.label}: answer required (pass, fail, or not_required)`);
      continue;
    }
    if (result === 'not_required' && !item.allowNa) {
      reasons.push(`${item.label}: N/A is not allowed for this item`);
      continue;
    }

    if (result === 'fail') {
      if (!(answers[item.key]?.note ?? '').trim()) {
        reasons.push(`${item.label}: note required when failed`);
      }
      if (item.criticalOnFail || item.requireSupervisorOnFail) {
        const matchingIssues = issuesForSection(code, issues).filter((issue) => issue.item_key === item.key);
        const terminal =
          matchingIssues.length > 0 &&
          matchingIssues.every((issue) =>
            TERMINAL_ISSUE_STATUSES.includes(issue.status as (typeof TERMINAL_ISSUE_STATUSES)[number])
          );
        if (!terminal) {
          reasons.push(`${item.label}: supervisor issue must be resolved or approved to proceed`);
        }
      }
    } else {
      const nrw = item.noteRequiredWhen ?? [];
      if (
        nrw.includes(result as 'pass' | 'fail' | 'not_required') &&
        !(answers[item.key]?.note ?? '').trim()
      ) {
        reasons.push(`${item.label}: note required for this answer`);
      }
    }

    if ((item.requirePhoto || item.requireMarkedImage) && result !== 'not_required') {
      const count = photoCounts.get(photoKey(code, item.key)) ?? 0;
      if (count < 1) {
        reasons.push(
          item.requireMarkedImage
            ? `${item.label}: required marked-up image missing`
            : `${item.label}: required photo missing`
        );
      }
    }
  }

  if (hasBlockingIssue(code, issues)) {
    reasons.push('Open or unresolved issues remain in this section');
  }

  return reasons.length > 0 ? { cleared: false, reasons } : { cleared: true };
}

export function computeSignoffSectionUiStates(
  setup: SignoffQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): SignoffSectionUiState[] {
  const bySection = buildSubmissionMap(submissions);
  const photoCounts = buildPhotoCounts(photoRows);
  const applicable = getApplicableSignoffSectionCodes(setup);

  return applicable.map((code) => {
    const def = getSignoffSectionDefinition(code);
    const sub = bySection.get(code);
    const clearResult = isSignoffSectionCleared(code, sub, photoCounts, issues);
    const predecessors = getSignoffPredecessors(code, setup);
    const blockedBy: { section: SignoffSectionCode; reason: string }[] = [];

    for (const pred of predecessors) {
      const predClear = isSignoffSectionCleared(pred, bySection.get(pred), photoCounts, issues);
      if (!predClear.cleared) {
        blockedBy.push({
          section: pred,
          reason: `${getSignoffSectionDefinition(pred)?.title ?? pred} must be cleared first`,
        });
      }
    }

    let status: SignoffSectionStatus = 'pending';
    if (blockedBy.length > 0) {
      status = 'blocked_by_unresolved_issue';
    } else if (hasBlockingIssue(code, issues)) {
      const issueStatus = firstBlockingIssueStatus(code, issues);
      if (issueStatus === 'rectification_required') status = 'rectification_required';
      else if (issueStatus === 'evidence_requested') status = 'rectified_awaiting_supervisor';
      else status = 'issue_raised';
    } else if (hasProceedApprovedIssue(code, issues)) {
      status = 'supervisor_approved_to_proceed';
    } else if (sub?.submission_status === 'submitted') {
      status = clearResult.cleared ? 'cleared' : 'submitted';
    }

    return {
      code,
      title: def?.title ?? code,
      description: def?.description ?? '',
      applicable: true,
      status,
      cleared: clearResult.cleared,
      clearReasons: clearResult.cleared ? [] : clearResult.reasons,
      predecessors,
      blockedBy: blockedBy.length > 0 ? blockedBy : null,
      hasBlockingIssue: hasBlockingIssue(code, issues),
      submissionStatus: sub?.submission_status ?? null,
      submittedAt:
        sub?.submission_status === 'submitted' && sub.submitted_at ? String(sub.submitted_at) : null,
    };
  });
}

export function signoffRunHasIncompleteEvidence(
  setup: SignoffQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): boolean {
  return computeSignoffSectionUiStates(setup, submissions, photoRows, issues).some((section) => !section.cleared);
}

export function getSignoffFinalApprovalBlockers(
  setup: SignoffQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): { code: SignoffSectionCode; title: string; status: SignoffSectionStatus; reasons: string[] }[] {
  return computeSignoffSectionUiStates(setup, submissions, photoRows, issues)
    .filter((section) => !section.cleared)
    .map((section) => ({
      code: section.code,
      title: section.title,
      status: section.status,
      reasons: section.clearReasons,
    }));
}
