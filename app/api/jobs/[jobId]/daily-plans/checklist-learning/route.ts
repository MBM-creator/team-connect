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
  if (!ids.length) return NextResponse.json({ ok: true, suggestions: [], comparedJobs: 0 });

  const [outcomes, equipment, materials] = await Promise.all([
    supabaseAdmin.from('job_daily_plan_outcomes').select('daily_plan_id,description').in('daily_plan_id', ids),
    supabaseAdmin.from('job_daily_plan_equipment')
      .select('daily_plan_id,description,checklist_status').in('daily_plan_id', ids)
      .neq('checklist_status', 'pending'),
    supabaseAdmin.from('job_daily_plan_materials')
      .select('daily_plan_id,description,checklist_status').in('daily_plan_id', ids)
      .neq('checklist_status', 'pending'),
  ]);
  if (outcomes.error || equipment.error || materials.error) {
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
  const suggestions = learnChecklistSuggestions(activity, [], observations, jobId)
    .filter(suggestion => suggestion.learning !== 'standard');
  return NextResponse.json({
    ok: true, suggestions,
    comparedJobs: new Set(observations.map(item => item.jobId)).size,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
