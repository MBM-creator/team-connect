import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  JOB_MEDIA_VIDEO_MAX_BYTES,
  JOB_MEDIA_VIDEO_MAX_SECONDS,
  isAllowedJobMediaVideoMimeType,
} from '@/lib/job-media';
import { jobSlugOrIdSegment } from '@/lib/storage-paths';

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

async function storageObjectExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return false;
  const dir = path.slice(0, slash);
  const file = path.slice(slash + 1);
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(dir, { limit: 100 });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === file);
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

  let body: {
    storagePath?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
    fileSizeBytes?: unknown;
    durationSeconds?: unknown;
  };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const storagePath = String(body.storagePath ?? '').trim();
  const fileName = String(body.fileName ?? 'video').trim() || 'video';
  const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  const durationSeconds = body.durationSeconds == null ? null : Number(body.durationSeconds);
  const expectedPrefix = `jobs/${jobSlugOrIdSegment(jobId, validation.job.name)}/media/videos/`;

  if (!storagePath.startsWith(expectedPrefix)) {
    return jsonError('Invalid uploaded video path', 400, requestId);
  }
  if (!isAllowedJobMediaVideoMimeType(mimeType)) {
    return jsonError('Video must be MP4, MOV, or WebM', 400, requestId);
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > JOB_MEDIA_VIDEO_MAX_BYTES) {
    return jsonError('Video must be 50MB or smaller', 400, requestId);
  }
  if (
    durationSeconds != null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > JOB_MEDIA_VIDEO_MAX_SECONDS + 1
  ) {
    return jsonError('Video must be 60 seconds or shorter', 400, requestId);
  }

  const exists = await storageObjectExists(storagePath);
  if (!exists) return jsonError('Uploaded video was not found. Please try again.', 400, requestId);

  const { data: item, error: insertError } = await supabaseAdmin
    .from('job_media')
    .insert({
      job_id: jobId,
      storage_path: storagePath,
      media_type: 'video',
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: Math.round(fileSizeBytes),
      duration_seconds:
        durationSeconds != null && Number.isFinite(durationSeconds) ? durationSeconds : null,
      uploaded_by: staffAuth.staff.id,
    })
    .select(
      'id, job_id, storage_path, media_type, mime_type, file_name, file_size_bytes, duration_seconds, uploaded_by, created_at'
    )
    .single();

  if (insertError || !item) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/jobs/[jobId]/media/video/complete] Insert failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_VIDEO_INSERT', 'Failed to save video');
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
