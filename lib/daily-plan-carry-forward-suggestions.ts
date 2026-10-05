/**
 * Phase 2F: Plan Tomorrow from Carry-Forward — pure helpers and types.
 * Suggestions are planning prompts; nothing is auto-inserted into a Daily Plan.
 */

import {
  compareWorkDates,
  DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE,
  DAILY_PLAN_MAX_OUTCOMES,
  DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE,
} from '@/lib/daily-plan-shared';
import { formatAustralianCalendarDate } from '@/lib/australian-date';
import type { DailyPlanOutcomeExecutionStatus } from '@/lib/daily-plan-execution';
import { nextCalendarDate } from '@/lib/report-date';

export type CarryForwardSuggestionSourceType = 'original' | 'replacement';

export type CarryForwardPriorUse = {
  planId: string;
  workDate: string;
};

export type CarryForwardSuggestionItem = {
  carryForwardId: string;
  description: string;
  sourceType: CarryForwardSuggestionSourceType;
  sourceWorkDate: string;
  sourcePlanId: string;
  executionStatus: DailyPlanOutcomeExecutionStatus;
  carryForwardNote: string | null;
  alreadyUsedIn: CarryForwardPriorUse | null;
};

export type CarryForwardSuggestionsEmptyReason =
  | 'no_completed_prior_plan'
  | 'no_carry_forward_work'
  | 'all_already_included';

export type CarryForwardSuggestionsPayload = {
  sourcePlanId: string | null;
  sourceWorkDate: string | null;
  notesForTomorrow: string | null;
  completedDailySiteUpdateId: string | null;
  suggestions: CarryForwardSuggestionItem[];
  emptyReason: CarryForwardSuggestionEmptyReason | null;
};

/** Alias kept for clarity in emptyReason typing. */
export type CarryForwardSuggestionEmptyReason = CarryForwardSuggestionsEmptyReason;

export const CARRY_FORWARD_NO_PRIOR_PLAN_MESSAGE =
  'No previous completed Daily Plan was found.';

export const CARRY_FORWARD_NO_WORK_MESSAGE = 'No carry-forward work was recorded.';

export const CARRY_FORWARD_ALL_INCLUDED_MESSAGE =
  'All available carry-forward items are already included in this draft.';

export const CARRY_FORWARD_LOAD_FAILED_MESSAGE =
  'Carry-forward suggestions could not be loaded. You can still plan manually.';

export function nextMelbourneWorkDate(workDate: string): string | null {
  return nextCalendarDate(workDate);
}

export function availableOutcomeSlots(currentOutcomeCount: number): number {
  return Math.max(0, DAILY_PLAN_MAX_OUTCOMES - currentOutcomeCount);
}

export function canAddCarryForwardSuggestion(input: {
  currentOutcomeCount: number;
  includedCarryForwardIds: Iterable<string>;
  suggestionCarryForwardId: string;
}): { ok: true } | { ok: false; message: string } {
  if (availableOutcomeSlots(input.currentOutcomeCount) <= 0) {
    return { ok: false, message: DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE };
  }
  for (const id of input.includedCarryForwardIds) {
    if (id === input.suggestionCarryForwardId) {
      return { ok: false, message: 'This carry-forward item is already included in this draft.' };
    }
  }
  return { ok: true };
}

export function priorUseLabel(prior: CarryForwardPriorUse | null): string | null {
  if (!prior) return null;
  return `Already used in ${formatFriendlyWorkDate(prior.workDate)}'s plan`;
}

/** Soft weekday-friendly label for Melbourne YYYY-MM-DD (no locale dependency on TZ). */
export function formatFriendlyWorkDate(workDate: string): string {
  return formatAustralianCalendarDate(workDate, workDate);
}

export function appendNotesForTomorrow(
  existingGeneralNotes: string,
  notesForTomorrow: string
): string {
  const notes = notesForTomorrow.trim();
  if (!notes) return existingGeneralNotes;
  const existing = existingGeneralNotes.trim();
  if (!existing) return notes;
  if (existing.includes(notes)) return existingGeneralNotes;
  return `${existing}\n\n${notes}`;
}

export function filterUnusedSuggestions(
  suggestions: CarryForwardSuggestionItem[],
  includedCarryForwardIds: Iterable<string>
): CarryForwardSuggestionItem[] {
  const included = new Set(includedCarryForwardIds);
  return suggestions.filter((s) => !included.has(s.carryForwardId));
}

export function resolveSuggestionsEmptyReason(input: {
  sourcePlanId: string | null;
  yesCarryForwardCount: number;
  unusedSuggestionCount: number;
}): CarryForwardSuggestionEmptyReason | null {
  if (!input.sourcePlanId) return 'no_completed_prior_plan';
  if (input.yesCarryForwardCount === 0) return 'no_carry_forward_work';
  if (input.unusedSuggestionCount === 0) return 'all_already_included';
  return null;
}

export function emptyReasonMessage(
  reason: CarryForwardSuggestionEmptyReason | null
): string | null {
  if (reason === 'no_completed_prior_plan') return CARRY_FORWARD_NO_PRIOR_PLAN_MESSAGE;
  if (reason === 'no_carry_forward_work') return CARRY_FORWARD_NO_WORK_MESSAGE;
  if (reason === 'all_already_included') return CARRY_FORWARD_ALL_INCLUDED_MESSAGE;
  return null;
}

/**
 * Pure source-plan selection rule: latest completed plan with work_date < target.
 * Callers pass already-filtered completed plans for the same job.
 */
