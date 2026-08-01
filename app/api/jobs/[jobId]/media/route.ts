import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';

export const runtime = 'nodejs';

const BUCKET = 'daily-reports';
const SIGNED_URL_EXPIRY = 3600;

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

  const { data: media, error: mediaError } = await supabaseAdmin
    .from('job_media')
    .select(
      'id, job_id, storage_path, media_type, mime_type, file_name, file_size_bytes, duration_seconds, uploaded_by, created_at'
    )
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (mediaError) {
    const supabaseErr = normalizeSupabaseError(mediaError);
    console.error('[api/jobs/[jobId]/media] GET list failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'MEDIA_LIST', 'Failed to list media');
  }

  const list = media ?? [];
  const mediaWithUrl: Array<{
    id: string;
    job_id: string;
    storage_path: string;
    media_type: 'image' | 'video';
    mime_type: string;
    file_name: string | null;
    file_size_bytes: number;
    duration_seconds: number | null;
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
      console.error('[api/jobs/[jobId]/media] Signed URL failed:', {
        requestId,
        storage_path: row.storage_path,
        supabaseError: supabaseErr,
      });
      return serverError(requestId, supabaseErr.code ?? 'MEDIA_SIGN', 'Failed to generate media URL');
    }
    mediaWithUrl.push({ ...row, media_type: row.media_type as 'image' | 'video', url: signed.signedUrl });
  }

  const res = NextResponse.json({ ok: true, media: mediaWithUrl });
  res.headers.set('x-request-id', requestId);
  return res;
}
