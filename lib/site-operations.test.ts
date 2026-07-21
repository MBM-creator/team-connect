import { describe, expect, it } from 'vitest';
import {
  buildSiteOperationsJobRow,
  buildSiteOperationsMetrics,
  canViewSiteOperations,
  computeAttention,
  countOutcomeStatuses,
  filterSiteOperationsRows,
  melbourneHourOfDay,
  planChangeAwarenessLabel,
  resolveDailyReportStatus,
  resolvePlanStatusKey,
  sortSiteOperationsRows,
  SITE_OPS_DAY_CLOSE_HOUR,
  SITE_OPS_PLAN_START_HOUR,
  type SiteOpsJobInput,
  type SiteOpsJobRow,
} from '@/lib/site-operations';

const SUPERVISOR_ID = '11111111-1111-4111-8111-111111111111';

function baseInput(overrides: Partial<SiteOpsJobInput> = {}): SiteOpsJobInput {
  return {
    jobId: 'job-1',
    jobName: 'Alpha Job',
    clientName: 'Acme',
    projectTitle: 'Front yard',
    workDate: '2026-07-20',
    plan: {
      id: 'plan-1',
      status: 'active',
      supervisorStaffProfileId: SUPERVISOR_ID,
      supervisorName: 'Sam Supervisor',
      startedAt: '2026-07-20T00:10:00.000Z',
      completedAt: null,
      completedDailySiteUpdateId: null,
    },
    outcomes: [
      { executionStatus: 'completed' },
      { executionStatus: 'completed' },
    ],
    replacements: [],
    changeCount: 0,
    carryForwardCount: 0,
    dsu: {
      midDaySubmittedCount: 0,
      dayCompletionDraft: false,
      dayCompletionSubmitted: false,
      dayCompletionUpdateId: null,
      latestSubmittedAt: null,
    },
    ...overrides,
  };
}

/** 2026-07-20 10:00 Melbourne (AEST, UTC+10). */
const NOW_MID_MORNING = new Date('2026-07-20T00:00:00.000Z');
/** ~06:00 Melbourne — before plan-start. */
const NOW_BEFORE_PLAN_START = new Date('2026-07-19T20:00:00.000Z');
/** ~17:00 Melbourne — at day-close. */
const NOW_AT_DAY_CLOSE = new Date('2026-07-20T07:00:00.000Z');
/** Next calendar day in Melbourne. */
const NOW_NEXT_DAY = new Date('2026-07-21T01:00:00.000Z');

describe('canViewSiteOperations', () => {
  it('allows admin only', () => {
    expect(canViewSiteOperations('admin')).toBe(true);
    expect(canViewSiteOperations('supervisor')).toBe(false);
    expect(canViewSiteOperations('field')).toBe(false);
  });
});

describe('thresholds', () => {
  it('keeps plan-start and day-close independent', () => {
    expect(SITE_OPS_PLAN_START_HOUR).toBe(7);
    expect(SITE_OPS_DAY_CLOSE_HOUR).toBe(17);
    expect(SITE_OPS_PLAN_START_HOUR).not.toBe(SITE_OPS_DAY_CLOSE_HOUR);
    expect(melbourneHourOfDay(NOW_MID_MORNING)).toBe(10);
    expect(melbourneHourOfDay(NOW_BEFORE_PLAN_START)).toBe(6);
    expect(melbourneHourOfDay(NOW_AT_DAY_CLOSE)).toBe(17);
  });
});

describe('countOutcomeStatuses', () => {
  it('counts original and replacement statuses like report summary', () => {
    const counts = countOutcomeStatuses(
      [
        { executionStatus: 'completed' },
        { executionStatus: 'planned' },
        { executionStatus: 'in_progress' },
        { executionStatus: 'not_completed' },
        { executionStatus: 'cancelled' },
      ],
      [
        { executionStatus: 'completed' },
        { executionStatus: 'planned' },
        { executionStatus: 'not_completed' },
      ]
    );
    expect(counts.originalTotal).toBe(5);
    expect(counts.originalCompleted).toBe(1);
    expect(counts.originalUnresolved).toBe(2);
    expect(counts.originalNotCompleted).toBe(1);
    expect(counts.originalCancelled).toBe(1);
    expect(counts.replacementAdded).toBe(3);
    expect(counts.replacementCompleted).toBe(1);
    expect(counts.replacementUnresolved).toBe(1);
    expect(counts.replacementNotCompleted).toBe(1);
  });
});

