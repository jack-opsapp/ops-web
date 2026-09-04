-- PUBLIC API P2-1 — contract suite for the public booking foundation.
--
-- Runs the migration and every acceptance case inside one transaction and
-- rolls the whole thing back, so the checks execute against live production
-- schema, live permission data and the live trigger graph while leaving zero
-- residue. Every assertion raises on a wrong outcome; a clean run to the final
-- banner is the proof.
--
--   psql -v ON_ERROR_STOP=1 -f contract_tests.sql
--
-- Fixture company: Maverick (ddee107c-…), timezone America/Vancouver — chosen
-- because it has real eligible owners, real pipeline managers, zero future
-- bookings to collide with, and a timezone with real DST transitions.

\set ON_ERROR_STOP on
\set QUIET on
begin;
select set_config('statement_timeout', '300000', true);

\echo '=== applying migration inside transaction ==='
\i ../../../supabase/migrations/20260902190000_public_booking_foundation.sql
\echo '=== migration applied (uncommitted) ==='

-- Service-role claim so the *_as_system gates pass for the positive tests.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table t_fixture (
  key text primary key,
  uuid_value uuid,
  text_value text,
  ts_value timestamptz
) on commit drop;

do $seed$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_owner uuid;
  v_integration uuid;
  v_connection uuid;
begin
  select u.id into v_owner
  from public.users u
  where u.company_id = v_company
    and u.deleted_at is null
    and private.user_is_guarded_assignment_target_eligible(u.id, v_company)
  order by u.id
  limit 1;
  if v_owner is null then
    raise exception 'fixture: no eligible owner in the fixture company';
  end if;

  -- P1 mints the hosted integration; reuse it if the company already has one.
  select integration.id into v_integration
  from private.customer_integrations integration
  where integration.company_id = v_company
    and integration.status = 'active'
  limit 1;
  if v_integration is null then
    select ensured.integration_id into v_integration
    from public.ensure_customer_hosted_integration_as_system(v_company) as ensured;
  end if;

  -- A calendar-scoped connection so the Google sync trigger has somewhere to
  -- enqueue; without one the queue is inert and the I14 test would pass for
  -- the wrong reason.
  insert into public.email_connections (
    company_id, email, access_token, refresh_token, expires_at,
    status, type, provider, granted_scopes
  ) values (
    v_company::text, 'p2-contract@example.invalid', 'x', 'y', now() + interval '1 day',
    'active', 'company', 'google',
    array['https://www.googleapis.com/auth/calendar.events']
  ) returning id into v_connection;

  insert into t_fixture (key, uuid_value) values
    ('company', v_company),
    ('owner', v_owner),
    ('integration', v_integration),
    ('connection', v_connection);
end;
$seed$;

select 'fixture' as scope, key, coalesce(uuid_value::text, text_value) as value
from t_fixture order by key;


-- ---------------------------------------------------------------------------
-- T1 — grants and the service-role gate
-- ---------------------------------------------------------------------------
\echo '--- T1 zero non-owner grants on the new private tables'
select count(*) as non_owner_grants_expect_zero
from information_schema.role_table_grants
where table_schema = 'private'
  and table_name in ('guest_booking_intents', 'customer_booking_claims')
  and grantee <> 'postgres';

\echo '--- T1 grants on the policy table mirror site_visit_types exactly'
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'site_visit_booking_policies'
group by 1 order by 1;

do $t1g$
declare
  v_policy text;
  v_types text;
begin
  select string_agg(grantee || '=' || privs, ' | ' order by grantee)
  into v_policy
  from (
    select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'site_visit_booking_policies'
      and grantee in ('anon', 'authenticated')
    group by grantee
  ) g;
  select string_agg(grantee || '=' || privs, ' | ' order by grantee)
  into v_types
  from (
    select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'site_visit_types'
      and grantee in ('anon', 'authenticated')
    group by grantee
  ) g;
  if v_policy is distinct from v_types then
    raise exception 'T1 app-role grants diverge: policy [%] vs site_visit_types [%]',
      v_policy, v_types;
  end if;
  raise notice 'T1 app-role grants match site_visit_types: %', v_policy;
end;
$t1g$;

\echo '--- T1 gate fires for every new *_as_system RPC, as the real anon role'
do $t1$
declare
  v_state text;
  v_calls text[] := array[
    $$select * from public.read_public_booking_policy_as_system(gen_random_uuid())$$,
    $$select * from public.read_public_availability_as_system(gen_random_uuid(), current_date, current_date)$$,
    $$select * from public.hold_booking_slot_as_system(gen_random_uuid(), gen_random_uuid(), now(), repeat('a',64))$$,
    $$select * from public.record_guest_booking_contact_as_system(gen_random_uuid(), 'n', '1:'||repeat('a',64), null, null, '[]'::jsonb)$$,
    $$select public.book_site_visit_as_system(gen_random_uuid(), now() + interval '1 day')$$,
    $$select * from public.confirm_guest_booking_as_system(gen_random_uuid(), '1:'||repeat('a',64), 'x@example.invalid', 'email')$$,
    $$select * from public.confirm_booking_request_as_system(gen_random_uuid(), gen_random_uuid(), null)$$,
    $$select * from public.decline_booking_request_as_system(gen_random_uuid(), gen_random_uuid(), null)$$,
    $$select * from public.reschedule_guest_booking_as_system(gen_random_uuid(), now() + interval '1 day')$$,
    $$select * from public.cancel_guest_booking_as_system(gen_random_uuid(), null)$$,
    $$select * from public.claim_guest_booking_as_system(gen_random_uuid(), gen_random_uuid(), '1:'||repeat('a',64))$$
  ];
  v_call text;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  foreach v_call in array v_calls loop
    begin
      execute v_call;
      raise exception 'gate did not fire for %', v_call;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> '42501' then
        raise exception 'wrong sqlstate % for %', v_state, v_call;
      end if;
    end;
  end loop;
  raise notice 'T1 gate ok: % RPCs all refused anon with 42501', cardinality(v_calls);
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$t1$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);


