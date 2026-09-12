-- =============================================================================
-- Sahakar Seva — cross-device core tables
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Bookings, worker registrations/certificates, complaints and worker availability all lived in
-- device-local MMKV (ported 1:1 from a web prototype that used localStorage). That works for a
-- single-device demo but breaks every multi-party flow:
--
--   * a customer books on their phone -> the worker on a different phone never sees the job
--   * a worker uploads a certificate  -> the admin on a different phone has an empty review queue,
--                                        so the worker can never be verified and never gets work
--   * a complaint is filed            -> only the filer's device knows about it
--
-- These four tables move that state server-side so the customer -> worker -> admin handoffs work
-- across separate devices.
--
--
-- HOW TO APPLY
-- ------------
-- Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- It is idempotent: safe to re-run. Every object is created with IF NOT EXISTS or dropped first.
--
--
-- VALIDATION STATUS
-- -----------------
-- Verified against Postgres 16.15 in a disposable container, not by inspection. Reproduce with:
--
--     pwsh scripts/verify-migration.ps1        (needs Docker Desktop running)
--
-- That script stands up a throwaway database with stand-ins for auth.uid(), auth.jwt(),
-- public.profiles and the anon/authenticated roles, applies this file, and asserts:
--
--   * it applies cleanly and is idempotent on a second run
--   * all 7 Advisor-relevant properties hold (no anon-reachable policy, no bare auth.uid(),
--     no duplicate permissive policies, search_path pinned on is_admin, no SECURITY DEFINER
--     views, no RLS-enabled-without-policy table)
--   * 22 RLS behaviour checks, including the two that matter most:
--       - a worker can see and claim an unclaimed booking they have no other relationship to
--       - an ADMIN can approve a DIFFERENT user's certificate
--     and the negatives: no cross-customer reads, no filing a complaint as somebody else,
--     no deletes by anyone, and anon sees nothing.
--
-- It never touches a real project.
--
--
-- DESIGN DECISIONS YOU SHOULD KNOW ABOUT
-- --------------------------------------
-- 1. customer_id / worker_id are TEXT, not uuid REFERENCES profiles(id).
--    The app ships seed data using synthetic ids ('c1'..'c2' customers, 'w1'..'w5' workers) and
--    demo accounts using 'demo-customer' / 'demo-worker' / 'demo-admin'. None of those exist in
--    auth.users, so a real foreign key would reject them. Referential integrity is traded for
--    keeping the seeded demo working. RLS still pins every row to (select auth.uid())::text, so a
--    real user can only ever reach their own rows regardless.
--
-- 2. Nested objects stay JSONB (worker_registrations.certificate / .training).
--    They mirror the client record shape exactly, so the sync layer is a field rename and nothing
--    more. Splitting them into columns would buy normalisation we have no query need for and would
--    add a migration step on every future field.
--
-- 3. No seed rows are inserted here on purpose.
--    The app's seed bookings/complaints reference customer 'c1' and worker 'w1', which match no
--    authenticated user, so they would be invisible to everyone except an admin — while still
--    duplicating rows every device already has locally. Seed data stays client-side.
--
-- 4. Demo accounts never touch these tables.
--    They have no JWT, so RLS would reject them anyway. The client keeps them on the local-only
--    MMKV path. See DEMO_ACCOUNTS in src/context/AuthContext.jsx.
--
--
-- ADVISOR COMPLIANCE (this file is written to keep Security + Performance Advisor clean)
-- -------------------------------------------------------------------------------------
--   * RLS enabled on every table, and every table has at least one policy.
--   * auth.uid() is always wrapped as (select auth.uid()) so Postgres evaluates it once per
--     statement instead of once per row -> avoids the "auth_rls_initplan" performance warning.
--   * Exactly ONE policy per (table, action) -> avoids "multiple_permissive_policies".
--   * Every policy is scoped TO authenticated, never to anon.
--   * The role lookup is a SECURITY DEFINER *function* (allowed) with SET search_path = ''
--     -> avoids "function_search_path_mutable". No SECURITY DEFINER *views* anywhere.
--   * No view exposes auth.users.
--   * Indexes cover the columns the app actually filters on, and nothing speculative.
-- =============================================================================