describe('resolvePlanStatusKey', () => {
  it('includes no-plan jobs', () => {
    expect(resolvePlanStatusKey(null, '2026-07-20', '2026-07-20')).toBe('no_plan');
  });

  it('labels past draft as draft_not_started', () => {
    expect(
      resolvePlanStatusKey(
        {
          id: 'p',
          status: 'draft',
          supervisorStaffProfileId: SUPERVISOR_ID,
          supervisorName: 'Sam',
          startedAt: null,
          completedAt: null,
          completedDailySiteUpdateId: null,
        },
        '2026-07-19',
        '2026-07-20'
      )
    ).toBe('draft_not_started');
  });
});

describe('resolveDailyReportStatus', () => {
  it('uses day-close hour, not plan-start, for outstanding', () => {
    const midDayDsu = {
      midDaySubmittedCount: 1,
      dayCompletionDraft: false,
      dayCompletionSubmitted: false,
      dayCompletionUpdateId: null,
      latestSubmittedAt: null,
    };

    // Hour 10: after plan-start but before day-close → mid-day, not outstanding
    expect(
      resolveDailyReportStatus({
        planStatusKey: 'active',
        dsu: midDayDsu,
        workDate: '2026-07-20',
        today: '2026-07-20',
        melbourneHour: 10,
      })
    ).toBe('mid_day_submitted');

    expect(
      resolveDailyReportStatus({
        planStatusKey: 'active',
        dsu: {
          midDaySubmittedCount: 0,
          dayCompletionDraft: false,
          dayCompletionSubmitted: false,
          dayCompletionUpdateId: null,
          latestSubmittedAt: null,
        },
        workDate: '2026-07-20',
        today: '2026-07-20',
        melbourneHour: 17,
      })
    ).toBe('outstanding');

    expect(
      resolveDailyReportStatus({
        planStatusKey: 'active',
        dsu: midDayDsu,
        workDate: '2026-07-19',
        today: '2026-07-20',
        melbourneHour: 10,
      })
    ).toBe('outstanding');
  });

  it('maps completed and draft day-completion', () => {
    expect(
      resolveDailyReportStatus({
        planStatusKey: 'active',
        dsu: {
          midDaySubmittedCount: 0,
          dayCompletionDraft: false,
          dayCompletionSubmitted: true,
          dayCompletionUpdateId: 'u1',
          latestSubmittedAt: null,
        },
        workDate: '2026-07-20',
        today: '2026-07-20',
        melbourneHour: 18,
      })
    ).toBe('completed');

    expect(
      resolveDailyReportStatus({
        planStatusKey: 'active',
        dsu: {
          midDaySubmittedCount: 0,
          dayCompletionDraft: true,
          dayCompletionSubmitted: false,
          dayCompletionUpdateId: 'u1',
          latestSubmittedAt: null,
        },
        workDate: '2026-07-20',
        today: '2026-07-20',
        melbourneHour: 18,
      })
    ).toBe('draft_saved');
  });
});

