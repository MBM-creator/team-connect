import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateJobForOrg, normalizeSupabaseError } from '@/lib/job-org-validation';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { loadQaRunBundle } from '@/lib/qa-run-bundle';
import { v2RunHasIncompleteEvidence } from '@/lib/paving-qa-v2-graph';
import { irrigationRunHasIncompleteEvidence } from '@/lib/irrigation-qa-v1-graph';
import { fencingRunHasIncompleteEvidence } from '@/lib/fencing-qa-v1-graph';
import { signoffRunHasIncompleteEvidence } from '@/lib/signoff-qa-v1-graph';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

function serverError(requestId: string, message = 'Internal server error') {
  const res = NextResponse.json({ ok: false, requestId, message }, { status: 500 });
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

  const v = await validateJobForOrg(jobId, orgSlug, requestId);
  if (v instanceof NextResponse) {
    v.headers.set('x-request-id', requestId);
    return v;
  }

  const { data: active, error } = await supabaseAdmin
    .from('paving_qa_runs')
    .select('id, status, qa_type, setup, started_at')
    .eq('job_id', jobId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[qa/summary]', { requestId, error: normalizeSupabaseError(error) });
    return serverError(requestId);
  }

  const activeRows = active ?? [];

  if (activeRows.length === 0) {
    const res = NextResponse.json({
      ok: true,
      activeRun: null,
      activeRuns: [],
      incompleteEvidence: false,
      incompleteByType: {},
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const activeRuns = [];
  const incompleteByType: Record<string, boolean> = {};

  for (const row of activeRows) {
    const bundle = await loadQaRunBundle(row.id as string, jobId);
    if (!bundle.ok) {
      const type = String((row as { qa_type?: string | null }).qa_type ?? 'paving');
      incompleteByType[type] = true;
      activeRuns.push({ id: row.id, started_at: row.started_at, qa_type: type, incompleteEvidence: true });
      continue;
    }

    const incomplete =
      bundle.qaType === 'irrigation'
        ? irrigationRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues)
        : bundle.qaType === 'fencing'
          ? fencingRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues)
          : bundle.qaType === 'sign_off'
            ? signoffRunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues)
          : bundle.qaType === 'paving'
              ? v2RunHasIncompleteEvidence(bundle.setup, bundle.submissions, bundle.photoRows, bundle.issues)
              : true;

    incompleteByType[bundle.qaType] = incomplete;
    activeRuns.push({
      id: row.id,
      started_at: row.started_at,
      qa_type: bundle.qaType,
      setup: bundle.setup,
      setup_version: bundle.run.setup_version,
      incompleteEvidence: incomplete,
    });
  }

  const primary = activeRuns[0] ?? null;

  const res = NextResponse.json({
    ok: true,
    activeRun: primary,
    activeRuns,
    incompleteEvidence: activeRuns.some((run) => run.incompleteEvidence),
    incompleteByType,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}
