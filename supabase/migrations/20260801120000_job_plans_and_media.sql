-- Job-level plan documents and media library (separate from pre-commencement photos and note attachments).

CREATE TABLE IF NOT EXISTS public.job_plan_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  uploaded_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(storage_path)
);

CREATE INDEX IF NOT EXISTS idx_job_plan_documents_job_created
  ON public.job_plan_documents(job_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  mime_type TEXT NOT NULL,
  file_name TEXT,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  duration_seconds NUMERIC,
  uploaded_by UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(storage_path)
);

CREATE INDEX IF NOT EXISTS idx_job_media_job_created
  ON public.job_media(job_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.job_plan_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_job_plan_documents" ON public.job_plan_documents;
CREATE POLICY "service_role_all_job_plan_documents"
  ON public.job_plan_documents FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_job_media" ON public.job_media;
CREATE POLICY "service_role_all_job_media"
  ON public.job_media FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Browser TUS uploads use the signed-in staff member's Supabase Auth token.
DROP POLICY IF EXISTS "authenticated_insert_job_media_video_objects" ON storage.objects;
CREATE POLICY "authenticated_insert_job_media_video_objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'daily-reports'
    AND name LIKE 'jobs/%/media/videos/%'
  );

DROP POLICY IF EXISTS "authenticated_update_job_media_video_objects" ON storage.objects;
CREATE POLICY "authenticated_update_job_media_video_objects"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND name LIKE 'jobs/%/media/videos/%'
  )
  WITH CHECK (
    bucket_id = 'daily-reports'
    AND name LIKE 'jobs/%/media/videos/%'
  );
