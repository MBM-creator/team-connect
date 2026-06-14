import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError, isValidUuid } from '@/lib/job-org-validation';
import { guardStaffApi } from '@/lib/guard-staff-api';
import {
  type IssueSnapshot,
  type SubmissionSnapshot,
} from '@/lib/qa-evidence-graph';
import {
  getApplicableV2SectionCodes,
  getV2SectionDefinition,
  getV2SectionItemsForSetup,
  isV2SectionCode,
  type PavingSectionCodeV2,
} from '@/lib/paving-qa-v2-catalog';
import {
  getApplicableIrrigationSectionCodes,
  getIrrigationSectionDefinition,
  isIrrigationSectionCode,
  type IrrigationSectionCode,
} from '@/lib/irrigation-qa-v1-catalog';
import {
  getApplicableFencingSectionCodes,
  getFencingSectionDefinition,
  getFencingSectionItemsForSetup,
  isFencingSectionCode,
  type FencingSectionCode,
} from '@/lib/fencing-qa-v1-catalog';
import {
  getApplicableSignoffSectionCodes,
  getSignoffSectionDefinition,
  isSignoffSectionCode,
  type SignoffSectionCode,
} from '@/lib/signoff-qa-v1-catalog';
import { validateSetupV2 } from '@/lib/paving-qa-v2-setup';
import { validateIrrigationSetupV1 } from '@/lib/irrigation-qa-v1-setup';
import { validateFencingSetupV1 } from '@/lib/fencing-qa-v1-setup';
import { validateSignoffSetupV1 } from '@/lib/signoff-qa-v1-setup';
import { computeV2SectionUiStates } from '@/lib/paving-qa-v2-graph';
import { computeIrrigationSectionUiStates } from '@/lib/irrigation-qa-v1-graph';
import { computeFencingSectionUiStates } from '@/lib/fencing-qa-v1-graph';
import { computeSignoffSectionUiStates } from '@/lib/signoff-qa-v1-graph';
import { validateCrewSectionPayloadIrrigation, validateCrewSectionPayloadV2 } from '@/lib/paving-qa-submit-validation';
import { newImageStorageFileName, pavingQaPhotoStoragePath, qaEvidencePhotoStoragePath } from '@/lib/storage-paths';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';
const MAX_PHOTOS_PER_SECTION = 40;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function conflictError(message: string, blockers: unknown, requestId: string) {
  const res = NextResponse.json({ ok: false, message, blockers }, { status: 409 });
  res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(requestId: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

async function loadSubmissionsAndIssues(runId: string): Promise<{
  submissions: SubmissionSnapshot[];
  issues: IssueSnapshot[];
  photoRows: { section_code: string; item_key: string }[];
}> {
  const { data: subRows } = await supabaseAdmin
    .from('paving_qa_section_submissions')
    .select('section_code, submission_status, answers, submitted_at')
    .eq('run_id', runId);

  const submissions: SubmissionSnapshot[] = (subRows ?? []).map((r) => ({
    section_code: r.section_code as string,
    submission_status: r.submission_status as string,
    answers: (r.answers as Record<string, { result?: string; note?: string }>) ?? {},
    submitted_at: r.submitted_at as string | null | undefined,
  }));

  const { data: issueRows } = await supabaseAdmin
    .from('paving_qa_issues')
    .select('id, section_code, item_key, severity, status, title')
    .eq('run_id', runId);

  const issues: IssueSnapshot[] = (issueRows ?? []).map((r) => ({
    id: r.id as string,
    section_code: r.section_code as string,
    item_key: r.item_key as string,
    severity: r.severity as string,
    status: r.status as string,
    title: (r.title as string) ?? null,
  }));

  const { data: photoRows } = await supabaseAdmin
    .from('paving_qa_photos')
    .select('section_code, item_key')
    .eq('run_id', runId);

  return {
    submissions,
    issues,
    photoRows: (photoRows ?? []) as { section_code: string; item_key: string }[],
  };
}

function validateFiles(
  filesByItem: Map<string, File[]>
): { ok: true } | { ok: false; message: string } {
  let total = 0;
  for (const [, files] of filesByItem) {
    total += files.length;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) return { ok: false, message: 'Each photo must be at most 8MB' };
      const mt = (file.type || 'image/jpeg').toLowerCase();
      if (!ALLOWED_MIME.has(mt)) return { ok: false, message: `Unsupported image type: ${mt}` };
    }
  }
  if (total > MAX_PHOTOS_PER_SECTION) {
    return { ok: false, message: `At most ${MAX_PHOTOS_PER_SECTION} new photos per submit` };
  }
  return { ok: true };
}

