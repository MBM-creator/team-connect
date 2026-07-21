/**
 * Phase 2E: Site Operations — slim per-job operational summaries and attention logic.
 * Pure helpers suitable for batched API assembly and Vitest (no DB I/O).
 */

import {
  compareWorkDates,
  DAILY_PLAN_WORK_TIMEZONE,
  normalizeDailyPlanStatus,
  type DailyPlanStatus,
} from '@/lib/daily-plan-shared';
import type { DailyPlanOutcomeExecutionStatus } from '@/lib/daily-plan-execution';
import {
  formatReportDateInTimezone,
  isValidReportDate,
} from '@/lib/report-date';

/** Melbourne hour after which today's missing/unstarted plan needs attention. */
export const SITE_OPS_PLAN_START_HOUR = 7;

/**
 * Melbourne hour after which today's unfinished Daily Report / unresolved
 * outcomes need attention. Documented site-finish default (no settings UI).
 */
export const SITE_OPS_DAY_CLOSE_HOUR = 17;

export function planChangeAwarenessLabel(changeCount: number): string | null {
  if (changeCount <= 0) return null;
  return changeCount === 1 ? '1 plan change' : `${changeCount} plan changes`;
}

export type SiteOpsPlanStatusKey =
  | 'no_plan'
  | 'draft'
  | 'draft_not_started'
  | 'active'
  | 'completed';

export type SiteOpsAttentionState =
  | 'needs_attention'
  | 'not_started'
  | 'on_track'
  | 'complete';

export type SiteOpsDailyReportStatus =
  | 'not_started'
  | 'mid_day_submitted'
  | 'draft_saved'
  | 'outstanding'
  | 'completed';

export type SiteOpsAction =
  | 'open_today'
  | 'create_plan'
  | 'view_plan'
  | 'complete_report'
  | 'view_report'
  | 'plan_next_day';

export type SiteOpsOutcomeCounts = {
  originalTotal: number;
  originalCompleted: number;
  originalNotCompleted: number;
  originalCancelled: number;
  originalUnresolved: number;
  replacementAdded: number;
  replacementCompleted: number;
  replacementNotCompleted: number;
  replacementUnresolved: number;
};

export type SiteOpsJobInput = {
  jobId: string;
  jobName: string;
  clientName: string | null;
  projectTitle: string | null;
  workDate: string;
  plan: {
    id: string;
    status: DailyPlanStatus | string;
    supervisorStaffProfileId: string | null;
    supervisorName: string | null;
    startedAt: string | null;
    completedAt: string | null;
    completedDailySiteUpdateId: string | null;
  } | null;
  outcomes: Array<{ executionStatus: string }>;
  replacements: Array<{ executionStatus: string }>;
  changeCount: number;
  carryForwardCount: number;
  dsu: {
    midDaySubmittedCount: number;
    dayCompletionDraft: boolean;
    dayCompletionSubmitted: boolean;
    dayCompletionUpdateId: string | null;
    latestSubmittedAt: string | null;
  };
};

export type SiteOpsJobRow = {
  jobId: string;
  jobName: string;
  clientName: string | null;
  projectTitle: string | null;
  workDate: string;
  planId: string | null;
  planStatusKey: SiteOpsPlanStatusKey;
  planStatusLabel: string;
  supervisorStaffProfileId: string | null;
  supervisorName: string | null;
  outcomeCounts: SiteOpsOutcomeCounts;
  changeCount: number;
  carryForwardCount: number;
  hasReplacementWork: boolean;
  dailyReportStatus: SiteOpsDailyReportStatus;
  dailyReportLabel: string;
  dayCompletionUpdateId: string | null;
  attentionState: SiteOpsAttentionState;
  attentionLabel: string;
  attentionReasons: string[];
  /** Visible awareness only — does not flip attention by itself. */
  changeAwarenessLabel: string | null;
  actions: SiteOpsAction[];
  latestOperationalAt: string | null;
};

export type SiteOpsMetrics = {
  operationalJobs: number;
  noPlan: number;
  active: number;
  needsAttention: number;
  completed: number;
};

function countStatus(
  items: Array<{ executionStatus: string }>,
  status: DailyPlanOutcomeExecutionStatus
): number {
  return items.filter((item) => item.executionStatus === status).length;
}

function unresolvedCount(items: Array<{ executionStatus: string }>): number {
  return items.filter(
    (item) => item.executionStatus === 'planned' || item.executionStatus === 'in_progress'
  ).length;
}

