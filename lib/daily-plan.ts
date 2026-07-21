import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  DAILY_PLAN_STATUS_CONFLICT_MESSAGE,
  type ParsedOutcomeStatusUpdate,
  type ParsedPlanChange,
} from '@/lib/daily-plan-execution';
import {
  compareWorkDates,
  DAILY_PLAN_ALREADY_ACTIVE_MESSAGE,
  DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
  DAILY_PLAN_WORK_TIMEZONE,
  mapDailyPlanApi,
  normalizeDailyPlanStatus,
  type DailyPlanApi,
  type DailyPlanChangeDbRow,
  type DailyPlanDbRow,
  type DailyPlanOutcomeDbRow,
  type DailyPlanOutcomeEventDbRow,
  type DailyPlanReplacementOutcomeDbRow,
  type ParsedDailyPlanUpsert,
} from '@/lib/daily-plan-shared';
import {
  buildSuggestionItems,
  filterUnusedSuggestions,
  resolveSuggestionsEmptyReason,
  validateSourceCarryForwardLinks,
  type CarryForwardSuggestionsPayload,
  type PriorUseRow,
  type SourceCarryForwardValidationRow,
} from '@/lib/daily-plan-carry-forward-suggestions';
import type { StaffRole } from '@/lib/staff-auth';
import { normalizeSupabaseError } from '@/lib/job-org-validation';

const OUTCOME_SELECT = `
  id,
  description,
  display_order,
  source_carry_forward_id,
  execution_status,
  status_updated_by_staff_profile_id,
  status_updated_at,
  completion_note,
  not_completed_reason_category,
  not_completed_explanation,
  completed_by_staff_profile_id,
  completed_at,
  status_updated_by:staff_profiles!job_daily_plan_outcomes_status_updated_by_staff_profile_id_fkey(full_name),
  completed_by:staff_profiles!job_daily_plan_outcomes_completed_by_staff_profile_id_fkey(full_name)
`;

// Use column-name FK hints: Postgres truncates constraint names on this table.
const REPLACEMENT_SELECT = `
  id,
  plan_change_id,
  description,
  execution_status,
  status_updated_by_staff_profile_id,
  status_updated_at,
  completion_note,
  not_completed_reason_category,
  not_completed_explanation,
  completed_by_staff_profile_id,
  completed_at,
  created_by_staff_profile_id,
  created_at,
  status_updated_by:staff_profiles!status_updated_by_staff_profile_id(full_name),
  completed_by:staff_profiles!completed_by_staff_profile_id(full_name),
  created_by:staff_profiles!created_by_staff_profile_id(full_name)
`;

const CHANGE_SELECT = `
  id,
  change_type,
  reason_category,
  what_changed,
  why_changed,
  affected_outcome_id,
  decision_maker_type,
  decision_maker_staff_profile_id,
  decision_maker_label,
  impact_today,
  programme_impact,
  recorded_by_staff_profile_id,
  created_at,
  decision_maker:staff_profiles!job_daily_plan_changes_decision_maker_staff_profile_id_fkey(full_name),
  recorded_by:staff_profiles!job_daily_plan_changes_recorded_by_staff_profile_id_fkey(full_name)
`;

const EVENT_SELECT = `
  id,
  outcome_id,
  replacement_outcome_id,
  event_type,
  from_status,
  to_status,
  completion_note,
  not_completed_reason_category,
  not_completed_explanation,
  actor_staff_profile_id,
  created_at,
  actor:staff_profiles!job_daily_plan_outcome_events_actor_staff_profile_id_fkey(full_name)
`;

export const DAILY_PLAN_SELECT = `
  id,
  job_id,
  work_date,
  work_timezone,
  status,
  supervisor_staff_profile_id,
  created_by_staff_profile_id,
  started_by_staff_profile_id,
  started_at,
  completed_by_staff_profile_id,
  completed_at,
  completed_daily_site_update_id,
  risks_constraints,
  contingency_plan,
  general_notes,
  created_at,
  updated_at,
  supervisor:staff_profiles!job_daily_plans_supervisor_staff_profile_id_fkey(full_name),
  created_by:staff_profiles!job_daily_plans_created_by_staff_profile_id_fkey(full_name),
  started_by:staff_profiles!job_daily_plans_started_by_staff_profile_id_fkey(full_name),
  completed_by:staff_profiles!job_daily_plans_completed_by_staff_profile_id_fkey(full_name)
`;

