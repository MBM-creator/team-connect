import {
  getApplicableV2SectionCodes,
  getV2SectionDefinition,
  getV2SectionItemsForSetup,
  lastInstallSectionCode,
  type PavingSectionCodeV2,
} from './paving-qa-v2-catalog';
import type { PavingQaSetupV2 } from './paving-qa-v2-types';
import {
  buildPhotoCounts,
  buildSubmissionMap,
  BLOCKING_ISSUE_STATUSES,
  TERMINAL_ISSUE_STATUSES,
  type IssueSnapshot,
  type SubmissionSnapshot,
  type PhotoCounts,
} from './qa-evidence-graph';

// Re-export shared snapshot types so callers can import from one place
export type { IssueSnapshot, SubmissionSnapshot };

// ---------------------------------------------------------------------------
// Predecessor rules
// ---------------------------------------------------------------------------

export function getV2Predecessors(
  section: PavingSectionCodeV2,
  setup: PavingQaSetupV2
): PavingSectionCodeV2[] {
  const applicable = new Set(getApplicableV2SectionCodes(setup));

  function ifApplicable(s: PavingSectionCodeV2): PavingSectionCodeV2[] {
    return applicable.has(s) ? [s] : [];
  }

  function ifApplicableMany(...ss: PavingSectionCodeV2[]): PavingSectionCodeV2[] {
    return ss.filter((s) => applicable.has(s));
  }

  const method = setup.install_method;
  const material = setup.material_type;
  const areaUses = setup.area_uses;

  switch (section) {
    case 'setup_protection':
      return [];
    case 'excavation_preparation':
      return ['setup_protection'];

    case 'concrete_formwork':
      return ['excavation_preparation'];
    case 'concrete_reinforcement':
      return ['concrete_formwork'];
    case 'concrete_pre_pour':
      return ['concrete_reinforcement'];
    case 'concrete_pour_finish':
      return ['concrete_pre_pour'];

    case 'crushed_rock_base':
      return ['excavation_preparation'];

    case 'wet_bed_preparation':
      if (method === 'crushed_rock_wet_bed') return ['crushed_rock_base'];
      if (method === 'concrete_base_wet_bed') return ['concrete_pour_finish'];
      return [];

    case 'existing_concrete_assessment':
      return ['excavation_preparation'];

    case 'paving_preparation_and_laying': {
      const preds: PavingSectionCodeV2[] = [];
      if (method === 'glue_existing_concrete') {
        preds.push('existing_concrete_assessment');
      } else if (method === 'glue_new_concrete') {
        preds.push('concrete_pour_finish');
      } else {
        preds.push(...ifApplicable(lastInstallSectionCode(setup)));
      }
      if (material !== 'steppers' && areaUses.includes('driveway_vehicle_traffic')) {
        preds.push(...ifApplicable('driveway_preparation'));
      }
      return preds;
    }

    case 'driveway_preparation':
      return ifApplicable(lastInstallSectionCode(setup));

    case 'variable_thickness_stone_review':
      return ifApplicable('paving_preparation_and_laying');

    case 'stepper_installation': {
      if (material === 'variable_thickness_natural_stone' || material === 'mixed_materials') {
        return ifApplicable('variable_thickness_stone_review');
      }
      if (applicable.has('paving_preparation_and_laying')) return ['paving_preparation_and_laying'];
      return ifApplicable(lastInstallSectionCode(setup));
    }

    case 'before_jointing': {
      const candidates: PavingSectionCodeV2[] = [
        'stepper_installation',
        'variable_thickness_stone_review',
        'paving_preparation_and_laying',
      ];
      const last = candidates.find((c) => applicable.has(c));
      return last ? [last] : ifApplicable(lastInstallSectionCode(setup));
    }

    case 'final_completion': {
      const candidates: PavingSectionCodeV2[] = [
        'before_jointing',
        'stepper_installation',
        'variable_thickness_stone_review',
        'paving_preparation_and_laying',
        'driveway_preparation',
      ];
      const preds = ifApplicableMany(...candidates);
      if (preds.length > 0) return preds;
      return ifApplicable(lastInstallSectionCode(setup));
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Section clearing logic
// ---------------------------------------------------------------------------

function photoKey(section: string, itemKey: string): string {
  return `${section}:${itemKey}`;
}

function issuesForSection(code: string, issues: IssueSnapshot[]): IssueSnapshot[] {
  return issues.filter((i) => i.section_code === code);
}

function hasBlockingIssue(code: string, issues: IssueSnapshot[]): boolean {
  return issuesForSection(code, issues).some((i) =>
    BLOCKING_ISSUE_STATUSES.includes(i.status as (typeof BLOCKING_ISSUE_STATUSES)[number])
  );
}

type ClearResult = { cleared: true } | { cleared: false; reasons: string[] };

/**
 * Determine whether a v2 section is cleared from its own local evidence.
 * Does NOT look at predecessors — that is handled in the status computation.
 */
function isV2SectionCleared(
  code: PavingSectionCodeV2,
  setup: PavingQaSetupV2,
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

  const items = getV2SectionItemsForSetup(code, setup);
  if (items.length === 0) {
    return { cleared: false, reasons: ['Section definition not found'] };
  }

  const answers = submission.answers ?? {};

  // v2 valid results: not_required is always accepted (v2 equivalent of na)
  const V2_VALID: string[] = ['pass', 'fail', 'not_required'];

  for (const item of items) {
    if (item.photoOnly) {
      const result = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && result === 'not_required') {
        continue;
      }
      if (item.requirePhoto) {
        const count = photoCounts.get(photoKey(code, item.key)) ?? 0;
        if (count < 1) reasons.push(`${item.label}: required photo missing`);
      }
      continue;
    }

    const result = (answers[item.key]?.result ?? '') as string;

    if (!V2_VALID.includes(result)) {
      reasons.push(`${item.label}: answer required (pass, fail, or not_required)`);
      continue;
    }

    if (result === 'fail') {
      const note = (answers[item.key]?.note ?? '').trim();
      if (!note) reasons.push(`${item.label}: note required when failed`);

      // Check critical failures have a resolved supervisor issue
      if (item.criticalOnFail) {
        const critIssues = issuesForSection(code, issues).filter(
          (i) => i.item_key === item.key && i.severity === 'critical'
        );
        if (
          critIssues.length === 0 ||
          !critIssues.every((i) =>
            TERMINAL_ISSUE_STATUSES.includes(i.status as (typeof TERMINAL_ISSUE_STATUSES)[number])
          )
        ) {
          reasons.push(`${item.label}: critical failure must be resolved by supervisor`);
        }
      }

      if (item.requireSupervisorOnFail) {
        const ncIssues = issuesForSection(code, issues).filter(
          (i) => i.item_key === item.key && i.severity === 'non_critical'
        );
        if (
          ncIssues.length === 0 ||
          !ncIssues.every((i) =>
            TERMINAL_ISSUE_STATUSES.includes(i.status as (typeof TERMINAL_ISSUE_STATUSES)[number])
          )
        ) {
          reasons.push(`${item.label}: supervisor review required for this failure`);
        }
      }
    } else {
      // For pass / not_required: check noteRequiredWhen
      const nrw = item.noteRequiredWhen ?? [];
      if (
        nrw.includes(result as 'pass' | 'fail' | 'not_required') &&
        !(answers[item.key]?.note ?? '').trim()
      ) {
        reasons.push(`${item.label}: note required for this answer`);
      }
    }

    // Photo is only required when the item is answered pass or fail, not when not_required
    if (item.requirePhoto && result !== 'not_required') {
      const count = photoCounts.get(photoKey(code, item.key)) ?? 0;
      if (count < 1) reasons.push(`${item.label}: required photo missing`);
    }
  }

  if (hasBlockingIssue(code, issues)) {
    reasons.push('Open or unresolved issues remain in this section');
  }

  return reasons.length > 0 ? { cleared: false, reasons } : { cleared: true };
}

// ---------------------------------------------------------------------------
// V2 section UI state
// ---------------------------------------------------------------------------

export type V2SectionStatus =
  | 'pending'
  | 'submitted'
  | 'cleared'
  | 'issue_raised'
  | 'blocked';

export type V2SectionUiState = {
  code: PavingSectionCodeV2;
  title: string;
  description: string;
  applicable: boolean;
  status: V2SectionStatus;
  cleared: boolean;
  clearReasons: string[];
  predecessors: PavingSectionCodeV2[];
  /** Set when status === 'blocked' */
  blockedBy: { section: PavingSectionCodeV2; reason: string }[] | null;
  hasBlockingIssue: boolean;
  submissionStatus: string | null;
  submittedAt: string | null;
};

/**
 * Compute a V2SectionUiState for every applicable section of a v2 run.
 *
 * Requires the run's submissions, photo rows, and issues from the DB.
 * Returns one entry per applicable section in construction sequence order.
 */
export function computeV2SectionUiStates(
  setup: PavingQaSetupV2,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): V2SectionUiState[] {
  const codes = getApplicableV2SectionCodes(setup);
  const bySection = buildSubmissionMap(submissions);
  const photoCounts = buildPhotoCounts(photoRows);

  // --- Pass 1: compute local cleared state for every section ---
  const localClearedMap = new Map<PavingSectionCodeV2, boolean>();
  for (const code of codes) {
    const sub = bySection.get(code);
    const result = isV2SectionCleared(code, setup, sub, photoCounts, issues);
    localClearedMap.set(code, result.cleared);
  }

  // --- Pass 2: compute full UI state with predecessor blocking ---
  return codes.map((code) => {
    const def = getV2SectionDefinition(code)!;
    const preds = getV2Predecessors(code, setup);
    const sub = bySection.get(code);
    const clearResult = isV2SectionCleared(code, setup, sub, photoCounts, issues);
    const sectionHasBlockingIssue = hasBlockingIssue(code, issues);

    // Build blockedBy list from predecessors
    const blockedBy: { section: PavingSectionCodeV2; reason: string }[] = [];
    for (const pred of preds) {
      const predCleared = localClearedMap.get(pred) ?? false;
      if (!predCleared) {
        blockedBy.push({
          section: pred,
          reason: `Blocked until predecessor is cleared: ${pred}`,
        });
      }
      if (hasBlockingIssue(pred, issues)) {
        blockedBy.push({
          section: pred,
          reason: `Blocked by unresolved issue: ${pred}`,
        });
      }
    }

    // Deduplicate blockedBy entries per predecessor
    const seen = new Set<string>();
    const deduped = blockedBy.filter((b) => {
      const key = `${b.section}:${b.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Determine displayed status
    let status: V2SectionStatus;
    if (deduped.length > 0) {
      status = 'blocked';
    } else if (sectionHasBlockingIssue) {
      status = 'issue_raised';
    } else if (clearResult.cleared) {
      status = 'cleared';
    } else if (sub && sub.submission_status === 'submitted') {
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
      predecessors: preds,
      blockedBy: deduped.length > 0 ? deduped : null,
      hasBlockingIssue: sectionHasBlockingIssue,
      submissionStatus: sub?.submission_status ?? null,
      submittedAt:
        sub?.submission_status === 'submitted' && sub.submitted_at
          ? String(sub.submitted_at)
          : null,
    };
  });
}

/** Whether a v2 run has any applicable section that is not cleared. */
export function v2RunHasIncompleteEvidence(
  setup: PavingQaSetupV2,
  submissions: SubmissionSnapshot[],
  photoRows: { section_code: string; item_key: string }[],
  issues: IssueSnapshot[]
): boolean {
  const states = computeV2SectionUiStates(setup, submissions, photoRows, issues);
  return states.some((s) => !s.cleared);
}