describe('computeAttention — required correction cases', () => {
  const emptyDsu = baseInput().dsu;

  it('today active with unresolved before close-out remains On track', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'planned' }], []),
      changeCount: 0,
      dailyReportStatus: 'mid_day_submitted',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('on_track');
    expect(result.reasons).toEqual([]);
  });

  it('today active with unresolved after close-out Needs attention', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'in_progress' }], []),
      changeCount: 0,
      dailyReportStatus: 'outstanding',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 17,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons.some((r) => /unresolved/i.test(r))).toBe(true);
  });

  it('past active with unresolved Needs attention', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'planned' }], []),
      changeCount: 0,
      dailyReportStatus: 'outstanding',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-19',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons.some((r) => /unresolved/i.test(r))).toBe(true);
  });

  it('future date with no plan does not automatically Needs attention', () => {
    const result = computeAttention({
      planStatusKey: 'no_plan',
      outcomeCounts: countOutcomeStatuses([], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: null,
      workDate: '2026-07-22',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('not_started');
  });

  it('today with no plan before morning threshold is Not started', () => {
    const result = computeAttention({
      planStatusKey: 'no_plan',
      outcomeCounts: countOutcomeStatuses([], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: null,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 6,
    });
    expect(result.state).toBe('not_started');
  });

  it('today with no plan after morning threshold Needs attention', () => {
    const result = computeAttention({
      planStatusKey: 'no_plan',
      outcomeCounts: countOutcomeStatuses([], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: null,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 8,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons[0]).toMatch(/No Daily Plan/i);
  });

  it('a plan change alone does not trigger Needs attention', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'completed' }], []),
      changeCount: 1,
      dailyReportStatus: 'mid_day_submitted',
      dsu: {
        midDaySubmittedCount: 1,
        dayCompletionDraft: false,
        dayCompletionSubmitted: false,
        dayCompletionUpdateId: null,
        latestSubmittedAt: null,
      },
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('on_track');
    expect(result.reasons).toEqual([]);
    expect(planChangeAwarenessLabel(1)).toBe('1 plan change');
  });

  it('promotes plan change into reasons when another exception exists', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'not_completed' }], []),
      changeCount: 1,
      dailyReportStatus: 'mid_day_submitted',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons.some((r) => /plan change/i.test(r))).toBe(true);
  });

  it('a not-completed outcome triggers the appropriate attention reason', () => {
    const result = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses(
        [{ executionStatus: 'completed' }, { executionStatus: 'not_completed' }],
        []
      ),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons.some((r) => /not completed/i.test(r))).toBe(true);
  });

  it('keeps Complete and On track as distinct states', () => {
    const complete = computeAttention({
      planStatusKey: 'completed',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'completed' }], []),
      changeCount: 0,
      dailyReportStatus: 'completed',
      dsu: {
        midDaySubmittedCount: 0,
        dayCompletionDraft: false,
        dayCompletionSubmitted: true,
        dayCompletionUpdateId: 'u1',
        latestSubmittedAt: null,
      },
      plan: {
        id: 'p',
        status: 'completed',
        supervisorStaffProfileId: SUPERVISOR_ID,
        supervisorName: 'Sam',
        startedAt: null,
        completedAt: '2026-07-20T08:00:00.000Z',
        completedDailySiteUpdateId: 'u1',
      },
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 18,
    });
    expect(complete.state).toBe('complete');
    expect(complete.state).not.toBe('on_track');

    const onTrack = computeAttention({
      planStatusKey: 'active',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'completed' }], []),
      changeCount: 0,
      dailyReportStatus: 'mid_day_submitted',
      dsu: emptyDsu,
      plan: baseInput().plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 10,
    });
    expect(onTrack.state).toBe('on_track');
    expect(onTrack.state).not.toBe('complete');
  });

  it('flags inconsistency when completed without report', () => {
    const result = computeAttention({
      planStatusKey: 'completed',
      outcomeCounts: countOutcomeStatuses([{ executionStatus: 'completed' }], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: {
        id: 'p',
        status: 'completed',
        supervisorStaffProfileId: SUPERVISOR_ID,
        supervisorName: 'Sam',
        startedAt: null,
        completedAt: '2026-07-20T08:00:00.000Z',
        completedDailySiteUpdateId: null,
      },
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 18,
    });
    expect(result.state).toBe('needs_attention');
    expect(result.reasons.some((r) => /requires review/i.test(r))).toBe(true);
  });

  it('marks today draft after plan-start as needs attention; before as not started', () => {
    const after = computeAttention({
      planStatusKey: 'draft',
      outcomeCounts: countOutcomeStatuses([], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: baseInput({ plan: { ...baseInput().plan!, status: 'draft' } }).plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 8,
    });
    expect(after.state).toBe('needs_attention');

    const before = computeAttention({
      planStatusKey: 'draft',
      outcomeCounts: countOutcomeStatuses([], []),
      changeCount: 0,
      dailyReportStatus: 'not_started',
      dsu: emptyDsu,
      plan: baseInput({ plan: { ...baseInput().plan!, status: 'draft' } }).plan,
      workDate: '2026-07-20',
      today: '2026-07-20',
      melbourneHour: 6,
    });
    expect(before.state).toBe('not_started');
  });
});

