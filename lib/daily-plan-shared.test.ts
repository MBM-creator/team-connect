import { describe, expect, it } from 'vitest';
import {
  canEditDailyPlan,
  canEditDailyPlanBaseline,
  canStartDailyPlan,
  canViewDailyPlan,
  compareWorkDates,
  DAILY_PLAN_ALREADY_ACTIVE_MESSAGE,
  DAILY_PLAN_BASELINE_LOCKED_MESSAGE,
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  DAILY_PLAN_DAY_STARTED_MESSAGE,
  DAILY_PLAN_EMPTY_MESSAGE,
  DAILY_PLAN_FUTURE_START_HINT,
  DAILY_PLAN_PAST_DRAFT_STATUS_MESSAGE,
  DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE,
  duplicateDailyPlanMessage,
  getDailyPlanStartDateError,
  getDailyPlanUiState,
  isWorkDateToday,
  isWorkDateTodayOrFuture,
  mapDailyPlanApi,
  normalizeDailyPlanStatus,
  parseDailyPlanUpsertBody,
  type DailyPlanDbRow,
} from '@/lib/daily-plan-shared';
import { formatReportDateInTimezone } from '@/lib/report-date';

const SUPERVISOR_ID = '11111111-1111-4111-8111-111111111111';

function draftPlanRow(overrides: Partial<DailyPlanDbRow> = {}): DailyPlanDbRow {
  return {
    id: 'plan-1',
    job_id: 'job-1',
    work_date: '2026-07-21',
    work_timezone: 'Australia/Melbourne',
    status: 'draft',
    supervisor_staff_profile_id: SUPERVISOR_ID,
    created_by_staff_profile_id: SUPERVISOR_ID,
    started_by_staff_profile_id: null,
    started_at: null,
    risks_constraints: 'Rain',
    contingency_plan: 'Front garden',
    general_notes: null,
    created_at: '2026-07-20T02:00:00.000Z',
    updated_at: '2026-07-20T02:00:00.000Z',
    supervisor: { full_name: 'Sam Supervisor' },
    created_by: { full_name: 'Sam Supervisor' },
    started_by: null,
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    workDate: '2026-07-21',
    supervisorStaffProfileId: SUPERVISOR_ID,
    outcomes: [{ description: 'Rear courtyard paving base completed and compacted.' }],
    crewResponsibilities: [{ crewMemberName: 'Alex', responsibility: 'Base prep' }],
    materials: [{ description: 'Class 2 crushed rock', quantity: '3 tonnes' }],
    equipment: [{ description: 'Plate compactor' }],
    risksConstraints: 'Rain forecast after midday',
    contingencyPlan: 'Move crew to front garden preparation',
    generalNotes: 'Confirm client access',
    ...overrides,
  };
}