const CARRY_FORWARD_SELECT = `
  id,
  outcome_id,
  replacement_outcome_id,
  carry_forward,
  note,
  recorded_by_staff_profile_id,
  recorded_at,
  recorded_by:staff_profiles!job_daily_plan_carry_forwards_recorded_by_staff_profile_id_fkey(full_name)
`;

export async function loadDailyPlanBundle(
  planId: string,
  viewerRole: StaffRole
): Promise<{ ok: true; plan: DailyPlanApi } | { ok: false; message: string; code?: string }> {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from('job_daily_plans')
    .select(DAILY_PLAN_SELECT)
    .eq('id', planId)
    .maybeSingle();

  if (planError) {
    const err = normalizeSupabaseError(planError);
    return { ok: false, message: 'Failed to load Daily Plan', code: err.code ?? undefined };
  }
  if (!planRow) {
    return { ok: false, message: 'Daily Plan not found' };
  }

  const [
    outcomesRes,
    crewRes,
    materialsRes,
    equipmentRes,
    replacementsRes,
    changesRes,
    eventsRes,
    carryForwardsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('job_daily_plan_outcomes')
      .select(OUTCOME_SELECT)
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_crew_responsibilities')
      .select('id, crew_member_name, responsibility, staff_profile_id, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_materials')
      .select('id, description, quantity, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_equipment')
      .select('id, description, display_order')
      .eq('daily_plan_id', planId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_replacement_outcomes')
      .select(REPLACEMENT_SELECT)
      .eq('daily_plan_id', planId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('job_daily_plan_changes')
      .select(CHANGE_SELECT)
      .eq('daily_plan_id', planId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('job_daily_plan_outcome_events')
      .select(EVENT_SELECT)
      .eq('daily_plan_id', planId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('job_daily_plan_carry_forwards')
      .select(CARRY_FORWARD_SELECT)
      .eq('daily_plan_id', planId)
      .order('recorded_at', { ascending: false }),
  ]);

  if (
    outcomesRes.error ||
    crewRes.error ||
    materialsRes.error ||
    equipmentRes.error ||
    replacementsRes.error ||
    changesRes.error ||
    eventsRes.error ||
    carryForwardsRes.error
  ) {
    return { ok: false, message: 'Failed to load Daily Plan details' };
  }

  return {
    ok: true,
    plan: mapDailyPlanApi({
      plan: planRow as DailyPlanDbRow,
      outcomes: (outcomesRes.data ?? []) as DailyPlanOutcomeDbRow[],
      crew: (crewRes.data ?? []) as Array<{
        id: string;
        crew_member_name: string;
        responsibility: string;
        staff_profile_id: string | null;
        display_order: number;
      }>,
      materials: (materialsRes.data ?? []) as Array<{
        id: string;
        description: string;
        quantity: string | null;
        display_order: number;
      }>,
      equipment: (equipmentRes.data ?? []) as Array<{
        id: string;
        description: string;
        display_order: number;
      }>,
      replacementOutcomes: (replacementsRes.data ?? []) as DailyPlanReplacementOutcomeDbRow[],
      changes: (changesRes.data ?? []) as DailyPlanChangeDbRow[],
      outcomeEvents: (eventsRes.data ?? []) as DailyPlanOutcomeEventDbRow[],
      carryForwards: (carryForwardsRes.data ?? []) as Array<{
        id: string;
        outcome_id: string | null;
        replacement_outcome_id: string | null;
        carry_forward: boolean;
        note: string | null;
        recorded_by_staff_profile_id: string;
        recorded_at: string;
        recorded_by?: { full_name: string } | { full_name: string }[] | null;
      }>,
      viewerRole,
    }),
  };
}

export async function findDailyPlanIdByJobDate(
  jobId: string,
  workDate: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id')
    .eq('job_id', jobId)
    .eq('work_date', workDate)
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}

export async function replaceDailyPlanChildren(
  planId: string,
  parsed: ParsedDailyPlanUpsert
): Promise<{ ok: true } | { ok: false; message: string; code?: string }> {
  const { error: delOutcomes } = await supabaseAdmin
    .from('job_daily_plan_outcomes')
    .delete()
    .eq('daily_plan_id', planId);
  if (delOutcomes) {
    return { ok: false, message: 'Failed to update outcomes', code: delOutcomes.code };
  }

  const { error: delCrew } = await supabaseAdmin
    .from('job_daily_plan_crew_responsibilities')
    .delete()
    .eq('daily_plan_id', planId);
  if (delCrew) {
    return { ok: false, message: 'Failed to update crew responsibilities', code: delCrew.code };
  }

  const { error: delMaterials } = await supabaseAdmin
    .from('job_daily_plan_materials')
    .delete()
    .eq('daily_plan_id', planId);
  if (delMaterials) {
    return { ok: false, message: 'Failed to update materials', code: delMaterials.code };
  }

  const { error: delEquipment } = await supabaseAdmin
    .from('job_daily_plan_equipment')
    .delete()
    .eq('daily_plan_id', planId);
  if (delEquipment) {
    return { ok: false, message: 'Failed to update equipment', code: delEquipment.code };
  }

  if (parsed.outcomes.length > 0) {
    const { error } = await supabaseAdmin.from('job_daily_plan_outcomes').insert(
      parsed.outcomes.map((o) => ({
        daily_plan_id: planId,
        description: o.description,
        display_order: o.displayOrder,
        source_carry_forward_id: o.sourceCarryForwardId,
      }))
    );
    if (error) {
      return { ok: false, message: 'Failed to save outcomes', code: error.code };
    }
  }

  if (parsed.crewResponsibilities.length > 0) {
    const { error } = await supabaseAdmin.from('job_daily_plan_crew_responsibilities').insert(
      parsed.crewResponsibilities.map((c) => ({
        daily_plan_id: planId,
        crew_member_name: c.crewMemberName,
        responsibility: c.responsibility,
        staff_profile_id: c.staffProfileId,
        display_order: c.displayOrder,
      }))
    );
    if (error) {
      return { ok: false, message: 'Failed to save crew responsibilities', code: error.code };
    }
  }

  if (parsed.materials.length > 0) {
    const { error } = await supabaseAdmin.from('job_daily_plan_materials').insert(
      parsed.materials.map((m) => ({
        daily_plan_id: planId,
        description: m.description,
        quantity: m.quantity,
        display_order: m.displayOrder,
      }))
    );
    if (error) {
      return { ok: false, message: 'Failed to save materials', code: error.code };
    }
  }

  if (parsed.equipment.length > 0) {
    const { error } = await supabaseAdmin.from('job_daily_plan_equipment').insert(
      parsed.equipment.map((e) => ({
        daily_plan_id: planId,
        description: e.description,
        display_order: e.displayOrder,
      }))
    );
    if (error) {
      return { ok: false, message: 'Failed to save equipment', code: error.code };
    }
  }

  return { ok: true };
}

export async function assertStaffInOrg(
  staffProfileId: string,
  organisationId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, active')
    .eq('id', staffProfileId)
    .eq('org_id', organisationId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: 'Supervisor not found in this organisation' };
  }
  if (!data.active) {
    return { ok: false, message: 'Supervisor account is inactive' };
  }
  return { ok: true };
}

export function resolveDailyPlanTimezone(): string {
  return DAILY_PLAN_WORK_TIMEZONE;
}

/**
 * Atomically activate a draft plan. Uses a conditional update on status='draft'
 * so concurrent Start Day requests cannot overwrite started_by / started_at.
 */
export async function startDailyPlanAtomically(
  planId: string,
  startedByStaffProfileId: string,
  startedAt: string = new Date().toISOString()
): Promise<
  | { ok: true; startedAt: string }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict?: false; message: string; code?: string }
> {
  const { data, error } = await supabaseAdmin
    .from('job_daily_plans')
    .update({
      status: 'active',
      started_by_staff_profile_id: startedByStaffProfileId,
      started_at: startedAt,
    })
    .eq('id', planId)
    .eq('status', 'draft')
    .select('id, status, started_by_staff_profile_id, started_at')
    .maybeSingle();

  if (error) {
    const err = normalizeSupabaseError(error);
    return {
      ok: false,
      message: 'Failed to start Daily Plan',
      code: err.code ?? undefined,
    };
  }

  if (data) {
    return { ok: true, startedAt: (data.started_at as string) ?? startedAt };
  }

  // No draft row updated — plan missing or already active.
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, status')
    .eq('id', planId)
    .maybeSingle();

  if (loadError) {
    const err = normalizeSupabaseError(loadError);
    return {
      ok: false,
      message: 'Failed to start Daily Plan',
      code: err.code ?? undefined,
    };
  }
  if (!existing) {
    return { ok: false, message: 'Daily Plan not found' };
  }
  const existingStatus = normalizeDailyPlanStatus(existing.status);
  if (existingStatus === 'completed') {
    return {
      ok: false,
      conflict: true,
      message: DAILY_PLAN_COMPLETED_LOCKED_MESSAGE,
    };
  }
  if (existingStatus === 'active') {
    return {
      ok: false,
      conflict: true,
      message: DAILY_PLAN_ALREADY_ACTIVE_MESSAGE,
    };
  }
  return { ok: false, conflict: true, message: DAILY_PLAN_ALREADY_ACTIVE_MESSAGE };
}

type RpcResult =
  | { ok: true; changeId?: string; replacementOutcomeId?: string | null }
  | { ok: false; conflict?: boolean; message: string };

function parseRpcResult(data: unknown): RpcResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, message: 'Unexpected database response' };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === true) {
    return {
      ok: true,
      changeId: typeof row.changeId === 'string' ? row.changeId : undefined,
      replacementOutcomeId:
        typeof row.replacementOutcomeId === 'string' ? row.replacementOutcomeId : null,
    };
  }
  return {
    ok: false,
    conflict: row.conflict === true,
    message:
      typeof row.message === 'string' && row.message.trim()
        ? row.message
        : DAILY_PLAN_STATUS_CONFLICT_MESSAGE,
  };
}