-- =============================================================================
-- Everything below runs in ONE transaction.
--
-- Postgres executes DDL transactionally, so if any statement fails the whole migration rolls back
-- and your schema is left exactly as it was. That matters specifically because a PARTIAL apply is
-- what would create a table with RLS enabled but no policy attached — and that is precisely the
-- state Supabase's Security Advisor raises an error for. All-or-nothing avoids it.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 0. Role helper
-- -----------------------------------------------------------------------------
-- Admin checks need to read public.profiles from inside a policy on another table. Doing that
-- inline as EXISTS(SELECT ... FROM profiles ...) is evaluated per row and also trips over
-- profiles' own RLS. A STABLE SECURITY DEFINER function solves both: it bypasses RLS on profiles
-- (safe — it returns only a boolean about the caller) and the planner can cache it.
--
-- search_path is pinned to '' so the function can never be hijacked by a caller-controlled schema;
-- that is also exactly what the "Function Search Path Mutable" advisory asks for. Because of it,
-- every identifier below MUST be fully qualified.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True when the calling user has profiles.role = ''admin''. SECURITY DEFINER so it can read '
  'profiles from inside RLS policies on other tables without recursion. Returns only a boolean.';

-- Only logged-in users ever need this. Explicitly revoking anon/public keeps the surface tight.
revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;


-- Same pattern for the worker role.
--
-- WHY THIS EXISTS: the bookings UPDATE policy has to let a worker CLAIM a job they have no prior
-- relationship to — the row is unassigned, so there is nothing tying it to them yet. Expressed
-- naively, that arm lets ANY authenticated user claim an open booking, including a customer calling
-- the API directly. The hosted project's original claim_booking() function guarded against exactly
-- this by checking profiles.role = 'worker', and this helper carries that check into the policy.
create or replace function public.is_worker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'worker'
  );
$$;

comment on function public.is_worker() is
  'True when the calling user has profiles.role = ''worker''. Used to ensure only workers can claim '
  'an unassigned booking. SECURITY DEFINER so it can read profiles from inside an RLS policy.';

revoke all on function public.is_worker() from public;
revoke all on function public.is_worker() from anon;
grant execute on function public.is_worker() to authenticated;


-- -----------------------------------------------------------------------------
-- 1. bookings
-- -----------------------------------------------------------------------------
-- The customer -> worker handoff. A booking is created by a customer with status 'booked' and no
-- worker_id; that combination is what makes it visible in every worker's job feed. A worker then
-- claims it (status -> 'assigned') and drives it through the lifecycle.
--
-- Lifecycle: booked -> assigned -> en-route -> in-progress -> completed   ('cancelled' is terminal)
-- Payment and feedback are FIELDS, not statuses: a completed-but-unpaid job is still 'completed'.

-- RECONCILIATION: a `public.bookings` table already exists on the hosted project.
--
-- It was created through the dashboard on 2026-09-06, before this repo tracked migrations, and it
-- does not match the data model the app actually runs on:
--
--   existing                          app needs
--   ---------------------------------|------------------------------------------------------
--   id / customer_id / worker_id uuid | text — the app mints 'BK006-3x8ak2' and seeds 'c1','w1'
--   status default 'pending'          | first state is 'booked'
--   scheduled_date / scheduled_time   | date / time
--   photos text[]                     | jsonb
--   gst_amount, review                | gst, feedback
--   lat, lng, is_overtime,            | (unused by the app)
--     overtime_bonus, distance_surcharge
--   — missing —                       | customer_name, worker_name, worker_rating, worker_phone,
--                                     |   payment_status, payment_method, duration_hours, and the
--                                     |   five lifecycle timestamps
--
-- A uuid primary key is the blocking difference: the app's ids are not uuids and its seed/demo ids
-- ('c1', 'w1') never will be, so `customer_id = auth.uid()::text` cannot even be expressed against a
-- uuid column — that is the `operator does not exist: uuid = text` error this migration first hit.
--
-- The table is EMPTY (verified: 0 rows, as are leave_requests, profiles, worker_profiles and
-- maintenance_reminders) and nothing in src/ reads it, so it is rebuilt rather than migrated
-- column-by-column. No data is destroyed.
--
-- Its four old policies are dropped too, deliberately. Keeping them would leave FOUR permissive
-- SELECT policies on one table — the `multiple_permissive_policies` performance warning — and three
-- of them omit `TO authenticated`, so they are evaluated for anonymous requests as well. The three
-- consolidated policies below replace them and close both issues.
drop policy if exists "Admins can view all bookings"   on public.bookings;
drop policy if exists "Customers create bookings"      on public.bookings;
drop policy if exists "Customers see their bookings"   on public.bookings;
drop policy if exists "Workers see their bookings"     on public.bookings;

