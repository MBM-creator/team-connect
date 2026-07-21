/**
 * Staging/local pilot workflow seed for Daily Plan Phase 2G.
 *
 * Creates (idempotent where possible):
 * - one admin, one supervisor, one field user
 * - one operational job + stage
 * - one completed prior plan with carry-forward
 * - one active plan (today Melbourne)
 * - one draft future plan
 * - one older completed sample plan
 *
 * Safety:
 *   ALLOW_PILOT_SEED=true
 *   SEED_TARGET=staging|local  (production refused)
 *
 * Usage:
 *   ALLOW_PILOT_SEED=true \
 *   SEED_TARGET=staging \
 *   SEED_ORG_SLUG=madebymobbs \
 *   SEED_ADMIN_EMAIL=admin@example.com \
 *   SEED_ADMIN_PASSWORD='temp-password' \
 *   SEED_SUPERVISOR_EMAIL=supervisor@example.com \
 *   SEED_SUPERVISOR_PASSWORD='temp-password' \
 *   SEED_FIELD_EMAIL=field@example.com \
 *   SEED_FIELD_PASSWORD='temp-password' \
 *   npm run seed-pilot-workflow
 *
 * Never run against production. Rotate temporary passwords after use.
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nextCalendarDate, todayReportDate } from '../lib/report-date';

const TZ = 'Australia/Melbourne';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertSeedAllowed(): void {
  if (process.env.ALLOW_PILOT_SEED !== 'true') {
    throw new Error('Refusing to seed: set ALLOW_PILOT_SEED=true');
  }
  const target = (process.env.SEED_TARGET ?? '').trim().toLowerCase();
  if (target !== 'staging' && target !== 'local') {
    throw new Error('Refusing to seed: SEED_TARGET must be staging or local');
  }
  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').toLowerCase();
  if (
    appUrl.includes('qa.madebymobbs.com.au') ||
    appUrl.includes('production') ||
    process.env.VERCEL_ENV === 'production'
  ) {
    throw new Error('Refusing to seed: production environment detected');
  }
}

function shiftDate(workDate: string, days: number): string {
  const [y, m, d] = workDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureAuthUser(
  supabase: SupabaseClient,
  email: string,
  password: string,
  fullName: string
): Promise<string> {
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(`Failed to list users: ${listError.message}`);

  const existing = listData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create ${email}: ${createError?.message ?? 'unknown'}`);
  }
  return created.user.id;
}

async function ensureStaffProfile(
  supabase: SupabaseClient,
  input: {
    userId: string;
    orgId: string;
    email: string;
    fullName: string;
    role: 'admin' | 'supervisor' | 'field';
  }
): Promise<void> {
  const { data: existing, error: loadError } = await supabase
    .from('staff_profiles')
    .select('id')
    .eq('id', input.userId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);

  const row = {
    full_name: input.fullName,
    email: input.email,
    role: input.role,
    active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase
      .from('staff_profiles')
      .update(row)
      .eq('id', input.userId)
      .eq('org_id', input.orgId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('staff_profiles').insert({
    id: input.userId,
    org_id: input.orgId,
    ...row,
  });
  if (error) throw new Error(error.message);
}

async function ensureJob(
  supabase: SupabaseClient,
  orgId: string,
  name: string
): Promise<{ jobId: string; stageId: string }> {
  const { data: existing } = await supabase
    .from('jobs')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('name', name)
    .maybeSingle();

  let jobId = existing?.id as string | undefined;
  if (!jobId) {
    const { data: created, error } = await supabase
      .from('jobs')
      .insert({ organisation_id: orgId, name })
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Failed to create job');
    jobId = created.id;
  }

  const { data: stageExisting } = await supabase
    .from('stages')
    .select('id')
    .eq('job_id', jobId)
    .eq('name', 'Pilot Stage')
    .maybeSingle();

  let stageId = stageExisting?.id as string | undefined;
  if (!stageId) {
    const { data: stage, error } = await supabase
      .from('stages')
      .insert({ job_id: jobId, name: 'Pilot Stage', sort_order: 1 })
      .select('id')
      .single();
    if (error || !stage) throw new Error(error?.message ?? 'Failed to create stage');
    stageId = stage.id;
  }

  await supabase.from('jobs').update({ active_stage_id: stageId }).eq('id', jobId);

  return { jobId, stageId };
}

async function upsertPlan(
  supabase: SupabaseClient,
  input: {
    jobId: string;
    workDate: string;
    supervisorId: string;
    status: 'draft' | 'active' | 'completed';
    outcomeDescriptions: string[];
  }
): Promise<string> {
  const { data: existing } = await supabase
    .from('job_daily_plans')
    .select('id')
    .eq('job_id', input.jobId)
    .eq('work_date', input.workDate)
    .maybeSingle();

  const now = new Date().toISOString();
  // Persist draft/active only here; completed plans are finalised via DSU linkage below.
  const persistedStatus = input.status === 'completed' ? 'active' : input.status;
  const base = {
    supervisor_staff_profile_id: input.supervisorId,
    created_by_staff_profile_id: input.supervisorId,
    work_timezone: TZ,
    risks_constraints: 'Pilot seed risks',
    contingency_plan: 'Pilot seed contingency',
    general_notes: 'Pilot seed plan',
    status: persistedStatus,
    started_by_staff_profile_id:
      persistedStatus === 'draft' ? null : input.supervisorId,
    started_at: persistedStatus === 'draft' ? null : now,
    completed_by_staff_profile_id: null,
    completed_at: null,
    completed_daily_site_update_id: null,
  };

  let planId = existing?.id as string | undefined;
  if (planId) {
    const { error } = await supabase.from('job_daily_plans').update(base).eq('id', planId);
    if (error) throw new Error(error.message);
  } else {
    const { data: created, error } = await supabase
      .from('job_daily_plans')
      .insert({
        job_id: input.jobId,
        work_date: input.workDate,
        ...base,
      })
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Failed to create plan');
    planId = created.id;
  }

  await supabase.from('job_daily_plan_outcomes').delete().eq('daily_plan_id', planId);
  const { error: outcomeError } = await supabase.from('job_daily_plan_outcomes').insert(
    input.outcomeDescriptions.map((description, index) => ({
      daily_plan_id: planId,
      description,
      display_order: index + 1,
      execution_status:
        input.status === 'completed'
          ? index === 0
            ? 'completed'
            : 'not_completed'
          : input.status === 'active'
            ? index === 0
              ? 'in_progress'
              : 'planned'
            : 'planned',
      not_completed_reason_category:
        input.status === 'completed' && index > 0 ? 'unexpected_site_condition' : null,
      not_completed_explanation:
        input.status === 'completed' && index > 0 ? 'Pilot seed carry-forward source' : null,
    }))
  );
  if (outcomeError) throw new Error(outcomeError.message);

  return planId;
}

async function completePlanWithDsuAndCarryForward(
  supabase: SupabaseClient,
  input: {
    jobId: string;
    stageId: string;
    planId: string;
    workDate: string;
    supervisorId: string;
  }
): Promise<void> {
  const { data: outcomes, error: outcomesError } = await supabase
    .from('job_daily_plan_outcomes')
    .select('id, execution_status')
    .eq('daily_plan_id', input.planId)
    .order('display_order', { ascending: true });
  if (outcomesError) throw new Error(outcomesError.message);

  const { data: existingDsu } = await supabase
    .from('job_daily_site_updates')
    .select('id')
    .eq('job_id', input.jobId)
    .eq('report_date', input.workDate)
    .eq('is_day_completion', true)
    .eq('submission_status', 'submitted')
    .is('voided_at', null)
    .maybeSingle();

  let updateId = existingDsu?.id as string | undefined;
  if (!updateId) {
    const { data: inserted, error } = await supabase
      .from('job_daily_site_updates')
      .insert({
        job_id: input.jobId,
        stage_id: input.stageId,
        author_staff_profile_id: input.supervisorId,
        report_date: input.workDate,
        report_timezone: TZ,
        progress_today: 'Pilot seed day completed',
        issues_faced_none: true,
        problems_resolved_none: true,
        prevention_plan_none: true,
        on_track_status: 'on_track',
        notes_for_tomorrow: 'Finish unfinished pilot outcomes tomorrow.',
        daily_plan_id: input.planId,
        is_day_completion: true,
        submission_status: 'submitted',
      })
      .select('id')
      .single();
    if (error || !inserted) throw new Error(error?.message ?? 'Failed to create completing DSU');
    updateId = inserted.id;
  }

  const now = new Date().toISOString();
  const { error: planError } = await supabase
    .from('job_daily_plans')
    .update({
      status: 'completed',
      started_by_staff_profile_id: input.supervisorId,
      started_at: now,
      completed_by_staff_profile_id: input.supervisorId,
      completed_at: now,
      completed_daily_site_update_id: updateId,
    })
    .eq('id', input.planId);
  if (planError) throw new Error(planError.message);

  const notCompleted = (outcomes ?? []).filter((o) => o.execution_status === 'not_completed');
  for (const outcome of notCompleted) {
    const { data: existingCf } = await supabase
      .from('job_daily_plan_carry_forwards')
      .select('id')
      .eq('outcome_id', outcome.id)
      .maybeSingle();
    if (existingCf) continue;
    const { error: cfError } = await supabase.from('job_daily_plan_carry_forwards').insert({
      daily_plan_id: input.planId,
      daily_site_update_id: updateId,
      outcome_id: outcome.id,
      carry_forward: true,
      note: 'Pilot seed carry-forward',
      recorded_by_staff_profile_id: input.supervisorId,
    });
    if (cfError) throw new Error(cfError.message);
  }
}

async function main() {
  assertSeedAllowed();

  const orgSlug = process.env.SEED_ORG_SLUG?.trim() || 'madebymobbs';
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const supervisorEmail = requireEnv('SEED_SUPERVISOR_EMAIL').toLowerCase();
  const supervisorPassword = requireEnv('SEED_SUPERVISOR_PASSWORD');
  const fieldEmail = requireEnv('SEED_FIELD_EMAIL').toLowerCase();
  const fieldPassword = requireEnv('SEED_FIELD_PASSWORD');

  if ([adminPassword, supervisorPassword, fieldPassword].some((p) => p.length < 8)) {
    throw new Error('All seed passwords must be at least 8 characters');
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .select('id, slug, name')
    .eq('slug', orgSlug)
    .single();
  if (orgError || !org) throw new Error(`Organisation not found: ${orgSlug}`);

  const adminId = await ensureAuthUser(supabase, adminEmail, adminPassword, 'Pilot Admin');
  const supervisorId = await ensureAuthUser(
    supabase,
    supervisorEmail,
    supervisorPassword,
    'Pilot Supervisor'
  );
  const fieldId = await ensureAuthUser(supabase, fieldEmail, fieldPassword, 'Pilot Field');

  await ensureStaffProfile(supabase, {
    userId: adminId,
    orgId: org.id,
    email: adminEmail,
    fullName: 'Pilot Admin',
    role: 'admin',
  });
  await ensureStaffProfile(supabase, {
    userId: supervisorId,
    orgId: org.id,
    email: supervisorEmail,
    fullName: 'Pilot Supervisor',
    role: 'supervisor',
  });
  await ensureStaffProfile(supabase, {
    userId: fieldId,
    orgId: org.id,
    email: fieldEmail,
    fullName: 'Pilot Field',
    role: 'field',
  });

  const { jobId, stageId } = await ensureJob(supabase, org.id, 'Pilot Daily Plan Job');

  const today = todayReportDate(TZ);
  const yesterday = shiftDate(today, -1);
  const twoDaysAgo = shiftDate(today, -2);
  const tomorrow = nextCalendarDate(today) ?? shiftDate(today, 1);

  const completedPriorId = await upsertPlan(supabase, {
    jobId,
    workDate: yesterday,
    supervisorId,
    status: 'completed',
    outcomeDescriptions: [
      'Completed kerb prep (pilot)',
      'Unfinished irrigation set-out (pilot)',
    ],
  });
  await completePlanWithDsuAndCarryForward(supabase, {
    jobId,
    stageId,
    planId: completedPriorId,
    workDate: yesterday,
    supervisorId,
  });

  await upsertPlan(supabase, {
    jobId,
    workDate: today,
    supervisorId,
    status: 'active',
    outcomeDescriptions: [
      'Active outcome A (pilot)',
      'Active outcome B (pilot)',
      'Active outcome C (pilot)',
    ],
  });

  await upsertPlan(supabase, {
    jobId,
    workDate: tomorrow,
    supervisorId,
    status: 'draft',
    outcomeDescriptions: ['Draft tomorrow outcome (pilot)'],
  });

  const olderCompletedId = await upsertPlan(supabase, {
    jobId,
    workDate: twoDaysAgo,
    supervisorId,
    status: 'completed',
    outcomeDescriptions: ['Older completed sample (pilot)'],
  });
  await completePlanWithDsuAndCarryForward(supabase, {
    jobId,
    stageId,
    planId: olderCompletedId,
    workDate: twoDaysAgo,
    supervisorId,
  });

  console.log('');
  console.log('Pilot seed complete.');
  console.log(`  Org: ${orgSlug}`);
  console.log(`  Job: Pilot Daily Plan Job (${jobId})`);
  console.log(`  Completed prior (with CF): ${yesterday}`);
  console.log(`  Active today: ${today}`);
  console.log(`  Draft future: ${tomorrow}`);
  console.log(`  Older completed: ${twoDaysAgo}`);
  console.log('');
  console.log('Sign in as supervisor and open:');
  console.log(`  /t/${orgSlug}/jobs/${jobId}/today`);
  console.log(`  /t/${orgSlug}/site-operations  (admin)`);
  console.log('');
  console.log('TODO: Rotate temporary seed passwords after testing.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
