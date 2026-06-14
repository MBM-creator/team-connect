-- Retire paving QA v1: cancel active legacy runs and prevent new v1 paving runs.

UPDATE public.paving_qa_runs
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, now()),
    updated_at = now()
WHERE qa_type = 'paving'
  AND (setup_version IS NULL OR setup_version <> 2)
  AND status = 'active';

ALTER TABLE public.paving_qa_runs
  ADD CONSTRAINT paving_qa_paving_requires_v2
  CHECK (qa_type <> 'paving' OR setup_version = 2);

COMMENT ON CONSTRAINT paving_qa_paving_requires_v2 ON public.paving_qa_runs IS
  'Paving QA runs must use setup_version 2 (v1/legacy retired).';