export function countOutcomeStatuses(
  outcomes: Array<{ executionStatus: string }>,
  replacements: Array<{ executionStatus: string }>
): SiteOpsOutcomeCounts {
  return {
    originalTotal: outcomes.length,
    originalCompleted: countStatus(outcomes, 'completed'),
    originalNotCompleted: countStatus(outcomes, 'not_completed'),
    originalCancelled: countStatus(outcomes, 'cancelled'),
    originalUnresolved: unresolvedCount(outcomes),
    replacementAdded: replacements.length,
    replacementCompleted: countStatus(replacements, 'completed'),
    replacementNotCompleted: countStatus(replacements, 'not_completed'),
    replacementUnresolved: unresolvedCount(replacements),
  };
}

export function melbourneHourOfDay(
  now: Date = new Date(),
  timeZone: string = DAILY_PLAN_WORK_TIMEZONE
): number {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const hour = Number(hourStr);
  return Number.isFinite(hour) ? hour : 0;
}

export function resolvePlanStatusKey(
  plan: SiteOpsJobInput['plan'],
  workDate: string,
  today: string
): SiteOpsPlanStatusKey {
  if (!plan) return 'no_plan';
  const status = normalizeDailyPlanStatus(plan.status);
  if (status === 'completed') return 'completed';
  if (status === 'active') return 'active';
  // draft
  if (isValidReportDate(workDate) && compareWorkDates(workDate, today) < 0) {
    return 'draft_not_started';
  }
  return 'draft';
}

export function planStatusLabel(key: SiteOpsPlanStatusKey): string {
  switch (key) {
    case 'no_plan':
      return 'No plan';
    case 'draft':
      return 'Draft';
    case 'draft_not_started':
      return 'Draft — not started';
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    default:
      return key;
  }
}

export function resolveDailyReportStatus(input: {
  planStatusKey: SiteOpsPlanStatusKey;
  dsu: SiteOpsJobInput['dsu'];
  workDate: string;
  today: string;
  melbourneHour: number;
}): SiteOpsDailyReportStatus {
  const { planStatusKey, dsu, workDate, today, melbourneHour } = input;

  if (dsu.dayCompletionSubmitted) return 'completed';
  if (dsu.dayCompletionDraft) return 'draft_saved';

  const isPast = compareWorkDates(workDate, today) < 0;
  const isToday = compareWorkDates(workDate, today) === 0;
  const afterClose = melbourneHour >= SITE_OPS_DAY_CLOSE_HOUR;

  if (planStatusKey === 'active' && (isPast || (isToday && afterClose))) {
    return 'outstanding';
  }

  if (dsu.midDaySubmittedCount > 0) return 'mid_day_submitted';
  return 'not_started';
}

export function dailyReportLabel(status: SiteOpsDailyReportStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'mid_day_submitted':
      return 'Mid-day update submitted';
    case 'draft_saved':
      return 'Draft saved';
    case 'outstanding':
      return 'Daily Report outstanding';
    case 'completed':
      return 'Daily Report completed';
    default:
      return status;
  }
}