export async function updateDailyPlanOutcomeExecution(input: {
  planId: string;
  outcomeId: string;
  isReplacement: boolean;
  actorStaffProfileId: string;
  parsed: ParsedOutcomeStatusUpdate;
}): Promise<
  | { ok: true }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict?: false; message: string; code?: string }
> {
  const { data, error } = await supabaseAdmin.rpc('update_daily_plan_outcome_execution', {
    p_plan_id: input.planId,
    p_outcome_id: input.outcomeId,
    p_is_replacement: input.isReplacement,
    p_expected_from_status: input.parsed.expectedFromStatus,
    p_to_status: input.parsed.toStatus,
    p_actor_staff_profile_id: input.actorStaffProfileId,
    p_completion_note: input.parsed.completionNote,
    p_not_completed_reason_category: input.parsed.notCompletedReasonCategory,
    p_not_completed_explanation: input.parsed.notCompletedExplanation,
  });

  if (error) {
    const err = normalizeSupabaseError(error);
    return {
      ok: false,
      message: 'Failed to update outcome status',
      code: err.code ?? undefined,
    };
  }

  const parsed = parseRpcResult(data);
  if (!parsed.ok) {
    if (parsed.conflict) {
      return { ok: false, conflict: true, message: parsed.message };
    }
    return { ok: false, message: parsed.message };
  }
  return { ok: true };
}

