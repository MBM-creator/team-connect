import { describe, expect, it } from 'vitest';
import {
  canUpdateDailyPlanExecution,
  DAILY_PLAN_CANCEL_REQUIRES_CHANGE_MESSAGE,
  DAILY_PLAN_STATUS_CONFLICT_MESSAGE,
  isAllowedOrdinaryStatusTransition,
  normalizeOutcomeExecutionStatus,
  parseOutcomeStatusUpdate,
  parsePlanChangeBody,
} from '@/lib/daily-plan-execution';
import {
  canEditDailyPlanBaseline,
  mapDailyPlanApi,
  type DailyPlanDbRow,
} from '@/lib/daily-plan-shared';

const SUPERVISOR_ID = '11111111-1111-4111-8111-111111111111';
const OUTCOME_ID = '22222222-2222-4222-8222-222222222222';

function activePlanRow(overrides: Partial<DailyPlanDbRow> = {}): DailyPlanDbRow {
  return {
    id: 'plan-1',
    job_id: 'job-1',
    work_date: '2026-07-20',
    work_timezone: 'Australia/Melbourne',
    status: 'active',
    supervisor_staff_profile_id: SUPERVISOR_ID,
    created_by_staff_profile_id: SUPERVISOR_ID,
    started_by_staff_profile_id: SUPERVISOR_ID,
    started_at: '2026-07-20T00:10:00.000Z',
    risks_constraints: 'Rain',
    contingency_plan: 'Front garden',
    general_notes: 'Access note',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:10:00.000Z',
    supervisor: { full_name: 'Sam Supervisor' },
    created_by: { full_name: 'Sam Supervisor' },
    started_by: { full_name: 'Sam Supervisor' },
    ...overrides,
  };
}

describe('outcome execution status defaults and transitions', () => {
  it('defaults unknown statuses to planned', () => {
    expect(normalizeOutcomeExecutionStatus(null)).toBe('planned');
    expect(normalizeOutcomeExecutionStatus(undefined)).toBe('planned');
    expect(normalizeOutcomeExecutionStatus('planned')).toBe('planned');
  });

  it('allows practical ordinary transitions', () => {
    expect(isAllowedOrdinaryStatusTransition('planned', 'in_progress')).toBe(true);
    expect(isAllowedOrdinaryStatusTransition('planned', 'completed')).toBe(true);
    expect(isAllowedOrdinaryStatusTransition('planned', 'not_completed')).toBe(true);
    expect(isAllowedOrdinaryStatusTransition('in_progress', 'completed')).toBe(true);
    expect(isAllowedOrdinaryStatusTransition('in_progress', 'not_completed')).toBe(true);
  });

  it('rejects invalid ordinary transitions including cancelled', () => {
    expect(isAllowedOrdinaryStatusTransition('planned', 'cancelled')).toBe(false);
    expect(isAllowedOrdinaryStatusTransition('completed', 'planned')).toBe(false);
    expect(isAllowedOrdinaryStatusTransition('completed', 'in_progress')).toBe(false);
    expect(isAllowedOrdinaryStatusTransition('not_completed', 'completed')).toBe(false);
    expect(isAllowedOrdinaryStatusTransition('cancelled', 'planned')).toBe(false);
  });
});

