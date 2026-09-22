import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

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

async function validateJobForOrg(
  jobId: string,
  orgSlug: string,
  requestId: string
): Promise<{ ok: true } | NextResponse> {
  if (!jobId || !isValidUuid(jobId)) {
    return jsonError('Job not found', 404, requestId) as NextResponse;
  }
  if (!orgSlug) {
    return jsonError('orgSlug is required', 400, requestId) as NextResponse;
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id')
    .eq('slug', orgSlug)
    .single();

  if (orgError || !org) {
    const supabaseErr = normalizeSupabaseError(orgError ?? null);
    console.error('[api/jobs/[jobId]] Org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
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
    .select('id')
    .eq('id', jobId)
    .eq('organisation_id', org.id)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/jobs/[jobId]] Job lookup failed:', { requestId, jobId, supabaseError: supabaseErr });
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

  return { ok: true };
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
  if (validation instanceof NextResponse) return validation;

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('id, organisation_id, name, site_id, created_at, active_stage_id, hidden_from_qa_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/jobs/[jobId]] GET failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'JOB_GET', 'Failed to load job');
  }

  const res = NextResponse.json({ ok: true, job });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function PATCH(
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
  if (validation instanceof NextResponse) return validation;

  let body: { activeStageId?: string | null; hideFromQaList?: boolean; confirmation?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    const res = NextResponse.json({ ok: false, requestId, message: 'Invalid JSON body' }, { status: 400 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (body.hideFromQaList === true) {
    if (body.confirmation !== 'DELETE') {
      return jsonError('Type DELETE to confirm', 400, requestId);
    }

    const { data: job, error: updateError } = await supabaseAdmin
      .from('jobs')
      .update({ hidden_from_qa_at: new Date().toISOString() })
      .eq('id', jobId)
      .select('id, organisation_id, name, site_id, created_at, active_stage_id')
      .single();

    if (updateError || !job) {
      const supabaseErr = normalizeSupabaseError(updateError ?? null);
      console.error('[api/jobs/[jobId]] Archive job failed:', { requestId, supabaseError: supabaseErr });
      return serverError(requestId, supabaseErr.code ?? 'JOB_HIDE', 'Failed to archive job');
    }

    const res = NextResponse.json({ ok: true, job });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const activeStageIdRaw = body.activeStageId;
  if (activeStageIdRaw === undefined) {
    return jsonError('activeStageId is required', 400, requestId);
  }
  const activeStageId = typeof activeStageIdRaw === 'string' ? activeStageIdRaw.trim() : '';
  if (!activeStageId || !isValidUuid(activeStageId)) {
    return jsonError('activeStageId must be a valid UUID', 400, requestId);
  }

  const { data: stage, error: stageError } = await supabaseAdmin
    .from('stages')
    .select('id')
    .eq('id', activeStageId)
    .eq('job_id', jobId)
    .single();

  if (stageError || !stage) {
    const supabaseErr = normalizeSupabaseError(stageError ?? null);
    console.error('[api/jobs/[jobId]] Stage not found or wrong job:', { requestId, activeStageId, jobId, supabaseError: supabaseErr });
    const res = NextResponse.json(
      { ok: false, requestId, message: 'Stage not found or does not belong to this job' },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: job, error: updateError } = await supabaseAdmin
    .from('jobs')
    .update({ active_stage_id: activeStageId })
    .eq('id', jobId)
    .select('id, organisation_id, name, site_id, created_at, active_stage_id')
    .single();

  if (updateError || !job) {
    const supabaseErr = normalizeSupabaseError(updateError ?? null);
    console.error('[api/jobs/[jobId]] PATCH failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'JOB_UPDATE', 'Failed to set active stage');
  }

  const res = NextResponse.json({ ok: true, job });
  res.headers.set('x-request-id', requestId);
  return res;
}
