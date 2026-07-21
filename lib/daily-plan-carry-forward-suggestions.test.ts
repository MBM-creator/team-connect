import { describe, expect, it } from 'vitest';
import { nextCalendarDate } from '@/lib/report-date';
import {
  DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE,
  DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE,
} from '@/lib/daily-plan-shared';
import {
  appendNotesForTomorrow,
  availableOutcomeSlots,
  buildSuggestionItems,
  canAddCarryForwardSuggestion,
  emptyReasonMessage,
  filterUnusedSuggestions,
  nextMelbourneWorkDate,
  priorUseLabel,
  resolveSuggestionsEmptyReason,
  selectLatestCompletedSourcePlan,
  sourceTypeLabel,
  validateSourceCarryForwardLinks,
} from '@/lib/daily-plan-carry-forward-suggestions';

const CF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CF_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_MON = '11111111-1111-4111-8111-111111111111';
const PLAN_TUE = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_JOB = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG = '66666666-6666-4666-8666-666666666666';

describe('Phase 2F carry-forward suggestions — date helpers', () => {
  it('advances Melbourne calendar dates by one civil day', () => {
    expect(nextMelbourneWorkDate('2026-07-20')).toBe('2026-07-21');
    expect(nextCalendarDate('2026-07-31')).toBe('2026-08-01');
  });

  it('allows weekend next dates', () => {
    // Friday → Saturday
    expect(nextMelbourneWorkDate('2026-07-17')).toBe('2026-07-18');
    // Saturday → Sunday
    expect(nextMelbourneWorkDate('2026-07-18')).toBe('2026-07-19');
  });

  it('rejects invalid dates', () => {
    expect(nextMelbourneWorkDate('not-a-date')).toBeNull();
  });
});

describe('Phase 2F — source plan selection', () => {
  it('selects the latest completed plan before the target date', () => {
    const selected = selectLatestCompletedSourcePlan(
      [
        { workDate: '2026-07-14', status: 'completed' },
        { workDate: '2026-07-18', status: 'completed' },
        { workDate: '2026-07-17', status: 'completed' },
      ],
      '2026-07-21'
    );
    expect(selected?.workDate).toBe('2026-07-18');
  });

  it('does not require the immediately previous calendar date', () => {
    const selected = selectLatestCompletedSourcePlan(
      [{ workDate: '2026-07-17', status: 'completed' }],
      '2026-07-21'
    );
    expect(selected?.workDate).toBe('2026-07-17');
  });

  it('excludes future, active, and draft source plans', () => {
    expect(
      selectLatestCompletedSourcePlan(
        [
          { workDate: '2026-07-22', status: 'completed' },
          { workDate: '2026-07-20', status: 'active' },
          { workDate: '2026-07-19', status: 'draft' },
        ],
        '2026-07-21'
      )
    ).toBeNull();
  });
});

