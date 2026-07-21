import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { validateJobForOrg } from '@/lib/job-org-validation';
import { isValidReportDate } from '@/lib/report-date';
import { canViewDailyPlan } from '@/lib/daily-plan-shared';
import { loadCarryForwardSuggestions } from '@/lib/daily-plan';
import { CARRY_FORWARD_LOAD_FAILED_MESSAGE } from '@/lib/daily-plan-carry-forward-suggestions';

export const runtime = 'nodejs';

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

/**
 * GET /api/jobs/[jobId]/daily-plans/carry-forward-suggestions?orgSlug=&workDate=&excludePlanId=
 * Read-only planning suggestions from the latest completed prior Daily Plan.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID().slice(0, 8);
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const workDate = request.nextUrl.searchParams.get('workDate')?.trim() ?? '';
  const excludePlanId = request.nextUrl.searchParams.get('excludePlanId')?.trim() || null;
  const includedRaw = request.nextUrl.searchParams.get('included')?.trim() ?? '';

  const staffAuth = await guardStaffApi(orgSlug);
  if (staffAuth instanceof NextResponse) {
    staffAuth.headers.set('x-request-id', requestId);
    return staffAuth;
  }

  if (!canViewDailyPlan(staffAuth.staff.role)) {
    return jsonError('Forbidden', 403, requestId);
  }

  const validation = await validateJobForOrg(jobId, orgSlug, requestId);
  if (validation instanceof NextResponse) return validation;

  if (!workDate) {
    return jsonError('workDate is required', 400, requestId);
  }
  if (!isValidReportDate(workDate)) {
    return jsonError('workDate must be YYYY-MM-DD', 400, requestId);
  }

  const includedCarryForwardIds = includedRaw
    ? includedRaw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  const result = await loadCarryForwardSuggestions({
    jobId,
    targetWorkDate: workDate,
    excludePlanId,
    includedCarryForwardIds,
  });

  if (!result.ok) {
    console.error('[api/jobs/.../carry-forward-suggestions] load failed', {
      requestId,
      code: result.code,
      message: result.message,
    });
    return serverError(requestId, result.code ?? 'CF_SUGGEST', CARRY_FORWARD_LOAD_FAILED_MESSAGE);
  }

  const res = NextResponse.json({
    ok: true,
    ...result.payload,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
