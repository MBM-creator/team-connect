import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
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

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const jobId = request.nextUrl.searchParams.get('jobId')?.trim() ?? '';
  if (!jobId || !isValidUuid(jobId)) {
    return jsonError('jobId is required and must be a valid UUID', 400, requestId);
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/stages] GET job lookup failed:', { requestId, jobId, supabaseError: supabaseErr });
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
    .select('id, job_id, name, sort_order, created_at, checklist_template_id, cc_project_id, cc_section_id, cc_section_name_snapshot, cc_section_trade, checklist_templates(name, checklist_template_items(id, item_type, label, sort_order))')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (stagesError) {
    const supabaseErr = normalizeSupabaseError(stagesError);
    console.error('[api/stages] GET list failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'STAGES_LIST', 'Failed to list stages');
  }

  const res = NextResponse.json({ ok: true, stages: stages ?? [] });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);

  let body: { jobId?: string; name?: string; sortOrder?: number };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    console.error('[api/stages] POST body parse failed:', { requestId });
    return serverError(requestId, 'BODY_PARSE', 'Invalid JSON body');
  }

  const jobId = String(body.jobId ?? '').trim();
  const name = String(body.name ?? '').trim();
  const sortOrderIn = body.sortOrder;

  if (!jobId || !isValidUuid(jobId)) return jsonError('jobId is required and must be a valid UUID', 400, requestId);
  if (!name) return jsonError('name is required', 400, requestId);

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    const supabaseErr = normalizeSupabaseError(jobError ?? null);
    console.error('[api/stages] POST job lookup failed:', { requestId, jobId, supabaseError: supabaseErr });
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

  let sortOrder: number;
  if (typeof sortOrderIn === 'number' && Number.isInteger(sortOrderIn) && sortOrderIn >= 0) {
    sortOrder = sortOrderIn;
  } else {
    const { data: maxRow } = await supabaseAdmin
      .from('stages')
      .select('sort_order')
      .eq('job_id', jobId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxSort = maxRow?.sort_order != null ? Number(maxRow.sort_order) : -1;
    sortOrder = maxSort + 1;
  }

  const { data: stage, error: insertError } = await supabaseAdmin
    .from('stages')
    .insert({
      job_id: jobId,
      name,
      sort_order: sortOrder,
    })
    .select('id, job_id, name, sort_order, created_at, checklist_template_id, cc_project_id, cc_section_id, cc_section_name_snapshot, cc_section_trade')
    .single();

  if (insertError || !stage) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/stages] POST insert failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'STAGE_INSERT', 'Failed to create stage');
  }

  const res = NextResponse.json({ ok: true, stage }, { status: 201 });
  res.headers.set('x-request-id', requestId);
  return res;
}
