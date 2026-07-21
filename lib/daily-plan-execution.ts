/**
 * Phase 2C: outcome execution status transitions, not-completed reasons,
 * and Change Plan validation. Baseline upsert parsing stays in daily-plan-shared.
 */

import type { DailyPlanStatus } from '@/lib/daily-plan-shared';
import type { StaffRole } from '@/lib/staff-auth';

const MAX_FIELD_LENGTH = 5000;

export const DAILY_PLAN_OUTCOME_EXECUTION_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'not_completed',
  'cancelled',
] as const;

export type DailyPlanOutcomeExecutionStatus =
  (typeof DAILY_PLAN_OUTCOME_EXECUTION_STATUSES)[number];

/** Statuses that may be set via the dedicated status endpoint (not Change Plan). */
export const DAILY_PLAN_ORDINARY_STATUS_TARGETS = [
  'in_progress',
  'completed',
  'not_completed',
] as const;

export type DailyPlanOrdinaryStatusTarget =
  (typeof DAILY_PLAN_ORDINARY_STATUS_TARGETS)[number];

export const DAILY_PLAN_NOT_COMPLETED_REASON_CATEGORIES = [
  'underestimated_duration',
  'material_unavailable',
  'delivery_delay',
  'weather',
  'unexpected_site_condition',
  'client_decision',
  'inspection_or_approval_delay',
  'equipment_failure',
  'labour_or_staffing_issue',
  'quality_or_rework_issue',
  'changed_priority',
  'safety_issue',
  'other',
] as const;

export type DailyPlanNotCompletedReasonCategory =
  (typeof DAILY_PLAN_NOT_COMPLETED_REASON_CATEGORIES)[number];

export const DAILY_PLAN_CHANGE_TYPES = [
  'cancel_planned_outcome',
  'add_replacement_outcome',
  'change_crew_allocation',
  'change_material_requirement',
  'change_equipment_requirement',
  'change_work_sequence',
  'change_due_to_site_condition',
  'other',
] as const;

export type DailyPlanChangeType = (typeof DAILY_PLAN_CHANGE_TYPES)[number];

export const DAILY_PLAN_CHANGE_REASON_CATEGORIES = [
  'unexpected_site_condition',
  'weather',
  'client_decision',
  'material_or_delivery_issue',
  'equipment_issue',
  'labour_or_staffing_issue',
  'safety_issue',
  'inspection_or_approval_delay',
  'management_instruction',
  'supervisor_decision',
  'scope_clarification',
  'other',
] as const;

export type DailyPlanChangeReasonCategory =
  (typeof DAILY_PLAN_CHANGE_REASON_CATEGORIES)[number];

export const DAILY_PLAN_DECISION_MAKER_TYPES = [
  'current_supervisor',
  'staff_profile',
  'management',
  'client',
  'external_party',
  'other',
] as const;

export type DailyPlanDecisionMakerType =
  (typeof DAILY_PLAN_DECISION_MAKER_TYPES)[number];

export const DAILY_PLAN_STATUS_CONFLICT_MESSAGE =
  'This outcome was updated by another user. The latest plan has been reloaded.';

export const DAILY_PLAN_NOT_ACTIVE_FOR_EXECUTION_MESSAGE =
  'Outcome status can only be updated on an active Daily Plan';

export const DAILY_PLAN_NOT_ACTIVE_FOR_CHANGE_MESSAGE =
  'Plan changes can only be recorded on an active Daily Plan';

export const DAILY_PLAN_CANCEL_REQUIRES_CHANGE_MESSAGE =
  'Cancellation requires a Change Plan record';

export const NOT_COMPLETED_CONFIRM_TITLE = 'Mark this outcome as not completed?';

export const NOT_COMPLETED_CONFIRM_BODY =
  "This result will remain in the day's execution history.";

export const CANCEL_OUTCOME_CONFIRM_TITLE = 'Cancel this planned outcome?';

export const CANCEL_OUTCOME_CONFIRM_BODY =
  'The original outcome will remain visible and the reason will be recorded.';

export const CHANGE_PLAN_CONFIRM_TITLE = 'Submit this plan change?';

export const CHANGE_PLAN_CONFIRM_BODY =
  "The original baseline will stay locked. This change will be recorded in today's history.";