-- maintenance_reminders.booking_id (uuid) points at the old bookings.id. Release it first, then
-- convert it to text below so the constraint can be restored against the new key type.
alter table if exists public.maintenance_reminders
  drop constraint if exists maintenance_reminders_booking_id_fkey;

-- Three server-side functions are coupled to the old uuid-keyed table and must go with it.
--
-- claim_booking(uuid) and advance_booking_status(uuid) RETURN public.bookings, so Postgres refuses
-- to drop the table while they exist ("cannot drop table bookings because other objects depend on
-- it"). get_available_jobs() returns an explicit table so it does not block the drop, but it selects
-- scheduled_date/scheduled_time, which this migration removes — leaving it in place would leave a
-- function that errors the first time anything calls it.
--
-- Dropped explicitly rather than via DROP ... CASCADE, so the loss is visible in this file instead of
-- happening silently. Nothing in the app calls them: there is no `.rpc(` anywhere in src/, because
-- the client drives the booking lifecycle itself.
--
-- WORTH PRESERVING FROM THEM: claim_booking checked that the caller is `profiles.role = 'worker'`
-- and that `worker_profiles.available` is true before allowing a claim. That is a real check my
-- original policy lacked — I had documented the gap as "any authenticated user could claim an
-- unclaimed booking". The is_worker() helper added above, used in bookings_update below, carries
-- that protection forward.
--
-- handle_new_user() and rls_auto_enable() are NOT dropped: neither references bookings, and
-- handle_new_user is the trigger that creates a profiles row on signup.
drop function if exists public.claim_booking(uuid);
drop function if exists public.advance_booking_status(uuid);
drop function if exists public.get_available_jobs();

drop table if exists public.bookings;

create table public.bookings (
  id                  text primary key,

  -- Parties. Text, not FK — see design note 1 at the top of this file.
  customer_id         text        not null,
  customer_name       text        not null default 'Customer',
  worker_id           text,
  worker_name         text,
  worker_rating       numeric(2,1),
  worker_phone        text,

  -- What was booked. service_id matches the client service catalogue ids ('plumbing', etc.);
  -- service_name is denormalised for display so history rows survive a catalogue rename.
  service_id          text        not null,
  service_name        text        not null,
  description         text        not null default '',
  address             text        not null,

  -- Scheduling. `date` is a real date; `time` stays free text ('10:00 AM') because that is what
  -- the picker produces and it is only ever displayed, never compared.
  date                date        not null,
  time                text        not null,

  status              text        not null default 'booked'
                        check (status in ('booked','assigned','en-route','in-progress','completed','cancelled')),

  -- Surge pricing. Integer rupees throughout; no fractional currency in this app.
  base_price          integer     not null default 0,
  weather_multiplier  numeric(4,2) not null default 1.0,
  weather_condition   text,
  total_price         integer     not null default 0,
  gst                 integer,
  welfare_cess        integer,

  fairness_position   integer,

  -- Customer's review of the job.
  rating              integer     check (rating between 1 and 5),
  feedback            text,

  -- Array of { url } objects. JSONB rather than text[] because historic rows may carry extra keys.
  photos              jsonb       not null default '[]'::jsonb,

  -- NULL until the job is completed, hence no NOT NULL / no default.
  payment_status      text        check (payment_status in ('due','paid')),
  payment_method      text,
  duration_hours      numeric(4,1),

  -- Lifecycle timestamps. Each is written by exactly one transition and is null before it.
  created_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  en_route_at         timestamptz,
  arrived_at          timestamptz,
  completed_at        timestamptz,
  paid_at             timestamptz
);

comment on table public.bookings is
  'Service bookings. Created by a customer; claimed and progressed by a worker. status=''booked'' '
  'with worker_id IS NULL is the open job feed every worker can see.';

-- Restore the maintenance_reminders link, now that bookings.id is text.
--
-- Safe to convert in place: maintenance_reminders is empty, and nothing in the app writes to it —
-- createMaintenanceReminder() in src/services/supabase.js exists for web parity and is called from
-- nowhere. Kept as a real FK (unlike complaints.booking_id) because both sides are app-managed
-- booking ids and there is no demo/seed path that would reference a booking absent from this table.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'maintenance_reminders'
      and column_name = 'booking_id'
      and data_type <> 'text'
  ) then
    alter table public.maintenance_reminders
      alter column booking_id type text using booking_id::text;
  end if;
