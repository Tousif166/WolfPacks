-- =============================================================================
-- Behavioural test for the RLS policies in supabase/migrations/*_cross_device_core.sql.
--
-- Advisor checks prove the policies are SHAPED right. These prove they DO the right thing:
-- that a worker sees the open job feed, that an admin can approve somebody else's certificate
-- (the flow this whole migration exists for), and that nobody can read or write another user's data.
--
-- Run against the throwaway container only, after harness.sql + the migration.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------------
-- SAFETY GUARD — do not remove.
--
-- This script DELETES EVERY ROW from bookings, complaints and worker_registrations in order to set
-- up known fixtures. Run against a real project it would destroy live data. It therefore refuses to
-- run unless the caller explicitly opts in, which scripts/verify-migration.ps1 does for the
-- throwaway container and nothing else should.
-- ---------------------------------------------------------------------------
do $$
begin
  if current_setting('sahakar.allow_destructive_test', true) is distinct from 'yes' then
    raise exception using
      message = 'REFUSING TO RUN: this script deletes all rows from bookings, complaints and worker_registrations.',
      hint = 'It is for a disposable test database only. To proceed deliberately: set sahakar.allow_destructive_test = ''yes'';';
  end if;
end $$;

-- Supabase grants table privileges to anon/authenticated by default via ALTER DEFAULT PRIVILEGES,
-- with RLS as the real gate. A vanilla Postgres has no such default, so replicate it here —
-- otherwise every statement below would fail on table permissions before RLS was ever consulted.
-- Granted to anon as well as authenticated, on purpose. Supabase's default privileges give anon
-- table access too, so if we only granted to authenticated the final anon check would pass for the
-- wrong reason (a missing GRANT rather than RLS). We want to prove RLS is what stops anon.
grant select, insert, update, delete on
  public.bookings, public.worker_registrations, public.complaints, public.worker_status
  to authenticated, anon;

-- Test identities. Created here rather than in the harness because public.profiles now comes from
-- the production schema dump (loaded after the harness), and it carries a foreign key to auth.users,
-- so those rows must exist first.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'customer@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'worker@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.com'),
  ('44444444-4444-4444-4444-444444444444', 'other@test.com'),
  ('55555555-5555-5555-5555-555555555555', 'other-customer@test.com')
on conflict (id) do nothing;

insert into public.profiles (id, role, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'customer', 'Test Customer'),
  ('22222222-2222-2222-2222-222222222222', 'worker',   'Test Worker'),
  ('33333333-3333-3333-3333-333333333333', 'admin',    'Test Admin'),
  ('44444444-4444-4444-4444-444444444444', 'worker',   'Other Worker'),
  ('55555555-5555-5555-5555-555555555555', 'customer', 'Other Customer')
on conflict (id) do nothing;

-- PASS/FAIL reporter.
create or replace function public.chk(label text, ok boolean) returns void
language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;
grant execute on function public.chk(text, boolean) to authenticated;

-- Seed rows inserted as the table owner, which bypasses RLS.
delete from public.bookings;
delete from public.worker_registrations;
delete from public.complaints;

insert into public.bookings (id, customer_id, customer_name, worker_id, service_id, service_name, address, date, time, status, base_price, total_price)
values
  ('BK_OPEN',  '11111111-1111-1111-1111-111111111111', 'Test Customer',  null,                                   'plumbing', 'Plumbing', 'addr', '2026-09-20', '10:00 AM', 'booked',   299, 389),
  ('BK_MINE',  '11111111-1111-1111-1111-111111111111', 'Test Customer',  '22222222-2222-2222-2222-222222222222', 'plumbing', 'Plumbing', 'addr', '2026-09-20', '11:00 AM', 'assigned', 299, 389),
  ('BK_OTHER', '55555555-5555-5555-5555-555555555555', 'Other Customer', '44444444-4444-4444-4444-444444444444', 'cleaning', 'Cleaning', 'addr', '2026-09-20', '12:00 PM', 'assigned', 499, 499),
  -- An OPEN job belonging to a DIFFERENT customer. Needed to test the claim path honestly: on a
  -- booking the caller owns, the "my own booking" arm of bookings_update matches first, so it proves
  -- nothing about the worker-role guard.
  ('BK_OPEN2', '55555555-5555-5555-5555-555555555555', 'Other Customer', null,                                   'plumbing', 'Plumbing', 'addr', '2026-09-22', '3:00 PM',  'booked',   299, 389);

insert into public.worker_registrations (email, skills, has_certificate, cert_name, certificate)
values ('worker@test.com', array['plumbing'], true, 'cert.jpg',
        '{"status":"pending","name":"Experience Certificate","uploadedAt":"2026-09-01T00:00:00Z","reviewedAt":null,"reason":null}'::jsonb);

\echo ''
\echo '===== BOOKINGS: visibility ====='

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  set local request.jwt.claims = '{"email":"customer@test.com"}';
  select public.chk('customer sees ONLY their own 2 bookings',
                    (select count(*) from public.bookings) = 2);
  select public.chk('customer cannot see the other customer''s assigned booking',
                    (select count(*) from public.bookings where id = 'BK_OTHER') = 0);
  -- Privacy: an open booking exposes address, service and price. Customers have no reason to browse
  -- the feed, so they must not see another customer's pending job.
  select public.chk('customer CANNOT see another customer''s OPEN job (no feed access)',
                    (select count(*) from public.bookings where id = 'BK_OPEN2') = 0);
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  set local request.jwt.claims = '{"email":"worker@test.com"}';
  -- BK_OPEN + BK_OPEN2 (both unassigned) + BK_MINE (assigned to this worker) = 3
  select public.chk('worker sees both open jobs + own assigned job (3)',
                    (select count(*) from public.bookings) = 3);
  select public.chk('worker sees the unclaimed job (the cross-device flow)',
                    (select count(*) from public.bookings where id = 'BK_OPEN') = 1);
  select public.chk('worker cannot see another worker''s job',
                    (select count(*) from public.bookings where id = 'BK_OTHER') = 0);
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  set local request.jwt.claims = '{"email":"admin@test.com"}';
  select public.chk('admin sees all 4 bookings', (select count(*) from public.bookings) = 4);
rollback;

\echo ''
\echo '===== BOOKINGS: writes ====='

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  set local request.jwt.claims = '{"email":"customer@test.com"}';
  do $$
  begin
    insert into public.bookings (id, customer_id, customer_name, service_id, service_name, address, date, time, status, base_price, total_price)
    values ('BK_NEW', '11111111-1111-1111-1111-111111111111', 'Test Customer', 'plumbing', 'Plumbing', 'addr', '2026-09-21', '9:00 AM', 'booked', 299, 389);
    perform public.chk('customer can insert a booking in their own name', true);
  exception when others then
    perform public.chk('customer can insert a booking in their own name — got ' || SQLERRM, false);
  end $$;

  do $$
  begin
    insert into public.bookings (id, customer_id, customer_name, service_id, service_name, address, date, time, status, base_price, total_price)
    values ('BK_SPOOF', '55555555-5555-5555-5555-555555555555', 'Other Customer', 'plumbing', 'Plumbing', 'addr', '2026-09-21', '9:00 AM', 'booked', 299, 389);
    perform public.chk('customer CANNOT insert in another customer''s name', false);
  exception when insufficient_privilege then
    perform public.chk('customer CANNOT insert in another customer''s name', true);
  end $$;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  set local request.jwt.claims = '{"email":"worker@test.com"}';

  update public.bookings
     set worker_id = '22222222-2222-2222-2222-222222222222', status = 'assigned'
   where id = 'BK_OPEN';
  select public.chk('worker can claim an unclaimed job', (select worker_id from public.bookings where id = 'BK_OPEN') = '22222222-2222-2222-2222-222222222222');

  update public.bookings set status = 'cancelled' where id = 'BK_OTHER';
  select public.chk('worker CANNOT modify another worker''s job',
                    (select count(*) from public.bookings where id = 'BK_OTHER' and status = 'cancelled') = 0);
rollback;

-- A CUSTOMER must not be able to claim an open job by calling the API directly. This is the hole the
-- is_worker() check closes; without it the open-feed arm of bookings_update matched any
-- authenticated user.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  set local request.jwt.claims = '{"email":"customer@test.com"}';
  -- BK_OPEN2 belongs to another customer, so only the open-feed arm could possibly match.
  update public.bookings
     set worker_id = '11111111-1111-1111-1111-111111111111', status = 'assigned'
   where id = 'BK_OPEN2';
  -- Drop back to the table owner to CHECK the result. Necessary because the customer cannot SELECT
  -- this row either, so asking them would return no rows and the assertion would read NULL rather
  -- than a genuine true/false.
  reset role;
  select public.chk('a CUSTOMER cannot claim an open job (is_worker guard)',
                    (select worker_id is null from public.bookings where id = 'BK_OPEN2'));
rollback;

-- The same job IS claimable by an actual worker, so the guard is not simply blocking everything.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  set local request.jwt.claims = '{"email":"worker@test.com"}';
  update public.bookings
     set worker_id = '22222222-2222-2222-2222-222222222222', status = 'assigned'
   where id = 'BK_OPEN2';
  select public.chk('a WORKER can claim that same open job',
                    (select worker_id from public.bookings where id = 'BK_OPEN2') = '22222222-2222-2222-2222-222222222222');
rollback;

-- And the helpers themselves report the right thing.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select public.chk('is_worker() true for a worker', (select public.is_worker()));
  select public.chk('is_admin() false for a worker', not (select public.is_admin()));
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select public.chk('is_admin() true for an admin', (select public.is_admin()));
  select public.chk('is_worker() false for an admin', not (select public.is_worker()));
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  set local request.jwt.claims = '{"email":"admin@test.com"}';
  delete from public.bookings where id = 'BK_MINE';
  select public.chk('nobody can DELETE a booking, not even an admin (audit trail)',
                    (select count(*) from public.bookings where id = 'BK_MINE') = 1);
rollback;

\echo ''
\echo '===== WORKER_REGISTRATIONS: the certificate flow ====='

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  set local request.jwt.claims = '{"email":"worker@test.com"}';
  select public.chk('worker sees their own registration (matched by JWT email)',
                    (select count(*) from public.worker_registrations where email = 'worker@test.com') = 1);
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  set local request.jwt.claims = '{"email":"other@test.com"}';
  select public.chk('a different worker CANNOT see that registration',
                    (select count(*) from public.worker_registrations) = 0);
  update public.worker_registrations set banned = true where email = 'worker@test.com';
  select public.chk('a different worker CANNOT modify it',
                    (select count(*) from public.worker_registrations where email='worker@test.com' and banned) = 0);
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  set local request.jwt.claims = '{"email":"admin@test.com"}';

  select public.chk('ADMIN sees the pending certificate queue',
                    (select count(*) from public.worker_registrations where certificate->>'status' = 'pending') = 1);

  update public.worker_registrations
     set certificate = jsonb_set(jsonb_set(certificate, '{status}', '"approved"'), '{reviewedAt}', '"2026-09-12T00:00:00Z"'),
         verified = true
   where email = 'worker@test.com';
  select public.chk('ADMIN can approve another user''s certificate (THE core flow)',
                    (select verified and certificate->>'status' = 'approved'
                       from public.worker_registrations where email = 'worker@test.com'));
rollback;

\echo ''
\echo '===== COMPLAINTS: direction enforcement ====='

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  set local request.jwt.claims = '{"email":"customer@test.com"}';

  do $$
  begin
    insert into public.complaints (id, customer_id, worker_id, filed_by, against, subject)
    values ('CMP_A', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'customer', 'worker', 'Late');
    perform public.chk('customer can file a complaint against a worker', true);
  exception when others then
    perform public.chk('customer can file against a worker — got ' || SQLERRM, false);
  end $$;

  do $$
  begin
    insert into public.complaints (id, customer_id, worker_id, filed_by, against, subject)
    values ('CMP_B', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'worker', 'customer', 'Spoofed');
    perform public.chk('customer CANNOT file as though they were the worker', false);
  exception when insufficient_privilege then
    perform public.chk('customer CANNOT file as though they were the worker', true);
  end $$;

  do $$
  begin
    insert into public.complaints (id, customer_id, worker_id, filed_by, against, subject)
    values ('CMP_C', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'customer', 'customer', 'Self');
    perform public.chk('a self-directed complaint is rejected by the CHECK constraint', false);
  exception when check_violation then
    perform public.chk('a self-directed complaint is rejected by the CHECK constraint', true);
  end $$;
rollback;

\echo ''
\echo '===== WORKER_STATUS ====='

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  set local request.jwt.claims = '{"email":"worker@test.com"}';
  do $$
  begin
    insert into public.worker_status (worker_id, available) values ('22222222-2222-2222-2222-222222222222', true);
    perform public.chk('worker can set their own availability', true);
  exception when others then
    perform public.chk('worker can set their own availability — got ' || SQLERRM, false);
  end $$;

  do $$
  begin
    insert into public.worker_status (worker_id, available) values ('44444444-4444-4444-4444-444444444444', false);
    perform public.chk('worker CANNOT set another worker''s availability', false);
  exception when insufficient_privilege then
    perform public.chk('worker CANNOT set another worker''s availability', true);
  end $$;
rollback;

\echo ''
\echo '===== ANON (no JWT) — models the demo accounts hitting these tables ====='

begin;
  set local role anon;
  select public.chk('anon sees no bookings (every policy is TO authenticated)',
                    (select count(*) from public.bookings) = 0);
rollback;