-- ---------------------------------------------------------------------------
-- T2 — window and answer validators
-- ---------------------------------------------------------------------------
\echo '--- T2 window validator'
select
  private.booking_windows_valid('[]'::jsonb) as empty_ok,
  private.booking_windows_valid('[{"weekday":1,"start":"08:00","end":"16:00"}]'::jsonb) as one_ok,
  private.booking_windows_valid('[{"weekday":1,"start":"08:00","end":"12:00"},{"weekday":1,"start":"12:00","end":"16:00"}]'::jsonb) as touching_ok,
  private.booking_windows_valid('[{"weekday":1,"start":"08:00","end":"13:00"},{"weekday":1,"start":"12:00","end":"16:00"}]'::jsonb) as overlap_rejected,
  private.booking_windows_valid('[{"weekday":1,"start":"16:00","end":"08:00"}]'::jsonb) as inverted_rejected,
  private.booking_windows_valid('[{"weekday":7,"start":"08:00","end":"16:00"}]'::jsonb) as weekday_out_of_range_rejected,
  private.booking_windows_valid('[{"weekday":1,"start":"8:00","end":"16:00"}]'::jsonb) as bad_format_rejected,
  private.booking_windows_valid('{}'::jsonb) as non_array_rejected,
  private.booking_windows_valid(
    (select jsonb_agg(jsonb_build_object('weekday', 0, 'start', lpad(n::text,2,'0')||':00', 'end', lpad((n+1)::text,2,'0')||':00'))
     from generate_series(0, 14) n)
  ) as fifteen_entries_rejected;

do $t2$
begin
  if private.booking_windows_valid('[{"weekday":1,"start":"08:00","end":"13:00"},{"weekday":1,"start":"12:00","end":"16:00"}]'::jsonb)
     or private.booking_windows_valid('[{"weekday":1,"start":"16:00","end":"08:00"}]'::jsonb)
     or private.booking_windows_valid('[{"weekday":7,"start":"08:00","end":"16:00"}]'::jsonb)
     or private.booking_windows_valid('{}'::jsonb)
     or not private.booking_windows_valid('[{"weekday":1,"start":"08:00","end":"12:00"},{"weekday":1,"start":"12:00","end":"16:00"}]'::jsonb)
  then
    raise exception 'T2 window validator wrong';
  end if;
  if private.booking_answers_valid('{}'::jsonb)
     or private.booking_answers_valid('[{"a":{"b":1}}]'::jsonb)
     or not private.booking_answers_valid('[{"label":"Roof age","value":12}]'::jsonb)
  then
    raise exception 'T2 answer validator wrong';
  end if;
  raise notice 'T2 validators ok';
end;
$t2$;

\echo '--- T2 policy write rejects a bogus timezone and a cross-tenant owner'
do $t2b$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_foreign uuid;
  v_state text;
begin
  begin
    insert into public.site_visit_booking_policies (company_id, timezone)
    values (v_company, 'Mars/Olympus');
    raise exception 'bogus timezone accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'wrong sqlstate % for timezone', v_state; end if;
  end;

  select u.id into v_foreign
  from public.users u
  where u.company_id is distinct from v_company and u.deleted_at is null
  limit 1;

  begin
    insert into public.site_visit_booking_policies (company_id, timezone, default_owner_id)
    values (v_company, 'America/Vancouver', v_foreign);
    raise exception 'cross-tenant owner accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'wrong sqlstate % for owner', v_state; end if;
  end;
  raise notice 'T2b policy write validation ok';
end;
$t2b$;


-- ---------------------------------------------------------------------------
-- T3 — DST: the slot expander in a non-UTC policy timezone
-- ---------------------------------------------------------------------------
\echo '--- T3 spring-forward gap: the missing local hour is dropped, not shifted'
do $t3$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_policy public.site_visit_booking_policies%rowtype;
  v_spring_count integer;
  v_spring_distinct integer;
  v_has_gap boolean;
  v_fall_count integer;
  v_fall_distinct integer;
  v_locals text;
begin
  insert into public.site_visit_booking_policies (
    company_id, mode, windows, timezone, min_notice_hours, horizon_days,
    visit_duration_minutes, slot_granularity_minutes
  ) values (
    v_company, 'instant',
    -- 2027-03-14 and 2026-11-01 are both Sundays (weekday 0).
    '[{"weekday":0,"start":"00:00","end":"06:00"}]'::jsonb,
    'America/Vancouver', 0, 120, 60, 60
  ) returning * into v_policy;

  select count(*), count(distinct slot_start_at),
         bool_or((slot_start_at at time zone 'America/Vancouver')::time = time '02:00')
  into v_spring_count, v_spring_distinct, v_has_gap
  from private.booking_policy_slot_starts(v_policy, date '2027-03-14', date '2027-03-14');

  select string_agg(to_char(slot_start_at at time zone 'America/Vancouver', 'HH24:MI'), ',' order by slot_start_at)
  into v_locals
  from private.booking_policy_slot_starts(v_policy, date '2027-03-14', date '2027-03-14');
  raise notice 'T3 spring-forward local starts: % (count=%, distinct=%)', v_locals, v_spring_count, v_spring_distinct;

  -- Six candidate local starts, one of which (02:00) does not exist. Without
  -- the round-trip guard Postgres would map it to the same instant as 03:00
  -- and the page would be offered the same time twice.
  if v_spring_count <> 5 or v_spring_distinct <> 5 or v_has_gap then
    raise exception 'T3 spring-forward wrong: count=% distinct=% gap=%',
      v_spring_count, v_spring_distinct, v_has_gap;
  end if;

  select count(*), count(distinct slot_start_at)
  into v_fall_count, v_fall_distinct
  from private.booking_policy_slot_starts(v_policy, date '2026-11-01', date '2026-11-01');

  select string_agg(to_char(slot_start_at at time zone 'America/Vancouver', 'HH24:MI'), ',' order by slot_start_at)
  into v_locals
  from private.booking_policy_slot_starts(v_policy, date '2026-11-01', date '2026-11-01');
  raise notice 'T3 fall-back local starts: % (count=%, distinct=%)', v_locals, v_fall_count, v_fall_distinct;

  -- The repeated local hour is resolved to exactly one instant.
  if v_fall_count <> 6 or v_fall_distinct <> 6 then
    raise exception 'T3 fall-back wrong: count=% distinct=%', v_fall_count, v_fall_distinct;
  end if;

  delete from public.site_visit_booking_policies where company_id = v_company;
  raise notice 'T3 DST ok';
