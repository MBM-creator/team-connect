import { describe, expect, it } from 'vitest';
import {
  buildDailyPlanReportSummary,
  matchDailyPlanForReport,
  parseCarryForwardSelections,
} from '@/lib/daily-plan-report';
import {
  DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE,
  DAILY_PLAN_NOT_STARTED_FOR_REPORT_MESSAGE,
  mapDailyPlanApi,
  normalizeDailyPlanStatus,
  type DailyPlanApi,
  type DailyPlanDbRow,
} from '@/lib/daily-plan-shared';

const SUPERVISOR_ID = '11111111-1111-4111-8111-111111111111';
const OUTCOME_ID = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT_ID = '33333333-3333-4333-8333-333333333333';

function planRow(overrides: Partial<DailyPlanDbRow> = {}): DailyPlanDbRow {
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
    risks_constraints: null,
    contingency_plan: null,
    general_notes: null,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:10:00.000Z',
    supervisor: { full_name: 'Sam Supervisor' },
    created_by: { full_name: 'Sam Supervisor' },
    started_by: { full_name: 'Sam Supervisor' },
    ...overrides,
  };
}

function activePlanApi(overrides?: {
  outcomes?: Array<{ id: string; description: string; execution_status: string }>;
  replacements?: Array<{ id: string; description: string; execution_status: string }>;
  status?: 'draft' | 'active' | 'completed';
}): DailyPlanApi {
  const status = overrides?.status ?? 'active';
  return mapDailyPlanApi({
    plan: planRow({
      status,
      completed_by_staff_profile_id: status === 'completed' ? SUPERVISOR_ID : null,
      completed_at: status === 'completed' ? '2026-07-20T08:00:00.000Z' : null,
      completed_daily_site_update_id: status === 'completed' ? 'update-1' : null,
      completed_by: status === 'completed' ? { full_name: 'Sam Supervisor' } : null,
      started_by_staff_profile_id: status === 'draft' ? null : SUPERVISOR_ID,
      started_at: status === 'draft' ? null : '2026-07-20T00:10:00.000Z',
    }),
    outcomes: (overrides?.outcomes ?? [
      { id: OUTCOME_ID, description: 'Paving base', execution_status: 'completed' },
    ]).map((o, i) => ({
      id: o.id,
      description: o.description,
      display_order: i + 1,
      execution_status: o.execution_status,
    })),
    crew: [],
    materials: [],
    equipment: [],
    replacementOutcomes: (overrides?.replacements ?? []).map((r) => ({
      id: r.id,
      plan_change_id: 'change-1',
      description: r.description,
      execution_status: r.execution_status,
      created_by_staff_profile_id: SUPERVISOR_ID,
      created_at: '2026-07-20T02:00:00.000Z',
      created_by: { full_name: 'Sam Supervisor' },
    })),
    changes:
      (overrides?.replacements?.length ?? 0) > 0
        ? [
            {
              id: 'change-1',
              change_type: 'add_replacement_outcome',
              reason_category: 'client_decision',
              what_changed: 'Added fencing',
              why_changed: 'Client request',
              affected_outcome_id: null,
              decision_maker_type: 'client',
              decision_maker_staff_profile_id: null,
              decision_maker_label: 'Client',
              impact_today: 'Extra work',
              programme_impact: null,
              recorded_by_staff_profile_id: SUPERVISOR_ID,
              created_at: '2026-07-20T02:00:00.000Z',
              recorded_by: { full_name: 'Sam Supervisor' },
            },
          ]
        : [],
    viewerRole: 'supervisor',
  });
}

describe('normalizeDailyPlanStatus Phase 2D', () => {
  it('recognises completed', () => {
    expect(normalizeDailyPlanStatus('completed')).toBe('completed');
    expect(normalizeDailyPlanStatus('active')).toBe('active');
    expect(normalizeDailyPlanStatus('draft')).toBe('draft');
  });
});

