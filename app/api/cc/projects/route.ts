import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { fetchCcProjects, toCcProjectOperationalSummary } from '@/lib/cc-client';
import {
  ccIntegrationUnavailableWarning,
  isCcIntegrationOrgAllowed,
} from '@/lib/cc-integration-access';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { validateJobForOrg } from '@/lib/job-org-validation';

export const runtime = 'nodejs';

function unavailableResponse(requestId: string, portalBaseUrl: string | null) {
  const res = NextResponse.json({
    ok: true,
    projects: [],
    portalBaseUrl,
    ccUnavailable: true,
    warning: ccIntegrationUnavailableWarning(),
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function GET(request: NextRequest) {
  const requestId =
    request.headers.get('x-request-id') ||
    randomUUID().slice(0, 8);
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const jobId = request.nextUrl.searchParams.get('jobId')?.trim() ?? '';
  const portalBaseUrl = process.env.CC_BASE_URL?.replace(/\/+$/, '') ?? null;

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  // Authoritative org id from authenticated staff context — never trust a browser org id.
  const organisationId = staffAuth.org.id;

  if (!isCcIntegrationOrgAllowed(organisationId)) {
    return unavailableResponse(requestId, portalBaseUrl);
  }

  try {
    if (jobId) {
      const validation = await validateJobForOrg(jobId, orgSlug, requestId);
      if (validation instanceof NextResponse) {
        validation.headers.set('x-request-id', requestId);
        return validation;
      }
      if (validation.organisationId !== organisationId) {
        return NextResponse.json(
          { ok: false, message: 'You do not have access to this organisation' },
          { status: 403, headers: { 'x-request-id': requestId } }
        );
      }

      const projects = await fetchCcProjects(organisationId, requestId);
      const linked =
        projects.find((project) => {
          if (validation.job.cc_quote_id && project.quote_id === validation.job.cc_quote_id) {
            return true;
          }
          return (
            Boolean(validation.job.cc_project_id) &&
            project.project_id === validation.job.cc_project_id
          );
        }) ?? null;

      const res = NextResponse.json({
        ok: true,
        projects: linked ? [toCcProjectOperationalSummary(linked)] : [],
        portalBaseUrl,
      });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    const projects = await fetchCcProjects(organisationId, requestId);
    const res = NextResponse.json({
      ok: true,
      projects: projects.map(toCcProjectOperationalSummary),
      portalBaseUrl,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    const error =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to load projects';
    console.error('[api/cc/projects] project sync fetch failed:', { requestId, error });
    return unavailableResponse(requestId, portalBaseUrl);
  }
}
