import {
  DEFAULT_REPORT_TIMEZONE,
  formatReportDateInTimezone,
  isValidReportDate,
  todayReportDate,
} from '@/lib/report-date';
import type { StaffRole } from '@/lib/staff-auth';
import {
  canUpdateDailyPlanExecution,
  normalizeOutcomeExecutionStatus,
  type DailyPlanChangeReasonCategory,
  type DailyPlanChangeType,
  type DailyPlanDecisionMakerType,
  type DailyPlanNotCompletedReasonCategory,
  type DailyPlanOutcomeExecutionStatus,
} from '@/lib/daily-plan-execution';

export const DAILY_PLAN_MAX_FIELD_LENGTH = 5000;
export const DAILY_PLAN_MAX_OUTCOMES = 3;
export const DAILY_PLAN_MIN_OUTCOMES = 1;
export const DAILY_PLAN_WORK_TIMEZONE = DEFAULT_REPORT_TIMEZONE;

export type DailyPlanOutcomeInput = {
  description?: unknown;
  /** Optional link to a prior-day carry-forward record (Phase 2F). */
  sourceCarryForwardId?: unknown;
};

export type DailyPlanCrewResponsibilityInput = {
  crewMemberName?: unknown;
  responsibility?: unknown;
  staffProfileId?: unknown;
};

export type DailyPlanMaterialInput = {
  description?: unknown;
  quantity?: unknown;
};

export type DailyPlanEquipmentInput = {
  description?: unknown;
};

export type DailyPlanUpsertInput = {
  workDate?: unknown;
  supervisorStaffProfileId?: unknown;
  outcomes?: unknown;
  crewResponsibilities?: unknown;
  materials?: unknown;
  equipment?: unknown;
  risksConstraints?: unknown;
  contingencyPlan?: unknown;
  generalNotes?: unknown;
  /**
   * Carry-forward IDs the supervisor has explicitly confirmed for reuse
   * when they were already linked in another later Daily Plan.
   */
  confirmDuplicateCarryForwardIds?: unknown;
};

export type ParsedDailyPlanOutcome = {
  description: string;
  displayOrder: number;
  sourceCarryForwardId: string | null;
};

export type ParsedDailyPlanCrewResponsibility = {
  crewMemberName: string;
  responsibility: string;
  staffProfileId: string | null;
  displayOrder: number;
};

export type ParsedDailyPlanMaterial = {
  description: string;
  quantity: string | null;
  displayOrder: number;
};

export type ParsedDailyPlanEquipment = {
  description: string;
  displayOrder: number;
};

export type ParsedDailyPlanUpsert = {
  workDate: string;
  supervisorStaffProfileId: string | null;
  outcomes: ParsedDailyPlanOutcome[];
  crewResponsibilities: ParsedDailyPlanCrewResponsibility[];
  materials: ParsedDailyPlanMaterial[];
  equipment: ParsedDailyPlanEquipment[];
  risksConstraints: string | null;
  contingencyPlan: string | null;
  generalNotes: string | null;
  confirmDuplicateCarryForwardIds: string[];
};

export type DailyPlanOutcomeApi = {
  id: string;
  description: string;
  displayOrder: number;
  /** Traceability to a prior carry-forward; null for manual outcomes. */
  sourceCarryForwardId: string | null;
  executionStatus: DailyPlanOutcomeExecutionStatus;
  statusUpdatedByStaffProfileId: string | null;
  statusUpdatedByName: string | null;
  statusUpdatedAt: string | null;
  completionNote: string | null;
  notCompletedReasonCategory: DailyPlanNotCompletedReasonCategory | null;
  notCompletedExplanation: string | null;
  completedByStaffProfileId: string | null;
  completedByName: string | null;
  completedAt: string | null;
};

export type DailyPlanReplacementOutcomeApi = {
  id: string;
  planChangeId: string;
  description: string;
  executionStatus: DailyPlanOutcomeExecutionStatus;
  statusUpdatedByStaffProfileId: string | null;
  statusUpdatedByName: string | null;
  statusUpdatedAt: string | null;
  completionNote: string | null;
  notCompletedReasonCategory: DailyPlanNotCompletedReasonCategory | null;
  notCompletedExplanation: string | null;
  completedByStaffProfileId: string | null;
  completedByName: string | null;
  completedAt: string | null;
  createdByStaffProfileId: string;
  createdByName: string;
  createdAt: string;
};