end;
$t3$;


-- ---------------------------------------------------------------------------
-- T4 — availability: off / notice / horizon / cap / collisions
-- ---------------------------------------------------------------------------
\echo '--- T4 availability'
do $t4$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_owner uuid := (select uuid_value from t_fixture where key = 'owner');
  v_policy public.site_visit_booking_policies%rowtype;
  v_from date;
  v_to date;
  v_n integer;
  v_first timestamptz;
  v_client uuid;
  v_opp uuid;
  v_visit uuid;
begin
  -- Every weekday, 08:00-16:00 local, hourly, 60-minute visits.
  insert into public.site_visit_booking_policies (
    company_id, mode, windows, timezone, min_notice_hours, horizon_days,
    visit_duration_minutes, slot_granularity_minutes, default_owner_id
  ) values (
    v_company, 'off',
    (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '08:00', 'end', '16:00'))
       from generate_series(0, 6) d),
    'America/Vancouver', 48, 21, 60, 60, v_owner
  ) returning * into v_policy;

  v_from := (now() at time zone 'America/Vancouver')::date;
  v_to := v_from + 21;

  -- mode = off returns nothing at all.
  select count(*) into v_n
  from public.read_public_availability_as_system(v_company, v_from, v_to);
  if v_n <> 0 then raise exception 'T4 mode=off leaked % slots', v_n; end if;
  if exists (select 1 from public.read_public_booking_policy_as_system(v_company)) then
    raise exception 'T4 mode=off leaked a policy read';
  end if;
  raise notice 'T4 mode=off: 0 slots, 0 policy rows';

  update public.site_visit_booking_policies set mode = 'instant' where company_id = v_company
  returning * into v_policy;

  select count(*), min(slot_start_at) into v_n, v_first
  from public.read_public_availability_as_system(v_company, v_from, v_to);
  raise notice 'T4 instant: % slots, first %', v_n, v_first;
  if v_n = 0 then raise exception 'T4 instant produced no slots'; end if;

  -- Notice: nothing inside 48 hours.
  if v_first < now() + interval '48 hours' then
    raise exception 'T4 notice violated: % < %', v_first, now() + interval '48 hours';
  end if;
  -- Horizon: nothing past the 21st local day.
  if exists (
    select 1 from public.read_public_availability_as_system(v_company, v_from, v_to) s
    where (s.slot_start_at at time zone 'America/Vancouver')::date > v_from + 21
  ) then
    raise exception 'T4 horizon violated';
  end if;
  -- A wide request is clamped, never widened.
  if exists (
    select 1 from public.read_public_availability_as_system(v_company, v_from, v_from + 400) s
    where (s.slot_start_at at time zone 'America/Vancouver')::date > v_from + 21
  ) then
    raise exception 'T4 horizon clamp violated';
  end if;
  raise notice 'T4 notice + horizon ok (first slot %, horizon %)', v_first, v_from + 21;

  -- Collision with a live booked visit: book the first slot for real and it
  -- must vanish from availability.
  insert into public.clients (company_id, name, email)
  values (v_company, 'P2 contract collision', 'p2-collision@example.invalid')
  returning id into v_client;
  insert into public.opportunities (company_id, client_id, client_ref, title, stage, source)
  values (v_company, v_client, v_client, 'P2 contract collision', 'new_lead', 'website')
  returning id into v_opp;
  v_visit := public.book_site_visit_as_system(
    v_opp, v_first, 60, array[v_owner::text], null, v_owner, 'public_booking'
  );

  if exists (
    select 1 from public.read_public_availability_as_system(v_company, v_from, v_to) s
    where s.slot_start_at = v_first
  ) then
    raise exception 'T4 booked slot still offered';
  end if;
  raise notice 'T4 booked-visit collision ok (slot % withdrawn)', v_first;

  insert into t_fixture (key, uuid_value, ts_value)
  values ('collision_visit', v_visit, v_first);
end;
$t4$;

\echo '--- T4b per-day cap'
do $t4b$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_cap_day date;
  v_before integer;
  v_after integer;
begin
  select (slot_start_at at time zone 'America/Vancouver')::date into v_cap_day
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at offset 1 limit 1;

  select count(*) into v_before
  from public.read_public_availability_as_system(v_company, v_cap_day, v_cap_day);

  -- One visit already exists that day (the T4 collision booking is on an
  -- earlier day), so a cap of 1 with zero bookings still offers slots; set the
  -- cap to the number of bookings that day to close it.
  update public.site_visit_booking_policies set max_bookings_per_day = 1
  where company_id = v_company;

  select count(*) into v_after
  from public.read_public_availability_as_system(v_company, v_cap_day, v_cap_day);
  raise notice 'T4b cap=1 on % : % slots before, % after (bookings that day: %)',
    v_cap_day, v_before, v_after,
    (select count(*) from public.site_visits sv
      where sv.company_id = v_company::text and sv.deleted_at is null
        and sv.booked_at is not null and sv.status = 'scheduled'
        and (sv.scheduled_at at time zone 'America/Vancouver')::date = v_cap_day);

  -- The collision booking is on the first available day; find the day it is on
  -- and prove that day is now closed under cap=1.
  if exists (
    select 1
    from public.read_public_availability_as_system(v_company, v_from, v_from + 21) s
    where (s.slot_start_at at time zone 'America/Vancouver')::date
          = (select (ts_value at time zone 'America/Vancouver')::date from t_fixture where key = 'collision_visit')
  ) then
    raise exception 'T4b capped day still offered';
  end if;
  raise notice 'T4b per-day cap ok: the day holding one booking offers nothing under cap=1';

  update public.site_visit_booking_policies set max_bookings_per_day = null
  where company_id = v_company;