describe('matchDailyPlanForReport', () => {
  it('returns none when no plan', () => {
    const match = matchDailyPlanForReport(null, '2026-07-20');
    expect(match.kind).toBe('none');
    if (match.kind !== 'none') return;
    expect(match.message).toBe(DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE);
  });

  it('rejects wrong Melbourne date', () => {
    const plan = activePlanApi();
    const match = matchDailyPlanForReport(plan, '2026-07-21');
    expect(match.kind).toBe('none');
  });

  it('matches draft without treating it as executed', () => {
    const plan = activePlanApi({ status: 'draft' });
    const match = matchDailyPlanForReport(plan, '2026-07-20');
    expect(match.kind).toBe('draft');
    if (match.kind !== 'draft') return;
    expect(match.message).toBe(DAILY_PLAN_NOT_STARTED_FOR_REPORT_MESSAGE);
  });

  it('matches active and completed plans', () => {
    expect(matchDailyPlanForReport(activePlanApi(), '2026-07-20').kind).toBe('active');
    expect(matchDailyPlanForReport(activePlanApi({ status: 'completed' }), '2026-07-20').kind).toBe(
      'completed'
    );
  });
});

describe('buildDailyPlanReportSummary', () => {
  it('counts original and replacement outcomes correctly', () => {
    const plan = activePlanApi({
      outcomes: [
        { id: OUTCOME_ID, description: 'A', execution_status: 'completed' },
        { id: 'o2', description: 'B', execution_status: 'not_completed' },
        { id: 'o3', description: 'C', execution_status: 'cancelled' },
      ],
      replacements: [
        { id: REPLACEMENT_ID, description: 'R', execution_status: 'in_progress' },
      ],
    });
    const summary = buildDailyPlanReportSummary(plan);
    expect(summary.originalPlannedCount).toBe(3);
    expect(summary.originalCompletedCount).toBe(1);
    expect(summary.originalNotCompletedCount).toBe(1);
    expect(summary.originalCancelledCount).toBe(1);
    expect(summary.replacementAddedCount).toBe(1);
    expect(summary.replacementUnresolvedCount).toBe(1);
    expect(summary.changePlanCount).toBe(1);
    expect(summary.readyForReportCompletion).toBe(false);
    expect(summary.unresolvedOutcomes).toHaveLength(1);
    expect(summary.carryForwardEligible).toHaveLength(2);
  });

  it('is ready when all outcomes are terminal', () => {
    const plan = activePlanApi({
      outcomes: [{ id: OUTCOME_ID, description: 'A', execution_status: 'completed' }],
      replacements: [
        { id: REPLACEMENT_ID, description: 'R', execution_status: 'not_completed' },
      ],
    });
    const summary = buildDailyPlanReportSummary(plan);
    expect(summary.readyForReportCompletion).toBe(true);
    expect(summary.unresolvedOutcomes).toHaveLength(0);
  });

  it('blocks planned and in-progress originals and replacements', () => {
    const planned = buildDailyPlanReportSummary(
      activePlanApi({
        outcomes: [{ id: OUTCOME_ID, description: 'A', execution_status: 'planned' }],
      })
    );
    expect(planned.readyForReportCompletion).toBe(false);

    const inProgress = buildDailyPlanReportSummary(
      activePlanApi({
        outcomes: [{ id: OUTCOME_ID, description: 'A', execution_status: 'in_progress' }],
      })
    );
    expect(inProgress.readyForReportCompletion).toBe(false);
  });
});

describe('parseCarryForwardSelections', () => {
  const eligible = [
    {
      id: OUTCOME_ID,
      description: 'A',
      executionStatus: 'not_completed' as const,
      source: 'original' as const,
      notCompletedReasonCategory: 'weather',
      notCompletedExplanation: 'Rain',
    },
  ];

  it('accepts eligible original outcome', () => {
    const result = parseCarryForwardSelections(
      [{ outcomeId: OUTCOME_ID, carryForward: true, note: 'Finish tomorrow' }],
      eligible
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.note).toBe('Finish tomorrow');
  });

  it('rejects completed outcomes', () => {
    const result = parseCarryForwardSelections(
      [{ outcomeId: '99999999-9999-4999-8999-999999999999', carryForward: true }],
      eligible
    );
    expect(result.ok).toBe(false);
  });
});
