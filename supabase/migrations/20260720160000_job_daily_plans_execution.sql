-- Phase 2C: Daily Plan execution tracking and controlled plan changes.
-- Additive only. Baseline descriptions, display_order, crew, materials,
-- equipment, risks, contingency and notes remain unchanged by this migration.
-- Existing outcomes default to execution_status = 'planned'.

-- ---------------------------------------------------------------------------
-- A. Execution fields on baseline outcomes
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_daily_plan_outcomes
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS status_updated_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_note TEXT,
  ADD COLUMN IF NOT EXISTS not_completed_reason_category TEXT,
  ADD COLUMN IF NOT EXISTS not_completed_explanation TEXT,
  ADD COLUMN IF NOT EXISTS completed_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.job_daily_plan_outcomes
  DROP CONSTRAINT IF EXISTS job_daily_plan_outcomes_execution_status_check,
  ADD CONSTRAINT job_daily_plan_outcomes_execution_status_check
    CHECK (execution_status IN (
      'planned',
      'in_progress',
      'completed',
      'not_completed',
      'cancelled'
    ));

ALTER TABLE public.job_daily_plan_outcomes
  DROP CONSTRAINT IF EXISTS job_daily_plan_outcomes_not_completed_reason_check,
  ADD CONSTRAINT job_daily_plan_outcomes_not_completed_reason_check
    CHECK (
      not_completed_reason_category IS NULL
      OR not_completed_reason_category IN (
        'underestimated_duration',
        'material_unavailable',
        'delivery_delay',
        'weather',
        'unexpected_site_condition',
        'client_decision',
        'inspection_or_approval_delay',
        'equipment_failure',
        'labour_or_staffing_issue',
        'quality_or_rework_issue',
        'changed_priority',
        'safety_issue',
        'other'
      )
    );

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcomes_exec_status
  ON public.job_daily_plan_outcomes (daily_plan_id, execution_status);