export function selectLatestCompletedSourcePlan<T extends { workDate: string; status: string }>(
  plans: T[],
  targetWorkDate: string
): T | null {
  const eligible = plans.filter(
    (p) => p.status === 'completed' && compareWorkDates(p.workDate, targetWorkDate) < 0
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => compareWorkDates(b.workDate, a.workDate));
  return eligible[0] ?? null;
}

export type SourceCarryForwardValidationRow = {
  id: string;
  daily_plan_id: string;
  job_id: string;
  organisation_id: string;
  work_date: string;
  carry_forward: boolean;
  outcome_id: string | null;
  replacement_outcome_id: string | null;
};

export type PriorUseRow = {
  source_carry_forward_id: string;
  plan_id: string;
  work_date: string;
};

/**
 * Validate optional source carry-forward IDs for draft outcomes.
 * Does not mutate historical source records.
 */
export function validateSourceCarryForwardLinks(input: {
  targetJobId: string;
  targetOrganisationId: string;
  targetWorkDate: string;
  /** Current draft plan id when editing; excluded from prior-use checks. */
  excludePlanId?: string | null;
  outcomes: Array<{ sourceCarryForwardId: string | null }>;
  confirmDuplicateCarryForwardIds: string[];
  sourceRows: SourceCarryForwardValidationRow[];
  priorUses: PriorUseRow[];
}):
  | { ok: true }
  | { ok: false; message: string; code?: 'DUPLICATE_CARRY_FORWARD'; needsConfirmationIds?: string[] } {
  const byId = new Map(input.sourceRows.map((r) => [r.id, r]));
  const confirmed = new Set(input.confirmDuplicateCarryForwardIds);
  const needsConfirmation: string[] = [];

  for (const outcome of input.outcomes) {
    const sourceId = outcome.sourceCarryForwardId;
    if (!sourceId) continue;

    const row = byId.get(sourceId);
    if (!row) {
      return { ok: false, message: 'Carry-forward source was not found' };
    }
    if (row.organisation_id !== input.targetOrganisationId) {
      return { ok: false, message: 'Carry-forward source is not in this organisation' };
    }
    if (row.job_id !== input.targetJobId) {
      return { ok: false, message: 'Carry-forward source belongs to another project' };
    }
    if (!row.carry_forward) {
      return { ok: false, message: 'That item was marked not to carry forward' };
    }
    if (compareWorkDates(row.work_date, input.targetWorkDate) >= 0) {
      return { ok: false, message: 'Carry-forward source must be from an earlier work date' };
    }
    const hasOriginal = Boolean(row.outcome_id);
    const hasReplacement = Boolean(row.replacement_outcome_id);
    if (hasOriginal === hasReplacement) {
      return { ok: false, message: 'Carry-forward source is invalid' };
    }

    const prior = input.priorUses.find(
      (p) =>
        p.source_carry_forward_id === sourceId &&
        p.plan_id !== input.excludePlanId &&
        compareWorkDates(p.work_date, row.work_date) > 0
    );
    if (prior && !confirmed.has(sourceId)) {
      needsConfirmation.push(sourceId);
    }
  }

  if (needsConfirmation.length > 0) {
    return {
      ok: false,
      message: DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE,
      code: 'DUPLICATE_CARRY_FORWARD',
      needsConfirmationIds: needsConfirmation,
    };
  }

  return { ok: true };
}

export function buildSuggestionItems(input: {
  sourcePlanId: string;
  sourceWorkDate: string;
  carryForwards: Array<{
    id: string;
    carry_forward: boolean;
    note: string | null;
    outcome_id: string | null;
    replacement_outcome_id: string | null;
  }>;
  outcomes: Array<{
    id: string;
    description: string;
    execution_status: string;
  }>;
  replacements: Array<{
    id: string;
    description: string;
    execution_status: string;
  }>;
  priorUses: PriorUseRow[];
}): CarryForwardSuggestionItem[] {
  const outcomeById = new Map(input.outcomes.map((o) => [o.id, o]));
  const replacementById = new Map(input.replacements.map((o) => [o.id, o]));
  const items: CarryForwardSuggestionItem[] = [];

  for (const cf of input.carryForwards) {
    if (!cf.carry_forward) continue;

    let description: string | null = null;
    let sourceType: CarryForwardSuggestionSourceType | null = null;
    let executionStatus: DailyPlanOutcomeExecutionStatus = 'not_completed';

    if (cf.outcome_id) {
      const outcome = outcomeById.get(cf.outcome_id);
      if (!outcome) continue;
      description = outcome.description;
      sourceType = 'original';
      executionStatus = normalizeSuggestionStatus(outcome.execution_status);
    } else if (cf.replacement_outcome_id) {
      const replacement = replacementById.get(cf.replacement_outcome_id);
      if (!replacement) continue;
      description = replacement.description;
      sourceType = 'replacement';
      executionStatus = normalizeSuggestionStatus(replacement.execution_status);
    } else {
      continue;
    }

    const prior = input.priorUses
      .filter((p) => p.source_carry_forward_id === cf.id)
      .sort((a, b) => compareWorkDates(b.work_date, a.work_date))[0];

    items.push({
      carryForwardId: cf.id,
      description,
      sourceType,
      sourceWorkDate: input.sourceWorkDate,
      sourcePlanId: input.sourcePlanId,
      executionStatus,
      carryForwardNote: cf.note,
      alreadyUsedIn: prior
        ? { planId: prior.plan_id, workDate: prior.work_date }
        : null,
    });
  }

  return items;
}

function normalizeSuggestionStatus(value: string): DailyPlanOutcomeExecutionStatus {
  if (
    value === 'planned' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'not_completed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return 'not_completed';
}

export function sourceTypeLabel(sourceType: CarryForwardSuggestionSourceType): string {
  return sourceType === 'replacement' ? 'Replacement work' : 'Original planned outcome';
}