function isUploadOnlyRequest(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get('uploadOnly') === '1';
}

async function handleUploadOnlyPhotos(
  runId: string,
  sectionCode: string,
  jobId: string,
  jobName: string,
  filesByItem: Map<string, File[]>,
  staffId: string,
  requestId: string,
  qaType: 'paving' | 'irrigation' | 'fencing' | 'sign_off' = 'paving'
): Promise<NextResponse> {
  if (filesByItem.size === 0) {
    return jsonError('No photos to upload', 400, requestId);
  }
  const fileCheck = validateFiles(filesByItem);
  if (!fileCheck.ok) return jsonError(fileCheck.message, 400, requestId);

  const photoErr = await uploadSectionPhotos(
    runId,
    sectionCode,
    jobId,
    jobName,
    filesByItem,
    staffId,
    requestId,
    false,
    qaType
  );
  if (photoErr) return photoErr;

  const res = NextResponse.json({ ok: true, uploadOnly: true });
  res.headers.set('x-request-id', requestId);
  return res;
}

/**
 * Upload photos for a section.
 *
 * v1 (deleteExisting = true):  delete all existing photos for the section, then upload.
 * v2 (deleteExisting = false): append new photos only — existing evidence is preserved.
 */
async function uploadSectionPhotos(
  runId: string,
  sectionCode: string,
  jobId: string,
  jobName: string,
  filesByItem: Map<string, File[]>,
  staffId: string,
  requestId: string,
  deleteExisting = true,
  qaType: 'paving' | 'irrigation' | 'fencing' | 'sign_off' = 'paving'
): Promise<NextResponse | null> {
  if (deleteExisting) {
    // v1 replace-mode: remove existing photos before uploading new ones
    const { data: existingPhotoRows } = await supabaseAdmin
      .from('paving_qa_photos')
      .select('id, storage_path')
      .eq('run_id', runId)
      .eq('section_code', sectionCode);

    const pathsToRemove = (existingPhotoRows ?? []).map((r) => r.storage_path as string);
    if (pathsToRemove.length > 0) {
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove(pathsToRemove);
      if (rmErr) console.warn('[qa/submit] storage remove', { requestId, rmErr });
      await supabaseAdmin.from('paving_qa_photos').delete().eq('run_id', runId).eq('section_code', sectionCode);
    }
  }

  // Upload new photos
  for (const [itemKey, files] of filesByItem) {
    for (const file of files) {
      const fileName = newImageStorageFileName();
      const storagePath = qaType === 'irrigation' || qaType === 'fencing' || qaType === 'sign_off'
        ? qaEvidencePhotoStoragePath(qaType, jobId, jobName, runId, sectionCode, itemKey, fileName)
        : pavingQaPhotoStoragePath(jobId, jobName, runId, sectionCode, itemKey, fileName);
      const buf = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buf, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });
      if (upErr) {
        console.error('[qa/submit] upload', { requestId, storagePath, error: normalizeSupabaseError(upErr) });
        return serverError(requestId, 'Photo upload failed');
      }
      const { error: phErr } = await supabaseAdmin.from('paving_qa_photos').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: itemKey,
        storage_path: storagePath,
        content_type: file.type || 'image/jpeg',
        uploaded_by: staffId,
      });
      if (phErr) {
        console.error('[qa/submit] photo row', { requestId, error: normalizeSupabaseError(phErr) });
        return serverError(requestId, 'Failed to save photo record');
      }
    }
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; runId: string; sectionCode: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, runId, sectionCode: sectionCodeRaw } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug, ['field', 'supervisor', 'admin']);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!isValidUuid(runId)) return jsonError('Run not found', 404, requestId);

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  // Fetch run with setup_version so we can dispatch before section-code validation
  const { data: run, error: runErr } = await supabaseAdmin
    .from('paving_qa_runs')
    .select('id, job_id, status, qa_type, setup, setup_version')
    .eq('id', runId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (runErr || !run) return jsonError('Run not found', 404, requestId);
  if (run.status !== 'active') return jsonError('This run is not active', 409, requestId);

  if ((run as { qa_type?: string | null }).qa_type === 'irrigation') {
    return await handleIrrigationSubmit(
      request, sectionCodeRaw, run, jobId, runId, v.job.name, staffAuth.staff, requestId
    );
  }

  if ((run as { qa_type?: string | null }).qa_type === 'fencing') {
    return await handleFencingSubmit(
      request, sectionCodeRaw, run, jobId, runId, v.job.name, staffAuth.staff, requestId
    );
  }

  if ((run as { qa_type?: string | null }).qa_type === 'sign_off') {
    return await handleSignOffSubmit(
      request, sectionCodeRaw, run, jobId, runId, v.job.name, staffAuth.staff, requestId
    );
  }

  // -------------------------------------------------------------------------
  // V2 dispatch
  // -------------------------------------------------------------------------
  if (run.setup_version === 2) {
    return await handleV2Submit(
      request, sectionCodeRaw, run, jobId, runId, v.job.name, staffAuth.staff, requestId
    );
  }

  return jsonError('Legacy paving QA runs are no longer supported', 409, requestId);
}

