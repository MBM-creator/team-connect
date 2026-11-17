-- Permit larger Daily Plans while preserving positive, unique ordering.
-- Previous database constraint capped display_order at 3.
ALTER TABLE public.job_daily_plan_outcomes
  DROP CONSTRAINT IF EXISTS job_daily_plan_outcomes_display_order_check;

ALTER TABLE public.job_daily_plan_outcomes
  ADD CONSTRAINT job_daily_plan_outcomes_display_order_check
  CHECK (display_order >= 1 AND display_order <= 1000);
