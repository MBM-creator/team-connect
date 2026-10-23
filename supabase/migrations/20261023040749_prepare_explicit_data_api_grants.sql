-- Preserve the current Data API surface for objects that already exist.
-- RLS remains the row-level authorization boundary for these tables.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Opt in to Supabase's 2026-10-30 secure default now.
-- Every future migration that creates a table, sequence, or function must
-- explicitly grant only the privileges that object requires.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Required pattern for every future public table (choose least privilege):
-- alter table public.your_table enable row level security;
-- grant select on table public.your_table to anon;
-- grant select, insert, update, delete on table public.your_table to authenticated;
-- grant select, insert, update, delete on table public.your_table to service_role;