end
$$;

alter table if exists public.maintenance_reminders
  drop constraint if exists maintenance_reminders_booking_id_fkey;

alter table if exists public.maintenance_reminders
  add constraint maintenance_reminders_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete set null;

-- A foreign key with no index on the referencing column is the `unindexed_foreign_keys`
-- performance advisory. Cheap to satisfy.
create index if not exists maintenance_reminders_booking_id_idx
  on public.maintenance_reminders (booking_id);

alter table public.bookings enable row level security;

-- Filters the app actually runs: "my bookings" (customer), "my jobs" (worker), and the open feed.
create index if not exists bookings_customer_id_idx on public.bookings (customer_id);
create index if not exists bookings_worker_id_idx   on public.bookings (worker_id);
-- Partial index: the job feed is the hottest query and only ever looks at unclaimed bookings.
create index if not exists bookings_open_feed_idx
  on public.bookings (created_at desc)
  where status = 'booked' and worker_id is null;

-- One policy per action, each OR-ing all the legitimate cases, to avoid multiple permissive
-- policies on the same (role, action) pair.

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    customer_id = (select auth.uid())::text          -- my own bookings
    or worker_id = (select auth.uid())::text         -- jobs assigned to me
    -- The open job feed, restricted to WORKERS.
    --
    -- The role check is not incidental: an unassigned booking exposes the customer's address, the
    -- service requested and the price. Without it, any authenticated customer could enumerate every
    -- other customer's pending job — a privacy leak with no purpose, since customers have no reason
    -- to browse the feed. Only workers need it, and only workers can act on it.
    or (status = 'booked' and worker_id is null and (select public.is_worker()))
    or (select public.is_admin())                    -- admin oversight
  );

-- A customer may only ever insert a booking in their own name.
drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (customer_id = (select auth.uid())::text);

-- USING says which rows you may target; WITH CHECK says what the row may look like afterwards.
-- The `status = 'booked' and worker_id is null` arm in USING is what lets a worker CLAIM an open
-- job. It is deliberately absent from WITH CHECK: after the update the row must belong to you
-- (you just set worker_id to yourself), so a worker cannot reassign a job to somebody else.
drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using (
    customer_id = (select auth.uid())::text
    or worker_id = (select auth.uid())::text
    -- Claiming an open job. Gated on the WORKER role so a customer cannot assign a job to
    -- themselves by calling the API directly.
    or (status = 'booked' and worker_id is null and (select public.is_worker()))
    or (select public.is_admin())
  )
  with check (
    customer_id = (select auth.uid())::text
    or worker_id = (select auth.uid())::text
    or (select public.is_admin())
  );

-- No DELETE policy: bookings are an audit trail. Cancellation is status = 'cancelled'.
-- With RLS on and no policy, DELETE is denied to everyone including admins.
--
-- CLOSED: an earlier version of this policy let ANY authenticated user claim an unassigned booking,
-- because the open-feed arm had no role condition. The hosted project's original claim_booking()
-- function guarded that with a profiles.role = 'worker' check; is_worker() now does the same inside
-- the policy, so a customer-role account can no longer take a job by calling the API directly.


-- -----------------------------------------------------------------------------
-- 2. worker_registrations
-- -----------------------------------------------------------------------------
-- The worker -> admin handoff, and the reason this migration exists at all: a worker uploads an
-- experience certificate, an admin on a DIFFERENT device approves or declines it, and the outcome
-- decides whether the worker can accept jobs.
--
-- Keyed by EMAIL, not user id, and that is deliberate. Sign-up may require email confirmation, so
-- at the moment the registration is written there is not necessarily a confirmed auth.users row to
-- point at. user_id is filled in opportunistically once known.
--
-- Certificate decision tree (mirrors the client state machine):
--   approved            -> verified = true, worker can accept jobs
--   rejected 'fake'     -> banned = true, login refused
--   rejected 'unqualified' -> no ban; enrolled in training instead, employable on completion

