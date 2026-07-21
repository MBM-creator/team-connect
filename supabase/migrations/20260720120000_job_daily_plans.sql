-- Phase 2A: Draft Daily Plans (one plan per job per Melbourne work date).
-- No status/workflow columns; all plans are editable drafts in this phase.

CREATE TABLE IF NOT EXISTS public.job_daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  work_timezone TEXT NOT NULL DEFAULT 'Australia/Melbourne',
  supervisor_staff_profile_id UUID NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  created_by_staff_profile_id UUID NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  risks_constraints TEXT,
  contingency_plan TEXT,
  general_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plans_job_date
  ON public.job_daily_plans (job_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_job_daily_plans_supervisor
  ON public.job_daily_plans (supervisor_staff_profile_id);

CREATE INDEX IF NOT EXISTS idx_job_daily_plans_work_date
  ON public.job_daily_plans (work_date DESC);

DROP TRIGGER IF EXISTS job_daily_plans_set_updated_at ON public.job_daily_plans;
CREATE TRIGGER job_daily_plans_set_updated_at
  BEFORE UPDATE ON public.job_daily_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.job_daily_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plans" ON public.job_daily_plans;
CREATE POLICY "service_role_all_job_daily_plans"
  ON public.job_daily_plans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Planned outcomes (1–3 enforced in application; display_order uniqueness at DB)
CREATE TABLE IF NOT EXISTS public.job_daily_plan_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL CHECK (display_order >= 1 AND display_order <= 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (daily_plan_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_outcomes_plan
  ON public.job_daily_plan_outcomes (daily_plan_id, display_order);

ALTER TABLE public.job_daily_plan_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_outcomes" ON public.job_daily_plan_outcomes;
CREATE POLICY "service_role_all_job_daily_plan_outcomes"
  ON public.job_daily_plan_outcomes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Crew responsibilities (free-text member name; optional staff link)
CREATE TABLE IF NOT EXISTS public.job_daily_plan_crew_responsibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  crew_member_name TEXT NOT NULL,
  responsibility TEXT NOT NULL,
  staff_profile_id UUID NULL REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_crew_plan
  ON public.job_daily_plan_crew_responsibilities (daily_plan_id, display_order);

ALTER TABLE public.job_daily_plan_crew_responsibilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_crew" ON public.job_daily_plan_crew_responsibilities;
CREATE POLICY "service_role_all_job_daily_plan_crew"
  ON public.job_daily_plan_crew_responsibilities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Materials required
CREATE TABLE IF NOT EXISTS public.job_daily_plan_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_materials_plan
  ON public.job_daily_plan_materials (daily_plan_id, display_order);

ALTER TABLE public.job_daily_plan_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_materials" ON public.job_daily_plan_materials;
CREATE POLICY "service_role_all_job_daily_plan_materials"
  ON public.job_daily_plan_materials FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Equipment required
CREATE TABLE IF NOT EXISTS public.job_daily_plan_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES public.job_daily_plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_daily_plan_equipment_plan
  ON public.job_daily_plan_equipment (daily_plan_id, display_order);

ALTER TABLE public.job_daily_plan_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_daily_plan_equipment" ON public.job_daily_plan_equipment;
CREATE POLICY "service_role_all_job_daily_plan_equipment"
  ON public.job_daily_plan_equipment FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
