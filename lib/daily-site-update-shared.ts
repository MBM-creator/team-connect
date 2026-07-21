export type StaffRole = 'field' | 'supervisor' | 'admin';

export type OnTrackStatus = 'on_track' | 'at_risk' | 'off_track' | 'unknown';

export type HoursSource = 'manual_read_only' | 'stage_labour_read_only' | 'jibble';

export const ON_TRACK_STATUSES: OnTrackStatus[] = ['on_track', 'at_risk', 'off_track', 'unknown'];

export const DAILY_SITE_UPDATE_MAX_FIELD_LENGTH = 5000;

export const NO_ACTIVE_STAGE_WARNING =
  'No active stage is set. This update has been saved at job level only. Set an active stage to enable stage-level progress context.';

export interface DailySiteUpdatePostInput {
  progressToday?: unknown;
  issuesFaced?: unknown;
  issuesFacedNone?: unknown;
  problemsResolved?: unknown;
  problemsResolvedNone?: unknown;
  preventionPlan?: unknown;
  preventionPlanNone?: unknown;
  onTrackStatus?: unknown;
  onTrackNotes?: unknown;
  reportDate?: unknown;
}

export interface ParsedDailySiteUpdatePost {
  progressToday: string;
  issuesFaced: string;
  issuesFacedNone: boolean;
  problemsResolved: string;
  problemsResolvedNone: boolean;
  preventionPlan: string;
  preventionPlanNone: boolean;
  onTrackStatus: OnTrackStatus;
  onTrackNotes: string | null;
  reportDate: string;
}

export interface ProgressContextSnapshot {
  plannedHours: number | null;
  hoursUsed: number | null;
  hoursRemaining: number | null;
  hoursSource: HoursSource | null;
}

export interface ProgressContextDbSnapshot {
  planned_hours_snapshot: number | null;
  hours_used_snapshot: number | null;
  hours_remaining_snapshot: number | null;
  hours_source: HoursSource | null;
}

export type DailySiteUpdateDbRow = {
  id: string;
  job_id: string;
  stage_id: string | null;
  author_staff_profile_id: string;
  report_date: string;
  report_timezone: string;
  submitted_at: string;
  created_at: string;
  progress_today: string;
  issues_faced: string;
  issues_faced_none: boolean;
  problems_resolved: string;
  problems_resolved_none: boolean;
  prevention_plan: string;
  prevention_plan_none: boolean;
  on_track_status: OnTrackStatus;
  on_track_notes: string | null;
  planned_hours_snapshot: number | null;
  hours_used_snapshot: number | null;
  hours_remaining_snapshot: number | null;
  hours_source: HoursSource | null;
  supersedes_update_id: string | null;
  voided_at: string | null;
  voided_by_staff_profile_id: string | null;
  void_reason: string | null;
  daily_plan_id?: string | null;
  notes_for_tomorrow?: string | null;
  is_day_completion?: boolean | null;
  submission_status?: 'draft' | 'submitted' | null;
  staff_profiles?: { full_name: string } | { full_name: string }[] | null;
  stages?: { name: string } | { name: string }[] | null;
};

export type DailySiteUpdateApiRow = {
  id: string;
  jobId: string;
  stageId: string | null;
  stageName: string | null;
  authorStaffProfileId: string;
  authorName: string;
  reportDate: string;
  reportTimezone: string;
  submittedAt: string;
  createdAt: string;
  progressToday: string;
  issuesFaced: string;
  issuesFacedNone: boolean;
  problemsResolved: string;
  problemsResolvedNone: boolean;
  preventionPlan: string;
  preventionPlanNone: boolean;
  onTrackStatus: OnTrackStatus;
  onTrackNotes: string | null;
  plannedHoursSnapshot: number | null;
  hoursUsedSnapshot: number | null;
  hoursRemainingSnapshot: number | null;
  hoursSource: HoursSource | null;
  voidedAt: string | null;
  voidReason: string | null;
  canVoid: boolean;
  dailyPlanId: string | null;
  notesForTomorrow: string | null;
  isDayCompletion: boolean;
  submissionStatus: 'draft' | 'submitted';
};

function trimField(value: unknown, maxLen = DAILY_SITE_UPDATE_MAX_FIELD_LENGTH): string {
  return String(value ?? '').trim().slice(0, maxLen);
}

function parseBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function canVoidDailySiteUpdate(role: StaffRole): boolean {
  return role === 'supervisor' || role === 'admin';
}