describe('parseOutcomeStatusUpdate', () => {
  it('accepts planned to in_progress without a note', () => {
    const result = parseOutcomeStatusUpdate({
      expectedFromStatus: 'planned',
      toStatus: 'in_progress',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.toStatus).toBe('in_progress');
    expect(result.data.completionNote).toBeNull();
  });

  it('accepts completion with optional note', () => {
    const result = parseOutcomeStatusUpdate({
      expectedFromStatus: 'in_progress',
      toStatus: 'completed',
      completionNote: 'Pressure tested successfully.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completionNote).toBe('Pressure tested successfully.');
  });

  it('requires not-completed reason and explanation', () => {
    const missing = parseOutcomeStatusUpdate({
      expectedFromStatus: 'planned',
      toStatus: 'not_completed',
    });
    expect(missing.ok).toBe(false);

    const noExplanation = parseOutcomeStatusUpdate({
      expectedFromStatus: 'planned',
      toStatus: 'not_completed',
      notCompletedReasonCategory: 'weather',
      notCompletedExplanation: '   ',
    });
    expect(noExplanation.ok).toBe(false);

    const valid = parseOutcomeStatusUpdate({
      expectedFromStatus: 'planned',
      toStatus: 'not_completed',
      notCompletedReasonCategory: 'delivery_delay',
      notCompletedExplanation: 'Bluestone delivery arrived after 2:30 pm.',
    });
    expect(valid.ok).toBe(true);
  });

  it('requires a clear explanation when reason is other', () => {
    const result = parseOutcomeStatusUpdate({
      expectedFromStatus: 'in_progress',
      toStatus: 'not_completed',
      notCompletedReasonCategory: 'other',
      notCompletedExplanation: 'ab',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects cancelled via ordinary status endpoint', () => {
    const result = parseOutcomeStatusUpdate({
      expectedFromStatus: 'planned',
      toStatus: 'cancelled',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(DAILY_PLAN_CANCEL_REQUIRES_CHANGE_MESSAGE);
  });

  it('rejects invalid transitions', () => {
    const result = parseOutcomeStatusUpdate({
      expectedFromStatus: 'completed',
      toStatus: 'in_progress',
    });
    expect(result.ok).toBe(false);
  });
});

describe('parsePlanChangeBody', () => {
  const baseChange = {
    changeType: 'change_crew_allocation',
    reasonCategory: 'labour_or_staffing_issue',
    whatChanged: 'Moved Alex to paving base.',
    whyChanged: 'Labour shortage on paving crew.',
    decisionMakerType: 'current_supervisor',
    impactToday: 'Paving base delayed until afternoon.',
  };

  it('accepts a valid non-outcome change', () => {
    const result = parsePlanChangeBody(baseChange);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.changeType).toBe('change_crew_allocation');
    expect(result.data.replacementDescription).toBeNull();
  });

  it('requires affected outcome for cancellation', () => {
    const missing = parsePlanChangeBody({
      ...baseChange,
      changeType: 'cancel_planned_outcome',
    });
    expect(missing.ok).toBe(false);

    const valid = parsePlanChangeBody({
      ...baseChange,
      changeType: 'cancel_planned_outcome',
      affectedOutcomeId: OUTCOME_ID,
      reasonCategory: 'unexpected_site_condition',
      whatChanged: 'Cancelled deck frame outcome.',
      whyChanged: 'Existing concrete footing larger than shown.',
      impactToday: 'Crew switched to prep work.',
    });
    expect(valid.ok).toBe(true);
  });

  it('requires replacement description for add_replacement_outcome', () => {
    const missing = parsePlanChangeBody({
      ...baseChange,
      changeType: 'add_replacement_outcome',
    });
    expect(missing.ok).toBe(false);

    const valid = parsePlanChangeBody({
      ...baseChange,
      changeType: 'add_replacement_outcome',
      replacementDescription: 'Install temporary fencing along driveway.',
      whatChanged: 'Added fencing work for today.',
      whyChanged: 'Client requested temporary protection.',
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.data.replacementDescription).toContain('temporary fencing');
  });

  it('requires decision maker label for client / external / other / staff name', () => {
    const missing = parsePlanChangeBody({
      ...baseChange,
      decisionMakerType: 'client',
    });
    expect(missing.ok).toBe(false);

    const valid = parsePlanChangeBody({
      ...baseChange,
      decisionMakerType: 'client',
      decisionMakerLabel: 'Client',
    });
    expect(valid.ok).toBe(true);

    const staffByName = parsePlanChangeBody({
      ...baseChange,
      decisionMakerType: 'staff_profile',
      decisionMakerLabel: 'Steve Mobbs',
    });
    expect(staffByName.ok).toBe(true);
  });

  it('validates reason and explanation for other', () => {
    const result = parsePlanChangeBody({
      ...baseChange,
      reasonCategory: 'other',
      whyChanged: 'x',
    });
    expect(result.ok).toBe(false);
  });
});

describe('execution permissions and baseline preservation helpers', () => {
  it('allows supervisors and admins to update execution on active plans only', () => {
    expect(canUpdateDailyPlanExecution('supervisor', 'active')).toBe(true);
    expect(canUpdateDailyPlanExecution('admin', 'active')).toBe(true);
    expect(canUpdateDailyPlanExecution('field', 'active')).toBe(false);
    expect(canUpdateDailyPlanExecution('supervisor', 'draft')).toBe(false);
  });

  it('keeps baseline editing locked on active plans', () => {
    expect(canEditDailyPlanBaseline('supervisor', 'active')).toBe(false);
    expect(canEditDailyPlanBaseline('supervisor', 'draft')).toBe(true);
  });

  it('maps active outcomes with planned default and execution flags', () => {
    const api = mapDailyPlanApi({
      plan: activePlanRow(),
      outcomes: [
        {
          id: OUTCOME_ID,
          description: 'Rear courtyard paving base completed and compacted.',
          display_order: 1,
        },
      ],
      crew: [
        {
          id: 'c1',
          crew_member_name: 'Alex',
          responsibility: 'Base prep',
          staff_profile_id: null,
          display_order: 1,
        },
      ],
      materials: [],
      equipment: [],
      replacementOutcomes: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          plan_change_id: '44444444-4444-4444-8444-444444444444',
          description: 'Install temporary fencing.',
          execution_status: 'planned',
          created_by_staff_profile_id: SUPERVISOR_ID,
          created_at: '2026-07-20T01:00:00.000Z',
          created_by: { full_name: 'Sam Supervisor' },
        },
      ],
      changes: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          change_type: 'add_replacement_outcome',
          reason_category: 'client_decision',
          what_changed: 'Added fencing',
          why_changed: 'Client request',
          affected_outcome_id: null,
          decision_maker_type: 'client',
          decision_maker_staff_profile_id: null,
          decision_maker_label: 'Client',
          impact_today: 'Extra crew time on fencing',
          programme_impact: null,
          recorded_by_staff_profile_id: SUPERVISOR_ID,
          created_at: '2026-07-20T01:00:00.000Z',
          recorded_by: { full_name: 'Sam Supervisor' },
        },
      ],
      viewerRole: 'supervisor',
      now: new Date('2026-07-20T04:00:00.000Z'),
    });

    expect(api.outcomes[0]?.executionStatus).toBe('planned');
    expect(api.outcomes[0]?.description).toBe(
      'Rear courtyard paving base completed and compacted.'
    );
    expect(api.canEdit).toBe(false);
    expect(api.canUpdateExecution).toBe(true);
    expect(api.replacementOutcomes).toHaveLength(1);
    expect(api.replacementOutcomes[0]?.description).toBe('Install temporary fencing.');
    expect(api.changes).toHaveLength(1);
    expect(api.changes[0]?.replacementOutcomeIds).toEqual([
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(api.crewResponsibilities[0]?.crewMemberName).toBe('Alex');
    expect(api.risksConstraints).toBe('Rain');
    expect(api.generalNotes).toBe('Access note');
  });

  it('orders change history newest first', () => {
    const api = mapDailyPlanApi({
      plan: activePlanRow(),
      outcomes: [{ id: OUTCOME_ID, description: 'Outcome', display_order: 1 }],
      crew: [],
      materials: [],
      equipment: [],
      changes: [
        {
          id: 'change-old',
          change_type: 'change_crew_allocation',
          reason_category: 'supervisor_decision',
          what_changed: 'Older change',
          why_changed: 'First',
          affected_outcome_id: null,
          decision_maker_type: 'current_supervisor',
          decision_maker_staff_profile_id: SUPERVISOR_ID,
          decision_maker_label: null,
          impact_today: 'Minor',
          programme_impact: null,
          recorded_by_staff_profile_id: SUPERVISOR_ID,
          created_at: '2026-07-20T01:00:00.000Z',
          recorded_by: { full_name: 'Sam Supervisor' },
          decision_maker: { full_name: 'Sam Supervisor' },
        },
        {
          id: 'change-new',
          change_type: 'change_equipment_requirement',
          reason_category: 'equipment_issue',
          what_changed: 'Newer change',
          why_changed: 'Second',
          affected_outcome_id: null,
          decision_maker_type: 'current_supervisor',
          decision_maker_staff_profile_id: SUPERVISOR_ID,
          decision_maker_label: null,
          impact_today: 'Needed hire',
          programme_impact: null,
          recorded_by_staff_profile_id: SUPERVISOR_ID,
          created_at: '2026-07-20T03:00:00.000Z',
          recorded_by: { full_name: 'Sam Supervisor' },
          decision_maker: { full_name: 'Sam Supervisor' },
        },
      ],
      viewerRole: 'supervisor',
    });

    expect(api.changes.map((c) => c.id)).toEqual(['change-new', 'change-old']);
  });

  it('marks field viewers read-only for execution', () => {
    const api = mapDailyPlanApi({
      plan: activePlanRow(),
      outcomes: [{ id: OUTCOME_ID, description: 'Outcome', display_order: 1 }],
      crew: [],
      materials: [],
      equipment: [],
      viewerRole: 'field',
    });
    expect(api.canUpdateExecution).toBe(false);
    expect(api.canEdit).toBe(false);
  });
});

describe('Phase 2C concurrency messaging', () => {
  it('documents stale status updates return a controlled conflict', () => {
    // Server RPC updates WHERE execution_status = expected_from_status.
    // A concurrent transition returns conflict and does not overwrite metadata.
    expect(isAllowedOrdinaryStatusTransition('planned', 'completed')).toBe(true);
    expect(DAILY_PLAN_STATUS_CONFLICT_MESSAGE).toMatch(/updated by another user/i);
    expect(DAILY_PLAN_STATUS_CONFLICT_MESSAGE).toMatch(/reloaded/i);
  });
});
