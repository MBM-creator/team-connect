/**
 * Shared Daily Plan API error mapping and mutation logging for Phase 2G.
 * Keeps user-facing messages practical while retaining server diagnostics.
 */

import { NextResponse } from 'next/server';
import { DAILY_PLAN_COMPLETED_LOCKED_MESSAGE } from '@/lib/daily-plan-shared';

export const DAILY_PLAN_DAY_COMPLETION_REQUIRES_ACTIVE_MESSAGE =
  'Start the Daily Plan before completing the Daily Report.';

export const DAILY_PLAN_VOID_COMPLETING_UPDATE_MESSAGE =
  'This Daily Site Update completed the Daily Plan and cannot be voided. The plan remains read-only.';

export const DAILY_PLAN_DAY_COMPLETION_DRAFT_CONFLICT_MESSAGE =
  'A day-completion draft was updated by another user. Reload and try again.';

export type DailyPlanMutationAction =
  | 'start_day'
  | 'outcome_status'
  | 'replacement_status'
  | 'plan_change'
  | 'save_plan'
  | 'day_completion_draft'
  | 'day_completion_submit'
  | 'void_dsu'
  | 'carry_forward_suggestions';

export type DailyPlanMutationLogContext = {
  requestId: string;
  action: DailyPlanMutationAction;
  orgSlug?: string;
  jobId?: string;
  planId?: string;
  userId?: string;
  errorType?: string;
  message?: string;
};

/** Structured server log for significant Daily Plan mutation failures. */
export function logDailyPlanMutationFailure(ctx: DailyPlanMutationLogContext): void {
  console.error('[daily-plan]', {
    requestId: ctx.requestId,
    action: ctx.action,
    orgSlug: ctx.orgSlug ?? null,
    jobId: ctx.jobId ?? null,
    planId: ctx.planId ?? null,
    userId: ctx.userId ?? null,
    errorType: ctx.errorType ?? 'unknown',
    message: ctx.message ?? null,
  });
}

export function dailyPlanJsonError(
  message: string,
  status = 400,
  requestId?: string,
  extra?: Record<string, unknown>
): NextResponse {
  const res = NextResponse.json({ ok: false, message, requestId, ...extra }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

export function dailyPlanServerError(
  requestId: string,
  errorCode: string,
  message = 'Internal server error'
): NextResponse {
  const res = NextResponse.json({ ok: false, requestId, errorCode, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

/**
 * Map a Daily Plan mutation helper result to an HTTP response.
 * Conflicts → 409; known domain failures → 400; unexpected → 500 + log.
 */
export function mapDailyPlanMutationFailure(input: {
  requestId: string;
  action: DailyPlanMutationAction;
  orgSlug?: string;
  jobId?: string;
  planId?: string;
  userId?: string;
  conflict?: boolean;
  message: string;
  code?: string;
  extra?: Record<string, unknown>;
}): NextResponse {
  if (input.conflict) {
    return dailyPlanJsonError(input.message, 409, input.requestId, input.extra);
  }

  const domain = isDailyPlanDomainFailure(input.message, input.code);
  if (domain) {
    return dailyPlanJsonError(input.message, domain.status, input.requestId, input.extra);
  }

  logDailyPlanMutationFailure({
    requestId: input.requestId,
    action: input.action,
    orgSlug: input.orgSlug,
    jobId: input.jobId,
    planId: input.planId,
    userId: input.userId,
    errorType: input.code ?? 'mutation_failed',
    message: input.message,
  });

  return dailyPlanServerError(
    input.requestId,
    input.code ?? 'DP_MUTATION',
    'Something went wrong. Please try again.'
  );
}

/** Detect expected domain failures that should not be HTTP 500. */
export function isDailyPlanDomainFailure(
  message: string,
  code?: string
): { status: 400 | 409 } | null {
  const lower = message.toLowerCase();

  if (
    lower.includes('read-only') ||
    lower.includes('already been started') ||
    lower.includes('already been completed') ||
    lower.includes('updated by another') ||
    lower.includes('updated by someone else') ||
    lower.includes('not active') ||
    message === DAILY_PLAN_COMPLETED_LOCKED_MESSAGE
  ) {
    return { status: 409 };
  }

  if (
    lower.includes('not found') ||
    lower.includes('required') ||
    lower.includes('unfinished') ||
    lower.includes('cannot') ||
    lower.includes('must') ||
    lower.includes('invalid') ||
    lower.includes('belongs to another') ||
    lower.includes('permission') ||
    lower.includes('before completing') ||
    lower.includes('start the daily plan') ||
    code === '23505' ||
    code === '23503' ||
    code === '23514'
  ) {
    return { status: 400 };
  }

  return null;
}

/** Map Postgres unique_violation to a practical day-completion draft conflict. */
export function mapUniqueViolationMessage(
  code: string | null | undefined,
  fallback: string
): { conflict: true; message: string } | null {
  if (code === '23505') {
    return { conflict: true, message: fallback };
  }
  return null;
}
