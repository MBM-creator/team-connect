import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  JOB_PLAN_MAX_BYTES,
  JOB_PLAN_MAX_PER_JOB,
  isAllowedJobPlanMimeType,
} from '@/lib/job-plans';
import { jobPlanStoragePath, newPlanStorageFileName } from '@/lib/storage-paths';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';
const SIGNED_URL_EXPIRY = 3600;

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message, requestId }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

function serverError(requestId: string, errorCode: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, errorCode, message }, { status: 500 });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) {
    validation.headers.set('x-request-id', requestId);
    return validation;
  }

  const { data: plans, error: plansError } = await supabaseAdmin
    .from('job_plan_documents')
    .select('id, job_id, storage_path, file_name, mime_type, file_size_bytes, uploaded_by, created_at')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (plansError) {
    const supabaseErr = normalizeSupabaseError(plansError);
    console.error('[api/jobs/[jobId]/plans] GET list failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'PLANS_LIST', 'Failed to list plans');
  }

  const list = plans ?? [];
  const plansWithUrl: Array<{
    id: string;
    job_id: string;
    storage_path: string;
    file_name: string | null;
    mime_type: string;
    file_size_bytes: number;
    uploaded_by: string | null;
    created_at: string;
    url: string;
  }> = [];

  for (const row of list) {
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_EXPIRY);
    if (signError || !signed?.signedUrl) {
      const supabaseErr = normalizeSupabaseError(signError ?? null);
      console.error('[api/jobs/[jobId]/plans] Signed URL failed:', {
        requestId,
        storage_path: row.storage_path,
        supabaseError: supabaseErr,
      });
      return serverError(requestId, supabaseErr.code ?? 'PLAN_SIGN', 'Failed to generate plan URL');
    }
    plansWithUrl.push({ ...row, url: signed.signedUrl });
  }

  const res = NextResponse.json({ ok: true, plans: plansWithUrl });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) {
    validation.headers.set('x-request-id', requestId);
    return validation;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Failed to parse upload', 400, requestId);
  }

  const file = formData.get('file') ?? formData.get('plan');
  if (!file || !(file instanceof File) || file.size === 0) {
    return jsonError('One file (field "file" or "plan") is required', 400, requestId);
  }

  const mimeType = (file.type || '').toLowerCase() || 'application/octet-stream';
  if (!isAllowedJobPlanMimeType(mimeType)) {
    return jsonError('Plan must be a PDF or image (JPEG, PNG, WebP)', 400, requestId);
  }
  if (file.size > JOB_PLAN_MAX_BYTES) {
    return jsonError('Plan must be 20MB or smaller', 400, requestId);
  }

  const { count, error: countError } = await supabaseAdmin
    .from('job_plan_documents')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .is('deleted_at', null);

  if (countError) {
    const supabaseErr = normalizeSupabaseError(countError);
    console.error('[api/jobs/[jobId]/plans] Count failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'PLANS_COUNT', 'Failed to check plan count');
  }

  if ((count ?? 0) >= JOB_PLAN_MAX_PER_JOB) {
    return jsonError(`Maximum ${JOB_PLAN_MAX_PER_JOB} plans allowed per job`, 400, requestId);
  }

  const contentType =
    mimeType === 'application/pdf'
      ? 'application/pdf'
      : mimeType.startsWith('image/')
        ? mimeType === 'image/png' || mimeType === 'image/webp'
          ? mimeType
          : 'image/jpeg'
        : mimeType;

  const storageFileName = newPlanStorageFileName(contentType, file.name);
  const storagePath = jobPlanStoragePath(jobId, validation.job.name, storageFileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  });

  if (uploadError) {
    const supabaseErr = normalizeSupabaseError(uploadError);
    console.error('[api/jobs/[jobId]/plans] Upload failed:', { requestId, jobId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'PLAN_UPLOAD', 'Failed to upload plan');
  }

  const { data: plan, error: insertError } = await supabaseAdmin
    .from('job_plan_documents')
    .insert({
      job_id: jobId,
      storage_path: storagePath,
      file_name: file.name || storageFileName,
      mime_type: contentType,
      file_size_bytes: Math.round(file.size),
      uploaded_by: staffAuth.staff.id,
    })
    .select('id, job_id, storage_path, file_name, mime_type, file_size_bytes, uploaded_by, created_at')
    .single();

  if (insertError || !plan) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/jobs/[jobId]/plans] Insert failed:', { requestId, supabaseError: supabaseErr });
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    return serverError(requestId, supabaseErr.code ?? 'PLAN_INSERT', 'Failed to save plan record');
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

  const res = NextResponse.json(
    { ok: true, plan: { ...plan, url: signed?.signedUrl ?? null } },
    { status: 201 }
  );
  res.headers.set('x-request-id', requestId);
  return res;
}
