-- Distinguish an added outcome from replacement work without mutating the locked baseline.
-- Both kinds of post-start work use the existing executable outcome table and audit trail.
ALTER TABLE public.job_daily_plan_changes
  DROP CONSTRAINT IF EXISTS job_daily_plan_changes_type_check;
ALTER TABLE public.job_daily_plan_changes
  ADD CONSTRAINT job_daily_plan_changes_type_check
  CHECK (change_type IN (
    'cancel_planned_outcome', 'add_replacement_outcome', 'add_outcome',
    'change_crew_allocation', 'change_material_requirement',
    'change_equipment_requirement', 'change_work_sequence',
    'change_due_to_site_condition', 'other'
  ));

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

  IF p_change_type IN ('add_replacement_outcome', 'add_outcome')
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
