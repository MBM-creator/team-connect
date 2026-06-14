import { computeV2SectionUiStates } from '@/lib/paving-qa-v2-graph';
import { computeIrrigationSectionUiStates } from '@/lib/irrigation-qa-v1-graph';
import { computeFencingSectionUiStates } from '@/lib/fencing-qa-v1-graph';
import { computeSignoffSectionUiStates } from '@/lib/signoff-qa-v1-graph';
import { v2RunHasIncompleteEvidence } from '@/lib/paving-qa-v2-graph';
import { irrigationRunHasIncompleteEvidence } from '@/lib/irrigation-qa-v1-graph';
import { fencingRunHasIncompleteEvidence } from '@/lib/fencing-qa-v1-graph';
import { signoffRunHasIncompleteEvidence } from '@/lib/signoff-qa-v1-graph';
import type { QaRunBundle } from '@/lib/qa-run-bundle';

export type GenericSectionState = {
  code: string;
  title: string;
  status: string;
  cleared: boolean;
  submissionStatus: string | null;
  submittedAt: string | null;
  hasBlockingIssue: boolean;
  clearReasons: string[];
};

export function computeSectionStatesFromBundle(bundle: Extract<QaRunBundle, { ok: true }>): GenericSectionState[] {
  if (bundle.qaType === 'irrigation') {
    return computeIrrigationSectionUiStates(
      bundle.setup,
      bundle.submissions,
      bundle.photoRows,
      bundle.issues
    ).map((s) => ({
      code: s.code,
      title: s.title,
      status: s.status,
      cleared: s.cleared,
      submissionStatus: s.submissionStatus,
      submittedAt: s.submittedAt,
      hasBlockingIssue: s.hasBlockingIssue,
      clearReasons: s.clearReasons,
    }));
  }

  if (bundle.qaType === 'fencing') {
    return computeFencingSectionUiStates(
      bundle.setup,
      bundle.submissions,
      bundle.photoRows,
      bundle.issues
    ).map((s) => ({
      code: s.code,
      title: s.title,
      status: s.status,
      cleared: s.cleared,
      submissionStatus: s.submissionStatus,
      submittedAt: s.submittedAt,
      hasBlockingIssue: s.hasBlockingIssue,
      clearReasons: s.clearReasons,
    }));
  }

  if (bundle.qaType === 'sign_off') {
    return computeSignoffSectionUiStates(
      bundle.setup,
      bundle.submissions,
      bundle.photoRows,
      bundle.issues
    ).map((s) => ({
      code: s.code,
      title: s.title,
      status: s.status,
      cleared: s.cleared,
      submissionStatus: s.submissionStatus,
      submittedAt: s.submittedAt,
      hasBlockingIssue: s.hasBlockingIssue,
      clearReasons: s.clearReasons,
    }));
  }

  if (bundle.version === 2) {
    return computeV2SectionUiStates(
      bundle.setup,
      bundle.submissions,
      bundle.photoRows,
      bundle.issues
    ).map((s) => ({
      code: s.code,
      title: s.title,
      status: s.status,
      cleared: s.cleared,
      submissionStatus: s.submissionStatus,
      submittedAt: s.submittedAt,
      hasBlockingIssue: s.hasBlockingIssue,
      clearReasons: s.clearReasons,
    }));
  }

  return [];
}

export function bundleHasIncompleteEvidence(bundle: Extract<QaRunBundle, { ok: true }>): boolean {
  if (bundle.qaType === 'irrigation') {
    return irrigationRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues);
  }
  if (bundle.qaType === 'fencing') {
    return fencingRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues);
  }
  if (bundle.qaType === 'sign_off') {
    return signoffRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues);
  }
  if (bundle.qaType === 'paving' && bundle.version === 2) {
    return v2RunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues);
  }
  return false;
}

export function countMissingEvidenceSections(states: GenericSectionState[]): number {
  return states.filter((s) => !s.cleared && s.clearReasons.length > 0).length;
}
