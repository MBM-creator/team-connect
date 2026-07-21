-- Phase 2F: Plan Tomorrow from Carry-Forward
-- Additive source linkage from a new Daily Plan outcome back to a prior
-- carry-forward decision. Nullable for legacy outcomes. Reuse is allowed
-- (no unique constraint) with application-level prior-use awareness.

ALTER TABLE public.job_daily_plan_outcomes
  ADD COLUMN IF NOT EXISTS source_carry_forward_id UUID NULL
    REFERENCES public.job_daily_plan_carry_forwards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcomes_source_cf
  ON public.job_daily_plan_outcomes (source_carry_forward_id)
  WHERE source_carry_forward_id IS NOT NULL;

COMMENT ON COLUMN public.job_daily_plan_outcomes.source_carry_forward_id IS
  'Optional traceability link to a prior-day carry-forward record. Does not inherit execution state.';
