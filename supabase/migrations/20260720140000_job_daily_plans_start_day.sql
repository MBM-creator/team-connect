-- Phase 2B: Start Day and baseline locking.
-- Additive only: draft/active status plus started-by / started-at metadata.
-- Existing Phase 2A plans become draft via DEFAULT 'draft'.

ALTER TABLE public.job_daily_plans
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS started_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE public.job_daily_plans
  DROP CONSTRAINT IF EXISTS job_daily_plans_status_check,
  ADD CONSTRAINT job_daily_plans_status_check
    CHECK (status IN ('draft', 'active'));

ALTER TABLE public.job_daily_plans
  DROP CONSTRAINT IF EXISTS job_daily_plans_started_consistency_check,
  ADD CONSTRAINT job_daily_plans_started_consistency_check
    CHECK (
      (status = 'draft' AND started_by_staff_profile_id IS NULL AND started_at IS NULL)
      OR
      (status = 'active' AND started_by_staff_profile_id IS NOT NULL AND started_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_job_daily_plans_status
  ON public.job_daily_plans (job_id, status);