const ALLOWED_ORDINARY_TRANSITIONS: Record<
  DailyPlanOutcomeExecutionStatus,
  readonly DailyPlanOrdinaryStatusTarget[]
> = {
  planned: ['in_progress', 'completed', 'not_completed'],
  in_progress: ['completed', 'not_completed'],
  completed: [],
  not_completed: [],
  cancelled: [],
};

export function canUpdateDailyPlanExecution(
  role: StaffRole,
  status: DailyPlanStatus
): boolean {
  return (role === 'supervisor' || role === 'admin') && status === 'active';
}

export function normalizeOutcomeExecutionStatus(
  value: unknown
): DailyPlanOutcomeExecutionStatus {
  if (
    typeof value === 'string' &&
    (DAILY_PLAN_OUTCOME_EXECUTION_STATUSES as readonly string[]).includes(value)
  ) {
    return value as DailyPlanOutcomeExecutionStatus;
  }
  return 'planned';
}

export function isAllowedOrdinaryStatusTransition(
  from: DailyPlanOutcomeExecutionStatus,
  to: DailyPlanOutcomeExecutionStatus
): boolean {
  if (to === 'cancelled') return false;
  if (!(DAILY_PLAN_ORDINARY_STATUS_TARGETS as readonly string[]).includes(to)) {
    return false;
  }
  return ALLOWED_ORDINARY_TRANSITIONS[from].includes(
    to as DailyPlanOrdinaryStatusTarget
  );
}

export function outcomeExecutionStatusLabel(
  status: DailyPlanOutcomeExecutionStatus
): string {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'not_completed':
      return 'Not completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function notCompletedReasonLabel(
  category: DailyPlanNotCompletedReasonCategory
): string {
  const labels: Record<DailyPlanNotCompletedReasonCategory, string> = {
    underestimated_duration: 'Underestimated duration',
    material_unavailable: 'Material unavailable',
    delivery_delay: 'Delivery delay',
    weather: 'Weather',
    unexpected_site_condition: 'Unexpected site condition',
    client_decision: 'Client decision',
    inspection_or_approval_delay: 'Inspection or approval delay',
    equipment_failure: 'Equipment failure',
    labour_or_staffing_issue: 'Labour or staffing issue',
    quality_or_rework_issue: 'Quality or rework issue',
    changed_priority: 'Changed priority',
    safety_issue: 'Safety issue',
    other: 'Other',
  };
  return labels[category] ?? category;
}

export function changeTypeLabel(changeType: DailyPlanChangeType): string {
  const labels: Record<DailyPlanChangeType, string> = {
    cancel_planned_outcome: 'Cancel planned outcome',
    add_replacement_outcome: 'Add replacement outcome',
    change_crew_allocation: 'Change crew allocation',
    change_material_requirement: 'Change material requirement',
    change_equipment_requirement: 'Change equipment requirement',
    change_work_sequence: 'Change work sequence',
    change_due_to_site_condition: 'Change due to site condition',
    other: 'Other',
  };
  return labels[changeType] ?? changeType;
}

export function changeReasonLabel(category: DailyPlanChangeReasonCategory): string {
  const labels: Record<DailyPlanChangeReasonCategory, string> = {
    unexpected_site_condition: 'Unexpected site condition',
    weather: 'Weather',
    client_decision: 'Client decision',
    material_or_delivery_issue: 'Material or delivery issue',
    equipment_issue: 'Equipment issue',
    labour_or_staffing_issue: 'Labour or staffing issue',
    safety_issue: 'Safety issue',
    inspection_or_approval_delay: 'Inspection or approval delay',
    management_instruction: 'Management instruction',
    supervisor_decision: 'Supervisor decision',
    scope_clarification: 'Scope clarification',
    other: 'Other',
  };
  return labels[category] ?? category;
}

export function decisionMakerTypeLabel(type: DailyPlanDecisionMakerType): string {
  const labels: Record<DailyPlanDecisionMakerType, string> = {
    current_supervisor: 'Current supervisor',
    staff_profile: 'Staff member',
    management: 'Management',
    client: 'Client',
    external_party: 'External party',
    other: 'Other',
  };
  return labels[type] ?? type;
}

function trimField(value: unknown, maxLen = MAX_FIELD_LENGTH): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxLen);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

