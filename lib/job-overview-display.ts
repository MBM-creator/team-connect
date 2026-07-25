/**
 * Pure display / UI helpers for the job workspace Overview tab.
 * Does not change stage, photo, or QA persistence behaviour — only mirrors
 * existing client-side decisions so they can be unit-tested and restyled.
 */

export const MAX_PRE_COMMENCEMENT_PHOTOS = 10;

export const OVERVIEW_QA_TEMPLATE_HELP =
  'Select the checklist used for this stage. This will not rename the stage.';

export type OverviewStageChipTone = 'active' | 'complete' | 'neutral';

export type OverviewStageState = {
  label: 'Active' | 'Complete' | 'Inactive';
  chipTone: OverviewStageChipTone;
  showSetActive: boolean;
  cardAccent: boolean;
  /** Never 'danger' — inactive is not an error. */
  isErrorStyled: false;
};

export type StageSortable = {
  id: string;
  sort_order: number;
};

export type OverviewQaRun = {
  id: string;
  stage_id?: string | null;
  status: string;
  qa_type?: string | null;
};

export function validateNewStageName(name: string): string | null {
  if (!name.trim()) return 'Stage name is required';
  return null;
}

export function selectFilesForPhotoUpload(
  existingCount: number,
  files: readonly File[],
  maxPhotos: number = MAX_PRE_COMMENCEMENT_PHOTOS
): { toUpload: File[]; error: string | null } {
  if (existingCount >= maxPhotos) {
    return { toUpload: [], error: `Maximum ${maxPhotos} photos allowed` };
  }
  const remaining = maxPhotos - existingCount;
  const candidates = files.filter((file) => file instanceof File && file.size > 0);
  const toUpload = candidates.slice(0, remaining);
  if (toUpload.length === 0) {
    return { toUpload: [], error: `Maximum ${maxPhotos} photos allowed` };
  }
  return { toUpload, error: null };
}

export function canMoveStage(
  index: number,
  length: number,
  direction: 'up' | 'down'
): boolean {
  if (index < 0 || index >= length || length <= 1) return false;
  if (direction === 'up') return index > 0;
  return index < length - 1;
}

export function reorderStagesById<T extends StageSortable>(
  stages: readonly T[],
  stageId: string,
  direction: 'up' | 'down'
): T[] | null {
  const fromIndex = stages.findIndex((stage) => stage.id === stageId);
  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (fromIndex < 0 || toIndex < 0 || toIndex >= stages.length) return null;

  const nextStages = [...stages];
  const movingStage = nextStages[fromIndex];
  const swappedStage = nextStages[toIndex];
  nextStages[fromIndex] = swappedStage;
  nextStages[toIndex] = movingStage;
  return nextStages.map((stage, index) => ({ ...stage, sort_order: index }));
}

export function stageMoveAriaLabel(stageName: string, direction: 'up' | 'down'): string {
  return direction === 'up' ? `Move ${stageName} stage up` : `Move ${stageName} stage down`;
}

function runQaType(
  qaType: string | null | undefined
): 'paving' | 'irrigation' | 'fencing' | 'sign_off' {
  if (qaType === 'irrigation') return 'irrigation';
  if (qaType === 'fencing') return 'fencing';
  if (qaType === 'sign_off') return 'sign_off';
  return 'paving';
}

/** Explicit finished QA only — does not treat “before active index” as complete. */
export function stageHasExplicitFinishedQa(input: {
  stageId: string;
  stageQaType?: 'paving' | 'irrigation' | 'fencing' | 'sign_off' | null;
  qaRuns: OverviewQaRun[];
  qaRunIncompleteById: Record<string, boolean>;
}): boolean {
  const linkedRuns = input.qaRuns.filter((run) => {
    if (run.stage_id === input.stageId) return true;
    if (run.stage_id != null || !input.stageQaType) return false;
    return runQaType(run.qa_type) === input.stageQaType;
  });

  return linkedRuns.some(
    (run) =>
      run.status === 'completed' ||
      (run.status === 'active' && input.qaRunIncompleteById[run.id] === false)
  );
}

export function resolveOverviewStageState(input: {
  isActive: boolean;
  hasExplicitFinishedQa: boolean;
}): OverviewStageState {
  if (input.isActive) {
    return {
      label: 'Active',
      chipTone: 'active',
      showSetActive: false,
      cardAccent: true,
      isErrorStyled: false,
    };
  }
  if (input.hasExplicitFinishedQa) {
    return {
      label: 'Complete',
      chipTone: 'complete',
      showSetActive: true,
      cardAccent: false,
      isErrorStyled: false,
    };
  }
  return {
    label: 'Inactive',
    chipTone: 'neutral',
    showSetActive: true,
    cardAccent: false,
    isErrorStyled: false,
  };
}

export function overviewStageChipClass(tone: OverviewStageChipTone): string {
  if (tone === 'active') {
    return 'border-sc-status-active-border bg-sc-status-active-bg text-sc-status-active';
  }
  if (tone === 'complete') {
    return 'border-sc-status-complete-border bg-sc-status-complete-bg text-sc-status-complete';
  }
  return 'border-sc-status-neutral-border bg-sc-status-neutral-bg text-sc-status-neutral';
}

/**
 * Matches Overview visibility for Supervisor sign-off:
 * shown when the stage has no paving/irrigation/fencing template and no mismatch.
 */
export function shouldShowSupervisorSignOff(input: {
  hasQaTemplate: boolean;
  hasMismatchWarning: boolean;
}): boolean {
  return !input.hasQaTemplate && !input.hasMismatchWarning;
}

export function photoUploadCountLabel(
  count: number,
  max: number = MAX_PRE_COMMENCEMENT_PHOTOS
): string {
  return `${count} of ${max} uploaded`;
}

/** Layout helpers used by Overview markup — kept for regression of wrap-safe classes. */
export const OVERVIEW_WRAP_SAFE_CLASSES = [
  'min-w-0',
  'break-words',
  'max-w-full',
] as const;