export async function applyDailyPlanChange(input: {
  planId: string;
  recordedByStaffProfileId: string;
  parsed: ParsedPlanChange;
}): Promise<
  | { ok: true; changeId?: string; replacementOutcomeId?: string | null }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict?: false; message: string; code?: string }
> {
  const { data, error } = await supabaseAdmin.rpc('apply_daily_plan_change', {
    p_plan_id: input.planId,
    p_change_type: input.parsed.changeType,
    p_reason_category: input.parsed.reasonCategory,
    p_what_changed: input.parsed.whatChanged,
    p_why_changed: input.parsed.whyChanged,
    p_affected_outcome_id: input.parsed.affectedOutcomeId,
    p_decision_maker_type: input.parsed.decisionMakerType,
    p_decision_maker_staff_profile_id: input.parsed.decisionMakerStaffProfileId,
    p_decision_maker_label: input.parsed.decisionMakerLabel,
    p_impact_today: input.parsed.impactToday,
    p_programme_impact: input.parsed.programmeImpact,
    p_recorded_by_staff_profile_id: input.recordedByStaffProfileId,
    p_replacement_description: input.parsed.replacementDescription,
  });

  if (error) {
    const err = normalizeSupabaseError(error);
    return {
      ok: false,
      message: 'Failed to record plan change',
      code: err.code ?? undefined,
    };
  }

  const parsed = parseRpcResult(data);
  if (!parsed.ok) {
    if (parsed.conflict) {
      return { ok: false, conflict: true, message: parsed.message };
    }
    return { ok: false, message: parsed.message };
  }
  return {
    ok: true,
    changeId: parsed.changeId,
    replacementOutcomeId: parsed.replacementOutcomeId,
  };
}