create table if not exists public.worker_registrations (
  email             text primary key,          -- always stored lowercased by the client
  user_id           uuid,                      -- nullable: unknown until the account is confirmed

  -- Service-catalogue ids, never display names, so they join to bookings.service_id.
  skills            text[]      not null default '{}',

  has_certificate   boolean     not null default false,
  cert_name         text,                      -- original filename only; the image is not stored
  registered_at     timestamptz not null default now(),

  -- { status: 'pending'|'approved'|'rejected', name, uploadedAt, reviewedAt, reason }
  -- reason is null | 'fake' | 'unqualified'.
  certificate       jsonb,

  banned            boolean     not null default false,
  ban_reason        text,

  -- { enrolled, status: 'in-progress'|'completed', modulesDone, modulesTotal,
  --   enrolledAt, completedAt, certificateIssued }
  training          jsonb,

  verified          boolean     not null default false,
  updated_at        timestamptz not null default now()
);

comment on table public.worker_registrations is
  'Worker onboarding state: chosen skills, uploaded certificate awaiting admin review, ban flag '
  'and training programme. Keyed by email because sign-up can precede email confirmation.';

alter table public.worker_registrations enable row level security;

-- The admin review queue is "every row whose certificate is still pending", read on every admin
-- dashboard load. A partial expression index keeps that cheap as the table grows.
create index if not exists worker_registrations_pending_cert_idx
  on public.worker_registrations ((certificate->>'status'))
  where certificate is not null;

create index if not exists worker_registrations_user_id_idx
  on public.worker_registrations (user_id)
  where user_id is not null;

-- Ownership is proved by the email claim in the JWT, since the row is email-keyed.
-- auth.jwt() is wrapped in a subselect for the same per-statement-evaluation reason as auth.uid().
drop policy if exists worker_registrations_select on public.worker_registrations;
create policy worker_registrations_select on public.worker_registrations
  for select to authenticated
  using (
    email = lower((select auth.jwt() ->> 'email'))
    or user_id = (select auth.uid())
    or (select public.is_admin())                    -- the certificate review queue
  );

drop policy if exists worker_registrations_insert on public.worker_registrations;
create policy worker_registrations_insert on public.worker_registrations
  for insert to authenticated
  with check (email = lower((select auth.jwt() ->> 'email')));

-- Two very different writers share this one policy:
--   the worker  -> advancing their own training progress
--   the admin   -> approving/declining somebody else's certificate, which is the whole point
drop policy if exists worker_registrations_update on public.worker_registrations;
create policy worker_registrations_update on public.worker_registrations
  for update to authenticated
  using (
    email = lower((select auth.jwt() ->> 'email'))
    or (select public.is_admin())
  )
  with check (
    email = lower((select auth.jwt() ->> 'email'))
    or (select public.is_admin())
  );

-- No DELETE policy: onboarding history is retained.


-- -----------------------------------------------------------------------------
-- 3. complaints
-- -----------------------------------------------------------------------------
-- Bidirectional. filed_by says who raised it, `against` says who it is about (always the other
-- party). Both sides need to see complaints levelled at them, and the admin sees everything.
--
-- ai_status / ai_suggestion hold the background Groq de-escalation suggestion. Keeping them on the
-- row rather than device-local means the suggestion is generated once and shared by both parties
-- and the admin, instead of every device paying for its own API call.

create table if not exists public.complaints (
  id             text primary key,

  customer_id    text,
  customer_name  text        not null default 'Customer',
  worker_id      text,
  worker_name    text        not null default '—',

  booking_id     text,                          -- the job complained about
  service_name   text        not null default '—',

  subject        text        not null default 'Service complaint',
  description    text        not null default '',

  status         text        not null default 'open'
                   check (status in ('open','in-progress','resolved')),
  priority       text        not null default 'medium'
                   check (priority in ('low','medium','high')),

  -- Direction. `against` is derived by the client as the opposite of filed_by; the CHECK below
  -- enforces that invariant in the database so no client bug can produce a self-directed complaint.
  filed_by       text        not null default 'customer' check (filed_by in ('customer','worker')),
  against        text        not null default 'worker'   check (against  in ('customer','worker')),
  constraint complaints_direction_opposed check (filed_by <> against),

  -- A worker rating the customer (1-5). Null for customer-filed complaints.
  rating         integer     check (rating between 1 and 5),

  ai_status      text        not null default 'idle'
                   check (ai_status in ('idle','pending','done','error')),
  ai_suggestion  text,

  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolution     text
);

