alter function public.set_qa_submissions_updated_at() security invoker;
revoke execute on function public.set_qa_submissions_updated_at() from public, anon, authenticated;

alter function public.set_staff_profiles_updated_at() security invoker;
revoke execute on function public.set_staff_profiles_updated_at() from public, anon, authenticated;

alter function public.replace_checklist_template_items(uuid, jsonb)
  set search_path = public;

alter function public.set_updated_at()
  set search_path = public;