export type ParsedOutcomeStatusUpdate = {
  expectedFromStatus: DailyPlanOutcomeExecutionStatus;
  toStatus: DailyPlanOrdinaryStatusTarget;
  completionNote: string | null;
  notCompletedReasonCategory: DailyPlanNotCompletedReasonCategory | null;
  notCompletedExplanation: string | null;
};

export type OutcomeStatusUpdateInput = {
  expectedFromStatus?: unknown;
  toStatus?: unknown;
  completionNote?: unknown;
  notCompletedReasonCategory?: unknown;
  notCompletedExplanation?: unknown;
};

export function parseOutcomeStatusUpdate(
  body: OutcomeStatusUpdateInput
): { ok: true; data: ParsedOutcomeStatusUpdate } | { ok: false; message: string } {
  const fromRaw = trimField(body.expectedFromStatus, 64);
  const toRaw = trimField(body.toStatus, 64);

  if (!fromRaw || !isOneOf(fromRaw, DAILY_PLAN_OUTCOME_EXECUTION_STATUSES)) {
    return { ok: false, message: 'Current outcome status is required' };
  }
  if (toRaw === 'cancelled') {
    return { ok: false, message: DAILY_PLAN_CANCEL_REQUIRES_CHANGE_MESSAGE };
  }
  if (!toRaw || !isOneOf(toRaw, DAILY_PLAN_ORDINARY_STATUS_TARGETS)) {
    return { ok: false, message: 'Target status is invalid' };
  }
  if (!isAllowedOrdinaryStatusTransition(fromRaw, toRaw)) {
    return {
      ok: false,
      message: `Cannot change outcome status from ${outcomeExecutionStatusLabel(fromRaw)} to ${outcomeExecutionStatusLabel(toRaw)}`,
    };
  }

  let completionNote: string | null = null;
  let notCompletedReasonCategory: DailyPlanNotCompletedReasonCategory | null = null;
  let notCompletedExplanation: string | null = null;

  if (toRaw === 'completed') {
    const note = trimField(body.completionNote, 500);
    completionNote = note || null;
  }

  if (toRaw === 'not_completed') {
    const reasonRaw = trimField(body.notCompletedReasonCategory, 64);
    if (!reasonRaw || !isOneOf(reasonRaw, DAILY_PLAN_NOT_COMPLETED_REASON_CATEGORIES)) {
      return { ok: false, message: 'Not-completed reason category is required' };
    }
    const explanation = trimField(body.notCompletedExplanation);
    if (!explanation) {
      return { ok: false, message: 'Explain what occurred' };
    }
    if (reasonRaw === 'other' && explanation.length < 3) {
      return { ok: false, message: 'Provide a clear explanation when selecting Other' };
    }
    notCompletedReasonCategory = reasonRaw;
    notCompletedExplanation = explanation;
  }

  return {
    ok: true,
    data: {
      expectedFromStatus: fromRaw,
      toStatus: toRaw,
      completionNote,
      notCompletedReasonCategory,
      notCompletedExplanation,
    },
  };
}

export type ParsedPlanChange = {
  changeType: DailyPlanChangeType;
  reasonCategory: DailyPlanChangeReasonCategory;
  whatChanged: string;
  whyChanged: string;
  affectedOutcomeId: string | null;
  decisionMakerType: DailyPlanDecisionMakerType;
  decisionMakerStaffProfileId: string | null;
  decisionMakerLabel: string | null;
  impactToday: string;
  programmeImpact: string | null;
  replacementDescription: string | null;
};

export type PlanChangeInput = {
  changeType?: unknown;
  reasonCategory?: unknown;
  whatChanged?: unknown;
  whyChanged?: unknown;
  affectedOutcomeId?: unknown;
  decisionMakerType?: unknown;
  decisionMakerStaffProfileId?: unknown;
  decisionMakerLabel?: unknown;
  impactToday?: unknown;
  programmeImpact?: unknown;
  replacementDescription?: unknown;
};

