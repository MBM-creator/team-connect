import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  JOB_MEDIA_IMAGE_MAX_BYTES,
  JOB_MEDIA_MAX_PER_JOB,
  isAllowedJobMediaImageMimeType,
} from '@/lib/job-media';
import { jobMediaImageStoragePath, newImageStorageFileName } from '@/lib/storage-paths';

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

  const file = formData.get('file') ?? formData.get('photo') ?? formData.get('image');
  if (!file || !(file instanceof File) || file.size === 0) {
    return jsonError('One image file is required', 400, requestId);
  }

  const mimeType = (file.type || 'image/jpeg').toLowerCase();
  if (!isAllowedJobMediaImageMimeType(mimeType)) {
    return jsonError('Image must be JPEG, PNG, or WebP', 400, requestId);
  }
  if (file.size > JOB_MEDIA_IMAGE_MAX_BYTES) {
    return jsonError('Image must be 10MB or smaller', 400, requestId);
  }

  const { count, error: countError } = await supabaseAdmin
    .from('job_media')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .is('deleted_at', null);

  if (countError) {
    const supabaseErr = normalizeSupabaseError(countError);
    console.error('[api/jobs/[jobId]/media/image] Count failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_COUNT', 'Failed to prepare image upload');
  }

  if ((count ?? 0) >= JOB_MEDIA_MAX_PER_JOB) {
    return jsonError(`Maximum ${JOB_MEDIA_MAX_PER_JOB} photos and videos allowed per job`, 400, requestId);
  }

  const storageFileName = newImageStorageFileName();
  const storagePath = jobMediaImageStoragePath(jobId, validation.job.name, storageFileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = 'image/jpeg';

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  });

  if (uploadError) {
    const supabaseErr = normalizeSupabaseError(uploadError);
    console.error('[api/jobs/[jobId]/media/image] Upload failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_IMAGE_UPLOAD', 'Failed to upload image');
  }

  const { data: item, error: insertError } = await supabaseAdmin
    .from('job_media')
    .insert({
      job_id: jobId,
      storage_path: storagePath,
      media_type: 'image',
      mime_type: contentType,
      file_name: file.name || 'photo.jpg',
      file_size_bytes: Math.round(file.size),
      duration_seconds: null,
      uploaded_by: staffAuth.staff.id,
    })
    .select(
      'id, job_id, storage_path, media_type, mime_type, file_name, file_size_bytes, duration_seconds, uploaded_by, created_at'
    )
    .single();

  if (insertError || !item) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/jobs/[jobId]/media/image] Insert failed:', { requestId, supabaseError: supabaseErr });
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_IMAGE_INSERT', 'Failed to save image');
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

  const res = NextResponse.json(
    { ok: true, media: { ...item, url: signed?.signedUrl ?? null } },
    { status: 201 }
  );
  res.headers.set('x-request-id', requestId);
  return res;
}
