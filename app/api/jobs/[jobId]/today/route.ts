import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { loadQaRunBundle } from '@/lib/qa-run-bundle';
import { v2RunHasIncompleteEvidence } from '@/lib/paving-qa-v2-graph';
import { irrigationRunHasIncompleteEvidence } from '@/lib/irrigation-qa-v1-graph';
import { fencingRunHasIncompleteEvidence } from '@/lib/fencing-qa-v1-graph';
import { signoffRunHasIncompleteEvidence } from '@/lib/signoff-qa-v1-graph';
import { loadCcProjectForJob } from '@/lib/cc-project-context';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(
  requestId: string,
  errorCode?: string,
  message = 'Internal server error'
) {
  const body: { ok: false; requestId: string; errorCode?: string; message: string } = {
    ok: false,
    requestId,
    message,
  };
  if (errorCode) body.errorCode = errorCode;
  const res = NextResponse.json(body, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

function normalizeSupabaseError(err: unknown): {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
} {
  if (err === null || err === undefined) {
    return { code: null, message: '', details: null, hint: null };
  }
  const o = err as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' ? o.code : null,
    message: typeof o.message === 'string' ? o.message : String(err),
    details: typeof o.details === 'string' ? o.details : null,
    hint: typeof o.hint === 'string' ? o.hint : null,
  };
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  if (!orgSlug) {
    return jsonError('orgSlug is required', 400, requestId);
  }

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!jobId || !isValidUuid(jobId)) {
    return jsonError('Job not found', 404, requestId);
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id')
    .eq('slug', orgSlug)
    .single();

  if (orgError || !org) {
    const supabaseErr = normalizeSupabaseError(orgError ?? null);
    console.error('[api/jobs/[jobId]/today] Org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message: process.env.NODE_ENV === 'development' && orgError
          ? `Invalid organisation: ${orgError.message}`
          : 'Invalid organisation',
      },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select(
      'id, organisation_id, name, site_id, created_at, active_stage_id, cc_project_id, cc_quote_id, cc_client_id, cc_project_title_snapshot, cc_client_name_snapshot'
    )
    .eq('id', jobId)
    .eq('organisation_id', org.id)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/jobs/[jobId]/today] Job lookup failed:', { requestId, jobId, supabaseError: supabaseErr });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message: process.env.NODE_ENV === 'development' && jobError
          ? `Job not found: ${jobError.message}`
          : 'Job not found',
      },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: stages, error: stagesError } = await supabaseAdmin
    .from('stages')
    .select('id, job_id, name, sort_order, created_at, checklist_template_id, daily_note, daily_note_updated_at, quoted_labour_hours, cc_project_id, cc_section_id, cc_section_name_snapshot, cc_section_trade, checklist_templates(name, checklist_template_items(id, item_type, label, sort_order))')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (stagesError) {
    const supabaseErr = normalizeSupabaseError(stagesError);
    console.error('[api/jobs/[jobId]/today] Stages fetch failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'STAGES_GET', 'Failed to load stages');
  }

  const stagesList = stages ?? [];
  const activeStage =
    job.active_stage_id != null
      ? stagesList.find((s: { id: string }) => s.id === job.active_stage_id) ?? null
      : null;

  let brief: { id: string; job_id: string; content: string | null; updated_at: string } | null = null;
  let briefError: string | null = null;
  const { data: briefRow, error: briefErr } = await supabaseAdmin
    .from('job_briefs')
    .select('id, job_id, content, updated_at')
    .eq('job_id', jobId)
    .maybeSingle();
  if (briefErr) {
    const supabaseErr = normalizeSupabaseError(briefErr);
    console.error('[api/jobs/[jobId]/today] Brief fetch failed:', { requestId, supabaseError: supabaseErr });
    briefError = 'Failed to load job brief';
  } else if (briefRow) {
    brief = briefRow;
  }

  let photos: { id: string; storage_path: string; created_at: string; url: string }[] = [];
  let photosError: string | null = null;
  const { data: photosRows, error: photosListErr } = await supabaseAdmin
    .from('job_pre_commencement_photos')
    .select('id, storage_path, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (photosListErr) {
    const supabaseErr = normalizeSupabaseError(photosListErr);
    console.error('[api/jobs/[jobId]/today] Photos list failed:', { requestId, supabaseError: supabaseErr });
    photosError = 'Failed to load pre-commencement photos';
  } else if (photosRows && photosRows.length > 0) {
    const signedUrlExpiry = 3600;
    const photosWithUrl: { id: string; storage_path: string; created_at: string; url: string }[] = [];
    for (const row of photosRows) {
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, signedUrlExpiry);
      if (signError || !signed?.signedUrl) {
        const supabaseErr = normalizeSupabaseError(signError ?? null);
        console.error('[api/jobs/[jobId]/today] Signed URL failed:', { requestId, storage_path: row.storage_path, supabaseError: supabaseErr });
        photosError = 'Failed to load pre-commencement photos';
        break;
      }
      photosWithUrl.push({ ...row, url: signed.signedUrl });
    }
    if (!photosError) {
      photos = photosWithUrl;
    }
  }

  const completions: Record<string, string> = {};
  if (activeStage?.id) {
    const { data: completionRows, error: completionsErr } = await supabaseAdmin
      .from('stage_checklist_completions')
      .select('checklist_template_item_id, completed_at')
      .eq('stage_id', activeStage.id);
    if (!completionsErr && completionRows) {
      for (const row of completionRows) {
        const id = row.checklist_template_item_id;
        const at = row.completed_at;
        if (typeof id === 'string' && typeof at === 'string') {
          completions[id] = at;
        }
      }
    }
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  let endOfDay: { submitted: boolean; submittedAt: string | null; summary: string | null } = {
    submitted: false,
    submittedAt: null,
    summary: null,
  };
  if (activeStage?.id) {
    const { data: eodRow, error: eodErr } = await supabaseAdmin
      .from('stage_end_of_day')
      .select('submitted_at, summary')
      .eq('stage_id', activeStage.id)
      .eq('report_date', todayUtc)
      .maybeSingle();
    if (!eodErr && eodRow) {
      endOfDay = {
        submitted: true,
        submittedAt: typeof eodRow.submitted_at === 'string' ? eodRow.submitted_at : null,
        summary: typeof eodRow.summary === 'string' ? eodRow.summary : (eodRow.summary === null ? null : String(eodRow.summary)),
      };
    }
  }

  type EndOfDayHistoryEntry = { reportDate: string; submittedAt: string; summary: string | null };
  let endOfDayHistory: EndOfDayHistoryEntry[] = [];
  if (activeStage?.id) {
    const { data: historyRows, error: historyErr } = await supabaseAdmin
      .from('stage_end_of_day')
      .select('report_date, submitted_at, summary')
      .eq('stage_id', activeStage.id)
      .order('report_date', { ascending: false })
      .limit(5);
    if (!historyErr && Array.isArray(historyRows)) {
      endOfDayHistory = historyRows.map((row) => {
        const rawSubmitted = row.submitted_at;
        let submittedAt: string;
        if (typeof rawSubmitted === 'string') {
          submittedAt = rawSubmitted;
        } else if (rawSubmitted instanceof Date) {
          submittedAt = rawSubmitted.toISOString();
        } else {
          submittedAt = '';
        }
        return {
          reportDate: typeof row.report_date === 'string' ? row.report_date : String(row.report_date),
          submittedAt,
          summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
        };
      });
    } else if (historyErr) {
      const supabaseErr = normalizeSupabaseError(historyErr);
      console.error('[api/jobs/[jobId]/today] EOD history fetch failed:', { requestId, supabaseError: supabaseErr });
    }
  }

  let quotedLabourHours: number | null = null;
  let actualLabourHoursTotal = 0;
  if (activeStage?.id) {
    const quotedRaw = activeStage.quoted_labour_hours;
    if (quotedRaw != null && !Number.isNaN(Number(quotedRaw)) && Number(quotedRaw) >= 0) {
      quotedLabourHours = Number(quotedRaw);
    }
    const { data: labourRows, error: labourErr } = await supabaseAdmin
      .from('stage_labour')
      .select('labour_hours')
      .eq('stage_id', activeStage.id);
    if (!labourErr && Array.isArray(labourRows)) {
      for (const row of labourRows) {
        if (row.labour_hours != null) {
          const n = Number(row.labour_hours);
          if (!Number.isNaN(n) && n >= 0) actualLabourHoursTotal += n;
        }
      }
    }
  }

  let qaEodWarning: { message: string; activeRunId: string; qaType?: string } | null = null;
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
          'Irrigation QA evidence is incomplete. Review the irrigation QA run before completing today\'s report.';
      } else if (bundle.ok && bundle.qaType === 'fencing') {
        qaType = 'fencing';
        hasIncomplete = fencingRunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Fencing QA evidence is incomplete. Review the fencing QA run before completing today\'s report.';
      } else if (bundle.ok && bundle.qaType === 'sign_off') {
        qaType = 'sign_off';
        hasIncomplete = signoffRunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Supervisor sign-off evidence is incomplete. Review the sign-off run before completing today\'s report.';
      } else if (bundle.ok && bundle.qaType === 'paving') {
        hasIncomplete = v2RunHasIncompleteEvidence(
          bundle.setup,
          bundle.submissions,
          bundle.photoRows,
          bundle.issues
        );
        warningMessage =
          'Paving QA evidence is incomplete. Review the paving QA run before completing today\'s report.';
      }
      if (hasIncomplete) {
        qaEodWarning = {
          activeRunId: activeQa.id as string,
          qaType,
          message: warningMessage,
        };
        break;
      }
    }
  } catch (qaErr) {
    console.warn('[api/jobs/[jobId]/today] QA warning skipped:', { requestId, qaErr });
  }

  const ccProject = await loadCcProjectForJob(job, requestId);

  const body: {
    ok: true;
    job: typeof job;
    ccProject: Awaited<ReturnType<typeof loadCcProjectForJob>>;
    activeStage: typeof activeStage;
    endOfDay: typeof endOfDay;
    endOfDayHistory: EndOfDayHistoryEntry[];
    brief: typeof brief;
    photos: typeof photos;
    completions: Record<string, string>;
    quotedLabourHours: number | null;
    actualLabourHoursTotal: number;
    briefError?: string | null;
    photosError?: string | null;
    qaEodWarning?: { message: string; activeRunId: string; qaType?: string } | null;
  } = {
    ok: true,
    job,
    ccProject,
    activeStage,
    endOfDay,
    endOfDayHistory,
    brief,
    photos,
    completions,
    quotedLabourHours,
    actualLabourHoursTotal,
  };
  if (briefError != null) body.briefError = briefError;
  if (photosError != null) body.photosError = photosError;
  body.qaEodWarning = qaEodWarning;

  const res = NextResponse.json(body);
  res.headers.set('x-request-id', requestId);
  return res;
}
