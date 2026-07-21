import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE,
  DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE,
  DAILY_PLAN_VOID_COMPLETING_UPDATE_MESSAGE,
  isDailyPlanDomainFailure,
  mapUniqueViolationMessage,
  logDailyPlanMutationFailure,
} from '@/lib/daily-plan-api-errors';
import {
  DAILY_PLAN_ALREADY_ACTIVE_MESSAGE,
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE,
  getDailyPlanStartDateError,
  DAILY_PLAN_WORK_TIMEZONE,
} from '@/lib/daily-plan-shared';
import { DAILY_PLAN_STATUS_CONFLICT_MESSAGE } from '@/lib/daily-plan-execution';

describe('daily-plan-api-errors', () => {
  it('maps stale outcome conflicts to 409', () => {
    expect(isDailyPlanDomainFailure(DAILY_PLAN_STATUS_CONFLICT_MESSAGE)).toEqual({
      status: 409,
    });
    expect(isDailyPlanDomainFailure(DAILY_PLAN_ALREADY_ACTIVE_MESSAGE)).toEqual({
      status: 409,
    });
    expect(isDailyPlanDomainFailure(DAILY_PLAN_COMPLETED_LOCKED_MESSAGE)).toEqual({
      status: 409,
    });
  });

  it('maps unfinished outcomes and permission-style messages to 400', () => {
    expect(isDailyPlanDomainFailure(DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE)).toEqual({
      status: 400,
    });
    expect(
      isDailyPlanDomainFailure(DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE)
    ).toEqual({ status: 400 });
    expect(
      isDailyPlanDomainFailure('You do not have permission to make this change.')
    ).toEqual({ status: 400 });
    expect(
      isDailyPlanDomainFailure('This carry-forward item belongs to another job and cannot be used.')
    ).toEqual({ status: 400 });
  });

  it('does not treat unexpected infrastructure errors as domain failures', () => {
    expect(isDailyPlanDomainFailure('connection reset by peer')).toBeNull();
    expect(isDailyPlanDomainFailure('Failed to update outcome status', 'PGRST301')).toBeNull();
  });

  it('maps unique violations to practical conflict messages', () => {
    expect(mapUniqueViolationMessage('23505', DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE)).toEqual(
      {
        conflict: true,
        message: DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE,
      }
    );
    expect(mapUniqueViolationMessage('23503', 'fallback')).toBeNull();
  });

  it('exposes void and draft-completion safeguard copy', () => {
    expect(DAILY_PLAN_VOID_COMPLETING_UPDATE_MESSAGE).toMatch(/cannot be voided/i);
    expect(DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE).toMatch(/Start the Daily Plan/i);
  });

  it('logs mutation failures without form payloads', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logDailyPlanMutationFailure({
      requestId: 'req-1',
      action: 'outcome_status',
      orgSlug: 'madebymobbs',
      jobId: 'job-1',
      planId: 'plan-1',
      userId: 'staff-1',
      errorType: 'DP_STATUS',
      message: 'boom',
    });
    expect(spy).toHaveBeenCalledWith(
      '[daily-plan]',
      expect.objectContaining({
        requestId: 'req-1',
        action: 'outcome_status',
        orgSlug: 'madebymobbs',
        jobId: 'job-1',
        planId: 'plan-1',
        userId: 'staff-1',
        errorType: 'DP_STATUS',
        message: 'boom',
      })
    );
    spy.mockRestore();
  });
});

describe('Phase 2G locking and Melbourne boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects Start Day on a future Melbourne work date', () => {
    vi.setSystemTime(new Date('2026-07-21T02:00:00.000Z')); // 12:00 Melbourne
    const err = getDailyPlanStartDateError('2026-07-22', DAILY_PLAN_WORK_TIMEZONE);
    expect(err).toMatch(/work date/i);
  });

  it('allows Start Day on the current Melbourne work date', () => {
    vi.setSystemTime(new Date('2026-07-21T02:00:00.000Z'));
    expect(getDailyPlanStartDateError('2026-07-21', DAILY_PLAN_WORK_TIMEZONE)).toBeNull();
  });

  it('rejects Start Day on a past Melbourne work date', () => {
    vi.setSystemTime(new Date('2026-07-21T02:00:00.000Z'));
    const err = getDailyPlanStartDateError('2026-07-20', DAILY_PLAN_WORK_TIMEZONE);
    expect(err).toMatch(/scheduled work date/i);
  });
});
