import {
  getApplicableIrrigationSectionCodes,
  getIrrigationSectionDefinition,
  type IrrigationSectionCode,
} from './irrigation-qa-v1-catalog';
import type { IrrigationQaSetupV1 } from './irrigation-qa-v1-types';
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

export type IrrigationSectionStatus =
  | 'pending'
  | 'submitted'
  | 'cleared'
  | 'issue_raised'
  | 'rectification_required'
  | 'rectified_awaiting_supervisor'
  | 'supervisor_approved_to_proceed'
  | 'blocked_by_unresolved_issue';

export type IrrigationSectionUiState = {
  code: IrrigationSectionCode;
  title: string;
  description: string;
  applicable: boolean;
  status: IrrigationSectionStatus;
  cleared: boolean;
  clearReasons: string[];
  predecessors: IrrigationSectionCode[];
  blockedBy: { section: IrrigationSectionCode; reason: string }[] | null;
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

export function getIrrigationPredecessors(
  section: IrrigationSectionCode,
  setup: IrrigationQaSetupV1
): IrrigationSectionCode[] {
  const applicable = new Set(getApplicableIrrigationSectionCodes(setup));
  const keep = (...sections: IrrigationSectionCode[]) => sections.filter((s) => applicable.has(s));

  switch (section) {
    case 'setup_scope_protection':
      return [];
    case 'water_source_backflow_pressure_flow':
      return ['setup_scope_protection'];
    case 'layout_hydrozones_materials':
      return ['water_source_backflow_pressure_flow'];
    case 'sleeving_before_hardscape_cover':
    case 'trenching_pipework_before_backfill':
      return ['layout_hydrozones_materials'];
    case 'valve_box_solenoids_manifold':
      return keep('trenching_pipework_before_backfill');
    case 'dripline_installation':
    case 'spray_rotor_installation':
      return keep('layout_hydrozones_materials', 'trenching_pipework_before_backfill');
    case 'controller_wiring_sensors':
      return keep('layout_hydrozones_materials', 'valve_box_solenoids_manifold');
    case 'flush_leak_pressure_test':
      return keep(
        'valve_box_solenoids_manifold',
        'dripline_installation',
        'spray_rotor_installation',
        'controller_wiring_sensors'
      );
    case 'reinstatement':
      return ['flush_leak_pressure_test'];
    case 'as_built_client_handover':
      return keep('reinstatement', 'controller_wiring_sensors');
    case 'supervisor_final_approval':
      return keep(
        'setup_scope_protection',
        'water_source_backflow_pressure_flow',
        'layout_hydrozones_materials',
        'sleeving_before_hardscape_cover',
        'trenching_pipework_before_backfill',
        'valve_box_solenoids_manifold',
        'dripline_installation',
        'spray_rotor_installation',
        'controller_wiring_sensors',
        'flush_leak_pressure_test',
        'reinstatement',
        'as_built_client_handover'
      );
    default:
      return [];
  }
}

type ClearResult = { cleared: true } | { cleared: false; reasons: string[] };

export function isIrrigationSectionCleared(
  code: IrrigationSectionCode,
  submission: SubmissionSnapshot | undefined,
  photoCounts: PhotoCounts,
  issues: IssueSnapshot[]
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

  const def = getIrrigationSectionDefinition(code);
  if (!def) return { cleared: false, reasons: ['Section definition not found'] };

  const answers = submission.answers ?? {};
  const validResults = ['pass', 'fail', 'not_required'];

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

export function computeIrrigationSectionUiStates(
  setup: IrrigationQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): IrrigationSectionUiState[] {
  const codes = getApplicableIrrigationSectionCodes(setup);
  const bySection = buildSubmissionMap(submissions);
  const photoCounts = buildPhotoCounts(photoRows);

  const localCleared = new Map<IrrigationSectionCode, boolean>();
  for (const code of codes) {
    localCleared.set(
      code,
      isIrrigationSectionCleared(code, bySection.get(code), photoCounts, issues).cleared
    );
  }

  return codes.map((code) => {
    const def = getIrrigationSectionDefinition(code)!;
    const sub = bySection.get(code);
    const clearResult = isIrrigationSectionCleared(code, sub, photoCounts, issues);
    const predecessors = getIrrigationPredecessors(code, setup);
    const blockedBy: { section: IrrigationSectionCode; reason: string }[] = [];

    for (const pred of predecessors) {
      if (!(localCleared.get(pred) ?? false)) {
        blockedBy.push({ section: pred, reason: `Blocked until predecessor is cleared: ${pred}` });
      }
      if (hasBlockingIssue(pred, issues)) {
        blockedBy.push({ section: pred, reason: `Blocked by unresolved issue: ${pred}` });
      }
    }

    const blockingStatus = firstBlockingIssueStatus(code, issues);
    let status: IrrigationSectionStatus;
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

export function irrigationRunHasIncompleteEvidence(
  setup: IrrigationQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): boolean {
  return computeIrrigationSectionUiStates(setup, submissions, photoRows, issues).some((section) => !section.cleared);
}

export function getIrrigationFinalApprovalBlockers(
  setup: IrrigationQaSetupV1,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): { code: IrrigationSectionCode; title: string; status: IrrigationSectionStatus; reasons: string[] }[] {
  return computeIrrigationSectionUiStates(setup, submissions, photoRows, issues)
    .filter((section) => section.code !== 'supervisor_final_approval' && !section.cleared)
    .map((section) => ({
      code: section.code,
      title: section.title,
      status: section.status,
      reasons: section.clearReasons,
    }));
}