export function parseDailySiteUpdatePostBody(
  body: DailySiteUpdatePostInput,
  reportTimezone: string,
  todayInTimezone: () => string
): { ok: true; data: ParsedDailySiteUpdatePost } | { ok: false; message: string } {
  const progressToday = trimField(body.progressToday);
  if (!progressToday) {
    return { ok: false, message: 'What progress was made today is required' };
  }

  const issuesFacedNone = parseBooleanFlag(body.issuesFacedNone);
  const problemsResolvedNone = parseBooleanFlag(body.problemsResolvedNone);
  const preventionPlanNone = parseBooleanFlag(body.preventionPlanNone);

  const issuesFaced = trimField(body.issuesFaced);
  const problemsResolved = trimField(body.problemsResolved);
  const preventionPlan = trimField(body.preventionPlan);

  if (!issuesFacedNone && !issuesFaced) {
    return { ok: false, message: 'Describe issues faced today or select No issues today' };
  }
  if (!problemsResolvedNone && !problemsResolved) {
    return { ok: false, message: 'Describe problems resolved today or select Nothing resolved today' };
  }
  if (!preventionPlanNone && !preventionPlan) {
    return {
      ok: false,
      message: 'Describe prevention actions or select No prevention action required',
    };
  }

  const onTrackStatusRaw = trimField(body.onTrackStatus);
  if (!ON_TRACK_STATUSES.includes(onTrackStatusRaw as OnTrackStatus)) {
    return { ok: false, message: 'Are we on track requires a valid status' };
  }
  const onTrackStatus = onTrackStatusRaw as OnTrackStatus;

  const onTrackNotesRaw = trimField(body.onTrackNotes);
  const onTrackNotes = onTrackNotesRaw || null;
  if (
    (onTrackStatus === 'at_risk' || onTrackStatus === 'off_track' || onTrackStatus === 'unknown') &&
    !onTrackNotes
  ) {
    return { ok: false, message: 'An explanatory note is required for the selected on-track status' };
  }

  let reportDate =
    body.reportDate == null || String(body.reportDate).trim() === ''
      ? todayInTimezone()
      : String(body.reportDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    reportDate = todayInTimezone();
  }

  void reportTimezone;

  return {
    ok: true,
    data: {
      progressToday,
      issuesFaced: issuesFacedNone ? '' : issuesFaced,
      issuesFacedNone,
      problemsResolved: problemsResolvedNone ? '' : problemsResolved,
      problemsResolvedNone,
      preventionPlan: preventionPlanNone ? '' : preventionPlan,
      preventionPlanNone,
      onTrackStatus,
      onTrackNotes,
      reportDate,
    },
  };
}

export function mapDailySiteUpdateRow(
  row: DailySiteUpdateDbRow,
  viewerRole: StaffRole
): DailySiteUpdateApiRow {
  const profile = Array.isArray(row.staff_profiles) ? row.staff_profiles[0] : row.staff_profiles;
  const stage = Array.isArray(row.stages) ? row.stages[0] : row.stages;

  return {
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    stageName: stage?.name ?? null,
    authorStaffProfileId: row.author_staff_profile_id,
    authorName: profile?.full_name ?? 'Unknown staff member',
    reportDate: row.report_date,
    reportTimezone: row.report_timezone,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    progressToday: row.progress_today,
    issuesFaced: row.issues_faced,
    issuesFacedNone: row.issues_faced_none,
    problemsResolved: row.problems_resolved,
    problemsResolvedNone: row.problems_resolved_none,
    preventionPlan: row.prevention_plan,
    preventionPlanNone: row.prevention_plan_none,
    onTrackStatus: row.on_track_status,
    onTrackNotes: row.on_track_notes,
    plannedHoursSnapshot:
      row.planned_hours_snapshot == null ? null : Number(row.planned_hours_snapshot),
    hoursUsedSnapshot: row.hours_used_snapshot == null ? null : Number(row.hours_used_snapshot),
    hoursRemainingSnapshot:
      row.hours_remaining_snapshot == null ? null : Number(row.hours_remaining_snapshot),
    hoursSource: row.hours_source,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    canVoid: canVoidDailySiteUpdate(viewerRole) && row.voided_at == null,
    dailyPlanId: row.daily_plan_id ?? null,
    notesForTomorrow: row.notes_for_tomorrow ?? null,
    isDayCompletion: row.is_day_completion === true,
    submissionStatus: row.submission_status === 'draft' ? 'draft' : 'submitted',
  };
}

export function progressContextToDbSnapshot(
  snapshot: ProgressContextSnapshot
): ProgressContextDbSnapshot {
  return {
    planned_hours_snapshot: snapshot.plannedHours,
    hours_used_snapshot: snapshot.hoursUsed,
    hours_remaining_snapshot: snapshot.hoursRemaining,
    hours_source: snapshot.hoursSource,
  };
}
