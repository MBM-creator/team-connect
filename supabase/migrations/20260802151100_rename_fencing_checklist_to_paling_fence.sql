-- Clarify that the seeded fencing checklist is for paling fences.
UPDATE public.checklist_templates
SET
  name = 'Paling Fence',
  updated_at = NOW()
WHERE LOWER(name) = 'fencing';