export type DailyPlanChangeApi = {
  id: string;
  changeType: DailyPlanChangeType;
  reasonCategory: DailyPlanChangeReasonCategory;
  whatChanged: string;
  whyChanged: string;
  affectedOutcomeId: string | null;
  decisionMakerType: DailyPlanDecisionMakerType;
  decisionMakerStaffProfileId: string | null;
  decisionMakerName: string | null;
  decisionMakerLabel: string | null;
  impactToday: string;
  programmeImpact: string | null;
  recordedByStaffProfileId: string;
  recordedByName: string;
  createdAt: string;
  replacementOutcomeIds: string[];
};

export type DailyPlanOutcomeEventApi = {
  id: string;
  outcomeId: string | null;
  replacementOutcomeId: string | null;
  eventType: 'status_changed';
  fromStatus: DailyPlanOutcomeExecutionStatus;
  toStatus: DailyPlanOutcomeExecutionStatus;
  completionNote: string | null;
  notCompletedReasonCategory: DailyPlanNotCompletedReasonCategory | null;
  notCompletedExplanation: string | null;
  actorStaffProfileId: string;
  actorName: string;
  createdAt: string;
};

export type DailyPlanCrewResponsibilityApi = {
  id: string;
  crewMemberName: string;
  responsibility: string;
  staffProfileId: string | null;
  displayOrder: number;
};

export type DailyPlanMaterialApi = {
  id: string;
  description: string;
  quantity: string | null;
  displayOrder: number;
};

export type DailyPlanEquipmentApi = {
  id: string;
  description: string;
  displayOrder: number;
};

export type DailyPlanStatus = 'draft' | 'active' | 'completed';

export type DailyPlanApi = {
  id: string;
  jobId: string;
  workDate: string;
  workTimezone: string;
  status: DailyPlanStatus;
  supervisorStaffProfileId: string;
  supervisorName: string;
  createdByStaffProfileId: string;
  createdByName: string;
  startedByStaffProfileId: string | null;
  startedByName: string | null;
  startedAt: string | null;
  completedByStaffProfileId: string | null;
  completedByName: string | null;
  completedAt: string | null;
  completedDailySiteUpdateId: string | null;
  risksConstraints: string | null;
  contingencyPlan: string | null;
  generalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  outcomes: DailyPlanOutcomeApi[];
  crewResponsibilities: DailyPlanCrewResponsibilityApi[];
  materials: DailyPlanMaterialApi[];
  equipment: DailyPlanEquipmentApi[];
  replacementOutcomes: DailyPlanReplacementOutcomeApi[];
  changes: DailyPlanChangeApi[];
  outcomeEvents: DailyPlanOutcomeEventApi[];
  carryForwards: DailyPlanCarryForwardApi[];
  /** True when the viewer may edit baseline fields (draft + edit role). */
  canEdit: boolean;
  /** True when the viewer may start this draft plan today in Melbourne. */
  canStartDay: boolean;
  /** True when the viewer may update execution / submit Change Plan on an active plan. */
  canUpdateExecution: boolean;
};

export type DailyPlanCarryForwardApi = {
  id: string;
  outcomeId: string | null;
  replacementOutcomeId: string | null;
  carryForward: boolean;
  note: string | null;
  recordedByStaffProfileId: string;
  recordedByName: string;
  recordedAt: string;
};

export type DailyPlanDbRow = {
  id: string;
  job_id: string;
  work_date: string;
  work_timezone: string;
  status: DailyPlanStatus;
  supervisor_staff_profile_id: string;
  created_by_staff_profile_id: string;
  started_by_staff_profile_id: string | null;
  started_at: string | null;
  completed_by_staff_profile_id?: string | null;
  completed_at?: string | null;
  completed_daily_site_update_id?: string | null;
  risks_constraints: string | null;
  contingency_plan: string | null;
  general_notes: string | null;
  created_at: string;
  updated_at: string;
  supervisor?: { full_name: string } | { full_name: string }[] | null;
  created_by?: { full_name: string } | { full_name: string }[] | null;
  started_by?: { full_name: string } | { full_name: string }[] | null;
  completed_by?: { full_name: string } | { full_name: string }[] | null;
};

export type DailyPlanUiState = {
  status: DailyPlanStatus;
  showEdit: boolean;
  showStartDay: boolean;
  isFutureDraft: boolean;
  isPastUnstartedDraft: boolean;
  isBaselineLocked: boolean;
  statusLabel: string;
  supportingMessage: string | null;
};

