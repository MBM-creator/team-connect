import { describe, expect, it } from 'vitest';
import {
  MAX_PRE_COMMENCEMENT_PHOTOS,
  OVERVIEW_QA_TEMPLATE_HELP,
  OVERVIEW_WRAP_SAFE_CLASSES,
  canMoveStage,
  filterChecklistTemplates,
  overviewStageChipClass,
  photoUploadCountLabel,
  reorderStagesById,
  resolveOverviewStageState,
  selectedChecklistIdAfterNameEdit,
  selectFilesForPhotoUpload,
  shouldShowSupervisorSignOff,
  stageHasExplicitFinishedQa,
  stageMoveAriaLabel,
  validateNewStageName,
} from '@/lib/job-overview-display';

function file(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
}

describe('pre-commencement photos', () => {
  it('keeps the 10-photo limit', () => {
    expect(MAX_PRE_COMMENCEMENT_PHOTOS).toBe(10);
    expect(photoUploadCountLabel(0)).toBe('0 of 10 uploaded');
    expect(photoUploadCountLabel(3)).toBe('3 of 10 uploaded');
  });

  it('selects files up to remaining slots and rejects when full', () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    expect(selectFilesForPhotoUpload(8, files)).toEqual({
      toUpload: [files[0], files[1]],
      error: null,
    });
    expect(selectFilesForPhotoUpload(10, files)).toEqual({
      toUpload: [],
      error: 'Maximum 10 photos allowed',
    });
  });

  it('skips empty files when selecting uploads', () => {
    const empty = file('empty.jpg', 0);
    const ok = file('ok.jpg');
    expect(selectFilesForPhotoUpload(0, [empty, ok])).toEqual({
      toUpload: [ok],
      error: null,
    });
  });
});

describe('stage name validation', () => {
  it('requires a non-empty trimmed name', () => {
    expect(validateNewStageName('')).toBe('Stage name is required');
    expect(validateNewStageName('   ')).toBe('Stage name is required');
    expect(validateNewStageName('Turf')).toBeNull();
  });

  it('filters checklist suggestions without requiring an exact match', () => {
    const templates = [
      { id: 'paving', name: 'Paving' },
      { id: 'fence', name: 'Paling Fence' },
      { id: 'irrigation', name: 'Irrigation' },
    ];

    expect(filterChecklistTemplates(templates, 'FENCE')).toEqual([templates[1]]);
    expect(filterChecklistTemplates(templates, '  ')).toEqual(templates);
    expect(filterChecklistTemplates(templates, 'brick')).toEqual([]);
  });

  it('clears an assigned checklist when its selected name is edited', () => {
    const templates = [{ id: 'fence', name: 'Paling Fence' }];

    expect(selectedChecklistIdAfterNameEdit('Paling Fence', 'fence', templates)).toBe('fence');
    expect(selectedChecklistIdAfterNameEdit('Brick Fence', 'fence', templates)).toBeNull();
    expect(selectedChecklistIdAfterNameEdit('Paling Fence', null, templates)).toBeNull();
  });
});