export async function completeDailyPlanWithSiteUpdate(input: {
  jobId: string;
  planId: string;
  actorStaffProfileId: string;
  stageId: string | null;
  reportDate: string;
  reportTimezone: string;
  progressToday: string;
  issuesFaced: string;
  issuesFacedNone: boolean;
  problemsResolved: string;
  problemsResolvedNone: boolean;
  preventionPlan: string;
  preventionPlanNone: boolean;
  onTrackStatus: string;
  onTrackNotes: string | null;
  notesForTomorrow: string | null;
  plannedHoursSnapshot: number | null;
  hoursUsedSnapshot: number | null;
  hoursRemainingSnapshot: number | null;
  hoursSource: string | null;
  carryForwards: Array<{
    outcomeId: string | null;
    replacementOutcomeId: string | null;
    carryForward: boolean;
    note: string | null;
  }>;
  draftUpdateId?: string | null;
}): Promise<
  | {
      ok: true;
      alreadyCompleted: boolean;
      updateId: string | null;
      completedAt: string | null;
      completedByStaffProfileId: string | null;
    }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict?: false; message: string; code?: string; unresolvedCount?: number }
> {
  const { data, error } = await supabaseAdmin.rpc('complete_daily_plan_with_site_update', {
    p_job_id: input.jobId,
    p_plan_id: input.planId,
    p_actor_staff_profile_id: input.actorStaffProfileId,
    p_stage_id: input.stageId,
    p_report_date: input.reportDate,
    p_report_timezone: input.reportTimezone,
    p_progress_today: input.progressToday,
    p_issues_faced: input.issuesFaced,
    p_issues_faced_none: input.issuesFacedNone,
    p_problems_resolved: input.problemsResolved,
    p_problems_resolved_none: input.problemsResolvedNone,
    p_prevention_plan: input.preventionPlan,
    p_prevention_plan_none: input.preventionPlanNone,
    p_on_track_status: input.onTrackStatus,
    p_on_track_notes: input.onTrackNotes,
    p_notes_for_tomorrow: input.notesForTomorrow,
    p_planned_hours_snapshot: input.plannedHoursSnapshot,
    p_hours_used_snapshot: input.hoursUsedSnapshot,
    p_hours_remaining_snapshot: input.hoursRemainingSnapshot,
    p_hours_source: input.hoursSource,
    p_carry_forwards: input.carryForwards.map((cf) => ({
      outcomeId: cf.outcomeId,
      replacementOutcomeId: cf.replacementOutcomeId,
      carryForward: cf.carryForward,
      note: cf.note,
    })),
    p_draft_update_id: input.draftUpdateId ?? null,
  });

  if (error) {
    const err = normalizeSupabaseError(error);
    return {
      ok: false,
      message: 'Failed to complete Daily Report',
      code: err.code ?? undefined,
    };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, message: 'Unexpected database response' };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === true) {
    return {
      ok: true,
      alreadyCompleted: row.alreadyCompleted === true,
      updateId: typeof row.updateId === 'string' ? row.updateId : null,
      completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
      completedByStaffProfileId:
        typeof row.completedByStaffProfileId === 'string'
          ? row.completedByStaffProfileId
          : null,
    };
  }
  return {
    ok: false,
    conflict: row.conflict === true,
    message:
      typeof row.message === 'string' && row.message.trim()
        ? row.message
        : 'Failed to complete Daily Report',
    unresolvedCount:
      typeof row.unresolvedCount === 'number' ? row.unresolvedCount : undefined,
  };
}