describe('buildSiteOperationsJobRow', () => {
  it('builds a no-plan row after plan-start with create action', () => {
    const row = buildSiteOperationsJobRow(baseInput({ plan: null }), {
      now: NOW_MID_MORNING,
    });
    expect(row.planStatusKey).toBe('no_plan');
    expect(row.attentionState).toBe('needs_attention');
    expect(row.actions).toContain('create_plan');
  });

  it('builds future no-plan as not started', () => {
    const row = buildSiteOperationsJobRow(
      baseInput({ plan: null, workDate: '2026-07-25' }),
      { now: NOW_MID_MORNING }
    );
    expect(row.attentionState).toBe('not_started');
  });

  it('builds active on-track with unresolved before close', () => {
    const row = buildSiteOperationsJobRow(
      baseInput({
        outcomes: [{ executionStatus: 'planned' }, { executionStatus: 'completed' }],
      }),
      { now: NOW_MID_MORNING }
    );
    expect(row.attentionState).toBe('on_track');
    expect(row.dailyReportStatus).not.toBe('outstanding');
  });

  it('flags past active plan', () => {
    const row = buildSiteOperationsJobRow(baseInput({ workDate: '2026-07-20' }), {
      now: NOW_NEXT_DAY,
    });
    expect(row.attentionState).toBe('needs_attention');
    expect(row.attentionReasons.some((r) => /past date/i.test(r))).toBe(true);
    expect(row.dailyReportStatus).toBe('outstanding');
  });

  it('exposes change awareness without flipping attention', () => {
    const row = buildSiteOperationsJobRow(
      baseInput({ changeCount: 1 }),
      { now: NOW_MID_MORNING }
    );
    expect(row.attentionState).toBe('on_track');
    expect(row.changeAwarenessLabel).toBe('1 plan change');
  });

  it('adds plan_next_day when a completed day has carry-forward work', () => {
    const row = buildSiteOperationsJobRow(
      baseInput({
        plan: {
          id: 'plan-1',
          status: 'completed',
          supervisorStaffProfileId: 's1',
          supervisorName: 'Sam',
          startedAt: '2026-07-20T00:00:00.000Z',
          completedAt: '2026-07-20T08:00:00.000Z',
          completedDailySiteUpdateId: 'dsu-1',
        },
        carryForwardCount: 2,
        dsu: {
          midDaySubmittedCount: 0,
          dayCompletionDraft: false,
          dayCompletionSubmitted: true,
          dayCompletionUpdateId: 'dsu-1',
          latestSubmittedAt: '2026-07-20T08:00:00.000Z',
        },
      }),
      { now: NOW_MID_MORNING }
    );
    expect(row.planStatusKey).toBe('completed');
    expect(row.actions).toContain('plan_next_day');
    expect(row.actions).toContain('view_report');
  });

  it('does not add plan_next_day without carry-forward work', () => {
    const row = buildSiteOperationsJobRow(
      baseInput({
        plan: {
          id: 'plan-1',
          status: 'completed',
          supervisorStaffProfileId: 's1',
          supervisorName: 'Sam',
          startedAt: '2026-07-20T00:00:00.000Z',
          completedAt: '2026-07-20T08:00:00.000Z',
          completedDailySiteUpdateId: 'dsu-1',
        },
        carryForwardCount: 0,
        dsu: {
          midDaySubmittedCount: 0,
          dayCompletionDraft: false,
          dayCompletionSubmitted: true,
          dayCompletionUpdateId: 'dsu-1',
          latestSubmittedAt: '2026-07-20T08:00:00.000Z',
        },
      }),
      { now: NOW_MID_MORNING }
    );
    expect(row.actions).not.toContain('plan_next_day');
  });

  it('marks report outstanding only after day-close', () => {
    const beforeClose = buildSiteOperationsJobRow(baseInput(), { now: NOW_MID_MORNING });
    expect(beforeClose.dailyReportStatus).toBe('not_started');

    const atClose = buildSiteOperationsJobRow(baseInput(), { now: NOW_AT_DAY_CLOSE });
    expect(atClose.dailyReportStatus).toBe('outstanding');
    expect(atClose.attentionState).toBe('needs_attention');
  });
});

