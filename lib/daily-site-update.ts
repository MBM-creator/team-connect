import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadQaRunBundle } from '@/lib/qa-run-bundle';
import { v2RunHasIncompleteEvidence } from '@/lib/paving-qa-v2-graph';
import { irrigationRunHasIncompleteEvidence } from '@/lib/irrigation-qa-v1-graph';
import { fencingRunHasIncompleteEvidence } from '@/lib/fencing-qa-v1-graph';
import { signoffRunHasIncompleteEvidence } from '@/lib/signoff-qa-v1-graph';
import { resolveReportTimezone, todayReportDate } from '@/lib/report-date';
import {
  parseDailySiteUpdatePostBody,
  type DailySiteUpdatePostInput,
  type ProgressContextSnapshot,
} from '@/lib/daily-site-update-shared';

export {
  canVoidDailySiteUpdate,
  DAILY_SITE_UPDATE_MAX_FIELD_LENGTH,
  mapDailySiteUpdateRow,
  NO_ACTIVE_STAGE_WARNING,
  ON_TRACK_STATUSES,
  progressContextToDbSnapshot,
  type DailySiteUpdateApiRow,
  type DailySiteUpdateDbRow,
  type HoursSource,
  type OnTrackStatus,
  type ParsedDailySiteUpdatePost,
  type ProgressContextDbSnapshot,
  type ProgressContextSnapshot,
  type StaffRole,
} from '@/lib/daily-site-update-shared';

export function resolveDailySiteUpdateTimezone(orgTimezone?: string | null): string {
  return resolveReportTimezone(orgTimezone);
}

export function parseDailySiteUpdatePostBodyForApi(
  body: DailySiteUpdatePostInput,
  orgTimezone?: string | null
) {
  const tz = resolveDailySiteUpdateTimezone(orgTimezone);
  return parseDailySiteUpdatePostBody(body, tz, () => todayReportDate(tz));
}

export async function readProgressContextSnapshot(
  stageId: string | null
): Promise<ProgressContextSnapshot> {
  if (!stageId) {
    return {
      plannedHours: null,
      hoursUsed: null,
      hoursRemaining: null,
      hoursSource: null,
    };
  }

  const { data: stage, error: stageError } = await supabaseAdmin
    .from('stages')
    .select('quoted_labour_hours')
    .eq('id', stageId)
    .maybeSingle();

  if (stageError || !stage) {
    return {
      plannedHours: null,
      hoursUsed: null,
      hoursRemaining: null,
      hoursSource: null,
    };
  }

  let plannedHours: number | null = null;
  const quotedRaw = stage.quoted_labour_hours;
  if (quotedRaw != null && !Number.isNaN(Number(quotedRaw)) && Number(quotedRaw) >= 0) {
    plannedHours = Number(quotedRaw);
  }

  let hoursUsed: number | null = null;
  const { data: labourRows, error: labourErr } = await supabaseAdmin
    .from('stage_labour')
    .select('labour_hours')
    .eq('stage_id', stageId);

  if (!labourErr && Array.isArray(labourRows) && labourRows.length > 0) {
    let total = 0;
    for (const row of labourRows) {
      if (row.labour_hours != null) {
        const n = Number(row.labour_hours);
        if (!Number.isNaN(n) && n >= 0) total += n;
      }
    }
    hoursUsed = total;
  }

  let hoursRemaining: number | null = null;
  if (plannedHours != null && hoursUsed != null) {
    hoursRemaining = Math.max(0, plannedHours - hoursUsed);
  } else if (plannedHours != null) {
    hoursRemaining = plannedHours;
  }

  let hoursSource: ProgressContextSnapshot['hoursSource'] = null;
  if (hoursUsed != null) {
    hoursSource = 'stage_labour_read_only';
  } else if (plannedHours != null) {
    hoursSource = 'manual_read_only';
  }

  if (plannedHours == null && hoursUsed == null) {
    return {
      plannedHours: null,
      hoursUsed: null,
      hoursRemaining: null,
      hoursSource: null,
    };
  }

  return {
    plannedHours,
    hoursUsed,
    hoursRemaining,
    hoursSource,
  };
}

export async function loadQaEvidenceWarning(
  jobId: string,
  requestId?: string
): Promise<{ message: string; activeRunId: string; qaType?: string } | null> {
  try {
    const { data: activeQaRows } = await supabaseAdmin
      .from('paving_qa_runs')
      .select('id, qa_type')
      .eq('job_id', jobId)
      .eq('status', 'active');

    for (const activeQa of activeQaRows ?? []) {
      const bundle = await loadQaRunBundle(activeQa.id as string, jobId);
      let hasIncomplete = false;
      let warningMessage = '';
      let qaType = String((activeQa as { qa_type?: string | null }).qa_type ?? 'paving');
      if (bundle.ok && bundle.qaType === 'irrigation') {
        qaType = 'irrigation';
        hasIncomplete = irrigationRunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Irrigation QA evidence is incomplete. Review the irrigation QA run before finishing today\'s work.';
      } else if (bundle.ok && bundle.qaType === 'fencing') {
        qaType = 'fencing';
        hasIncomplete = fencingRunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Fencing QA evidence is incomplete. Review the fencing QA run before finishing today\'s work.';
      } else if (bundle.ok && bundle.qaType === 'sign_off') {
        qaType = 'sign_off';
        hasIncomplete = signoffRunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Supervisor sign-off evidence is incomplete. Review the sign-off run before finishing today\'s work.';
      } else if (bundle.ok && bundle.qaType === 'paving') {
        hasIncomplete = v2RunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Paving QA evidence is incomplete. Review the paving QA run before finishing today\'s work.';
      }
      if (hasIncomplete) {
        return {
          activeRunId: activeQa.id as string,
          qaType,
          message: warningMessage,
        };
      }
    }
  } catch (qaErr) {
    console.warn('[daily-site-update] QA warning skipped:', { requestId, qaErr });
  }
  return null;
}
