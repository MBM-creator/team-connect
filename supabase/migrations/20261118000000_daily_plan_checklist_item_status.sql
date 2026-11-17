-- Smart Checklist item states belong to the real saved daily-plan rows.
-- Keep existing rows pending until explicitly marked.
ALTER TABLE public.job_daily_plan_materials
  ADD COLUMN IF NOT EXISTS checklist_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS checklist_reason text;
ALTER TABLE public.job_daily_plan_equipment
  ADD COLUMN IF NOT EXISTS checklist_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS checklist_reason text;

ALTER TABLE public.job_daily_plan_materials
  ADD CONSTRAINT job_daily_plan_materials_checklist_state_check
  CHECK (checklist_status IN ('pending','loaded','not_required','not_required_for_job')
    AND (checklist_status <> 'not_required_for_job'
      OR (checklist_reason IS NOT NULL AND length(btrim(checklist_reason)) > 0))
    AND (checklist_status = 'not_required_for_job' OR checklist_reason IS NULL));
ALTER TABLE public.job_daily_plan_equipment
  ADD CONSTRAINT job_daily_plan_equipment_checklist_state_check
  CHECK (checklist_status IN ('pending','loaded','not_required','not_required_for_job')
    AND (checklist_status <> 'not_required_for_job'
      OR (checklist_reason IS NOT NULL AND length(btrim(checklist_reason)) > 0))
    AND (checklist_status = 'not_required_for_job' OR checklist_reason IS NULL));