describe('stage ordering', () => {
  const stages = [
    { id: 'a', sort_order: 0, name: 'Turf' },
    { id: 'b', sort_order: 1, name: 'Fence' },
    { id: 'c', sort_order: 2, name: 'Plant' },
  ];

  it('disables unavailable directions for first and last', () => {
    expect(canMoveStage(0, 3, 'up')).toBe(false);
    expect(canMoveStage(0, 3, 'down')).toBe(true);
    expect(canMoveStage(2, 3, 'down')).toBe(false);
    expect(canMoveStage(2, 3, 'up')).toBe(true);
  });

  it('reorders with persisted sort_order indexes', () => {
    const next = reorderStagesById(stages, 'b', 'up');
    expect(next?.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((s) => s.sort_order)).toEqual([0, 1, 2]);
  });

  it('preserves relative order for the rest of the list when moving down', () => {
    const next = reorderStagesById(stages, 'a', 'down');
    expect(next?.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns null for invalid moves', () => {
    expect(reorderStagesById(stages, 'a', 'up')).toBeNull();
    expect(reorderStagesById(stages, 'missing', 'down')).toBeNull();
  });

  it('provides accessible move labels', () => {
    expect(stageMoveAriaLabel('Turf', 'up')).toBe('Move Turf stage up');
    expect(stageMoveAriaLabel('Turf', 'down')).toBe('Move Turf stage down');
  });
});

describe('overview stage state', () => {
  it('identifies the active stage clearly and hides set-as-active', () => {
    const state = resolveOverviewStageState({
      isActive: true,
      hasExplicitFinishedQa: false,
    });
    expect(state.label).toBe('Active');
    expect(state.chipTone).toBe('active');
    expect(state.showSetActive).toBe(false);
    expect(state.cardAccent).toBe(true);
    expect(state.isErrorStyled).toBe(false);
  });

  it('does not present inactive stages as errors', () => {
    const state = resolveOverviewStageState({
      isActive: false,
      hasExplicitFinishedQa: false,
    });
    expect(state.label).toBe('Inactive');
    expect(state.chipTone).toBe('neutral');
    expect(state.showSetActive).toBe(true);
    expect(state.isErrorStyled).toBe(false);
    expect(overviewStageChipClass(state.chipTone)).toContain('sc-status-neutral');
    expect(overviewStageChipClass(state.chipTone)).not.toContain('danger');
  });

  it('uses Complete only for explicit finished QA', () => {
    const state = resolveOverviewStageState({
      isActive: false,
      hasExplicitFinishedQa: true,
    });
    expect(state.label).toBe('Complete');
    expect(state.chipTone).toBe('complete');
    expect(state.showSetActive).toBe(true);
  });

  it('detects explicit finished QA without inventing completion from index', () => {
    expect(
      stageHasExplicitFinishedQa({
        stageId: 'stage-1',
        stageQaType: 'fencing',
        qaRuns: [{ id: 'r1', stage_id: 'stage-1', status: 'completed', qa_type: 'fencing' }],
        qaRunIncompleteById: {},
      })
    ).toBe(true);

    expect(
      stageHasExplicitFinishedQa({
        stageId: 'stage-1',
        stageQaType: 'fencing',
        qaRuns: [{ id: 'r1', stage_id: 'stage-1', status: 'active', qa_type: 'fencing' }],
        qaRunIncompleteById: { r1: false },
      })
    ).toBe(true);

    expect(
      stageHasExplicitFinishedQa({
        stageId: 'stage-1',
        stageQaType: 'fencing',
        qaRuns: [],
        qaRunIncompleteById: {},
      })
    ).toBe(false);
  });
});

describe('QA template and sign-off presentation', () => {
  it('keeps template help copy that does not rename the stage', () => {
    expect(OVERVIEW_QA_TEMPLATE_HELP).toMatch(/will not rename the stage/i);
  });

  it('preserves supervisor sign-off visibility rules', () => {
    expect(shouldShowSupervisorSignOff({ hasQaTemplate: false, hasMismatchWarning: false })).toBe(
      true
    );
    expect(shouldShowSupervisorSignOff({ hasQaTemplate: true, hasMismatchWarning: false })).toBe(
      false
    );
    expect(shouldShowSupervisorSignOff({ hasQaTemplate: false, hasMismatchWarning: true })).toBe(
      false
    );
  });
});

describe('wrap-safe values', () => {
  it('exposes wrap-safe layout classes for long optional values', () => {
    expect(OVERVIEW_WRAP_SAFE_CLASSES).toContain('min-w-0');
    expect(OVERVIEW_WRAP_SAFE_CLASSES).toContain('break-words');
    expect(OVERVIEW_WRAP_SAFE_CLASSES).toContain('max-w-full');
  });
});