function trimField(value: unknown, maxLen = DAILY_PLAN_MAX_FIELD_LENGTH): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxLen);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/** Compare YYYY-MM-DD calendar strings lexicographically (safe for ISO dates). */
export function compareWorkDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isWorkDateTodayOrFuture(
  workDate: string,
  timeZone: string = DAILY_PLAN_WORK_TIMEZONE,
  now: Date = new Date()
): boolean {
  if (!isValidReportDate(workDate)) return false;
  const today = formatReportDateInTimezone(now, timeZone);
  return compareWorkDates(workDate, today) >= 0;
}

/** True when the stored work date equals today in Australia/Melbourne (or given TZ). */
export function isWorkDateToday(
  workDate: string,
  timeZone: string = DAILY_PLAN_WORK_TIMEZONE,
  now: Date = new Date()
): boolean {
  if (!isValidReportDate(workDate)) return false;
  const today = formatReportDateInTimezone(now, timeZone);
  return compareWorkDates(workDate, today) === 0;
}

export function normalizeDailyPlanStatus(value: unknown): DailyPlanStatus {
  if (value === 'active') return 'active';
  if (value === 'completed') return 'completed';
  return 'draft';
}

export function canViewDailyPlan(role: StaffRole): boolean {
  return role === 'field' || role === 'supervisor' || role === 'admin';
}

