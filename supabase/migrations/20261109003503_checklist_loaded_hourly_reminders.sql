ALTER TABLE public.morning_checklist_emails
  ADD COLUMN loaded_at timestamptz,
  ADD COLUMN loaded_by_staff_profile_id uuid REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN confirmation_url text,
  ADD CONSTRAINT checklist_loaded_consistency CHECK (
    (loaded_at IS NULL AND loaded_by_staff_profile_id IS NULL) OR
    (loaded_at IS NOT NULL AND loaded_by_staff_profile_id IS NOT NULL AND loaded_by_staff_profile_id = staff_profile_id)
  );
CREATE INDEX morning_checklists_outstanding ON public.morning_checklist_emails(work_date)
  WHERE loaded_at IS NULL;

CREATE TABLE public.loading_checklist_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_email_id uuid NOT NULL REFERENCES public.morning_checklist_emails(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  slot text NOT NULL,
  recipient text NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  confirmation_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  provider_email_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(checklist_email_id, slot)
);
CREATE INDEX loading_reminders_staff ON public.loading_checklist_reminders(staff_profile_id);
CREATE INDEX loading_reminders_slot ON public.loading_checklist_reminders(slot) WHERE status <> 'sent';
ALTER TABLE public.loading_checklist_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loading_checklist_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loading_checklist_reminders TO service_role;
CREATE POLICY service_role_all_loading_reminders ON public.loading_checklist_reminders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
