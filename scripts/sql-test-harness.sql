-- =============================================================================
-- Local stand-in for the parts of hosted Supabase that the schema dump and
-- *_cross_device_core.sql depend on.
--
-- Used by scripts/verify-migration.ps1 ONLY. NEVER run this against a real project — hosted Supabase
-- already provides all of it.
--
-- Deliberately does NOT create public.profiles. That comes from the production schema dump, so the
-- migration is validated against the REAL table (with its real column types and policies) rather
-- than an idealised stub. Testing against a blank database is what allowed the
-- `operator does not exist: uuid = text` failure to reach the hosted project.
-- =============================================================================

-- Roles the dump's GRANT statements and the migration's policies reference.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;

create schema if not exists auth;

-- Hosted Supabase derives these from the request JWT. Here they read session GUCs so a test can
-- impersonate different users via `set request.jwt.claim.sub` / `set request.jwt.claims`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- The dump's profiles/worker_profiles tables carry foreign keys to auth.users, so it must exist.
-- Only the id column matters for these tests.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to anon/authenticated by default via ALTER DEFAULT PRIVILEGES,
-- with RLS as the actual gate. Replicate that so later GRANTs behave the same way and so the "anon
-- sees nothing" test proves RLS is doing the work rather than a missing grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
