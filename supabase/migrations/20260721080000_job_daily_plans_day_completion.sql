-- Phase 2D: Daily Plan completed status + Daily Site Update day-completion linkage.
-- Additive only. Legacy DSU rows and reports without plans remain valid.

-- ---------------------------------------------------------------------------
-- A. Daily Plan: completed status + completion metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_daily_plans
  ADD COLUMN IF NOT EXISTS completed_by_staff_profile_id UUID
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_daily_site_update_id UUID;

ALTER TABLE public.job_daily_plans
  DROP CONSTRAINT IF EXISTS job_daily_plans_status_check,
  ADD CONSTRAINT job_daily_plans_status_check
    CHECK (status IN ('draft', 'active', 'completed'));

ALTER TABLE public.job_daily_plans
  DROP CONSTRAINT IF EXISTS job_daily_plans_started_consistency_check,
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
        AND completed_at IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- B. Daily Site Update: plan linkage + tomorrow notes + day-completion flags
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_daily_site_updates
  ADD COLUMN IF NOT EXISTS daily_plan_id UUID
    REFERENCES public.job_daily_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes_for_tomorrow TEXT,
  ADD COLUMN IF NOT EXISTS is_day_completion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submission_status TEXT NOT NULL DEFAULT 'submitted';

ALTER TABLE public.job_daily_site_updates
  DROP CONSTRAINT IF EXISTS job_daily_site_updates_submission_status_check,
  ADD CONSTRAINT job_daily_site_updates_submission_status_check
    CHECK (submission_status IN ('draft', 'submitted'));

-- One day-completion draft per job/date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_daily_site_updates_day_completion_draft
  ON public.job_daily_site_updates (job_id, report_date)
  WHERE is_day_completion = true
    AND submission_status = 'draft'
    AND voided_at IS NULL;

-- At most one submitted day-completion per job/date (completes the plan).
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_daily_site_updates_day_completion_submitted
  ON public.job_daily_site_updates (job_id, report_date)
  WHERE is_day_completion = true
    AND submission_status = 'submitted'
    AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_daily_site_updates_daily_plan
  ON public.job_daily_site_updates (daily_plan_id)
  WHERE daily_plan_id IS NOT NULL;

-- FK from plan → completing DSU (after DSU columns exist)
ALTER TABLE public.job_daily_plans
  DROP CONSTRAINT IF EXISTS job_daily_plans_completed_dsu_fk;