describe('parseDailyPlanUpsertBody', () => {
  it('accepts a valid create payload with one outcome', () => {
    const result = parseDailyPlanUpsertBody(validBody(), {
      mode: 'create',
      todayInTimezone: () => '2026-07-20',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcomes).toHaveLength(1);
    expect(result.data.workDate).toBe('2026-07-21');
    expect(result.data.crewResponsibilities[0]?.crewMemberName).toBe('Alex');
  });

  it('accepts three outcomes', () => {
    const result = parseDailyPlanUpsertBody(
      validBody({
        outcomes: [
          { description: 'Outcome one' },
          { description: 'Outcome two' },
          { description: 'Outcome three' },
        ],
      }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcomes).toHaveLength(3);
    expect(result.data.outcomes.map((o) => o.displayOrder)).toEqual([1, 2, 3]);
    expect(result.data.outcomes.every((o) => o.sourceCarryForwardId === null)).toBe(true);
    expect(result.data.confirmDuplicateCarryForwardIds).toEqual([]);
  });

  it('accepts optional sourceCarryForwardId and confirmDuplicateCarryForwardIds', () => {
    const cfId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const result = parseDailyPlanUpsertBody(
      validBody({
        outcomes: [
          {
            description: 'Complete remaining paving base',
            sourceCarryForwardId: cfId,
          },
        ],
        confirmDuplicateCarryForwardIds: [cfId],
      }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcomes[0]?.sourceCarryForwardId).toBe(cfId);
    expect(result.data.confirmDuplicateCarryForwardIds).toEqual([cfId]);
  });

  it('rejects invalid or duplicated sourceCarryForwardId in one save', () => {
    const cfId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const bad = parseDailyPlanUpsertBody(
      validBody({
        outcomes: [{ description: 'A', sourceCarryForwardId: 'not-a-uuid' }],
      }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(bad.ok).toBe(false);

    const dup = parseDailyPlanUpsertBody(
      validBody({
        outcomes: [
          { description: 'A', sourceCarryForwardId: cfId },
          { description: 'B', sourceCarryForwardId: cfId },
        ],
      }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(dup.ok).toBe(false);
  });

  it('rejects zero outcomes', () => {
    const result = parseDailyPlanUpsertBody(validBody({ outcomes: [] }), {
      mode: 'create',
      todayInTimezone: () => '2026-07-20',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at least one/i);
  });

  it('rejects more than three outcomes', () => {
    const result = parseDailyPlanUpsertBody(
      validBody({
        outcomes: [
          { description: 'One' },
          { description: 'Two' },
          { description: 'Three' },
          { description: 'Four' },
        ],
      }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/up to three/i);
  });

  it('rejects blank outcomes', () => {
    const result = parseDailyPlanUpsertBody(
      validBody({ outcomes: [{ description: '   ' }] }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/cannot be blank/i);
  });

  it('rejects past work dates on create', () => {
    const result = parseDailyPlanUpsertBody(validBody({ workDate: '2026-07-19' }), {
      mode: 'create',
      todayInTimezone: () => '2026-07-20',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/today or a future/i);
  });

  it('allows today on create', () => {
    const result = parseDailyPlanUpsertBody(validBody({ workDate: '2026-07-20' }), {
      mode: 'create',
      todayInTimezone: () => '2026-07-20',
    });
    expect(result.ok).toBe(true);
  });

  it('allows edit of an existing plan with a past work date (work date supplied from DB)', () => {
    const result = parseDailyPlanUpsertBody(validBody({ workDate: '2026-07-10' }), {
      mode: 'edit',
      defaultSupervisorStaffProfileId: SUPERVISOR_ID,
      todayInTimezone: () => '2026-07-20',
    });
    expect(result.ok).toBe(true);
  });

  it('requires supervisor on create when none provided', () => {
    const result = parseDailyPlanUpsertBody(
      validBody({ supervisorStaffProfileId: undefined }),
      { mode: 'create', todayInTimezone: () => '2026-07-20' }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Supervisor is required/i);
  });

  it('uses default supervisor when body omits it on create', () => {
    const result = parseDailyPlanUpsertBody(
      validBody({ supervisorStaffProfileId: undefined }),
      {
        mode: 'create',
        defaultSupervisorStaffProfileId: SUPERVISOR_ID,
        todayInTimezone: () => '2026-07-20',
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.supervisorStaffProfileId).toBe(SUPERVISOR_ID);
  });
});

describe('Melbourne work dates', () => {
  it('preserves YYYY-MM-DD calendar dates without UTC day shift', () => {
    // 2026-07-20 14:00 Melbourne is still 2026-07-20 locally
    const melbourneAfternoon = new Date('2026-07-20T04:00:00.000Z');
    expect(formatReportDateInTimezone(melbourneAfternoon, 'Australia/Melbourne')).toBe(
      '2026-07-20'
    );

    // Early UTC morning that is still previous evening in Melbourne
    const melbourneEvening = new Date('2026-07-20T12:30:00.000Z'); // 22:30 AEST
    expect(formatReportDateInTimezone(melbourneEvening, 'Australia/Melbourne')).toBe('2026-07-20');

    // Just after Melbourne midnight
    const afterMidnight = new Date('2026-07-19T14:30:00.000Z'); // 00:30 AEST on 20th
    expect(formatReportDateInTimezone(afterMidnight, 'Australia/Melbourne')).toBe('2026-07-20');
  });

  it('compares work dates as calendar strings', () => {
    expect(compareWorkDates('2026-07-20', '2026-07-21')).toBe(-1);
    expect(compareWorkDates('2026-07-21', '2026-07-20')).toBe(1);
    expect(compareWorkDates('2026-07-20', '2026-07-20')).toBe(0);
  });

  it('treats today as eligible for create', () => {
    const now = new Date('2026-07-20T04:00:00.000Z');
    expect(isWorkDateTodayOrFuture('2026-07-20', 'Australia/Melbourne', now)).toBe(true);
    expect(isWorkDateTodayOrFuture('2026-07-19', 'Australia/Melbourne', now)).toBe(false);
  });

  it('uses Melbourne today for Start Day eligibility around UTC boundaries', () => {
    // UTC 2026-07-19 14:30 = Melbourne 2026-07-20 00:30 — Start Day for 20th is allowed
    const afterMelbourneMidnight = new Date('2026-07-19T14:30:00.000Z');
    expect(isWorkDateToday('2026-07-20', 'Australia/Melbourne', afterMelbourneMidnight)).toBe(true);
    expect(isWorkDateToday('2026-07-19', 'Australia/Melbourne', afterMelbourneMidnight)).toBe(false);

    // UTC 2026-07-20 13:30 = Melbourne 2026-07-20 23:30 — still 20th
    const beforeMelbourneMidnight = new Date('2026-07-20T13:30:00.000Z');
    expect(isWorkDateToday('2026-07-20', 'Australia/Melbourne', beforeMelbourneMidnight)).toBe(true);
    expect(isWorkDateToday('2026-07-21', 'Australia/Melbourne', beforeMelbourneMidnight)).toBe(false);

    // UTC 2026-07-20 14:30 = Melbourne 2026-07-21 00:30 — Start Day for 20th no longer allowed
    const nextMelbourneDay = new Date('2026-07-20T14:30:00.000Z');
    expect(isWorkDateToday('2026-07-20', 'Australia/Melbourne', nextMelbourneDay)).toBe(false);
    expect(isWorkDateToday('2026-07-21', 'Australia/Melbourne', nextMelbourneDay)).toBe(true);
  });
});

describe('Start Day status and eligibility', () => {
  it('treats missing or unknown status as draft', () => {
    expect(normalizeDailyPlanStatus(undefined)).toBe('draft');
    expect(normalizeDailyPlanStatus('draft')).toBe('draft');
    expect(normalizeDailyPlanStatus('active')).toBe('active');
    expect(normalizeDailyPlanStatus('completed')).toBe('completed');
  });

  it('allows supervisors and admins to start today’s draft only', () => {
    const now = new Date('2026-07-20T04:00:00.000Z');
    expect(
      canStartDailyPlan({
        status: 'draft',
        workDate: '2026-07-20',
        role: 'supervisor',
        now,
      })
    ).toBe(true);
    expect(
      canStartDailyPlan({
        status: 'draft',
        workDate: '2026-07-20',
        role: 'admin',
        now,
      })
    ).toBe(true);
  });

  it('blocks field users, future dates, past drafts, and active plans from Start Day', () => {
    const now = new Date('2026-07-20T04:00:00.000Z');
    expect(
      canStartDailyPlan({
        status: 'draft',
        workDate: '2026-07-20',
        role: 'field',
        now,
      })
    ).toBe(false);
    expect(
      canStartDailyPlan({
        status: 'draft',
        workDate: '2026-07-21',
        role: 'supervisor',
        now,
      })
    ).toBe(false);
    expect(
      canStartDailyPlan({
        status: 'draft',
        workDate: '2026-07-19',
        role: 'supervisor',
        now,
      })
    ).toBe(false);
    expect(
      canStartDailyPlan({
        status: 'active',
        workDate: '2026-07-20',
        role: 'supervisor',
        now,
      })
    ).toBe(false);
  });

  it('returns clear past and future Start Day errors', () => {
    const now = new Date('2026-07-20T04:00:00.000Z');
    expect(getDailyPlanStartDateError('2026-07-21', 'Australia/Melbourne', now)).toMatch(
      /work date/i
    );
    expect(getDailyPlanStartDateError('2026-07-19', 'Australia/Melbourne', now)).toMatch(
      /scheduled work date/i
    );
    expect(getDailyPlanStartDateError('2026-07-20', 'Australia/Melbourne', now)).toBeNull();
  });

  it('locks baseline editing for active plans while drafts remain editable', () => {
    expect(canEditDailyPlanBaseline('supervisor', 'draft')).toBe(true);
    expect(canEditDailyPlanBaseline('admin', 'draft')).toBe(true);
    expect(canEditDailyPlanBaseline('field', 'draft')).toBe(false);
    expect(canEditDailyPlanBaseline('supervisor', 'active')).toBe(false);
    expect(canEditDailyPlanBaseline('admin', 'active')).toBe(false);
  });

  it('exposes locking and conflict messages', () => {
    expect(DAILY_PLAN_BASELINE_LOCKED_MESSAGE).toMatch(/baseline is locked/i);
    expect(DAILY_PLAN_ALREADY_ACTIVE_MESSAGE).toMatch(/already been started/i);
    expect(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE).toMatch(/read-only/i);
    expect(DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE).toMatch(/Resolve the unfinished/i);
    expect(DAILY_PLAN_DAY_STARTED_MESSAGE).toMatch(/Day started/i);
  });
});

describe('Daily Plan UI state', () => {
  const now = new Date('2026-07-20T04:00:00.000Z');

  it('shows Start Day and Edit for today’s draft when the user can edit', () => {
    const ui = getDailyPlanUiState({
      status: 'draft',
      workDate: '2026-07-20',
      canEditRole: true,
      now,
    });
    expect(ui.showStartDay).toBe(true);
    expect(ui.showEdit).toBe(true);
    expect(ui.isBaselineLocked).toBe(false);
  });

  it('keeps Edit for future drafts but does not allow Start Day', () => {
    const ui = getDailyPlanUiState({
      status: 'draft',
      workDate: '2026-07-21',
      canEditRole: true,
      now,
    });
    expect(ui.showEdit).toBe(true);
    expect(ui.showStartDay).toBe(false);
    expect(ui.isFutureDraft).toBe(true);
    expect(ui.supportingMessage).toBe(DAILY_PLAN_FUTURE_START_HINT);
  });

  it('blocks Start Day for past unstarted drafts', () => {
    const ui = getDailyPlanUiState({
      status: 'draft',
      workDate: '2026-07-19',
      canEditRole: true,
      now,
    });
    expect(ui.showStartDay).toBe(false);
    expect(ui.isPastUnstartedDraft).toBe(true);
    expect(ui.statusLabel).toBe('Draft');
    expect(ui.supportingMessage).toBe(DAILY_PLAN_PAST_DRAFT_STATUS_MESSAGE);
  });

  it('shows locked active state without Edit or Start Day', () => {
    const ui = getDailyPlanUiState({
      status: 'active',
      workDate: '2026-07-20',
      canEditRole: true,
      now,
    });
    expect(ui.showEdit).toBe(false);
    expect(ui.showStartDay).toBe(false);
    expect(ui.isBaselineLocked).toBe(true);
    expect(ui.statusLabel).toBe('Active');
  });
});

describe('permissions', () => {
  it('allows supervisors and admins to edit', () => {
    expect(canEditDailyPlan('supervisor')).toBe(true);
    expect(canEditDailyPlan('admin')).toBe(true);
    expect(canEditDailyPlan('field')).toBe(false);
  });

  it('allows all staff roles to view', () => {
    expect(canViewDailyPlan('field')).toBe(true);
    expect(canViewDailyPlan('supervisor')).toBe(true);
    expect(canViewDailyPlan('admin')).toBe(true);
  });
});

describe('duplicate plan messaging', () => {
  it('directs users to the existing plan', () => {
    expect(duplicateDailyPlanMessage('abc')).toMatch(/already exists/i);
    expect(duplicateDailyPlanMessage('abc')).toMatch(/existing plan/i);
  });
});

describe('Today display helpers', () => {
  it('exposes a clear empty-state message', () => {
    expect(DAILY_PLAN_EMPTY_MESSAGE).toBe(
      'No Daily Plan has been created for this project and date.'
    );
  });

  it('maps a saved draft plan for display including edit flag', () => {
    const api = mapDailyPlanApi({
      plan: draftPlanRow(),
      outcomes: [
        { id: 'o1', description: 'Deck frame completed', display_order: 1 },
      ],
      crew: [],
      materials: [],
      equipment: [],
      viewerRole: 'supervisor',
      now: new Date('2026-07-20T04:00:00.000Z'),
    });

    expect(api.workDate).toBe('2026-07-21');
    expect(api.status).toBe('draft');
    expect(api.supervisorName).toBe('Sam Supervisor');
    expect(api.outcomes[0]?.description).toBe('Deck frame completed');
    expect(api.outcomes[0]?.sourceCarryForwardId).toBeNull();
    expect(api.canEdit).toBe(true);
    expect(api.canStartDay).toBe(false); // future relative to fixed now
    expect(api.canUpdateExecution).toBe(false);
    expect(api.outcomes[0]?.executionStatus).toBe('planned');
    expect(api.replacementOutcomes).toEqual([]);
    expect(api.changes).toEqual([]);
    expect(api.generalNotes).toBeNull();
    expect(api.startedAt).toBeNull();
  });

  it('maps an active plan as locked with started metadata', () => {
    const api = mapDailyPlanApi({
      plan: draftPlanRow({
        work_date: '2026-07-20',
        status: 'active',
        started_by_staff_profile_id: SUPERVISOR_ID,
        started_at: '2026-07-20T00:15:00.000Z',
        started_by: { full_name: 'Sam Supervisor' },
        risks_constraints: null,
        contingency_plan: null,
      }),
      outcomes: [{ id: 'o1', description: 'Outcome', display_order: 1 }],
      crew: [],
      materials: [],
      equipment: [],
      viewerRole: 'supervisor',
      now: new Date('2026-07-20T04:00:00.000Z'),
    });
    expect(api.status).toBe('active');
    expect(api.canEdit).toBe(false);
    expect(api.canStartDay).toBe(false);
    expect(api.canUpdateExecution).toBe(true);
    expect(api.outcomes[0]?.executionStatus).toBe('planned');
    expect(api.startedByName).toBe('Sam Supervisor');
    expect(api.startedAt).toBe('2026-07-20T00:15:00.000Z');
  });

  it('marks field viewers as read-only', () => {
    const api = mapDailyPlanApi({
      plan: draftPlanRow({
        risks_constraints: null,
        contingency_plan: null,
      }),
      outcomes: [{ id: 'o1', description: 'Outcome', display_order: 1 }],
      crew: [],
      materials: [],
      equipment: [],
      viewerRole: 'field',
      now: new Date('2026-07-20T04:00:00.000Z'),
    });
    expect(api.canEdit).toBe(false);
    expect(api.canStartDay).toBe(false);
    expect(api.canUpdateExecution).toBe(false);
  });

  it('allows Start Day on today’s draft for supervisors', () => {
    const api = mapDailyPlanApi({
      plan: draftPlanRow({ work_date: '2026-07-20' }),
      outcomes: [{ id: 'o1', description: 'Outcome', display_order: 1 }],
      crew: [],
      materials: [],
      equipment: [],
      viewerRole: 'supervisor',
      now: new Date('2026-07-20T04:00:00.000Z'),
    });
    expect(api.canEdit).toBe(true);
    expect(api.canStartDay).toBe(true);
    expect(api.canUpdateExecution).toBe(false);
  });
});

describe('atomic Start Day conflict shape', () => {
  it('documents that duplicate starts must preserve started metadata via conflict', () => {
    // Server uses UPDATE ... WHERE status = 'draft'. A second request returns conflict
    // and must not replace started_by / started_at. Covered by startDailyPlanAtomically.
    expect(DAILY_PLAN_ALREADY_ACTIVE_MESSAGE).toMatch(/already been started/i);
  });
});