end;
$t4b$;


-- ---------------------------------------------------------------------------
-- T5 — holds: caps, collision, expiry, and a staff booking beating a hold
-- ---------------------------------------------------------------------------
\echo '--- T5 holds'
do $t5$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_owner uuid := (select uuid_value from t_fixture where key = 'owner');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_slots timestamptz[];
  v_hold record;
  v_i integer;
  v_f integer;
  v_fp text;
  v_live integer;
  v_client uuid;
  v_opp uuid;
begin
  select array_agg(slot_start_at order by slot_start_at)
  into v_slots
  from (
    select slot_start_at
    from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
    order by slot_start_at
    limit 20
  ) s;
  if cardinality(v_slots) < 14 then
    raise exception 'T5 fixture needs 14 open slots, found %', cardinality(v_slots);
  end if;

  -- A live hold withdraws its slot from availability.
  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slots[1], repeat('1', 64));
  if not v_hold.allowed then raise exception 'T5 first hold refused'; end if;
  if exists (
    select 1 from public.read_public_availability_as_system(v_company, v_from, v_from + 21) s
    where s.slot_start_at = v_slots[1]
  ) then
    raise exception 'T5 held slot still offered';
  end if;
  raise notice 'T5 hold ok: intent %, expires % (5 min)', v_hold.intent_id, v_hold.hold_expires_at;
  -- The hold is minted from statement_timestamp(); inside this long-running
  -- transaction now() is the transaction start, so bound it against the wall
  -- clock instead.
  if v_hold.hold_expires_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'T5 hold longer than 5 minutes (expires %, now %)',
      v_hold.hold_expires_at, clock_timestamp();
  end if;
  insert into t_fixture (key, uuid_value, ts_value)
  values ('hold_1', v_hold.intent_id, v_slots[1]);

  -- I13: at most 3 live unverified holds per network fingerprint. Fingerprint
  -- 1 already holds slot 1; two more land, the fourth is refused.
  for v_i in 2..3 loop
    select * into v_hold
    from public.hold_booking_slot_as_system(v_company, v_integration, v_slots[v_i], repeat('1', 64));
    if not v_hold.allowed then raise exception 'T5 hold % refused early', v_i; end if;
  end loop;
  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slots[4], repeat('1', 64));
  if v_hold.allowed or v_hold.intent_id is not null then
    raise exception 'T5 fingerprint cap not enforced';
  end if;
  raise notice 'T5 fingerprint cap ok: 4th hold from one fingerprint refused, retry_after=%s',
    v_hold.retry_after_seconds;

  -- I13: at most 10 live holds per company, however many fingerprints try.
  -- Fingerprints 2, 3 and 4 take three slots each — nine more — so the tenth
  -- overall lands and every attempt after it is refused. The fingerprint index
  -- advances every third slot so no single fingerprint ever exceeds its own
  -- cap of 3 and the company cap is the only thing under test.
  for v_i in 4..13 loop
    select count(*) into v_live
    from private.guest_booking_intents intent
    where intent.company_id = v_company and intent.state = 'held'
      and intent.hold_expires_at > statement_timestamp();

    v_fp := repeat((((v_i - 4) / 3) + 2)::text, 64);
    select * into v_hold
    from public.hold_booking_slot_as_system(v_company, v_integration, v_slots[v_i], v_fp);

    if v_live < 10 and not v_hold.allowed then
      raise exception 'T5 hold % refused early at % live holds', v_i, v_live;
    end if;
    if v_live >= 10 and v_hold.allowed then
      raise exception 'T5 company cap not enforced at % live holds', v_live;
    end if;
    if v_live >= 10 then
      raise notice 'T5 company cap ok: 10 live holds across 4 fingerprints, next refused, retry_after=%s',
        v_hold.retry_after_seconds;
      exit;
    end if;
  end loop;

  select count(*) into v_live
  from private.guest_booking_intents intent
  where intent.company_id = v_company and intent.state = 'held'
    and intent.hold_expires_at > statement_timestamp();
  if v_live <> 10 then
    raise exception 'T5 expected the company to sit at 10 live holds, found %', v_live;
  end if;

  -- I13: a staff booking always wins over a hold. The staff verb never
  -- consults holds, and the held slot simply becomes unbookable.
  insert into public.clients (company_id, name, email)
  values (v_company, 'P2 contract staff-wins', 'p2-staffwins@example.invalid')
  returning id into v_client;
  insert into public.opportunities (company_id, client_id, client_ref, title, stage, source)
  values (v_company, v_client, v_client, 'P2 contract staff-wins', 'new_lead', 'website')
  returning id into v_opp;
  perform public.book_site_visit_as_system(
    v_opp,
    (select ts_value from t_fixture where key = 'hold_1'),
    60, array[v_owner::text], null, v_owner, 'public_booking'
  );
  raise notice 'T5 staff booking landed on the held slot';

  -- An expired hold never blocks.
  update private.guest_booking_intents intent
  set hold_expires_at = statement_timestamp() - interval '1 second'
  where intent.company_id = v_company and intent.state = 'held';
  if not exists (
    select 1
    from public.read_public_availability_as_system(v_company, v_from, v_from + 21) s
    where s.slot_start_at = v_slots[2]
  ) then
    raise exception 'T5 expired hold still blocking slot 2';
  end if;
  raise notice 'T5 expired holds no longer block';

  -- The sweeper marks them expired.
  perform private.guest_booking_hold_sweep();
  if exists (
    select 1 from private.guest_booking_intents intent
    where intent.company_id = v_company and intent.state = 'held'
  ) then
    raise exception 'T5 sweeper left live holds behind';
  end if;
  raise notice 'T5 sweeper ok: % intents expired',
    (select count(*) from private.guest_booking_intents i
      where i.company_id = v_company and i.state = 'expired');