export function computeAttention(input: {
  planStatusKey: SiteOpsPlanStatusKey;
  outcomeCounts: SiteOpsOutcomeCounts;
  changeCount: number;
  dailyReportStatus: SiteOpsDailyReportStatus;
  dsu: SiteOpsJobInput['dsu'];
  plan: SiteOpsJobInput['plan'];
  workDate: string;
  today: string;
  melbourneHour: number;
}): { state: SiteOpsAttentionState; reasons: string[] } {
  const {
    planStatusKey,
    outcomeCounts,
    changeCount,
    dailyReportStatus,
    dsu,
    plan,
    workDate,
    today,
    melbourneHour,
  } = input;

  const reasons: string[] = [];
  const isPast = compareWorkDates(workDate, today) < 0;
  const isToday = compareWorkDates(workDate, today) === 0;
  const isFuture = compareWorkDates(workDate, today) > 0;
  const afterPlanStart = melbourneHour >= SITE_OPS_PLAN_START_HOUR;
  const afterDayClose = melbourneHour >= SITE_OPS_DAY_CLOSE_HOUR;
  const unresolved =
    outcomeCounts.originalUnresolved + outcomeCounts.replacementUnresolved;
  const notCompleted =
    outcomeCounts.originalNotCompleted + outcomeCounts.replacementNotCompleted;

  const hasLinkedFinalReport =
    dsu.dayCompletionSubmitted || Boolean(plan?.completedDailySiteUpdateId);

  const completionInconsistent =
    (planStatusKey === 'completed' && !hasLinkedFinalReport) ||
    (planStatusKey === 'active' && dsu.dayCompletionSubmitted) ||
    (planStatusKey === 'completed' && unresolved > 0);

  // Complete first — distinct from On track
  if (
    planStatusKey === 'completed' &&
    hasLinkedFinalReport &&
    unresolved === 0 &&
    !completionInconsistent
  ) {
    return { state: 'complete', reasons: [] };
  }

  // No plan — date-aware
  if (planStatusKey === 'no_plan') {
    if (isPast || (isToday && afterPlanStart)) {
      reasons.push('No Daily Plan created.');
    } else {
      return { state: 'not_started', reasons: [] };
    }
  }

  // Draft not started
  if (planStatusKey === 'draft_not_started') {
    reasons.push('Daily Plan has not been started.');
  }
  if (planStatusKey === 'draft') {
    if (isPast || (isToday && afterPlanStart)) {
      reasons.push('Daily Plan has not been started.');
    } else {
      return { state: 'not_started', reasons: [] };
    }
  }

  // Execution warnings — not for future dates
  const executionApplies =
    !isFuture && (planStatusKey === 'active' || planStatusKey === 'completed');

  if (executionApplies && notCompleted > 0) {
    reasons.push(
      notCompleted === 1
        ? 'One outcome was not completed.'
        : `${notCompleted} outcomes were not completed.`
    );
  }

  // Unresolved: past always; today only after day-close; never future
  if (
    unresolved > 0 &&
    executionApplies &&
    (isPast || (isToday && afterDayClose))
  ) {
    reasons.push(
      unresolved === 1
        ? 'One outcome remains unresolved.'
        : `${unresolved} outcomes remain unresolved.`
    );
  }

  if (dailyReportStatus === 'outstanding') {
    reasons.push('Daily Report has not been completed.');
  }

  if (planStatusKey === 'active' && isPast) {
    reasons.push('Plan remains active from a past date.');
  }

  if (completionInconsistent) {
    reasons.push('Completion state requires review.');
  }

  // Plan changes: attention reason only when another exception already exists
  if (changeCount > 0 && reasons.length > 0) {
    const label = planChangeAwarenessLabel(changeCount);
    if (label) reasons.push(`${label}.`);
  }

  if (reasons.length > 0) {
    return { state: 'needs_attention', reasons };
  }

  if (planStatusKey === 'active') {
    return { state: 'on_track', reasons: [] };
  }

  if (planStatusKey === 'draft' || planStatusKey === 'no_plan') {
    return { state: 'not_started', reasons: [] };
  }

  return { state: 'on_track', reasons: [] };
}

export function attentionLabel(state: SiteOpsAttentionState): string {
  switch (state) {
    case 'needs_attention':
      return 'Needs attention';
    case 'not_started':
      return 'Not started';
    case 'on_track':
      return 'On track';
    case 'complete':
      return 'Complete';
    default:
      return state;
  }
}

export function resolveActions(input: {
  planStatusKey: SiteOpsPlanStatusKey;
  dailyReportStatus: SiteOpsDailyReportStatus;
  workDate: string;
  today: string;
  carryForwardCount?: number;
}): SiteOpsAction[] {
  const { planStatusKey, dailyReportStatus, workDate, today } = input;
  const actions: SiteOpsAction[] = ['open_today'];
  const isToday = compareWorkDates(workDate, today) === 0;

  if (planStatusKey === 'no_plan') {
    actions.push('create_plan');
    return actions;
  }

  actions.push('view_plan');

  if (planStatusKey === 'active' && dailyReportStatus !== 'completed') {
    actions.push('complete_report');
  }

  if (planStatusKey === 'completed' || dailyReportStatus === 'completed') {
    actions.push('view_report');
  }

  if (planStatusKey === 'completed' && (input.carryForwardCount ?? 0) > 0) {
    actions.push('plan_next_day');
  }

  // Start Day is available only via Daily Plan page when draft + today; we don't duplicate it here.
  void isToday;
  return actions;
}

