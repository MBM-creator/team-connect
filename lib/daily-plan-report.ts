/**
 * Phase 2D: Daily Plan ↔ Daily Site Update matching and planned-vs-actual summary.
 */

import type {
  DailyPlanApi,
  DailyPlanOutcomeApi,
  DailyPlanReplacementOutcomeApi,
  DailyPlanStatus,
} from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE,
  DAILY_PLAN_NOT_STARTED_FOR_REPORT_MESSAGE,
  normalizeDailyPlanStatus,
} from '@/lib/daily-plan-shared';
import type { DailyPlanOutcomeExecutionStatus } from '@/lib/daily-plan-execution';

export type UnresolvedPlanOutcome = {
  id: string;
  description: string;
  executionStatus: DailyPlanOutcomeExecutionStatus;
  source: 'original' | 'replacement';
};

export type CarryForwardEligibleOutcome = {
  id: string;
  description: string;
  executionStatus: 'not_completed' | 'cancelled';
  source: 'original' | 'replacement';
  notCompletedReasonCategory: string | null;
  notCompletedExplanation: string | null;
};

export type DailyPlanReportSummary = {
  planStatus: DailyPlanStatus;
  originalPlannedCount: number;
  originalCompletedCount: number;
  originalNotCompletedCount: number;
  originalCancelledCount: number;
  originalUnresolvedCount: number;
  replacementAddedCount: number;
  replacementCompletedCount: number;
  replacementNotCompletedCount: number;
  replacementUnresolvedCount: number;
  changePlanCount: number;
  unresolvedOutcomes: UnresolvedPlanOutcome[];
  carryForwardEligible: CarryForwardEligibleOutcome[];
  readyForReportCompletion: boolean;
};

export type DailyPlanReportMatch =
  | { kind: 'none'; message: string }
  | { kind: 'draft'; plan: DailyPlanApi; message: string }
  | { kind: 'active'; plan: DailyPlanApi; summary: DailyPlanReportSummary }
  | { kind: 'completed'; plan: DailyPlanApi; summary: DailyPlanReportSummary };

function countByStatus(
  items: Array<{ executionStatus: DailyPlanOutcomeExecutionStatus }>,
  status: DailyPlanOutcomeExecutionStatus
): number {
  return items.filter((item) => item.executionStatus === status).length;
}

function unresolvedFrom(
  items: Array<DailyPlanOutcomeApi | DailyPlanReplacementOutcomeApi>,
  source: 'original' | 'replacement'
): UnresolvedPlanOutcome[] {
  return items
    .filter(
      (item) =>
        item.executionStatus === 'planned' || item.executionStatus === 'in_progress'
    )
    .map((item) => ({
      id: item.id,
      description: item.description,
      executionStatus: item.executionStatus,
      source,
    }));
}

function carryForwardEligibleFrom(
  items: Array<DailyPlanOutcomeApi | DailyPlanReplacementOutcomeApi>,
  source: 'original' | 'replacement'
): CarryForwardEligibleOutcome[] {
  return items
    .filter(
      (item) =>
        item.executionStatus === 'not_completed' || item.executionStatus === 'cancelled'
    )
    .map((item) => ({
      id: item.id,
      description: item.description,
      executionStatus: item.executionStatus as 'not_completed' | 'cancelled',
      source,
      notCompletedReasonCategory: item.notCompletedReasonCategory,
      notCompletedExplanation: item.notCompletedExplanation,
    }));
}

