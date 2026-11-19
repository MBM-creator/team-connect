import { NextRequest, NextResponse } from 'next/server';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { validateJobForOrg } from '@/lib/job-org-validation';
import { isValidReportDate } from '@/lib/report-date';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { learnChecklistSuggestions, type ChecklistLearningObservation } from '@/lib/smart-checklist-learning';
import type { ChecklistStatus } from '@/lib/smart-checklist';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug') ?? '';
  const workDate = request.nextUrl.searchParams.get('workDate') ?? '';
  const activity = (request.nextUrl.searchParams.get('activity') ?? '').trim();
  const auth = await guardStaffApi(orgSlug);
  if (auth instanceof NextResponse) return auth;
  const validated = await validateJobForOrg(jobId, orgSlug, 'smart-checklist-learning');
  if (validated instanceof NextResponse) return validated;
  if (!isValidReportDate(workDate) || activity.length > 1200) {
    return NextResponse.json({ ok: false, message: 'Invalid date or activity' }, { status: 400 });
  }
  if (!activity) return NextResponse.json({ ok: true, suggestions: [], comparedJobs: 0 });

  // Strict tenant scope is applied BEFORE reading child items, and the current job
  // is excluded. Date scope prevents later work from influencing an earlier plan.
  const plans = await supabaseAdmin.from('job_daily_plans')
    .select('id,job_id,work_date,jobs!inner(organisation_id)')
    .eq('jobs.organisation_id', validated.organisationId)
    .neq('job_id', jobId)
    .lt('work_date', workDate)
    .order('work_date', { ascending: false }).limit(150);
  if (plans.error) {
    return NextResponse.json({ ok: false, message: 'Could not load checklist history' }, { status: 500 });
  }
  const historyPlans = plans.data ?? [];
  const ids = historyPlans.map(plan => plan.id);


  const [outcomes, equipment, materials, dismissed] = await Promise.all([
    supabaseAdmin.from('job_daily_plan_outcomes').select('daily_plan_id,description').in('daily_plan_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    supabaseAdmin.from('job_daily_plan_equipment')
      .select('daily_plan_id,description,checklist_status').in('daily_plan_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      .neq('checklist_status', 'pending'),
    supabaseAdmin.from('job_daily_plan_materials')
      .select('daily_plan_id,description,checklist_status').in('daily_plan_id', ids)
      .neq('checklist_status', 'pending'),
    supabaseAdmin.from('job_daily_plan_suggestion_feedback')
      .select('job_id,work_date,activity,category,description')
      .eq('organisation_id', validated.organisationId)
      .neq('job_id', jobId).lt('work_date', workDate)
      .order('work_date', { ascending: false }).limit(300),
  ]);
  if (outcomes.error || equipment.error || materials.error || dismissed.error) {
    return NextResponse.json({ ok: false, message: 'Could not load checklist history' }, { status: 500 });
  }
  const byPlan = new Map(historyPlans.map(plan => [plan.id, plan]));
  const activityByPlan = new Map<string, string[]>();
  for (const outcome of outcomes.data ?? []) {
    activityByPlan.set(outcome.daily_plan_id, [
      ...(activityByPlan.get(outcome.daily_plan_id) ?? []), outcome.description,
    ]);
  }
  const observations: ChecklistLearningObservation[] = [];
  for (const [kind, records] of [
    ['tool', equipment.data ?? []],
    ['material', materials.data ?? []],
  ] as const) {
    for (const record of records) {
      const plan = byPlan.get(record.daily_plan_id);
      if (!plan) continue;
      observations.push({
        jobId: plan.job_id, workDate: plan.work_date,
        activity: (activityByPlan.get(plan.id) ?? []).join(' '),
        category: kind, description: record.description, status: record.checklist_status as ChecklistStatus,
      });
    }
  }
  for (const record of dismissed.data ?? []) {
    observations.push({
      jobId: record.job_id, workDate: record.work_date,
      activity: record.activity, category: record.category as 'tool' | 'material',
      description: record.description, status: 'not_required',
    });
  }
  const suggestions = learnChecklistSuggestions(activity, [], observations, jobId);
  return NextResponse.json({
    ok: true, suggestions,
    comparedJobs: new Set(observations.map(item => item.jobId)).size,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, message: 'Invalid request origin' }, { status: 403 });
  }
  const { jobId } = await params;
  const orgSlug = request.nextUrl.searchParams.get('orgSlug') ?? '';
  const auth = await guardStaffApi(orgSlug, ['supervisor', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const validated = await validateJobForOrg(jobId, orgSlug, 'smart-checklist-feedback');
  if (validated instanceof NextResponse) return validated;
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid body');
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body' }, { status: 400 });
  }
  const workDate = typeof body.workDate === 'string' ? body.workDate : '';
  const activity = typeof body.activity === 'string' ? body.activity.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = body.category;
  if (!isValidReportDate(workDate) || !activity || activity.length > 1200 ||
      !description || description.length > 300 || !['tool', 'material'].includes(String(category))) {
    return NextResponse.json({ ok: false, message: 'Invalid suggestion feedback' }, { status: 400 });
  }
  const saved = await supabaseAdmin.from('job_daily_plan_suggestion_feedback').upsert({
    organisation_id: validated.organisationId, job_id: jobId, work_date: workDate,
    activity, description, category, decision: 'not_required',
  }, { onConflict: 'job_id,work_date,category,description' });
  if (saved.error) {
    return NextResponse.json({ ok: false, message: 'Could not record suggestion feedback' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
