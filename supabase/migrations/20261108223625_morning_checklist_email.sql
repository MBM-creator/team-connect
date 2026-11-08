-- Private delivery snapshots: one morning digest per creator per Melbourne work date.
CREATE TABLE public.morning_checklist_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  recipient text NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  provider_email_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (staff_profile_id, work_date)
);
ALTER TABLE public.morning_checklist_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.morning_checklist_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_checklist_emails TO service_role;
CREATE POLICY service_role_all_morning_checklist_emails ON public.morning_checklist_emails
  FOR ALL TO service_role USING (true) WITH CHECK (true);