describe('sortSiteOperationsRows', () => {
  it('orders needs attention → not started → on track → complete, then name', () => {
    const mk = (partial: Partial<SiteOpsJobRow>): SiteOpsJobRow =>
      ({
        jobId: 'j',
        jobName: 'Z',
        clientName: null,
        projectTitle: null,
        workDate: '2026-07-20',
        planId: null,
        planStatusKey: 'active',
        planStatusLabel: 'Active',
        supervisorStaffProfileId: null,
        supervisorName: null,
        outcomeCounts: countOutcomeStatuses([], []),
        changeCount: 0,
        carryForwardCount: 0,
        hasReplacementWork: false,
        dailyReportStatus: 'not_started',
        dailyReportLabel: 'Not started',
        dayCompletionUpdateId: null,
        attentionState: 'on_track',
        attentionLabel: 'On track',
        attentionReasons: [],
        changeAwarenessLabel: null,
        actions: ['open_today'],
        latestOperationalAt: null,
        ...partial,
      }) as SiteOpsJobRow;

    const sorted = sortSiteOperationsRows([
      mk({ jobId: '1', jobName: 'Bravo', attentionState: 'complete' }),
      mk({ jobId: '2', jobName: 'Alpha', attentionState: 'needs_attention', planStatusKey: 'active' }),
      mk({ jobId: '3', jobName: 'Charlie', attentionState: 'not_started' }),
      mk({
        jobId: '4',
        jobName: 'Delta',
        attentionState: 'needs_attention',
        planStatusKey: 'no_plan',
      }),
      mk({ jobId: '5', jobName: 'Echo', attentionState: 'on_track' }),
    ]);

    expect(sorted.map((r) => r.jobId)).toEqual(['4', '2', '3', '5', '1']);
  });
});

describe('filter and metrics', () => {
  it('filters by q and attention', () => {
    const rows = [
      buildSiteOperationsJobRow(
        baseInput({ jobId: '1', jobName: 'Alpha Paving', clientName: 'Acme' }),
        { now: NOW_BEFORE_PLAN_START }
      ),
      buildSiteOperationsJobRow(
        baseInput({ jobId: '2', jobName: 'Beta Fence', clientName: 'Beta Co', plan: null }),
        { now: NOW_MID_MORNING }
      ),
    ];
    expect(filterSiteOperationsRows(rows, { q: 'fence' })).toHaveLength(1);
    expect(filterSiteOperationsRows(rows, { attention: 'needs_attention' })).toHaveLength(1);
  });

  it('builds metrics with distinct completed vs needs attention', () => {
    const rows = [
      buildSiteOperationsJobRow(baseInput({ jobId: '1', plan: null }), {
        now: NOW_MID_MORNING,
      }),
      buildSiteOperationsJobRow(baseInput({ jobId: '2' }), { now: NOW_BEFORE_PLAN_START }),
      buildSiteOperationsJobRow(
        baseInput({
          jobId: '3',
          plan: {
            id: 'p3',
            status: 'completed',
            supervisorStaffProfileId: SUPERVISOR_ID,
            supervisorName: 'Sam',
            startedAt: '2026-07-20T00:10:00.000Z',
            completedAt: '2026-07-20T08:00:00.000Z',
            completedDailySiteUpdateId: 'u1',
          },
          dsu: {
            midDaySubmittedCount: 0,
            dayCompletionDraft: false,
            dayCompletionSubmitted: true,
            dayCompletionUpdateId: 'u1',
            latestSubmittedAt: '2026-07-20T08:00:00.000Z',
          },
        }),
        { now: NOW_MID_MORNING }
      ),
    ];
    const metrics = buildSiteOperationsMetrics(rows);
    expect(metrics.operationalJobs).toBe(3);
    expect(metrics.noPlan).toBe(1);
    expect(metrics.active).toBe(1);
    expect(metrics.completed).toBe(1);
    expect(metrics.needsAttention).toBe(1);
    expect(rows.find((r) => r.jobId === '3')?.attentionState).toBe('complete');
    expect(rows.find((r) => r.jobId === '2')?.attentionState).toBe('on_track');
  });
});