// ---------------------------------------------------------------------------
// V2 submit handler
// ---------------------------------------------------------------------------

async function handleV2Submit(
  request: NextRequest,
  sectionCodeRaw: string,
  run: { id: string; job_id: string; status: string; setup: unknown },
  jobId: string,
  runId: string,
  jobName: string,
  staff: { id: string; full_name: string },
  requestId: string
): Promise<NextResponse> {
  // Validate section code is a known v2 code
  if (!isV2SectionCode(sectionCodeRaw)) {
    return jsonError('Unknown v2 section code', 400, requestId);
  }
  const sectionCode = sectionCodeRaw as PavingSectionCodeV2;

  // Parse v2 setup
  const setupResult = validateSetupV2(run.setup);
  if (!setupResult.ok) {
    return serverError(requestId, 'Invalid v2 run setup');
  }
  const setup = setupResult.setup;

  // Validate section is applicable for this setup
  if (!getApplicableV2SectionCodes(setup).includes(sectionCode)) {
    return jsonError('Section is not part of this v2 run', 400, requestId);
  }

  // Load current submissions/issues/photos and compute section states
  const { submissions, issues, photoRows } = await loadSubmissionsAndIssues(runId);
  const sectionStates = computeV2SectionUiStates(setup, submissions, photoRows, issues);
  const myState = sectionStates.find((s) => s.code === sectionCode);

  if (!myState) {
    return jsonError('Section state not found', 400, requestId);
  }

  // Block submission if section is blocked by predecessors
  if (myState.status === 'blocked' && myState.blockedBy && myState.blockedBy.length > 0) {
    return conflictError(
      'Section is blocked by incomplete or unresolved upstream sections',
      { blockedBy: myState.blockedBy },
      requestId
    );
  }

  // Get section definition for item list
  const sectionDef = getV2SectionDefinition(sectionCode);
  if (!sectionDef) {
    return serverError(requestId, 'Section definition not found');
  }
  const sectionItems = getV2SectionItemsForSetup(sectionCode, setup);

  // Parse form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Failed to parse request body', 400, requestId);
  }

  const answersRaw = String(formData.get('answers') ?? '').trim();
  let answers: Record<string, { result?: string; note?: string }> = {};
  if (answersRaw) {
    try {
      const parsed = JSON.parse(answersRaw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        answers = parsed as Record<string, { result?: string; note?: string }>;
      }
    } catch {
      return jsonError('answers must be valid JSON', 400, requestId);
    }
  }

  const filesByItem = new Map<string, File[]>();
  for (const [key, val] of formData.entries()) {
    if (key.startsWith('item_') && val instanceof File && val.size > 0) {
      const itemKey = key.slice('item_'.length);
      if (!itemKey) continue;
      const list = filesByItem.get(itemKey) ?? [];
      list.push(val);
      filesByItem.set(itemKey, list);
    }
  }

  // Validate files
  const fileCheck = validateFiles(filesByItem);
  if (!fileCheck.ok) return jsonError(fileCheck.message, 400, requestId);

  if (isUploadOnlyRequest(request)) {
    return handleUploadOnlyPhotos(
      runId,
      sectionCode,
      jobId,
      jobName,
      filesByItem,
      staff.id,
      requestId,
      'paving'
    );
  }

  // Compute photo counts per item (existing + incoming)
  const photoCountByItem: Record<string, number> = {};
  for (const item of sectionItems) {
    const existing = photoRows.filter(
      (p) => p.section_code === sectionCode && p.item_key === item.key
    ).length;
    const incoming = filesByItem.get(item.key)?.length ?? 0;
    photoCountByItem[item.key] = existing + incoming;
  }

  // Validate payload against v2 items — photo-only items need photos, not pass/fail
  for (const item of sectionItems) {
    if (item.photoOnly) {
      const current = (answers[item.key]?.result ?? '').trim();
      if (item.allowNa && current === 'not_required') {
        answers[item.key] = {
          result: 'not_required',
          note: (answers[item.key]?.note ?? '').trim(),
        };
      } else {
        answers[item.key] = {
          result: 'pass',
          note: (answers[item.key]?.note ?? '').trim(),
        };
      }
    }
  }

  const payloadCheck = validateCrewSectionPayloadV2(sectionItems, answers, photoCountByItem);
  if (!payloadCheck.ok) {
    return NextResponse.json(
      { ok: false, message: 'Validation failed', errors: payloadCheck.errors },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();

  // Upload photos (v2 append mode — existing evidence is never deleted automatically)
  const photoErr = await uploadSectionPhotos(runId, sectionCode, jobId, jobName, filesByItem, staff.id, requestId, false);
  if (photoErr) return photoErr;

  // Upsert submission
  const { error: upsertErr } = await supabaseAdmin.from('paving_qa_section_submissions').upsert(
    {
      run_id: runId,
      section_code: sectionCode,
      submission_status: 'submitted',
      answers,
      submitted_at: submittedAt,
      submitted_by: staff.id,
      updated_at: submittedAt,
    },
    { onConflict: 'run_id,section_code' }
  );
  if (upsertErr) {
    console.error('[qa/submit v2] submission', { requestId, error: normalizeSupabaseError(upsertErr) });
    return serverError(requestId, 'Failed to save submission');
  }

  // Issue management for v2 items.
  // Issues are part of the audit trail and are NEVER deleted automatically.
  // On fail: create a new blocking issue only if no active issue already exists for this run/section/item.
  // On pass or not_required: leave existing issues in place — a supervisor/admin must resolve them.
  for (const item of sectionItems) {
    const r = (answers[item.key]?.result ?? '').trim();
    if (r !== 'fail') continue;

    // Guard against duplicate active issues for the same run/section/item
    const { data: existing } = await supabaseAdmin
      .from('paving_qa_issues')
      .select('id')
      .eq('run_id', runId)
      .eq('section_code', sectionCode)
      .eq('item_key', item.key)
      .in('status', ['open', 'rectification_required', 'evidence_requested'])
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    if (item.criticalOnFail) {
      const { error: issErr } = await supabaseAdmin.from('paving_qa_issues').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: item.key,
        severity: 'critical',
        status: 'open',
        title: item.label,
        detail: (answers[item.key]?.note ?? '').trim() || null,
      });
      if (issErr) console.error('[qa/submit v2] issue critical', { requestId, error: normalizeSupabaseError(issErr) });
    } else if (item.requireSupervisorOnFail) {
      const { error: issErr } = await supabaseAdmin.from('paving_qa_issues').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: item.key,
        severity: 'non_critical',
        status: 'open',
        title: item.label,
        detail: (answers[item.key]?.note ?? '').trim() || null,
      });
      if (issErr) console.error('[qa/submit v2] issue nc', { requestId, error: normalizeSupabaseError(issErr) });
    }
  }

  await supabaseAdmin.from('paving_qa_runs').update({ updated_at: submittedAt }).eq('id', runId);

  const res = NextResponse.json({ ok: true, submittedAt, actorDisplay: staff.full_name, sectionCode });
  res.headers.set('x-request-id', requestId);
  return res;
}