end;
$t5$;

\echo '--- T5b the held slot the staff took is refused at confirm (I12 + I13)'
do $t5b$
declare
  v_intent uuid := (select uuid_value from t_fixture where key = 'hold_1');
  v_digest text := '1:' || repeat('a', 64);
  v_state text;
begin
  -- Re-open the hold the staff booking overtook, then try to confirm it.
  update private.guest_booking_intents intent
  set state = 'held',
      hold_expires_at = now() + interval '5 minutes',
      contact_email_digest = v_digest,
      contact_name = 'Contract Guest'
  where intent.id = v_intent;

  begin
    perform * from public.confirm_guest_booking_as_system(
      v_intent, v_digest, 'p2-guest@example.invalid', 'email'
    );
    raise exception 'T5b confirm accepted a slot the staff had taken';
  exception when sqlstate '55000' then
    get stacked diagnostics v_state = message_text;
    if v_state <> 'booking_slot_unavailable' then
      raise exception 'T5b refused for the wrong reason: %', v_state;
    end if;
    raise notice 'T5b ok: confirm refused the overtaken slot (%)', v_state;
  end;
end;
$t5b$;


-- ---------------------------------------------------------------------------
-- T6 — instant mode: a real visit, a real calendar queue row, a real lead
-- ---------------------------------------------------------------------------
\echo '--- T6 instant confirm'
do $t6$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_owner uuid := (select uuid_value from t_fixture where key = 'owner');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_slot timestamptz;
  v_hold record;
  v_result record;
  v_digest text := '1:' || repeat('b', 64);
  v_opp public.opportunities%rowtype;
  v_visit public.site_visits%rowtype;
  v_queue integer;
  v_activity integer;
  v_notifications integer;
  v_assignment integer;
begin
  select slot_start_at into v_slot
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at limit 1;

  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slot, repeat('3', 64));
  if not v_hold.allowed then raise exception 'T6 hold refused'; end if;

  perform * from public.record_guest_booking_contact_as_system(
    v_hold.intent_id, 'Dana Guest', v_digest, 'ciphertext-blob', '+1 604 555 0134',
    '[{"label":"What needs doing?","value":"New back deck"}]'::jsonb
  );

  select * into v_result
  from public.confirm_guest_booking_as_system(
    v_hold.intent_id, v_digest, 'p2-instant@example.invalid', 'email'
  );

  if v_result.outcome <> 'confirmed' then
    raise exception 'T6 outcome % (expected confirmed)', v_result.outcome;
  end if;
  if v_result.site_visit_id is null then raise exception 'T6 no visit'; end if;

  select * into v_opp from public.opportunities where id = v_result.opportunity_id;
  select * into v_visit from public.site_visits where id = v_result.site_visit_id;

  raise notice 'T6 lead: source=% stage=% assigned_to=% version=% thread_key=%',
    v_opp.source, v_opp.stage, v_opp.assigned_to, v_opp.assignment_version, v_opp.source_thread_key;
  raise notice 'T6 visit: scheduled=% duration=% status=% booked_at=% assignees=% created_by=%',
    v_visit.scheduled_at, v_visit.duration_minutes, v_visit.status,
    v_visit.booked_at is not null, v_visit.assignee_ids, v_visit.created_by;

  -- I16: the lead spine.
  if v_opp.source <> 'website' then raise exception 'T6 source %', v_opp.source; end if;
  if v_opp.client_id is null or v_opp.client_id <> v_result.client_id then
    raise exception 'T6 client mirrors disagree';
  end if;
  -- The visit exists, is booked, is attached to the lead, and the stage moved.
  if v_visit.booked_at is null or v_visit.status::text <> 'scheduled' then
    raise exception 'T6 visit not a live booking';
  end if;
  if v_visit.opportunity_id <> v_result.opportunity_id then
    raise exception 'T6 visit not attached to the lead';
  end if;
  if v_opp.stage <> 'qualifying' then
    raise exception 'T6 stage nudge did not fire (stage=%)', v_opp.stage;
  end if;
  -- I11: the assignee came from policy, and the caller never chose it.
  if v_visit.assignee_ids <> array[v_owner::text] then
    raise exception 'T6 assignees % (expected the policy owner)', v_visit.assignee_ids;
  end if;
  if v_opp.assigned_to is distinct from v_owner or v_opp.assignment_version <> 1 then
    raise exception 'T6 lead assignment wrong: % v%', v_opp.assigned_to, v_opp.assignment_version;
  end if;

  select count(*) into v_assignment
  from public.opportunity_assignment_events e
  where e.opportunity_id = v_result.opportunity_id and e.source = 'public_booking_default';
  if v_assignment <> 1 then
    raise exception 'T6 assignment ledger rows = % (expected 1)', v_assignment;
  end if;

  select count(*) into v_activity
  from public.activities a
  where a.site_visit_id = v_result.site_visit_id and a.type = 'site_visit_scheduled';
  if v_activity <> 1 or v_visit.activity_id is null then
    raise exception 'T6 activity wrong: % rows, activity_id=%', v_activity, v_visit.activity_id;
  end if;

  select count(*) into v_queue
  from public.google_calendar_sync_queue q
  where q.site_visit_id = v_result.site_visit_id and q.operation = 'create';
  if v_queue <> 1 then
    raise exception 'T6 calendar queue rows = % (expected 1)', v_queue;
  end if;

  select count(*) into v_notifications
  from public.notifications n
  where n.dedupe_key = 'booking_confirmed:' || v_hold.intent_id::text;
  if v_notifications < 1 then raise exception 'T6 no staff notification'; end if;

  raise notice 'T6 ok: 1 calendar queue row, 1 activity, % notification(s), 1 assignment event',
    v_notifications;

  insert into t_fixture (key, uuid_value, ts_value)
  values ('instant_intent', v_hold.intent_id, v_slot),
         ('instant_visit', v_result.site_visit_id, v_slot);