export function parsePlanChangeBody(
  body: PlanChangeInput
): { ok: true; data: ParsedPlanChange } | { ok: false; message: string } {
  const changeTypeRaw = trimField(body.changeType, 64);
  if (!changeTypeRaw || !isOneOf(changeTypeRaw, DAILY_PLAN_CHANGE_TYPES)) {
    return { ok: false, message: 'Change type is required' };
  }

  const reasonRaw = trimField(body.reasonCategory, 64);
  if (!reasonRaw || !isOneOf(reasonRaw, DAILY_PLAN_CHANGE_REASON_CATEGORIES)) {
    return { ok: false, message: 'Reason category is required' };
  }

  const whatChanged = trimField(body.whatChanged);
  if (!whatChanged) {
    return { ok: false, message: 'Describe what changed' };
  }

  const whyChanged = trimField(body.whyChanged);
  if (!whyChanged) {
    return { ok: false, message: 'Explain why it changed' };
  }
  if (reasonRaw === 'other' && whyChanged.length < 3) {
    return { ok: false, message: 'Provide a clear explanation when selecting Other' };
  }

  const impactToday = trimField(body.impactToday);
  if (!impactToday) {
    return { ok: false, message: "Describe the impact on today's work" };
  }

  const programmeImpactRaw = trimField(body.programmeImpact);
  const programmeImpact = programmeImpactRaw || null;

  const decisionMakerTypeRaw = trimField(body.decisionMakerType, 64);
  if (
    !decisionMakerTypeRaw ||
    !isOneOf(decisionMakerTypeRaw, DAILY_PLAN_DECISION_MAKER_TYPES)
  ) {
    return { ok: false, message: 'Operational decision maker is required' };
  }

  let decisionMakerStaffProfileId: string | null = null;
  let decisionMakerLabel: string | null = null;

  if (decisionMakerTypeRaw === 'current_supervisor') {
    const staffRaw = trimField(body.decisionMakerStaffProfileId, 64);
    if (staffRaw) {
      if (!isValidUuid(staffRaw)) {
        return { ok: false, message: 'Decision maker staff reference is invalid' };
      }
      decisionMakerStaffProfileId = staffRaw;
    }
    const label = trimField(body.decisionMakerLabel, 200);
    decisionMakerLabel = label || null;
  } else if (decisionMakerTypeRaw === 'staff_profile') {
    const staffRaw = trimField(body.decisionMakerStaffProfileId, 64);
    const label = trimField(body.decisionMakerLabel, 200);
    if (staffRaw) {
      if (!isValidUuid(staffRaw)) {
        return { ok: false, message: 'Decision maker staff reference is invalid' };
      }
      decisionMakerStaffProfileId = staffRaw;
    }
    if (!decisionMakerStaffProfileId && !label) {
      return {
        ok: false,
        message: 'Name the staff member who made the decision',
      };
    }
    decisionMakerLabel = label || null;
  } else if (decisionMakerTypeRaw === 'management') {
    const staffRaw = trimField(body.decisionMakerStaffProfileId, 64);
    if (staffRaw) {
      if (!isValidUuid(staffRaw)) {
        return { ok: false, message: 'Decision maker staff reference is invalid' };
      }
      decisionMakerStaffProfileId = staffRaw;
    }
    const label = trimField(body.decisionMakerLabel, 200);
    decisionMakerLabel = label || null;
  } else {
    const label = trimField(body.decisionMakerLabel, 200);
    if (!label) {
      return {
        ok: false,
        message: 'Describe who made the operational decision',
      };
    }
    decisionMakerLabel = label;
  }

  let affectedOutcomeId: string | null = null;
  const affectedRaw = trimField(body.affectedOutcomeId, 64);
  if (affectedRaw) {
    if (!isValidUuid(affectedRaw)) {
      return { ok: false, message: 'Affected outcome is invalid' };
    }
    affectedOutcomeId = affectedRaw;
  }

  if (changeTypeRaw === 'cancel_planned_outcome' && !affectedOutcomeId) {
    return { ok: false, message: 'Select the planned outcome to cancel' };
  }

  const replacementDescription = trimField(body.replacementDescription) || null;
  if (changeTypeRaw === 'add_replacement_outcome' && !replacementDescription) {
    return { ok: false, message: 'Replacement work description is required' };
  }

  // Crew / equipment / material / sequence changes require what + reason + impact (already enforced).
  return {
    ok: true,
    data: {
      changeType: changeTypeRaw,
      reasonCategory: reasonRaw,
      whatChanged,
      whyChanged,
      affectedOutcomeId,
      decisionMakerType: decisionMakerTypeRaw,
      decisionMakerStaffProfileId,
      decisionMakerLabel,
      impactToday,
      programmeImpact,
      replacementDescription,
    },
  };
}
