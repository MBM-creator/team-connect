import { NextRequest, NextResponse } from 'next/server';
import { PROJECT_SYNC_UNAVAILABLE_WARNING } from '@/lib/app-branding';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { ccProjectJobIdentity, fetchCcProjects } from '@/lib/cc-client';
import type { CcProject } from '@/lib/cc-client';
import { ccClientDisplayName } from '@/lib/cc-client-display';
import {
  ccIntegrationUnavailableWarning,
  isCcIntegrationOrgAllowed,
} from '@/lib/cc-integration-access';
import { enrichJobsWithSiteLocation } from '@/lib/job-site-location';
import { syncCcProjectStagesForJob } from '@/lib/sync-cc-project-stages';
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

const JOB_SELECT =
  'id, organisation_id, name, site_id, created_at, active_stage_id, cc_project_id, cc_quote_id, cc_job_id, cc_job_number, cc_client_id, cc_project_title_snapshot, cc_client_name_snapshot, hidden_from_qa_at';

type JobRow = {
  id: string;
  organisation_id: string;
  name: string;
  site_id: string | null;
  created_at: string;
  active_stage_id: string | null;
  cc_project_id: string | null;
  cc_quote_id: string | null;
  cc_job_id: string | null;
  cc_job_number: string | null;
  cc_client_id: string | null;
  cc_project_title_snapshot: string | null;
  cc_client_name_snapshot: string | null;
  hidden_from_qa_at?: string | null;
};

function jobIdentity(job: Pick<JobRow, 'cc_project_id' | 'cc_quote_id' | 'cc_job_id' | 'cc_job_number'>): string | null {
  if (job.cc_job_id) return `cc_job_id:${job.cc_job_id}`;
  if (job.cc_job_number) return `cc_job_number:${job.cc_job_number}`;
  if (job.cc_quote_id) return `cc_quote_id:${job.cc_quote_id}`;
  if (job.cc_project_id) return `cc_project_id:${job.cc_project_id}`;
  return null;
}

function findExistingCcJob(jobs: JobRow[], project: CcProject, projectsById: Map<string, CcProject>): JobRow | null {
  const selectedIdentity = ccProjectJobIdentity(project);
  return jobs.find((job) => {
    if (jobIdentity(job) === selectedIdentity) return true;
    if (job.cc_quote_id && project.quote_id && job.cc_quote_id === project.quote_id) return true;
    const linkedProject = job.cc_project_id ? projectsById.get(job.cc_project_id) : undefined;
    return linkedProject ? ccProjectJobIdentity(linkedProject) === selectedIdentity : false;
  }) ?? null;
}

async function loadSavedJobsForOrg(organisationId: string, requestId: string): Promise<JobRow[]> {
  const { data: jobs, error } = await supabaseAdmin
    .from('jobs')
    .select(JOB_SELECT)
    .eq('organisation_id', organisationId)
    .is('hidden_from_qa_at', null);

  if (error) {
    const supabaseErr = normalizeSupabaseError(error);
    console.error('[api/jobs] GET saved jobs failed:', { requestId, supabaseError: supabaseErr });
    throw new Error('Failed to list jobs');
  }

  return (jobs ?? []) as JobRow[];
}

