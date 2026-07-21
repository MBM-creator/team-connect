-- Phase 2G: Pilot readiness — RPC execute grants, search_path, completed-plan
-- consistency, and replacement outcome status index.
-- Additive / non-destructive. Does not alter prior Daily Plan migrations.

-- ---------------------------------------------------------------------------
-- A. RPC search_path (Security Advisor parity) + execute locked to service_role
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.update_daily_plan_outcome_execution(
  UUID, UUID, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) SET search_path = public;

ALTER FUNCTION public.apply_daily_plan_change(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
) SET search_path = public;

ALTER FUNCTION public.complete_daily_plan_with_site_update(
  UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN,
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TIMESTAMPTZ
) SET search_path = public;

REVOKE ALL ON FUNCTION public.update_daily_plan_outcome_execution(
  UUID, UUID, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.apply_daily_plan_change(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.complete_daily_plan_with_site_update(
  UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN,
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TIMESTAMPTZ
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.update_daily_plan_outcome_execution(
        UUID, UUID, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
      ) FROM anon
    $rev$;
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.apply_daily_plan_change(
        UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
      ) FROM anon
    $rev$;
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.complete_daily_plan_with_site_update(
        UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN,
        TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TIMESTAMPTZ
      ) FROM anon
    $rev$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.update_daily_plan_outcome_execution(
        UUID, UUID, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
      ) FROM authenticated
    $rev$;
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.apply_daily_plan_change(
        UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
      ) FROM authenticated
    $rev$;
    EXECUTE $rev$
      REVOKE ALL ON FUNCTION public.complete_daily_plan_with_site_update(
        UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN,
        TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TIMESTAMPTZ
      ) FROM authenticated
    $rev$;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.update_daily_plan_outcome_execution(
  UUID, UUID, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

GRANT EXECUTE ON FUNCTION public.apply_daily_plan_change(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

GRANT EXECUTE ON FUNCTION public.complete_daily_plan_with_site_update(
  UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN,
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID, TIMESTAMPTZ
) TO service_role;

-- ---------------------------------------------------------------------------
-- B. Completed plan must reference the completing Daily Site Update
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.job_daily_plans
    WHERE status = 'completed'
      AND completed_daily_site_update_id IS NULL
  ) THEN
    RAISE NOTICE
      'Phase 2G: skipping completed DSU consistency CHECK — orphan completed plans exist';
  ELSE
    ALTER TABLE public.job_daily_plans
      DROP CONSTRAINT IF EXISTS job_daily_plans_started_consistency_check;

    ALTER TABLE public.job_daily_plans
      ADD CONSTRAINT job_daily_plans_started_consistency_check
        CHECK (
          (status = 'draft'
            AND started_by_staff_profile_id IS NULL
            AND started_at IS NULL
            AND completed_by_staff_profile_id IS NULL
            AND completed_at IS NULL
            AND completed_daily_site_update_id IS NULL)
          OR
          (status = 'active'
            AND started_by_staff_profile_id IS NOT NULL
            AND started_at IS NOT NULL
            AND completed_by_staff_profile_id IS NULL
            AND completed_at IS NULL
            AND completed_daily_site_update_id IS NULL)
          OR
          (status = 'completed'
            AND started_by_staff_profile_id IS NOT NULL
            AND started_at IS NOT NULL
            AND completed_by_staff_profile_id IS NOT NULL
            AND completed_at IS NOT NULL
            AND completed_daily_site_update_id IS NOT NULL)
        );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. Replacement outcome execution status index (parity with original outcomes)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_replacement_outcomes_exec_status
  ON public.job_daily_plan_replacement_outcomes (daily_plan_id, execution_status);