-- ---------------------------------------------------------------------------
-- B. Outcome execution events (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_daily_plan_outcome_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  outcome_id UUID NULL REFERENCES public.job_daily_plan_outcomes(id) ON DELETE CASCADE,
  replacement_outcome_id UUID NULL,
  event_type TEXT NOT NULL DEFAULT 'status_changed',
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  completion_note TEXT,
  not_completed_reason_category TEXT,
  not_completed_explanation TEXT,
  actor_staff_profile_id UUID NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_daily_plan_outcome_events_type_check
    CHECK (event_type IN ('status_changed')),
  CONSTRAINT job_daily_plan_outcome_events_target_check
    CHECK (
      (outcome_id IS NOT NULL AND replacement_outcome_id IS NULL)
      OR (outcome_id IS NULL AND replacement_outcome_id IS NOT NULL)
    ),
  CONSTRAINT job_daily_plan_outcome_events_from_status_check
    CHECK (from_status IN (
      'planned', 'in_progress', 'completed', 'not_completed', 'cancelled'
    )),
  CONSTRAINT job_daily_plan_outcome_events_to_status_check
    CHECK (to_status IN (
      'planned', 'in_progress', 'completed', 'not_completed', 'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcome_events_plan
  ON public.job_daily_plan_outcome_events (daily_plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcome_events_outcome
  ON public.job_daily_plan_outcome_events (outcome_id, created_at DESC)
  WHERE outcome_id IS NOT NULL;

ALTER TABLE public.job_daily_plan_outcome_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_outcome_events"
  ON public.job_daily_plan_outcome_events;
CREATE POLICY "service_role_all_job_daily_plan_outcome_events"
  ON public.job_daily_plan_outcome_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- C. Plan-change records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_daily_plan_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  reason_category TEXT NOT NULL,
  what_changed TEXT NOT NULL,
  why_changed TEXT NOT NULL,
  affected_outcome_id UUID NULL
    REFERENCES public.job_daily_plan_outcomes(id) ON DELETE RESTRICT,
  decision_maker_type TEXT NOT NULL,
  decision_maker_staff_profile_id UUID NULL
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  decision_maker_label TEXT,
  impact_today TEXT NOT NULL,
  programme_impact TEXT,
  recorded_by_staff_profile_id UUID NOT NULL
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_daily_plan_changes_type_check
    CHECK (change_type IN (
      'cancel_planned_outcome',
      'add_replacement_outcome',
      'change_crew_allocation',
      'change_material_requirement',
      'change_equipment_requirement',
      'change_work_sequence',
      'change_due_to_site_condition',
      'other'
    )),
  CONSTRAINT job_daily_plan_changes_reason_check
    CHECK (reason_category IN (
      'unexpected_site_condition',
      'weather',
      'client_decision',
      'material_or_delivery_issue',
      'equipment_issue',
      'labour_or_staffing_issue',
      'safety_issue',
      'inspection_or_approval_delay',
      'management_instruction',
      'supervisor_decision',
      'scope_clarification',
      'other'
    )),
  CONSTRAINT job_daily_plan_changes_decision_maker_check
    CHECK (decision_maker_type IN (
      'current_supervisor',
      'staff_profile',
      'management',
      'client',
      'external_party',
      'other'
    ))
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_changes_plan
  ON public.job_daily_plan_changes (daily_plan_id, created_at DESC);

ALTER TABLE public.job_daily_plan_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_changes"
  ON public.job_daily_plan_changes;
CREATE POLICY "service_role_all_job_daily_plan_changes"
  ON public.job_daily_plan_changes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- D. Replacement outcomes (not part of original baseline)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_daily_plan_replacement_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  plan_change_id UUID NOT NULL REFERENCES public.job_daily_plan_changes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  execution_status TEXT NOT NULL DEFAULT 'planned',
  status_updated_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  status_updated_at TIMESTAMPTZ,
  completion_note TEXT,
  not_completed_reason_category TEXT,
  not_completed_explanation TEXT,
  completed_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_by_staff_profile_id UUID NOT NULL
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_daily_plan_replacement_outcomes_status_check
    CHECK (execution_status IN (
      'planned',
      'in_progress',
      'completed',
      'not_completed',
      'cancelled'
    )),
  CONSTRAINT job_daily_plan_replacement_outcomes_not_completed_reason_check
    CHECK (
      not_completed_reason_category IS NULL
      OR not_completed_reason_category IN (
        'underestimated_duration',
        'material_unavailable',
        'delivery_delay',
        'weather',
        'unexpected_site_condition',
        'client_decision',
        'inspection_or_approval_delay',
        'equipment_failure',
        'labour_or_staffing_issue',
        'quality_or_rework_issue',
        'changed_priority',
        'safety_issue',
        'other'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_replacement_outcomes_plan
  ON public.job_daily_plan_replacement_outcomes (daily_plan_id, created_at);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_replacement_outcomes_change
  ON public.job_daily_plan_replacement_outcomes (plan_change_id);

ALTER TABLE public.job_daily_plan_replacement_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_replacement_outcomes"
  ON public.job_daily_plan_replacement_outcomes;
CREATE POLICY "service_role_all_job_daily_plan_replacement_outcomes"
  ON public.job_daily_plan_replacement_outcomes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- FK from events → replacement outcomes (table created after events)
ALTER TABLE public.job_daily_plan_outcome_events
  DROP CONSTRAINT IF EXISTS job_daily_plan_outcome_events_replacement_fk;
ALTER TABLE public.job_daily_plan_outcome_events
  ADD CONSTRAINT job_daily_plan_outcome_events_replacement_fk
    FOREIGN KEY (replacement_outcome_id)
    REFERENCES public.job_daily_plan_replacement_outcomes(id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcome_events_replacement
  ON public.job_daily_plan_outcome_events (replacement_outcome_id, created_at DESC)
  WHERE replacement_outcome_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- E. Atomic RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_daily_plan_outcome_execution(
  p_plan_id UUID,
  p_outcome_id UUID,
  p_is_replacement BOOLEAN,
  p_expected_from_status TEXT,
  p_to_status TEXT,
  p_actor_staff_profile_id UUID,
  p_completion_note TEXT DEFAULT NULL,
  p_not_completed_reason_category TEXT DEFAULT NULL,
  p_not_completed_explanation TEXT DEFAULT NULL,
  p_updated_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan_status TEXT;
  v_current_status TEXT;
  v_updated INT;
BEGIN
  IF p_to_status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Cancellation requires a Change Plan record'
    );
  END IF;

  SELECT status INTO v_plan_status
  FROM public.job_daily_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'message', 'Daily Plan not found');
  END IF;

  IF v_plan_status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Outcome status can only be updated on an active Daily Plan'
    );
  END IF;

  IF p_is_replacement THEN
    SELECT execution_status INTO v_current_status
    FROM public.job_daily_plan_replacement_outcomes
    WHERE id = p_outcome_id AND daily_plan_id = p_plan_id
    FOR UPDATE;

    IF v_current_status IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', false,
        'message', 'Replacement outcome not found'
      );
    END IF;

    IF v_current_status <> p_expected_from_status THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'This outcome was updated by someone else. Refresh and try again.'
      );
    END IF;

    UPDATE public.job_daily_plan_replacement_outcomes
    SET
      execution_status = p_to_status,
      status_updated_by_staff_profile_id = p_actor_staff_profile_id,
      status_updated_at = p_updated_at,
      completion_note = CASE
        WHEN p_to_status = 'completed' THEN p_completion_note
        ELSE completion_note
      END,
      not_completed_reason_category = CASE
        WHEN p_to_status = 'not_completed' THEN p_not_completed_reason_category
        ELSE not_completed_reason_category
      END,
      not_completed_explanation = CASE
        WHEN p_to_status = 'not_completed' THEN p_not_completed_explanation
        ELSE not_completed_explanation
      END,
      completed_by_staff_profile_id = CASE
        WHEN p_to_status = 'completed' THEN p_actor_staff_profile_id
        ELSE completed_by_staff_profile_id
      END,
      completed_at = CASE
        WHEN p_to_status = 'completed' THEN p_updated_at
        ELSE completed_at
      END
    WHERE id = p_outcome_id
      AND daily_plan_id = p_plan_id
      AND execution_status = p_expected_from_status;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'This outcome was updated by someone else. Refresh and try again.'
      );
    END IF;

    INSERT INTO public.job_daily_plan_outcome_events (
      daily_plan_id,
      replacement_outcome_id,
      event_type,
      from_status,
      to_status,
      completion_note,
      not_completed_reason_category,
      not_completed_explanation,
      actor_staff_profile_id,
      created_at
    ) VALUES (
      p_plan_id,
      p_outcome_id,
      'status_changed',
      p_expected_from_status,
      p_to_status,
      CASE WHEN p_to_status = 'completed' THEN p_completion_note ELSE NULL END,
      CASE WHEN p_to_status = 'not_completed' THEN p_not_completed_reason_category ELSE NULL END,
      CASE WHEN p_to_status = 'not_completed' THEN p_not_completed_explanation ELSE NULL END,
      p_actor_staff_profile_id,
      p_updated_at
    );
  ELSE
    SELECT execution_status INTO v_current_status
    FROM public.job_daily_plan_outcomes
    WHERE id = p_outcome_id AND daily_plan_id = p_plan_id
    FOR UPDATE;

    IF v_current_status IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', false,
        'message', 'Outcome not found'
      );
    END IF;

    IF v_current_status <> p_expected_from_status THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'This outcome was updated by someone else. Refresh and try again.'
      );
    END IF;

    UPDATE public.job_daily_plan_outcomes
    SET
      execution_status = p_to_status,
      status_updated_by_staff_profile_id = p_actor_staff_profile_id,
      status_updated_at = p_updated_at,
      completion_note = CASE
        WHEN p_to_status = 'completed' THEN p_completion_note
        ELSE completion_note
      END,
      not_completed_reason_category = CASE
        WHEN p_to_status = 'not_completed' THEN p_not_completed_reason_category
        ELSE not_completed_reason_category
      END,
      not_completed_explanation = CASE
        WHEN p_to_status = 'not_completed' THEN p_not_completed_explanation
        ELSE not_completed_explanation
      END,
      completed_by_staff_profile_id = CASE
        WHEN p_to_status = 'completed' THEN p_actor_staff_profile_id
        ELSE completed_by_staff_profile_id
      END,
      completed_at = CASE
        WHEN p_to_status = 'completed' THEN p_updated_at
        ELSE completed_at
      END
    WHERE id = p_outcome_id
      AND daily_plan_id = p_plan_id
      AND execution_status = p_expected_from_status;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'This outcome was updated by someone else. Refresh and try again.'
      );
    END IF;

    INSERT INTO public.job_daily_plan_outcome_events (
      daily_plan_id,
      outcome_id,
      event_type,
      from_status,
      to_status,
      completion_note,
      not_completed_reason_category,
      not_completed_explanation,
      actor_staff_profile_id,
      created_at
    ) VALUES (
      p_plan_id,
      p_outcome_id,
      'status_changed',
      p_expected_from_status,
      p_to_status,
      CASE WHEN p_to_status = 'completed' THEN p_completion_note ELSE NULL END,
      CASE WHEN p_to_status = 'not_completed' THEN p_not_completed_reason_category ELSE NULL END,
      CASE WHEN p_to_status = 'not_completed' THEN p_not_completed_explanation ELSE NULL END,
      p_actor_staff_profile_id,
      p_updated_at
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_daily_plan_change(
  p_plan_id UUID,
  p_change_type TEXT,
  p_reason_category TEXT,
  p_what_changed TEXT,
  p_why_changed TEXT,
  p_affected_outcome_id UUID,
  p_decision_maker_type TEXT,
  p_decision_maker_staff_profile_id UUID,
  p_decision_maker_label TEXT,
  p_impact_today TEXT,
  p_programme_impact TEXT,
  p_recorded_by_staff_profile_id UUID,
  p_replacement_description TEXT DEFAULT NULL,
  p_recorded_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan_status TEXT;
  v_current_status TEXT;
  v_change_id UUID;
  v_replacement_id UUID;
  v_updated INT;
BEGIN
  SELECT status INTO v_plan_status
  FROM public.job_daily_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF v_plan_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'message', 'Daily Plan not found');
  END IF;

  IF v_plan_status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Plan changes can only be recorded on an active Daily Plan'
    );
  END IF;

  IF p_change_type = 'cancel_planned_outcome' THEN
    IF p_affected_outcome_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', false,
        'message', 'Select the planned outcome to cancel'
      );
    END IF;

    SELECT execution_status INTO v_current_status
    FROM public.job_daily_plan_outcomes
    WHERE id = p_affected_outcome_id AND daily_plan_id = p_plan_id
    FOR UPDATE;

    IF v_current_status IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', false,
        'message', 'Affected outcome not found on this plan'
      );
    END IF;

    IF v_current_status NOT IN ('planned', 'in_progress') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'This outcome can no longer be cancelled. Refresh and try again.'
      );
    END IF;
  ELSIF p_affected_outcome_id IS NOT NULL THEN
    -- Non-cancel changes may optionally reference an outcome; verify ownership.
    IF NOT EXISTS (
      SELECT 1
      FROM public.job_daily_plan_outcomes
      WHERE id = p_affected_outcome_id AND daily_plan_id = p_plan_id
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', false,
        'message', 'Affected outcome not found on this plan'
      );
    END IF;
  END IF;

  IF p_change_type = 'add_replacement_outcome'
     AND (p_replacement_description IS NULL OR btrim(p_replacement_description) = '') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Replacement work description is required'
    );
  END IF;

  INSERT INTO public.job_daily_plan_changes (
    daily_plan_id,
    change_type,
    reason_category,
    what_changed,
    why_changed,
    affected_outcome_id,
    decision_maker_type,
    decision_maker_staff_profile_id,
    decision_maker_label,
    impact_today,
    programme_impact,
    recorded_by_staff_profile_id,
    created_at
  ) VALUES (
    p_plan_id,
    p_change_type,
    p_reason_category,
    p_what_changed,
    p_why_changed,
    p_affected_outcome_id,
    p_decision_maker_type,
    p_decision_maker_staff_profile_id,
    p_decision_maker_label,
    p_impact_today,
    p_programme_impact,
    p_recorded_by_staff_profile_id,
    p_recorded_at
  )
  RETURNING id INTO v_change_id;

  IF p_change_type = 'cancel_planned_outcome' THEN
    UPDATE public.job_daily_plan_outcomes
    SET
      execution_status = 'cancelled',
      status_updated_by_staff_profile_id = p_recorded_by_staff_profile_id,
      status_updated_at = p_recorded_at
    WHERE id = p_affected_outcome_id
      AND daily_plan_id = p_plan_id
      AND execution_status = v_current_status;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'conflict: outcome status changed during cancel'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.job_daily_plan_outcome_events (
      daily_plan_id,
      outcome_id,
      event_type,
      from_status,
      to_status,
      actor_staff_profile_id,
      created_at
    ) VALUES (
      p_plan_id,
      p_affected_outcome_id,
      'status_changed',
      v_current_status,
      'cancelled',
      p_recorded_by_staff_profile_id,
      p_recorded_at
    );
  END IF;

  IF p_replacement_description IS NOT NULL AND btrim(p_replacement_description) <> '' THEN
    INSERT INTO public.job_daily_plan_replacement_outcomes (
      daily_plan_id,
      plan_change_id,
      description,
      execution_status,
      created_by_staff_profile_id,
      created_at
    ) VALUES (
      p_plan_id,
      v_change_id,
      btrim(p_replacement_description),
      'planned',
      p_recorded_by_staff_profile_id,
      p_recorded_at
    )
    RETURNING id INTO v_replacement_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'changeId', v_change_id,
    'replacementOutcomeId', v_replacement_id
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'This outcome was updated by someone else. Refresh and try again.'
    );
END;
$$;