async function loadCcProjectsForJobEnrichment(
  organisationId: string,
  requestId: string
): Promise<CcProject[]> {
  if (!isCcIntegrationOrgAllowed(organisationId)) {
    return [];
  }
  try {
    return await fetchCcProjects(organisationId, requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load Client Connect projects';
    console.warn('[api/jobs] CC enrichment fetch skipped:', { requestId, error: message });
    return [];
  }
}

async function respondWithJobs(
  jobs: JobRow[],
  organisationId: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  projects?: CcProject[]
) {
  const resolvedProjects =
    projects ?? (await loadCcProjectsForJobEnrichment(organisationId, requestId));
  const res = NextResponse.json({
    ok: true,
    jobs: enrichJobsWithSiteLocation(jobs, resolvedProjects),
    ...extra,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

async function upsertCcProjectJob(
  organisationId: string,
  existingJob: JobRow | null,
  project: CcProject,
  requestId: string
): Promise<JobRow> {
  const payload = {
    organisation_id: organisationId,
    name: project.project_title,
    cc_project_id: project.project_id,
    cc_quote_id: project.quote_id,
    cc_job_id: project.cc_job_id,
    cc_job_number: project.cc_job_number,
    cc_client_id: project.client_id,
    cc_project_title_snapshot: project.project_title,
    cc_client_name_snapshot: ccClientDisplayName(project),
  };

  const query = existingJob
    ? supabaseAdmin
        .from('jobs')
        .update(payload)
        .eq('id', existingJob.id)
        .select(JOB_SELECT)
        .single()
    : supabaseAdmin
        .from('jobs')
        .insert(payload)
        .select(JOB_SELECT)
        .single();

  const { data: job, error } = await query;
  if (error || !job) {
    const supabaseErr = normalizeSupabaseError(error ?? null);
    console.error('[api/jobs] CC job upsert failed:', {
      requestId,
      projectId: project.project_id,
      ccIdentity: ccProjectJobIdentity(project),
      supabaseError: supabaseErr,
    });
    throw new Error('Failed to sync Client Connect jobs');
  }

  try {
    await syncCcProjectStagesForJob(job.id as string, project, requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync Client Connect sections to stages';
    console.error('[api/jobs] CC stage sync failed:', {
      requestId,
      projectId: project.project_id,
      jobId: job.id,
      error: message,
    });
    throw new Error(message);
  }

  return job as JobRow;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  if (!orgSlug) {
    return jsonError('orgSlug is required', 400, requestId);
  }

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id')
    .eq('slug', orgSlug)
    .single();

  if (orgError || !org) {
    const supabaseErr = normalizeSupabaseError(orgError ?? null);
    console.error('[api/jobs] GET org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
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

  // Authoritative org id from authenticated staff context — never trust a browser org id.
  const organisationId = staffAuth.org.id;
  if (organisationId !== org.id) {
    return jsonError('You do not have access to this organisation', 403, requestId);
  }

  const jobIdFilter = request.nextUrl.searchParams.get('jobId')?.trim() ?? '';

  if (jobIdFilter) {
    if (!isValidUuid(jobIdFilter)) {
      return jsonError('jobId must be a valid UUID', 400, requestId);
    }

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('jobs')
      .select(JOB_SELECT)
      .eq('organisation_id', organisationId)
      .eq('id', jobIdFilter);

    if (jobsError) {
      const supabaseErr = normalizeSupabaseError(jobsError);
      console.error('[api/jobs] GET job lookup failed:', { requestId, jobId: jobIdFilter, supabaseError: supabaseErr });
      return serverError(requestId, supabaseErr.code ?? 'JOBS_LOOKUP', 'Failed to load job');
    }

    return respondWithJobs((jobs ?? []) as JobRow[], organisationId, requestId);
  }

  if (!isCcIntegrationOrgAllowed(organisationId)) {
    try {
      const jobs = await loadSavedJobsForOrg(organisationId, requestId);
      return respondWithJobs(jobs, organisationId, requestId, {
        ccUnavailable: true,
        warning: ccIntegrationUnavailableWarning(),
      }, []);
    } catch (fallbackErr) {
      const fallbackMessage = fallbackErr instanceof Error && fallbackErr.message
        ? fallbackErr.message
        : 'Failed to list jobs';
      return serverError(requestId, 'JOBS_FALLBACK', fallbackMessage);
    }
  }

  let projects: CcProject[];
  try {
    projects = await fetchCcProjects(organisationId, requestId);
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Failed to load Client Connect projects';
    console.error('[api/jobs] GET CC fetch failed:', { requestId, error: message });
    try {
      const jobs = await loadSavedJobsForOrg(organisationId, requestId);
      return respondWithJobs(jobs, organisationId, requestId, {
        ccUnavailable: true,
        warning: PROJECT_SYNC_UNAVAILABLE_WARNING,
      }, []);
    } catch (fallbackErr) {
      const fallbackMessage = fallbackErr instanceof Error && fallbackErr.message
        ? fallbackErr.message
        : 'Failed to list jobs';
      return serverError(requestId, 'JOBS_FALLBACK', fallbackMessage);
    }
  }

  const { data: existingJobs, error: jobsError } = await supabaseAdmin
    .from('jobs')
    .select(JOB_SELECT)
    .eq('organisation_id', organisationId)
    .not('cc_project_id', 'is', null);

  if (jobsError) {
    const supabaseErr = normalizeSupabaseError(jobsError);
    console.error('[api/jobs] GET existing CC jobs failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'JOBS_LIST', 'Failed to list jobs');
  }

  const existingCcJobs = (existingJobs ?? []) as JobRow[];
  const projectsById = new Map(projects.map((project) => [project.project_id, project]));
  const syncedJobs: JobRow[] = [];
  const usedJobIds = new Set<string>();

  for (const project of projects) {
    const existingJob = findExistingCcJob(
      existingCcJobs.filter((job) => !usedJobIds.has(job.id)),
      project,
      projectsById
    );

    if (existingJob?.hidden_from_qa_at) {
      continue;
    }

    try {
      const job = await upsertCcProjectJob(organisationId, existingJob, project, requestId);
      syncedJobs.push(job);
      usedJobIds.add(job.id);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to sync Client Connect jobs';
      const res = NextResponse.json({ ok: false, requestId, message }, { status: 502 });
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  return respondWithJobs(syncedJobs, organisationId, requestId, {}, projects);
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);

  let body: { orgSlug?: string; name?: string; siteId?: string; ccProjectId?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    console.error('[api/jobs] POST body parse failed:', { requestId });
    return serverError(requestId, 'BODY_PARSE', 'Invalid JSON body');
  }

  const orgSlug = String(body.orgSlug ?? '').trim();
  const name = String(body.name ?? '').trim();
  const siteIdRaw = body.siteId != null ? String(body.siteId).trim() : '';
  const ccProjectId = body.ccProjectId != null ? String(body.ccProjectId).trim() : '';

  if (!orgSlug) return jsonError('orgSlug is required', 400, requestId);
  if (!name && !ccProjectId) return jsonError('name or ccProjectId is required', 400, requestId);
  if (siteIdRaw && !isValidUuid(siteIdRaw)) return jsonError('siteId must be a valid UUID', 400, requestId);
  if (ccProjectId && !isValidUuid(ccProjectId)) return jsonError('ccProjectId must be a valid UUID', 400, requestId);

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .select('id')
    .eq('slug', orgSlug)
    .single();

  if (orgError || !org) {
    const supabaseErr = normalizeSupabaseError(orgError ?? null);
    console.error('[api/jobs] POST org lookup failed:', { requestId, orgSlug, supabaseError: supabaseErr });
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

  let siteId: string | null = null;
  if (siteIdRaw) {
    const { data: site, error: siteError } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteIdRaw)
      .eq('organisation_id', org.id)
      .single();
    if (siteError || !site) {
      return jsonError('siteId must belong to the same organisation', 400, requestId);
    }
    siteId = site.id;
  }

  const organisationId = staffAuth.org.id;

  let ccProject: CcProject | null = null;
  if (ccProjectId) {
    if (!isCcIntegrationOrgAllowed(organisationId)) {
      return jsonError(ccIntegrationUnavailableWarning(), 403, requestId);
    }
    let projects;
    try {
      projects = await fetchCcProjects(organisationId, requestId);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to load Client Connect projects';
      console.error('[api/jobs] POST CC fetch failed:', { requestId, error: message });
      const res = NextResponse.json(
        { ok: false, requestId, message: 'Project sync is unavailable.' },
        { status: 502 }
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
    ccProject = projects.find((project) => project.project_id === ccProjectId) ?? null;
    if (!ccProject) {
      return jsonError('Selected project is not in the active projects list', 400, requestId);
    }
    const selectedProject = ccProject;

    const { data: linkedJobs, error: linkedJobsError } = await supabaseAdmin
      .from('jobs')
      .select(JOB_SELECT)
      .eq('organisation_id', organisationId)
      .not('cc_project_id', 'is', null);
    if (linkedJobsError) {
      const supabaseErr = normalizeSupabaseError(linkedJobsError);
      console.error('[api/jobs] POST existing CC job lookup failed:', {
        requestId,
        ccIdentity: ccProjectJobIdentity(selectedProject),
        supabaseError: supabaseErr,
      });
      return serverError(requestId, supabaseErr.code ?? 'JOB_CC_LOOKUP', 'Failed to check existing linked job');
    }
    const projectsById = new Map(projects.map((project) => [project.project_id, project]));
    const selectedIdentity = ccProjectJobIdentity(selectedProject);
    const existingJob = linkedJobs?.find((job) => {
      if (typeof job.cc_job_id === 'string' && job.cc_job_id) return `cc_job_id:${job.cc_job_id}` === selectedIdentity;
      if (typeof job.cc_job_number === 'string' && job.cc_job_number) return `cc_job_number:${job.cc_job_number}` === selectedIdentity;
      if (
        typeof job.cc_quote_id === 'string' &&
        job.cc_quote_id &&
        selectedProject.quote_id &&
        job.cc_quote_id === selectedProject.quote_id
      ) {
        return true;
      }
      const linkedProject = typeof job.cc_project_id === 'string' ? projectsById.get(job.cc_project_id) : undefined;
      if (linkedProject) return ccProjectJobIdentity(linkedProject) === selectedIdentity;
      return job.cc_project_id === selectedProject.project_id;
    });
    if (existingJob) {
      const res = NextResponse.json({ ok: true, job: existingJob, existing: true }, { status: 200 });
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  const jobName = ccProject?.project_title ?? name;

  const { data: job, error: insertError } = await supabaseAdmin
    .from('jobs')
    .insert({
      organisation_id: organisationId,
      name: jobName,
      site_id: siteId,
      cc_project_id: ccProject?.project_id ?? null,
      cc_quote_id: ccProject?.quote_id ?? null,
      cc_job_id: ccProject?.cc_job_id ?? null,
      cc_job_number: ccProject?.cc_job_number ?? null,
      cc_client_id: ccProject?.client_id ?? null,
      cc_project_title_snapshot: ccProject?.project_title ?? null,
      cc_client_name_snapshot: ccProject ? ccClientDisplayName(ccProject) : null,
    })
    .select(JOB_SELECT)
    .single();

  if (insertError || !job) {
    const supabaseErr = normalizeSupabaseError(insertError ?? null);
    console.error('[api/jobs] POST insert failed:', { requestId, supabaseError: supabaseErr });
    return serverError(requestId, supabaseErr.code ?? 'JOB_INSERT', 'Failed to create job');
  }

  if (ccProject) {
    try {
      await syncCcProjectStagesForJob(job.id as string, ccProject, requestId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync Client Connect sections to stages';
      console.error('[api/jobs] POST CC stage sync failed:', {
        requestId,
        projectId: ccProject.project_id,
        jobId: job.id,
        error: message,
      });
      const res = NextResponse.json({ ok: false, requestId, message }, { status: 502 });
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }

  const res = NextResponse.json({ ok: true, job }, { status: 201 });
  res.headers.set('x-request-id', requestId);
  return res;
}
