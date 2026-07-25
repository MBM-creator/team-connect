-- Persist site address snapshot on jobs for display when project sync is unavailable.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cc_site_address_snapshot TEXT;