export function buildSiteOperationsJobRow(
  input: SiteOpsJobInput,
  options?: { now?: Date; timeZone?: string }
): SiteOpsJobRow {
  const timeZone = options?.timeZone ?? DAILY_PLAN_WORK_TIMEZONE;
  const now = options?.now ?? new Date();
  const today = formatReportDateInTimezone(now, timeZone);
  const melbourneHour = melbourneHourOfDay(now, timeZone);

  const planStatusKey = resolvePlanStatusKey(input.plan, input.workDate, today);
  const outcomeCounts = countOutcomeStatuses(input.outcomes, input.replacements);
  const dailyReportStatus = resolveDailyReportStatus({
    planStatusKey,
    dsu: input.dsu,
    workDate: input.workDate,
    today,
    melbourneHour,
  });
  const attention = computeAttention({
    planStatusKey,
    outcomeCounts,
    changeCount: input.changeCount,
    dailyReportStatus,
    dsu: input.dsu,
    plan: input.plan,
    workDate: input.workDate,
    today,
    melbourneHour,
  });
  const actions = resolveActions({
    planStatusKey,
    dailyReportStatus,
    workDate: input.workDate,
    today,
    carryForwardCount: input.carryForwardCount,
  });

  const timestamps = [
    input.plan?.startedAt,
    input.plan?.completedAt,
    input.dsu.latestSubmittedAt,
  ].filter((value): value is string => Boolean(value));
  timestamps.sort();
  const latestOperationalAt = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : null;

  return {
    jobId: input.jobId,
    jobName: input.jobName,
    clientName: input.clientName,
    projectTitle: input.projectTitle,
    workDate: input.workDate,
    planId: input.plan?.id ?? null,
    planStatusKey,
    planStatusLabel: planStatusLabel(planStatusKey),
    supervisorStaffProfileId: input.plan?.supervisorStaffProfileId ?? null,
    supervisorName: input.plan?.supervisorName ?? null,
    outcomeCounts,
    changeCount: input.changeCount,
    carryForwardCount: input.carryForwardCount,
    hasReplacementWork: outcomeCounts.replacementAdded > 0,
    dailyReportStatus,
    dailyReportLabel: dailyReportLabel(dailyReportStatus),
    dayCompletionUpdateId: input.dsu.dayCompletionUpdateId,
    attentionState: attention.state,
    attentionLabel: attentionLabel(attention.state),
    attentionReasons: attention.reasons,
    changeAwarenessLabel: planChangeAwarenessLabel(input.changeCount),
    actions,
    latestOperationalAt,
  };
}

const ATTENTION_SORT_ORDER: Record<SiteOpsAttentionState, number> = {
  needs_attention: 0,
  not_started: 1,
  on_track: 2,
  complete: 3,
};

export function sortSiteOperationsRows(rows: SiteOpsJobRow[]): SiteOpsJobRow[] {
  return [...rows].sort((a, b) => {
    const attentionCmp =
      ATTENTION_SORT_ORDER[a.attentionState] - ATTENTION_SORT_ORDER[b.attentionState];
    if (attentionCmp !== 0) return attentionCmp;

    // Within needs_attention / not_started, prefer no-plan before drafts
    if (a.planStatusKey === 'no_plan' && b.planStatusKey !== 'no_plan') return -1;
    if (b.planStatusKey === 'no_plan' && a.planStatusKey !== 'no_plan') return 1;

    return a.jobName.localeCompare(b.jobName, 'en', { sensitivity: 'base' });
  });
}

export function buildSiteOperationsMetrics(rows: SiteOpsJobRow[]): SiteOpsMetrics {
  return {
    operationalJobs: rows.length,
    noPlan: rows.filter((r) => r.planStatusKey === 'no_plan').length,
    active: rows.filter((r) => r.planStatusKey === 'active').length,
    needsAttention: rows.filter((r) => r.attentionState === 'needs_attention').length,
    completed: rows.filter((r) => r.planStatusKey === 'completed').length,
  };
}

export function filterSiteOperationsRows(
  rows: SiteOpsJobRow[],
  filters: {
    planStatus?: string | null;
    attention?: string | null;
    supervisorId?: string | null;
    q?: string | null;
  }
): SiteOpsJobRow[] {
  const q = filters.q?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (filters.planStatus && filters.planStatus !== 'all') {
      if (filters.planStatus === 'draft') {
        if (row.planStatusKey !== 'draft' && row.planStatusKey !== 'draft_not_started') {
          return false;
        }
      } else if (row.planStatusKey !== filters.planStatus) {
        return false;
      }
    }
    if (filters.attention && filters.attention !== 'all') {
      if (row.attentionState !== filters.attention) return false;
    }
    if (filters.supervisorId && filters.supervisorId !== 'all') {
      if (row.supervisorStaffProfileId !== filters.supervisorId) return false;
    }
    if (q) {
      const haystack = [row.jobName, row.clientName, row.projectTitle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function canViewSiteOperations(role: string): boolean {
  return role === 'admin';
}