end;
$t6$;

\echo '--- T6b I12 replay: the same descriptor cannot book twice'
do $t6b$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_slot timestamptz := (select ts_value from t_fixture where key = 'instant_intent');
  v_hold record;
begin
  -- Replaying a still-valid signed descriptor for a slot that has since been
  -- taken must be refused at the hold, and the confirm re-checks anyway.
  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slot, repeat('4', 64));
  if v_hold.allowed or v_hold.intent_id is not null then
    raise exception 'T6b replayed descriptor was allowed to hold a taken slot';
  end if;
  raise notice 'T6b ok: replayed descriptor refused (allowed=%, intent=%)',
    v_hold.allowed, v_hold.intent_id;
end;
$t6b$;

\echo '--- T6c a policy change under a live hold is refused at confirm (I12)'
do $t6c$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_slot timestamptz;
  v_hold record;
  v_digest text := '1:' || repeat('c', 64);
begin
  select slot_start_at into v_slot
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at limit 1;

  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slot, repeat('5', 64));
  if not v_hold.allowed then raise exception 'T6c hold refused'; end if;
  perform * from public.record_guest_booking_contact_as_system(
    v_hold.intent_id, 'Late Guest', v_digest, null, null, '[]'::jsonb
  );

  -- The business narrows its windows while the page holds the slot.
  update public.site_visit_booking_policies
  set windows = '[{"weekday":0,"start":"08:00","end":"09:00"}]'::jsonb
  where company_id = v_company;

  begin
    perform * from public.confirm_guest_booking_as_system(
      v_hold.intent_id, v_digest, 'p2-late@example.invalid', 'email'
    );
    raise exception 'T6c confirm honoured a slot policy no longer offers';
  exception when sqlstate '55000' then
    raise notice 'T6c ok: policy change refused the stale slot (%)', sqlerrm;
  end;

  -- Restore the wide windows for the remaining tests.
  update public.site_visit_booking_policies
  set windows = (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '08:00', 'end', '16:00'))
                   from generate_series(0, 6) d)
  where company_id = v_company;
end;
$t6c$;


-- ---------------------------------------------------------------------------
-- T7 — request mode: no visit, no calendar work, then staff acceptance (I14)
-- ---------------------------------------------------------------------------
\echo '--- T7 request mode'
do $t7$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_owner uuid := (select uuid_value from t_fixture where key = 'owner');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_slot timestamptz;
  v_hold record;
  v_result record;
  v_digest text := '1:' || repeat('d', 64);
  v_queue_before integer;
  v_queue_after integer;
  v_visits integer;
  v_accept record;
  v_visit public.site_visits%rowtype;
  v_notification record;
begin
  update public.site_visit_booking_policies set mode = 'request' where company_id = v_company;

  select slot_start_at into v_slot
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at limit 1;
  if v_slot is null then raise exception 'T7 no slot in request mode'; end if;

  select count(*) into v_queue_before from public.google_calendar_sync_queue;

  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slot, repeat('6', 64));
  if not v_hold.allowed then raise exception 'T7 hold refused'; end if;
  perform * from public.record_guest_booking_contact_as_system(
    v_hold.intent_id, 'Rae Requester', v_digest, null, '+1 604 555 0177', '[]'::jsonb
  );

  select * into v_result
  from public.confirm_guest_booking_as_system(
    v_hold.intent_id, v_digest, 'p2-request@example.invalid', 'email'
  );

  raise notice 'T7 outcome=% visit=% lead=%',
    v_result.outcome, v_result.site_visit_id, v_result.opportunity_id;

  -- I14, at the database level: no visit row anywhere for this lead, and not
  -- one new calendar-queue row in the whole table.
  if v_result.outcome <> 'submitted' then
    raise exception 'T7 outcome % (expected submitted)', v_result.outcome;
  end if;
  if v_result.site_visit_id is not null then
    raise exception 'T7 request mode returned a visit';
  end if;
  select count(*) into v_visits
  from public.site_visits sv where sv.opportunity_id = v_result.opportunity_id;
  if v_visits <> 0 then raise exception 'T7 request mode created % site_visits rows', v_visits; end if;

  select count(*) into v_queue_after from public.google_calendar_sync_queue;
  if v_queue_after <> v_queue_before then
    raise exception 'T7 request mode enqueued % calendar rows', v_queue_after - v_queue_before;
  end if;
  if v_result.opportunity_id is null or v_result.client_id is null then
    raise exception 'T7 request mode skipped the lead spine';
  end if;
  raise notice 'T7 I14 ok: 0 site_visits rows, 0 new calendar-queue rows, lead + client created';

  select * into v_notification
  from public.notifications n
  where n.dedupe_key = 'booking_request:' || v_hold.intent_id::text
  limit 1;
  if v_notification.id is null then raise exception 'T7 no request notification'; end if;
  if not v_notification.persistent then raise exception 'T7 request notification not persistent'; end if;
  raise notice 'T7 notification: type=% persistent=% action_url=% label=%',
    v_notification.type, v_notification.persistent, v_notification.action_url, v_notification.action_label;

  -- Staff accept, moving the time by an hour.
  select * into v_accept
  from public.confirm_booking_request_as_system(
    v_hold.intent_id, v_owner, v_slot + interval '1 hour'
  );
  select * into v_visit from public.site_visits where id = v_accept.site_visit_id;

  if v_visit.id is null or v_visit.booked_at is null then
    raise exception 'T7 acceptance produced no live booking';
  end if;
  if v_visit.scheduled_at <> v_slot + interval '1 hour' then
    raise exception 'T7 acceptance ignored the staff-chosen time';
  end if;
  select count(*) into v_queue_after
  from public.google_calendar_sync_queue q where q.site_visit_id = v_visit.id;
  if v_queue_after <> 1 then
    raise exception 'T7 acceptance enqueued % calendar rows (expected 1)', v_queue_after;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.dedupe_key = 'booking_request:' || v_hold.intent_id::text
      and n.resolved_at is null
  ) then
    raise exception 'T7 acceptance left the request notification open';
  end if;
  raise notice 'T7 acceptance ok: visit % at % (moved), 1 calendar row, request notification resolved',
    v_visit.id, v_visit.scheduled_at;

  insert into t_fixture (key, uuid_value, ts_value)
  values ('request_intent', v_hold.intent_id, v_slot + interval '1 hour'),
         ('request_visit', v_visit.id, v_slot + interval '1 hour');

  update public.site_visit_booking_policies set mode = 'instant' where company_id = v_company;
