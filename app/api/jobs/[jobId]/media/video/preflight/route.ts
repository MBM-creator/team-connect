import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import {
  JOB_MEDIA_MAX_PER_JOB,
  JOB_MEDIA_VIDEO_MAX_BYTES,
  JOB_MEDIA_VIDEO_MAX_SECONDS,
  isAllowedJobMediaVideoMimeType,
} from '@/lib/job-media';
import { jobMediaVideoStoragePath, newVideoStorageFileName } from '@/lib/storage-paths';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';

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

  let body: { fileName?: unknown; mimeType?: unknown; fileSizeBytes?: unknown; durationSeconds?: unknown };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return jsonError('Invalid JSON body', 400, requestId);
  }

  const fileName = String(body.fileName ?? 'video').trim() || 'video';
  const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  const durationSeconds = body.durationSeconds == null ? null : Number(body.durationSeconds);

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

  const { count, error: countError } = await supabaseAdmin
    .from('job_media')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .is('deleted_at', null);

  if (countError) {
    const supabaseErr = normalizeSupabaseError(countError);
    console.error('[api/jobs/[jobId]/media/video/preflight] Count failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_COUNT', 'Failed to prepare upload');
  }

  if ((count ?? 0) >= JOB_MEDIA_MAX_PER_JOB) {
    return jsonError(`Maximum ${JOB_MEDIA_MAX_PER_JOB} photos and videos allowed per job`, 400, requestId);
  }

  const storageFileName = newVideoStorageFileName(mimeType, fileName);
  const storagePath = jobMediaVideoStoragePath(jobId, validation.job.name, storageFileName);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return serverError(requestId, 'SUPABASE_PUBLIC_ENV', 'Supabase public environment variables are missing');
  }

  const res = NextResponse.json({
    ok: true,
    upload: {
      endpoint: `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`,
      bucket: BUCKET,
      path: storagePath,
      metadata: {
        bucketName: BUCKET,
        objectName: storagePath,
        contentType: mimeType,
        cacheControl: '3600',
      },
      headers: {
        apikey: anonKey,
      },
    },
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
