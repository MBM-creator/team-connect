import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const MAX_SUMMARY_LENGTH = 2000;

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

function todayUtcDateString(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

async function validateStageForOrg(
  stageId: string,
  orgSlug: string,
  requestId: string
): Promise<{ ok: true } | NextResponse> {
  if (!stageId || !isValidUuid(stageId)) {
    return jsonError('Stage not found', 404, requestId) as NextResponse;
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
    console.error('[api/stages/[stageId]/end-of-day] Org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
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

  const { data: stage, error: stageError } = await supabaseAdmin
    .from('stages')
    .select('id, job_id')
    .eq('id', stageId)
    .single();

  if (stageError || !stage) {
    const supabaseErr = normalizeSupabaseError(stageError ?? null);
    console.error('[api/stages/[stageId]/end-of-day] Stage lookup failed:', { requestId, stageId, supabaseError: supabaseErr });
    const res = NextResponse.json(
      { ok: false, requestId, message: 'Stage not found' },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('id', stage.job_id)
    .eq('organisation_id', org.id)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/stages/[stageId]/end-of-day] Job not in org:', { requestId, stageId, supabaseError: supabaseErr });
    const res = NextResponse.json(
      { ok: false, requestId, message: 'Stage not found' },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  return { ok: true };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { stageId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateStageForOrg(stageId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  let body: { summary?: unknown };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    const res = NextResponse.json({ ok: false, requestId, message: 'Invalid JSON body' }, { status: 400 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const summaryRaw = body.summary;
  const summary =
    summaryRaw === null || summaryRaw === undefined
      ? ''
      : String(summaryRaw).trim();

  if (summary.length > MAX_SUMMARY_LENGTH) {
    return jsonError(
      `Summary must be at most ${MAX_SUMMARY_LENGTH} characters`,
      400,
      requestId
    );
  }

  const reportDate = todayUtcDateString();
  const submittedAt = new Date().toISOString();
  const summaryToStore = summary === '' ? null : summary;

  const { error: upsertError } = await supabaseAdmin
    .from('stage_end_of_day')
    .upsert(
      {
        stage_id: stageId,
        report_date: reportDate,
        submitted_at: submittedAt,
        summary: summaryToStore,
      },
      { onConflict: 'stage_id,report_date' }
    );

  if (upsertError) {
    const supabaseErr = normalizeSupabaseError(upsertError);
    console.error('[api/stages/[stageId]/end-of-day] Upsert failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'EOD_UPSERT', 'Failed to save Daily Report');
  }

  const res = NextResponse.json({
    ok: true,
    submitted: true,
    submittedAt,
    summary: summaryToStore,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
