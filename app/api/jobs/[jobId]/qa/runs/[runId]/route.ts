import { NextRequest, NextResponse } from 'next/server';
import { validateJobForOrg, isValidUuid } from '@/lib/job-org-validation';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { loadQaRunBundle } from '@/lib/qa-run-bundle';
import { computeV2SectionUiStates } from '@/lib/paving-qa-v2-graph';
import { computeIrrigationSectionUiStates } from '@/lib/irrigation-qa-v1-graph';
import { computeFencingSectionUiStates } from '@/lib/fencing-qa-v1-graph';
import { computeSignoffSectionUiStates } from '@/lib/signoff-qa-v1-graph';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400, requestId?: string) {
  const res = NextResponse.json({ ok: false, message }, { status });
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; runId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId, runId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!isValidUuid(runId)) {
    return jsonError('Run not found', 404, requestId);
  }

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  const typedBundle = await loadQaRunBundle(runId, jobId);
  if (!typedBundle.ok) {
    return jsonError('Run not found', 404, requestId);
  }

  if (typedBundle.qaType === 'irrigation') {
    const sectionStates = computeIrrigationSectionUiStates(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    const res = NextResponse.json({
      ok: true,
      job: v.job,
      run: typedBundle.run,
      qaType: 'irrigation',
      setupVersion: 1,
      setup: typedBundle.setup,
      sectionStates,
      issues: typedBundle.issues,
      submissions: typedBundle.submissions,
      photoRows: typedBundle.photoRows,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (typedBundle.qaType === 'fencing') {
    const sectionStates = computeFencingSectionUiStates(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    const res = NextResponse.json({
      ok: true,
      job: v.job,
      run: typedBundle.run,
      qaType: 'fencing',
      setupVersion: 1,
      setup: typedBundle.setup,
      sectionStates,
      issues: typedBundle.issues,
      submissions: typedBundle.submissions,
      photoRows: typedBundle.photoRows,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (typedBundle.qaType === 'sign_off') {
    const sectionStates = computeSignoffSectionUiStates(
      typedBundle.setup,
      typedBundle.submissions,
      typedBundle.photoRows,
      typedBundle.issues
    );
    const res = NextResponse.json({
      ok: true,
      job: v.job,
      run: typedBundle.run,
      qaType: 'sign_off',
      setupVersion: 1,
      setup: typedBundle.setup,
      sectionStates,
      issues: typedBundle.issues,
      submissions: typedBundle.submissions,
      photoRows: typedBundle.photoRows,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const sectionStates = computeV2SectionUiStates(
    typedBundle.setup,
    typedBundle.submissions,
    typedBundle.photoRows,
    typedBundle.issues
  );
  const res = NextResponse.json({
    ok: true,
    job: v.job,
    run: typedBundle.run,
    qaType: 'paving',
    setupVersion: 2,
    setup: typedBundle.setup,
    sectionStates,
    issues: typedBundle.issues,
    submissions: typedBundle.submissions,
    photoRows: typedBundle.photoRows,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