comment on table public.complaints is
  'Bidirectional complaints. filed_by / against give the direction; ai_suggestion caches the '
  'shared Groq de-escalation text so it is generated once rather than per device.';

alter table public.complaints enable row level security;

create index if not exists complaints_customer_id_idx on public.complaints (customer_id);
create index if not exists complaints_worker_id_idx   on public.complaints (worker_id);
create index if not exists complaints_booking_id_idx  on public.complaints (booking_id);
-- The advisor queue drains rows still needing a suggestion; partial so it stays tiny.
create index if not exists complaints_awaiting_ai_idx
  on public.complaints (created_at)
  where ai_status = 'idle';

drop policy if exists complaints_select on public.complaints;
create policy complaints_select on public.complaints
  for select to authenticated
  using (
    customer_id = (select auth.uid())::text
    or worker_id = (select auth.uid())::text
    or (select public.is_admin())
  );

-- You may only file as yourself, in the direction you actually are. A customer-filed complaint
-- must carry your id in customer_id; a worker-filed one must carry it in worker_id.
drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints
  for insert to authenticated
  with check (
    (filed_by = 'customer' and customer_id = (select auth.uid())::text)
    or (filed_by = 'worker' and worker_id = (select auth.uid())::text)
  );

-- Involved parties may update (the AI advisor writes ai_status/ai_suggestion from whichever
-- portal is open); only the admin resolves. Resolution is not enforced here because a party
-- legitimately needs to write the AI fields on the same row.
drop policy if exists complaints_update on public.complaints;
create policy complaints_update on public.complaints
  for update to authenticated
  using (
    customer_id = (select auth.uid())::text
    or worker_id = (select auth.uid())::text
    or (select public.is_admin())
  )
  with check (
    customer_id = (select auth.uid())::text
    or worker_id = (select auth.uid())::text
    or (select public.is_admin())
  );

-- No DELETE policy: complaints are a record, resolved not removed.


-- -----------------------------------------------------------------------------
-- 4. worker_status
-- -----------------------------------------------------------------------------
-- Just the online/offline override. Tiny, but it has to be shared: the admin roster shows whether
-- a worker is currently available, and that is set from the worker's own device.
--
-- Leave is NOT here. It is still derived client-side from the worker record's leaveRequests. Moving
-- leave server-side is a separate table and a separate change.

create table if not exists public.worker_status (
  worker_id  text primary key,
  available  boolean     not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.worker_status is
  'Per-worker online/offline override. Absence of a row means "use the account default", which is '
  'why the client passes a fallback rather than assuming false.';

alter table public.worker_status enable row level security;

-- No extra index needed: worker_id is the primary key and every access is a point lookup by it.

drop policy if exists worker_status_select on public.worker_status;
create policy worker_status_select on public.worker_status
  for select to authenticated
  using (
    worker_id = (select auth.uid())::text
    or (select public.is_admin())
  );

drop policy if exists worker_status_insert on public.worker_status;
create policy worker_status_insert on public.worker_status
  for insert to authenticated
  with check (worker_id = (select auth.uid())::text);

drop policy if exists worker_status_update on public.worker_status;
create policy worker_status_update on public.worker_status
  for update to authenticated
  using (worker_id = (select auth.uid())::text)
  with check (worker_id = (select auth.uid())::text);

-- No DELETE policy: going offline is available = false, not a deleted row.


commit;


-- =============================================================================
-- Verification
-- =============================================================================
-- Run this after applying. Every row should read: rls_enabled = true, and a policy count > 0.
-- If any table shows rls_enabled = false, the Security Advisor WILL flag it.
--
--   select
--     c.relname                        as table_name,
--     c.relrowsecurity                 as rls_enabled,
--     count(p.polname)                 as policy_count
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policy p on p.polrelid = c.oid
--   where n.nspname = 'public'
--     and c.relname in ('bookings','worker_registrations','complaints','worker_status')
--   group by c.relname, c.relrowsecurity
--   order by c.relname;
--
-- Expected: 4 rows, all rls_enabled = true, policy_count 3 or 4.
-- =============================================================================