export function buildDailyPlanReportSummary(plan: DailyPlanApi): DailyPlanReportSummary {
  const originals = plan.outcomes;
  const replacements = plan.replacementOutcomes;
  const unresolvedOutcomes = [
    ...unresolvedFrom(originals, 'original'),
    ...unresolvedFrom(replacements, 'replacement'),
  ];
  const carryForwardEligible = [
    ...carryForwardEligibleFrom(originals, 'original'),
    ...carryForwardEligibleFrom(replacements, 'replacement'),
  ];

  return {
    planStatus: normalizeDailyPlanStatus(plan.status),
    originalPlannedCount: originals.length,
    originalCompletedCount: countByStatus(originals, 'completed'),
    originalNotCompletedCount: countByStatus(originals, 'not_completed'),
    originalCancelledCount: countByStatus(originals, 'cancelled'),
    originalUnresolvedCount: unresolvedFrom(originals, 'original').length,
    replacementAddedCount: replacements.length,
    replacementCompletedCount: countByStatus(replacements, 'completed'),
    replacementNotCompletedCount: countByStatus(replacements, 'not_completed'),
    replacementUnresolvedCount: unresolvedFrom(replacements, 'replacement').length,
    changePlanCount: plan.changes.length,
    unresolvedOutcomes,
    carryForwardEligible,
    readyForReportCompletion:
      normalizeDailyPlanStatus(plan.status) === 'active' && unresolvedOutcomes.length === 0,
  };
}

/** Match a Daily Plan to a report date for the same job (Melbourne calendar date). */
export function matchDailyPlanForReport(
  plan: DailyPlanApi | null | undefined,
  reportDate: string
): DailyPlanReportMatch {
  if (!plan) {
    return { kind: 'none', message: DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE };
  }
  if (plan.workDate !== reportDate) {
    return { kind: 'none', message: DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE };
  }
  const status = normalizeDailyPlanStatus(plan.status);
  if (status === 'draft') {
    return {
      kind: 'draft',
      plan,
      message: DAILY_PLAN_NOT_STARTED_FOR_REPORT_MESSAGE,
    };
  }
  const summary = buildDailyPlanReportSummary(plan);
  if (status === 'completed') {
    return { kind: 'completed', plan, summary };
  }
  return { kind: 'active', plan, summary };
}

export type CarryForwardInput = {
  outcomeId?: unknown;
  replacementOutcomeId?: unknown;
  carryForward?: unknown;
  note?: unknown;
};

export type ParsedCarryForward = {
  outcomeId: string | null;
  replacementOutcomeId: string | null;
  carryForward: boolean;
  note: string | null;
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function parseCarryForwardSelections(
  raw: unknown,
  eligible: CarryForwardEligibleOutcome[]
): { ok: true; data: ParsedCarryForward[] } | { ok: false; message: string } {
  if (raw == null) {
    return { ok: true, data: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Carry-forward selections must be a list' };
  }

  const eligibleIds = new Set(eligible.map((item) => `${item.source}:${item.id}`));
  const parsed: ParsedCarryForward[] = [];

  for (const item of raw as CarryForwardInput[]) {
    const outcomeRaw =
      item?.outcomeId == null || String(item.outcomeId).trim() === ''
        ? null
        : String(item.outcomeId).trim();
    const replacementRaw =
      item?.replacementOutcomeId == null || String(item.replacementOutcomeId).trim() === ''
        ? null
        : String(item.replacementOutcomeId).trim();

    if ((outcomeRaw && replacementRaw) || (!outcomeRaw && !replacementRaw)) {
      return { ok: false, message: 'Each carry-forward must reference exactly one outcome' };
    }
    if (outcomeRaw && !isValidUuid(outcomeRaw)) {
      return { ok: false, message: 'Carry-forward outcome is invalid' };
    }
    if (replacementRaw && !isValidUuid(replacementRaw)) {
      return { ok: false, message: 'Carry-forward replacement outcome is invalid' };
    }

    const key = outcomeRaw ? `original:${outcomeRaw}` : `replacement:${replacementRaw}`;
    if (!eligibleIds.has(key)) {
      return {
        ok: false,
        message: 'Carry-forward can only be set for not-completed or cancelled outcomes',
      };
    }

    const note = String(item?.note ?? '')
      .trim()
      .slice(0, 5000);
    parsed.push({
      outcomeId: outcomeRaw,
      replacementOutcomeId: replacementRaw,
      carryForward: item?.carryForward !== false && item?.carryForward !== 'false',
      note: note || null,
    });
  }

  return { ok: true, data: parsed };
}