/**
 * Load carry-forward planning suggestions for a target work date.
 * Fixed small number of queries — no N+1 per carry-forward item.
 */
export async function loadCarryForwardSuggestions(input: {
  jobId: string;
  targetWorkDate: string;
  /** When editing a draft, exclude its outcomes from prior-use for that same plan. */
  excludePlanId?: string | null;
  includedCarryForwardIds?: string[];
}): Promise<
  | { ok: true; payload: CarryForwardSuggestionsPayload }
  | { ok: false; message: string; code?: string }
> {
  const { jobId, targetWorkDate, excludePlanId } = input;

  const { data: sourcePlan, error: sourceError } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, work_date, completed_daily_site_update_id, status')
    .eq('job_id', jobId)
    .eq('status', 'completed')
    .lt('work_date', targetWorkDate)
    .order('work_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sourceError) {
    return {
      ok: false,
      message: 'Failed to load carry-forward suggestions',
      code: sourceError.code,
    };
  }

  if (!sourcePlan) {
    return {
      ok: true,
      payload: {
        sourcePlanId: null,
        sourceWorkDate: null,
        notesForTomorrow: null,
        completedDailySiteUpdateId: null,
        suggestions: [],
        emptyReason: 'no_completed_prior_plan',
      },
    };
  }

  const sourcePlanId = sourcePlan.id as string;
  const sourceWorkDate = sourcePlan.work_date as string;
  const completedDsuId =
    (sourcePlan.completed_daily_site_update_id as string | null | undefined) ?? null;

  const [cfRes, notesRes] = await Promise.all([
    supabaseAdmin
      .from('job_daily_plan_carry_forwards')
      .select('id, outcome_id, replacement_outcome_id, carry_forward, note')
      .eq('daily_plan_id', sourcePlanId)
      .eq('carry_forward', true),
    completedDsuId
      ? supabaseAdmin
          .from('job_daily_site_updates')
          .select('id, notes_for_tomorrow')
          .eq('id', completedDsuId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (cfRes.error) {
    return {
      ok: false,
      message: 'Failed to load carry-forward records',
      code: cfRes.error.code,
    };
  }
  if (notesRes.error) {
    return {
      ok: false,
      message: 'Failed to load notes for tomorrow',
      code: notesRes.error.code,
    };
  }

  const carryForwards = (cfRes.data ?? []) as Array<{
    id: string;
    outcome_id: string | null;
    replacement_outcome_id: string | null;
    carry_forward: boolean;
    note: string | null;
  }>;

  const notesForTomorrow =
    notesRes.data && typeof (notesRes.data as { notes_for_tomorrow?: string | null }).notes_for_tomorrow === 'string'
      ? ((notesRes.data as { notes_for_tomorrow: string | null }).notes_for_tomorrow ?? null)
      : notesRes.data
        ? ((notesRes.data as { notes_for_tomorrow?: string | null }).notes_for_tomorrow ?? null)
        : null;

  if (carryForwards.length === 0) {
    return {
      ok: true,
      payload: {
        sourcePlanId,
        sourceWorkDate,
        notesForTomorrow,
        completedDailySiteUpdateId: completedDsuId,
        suggestions: [],
        emptyReason: 'no_carry_forward_work',
      },
    };
  }

  const outcomeIds = carryForwards
    .map((c) => c.outcome_id)
    .filter((id): id is string => Boolean(id));
  const replacementIds = carryForwards
    .map((c) => c.replacement_outcome_id)
    .filter((id): id is string => Boolean(id));
  const cfIds = carryForwards.map((c) => c.id);

  const [outcomesRes, replacementsRes, priorOutcomesRes] = await Promise.all([
    outcomeIds.length > 0
      ? supabaseAdmin
          .from('job_daily_plan_outcomes')
          .select('id, description, execution_status')
          .in('id', outcomeIds)
      : Promise.resolve({ data: [], error: null }),
    replacementIds.length > 0
      ? supabaseAdmin
          .from('job_daily_plan_replacement_outcomes')
          .select('id, description, execution_status')
          .in('id', replacementIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('job_daily_plan_outcomes')
      .select('source_carry_forward_id, daily_plan_id')
      .in('source_carry_forward_id', cfIds),
  ]);

  if (outcomesRes.error) {
    return {
      ok: false,
      message: 'Failed to load source outcomes',
      code: outcomesRes.error.code,
    };
  }
  if (replacementsRes.error) {
    return {
      ok: false,
      message: 'Failed to load source replacement outcomes',
      code: replacementsRes.error.code,
    };
  }
  if (priorOutcomesRes.error) {
    return {
      ok: false,
      message: 'Failed to load prior carry-forward usage',
      code: priorOutcomesRes.error.code,
    };
  }

  const priorOutcomeRows = (priorOutcomesRes.data ?? []) as Array<{
    source_carry_forward_id: string | null;
    daily_plan_id: string;
  }>;
  const priorPlanIds = [
    ...new Set(priorOutcomeRows.map((r) => r.daily_plan_id).filter(Boolean)),
  ];

  let priorPlanById = new Map<string, { id: string; work_date: string }>();
  if (priorPlanIds.length > 0) {
    const { data: priorPlans, error: priorPlansError } = await supabaseAdmin
      .from('job_daily_plans')
      .select('id, work_date, job_id')
      .in('id', priorPlanIds)
      .eq('job_id', jobId);
    if (priorPlansError) {
      return {
        ok: false,
        message: 'Failed to load prior carry-forward usage',
        code: priorPlansError.code,
      };
    }
    priorPlanById = new Map(
      ((priorPlans ?? []) as Array<{ id: string; work_date: string }>).map((p) => [p.id, p])
    );
  }

  const priorUses: PriorUseRow[] = [];
  for (const row of priorOutcomeRows) {
    const cfId = row.source_carry_forward_id;
    const plan = priorPlanById.get(row.daily_plan_id);
    if (!cfId || !plan) continue;
    if (excludePlanId && plan.id === excludePlanId) continue;
    if (compareWorkDates(plan.work_date, sourceWorkDate) <= 0) continue;
    priorUses.push({
      source_carry_forward_id: cfId,
      plan_id: plan.id,
      work_date: plan.work_date,
    });
  }

  const suggestions = buildSuggestionItems({
    sourcePlanId,
    sourceWorkDate,
    carryForwards,
    outcomes: (outcomesRes.data ?? []) as Array<{
      id: string;
      description: string;
      execution_status: string;
    }>,
    replacements: (replacementsRes.data ?? []) as Array<{
      id: string;
      description: string;
      execution_status: string;
    }>,
    priorUses,
  });

  const included = input.includedCarryForwardIds ?? [];
  const unusedCount = filterUnusedSuggestions(suggestions, included).length;

  return {
    ok: true,
    payload: {
      sourcePlanId,
      sourceWorkDate,
      notesForTomorrow,
      completedDailySiteUpdateId: completedDsuId,
      suggestions,
      emptyReason: resolveSuggestionsEmptyReason({
        sourcePlanId,
        yesCarryForwardCount: carryForwards.length,
        unusedSuggestionCount: included.length > 0 ? unusedCount : suggestions.length,
      }),
    },
  };
}

/**
 * Batch-validate optional source_carry_forward_id values on draft upsert.
 */
export async function validateSourceCarryForwardsForUpsert(input: {
  jobId: string;
  organisationId: string;
  targetWorkDate: string;
  excludePlanId?: string | null;
  outcomes: Array<{ sourceCarryForwardId: string | null }>;
  confirmDuplicateCarryForwardIds: string[];
}): Promise<
  | { ok: true }
  | {
      ok: false;
      message: string;
      status?: number;
      code?: string;
      needsConfirmationIds?: string[];
    }
> {
  const sourceIds = [
    ...new Set(
      input.outcomes
        .map((o) => o.sourceCarryForwardId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (sourceIds.length === 0) {
    return { ok: true };
  }

  const { data: cfRows, error: cfError } = await supabaseAdmin
    .from('job_daily_plan_carry_forwards')
    .select('id, daily_plan_id, carry_forward, outcome_id, replacement_outcome_id')
    .in('id', sourceIds);

  if (cfError) {
    return {
      ok: false,
      message: 'Failed to validate carry-forward sources',
      code: cfError.code,
      status: 500,
    };
  }

  const planIds = [
    ...new Set(
      ((cfRows ?? []) as Array<{ daily_plan_id: string }>).map((r) => r.daily_plan_id)
    ),
  ];
  const { data: planRows, error: planError } = await supabaseAdmin
    .from('job_daily_plans')
    .select('id, job_id, work_date')
    .in('id', planIds);

  if (planError) {
    return {
      ok: false,
      message: 'Failed to validate carry-forward sources',
      code: planError.code,
      status: 500,
    };
  }

  const jobIds = [
    ...new Set(((planRows ?? []) as Array<{ job_id: string }>).map((p) => p.job_id)),
  ];
  const { data: jobRows, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('id, organisation_id')
    .in('id', jobIds);

  if (jobError) {
    return {
      ok: false,
      message: 'Failed to validate carry-forward sources',
      code: jobError.code,
      status: 500,
    };
  }

  const planById = new Map(
    ((planRows ?? []) as Array<{ id: string; job_id: string; work_date: string }>).map((p) => [
      p.id,
      p,
    ])
  );
  const orgByJobId = new Map(
    ((jobRows ?? []) as Array<{ id: string; organisation_id: string }>).map((j) => [
      j.id,
      j.organisation_id,
    ])
  );

  const sourceRows: SourceCarryForwardValidationRow[] = [];
  for (const row of (cfRows ?? []) as Array<{
    id: string;
    daily_plan_id: string;
    carry_forward: boolean;
    outcome_id: string | null;
    replacement_outcome_id: string | null;
  }>) {
    const plan = planById.get(row.daily_plan_id);
    if (!plan) continue;
    const organisationId = orgByJobId.get(plan.job_id);
    if (!organisationId) continue;
    sourceRows.push({
      id: row.id,
      daily_plan_id: plan.id,
      job_id: plan.job_id,
      organisation_id: organisationId,
      work_date: plan.work_date,
      carry_forward: Boolean(row.carry_forward),
      outcome_id: row.outcome_id,
      replacement_outcome_id: row.replacement_outcome_id,
    });
  }

  const { data: priorOutcomes, error: priorError } = await supabaseAdmin
    .from('job_daily_plan_outcomes')
    .select('source_carry_forward_id, daily_plan_id')
    .in('source_carry_forward_id', sourceIds);

  if (priorError) {
    return {
      ok: false,
      message: 'Failed to check prior carry-forward usage',
      code: priorError.code,
      status: 500,
    };
  }

  const priorOutcomeRows = (priorOutcomes ?? []) as Array<{
    source_carry_forward_id: string | null;
    daily_plan_id: string;
  }>;
  const priorPlanIds = [...new Set(priorOutcomeRows.map((r) => r.daily_plan_id))];
  let priorPlanById = new Map<string, { id: string; work_date: string }>();
  if (priorPlanIds.length > 0) {
    const { data: priorPlans, error: priorPlansError } = await supabaseAdmin
      .from('job_daily_plans')
      .select('id, work_date, job_id')
      .in('id', priorPlanIds)
      .eq('job_id', input.jobId);
    if (priorPlansError) {
      return {
        ok: false,
        message: 'Failed to check prior carry-forward usage',
        code: priorPlansError.code,
        status: 500,
      };
    }
    priorPlanById = new Map(
      ((priorPlans ?? []) as Array<{ id: string; work_date: string }>).map((p) => [p.id, p])
    );
  }

  const priorUses: PriorUseRow[] = [];
  for (const row of priorOutcomeRows) {
    const cfId = row.source_carry_forward_id;
    const plan = priorPlanById.get(row.daily_plan_id);
    if (!cfId || !plan) continue;
    priorUses.push({
      source_carry_forward_id: cfId,
      plan_id: plan.id,
      work_date: plan.work_date,
    });
  }

  const result = validateSourceCarryForwardLinks({
    targetJobId: input.jobId,
    targetOrganisationId: input.organisationId,
    targetWorkDate: input.targetWorkDate,
    excludePlanId: input.excludePlanId,
    outcomes: input.outcomes,
    confirmDuplicateCarryForwardIds: input.confirmDuplicateCarryForwardIds,
    sourceRows,
    priorUses,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      code: result.code,
      needsConfirmationIds: result.needsConfirmationIds,
      status: result.code === 'DUPLICATE_CARRY_FORWARD' ? 409 : 400,
    };
  }

  return { ok: true };
}