// ---------------------------------------------------------------------------
// Irrigation submit handler
// ---------------------------------------------------------------------------

async function handleIrrigationSubmit(
  request: NextRequest,
  sectionCodeRaw: string,
  run: { id: string; job_id: string; status: string; setup: unknown },
  jobId: string,
  runId: string,
  jobName: string,
  staff: { id: string; full_name: string },
  requestId: string
): Promise<NextResponse> {
  if (!isIrrigationSectionCode(sectionCodeRaw)) {
    return jsonError('Unknown irrigation section code', 400, requestId);
  }
  const sectionCode = sectionCodeRaw as IrrigationSectionCode;

  const setupResult = validateIrrigationSetupV1(run.setup);
  if (!setupResult.ok) return serverError(requestId, 'Invalid irrigation run setup');
  const setup = setupResult.setup;

  if (!getApplicableIrrigationSectionCodes(setup).includes(sectionCode)) {
    return jsonError('Section is not part of this irrigation run', 400, requestId);
  }

  const { submissions, issues, photoRows } = await loadSubmissionsAndIssues(runId);
  const sectionStates = computeIrrigationSectionUiStates(setup, submissions, photoRows, issues);
  const myState = sectionStates.find((s) => s.code === sectionCode);
  if (!myState) return jsonError('Section state not found', 400, requestId);
  if (myState.status === 'blocked_by_unresolved_issue' && myState.blockedBy?.length) {
    return conflictError(
      'Section is blocked by incomplete or unresolved upstream sections',
      { blockedBy: myState.blockedBy },
      requestId
    );
  }

  const sectionDef = getIrrigationSectionDefinition(sectionCode);
  if (!sectionDef) return serverError(requestId, 'Section definition not found');

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Failed to parse request body', 400, requestId);
  }

  const answersRaw = String(formData.get('answers') ?? '').trim();
  let answers: Record<string, { result?: string; note?: string }> = {};
  if (answersRaw) {
    try {
      const parsed = JSON.parse(answersRaw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        answers = parsed as Record<string, { result?: string; note?: string }>;
      }
    } catch {
      return jsonError('answers must be valid JSON', 400, requestId);
    }
  }

  const filesByItem = new Map<string, File[]>();
  for (const [key, val] of formData.entries()) {
    if (key.startsWith('item_') && val instanceof File && val.size > 0) {
      const itemKey = key.slice('item_'.length);
      const list = filesByItem.get(itemKey) ?? [];
      list.push(val);
      filesByItem.set(itemKey, list);
    }
  }

  const fileCheck = validateFiles(filesByItem);
  if (!fileCheck.ok) return jsonError(fileCheck.message, 400, requestId);

  if (isUploadOnlyRequest(request)) {
    return handleUploadOnlyPhotos(
      runId,
      sectionCode,
      jobId,
      jobName,
      filesByItem,
      staff.id,
      requestId,
      'irrigation'
    );
  }

  const photoCountByItem: Record<string, number> = {};
  for (const item of sectionDef.items) {
    const existing = photoRows.filter(
      (p) => p.section_code === sectionCode && p.item_key === item.key
    ).length;
    const incoming = filesByItem.get(item.key)?.length ?? 0;
    photoCountByItem[item.key] = existing + incoming;
  }

  const payloadCheck = validateCrewSectionPayloadIrrigation(sectionDef.items, answers, photoCountByItem);
  if (!payloadCheck.ok) {
    return NextResponse.json(
      { ok: false, message: 'Validation failed', errors: payloadCheck.errors },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const photoErr = await uploadSectionPhotos(
    runId,
    sectionCode,
    jobId,
    jobName,
    filesByItem,
    staff.id,
    requestId,
    false,
    'irrigation'
  );
  if (photoErr) return photoErr;

  const { error: upsertErr } = await supabaseAdmin.from('paving_qa_section_submissions').upsert(
    {
      run_id: runId,
      section_code: sectionCode,
      submission_status: 'submitted',
      answers,
      submitted_at: submittedAt,
      submitted_by: staff.id,
      updated_at: submittedAt,
    },
    { onConflict: 'run_id,section_code' }
  );
  if (upsertErr) {
    console.error('[qa/submit irrigation] submission', { requestId, error: normalizeSupabaseError(upsertErr) });
    return serverError(requestId, 'Failed to save submission');
  }

  for (const item of sectionDef.items) {
    const r = (answers[item.key]?.result ?? '').trim();
    if (r !== 'fail') continue;

    const { data: existing } = await supabaseAdmin
      .from('paving_qa_issues')
      .select('id')
      .eq('run_id', runId)
      .eq('section_code', sectionCode)
      .eq('item_key', item.key)
      .in('status', ['open', 'rectification_required', 'evidence_requested'])
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    if (item.criticalOnFail || item.requireSupervisorOnFail) {
      const { error: issErr } = await supabaseAdmin.from('paving_qa_issues').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: item.key,
        severity: item.criticalOnFail ? 'critical' : 'non_critical',
        status: 'open',
        title: item.label,
        detail: (answers[item.key]?.note ?? '').trim() || null,
      });
      if (issErr) console.error('[qa/submit irrigation] issue', { requestId, error: normalizeSupabaseError(issErr) });
    }
  }

  await supabaseAdmin.from('paving_qa_runs').update({ updated_at: submittedAt }).eq('id', runId);

  const res = NextResponse.json({ ok: true, submittedAt, actorDisplay: staff.full_name, sectionCode });
  res.headers.set('x-request-id', requestId);
  return res;
}

