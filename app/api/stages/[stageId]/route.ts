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

async function validateStageForOrg(
  stageId: string,
  orgSlug: string,
  requestId: string
): Promise<{ ok: true; jobId: string } | NextResponse> {
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
    console.error('[api/stages/[stageId]] Org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
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
    console.error('[api/stages/[stageId]] Stage lookup failed:', { requestId, stageId, supabaseError: supabaseErr });
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
    console.error('[api/stages/[stageId]] Job not in org:', { requestId, stageId, supabaseError: supabaseErr });
    const res = NextResponse.json(
      { ok: false, requestId, message: 'Stage not found' },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  return { ok: true, jobId: stage.job_id };
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

  let body: { checklistTemplateId?: string | null; sortOrder?: number };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    const res = NextResponse.json({ ok: false, requestId, message: 'Invalid JSON body' }, { status: 400 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const hasChecklistTemplateId = 'checklistTemplateId' in body;
  const hasSortOrder = 'sortOrder' in body;
  if (!hasChecklistTemplateId && !hasSortOrder) {
    return jsonError('checklistTemplateId or sortOrder is required', 400, requestId);
  }

  const checklistTemplateIdRaw = body.checklistTemplateId;
  const checklistTemplateId =
    checklistTemplateIdRaw === null || checklistTemplateIdRaw === undefined
      ? null
      : String(checklistTemplateIdRaw).trim() || null;

  if (hasChecklistTemplateId && checklistTemplateId !== null) {
    if (!isValidUuid(checklistTemplateId)) {
      return jsonError('checklistTemplateId must be a valid UUID or null', 400, requestId);
    }

    const { data: org } = await supabaseAdmin
      .from('organisations')
      .select('id')
      .eq('slug', orgSlug)
      .single();

    if (!org) {
      return jsonError('Invalid organisation', 404, requestId);
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('checklist_templates')
      .select('id')
      .eq('id', checklistTemplateId)
      .eq('organisation_id', org.id)
      .single();

    if (templateError || !template) {
      const supabaseErr = normalizeSupabaseError(templateError ?? null);
      console.error('[api/stages/[stageId]] Template lookup failed:', { requestId, checklistTemplateId, supabaseError: supabaseErr });
      const res = NextResponse.json(
        { ok: false, requestId, message: 'Template not found or does not belong to this organisation' },
        { status: 404 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  const updates: { checklist_template_id?: string | null; sort_order?: number } = {};
  if (hasChecklistTemplateId) {
    updates.checklist_template_id = checklistTemplateId;
  }
  if (hasSortOrder) {
    if (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder) || body.sortOrder < 0) {
      return jsonError('sortOrder must be a non-negative integer', 400, requestId);
    }
    updates.sort_order = body.sortOrder;
  }

  const { error: updateError } = await supabaseAdmin
    .from('stages')
    .update(updates)
    .eq('id', stageId);

  if (updateError) {
    const supabaseErr = normalizeSupabaseError(updateError);
    console.error('[api/stages/[stageId]] PATCH failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'STAGE_UPDATE', 'Failed to update stage');
  }

  const { data: stage, error: fetchError } = await supabaseAdmin
    .from('stages')
    .select('id, job_id, name, sort_order, created_at, checklist_template_id, cc_project_id, cc_section_id, cc_section_name_snapshot, cc_section_trade, checklist_templates(name, checklist_template_items(id, item_type, label, sort_order))')
    .eq('id', stageId)
    .single();

  if (fetchError || !stage) {
    const supabaseErr = normalizeSupabaseError(fetchError ?? null);
    console.error('[api/stages/[stageId]] Fetch updated stage failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'STAGE_GET', 'Failed to load updated stage');
  }

  const res = NextResponse.json({ ok: true, stage });
  res.headers.set('x-request-id', requestId);
  return res;
}