export function canEditDailyPlan(role: StaffRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

/** Role may edit baseline fields only while the plan is still a draft. */
export function canEditDailyPlanBaseline(role: StaffRole, status: DailyPlanStatus): boolean {
  return canEditDailyPlan(role) && status === 'draft';
}

export function canStartDailyPlan(input: {
  status: DailyPlanStatus;
  workDate: string;
  role: StaffRole;
  timeZone?: string;
  now?: Date;
}): boolean {
  if (!canEditDailyPlan(input.role)) return false;
  if (input.status !== 'draft') return false;
  return isWorkDateToday(input.workDate, input.timeZone ?? DAILY_PLAN_WORK_TIMEZONE, input.now);
}

export function duplicateDailyPlanMessage(existingPlanId?: string | null): string {
  if (existingPlanId) {
    return `A Daily Plan already exists for this project and date. Open the existing plan to edit it.`;
  }
  return 'A Daily Plan already exists for this project and date.';
}

export const DAILY_PLAN_BASELINE_LOCKED_MESSAGE =
  'This Daily Plan has been started and its baseline is locked. It cannot be edited.';

export const DAILY_PLAN_ALREADY_ACTIVE_MESSAGE =
  'This Daily Plan has already been started.';

export const DAILY_PLAN_SAVED_MESSAGE = 'Daily Plan saved.';

export const DAILY_PLAN_UPDATED_MESSAGE = 'Daily Plan updated.';

export const DAILY_PLAN_DAY_STARTED_MESSAGE =
  'Day started. The original plan is now locked.';

export const DAILY_PLAN_OUTCOME_UPDATED_MESSAGE = 'Outcome updated.';

export const DAILY_PLAN_CHANGE_RECORDED_MESSAGE = 'Plan change recorded.';

export const DAILY_PLAN_REPLACEMENT_ADDED_MESSAGE =
  'Plan change recorded. Replacement work added.';

export const DAILY_PLAN_CARRY_FORWARD_ADDED_MESSAGE =
  'Carry-forward item added to draft.';

export const DAILY_PLAN_NEXT_SAVED_MESSAGE = 'Next Daily Plan saved.';

export const DAILY_PLAN_START_FUTURE_MESSAGE =
  'This plan can only be started on its work date.';

export const DAILY_PLAN_START_PAST_MESSAGE =
  'This plan was not started on its scheduled work date and cannot be started now.';

export const DAILY_PLAN_ACTIVE_LOCKED_UI_MESSAGE =
  'This Daily Plan has started. The original plan is locked.';

export const DAILY_PLAN_COMPLETED_UI_MESSAGE =
  'This Daily Plan has been completed and is read-only.';

export const DAILY_PLAN_COMPLETED_LOCKED_MESSAGE =
  'This Daily Plan has been completed and is read-only.';

export const DAILY_PLAN_NOT_STARTED_FOR_REPORT_MESSAGE =
  'The Daily Plan for this date was not started.';

export const DAILY_PLAN_NO_PLAN_FOR_REPORT_MESSAGE =
  'No Daily Plan was recorded for this date.';

export const DAILY_PLAN_UNRESOLVED_OUTCOMES_MESSAGE =
  'Resolve the unfinished outcomes before completing the Daily Report.';

export const DAILY_REPORT_COMPLETE_CONFIRM_TITLE = 'Complete Daily Report?';

export const DAILY_REPORT_COMPLETE_CONFIRM_BODY =
  'This will finalise the report and mark the Daily Plan as completed. The plan, outcome results and change history will become read-only.';

export const DAILY_PLAN_FUTURE_START_HINT =
  'This plan can be started on its work date.';

export const DAILY_PLAN_PAST_DRAFT_STATUS_MESSAGE =
  'Draft — not started on the scheduled work date.';

export const DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE =
  'Daily Plans can contain up to three primary outcomes. Remove an outcome before adding this item.';

export const DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE =
  'This carry-forward item was already used in another Daily Plan. Add it again?';

export const DAILY_PLAN_START_CONFIRM_TITLE = 'Start this day?';

export const DAILY_PLAN_START_CONFIRM_BODY =
  'Starting the day locks the current plan as the original baseline. It cannot be edited afterwards. Progress and plan changes can be recorded separately during the day.';

export function getDailyPlanStartDateError(
  workDate: string,
  timeZone: string = DAILY_PLAN_WORK_TIMEZONE,
  now: Date = new Date()
): string | null {
  if (!isValidReportDate(workDate)) {
    return 'Work date must be YYYY-MM-DD';
  }
  const today = formatReportDateInTimezone(now, timeZone);
  const cmp = compareWorkDates(workDate, today);
  if (cmp > 0) return DAILY_PLAN_START_FUTURE_MESSAGE;
  if (cmp < 0) return DAILY_PLAN_START_PAST_MESSAGE;
  return null;
}

export function getDailyPlanUiState(input: {
  status: DailyPlanStatus;
  workDate: string;
  canEditRole: boolean;
  timeZone?: string;
  now?: Date;
}): DailyPlanUiState {
  const status = normalizeDailyPlanStatus(input.status);
  const timeZone = input.timeZone ?? DAILY_PLAN_WORK_TIMEZONE;
  const now = input.now ?? new Date();
  const today = formatReportDateInTimezone(now, timeZone);
  const cmp = isValidReportDate(input.workDate) ? compareWorkDates(input.workDate, today) : 0;
  const isToday = cmp === 0;
  const isFuture = cmp > 0;
  const isPast = cmp < 0;
  const isDraft = status === 'draft';
  const isActive = status === 'active';
  const isCompleted = status === 'completed';
  const showEdit = input.canEditRole && isDraft;
  const showStartDay = input.canEditRole && isDraft && isToday;

  let supportingMessage: string | null = null;
  if (isCompleted) {
    supportingMessage = DAILY_PLAN_COMPLETED_UI_MESSAGE;
  } else if (isActive) {
    supportingMessage = DAILY_PLAN_ACTIVE_LOCKED_UI_MESSAGE;
  } else if (isDraft && isFuture) {
    supportingMessage = DAILY_PLAN_FUTURE_START_HINT;
  } else if (isDraft && isPast) {
    supportingMessage = DAILY_PLAN_PAST_DRAFT_STATUS_MESSAGE;
  }

  const statusLabel = isCompleted ? 'Completed' : isActive ? 'Active' : 'Draft';

  return {
    status,
    showEdit,
    showStartDay,
    isFutureDraft: isDraft && isFuture,
    isPastUnstartedDraft: isDraft && isPast,
    isBaselineLocked: isActive || isCompleted,
    statusLabel,
    supportingMessage,
  };
}

function parseOutcomes(
  raw: unknown
): { ok: true; outcomes: ParsedDailyPlanOutcome[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Add at least one planned outcome' };
  }
  if (raw.length === 0) {
    return { ok: false, message: 'Add at least one planned outcome' };
  }
  if (raw.length > DAILY_PLAN_MAX_OUTCOMES) {
    return { ok: false, message: 'You can add up to three planned outcomes' };
  }

  const outcomes: ParsedDailyPlanOutcome[] = [];
  const seenSourceIds = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as DailyPlanOutcomeInput;
    const description = trimField(item?.description);
    if (!description) {
      return { ok: false, message: 'Planned outcomes cannot be blank' };
    }
    const sourceRaw =
      item?.sourceCarryForwardId == null || String(item.sourceCarryForwardId).trim() === ''
        ? null
        : String(item.sourceCarryForwardId).trim();
    if (sourceRaw && !isValidUuid(sourceRaw)) {
      return { ok: false, message: 'Carry-forward source reference is invalid' };
    }
    if (sourceRaw) {
      if (seenSourceIds.has(sourceRaw)) {
        return {
          ok: false,
          message: 'The same carry-forward item cannot be linked to more than one outcome',
        };
      }
      seenSourceIds.add(sourceRaw);
    }
    outcomes.push({
      description,
      displayOrder: i + 1,
      sourceCarryForwardId: sourceRaw,
    });
  }
  return { ok: true, outcomes };
}