end;
$t7$;

\echo '--- T7b decline closes the request and keeps the lead'
do $t7b$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_owner uuid := (select uuid_value from t_fixture where key = 'owner');
  v_integration uuid := (select uuid_value from t_fixture where key = 'integration');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_slot timestamptz;
  v_hold record;
  v_result record;
  v_declined record;
  v_digest text := '1:' || repeat('e', 64);
  v_state text;
begin
  update public.site_visit_booking_policies set mode = 'request' where company_id = v_company;
  select slot_start_at into v_slot
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at limit 1;

  select * into v_hold
  from public.hold_booking_slot_as_system(v_company, v_integration, v_slot, repeat('7', 64));
  perform * from public.record_guest_booking_contact_as_system(
    v_hold.intent_id, 'Declined Guest', v_digest, null, null, '[]'::jsonb
  );
  select * into v_result
  from public.confirm_guest_booking_as_system(
    v_hold.intent_id, v_digest, 'p2-declined@example.invalid', 'email'
  );

  select * into v_declined
  from public.decline_booking_request_as_system(v_hold.intent_id, v_owner, 'no capacity that week');

  select intent.state into v_state
  from private.guest_booking_intents intent where intent.id = v_hold.intent_id;
  if v_state <> 'cancelled' then raise exception 'T7b intent state % after decline', v_state; end if;
  if v_declined.opportunity_id is null
     or not exists (select 1 from public.opportunities o
                     where o.id = v_declined.opportunity_id and o.deleted_at is null) then
    raise exception 'T7b decline destroyed the lead';
  end if;
  if exists (
    select 1 from public.notifications n
    where n.dedupe_key = 'booking_request:' || v_hold.intent_id::text and n.resolved_at is null
  ) then
    raise exception 'T7b decline left the request notification open';
  end if;
  raise notice 'T7b ok: intent cancelled, lead % kept, notification resolved', v_declined.opportunity_id;

  update public.site_visit_booking_policies set mode = 'instant' where company_id = v_company;
end;
$t7b$;


-- ---------------------------------------------------------------------------
-- T8 — customer-side reschedule and cancel (I15)
-- ---------------------------------------------------------------------------
\echo '--- T8 reschedule + cancel'
do $t8$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_intent uuid := (select uuid_value from t_fixture where key = 'instant_intent');
  v_visit_id uuid := (select uuid_value from t_fixture where key = 'instant_visit');
  v_from date := (now() at time zone 'America/Vancouver')::date;
  v_new timestamptz;
  v_moved record;
  v_cancelled record;
  v_visit public.site_visits%rowtype;
  v_queue integer;
  v_skipped integer;
  v_state text;
begin
  select slot_start_at into v_new
  from public.read_public_availability_as_system(v_company, v_from, v_from + 21)
  order by slot_start_at desc limit 1;

  select * into v_moved
  from public.reschedule_guest_booking_as_system(v_intent, v_new);
  select * into v_visit from public.site_visits where id = v_moved.site_visit_id;

  if v_moved.site_visit_id <> v_visit_id then raise exception 'T8 rescheduled the wrong visit'; end if;
  if v_visit.scheduled_at <> v_new then raise exception 'T8 reschedule did not move the visit'; end if;
  select count(*) into v_queue
  from public.google_calendar_sync_queue q
  where q.site_visit_id = v_visit_id and q.operation = 'update';
  if v_queue <> 1 then raise exception 'T8 reschedule enqueued % update rows', v_queue; end if;
  raise notice 'T8 reschedule ok: visit moved to %, 1 calendar update row', v_new;

  -- A slot policy does not offer is refused.
  begin
    perform * from public.reschedule_guest_booking_as_system(v_intent, v_new + interval '13 minutes');
    raise exception 'T8 reschedule accepted an unoffered time';
  exception when sqlstate '55000' then
    raise notice 'T8 ok: reschedule refused an unoffered time (%)', sqlerrm;
  end;

  select * into v_cancelled from public.cancel_guest_booking_as_system(v_intent, 'plans changed');
  select * into v_visit from public.site_visits where id = v_cancelled.site_visit_id;
  select intent.state into v_state from private.guest_booking_intents intent where intent.id = v_intent;

  if v_visit.status::text <> 'cancelled' then
    raise exception 'T8 cancel left status %', v_visit.status;
  end if;
  if v_state <> 'cancelled' then raise exception 'T8 intent state % after cancel', v_state; end if;
  select count(*) into v_skipped
  from public.google_calendar_sync_queue q
  where q.site_visit_id = v_visit_id and q.status = 'pending' and q.operation in ('create','update');
  if v_skipped <> 0 then
    raise exception 'T8 cancel left % pending create/update calendar rows', v_skipped;
  end if;
  select count(*) into v_queue
  from public.google_calendar_sync_queue q
  where q.site_visit_id = v_visit_id and q.operation = 'delete';
  if v_queue <> 1 then raise exception 'T8 cancel enqueued % delete rows', v_queue; end if;
  raise notice 'T8 cancel ok: visit cancelled, 0 pending create/update rows, 1 delete row';

  -- The freed slot comes back.
  if not exists (
    select 1 from public.read_public_availability_as_system(v_company, v_from, v_from + 21) s
    where s.slot_start_at = v_new
  ) then
    raise exception 'T8 cancelled slot did not return to availability';
  end if;
  raise notice 'T8 cancelled slot % is offered again', v_new;
