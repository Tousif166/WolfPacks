-- Asserts the properties Supabase's Security and Performance Advisors check for.
-- Every query below must return ZERO rows except check 4 (which must show a pinned search_path)
-- and check 6 (the expected policy inventory).

\echo ''
\echo '== 1. Policies reaching anon or PUBLIC — must be empty =='
select tablename, policyname, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings','worker_registrations','complaints','worker_status')
  and roles <> '{authenticated}';

\echo ''
\echo '== 2. Bare auth.uid() not wrapped in a subselect (auth_rls_initplan) — must be empty =='
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings','worker_registrations','complaints','worker_status')
  and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'auth\.uid\(\)'
  and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~ '\( SELECT auth\.uid\(\)';

\echo ''
\echo '== 3. More than one permissive policy per table+action (multiple_permissive_policies) — must be empty =='
select tablename, cmd, count(*) as n
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings','worker_registrations','complaints','worker_status')
  and permissive = 'PERMISSIVE'
group by tablename, cmd
having count(*) > 1;

\echo ''
\echo '== 4. Function config (function_search_path_mutable) — proconfig must pin search_path =='
select p.proname, p.prosecdef as security_definer, coalesce(p.proconfig::text, 'NOT PINNED') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_admin', 'is_worker')
order by p.proname;

\echo ''
\echo '== 4b. ANY public function without a pinned search_path — must be empty =='
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) c where c like 'search_path=%'
      ));

\echo ''
\echo '== 5. SECURITY DEFINER views (security_definer_view) — must be empty =='
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v';

\echo ''
\echo '== 6. Policy inventory =='
select tablename, cmd, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings','worker_registrations','complaints','worker_status')
order by tablename, cmd;

\echo ''
\echo '== 7. Tables with RLS enabled but ZERO policies (rls_enabled_no_policy) — must be empty =='
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
group by c.relname
having count(p.polname) = 0;