function parseCrewResponsibilities(
  raw: unknown
):
  | { ok: true; crewResponsibilities: ParsedDailyPlanCrewResponsibility[] }
  | { ok: false; message: string } {
  if (raw == null) {
    return { ok: true, crewResponsibilities: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Crew responsibilities must be a list' };
  }

  const crewResponsibilities: ParsedDailyPlanCrewResponsibility[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as DailyPlanCrewResponsibilityInput;
    const crewMemberName = trimField(item?.crewMemberName, 200);
    const responsibility = trimField(item?.responsibility);
    if (!crewMemberName && !responsibility) continue;
    if (!crewMemberName) {
      return { ok: false, message: 'Crew member name is required for each responsibility' };
    }
    if (!responsibility) {
      return { ok: false, message: 'Responsibility is required for each crew member' };
    }
    const staffRaw =
      item?.staffProfileId == null || String(item.staffProfileId).trim() === ''
        ? null
        : String(item.staffProfileId).trim();
    if (staffRaw && !isValidUuid(staffRaw)) {
      return { ok: false, message: 'Crew member reference is invalid' };
    }
    crewResponsibilities.push({
      crewMemberName,
      responsibility,
      staffProfileId: staffRaw,
      displayOrder: i + 1,
    });
  }
  return { ok: true, crewResponsibilities };
}

function parseMaterials(
  raw: unknown
): { ok: true; materials: ParsedDailyPlanMaterial[] } | { ok: false; message: string } {
  if (raw == null) {
    return { ok: true, materials: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Materials must be a list' };
  }

  const materials: ParsedDailyPlanMaterial[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as DailyPlanMaterialInput;
    const description = trimField(item?.description);
    const quantityRaw = trimField(item?.quantity, 200);
    if (!description && !quantityRaw) continue;
    if (!description) {
      return { ok: false, message: 'Material description is required' };
    }
    materials.push({
      description,
      quantity: quantityRaw || null,
      displayOrder: i + 1,
    });
  }
  return { ok: true, materials };
}

function parseEquipment(
  raw: unknown
): { ok: true; equipment: ParsedDailyPlanEquipment[] } | { ok: false; message: string } {
  if (raw == null) {
    return { ok: true, equipment: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Equipment must be a list' };
  }

  const equipment: ParsedDailyPlanEquipment[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as DailyPlanEquipmentInput;
    const description = trimField(item?.description);
    if (!description) continue;
    equipment.push({ description, displayOrder: i + 1 });
  }
  return { ok: true, equipment };
}

export type ParseDailyPlanOptions = {
  mode: 'create' | 'edit';
  /** Required on create when body omits supervisor; ignored when body supplies a valid id. */
  defaultSupervisorStaffProfileId?: string | null;
  todayInTimezone?: () => string;
  now?: Date;
};

export function parseDailyPlanUpsertBody(
  body: DailyPlanUpsertInput,
  options: ParseDailyPlanOptions
): { ok: true; data: ParsedDailyPlanUpsert } | { ok: false; message: string } {
  const todayInTimezone = options.todayInTimezone ?? (() => todayReportDate(DAILY_PLAN_WORK_TIMEZONE));
  const now = options.now ?? new Date();

  const workDateRaw = trimField(body.workDate, 32);
  if (!workDateRaw) {
    return { ok: false, message: 'Work date is required' };
  }
  if (!isValidReportDate(workDateRaw)) {
    return { ok: false, message: 'Work date must be YYYY-MM-DD' };
  }

  if (options.mode === 'create') {
    const today = todayInTimezone();
    if (compareWorkDates(workDateRaw, today) < 0) {
      return { ok: false, message: 'Work date must be today or a future date' };
    }
  }
  void now;

  let supervisorStaffProfileId: string | null = null;
  const supervisorRaw = trimField(body.supervisorStaffProfileId, 64);
  if (supervisorRaw) {
    if (!isValidUuid(supervisorRaw)) {
      return { ok: false, message: 'Supervisor is invalid' };
    }
    supervisorStaffProfileId = supervisorRaw;
  } else if (options.mode === 'create') {
    const fallback = options.defaultSupervisorStaffProfileId?.trim() ?? '';
    if (!fallback || !isValidUuid(fallback)) {
      return { ok: false, message: 'Supervisor is required' };
    }
    supervisorStaffProfileId = fallback;
  }

  const outcomesResult = parseOutcomes(body.outcomes);
  if (!outcomesResult.ok) return outcomesResult;

  const crewResult = parseCrewResponsibilities(body.crewResponsibilities);
  if (!crewResult.ok) return crewResult;

  const materialsResult = parseMaterials(body.materials);
  if (!materialsResult.ok) return materialsResult;

  const equipmentResult = parseEquipment(body.equipment);
  if (!equipmentResult.ok) return equipmentResult;

  const risksConstraints = trimField(body.risksConstraints) || null;
  const contingencyPlan = trimField(body.contingencyPlan) || null;
  const generalNotes = trimField(body.generalNotes) || null;

  const confirmDuplicateCarryForwardIds: string[] = [];
  const confirmRaw = body.confirmDuplicateCarryForwardIds;
  if (confirmRaw != null) {
    if (!Array.isArray(confirmRaw)) {
      return { ok: false, message: 'Duplicate carry-forward confirmations must be a list' };
    }
    for (const entry of confirmRaw) {
      const id = String(entry ?? '').trim();
      if (!id) continue;
      if (!isValidUuid(id)) {
        return { ok: false, message: 'Duplicate carry-forward confirmation is invalid' };
      }
      if (!confirmDuplicateCarryForwardIds.includes(id)) {
        confirmDuplicateCarryForwardIds.push(id);
      }
    }
  }

  return {
    ok: true,
    data: {
      workDate: workDateRaw,
      supervisorStaffProfileId,
      outcomes: outcomesResult.outcomes,
      crewResponsibilities: crewResult.crewResponsibilities,
      materials: materialsResult.materials,
      equipment: equipmentResult.equipment,
      risksConstraints,
      contingencyPlan,
      generalNotes,
      confirmDuplicateCarryForwardIds,
    },
  };
}

function relationName(
  value: { full_name: string } | { full_name: string }[] | null | undefined
): string {
  if (!value) return 'Unknown staff member';
  if (Array.isArray(value)) return value[0]?.full_name ?? 'Unknown staff member';
  return value.full_name ?? 'Unknown staff member';
}

export type DailyPlanOutcomeDbRow = {
  id: string;
  description: string;
  display_order: number;
  source_carry_forward_id?: string | null;
  execution_status?: string | null;
  status_updated_by_staff_profile_id?: string | null;
  status_updated_at?: string | null;
  completion_note?: string | null;
  not_completed_reason_category?: string | null;
  not_completed_explanation?: string | null;
  completed_by_staff_profile_id?: string | null;
  completed_at?: string | null;
  status_updated_by?: { full_name: string } | { full_name: string }[] | null;
  completed_by?: { full_name: string } | { full_name: string }[] | null;
};

export type DailyPlanReplacementOutcomeDbRow = {
  id: string;
  plan_change_id: string;
  description: string;
  execution_status?: string | null;
  status_updated_by_staff_profile_id?: string | null;
  status_updated_at?: string | null;
  completion_note?: string | null;
  not_completed_reason_category?: string | null;
  not_completed_explanation?: string | null;
  completed_by_staff_profile_id?: string | null;
  completed_at?: string | null;
  created_by_staff_profile_id: string;
  created_at: string;
  status_updated_by?: { full_name: string } | { full_name: string }[] | null;
  completed_by?: { full_name: string } | { full_name: string }[] | null;
  created_by?: { full_name: string } | { full_name: string }[] | null;
};

export type DailyPlanChangeDbRow = {
  id: string;
  change_type: string;
  reason_category: string;
  what_changed: string;
  why_changed: string;
  affected_outcome_id: string | null;
  decision_maker_type: string;
  decision_maker_staff_profile_id: string | null;
  decision_maker_label: string | null;
  impact_today: string;
  programme_impact: string | null;
  recorded_by_staff_profile_id: string;
  created_at: string;
  decision_maker?: { full_name: string } | { full_name: string }[] | null;
  recorded_by?: { full_name: string } | { full_name: string }[] | null;
};

export type DailyPlanOutcomeEventDbRow = {
  id: string;
  outcome_id: string | null;
  replacement_outcome_id: string | null;
  event_type: string;
  from_status: string;
  to_status: string;
  completion_note: string | null;
  not_completed_reason_category: string | null;
  not_completed_explanation: string | null;
  actor_staff_profile_id: string;
  created_at: string;
  actor?: { full_name: string } | { full_name: string }[] | null;
};

function mapOutcomeExecutionFields(row: {
  execution_status?: string | null;
  status_updated_by_staff_profile_id?: string | null;
  status_updated_at?: string | null;
  completion_note?: string | null;
  not_completed_reason_category?: string | null;
  not_completed_explanation?: string | null;
  completed_by_staff_profile_id?: string | null;
  completed_at?: string | null;
  status_updated_by?: { full_name: string } | { full_name: string }[] | null;
  completed_by?: { full_name: string } | { full_name: string }[] | null;
}) {
  const statusUpdatedById = row.status_updated_by_staff_profile_id ?? null;
  const completedById = row.completed_by_staff_profile_id ?? null;
  return {
    executionStatus: normalizeOutcomeExecutionStatus(row.execution_status),
    statusUpdatedByStaffProfileId: statusUpdatedById,
    statusUpdatedByName: statusUpdatedById ? relationName(row.status_updated_by) : null,
    statusUpdatedAt: row.status_updated_at ?? null,
    completionNote: row.completion_note ?? null,
    notCompletedReasonCategory: (row.not_completed_reason_category ??
      null) as DailyPlanNotCompletedReasonCategory | null,
    notCompletedExplanation: row.not_completed_explanation ?? null,
    completedByStaffProfileId: completedById,
    completedByName: completedById ? relationName(row.completed_by) : null,
    completedAt: row.completed_at ?? null,
  };
}

export function mapDailyPlanApi(input: {
  plan: DailyPlanDbRow;
  outcomes: DailyPlanOutcomeDbRow[];
  crew: Array<{
    id: string;
    crew_member_name: string;
    responsibility: string;
    staff_profile_id: string | null;
    display_order: number;
  }>;
  materials: Array<{
    id: string;
    description: string;
    quantity: string | null;
    display_order: number;
  }>;
  equipment: Array<{ id: string; description: string; display_order: number }>;
  replacementOutcomes?: DailyPlanReplacementOutcomeDbRow[];
  changes?: DailyPlanChangeDbRow[];
  outcomeEvents?: DailyPlanOutcomeEventDbRow[];
  carryForwards?: Array<{
    id: string;
    outcome_id: string | null;
    replacement_outcome_id: string | null;
    carry_forward: boolean;
    note: string | null;
    recorded_by_staff_profile_id: string;
    recorded_at: string;
    recorded_by?: { full_name: string } | { full_name: string }[] | null;
  }>;
  viewerRole: StaffRole;
  now?: Date;
}): DailyPlanApi {
  const { plan, viewerRole } = input;
  const status = normalizeDailyPlanStatus(plan.status);
  const startedById = plan.started_by_staff_profile_id ?? null;
  const completedById = plan.completed_by_staff_profile_id ?? null;
  const replacementOutcomes = [...(input.replacementOutcomes ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );
  const changesNewestFirst = [...(input.changes ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
  const eventsNewestFirst = [...(input.outcomeEvents ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );

  const replacementsByChangeId = new Map<string, string[]>();
  for (const replacement of replacementOutcomes) {
    const list = replacementsByChangeId.get(replacement.plan_change_id) ?? [];
    list.push(replacement.id);
    replacementsByChangeId.set(replacement.plan_change_id, list);
  }

  return {
    id: plan.id,
    jobId: plan.job_id,
    workDate: plan.work_date,
    workTimezone: plan.work_timezone,
    status,
    supervisorStaffProfileId: plan.supervisor_staff_profile_id,
    supervisorName: relationName(plan.supervisor),
    createdByStaffProfileId: plan.created_by_staff_profile_id,
    createdByName: relationName(plan.created_by),
    startedByStaffProfileId: startedById,
    startedByName: startedById ? relationName(plan.started_by) : null,
    startedAt: plan.started_at ?? null,
    completedByStaffProfileId: completedById,
    completedByName: completedById ? relationName(plan.completed_by) : null,
    completedAt: plan.completed_at ?? null,
    completedDailySiteUpdateId: plan.completed_daily_site_update_id ?? null,
    risksConstraints: plan.risks_constraints,
    contingencyPlan: plan.contingency_plan,
    generalNotes: plan.general_notes,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
    outcomes: [...input.outcomes]
      .sort((a, b) => a.display_order - b.display_order)
      .map((o) => ({
        id: o.id,
        description: o.description,
        displayOrder: o.display_order,
        sourceCarryForwardId: o.source_carry_forward_id ?? null,
        ...mapOutcomeExecutionFields(o),
      })),
    crewResponsibilities: [...input.crew]
      .sort((a, b) => a.display_order - b.display_order)
      .map((c) => ({
        id: c.id,
        crewMemberName: c.crew_member_name,
        responsibility: c.responsibility,
        staffProfileId: c.staff_profile_id,
        displayOrder: c.display_order,
      })),
    materials: [...input.materials]
      .sort((a, b) => a.display_order - b.display_order)
      .map((m) => ({
        id: m.id,
        description: m.description,
        quantity: m.quantity,
        displayOrder: m.display_order,
      })),
    equipment: [...input.equipment]
      .sort((a, b) => a.display_order - b.display_order)
      .map((e) => ({
        id: e.id,
        description: e.description,
        displayOrder: e.display_order,
      })),
    replacementOutcomes: replacementOutcomes.map((r) => ({
      id: r.id,
      planChangeId: r.plan_change_id,
      description: r.description,
      createdByStaffProfileId: r.created_by_staff_profile_id,
      createdByName: relationName(r.created_by),
      createdAt: r.created_at,
      ...mapOutcomeExecutionFields(r),
    })),
    changes: changesNewestFirst.map((c) => {
      const decisionMakerId = c.decision_maker_staff_profile_id ?? null;
      return {
        id: c.id,
        changeType: c.change_type as DailyPlanChangeType,
        reasonCategory: c.reason_category as DailyPlanChangeReasonCategory,
        whatChanged: c.what_changed,
        whyChanged: c.why_changed,
        affectedOutcomeId: c.affected_outcome_id,
        decisionMakerType: c.decision_maker_type as DailyPlanDecisionMakerType,
        decisionMakerStaffProfileId: decisionMakerId,
        decisionMakerName: decisionMakerId ? relationName(c.decision_maker) : null,
        decisionMakerLabel: c.decision_maker_label,
        impactToday: c.impact_today,
        programmeImpact: c.programme_impact,
        recordedByStaffProfileId: c.recorded_by_staff_profile_id,
        recordedByName: relationName(c.recorded_by),
        createdAt: c.created_at,
        replacementOutcomeIds: replacementsByChangeId.get(c.id) ?? [],
      };
    }),
    outcomeEvents: eventsNewestFirst.map((e) => ({
      id: e.id,
      outcomeId: e.outcome_id,
      replacementOutcomeId: e.replacement_outcome_id,
      eventType: 'status_changed' as const,
      fromStatus: normalizeOutcomeExecutionStatus(e.from_status),
      toStatus: normalizeOutcomeExecutionStatus(e.to_status),
      completionNote: e.completion_note,
      notCompletedReasonCategory: (e.not_completed_reason_category ??
        null) as DailyPlanNotCompletedReasonCategory | null,
      notCompletedExplanation: e.not_completed_explanation,
      actorStaffProfileId: e.actor_staff_profile_id,
      actorName: relationName(e.actor),
      createdAt: e.created_at,
    })),
    carryForwards: (input.carryForwards ?? []).map((cf) => ({
      id: cf.id,
      outcomeId: cf.outcome_id,
      replacementOutcomeId: cf.replacement_outcome_id,
      carryForward: cf.carry_forward,
      note: cf.note,
      recordedByStaffProfileId: cf.recorded_by_staff_profile_id,
      recordedByName: relationName(cf.recorded_by),
      recordedAt: cf.recorded_at,
    })),
    canEdit: canEditDailyPlanBaseline(viewerRole, status),
    canStartDay: canStartDailyPlan({
      status,
      workDate: plan.work_date,
      role: viewerRole,
      timeZone: plan.work_timezone || DAILY_PLAN_WORK_TIMEZONE,
      now: input.now,
    }),
    canUpdateExecution: canUpdateDailyPlanExecution(viewerRole, status),
  };
}

/** Empty-state copy for the Today page when no plan exists. */
export const DAILY_PLAN_EMPTY_MESSAGE =
  'No Daily Plan has been created for this project and date.';