end;
$t8$;


-- ---------------------------------------------------------------------------
-- T9 — claiming a guest booking on a later sign-in
-- ---------------------------------------------------------------------------
\echo '--- T9 claim'
do $t9$
declare
  v_company uuid := (select uuid_value from t_fixture where key = 'company');
  v_intent uuid := (select uuid_value from t_fixture where key = 'request_intent');
  v_digest text := '1:' || repeat('d', 64);
  v_identity uuid;
  v_other uuid;
  v_claim record;
  v_again record;
  v_state text;
begin
  select identity_id into v_identity
  from public.upsert_customer_identity_as_system(
    gen_random_uuid()::text, 'p2-request@example.invalid'
  );
  select identity_id into v_other
  from public.upsert_customer_identity_as_system(
    gen_random_uuid()::text, 'p2-stranger@example.invalid'
  );

  -- A digest that is not the one on the intent proves nothing.
  begin
    perform * from public.claim_guest_booking_as_system(
      v_intent, v_identity, '1:' || repeat('f', 64)
    );
    raise exception 'T9 claim accepted a foreign digest';
  exception when sqlstate '42501' then
    raise notice 'T9 ok: foreign digest refused (%)', sqlerrm;
  end;

  select * into v_claim
  from public.claim_guest_booking_as_system(v_intent, v_identity, v_digest);
  if v_claim.claim_id is null or not v_claim.created then
    raise exception 'T9 claim failed';
  end if;
  if v_claim.client_id is null then raise exception 'T9 claim resolved no client'; end if;

  select member.state into v_state
  from private.company_client_memberships member where member.id = v_claim.membership_id;
  raise notice 'T9 claim ok: claim=% membership=% state=% client=%',
    v_claim.claim_id, v_claim.membership_id, v_state, v_claim.client_id;

  -- Exactly once: a second claim reports the first, and never a second row.
  select * into v_again
  from public.claim_guest_booking_as_system(v_intent, v_other, v_digest);
  if v_again.created or v_again.claim_id <> v_claim.claim_id then
    raise exception 'T9 second claim created a new row';
  end if;
  if (select count(*) from private.customer_booking_claims c where c.intent_id = v_intent) <> 1 then
    raise exception 'T9 more than one claim row';
  end if;
  raise notice 'T9 exactly-once ok: second claim returned the first (created=%)', v_again.created;

  -- The claim never creates a client — it attaches to the one the booking
  -- already resolved.
  if v_claim.client_id is distinct from
     (select intent.resolved_client_id from private.guest_booking_intents intent
       where intent.id = v_intent) then
    raise exception 'T9 claim invented a client';
  end if;
  raise notice 'T9 claim attached to the booking''s own client, created none';
end;
$t9$;


-- ---------------------------------------------------------------------------
-- T10 — tenant isolation on the policy table
-- ---------------------------------------------------------------------------
\echo '--- T10 policy RLS'
select
  schemaname, tablename, policyname, permissive, roles::text, cmd,
  coalesce(qual, '-') as qual, coalesce(with_check, '-') as with_check
from pg_policies
where schemaname = 'public' and tablename = 'site_visit_booking_policies'
order by permissive desc, policyname;

select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.site_visit_booking_policies'::regclass;

\echo '--- T10 anon with no company identity reads nothing'
do $t10$
declare
  v_rows integer;
  v_state text;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon","sub":"no-such-subject"}', true);
  select count(*) into v_rows from public.site_visit_booking_policies;
  if v_rows <> 0 then raise exception 'T10 anon read % policy rows', v_rows; end if;

  begin
    insert into public.site_visit_booking_policies (company_id, timezone)
    values ('ddee107c-33cd-483e-8278-0f8d8a180181', 'America/Vancouver');
    raise exception 'T10 anon wrote a policy row';
  exception when insufficient_privilege then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'T10 ok: anon write refused (%)', v_state;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$t10$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);


-- ---------------------------------------------------------------------------
-- T11 — object inventory and the cron registration
-- ---------------------------------------------------------------------------
\echo '--- T11 inventory'
select 'private tables' as kind, count(*)::text as value
from pg_tables where schemaname = 'private'
  and tablename in ('guest_booking_intents', 'customer_booking_claims')
union all
select 'public policy table', count(*)::text
from pg_tables where schemaname = 'public' and tablename = 'site_visit_booking_policies'
union all
select 'booking *_as_system rpcs', count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'read_public_booking_policy_as_system', 'read_public_availability_as_system',
    'hold_booking_slot_as_system', 'record_guest_booking_contact_as_system',
    'book_site_visit_as_system', 'confirm_guest_booking_as_system',
    'confirm_booking_request_as_system', 'decline_booking_request_as_system',
    'reschedule_guest_booking_as_system', 'cancel_guest_booking_as_system',
    'claim_guest_booking_as_system'
  )
union all
select 'private helpers', count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname in (
    'booking_windows_valid', 'booking_answers_valid', 'booking_policy_validate',
    'booking_policy_slot_starts', 'booking_slot_is_open', 'booking_expire_stale_holds',
    'booking_resolve_guest_client', 'booking_notify_staff', 'guest_booking_hold_sweep',
    'run_guest_booking_hold_sweep_controlled'
  )
union all
select 'staff book_site_visit untouched', (
  select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'book_site_visit'
    and pg_get_functiondef(p.oid) like '%current_user_can_edit_site_visit%'
);

select jobname, schedule, command, active from cron.job
where jobname = 'guest_booking_hold_sweep_5min';

\echo '--- T11 the assignment source allowlist grew by exactly one value'
select conname, pg_get_constraintdef(oid) like '%public_booking_default%' as has_new_source
from pg_constraint
where conrelid = 'public.opportunity_assignment_events'::regclass
  and conname in ('opportunity_assignment_events_source_check',
                  'opportunity_assignment_events_actor_required')
order by conname;

\echo '=== ALL CONTRACT TESTS PASSED (rolling back) ==='
rollback;