describe('Phase 2F — suggestion mapping', () => {
  it('maps original and replacement outcomes', () => {
    const items = buildSuggestionItems({
      sourcePlanId: PLAN_MON,
      sourceWorkDate: '2026-07-20',
      carryForwards: [
        {
          id: CF_ID,
          carry_forward: true,
          note: 'Finish base',
          outcome_id: 'o1',
          replacement_outcome_id: null,
        },
        {
          id: CF_ID_2,
          carry_forward: true,
          note: null,
          outcome_id: null,
          replacement_outcome_id: 'r1',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          carry_forward: false,
          note: null,
          outcome_id: 'o2',
          replacement_outcome_id: null,
        },
      ],
      outcomes: [
        { id: 'o1', description: 'Original paving base', execution_status: 'not_completed' },
        { id: 'o2', description: 'Skipped', execution_status: 'cancelled' },
      ],
      replacements: [
        { id: 'r1', description: 'Replacement drainage fix', execution_status: 'cancelled' },
      ],
      priorUses: [],
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.sourceType).toBe('original');
    expect(items[0]?.description).toBe('Original paving base');
    expect(items[0]?.carryForwardNote).toBe('Finish base');
    expect(items[1]?.sourceType).toBe('replacement');
    expect(sourceTypeLabel('replacement')).toBe('Replacement work');
  });

  it('attaches prior-use metadata', () => {
    const items = buildSuggestionItems({
      sourcePlanId: PLAN_MON,
      sourceWorkDate: '2026-07-20',
      carryForwards: [
        {
          id: CF_ID,
          carry_forward: true,
          note: null,
          outcome_id: 'o1',
          replacement_outcome_id: null,
        },
      ],
      outcomes: [{ id: 'o1', description: 'Work', execution_status: 'not_completed' }],
      replacements: [],
      priorUses: [
        {
          source_carry_forward_id: CF_ID,
          plan_id: PLAN_TUE,
          work_date: '2026-07-21',
        },
      ],
    });
    expect(items[0]?.alreadyUsedIn?.workDate).toBe('2026-07-21');
    expect(priorUseLabel(items[0]!.alreadyUsedIn)).toContain("Already used in");
  });
});

describe('Phase 2F — outcome slots', () => {
  it('reports available slots and blocks at three', () => {
    expect(availableOutcomeSlots(1)).toBe(2);
    expect(availableOutcomeSlots(3)).toBe(0);
    expect(
      canAddCarryForwardSuggestion({
        currentOutcomeCount: 3,
        includedCarryForwardIds: [],
        suggestionCarryForwardId: CF_ID,
      })
    ).toEqual({ ok: false, message: DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE });
  });

  it('blocks duplicate inclusion in the same draft', () => {
    expect(
      canAddCarryForwardSuggestion({
        currentOutcomeCount: 1,
        includedCarryForwardIds: [CF_ID],
        suggestionCarryForwardId: CF_ID,
      }).ok
    ).toBe(false);
  });

  it('allows add when a slot is free', () => {
    expect(
      canAddCarryForwardSuggestion({
        currentOutcomeCount: 2,
        includedCarryForwardIds: [],
        suggestionCarryForwardId: CF_ID,
      })
    ).toEqual({ ok: true });
  });
});

describe('Phase 2F — notes append', () => {
  it('appends without overwriting and avoids duplicates', () => {
    expect(appendNotesForTomorrow('', 'Confirm delivery')).toBe('Confirm delivery');
    expect(appendNotesForTomorrow('Existing', 'Confirm delivery')).toBe(
      'Existing\n\nConfirm delivery'
    );
    expect(appendNotesForTomorrow('Confirm delivery already', 'Confirm delivery')).toBe(
      'Confirm delivery already'
    );
  });
});

describe('Phase 2F — empty reasons', () => {
  it('resolves empty reason messages', () => {
    expect(resolveSuggestionsEmptyReason({
      sourcePlanId: null,
      yesCarryForwardCount: 0,
      unusedSuggestionCount: 0,
    })).toBe('no_completed_prior_plan');
    expect(emptyReasonMessage('no_carry_forward_work')).toContain('No carry-forward');
    expect(
      filterUnusedSuggestions(
        [
          {
            carryForwardId: CF_ID,
            description: 'A',
            sourceType: 'original',
            sourceWorkDate: '2026-07-20',
            sourcePlanId: PLAN_MON,
            executionStatus: 'not_completed',
            carryForwardNote: null,
            alreadyUsedIn: null,
          },
        ],
        [CF_ID]
      )
    ).toHaveLength(0);
  });
});

describe('Phase 2F — source linkage validation', () => {
  const validSource = {
    id: CF_ID,
    daily_plan_id: PLAN_MON,
    job_id: JOB_ID,
    organisation_id: ORG_ID,
    work_date: '2026-07-20',
    carry_forward: true,
    outcome_id: 'o1',
    replacement_outcome_id: null,
  };

  it('accepts a valid same-job earlier source', () => {
    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [validSource],
        priorUses: [],
      }).ok
    ).toBe(true);
  });

  it('allows manual outcomes with no source', () => {
    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: null }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [],
        priorUses: [],
      }).ok
    ).toBe(true);
  });

  it('rejects missing, cross-job, cross-org, later, and no-carry sources', () => {
    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [],
        priorUses: [],
      }).ok
    ).toBe(false);

    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [{ ...validSource, job_id: OTHER_JOB }],
        priorUses: [],
      }).ok
    ).toBe(false);

    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [{ ...validSource, organisation_id: OTHER_ORG }],
        priorUses: [],
      }).ok
    ).toBe(false);

    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [{ ...validSource, work_date: '2026-07-22' }],
        priorUses: [],
      }).ok
    ).toBe(false);

    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [{ ...validSource, carry_forward: false }],
        priorUses: [],
      }).ok
    ).toBe(false);
  });

  it('requires confirmation for prior use but allows reuse when confirmed', () => {
    const needsConfirm = validateSourceCarryForwardLinks({
      targetJobId: JOB_ID,
      targetOrganisationId: ORG_ID,
      targetWorkDate: '2026-07-22',
      outcomes: [{ sourceCarryForwardId: CF_ID }],
      confirmDuplicateCarryForwardIds: [],
      sourceRows: [validSource],
      priorUses: [
        {
          source_carry_forward_id: CF_ID,
          plan_id: PLAN_TUE,
          work_date: '2026-07-21',
        },
      ],
    });
    expect(needsConfirm.ok).toBe(false);
    if (!needsConfirm.ok) {
      expect(needsConfirm.code).toBe('DUPLICATE_CARRY_FORWARD');
      expect(needsConfirm.message).toBe(DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE);
    }

    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-22',
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [CF_ID],
        sourceRows: [validSource],
        priorUses: [
          {
            source_carry_forward_id: CF_ID,
            plan_id: PLAN_TUE,
            work_date: '2026-07-21',
          },
        ],
      }).ok
    ).toBe(true);
  });

  it('excludes the current draft plan from prior-use checks', () => {
    expect(
      validateSourceCarryForwardLinks({
        targetJobId: JOB_ID,
        targetOrganisationId: ORG_ID,
        targetWorkDate: '2026-07-21',
        excludePlanId: PLAN_TUE,
        outcomes: [{ sourceCarryForwardId: CF_ID }],
        confirmDuplicateCarryForwardIds: [],
        sourceRows: [validSource],
        priorUses: [
          {
            source_carry_forward_id: CF_ID,
            plan_id: PLAN_TUE,
            work_date: '2026-07-21',
          },
        ],
      }).ok
    ).toBe(true);
  });
});