// ---------------------------------------------------------------------------
// Fencing submit handler
// ---------------------------------------------------------------------------

async function handleFencingSubmit(
  request: NextRequest,
  sectionCodeRaw: string,
  run: { id: string; job_id: string; status: string; setup: unknown },
  jobId: string,
  runId: string,
  jobName: string,
  staff: { id: string; full_name: string },
  requestId: string
): Promise<NextResponse> {
  if (!isFencingSectionCode(sectionCodeRaw)) {
    return jsonError('Unknown fencing section code', 400, requestId);
  }
  const sectionCode = sectionCodeRaw as FencingSectionCode;

  const setupResult = validateFencingSetupV1(run.setup);
  if (!setupResult.ok) return serverError(requestId, 'Invalid fencing run setup');
  const setup = setupResult.setup;

  if (!getApplicableFencingSectionCodes(setup).includes(sectionCode)) {
    return jsonError('Section is not part of this fencing run', 400, requestId);
  }

  const { submissions, issues, photoRows } = await loadSubmissionsAndIssues(runId);
  const sectionStates = computeFencingSectionUiStates(setup, submissions, photoRows, issues);
  const myState = sectionStates.find((s) => s.code === sectionCode);
  if (!myState) return jsonError('Section state not found', 400, requestId);
  if (myState.status === 'blocked_by_unresolved_issue' && myState.blockedBy?.length) {
    return conflictError(
      'Section is blocked by incomplete or unresolved upstream sections',
      { blockedBy: myState.blockedBy },
      requestId
    );
  }

  const sectionDef = getFencingSectionDefinition(sectionCode);
  if (!sectionDef) return serverError(requestId, 'Section definition not found');
  const sectionItems = getFencingSectionItemsForSetup(sectionCode, setup);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Failed to parse request body', 400, requestId);
  }

  const answersRaw = String(formData.get('answers') ?? '').trim();
  let answers: Record<string, { result?: string; note?: string }> = {};
  if (answersRaw) {
    try {
      const parsed = JSON.parse(answersRaw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        answers = parsed as Record<string, { result?: string; note?: string }>;
      }
    } catch {
      return jsonError('answers must be valid JSON', 400, requestId);
    }
  }

  const filesByItem = new Map<string, File[]>();
  for (const [key, val] of formData.entries()) {
    if (key.startsWith('item_') && val instanceof File && val.size > 0) {
      const itemKey = key.slice('item_'.length);
      const list = filesByItem.get(itemKey) ?? [];
      list.push(val);
      filesByItem.set(itemKey, list);
    }
  }

  const fileCheck = validateFiles(filesByItem);
  if (!fileCheck.ok) return jsonError(fileCheck.message, 400, requestId);

  if (isUploadOnlyRequest(request)) {
    return handleUploadOnlyPhotos(
      runId,
      sectionCode,
      jobId,
      jobName,
      filesByItem,
      staff.id,
      requestId,
      'fencing'
    );
  }

  const photoCountByItem: Record<string, number> = {};
  for (const item of sectionItems) {
    const existing = photoRows.filter(
      (p) => p.section_code === sectionCode && p.item_key === item.key
    ).length;
    const incoming = filesByItem.get(item.key)?.length ?? 0;
    photoCountByItem[item.key] = existing + incoming;
  }

  const payloadCheck = validateCrewSectionPayloadIrrigation(sectionItems, answers, photoCountByItem);
  if (!payloadCheck.ok) {
    return NextResponse.json(
      { ok: false, message: 'Validation failed', errors: payloadCheck.errors },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const photoErr = await uploadSectionPhotos(
    runId,
    sectionCode,
    jobId,
    jobName,
    filesByItem,
    staff.id,
    requestId,
    false,
    'fencing'
  );
  if (photoErr) return photoErr;

  const { error: upsertErr } = await supabaseAdmin.from('paving_qa_section_submissions').upsert(
    {
      run_id: runId,
      section_code: sectionCode,
      submission_status: 'submitted',
      answers,
      submitted_at: submittedAt,
      submitted_by: staff.id,
      updated_at: submittedAt,
    },
    { onConflict: 'run_id,section_code' }
  );
  if (upsertErr) {
    console.error('[qa/submit fencing] submission', { requestId, error: normalizeSupabaseError(upsertErr) });
    return serverError(requestId, 'Failed to save submission');
  }

  for (const item of sectionDef.items) {
    const r = (answers[item.key]?.result ?? '').trim();
    if (r !== 'fail') continue;

    const { data: existing } = await supabaseAdmin
      .from('paving_qa_issues')
      .select('id')
      .eq('run_id', runId)
      .eq('section_code', sectionCode)
      .eq('item_key', item.key)
      .in('status', ['open', 'rectification_required', 'evidence_requested'])
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    if (item.criticalOnFail || item.requireSupervisorOnFail) {
      const { error: issErr } = await supabaseAdmin.from('paving_qa_issues').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: item.key,
        severity: item.criticalOnFail ? 'critical' : 'non_critical',
        status: 'open',
        title: item.label,
        detail: (answers[item.key]?.note ?? '').trim() || null,
      });
      if (issErr) console.error('[qa/submit fencing] issue', { requestId, error: normalizeSupabaseError(issErr) });
    }
  }

  await supabaseAdmin.from('paving_qa_runs').update({ updated_at: submittedAt }).eq('id', runId);

  const res = NextResponse.json({ ok: true, submittedAt, actorDisplay: staff.full_name, sectionCode });
  res.headers.set('x-request-id', requestId);
  return res;
}