ALTER TABLE public.job_daily_plans
  ADD CONSTRAINT job_daily_plans_completed_dsu_fk
    FOREIGN KEY (completed_daily_site_update_id)
    REFERENCES public.job_daily_site_updates(id)
    ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- C. Carry-forward records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_daily_plan_carry_forwards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  daily_site_update_id UUID NULL
    REFERENCES public.job_daily_site_updates(id) ON DELETE CASCADE,
  outcome_id UUID NULL
    REFERENCES public.job_daily_plan_outcomes(id) ON DELETE RESTRICT,
  replacement_outcome_id UUID NULL
    REFERENCES public.job_daily_plan_replacement_outcomes(id) ON DELETE RESTRICT,
  carry_forward BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  recorded_by_staff_profile_id UUID NOT NULL
    REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_daily_plan_carry_forwards_source_check
    CHECK (
      (outcome_id IS NOT NULL AND replacement_outcome_id IS NULL)
      OR (outcome_id IS NULL AND replacement_outcome_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_daily_plan_carry_forwards_outcome
  ON public.job_daily_plan_carry_forwards (daily_plan_id, outcome_id)
  WHERE outcome_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_daily_plan_carry_forwards_replacement
  ON public.job_daily_plan_carry_forwards (daily_plan_id, replacement_outcome_id)
  WHERE replacement_outcome_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_carry_forwards_plan
  ON public.job_daily_plan_carry_forwards (daily_plan_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_carry_forwards_update
  ON public.job_daily_plan_carry_forwards (daily_site_update_id)
  WHERE daily_site_update_id IS NOT NULL;

ALTER TABLE public.job_daily_plan_carry_forwards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_carry_forwards"
  ON public.job_daily_plan_carry_forwards;
CREATE POLICY "service_role_all_job_daily_plan_carry_forwards"
  ON public.job_daily_plan_carry_forwards FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- D. Harden Phase 2C RPCs for completed plans (clearer message)
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

  IF v_plan_status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'This Daily Plan has been completed and is read-only.'
    );
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

  IF v_plan_status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'This Daily Plan has been completed and is read-only.'
    );
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

-- ---------------------------------------------------------------------------
-- E. Atomic final day completion: submit DSU day-completion + complete plan
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_daily_plan_with_site_update(
  p_job_id UUID,
  p_plan_id UUID,
  p_actor_staff_profile_id UUID,
  p_stage_id UUID,
  p_report_date DATE,
  p_report_timezone TEXT,
  p_progress_today TEXT,
  p_issues_faced TEXT,
  p_issues_faced_none BOOLEAN,
  p_problems_resolved TEXT,
  p_problems_resolved_none BOOLEAN,
  p_prevention_plan TEXT,
  p_prevention_plan_none BOOLEAN,
  p_on_track_status TEXT,
  p_on_track_notes TEXT,
  p_notes_for_tomorrow TEXT,
  p_planned_hours_snapshot NUMERIC,
  p_hours_used_snapshot NUMERIC,
  p_hours_remaining_snapshot NUMERIC,
  p_hours_source TEXT,
  p_carry_forwards JSONB,
  p_draft_update_id UUID DEFAULT NULL,
  p_completed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan RECORD;
  v_update_id UUID;
  v_existing_completion UUID;
  v_unresolved_count INT;
  v_cf JSONB;
  v_outcome_id UUID;
  v_replacement_id UUID;
BEGIN
  SELECT id, job_id, work_date, status, completed_by_staff_profile_id, completed_at,
         completed_daily_site_update_id, started_by_staff_profile_id, started_at
  INTO v_plan
  FROM public.job_daily_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF v_plan.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'message', 'Daily Plan not found');
  END IF;

  IF v_plan.job_id <> p_job_id THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'message', 'Daily Plan does not belong to this job');
  END IF;

  IF v_plan.work_date <> p_report_date THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Daily Plan work date does not match the report date'
    );
  END IF;

  IF v_plan.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'alreadyCompleted', true,
      'updateId', v_plan.completed_daily_site_update_id,
      'completedAt', v_plan.completed_at,
      'completedByStaffProfileId', v_plan.completed_by_staff_profile_id
    );
  END IF;

  IF v_plan.status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Only an active Daily Plan can be completed'
    );
  END IF;

  SELECT COUNT(*) INTO v_unresolved_count
  FROM (
    SELECT id FROM public.job_daily_plan_outcomes
    WHERE daily_plan_id = p_plan_id
      AND execution_status IN ('planned', 'in_progress')
    UNION ALL
    SELECT id FROM public.job_daily_plan_replacement_outcomes
    WHERE daily_plan_id = p_plan_id
      AND execution_status IN ('planned', 'in_progress')
  ) unresolved;

  IF v_unresolved_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'The Daily Plan still has unfinished outcomes.',
      'unresolvedCount', v_unresolved_count
    );
  END IF;

  SELECT id INTO v_existing_completion
  FROM public.job_daily_site_updates
  WHERE job_id = p_job_id
    AND report_date = p_report_date
    AND is_day_completion = true
    AND submission_status = 'submitted'
    AND voided_at IS NULL
  LIMIT 1;

  IF v_existing_completion IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'A day-completion report already exists for this date.'
    );
  END IF;

  IF p_draft_update_id IS NOT NULL THEN
    UPDATE public.job_daily_site_updates
    SET
      stage_id = p_stage_id,
      author_staff_profile_id = p_actor_staff_profile_id,
      report_timezone = p_report_timezone,
      submitted_at = p_completed_at,
      progress_today = p_progress_today,
      issues_faced = p_issues_faced,
      issues_faced_none = p_issues_faced_none,
      problems_resolved = p_problems_resolved,
      problems_resolved_none = p_problems_resolved_none,
      prevention_plan = p_prevention_plan,
      prevention_plan_none = p_prevention_plan_none,
      on_track_status = p_on_track_status,
      on_track_notes = p_on_track_notes,
      notes_for_tomorrow = p_notes_for_tomorrow,
      planned_hours_snapshot = p_planned_hours_snapshot,
      hours_used_snapshot = p_hours_used_snapshot,
      hours_remaining_snapshot = p_hours_remaining_snapshot,
      hours_source = p_hours_source,
      daily_plan_id = p_plan_id,
      is_day_completion = true,
      submission_status = 'submitted'
    WHERE id = p_draft_update_id
      AND job_id = p_job_id
      AND report_date = p_report_date
      AND is_day_completion = true
      AND submission_status = 'draft'
      AND voided_at IS NULL
    RETURNING id INTO v_update_id;

    IF v_update_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'message', 'Day-completion draft was not found or was already submitted.'
      );
    END IF;

    DELETE FROM public.job_daily_plan_carry_forwards
    WHERE daily_site_update_id = v_update_id;
  ELSE
    INSERT INTO public.job_daily_site_updates (
      job_id,
      stage_id,
      author_staff_profile_id,
      report_date,
      report_timezone,
      submitted_at,
      progress_today,
      issues_faced,
      issues_faced_none,
      problems_resolved,
      problems_resolved_none,
      prevention_plan,
      prevention_plan_none,
      on_track_status,
      on_track_notes,
      notes_for_tomorrow,
      planned_hours_snapshot,
      hours_used_snapshot,
      hours_remaining_snapshot,
      hours_source,
      daily_plan_id,
      is_day_completion,
      submission_status
    ) VALUES (
      p_job_id,
      p_stage_id,
      p_actor_staff_profile_id,
      p_report_date,
      p_report_timezone,
      p_completed_at,
      p_progress_today,
      p_issues_faced,
      p_issues_faced_none,
      p_problems_resolved,
      p_problems_resolved_none,
      p_prevention_plan,
      p_prevention_plan_none,
      p_on_track_status,
      p_on_track_notes,
      p_notes_for_tomorrow,
      p_planned_hours_snapshot,
      p_hours_used_snapshot,
      p_hours_remaining_snapshot,
      p_hours_source,
      p_plan_id,
      true,
      'submitted'
    )
    RETURNING id INTO v_update_id;
  END IF;

  IF p_carry_forwards IS NOT NULL AND jsonb_typeof(p_carry_forwards) = 'array' THEN
    FOR v_cf IN SELECT * FROM jsonb_array_elements(p_carry_forwards)
    LOOP
      v_outcome_id := NULLIF(v_cf->>'outcomeId', '')::UUID;
      v_replacement_id := NULLIF(v_cf->>'replacementOutcomeId', '')::UUID;

      IF (v_outcome_id IS NULL AND v_replacement_id IS NULL)
         OR (v_outcome_id IS NOT NULL AND v_replacement_id IS NOT NULL) THEN
        RAISE EXCEPTION 'invalid carry-forward source'
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.job_daily_plan_carry_forwards (
        daily_plan_id,
        daily_site_update_id,
        outcome_id,
        replacement_outcome_id,
        carry_forward,
        note,
        recorded_by_staff_profile_id,
        recorded_at
      ) VALUES (
        p_plan_id,
        v_update_id,
        v_outcome_id,
        v_replacement_id,
        COALESCE((v_cf->>'carryForward')::BOOLEAN, true),
        NULLIF(btrim(COALESCE(v_cf->>'note', '')), ''),
        p_actor_staff_profile_id,
        p_completed_at
      );
    END LOOP;
  END IF;

  UPDATE public.job_daily_plans
  SET
    status = 'completed',
    completed_by_staff_profile_id = p_actor_staff_profile_id,
    completed_at = p_completed_at,
    completed_daily_site_update_id = v_update_id
  WHERE id = p_plan_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'This Daily Plan was updated by someone else. Refresh and try again.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'alreadyCompleted', false,
    'updateId', v_update_id,
    'completedAt', p_completed_at,
    'completedByStaffProfileId', p_actor_staff_profile_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', true,
      'message', 'A day-completion report already exists for this date.'
    );
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'conflict', false,
      'message', 'Invalid carry-forward selection'
    );
END;
$$;
