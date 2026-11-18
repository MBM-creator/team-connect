-- User feedback about suggestions that were not added to a daily plan.
-- This table is deliberately server-only; all access runs through staff-scoped APIs.
create table if not exists public.job_daily_plan_suggestion_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  work_date date not null,
  activity text not null check (length(activity) between 1 and 1200),
  category text not null check (category in ('tool','material')),
  description text not null check (length(description) between 1 and 300),
  decision text not null default 'not_required' check (decision = 'not_required'),
  created_at timestamptz not null default now(),
  unique(job_id, work_date, category, description)
);
create index if not exists idx_daily_plan_suggestion_feedback_org_date
  on public.job_daily_plan_suggestion_feedback (organisation_id, work_date desc);
alter table public.job_daily_plan_suggestion_feedback enable row level security;
revoke all on public.job_daily_plan_suggestion_feedback from anon, authenticated;