// ---------------------------------------------------------------------------
// Sign-off submit handler
// ---------------------------------------------------------------------------

async function handleSignOffSubmit(
  request: NextRequest,
  sectionCodeRaw: string,
  run: { id: string; job_id: string; status: string; setup: unknown },
  jobId: string,
  runId: string,
  jobName: string,
  staff: { id: string; full_name: string },
  requestId: string
): Promise<NextResponse> {
  if (!isSignoffSectionCode(sectionCodeRaw)) {
    return jsonError('Unknown sign-off section code', 400, requestId);
  }
  const sectionCode = sectionCodeRaw as SignoffSectionCode;

  const setupResult = validateSignoffSetupV1(run.setup);
  if (!setupResult.ok) return serverError(requestId, 'Invalid sign-off run setup');
  const setup = setupResult.setup;

  if (!getApplicableSignoffSectionCodes(setup).includes(sectionCode)) {
    return jsonError('Section is not part of this sign-off run', 400, requestId);
  }

  const { submissions, issues, photoRows } = await loadSubmissionsAndIssues(runId);
  const sectionStates = computeSignoffSectionUiStates(setup, submissions, photoRows, issues);
  const myState = sectionStates.find((s) => s.code === sectionCode);
  if (!myState) return jsonError('Section state not found', 400, requestId);
  if (myState.status === 'blocked_by_unresolved_issue' && myState.blockedBy?.length) {
    return conflictError(
      'Section is blocked by incomplete or unresolved upstream sections',
      { blockedBy: myState.blockedBy },
      requestId
    );
  }

  const sectionDef = getSignoffSectionDefinition(sectionCode);
  if (!sectionDef) return serverError(requestId, 'Section definition not found');

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Failed to parse request body', 400, requestId);
  }

  const answersRaw = String(formData.get('answers') ?? '').trim();
  let answers: Record<string, { result?: string; note?: string }> = {};
  if (answersRaw) {
    try {
      const parsed = JSON.parse(answersRaw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        answers = parsed as Record<string, { result?: string; note?: string }>;
      }
    } catch {
      return jsonError('answers must be valid JSON', 400, requestId);
    }
  }

  const filesByItem = new Map<string, File[]>();
  for (const [key, val] of formData.entries()) {
    if (key.startsWith('item_') && val instanceof File && val.size > 0) {
      const itemKey = key.slice('item_'.length);
      const list = filesByItem.get(itemKey) ?? [];
      list.push(val);
      filesByItem.set(itemKey, list);
    }
  }

  const fileCheck = validateFiles(filesByItem);
  if (!fileCheck.ok) return jsonError(fileCheck.message, 400, requestId);

  if (isUploadOnlyRequest(request)) {
    return handleUploadOnlyPhotos(
      runId,
      sectionCode,
      jobId,
      jobName,
      filesByItem,
      staff.id,
      requestId,
      'sign_off'
    );
  }

  const photoCountByItem: Record<string, number> = {};
  for (const item of sectionDef.items) {
    const existing = photoRows.filter(
      (p) => p.section_code === sectionCode && p.item_key === item.key
    ).length;
    const incoming = filesByItem.get(item.key)?.length ?? 0;
    photoCountByItem[item.key] = existing + incoming;
  }

  const payloadCheck = validateCrewSectionPayloadIrrigation(sectionDef.items, answers, photoCountByItem);
  if (!payloadCheck.ok) {
    return NextResponse.json(
      { ok: false, message: 'Validation failed', errors: payloadCheck.errors },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const photoErr = await uploadSectionPhotos(
    runId,
    sectionCode,
    jobId,
    jobName,
    filesByItem,
    staff.id,
    requestId,
    false,
    'sign_off'
  );
  if (photoErr) return photoErr;

  const { error: upsertErr } = await supabaseAdmin.from('paving_qa_section_submissions').upsert(
    {
      run_id: runId,
      section_code: sectionCode,
      submission_status: 'submitted',
      answers,
      submitted_at: submittedAt,
      submitted_by: staff.id,
      updated_at: submittedAt,
    },
    { onConflict: 'run_id,section_code' }
  );
  if (upsertErr) {
    console.error('[qa/submit sign_off] submission', { requestId, error: normalizeSupabaseError(upsertErr) });
    return serverError(requestId, 'Failed to save submission');
  }

  for (const item of sectionDef.items) {
    const r = (answers[item.key]?.result ?? '').trim();
    if (r !== 'fail') continue;

    const { data: existing } = await supabaseAdmin
      .from('paving_qa_issues')
      .select('id')
      .eq('run_id', runId)
      .eq('section_code', sectionCode)
      .eq('item_key', item.key)
      .in('status', ['open', 'rectification_required', 'evidence_requested'])
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    if (item.criticalOnFail || item.requireSupervisorOnFail) {
      const { error: issErr } = await supabaseAdmin.from('paving_qa_issues').insert({
        run_id: runId,
        section_code: sectionCode,
        item_key: item.key,
        severity: item.criticalOnFail ? 'critical' : 'non_critical',
        status: 'open',
        title: item.label,
        detail: (answers[item.key]?.note ?? '').trim() || null,
      });
      if (issErr) console.error('[qa/submit sign_off] issue', { requestId, error: normalizeSupabaseError(issErr) });
    }
  }

  await supabaseAdmin.from('paving_qa_runs').update({ updated_at: submittedAt }).eq('id', runId);

  const res = NextResponse.json({ ok: true, submittedAt, actorDisplay: staff.full_name, sectionCode });
  res.headers.set('x-request-id', requestId);
  return res;
}
