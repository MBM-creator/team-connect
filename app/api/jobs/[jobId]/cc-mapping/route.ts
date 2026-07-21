import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { ccProjectJobIdentity, fetchCcProjects } from '@/lib/cc-client';
import { ccClientDisplayName } from '@/lib/cc-client-display';
import { syncCcProjectStagesForJob } from '@/lib/sync-cc-project-stages';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json(
    requestId
      ? { ok: false, requestId, message }
      : { ok: false, message },
    { status }
  );
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

function isValidUuid(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

const JOB_SELECT =
  'id, organisation_id, name, site_id, created_at, active_stage_id, cc_project_id, cc_quote_id, cc_job_id, cc_job_number, cc_client_id, cc_project_title_snapshot, cc_client_name_snapshot';

async function validateJobForOrg(
  jobId: string,
  orgSlug: string,
  requestId: string
): Promise<{ ok: true; organisationId: string } | NextResponse> {
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
    console.error('[api/jobs/[jobId]/cc-mapping] Org lookup failed:', {
      requestId,
      orgSlug,
      supabaseError: supabaseErr,
    });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message:
          process.env.NODE_ENV === 'development' && orgError
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
    console.error('[api/jobs/[jobId]/cc-mapping] Job lookup failed:', {
      requestId,
      jobId,
      supabaseError: supabaseErr,
    });
    const res = NextResponse.json(
      {
        ok: false,
        requestId,
        message:
          process.env.NODE_ENV === 'development' && jobError
            ? `Job not found: ${jobError.message}`
            : 'Job not found',
      },
      { status: 404 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  return { ok: true, organisationId: org.id as string };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId =
    request.headers.get('x-request-id') ||
    randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  let body: {
    cc_project_id?: unknown;
    cc_client_id?: unknown;
    cc_project_title_snapshot?: unknown;
    cc_client_name_snapshot?: unknown;
  };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    const res = NextResponse.json(
      { ok: false, requestId, message: 'Invalid JSON body' },
      { status: 400 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const projectIdRaw = body.cc_project_id ?? null;
  const clientIdRaw = body.cc_client_id ?? null;
  const projectTitleRaw = body.cc_project_title_snapshot ?? null;
  const clientNameRaw = body.cc_client_name_snapshot ?? null;

  let cc_project_id: string | null = null;
  let cc_quote_id: string | null = null;
  let cc_job_id: string | null = null;
  let cc_job_number: string | null = null;
  let cc_client_id: string | null = null;
  let cc_project_title_snapshot: string | null = null;
  let cc_client_name_snapshot: string | null = null;

  if (projectIdRaw !== null) {
    if (!isValidUuid(projectIdRaw)) {
      return jsonError('cc_project_id must be a valid UUID or null', 400, requestId);
    }
    cc_project_id = projectIdRaw;
  }

  if (clientIdRaw !== null) {
    if (clientIdRaw !== undefined && clientIdRaw !== null && !isValidUuid(clientIdRaw)) {
      return jsonError('cc_client_id must be a valid UUID or null', 400, requestId);
    }
    if (clientIdRaw !== undefined && clientIdRaw !== null) {
      cc_client_id = clientIdRaw as string;
    }
  }

  if (projectTitleRaw !== null) {
    if (projectTitleRaw !== undefined && typeof projectTitleRaw !== 'string') {
      return jsonError('cc_project_title_snapshot must be a string or null', 400, requestId);
    }
    cc_project_title_snapshot =
      projectTitleRaw !== undefined ? (projectTitleRaw as string) : null;
  }

  if (clientNameRaw !== null) {
    if (clientNameRaw !== undefined && typeof clientNameRaw !== 'string') {
      return jsonError('cc_client_name_snapshot must be a string or null', 400, requestId);
    }
    cc_client_name_snapshot =
      clientNameRaw !== undefined ? (clientNameRaw as string) : null;
  }

  if (cc_project_id !== null) {
    let projects;
    try {
      projects = await fetchCcProjects(requestId);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to validate Client Connect project';
      console.error('[CC PROJECT VALIDATION FAILED]', {
        requestId,
        error: message,
      });
      const res = NextResponse.json(
        {
          ok: false,
          requestId,
          message,
        },
        { status: 502 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
    const match = projects.find((p) => p.project_id === cc_project_id);
    if (!match) {
      console.error('[CC PROJECT VALIDATION FAILED]', {
        requestId,
        projectId: cc_project_id,
        error: 'Selected project is not in the active Client Connect projects list',
      });
      return jsonError('Selected project is not in the active projects list', 400, requestId);
    }
    console.log('[CC PROJECT VALIDATED]', {
      requestId,
      projectId: cc_project_id,
    });
    cc_quote_id = match.quote_id;
    cc_job_id = match.cc_job_id;
    cc_job_number = match.cc_job_number;
    cc_client_id = match.client_id;
    cc_project_title_snapshot = match.project_title;
    cc_client_name_snapshot = ccClientDisplayName(match);

    const { data: linkedJobs, error: linkedJobsError } = await supabaseAdmin
      .from('jobs')
      .select(JOB_SELECT)
      .eq('organisation_id', validation.organisationId)
      .neq('id', jobId)
      .not('cc_project_id', 'is', null);

    if (linkedJobsError) {
      const supabaseErr = normalizeSupabaseError(linkedJobsError);
      console.error('[api/jobs/[jobId]/cc-mapping] Existing CC job lookup failed:', {
        requestId,
        ccIdentity: ccProjectJobIdentity(match),
        supabaseError: supabaseErr,
      });
      return serverError(requestId, supabaseErr.code ?? 'JOB_CC_LOOKUP', 'Failed to check existing linked job');
    }
    const projectsById = new Map(projects.map((project) => [project.project_id, project]));
    const selectedIdentity = ccProjectJobIdentity(match);
    const existingJob = linkedJobs?.find((linkedJob) => {
      if (typeof linkedJob.cc_job_id === 'string' && linkedJob.cc_job_id) return `cc_job_id:${linkedJob.cc_job_id}` === selectedIdentity;
      if (typeof linkedJob.cc_job_number === 'string' && linkedJob.cc_job_number) return `cc_job_number:${linkedJob.cc_job_number}` === selectedIdentity;
      if (
        typeof linkedJob.cc_quote_id === 'string' &&
        linkedJob.cc_quote_id &&
        match.quote_id &&
        linkedJob.cc_quote_id === match.quote_id
      ) {
        return true;
      }
      const linkedProject = typeof linkedJob.cc_project_id === 'string' ? projectsById.get(linkedJob.cc_project_id) : undefined;
      if (linkedProject) return ccProjectJobIdentity(linkedProject) === selectedIdentity;
      return linkedJob.cc_project_id === cc_project_id;
    });
    if (existingJob) {
      return jsonError('This project is already linked to another Site Connect job', 409, requestId);
    }

    try {
      await syncCcProjectStagesForJob(jobId, match, requestId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync Client Connect sections to stages';
      console.error('[CC STAGE SYNC FAILED]', {
        requestId,
        projectId: cc_project_id,
        error: message,
      });
      const res = NextResponse.json(
        {
          ok: false,
          requestId,
          message,
        },
        { status: 502 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
  } else {
    cc_quote_id = null;
    cc_job_id = null;
    cc_job_number = null;
    cc_client_id = null;
    cc_project_title_snapshot = cc_project_title_snapshot?.trim() || null;
    cc_client_name_snapshot = cc_client_name_snapshot?.trim() || null;
  }

  const { data: job, error: updateError } = await supabaseAdmin
    .from('jobs')
    .update({
      cc_project_id,
      cc_quote_id,
      cc_job_id,
      cc_job_number,
      cc_client_id,
      cc_project_title_snapshot,
      cc_client_name_snapshot,
    })
    .eq('id', jobId)
    .select(JOB_SELECT)
    .single();

  if (updateError || !job) {
    const supabaseErr = normalizeSupabaseError(updateError ?? null);
    console.error('[api/jobs/[jobId]/cc-mapping] PATCH failed:', {
      requestId,
      supabaseError: supabaseErr,
    });
    return serverError(
      requestId,
      supabaseErr.code ?? 'JOB_CC_MAPPING_UPDATE',
      'Failed to update project link'
    );
  }

  const res = NextResponse.json({ ok: true, job });
  res.headers.set('x-request-id', requestId);
  return res;
}
