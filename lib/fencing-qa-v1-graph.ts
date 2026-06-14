import {
  getApplicableFencingSectionCodes,
  getFencingSectionDefinition,
  getFencingSectionItemsForSetup,
  type FencingSectionCode,
} from './fencing-qa-v1-catalog';
import type { FencingQaSetupV1 } from './fencing-qa-v1-types';
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

export type FencingSectionStatus =
  | 'pending'
  | 'submitted'
  | 'cleared'
  | 'issue_raised'
  | 'rectification_required'
  | 'rectified_awaiting_supervisor'
  | 'supervisor_approved_to_proceed'
  | 'blocked_by_unresolved_issue';

export type FencingSectionUiState = {
  code: FencingSectionCode;
  title: string;
  description: string;
  applicable: boolean;
  status: FencingSectionStatus;
  cleared: boolean;
  clearReasons: string[];
  predecessors: FencingSectionCode[];
  blockedBy: { section: FencingSectionCode; reason: string }[] | null;
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

export function getFencingPredecessors(section: FencingSectionCode, setup: FencingQaSetupV1): FencingSectionCode[] {
  const applicable = new Set(getApplicableFencingSectionCodes(setup));
  const keep = (...sections: FencingSectionCode[]) => sections.filter((s) => applicable.has(s));

  switch (section) {
    case 'setup_protection':
      return [];
    case 'setout_boundary_height':
      return ['setup_protection'];
    case 'existing_fence_removal':
      return ['setup_protection'];
    case 'post_holes_before_concrete':
      return keep('setout_boundary_height', 'existing_fence_removal');
    case 'posts_installed_concreted':
      return ['post_holes_before_concrete'];
    case 'rails_frame_plinth':
      return ['posts_installed_concreted'];
    case 'paling_installation':
      return ['rails_frame_plinth'];
    case 'picket_layout_first_section':
      return ['rails_frame_plinth'];
    case 'picket_installation':
      return ['picket_layout_first_section'];
    case 'gate_installation':
      return keep('posts_installed_concreted', 'rails_frame_plinth');
    case 'capping_finish':
      return keep('paling_installation', 'picket_installation', 'gate_installation');
    case 'final_completion':
      return keep(
        'setup_protection',
        'setout_boundary_height',
        'existing_fence_removal',
        'post_holes_before_concrete',
        'posts_installed_concreted',
        'rails_frame_plinth',
        'paling_installation',
        'picket_layout_first_section',
        'picket_installation',
        'gate_installation',
        'capping_finish'
      );
    default:
      return [];
  }
}

type ClearResult = { cleared: true } | { cleared: false; reasons: string[] };

export function isFencingSectionCleared(
  code: FencingSectionCode,
  submission: SubmissionSnapshot | undefined,
  photoCounts: PhotoCounts,
  issues: IssueSnapshot[],
  setup: FencingQaSetupV1
): ClearResult {
  const reasons: string[] = [];

  if (!submission || submission.submission_status === 'draft') {
    return { cleared: false, reasons: ['No crew submission'] };
  }
  if (submission.submission_status === 'returned') {
    return { cleared: false, reasons: ['Supervisor returned this section for more evidence'] };
  }
  if (submission.submission_status !== 'submitted') {
    return { cleared: false, reasons: ['Submission not in submitted state'] };
  }

  const def = getFencingSectionDefinition(code);
  if (!def) return { cleared: false, reasons: ['Section definition not found'] };

  const answers = submission.answers ?? {};
  const validResults = ['pass', 'fail', 'not_required'];
  const items = getFencingSectionItemsForSetup(code, setup);

  for (const item of items) {
    if (item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto || item.requireMarkedImage) {
        const count = photoCounts.get(photoKey(code, item.key)) ?? 0;
        if (count < 1) {
          reasons.push(
            item.requireMarkedImage
              ? `${item.label}: required marked-up image missing`
              : `${item.label}: required photo missing`
          );
        }
      }
      continue;
    }

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
        const terminal = matchingIssues.length > 0 && matchingIssues.every((issue) =>
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

export function computeFencingSectionUiStates(
  setup: FencingQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): FencingSectionUiState[] {
  const codes = getApplicableFencingSectionCodes(setup);
  const bySection = buildSubmissionMap(submissions);
  const photoCounts = buildPhotoCounts(photoRows);

  const localCleared = new Map<FencingSectionCode, boolean>();
  for (const code of codes) {
    localCleared.set(code, isFencingSectionCleared(code, bySection.get(code), photoCounts, issues, setup).cleared);
  }

  return codes.map((code) => {
    const def = getFencingSectionDefinition(code)!;
    const sub = bySection.get(code);
    const clearResult = isFencingSectionCleared(code, sub, photoCounts, issues, setup);
    const predecessors = getFencingPredecessors(code, setup);
    const blockedBy: { section: FencingSectionCode; reason: string }[] = [];

    for (const pred of predecessors) {
      if (!(localCleared.get(pred) ?? false)) {
        blockedBy.push({ section: pred, reason: `Blocked until predecessor is cleared: ${pred}` });
      }
      if (hasBlockingIssue(pred, issues)) {
        blockedBy.push({ section: pred, reason: `Blocked by unresolved issue: ${pred}` });
      }
    }

    const blockingStatus = firstBlockingIssueStatus(code, issues);
    let status: FencingSectionStatus;
    if (blockedBy.length > 0) {
      status = 'blocked_by_unresolved_issue';
    } else if (blockingStatus === 'rectification_required') {
      status = 'rectification_required';
    } else if (blockingStatus === 'evidence_requested') {
      status = 'rectified_awaiting_supervisor';
    } else if (blockingStatus === 'open') {
      status = 'issue_raised';
    } else if (hasProceedApprovedIssue(code, issues) && clearResult.cleared) {
      status = 'supervisor_approved_to_proceed';
    } else if (clearResult.cleared) {
      status = 'cleared';
    } else if (sub?.submission_status === 'submitted') {
      status = 'submitted';
    } else {
      status = 'pending';
    }

    return {
      code,
      title: def.title,
      description: def.description,
      applicable: true,
      status,
      cleared: clearResult.cleared,
      clearReasons: clearResult.cleared ? [] : clearResult.reasons,
      predecessors,
      blockedBy: blockedBy.length > 0 ? blockedBy : null,
      hasBlockingIssue: hasBlockingIssue(code, issues),
      submissionStatus: sub?.submission_status ?? null,
      submittedAt:
        sub?.submission_status === 'submitted' && sub.submitted_at
          ? String(sub.submitted_at)
          : null,
    };
  });
}

export function fencingRunHasIncompleteEvidence(
  setup: FencingQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): boolean {
  return computeFencingSectionUiStates(setup, submissions, photoRows, issues).some((section) => !section.cleared);
}

export function getFencingFinalApprovalBlockers(
  setup: FencingQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): { code: FencingSectionCode; title: string; status: FencingSectionStatus; reasons: string[] }[] {
  return computeFencingSectionUiStates(setup, submissions, photoRows, issues)
    .filter((section) => !section.cleared)
    .map((section) => ({
      code: section.code,
      title: section.title,
      status: section.status,
      reasons: section.clearReasons,
    }));
}
