-- OPS Public API: availability and guest booking foundation (P2-1).
--
-- This migration creates the storage and system RPCs behind public site-visit
-- booking (design spec 2026-09-02-public-api-availability-and-guest-booking,
-- parent 2026-09-01-public-api-customer-identity-design, plan
-- specs/plans/2026-09-02-public-api-guest-booking-P2-plan Task P2-1): the
-- per-company booking policy, business-defined availability windows, guest
-- slot holds, the atomic guest confirm, the actorless twins of the staff
-- booking verbs, the request-mode staff decisions, the exactly-once claim of a
-- guest booking by a customer identity, and the hold sweeper. It creates no
-- route and modifies no staff-actor RPC.
--
-- Security model:
--   * `private.guest_booking_intents` and `private.customer_booking_claims`
--     hold every table privilege revoked from public, anon, authenticated and
--     service_role, with RLS enabled and no policies; the only access paths
--     are the owner-executed SECURITY DEFINER functions below (design D8);
--   * public *_as_system RPCs are callable only by service_role and repeat an
--     auth-role check as defense in depth (the shipped wave pattern);
--   * `public.site_visit_booking_policies` is ordinary staff configuration and
--     lives in `public` behind the house RLS pair — `company_isolation`
--     PERMISSIVE ALL on the caller's company, plus RESTRICTIVE write policies
--     requiring `settings.company` — targeting role `public`, because the app
--     runs as anon;
--   * the public never names, selects or sees crew: availability reads only
--     company-wide booked visits and live holds, and every assignee comes from
--     the policy's `default_owner_id`, never from caller input (I11);
--   * a signed slot descriptor is a proposal only. Confirmation re-derives the
--     slot from live policy under the company advisory lock and refuses with
--     `booking_slot_unavailable` when policy, an existing booking, a live hold
--     or the per-day cap has moved underneath it (I12);
--   * holds are bounded — 5 minutes, at most 3 live unverified holds per
--     network fingerprint and 10 per company, expired holds never block, and a
--     staff booking always wins because it never consults holds at all (I13);
--   * `request` mode never touches a calendar: the confirm creates the client,
--     the lead and a `submitted` intent, and creates no `site_visits` row, so
--     the Google sync trigger has nothing to enqueue until staff accept (I14);
--   * management after the fact is a fresh-proof operation: the reschedule and
--     cancel RPCs take an intent that the broker has just re-verified, and no
--     long-lived capability is ever minted here (I15);
--   * every booking rides the lead spine — one client resolved by the P1 §5.3
--     rules, one `opportunities` row with `source='website'`, and the visit
--     attached to that lead. No booking-only parallel record exists (I16).
--
-- Deliberate deviations from the design text, with reasons:
--   * design §5 says the confirm creates the lead "through
--     `create_opportunity_guarded`". That RPC and its serialized internal both
--     resolve the actor from `private.get_current_user_id()` and require
--     `pipeline.create:all` on that actor, so neither is callable on a path
--     with no signed-in user. This migration mirrors the live production
--     precedent for exactly this caller class — the external intake API's
--     `public.create_external_intake_submission_as_system` — which inserts the
--     opportunity directly with `assigned_to = null, assignment_version = 0`.
--     Lead ownership is then set through the sanctioned system verb
--     `public.change_opportunity_assignment_as_system`, so the assignment
--     ledger, its write-token guard and its delivery rows all stay intact.
--   * that verb validates its `p_system_source` against a closed list held in
--     four places, so this migration adds one value, `public_booking_default`,
--     to all four: the two `opportunity_assignment_events` CHECK constraints,
--     `change_assignment_system_company_serialized_internal`, and
--     `change_opportunity_assignment_core`. Every change is additive; every
--     existing value keeps working, and no other assignment path is altered.
--   * `site_visits.created_by` is `text NOT NULL` with no foreign key, and
--     every live row holds a UUID. A public booking has no staff creator, so
--     `created_by` records the resolved owner when there is one and the
--     all-zeros UUID otherwise: the shape stays parseable for the scope
--     helpers that cast it, and it resolves to no user.
--   * the staff notification uses type `schedule_change`, which is in the
--     shipped `NotificationType` union and renders as "Schedule" in the rail.
--     A dedicated `booking_request` type would render as a raw slug until
--     P2-4 teaches the clients about it.


-- Fail closed if the primitives this migration composes with have drifted.
do $prerequisites$
declare
  v_signature text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'public_booking prerequisite missing: private schema';
  end if;

  foreach v_signature in array array[
    'private.agent_normalize_discovery_email(text)',
    'private.try_parse_uuid(text)',
    'private.customer_touch_updated_at()',
    'private.lock_lead_assignment_company(uuid)',
    'private.user_is_guarded_assignment_target_eligible(uuid,uuid)',
    'private.acquire_cron_workload_lease_internal(text,uuid,integer)',
    'private.complete_cron_workload_lease_internal(text,uuid,bigint,bigint,boolean,boolean,integer)',
    'private.is_cron_database_pressure_error(text,text)',
    'private.run_scheduled_cron_workload_controlled(text,integer,text)',
    'private.change_assignment_system_company_serialized_internal(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)',
    'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)',
    'public.move_opportunity_stage(uuid,text,uuid,integer)',
    'public.users_with_permission(uuid,text,text)',
    'public.create_notification_if_new_with_identity(uuid,uuid,text,text,text,boolean,text,text,text,text,text)',
    'public.book_site_visit(uuid,timestamp with time zone,integer,text[],integer)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'public_booking prerequisite missing: %', v_signature;
    end if;
  end loop;

  -- P1 must be live: the intent binds to a customer integration and a claim
  -- binds to a customer identity.
  if to_regclass('private.customer_integrations') is null
     or to_regclass('private.customer_identities') is null
     or to_regclass('private.company_client_memberships') is null then
    raise exception 'public_booking prerequisite missing: P1 customer identity tables';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_visits'
      and column_name in (
        'company_id', 'opportunity_id', 'client_id', 'client_ref',
        'scheduled_at', 'duration_minutes', 'assignee_ids', 'status',
        'booked_at', 'reminder_lead_minutes', 'created_by', 'activity_id',
        'deleted_at'
      )
    having count(distinct column_name) = 13
  ) then
    raise exception 'public_booking prerequisite missing: public.site_visits columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'opportunities'
      and column_name in (
        'id', 'company_id', 'client_id', 'client_ref', 'title', 'stage',
        'source', 'assigned_to', 'assignment_version', 'source_metadata',
        'source_thread_key', 'stage_entered_at', 'deleted_at'
      )
    having count(distinct column_name) = 13
  ) then
    raise exception 'public_booking prerequisite missing: public.opportunities columns';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'companies'
      and column_name = 'timezone'
  ) then
    raise exception 'public_booking prerequisite missing: companies.timezone';
  end if;

  -- `website` must remain an accepted coarse source (I16).
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunities_source_check'
      and conrelid = 'public.opportunities'::regclass
      and pg_get_constraintdef(oid) like '%''website''%'
  ) then
    raise exception 'public_booking prerequisite missing: opportunities source website';
  end if;

  if to_regclass('public.site_visit_booking_policies') is not null then
    raise exception 'public_booking prerequisite conflict: site_visit_booking_policies already exists';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'public_booking prerequisite missing: pg_cron';
  end if;
end;
$prerequisites$;


-- ---------------------------------------------------------------------------
-- Existing-object extensions (additive only)
-- ---------------------------------------------------------------------------

-- A lead created by a public booking is assigned by the system, not by a
-- person. The assignment ledger validates its source against a closed list in
-- three places; all three learn one new value and keep every old one.
alter table public.opportunity_assignment_events
  drop constraint opportunity_assignment_events_source_check;
alter table public.opportunity_assignment_events
  add constraint opportunity_assignment_events_source_check check (
    source = any (array[
      'manual',
      'suggestion_accept',
      'manual_create',
      'personal_mailbox',
      'company_mailbox_default',
      'external_intake_default',
      'public_booking_default',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    ])
  );

alter table public.opportunity_assignment_events
  drop constraint opportunity_assignment_events_actor_required;
alter table public.opportunity_assignment_events
  add constraint opportunity_assignment_events_actor_required check (
    actor_user_id is not null
    or source = any (array[
      'personal_mailbox',
      'company_mailbox_default',
      'external_intake_default',
      'public_booking_default',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    ])
  );

-- `change_opportunity_assignment_core` keeps its own copy of the same
-- allowlist as defense in depth, so it learns the value too. This is the
-- live definition verbatim with one line inserted into the system branch —
-- the human branch ('manual', 'suggestion_accept') is untouched.
CREATE OR REPLACE FUNCTION private.change_opportunity_assignment_core(p_opportunity_id uuid, p_expected_assignment_version bigint, p_expected_assigned_to uuid, p_new_assigned_to uuid, p_source text, p_actor_user_id uuid, p_actor_company_id uuid, p_is_system boolean, p_suggestion_id uuid, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_scope text;
  v_event_id uuid;
  v_new_version bigint;
  v_new_notify boolean;
  v_previous_access_after boolean;
begin
  if p_opportunity_id is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
  then
    raise exception 'invalid_assignment_expectation'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'assignment_metadata_must_be_object'
      using errcode = '22023';
  end if;

  if p_is_system is null then
    raise exception 'assignment_principal_kind_required'
      using errcode = '22023';
  elsif p_is_system then
    if p_source not in (
      'personal_mailbox',
      'company_mailbox_default',
      'external_intake_default',
      'public_booking_default',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    ) then
      raise exception 'invalid_system_assignment_source'
        using errcode = '22023';
    end if;
  elsif p_source is null
    or p_source not in ('manual', 'suggestion_accept')
  then
    raise exception 'invalid_human_assignment_source'
      using errcode = '22023';
  end if;

  select opportunity.*
  into v_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
  for update;

  if not found or v_opportunity.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if p_actor_company_id is distinct from v_opportunity.company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_actor_user_id is not null then
    perform 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_opportunity.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
    for share;
    if not found then
      raise exception 'assignment_actor_ineligible'
        using errcode = '42501';
    end if;
  end if;

  if not p_is_system then
    if p_actor_user_id is null then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    v_scope := private.current_user_scope_for('pipeline.assign');
    if v_scope is null
      and private.should_use_pipeline_manage_compat(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.assign'
      )
    then
      v_scope := 'all';
    end if;

    if v_scope is null or v_scope not in ('all', 'assigned') then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    if v_scope = 'assigned'
      and v_opportunity.assigned_to is distinct from p_actor_user_id
    then
      raise exception 'assignment_access_lost'
        using errcode = '42501';
    end if;
  end if;

  if v_opportunity.assignment_version
      is distinct from p_expected_assignment_version
    or v_opportunity.assigned_to is distinct from p_expected_assigned_to
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if v_opportunity.assigned_to is not distinct from p_new_assigned_to then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if not p_is_system and v_scope = 'assigned' then
    if p_new_assigned_to is null then
      raise exception 'assigned_scope_cannot_unassign'
        using errcode = '42501';
    end if;
    if v_opportunity.archived_at is not null
      or v_opportunity.stage in ('won', 'lost', 'discarded')
    then
      raise exception 'assigned_scope_terminal_transfer_forbidden'
        using errcode = '42501';
    end if;
  end if;

  if p_new_assigned_to is not null then
    perform 1
    from public.users target
    where target.id = p_new_assigned_to
      and target.company_id = v_opportunity.company_id
      and target.deleted_at is null
      and coalesce(target.is_active, false)
      and public.has_permission(
        p_new_assigned_to,
        'pipeline.view',
        'assigned'
      )
    for share;
    if not found then
      raise exception 'assignment_target_ineligible'
        using errcode = '22023';
    end if;
  end if;

  if p_source = 'suggestion_accept' then
    if p_suggestion_id is null
      or not exists (
        select 1
        from public.opportunity_assignment_suggestions suggestion
        where suggestion.id = p_suggestion_id
          and suggestion.company_id = v_opportunity.company_id
          and suggestion.opportunity_id = p_opportunity_id
          and suggestion.suggested_user_id = p_new_assigned_to
          and suggestion.resolution_state = 'pending'
      )
    then
      raise exception 'assignment_suggestion_invalid'
        using errcode = '22023';
    end if;
  elsif p_suggestion_id is not null then
    raise exception 'suggestion_id_requires_suggestion_accept'
      using errcode = '22023';
  end if;

  v_new_version := v_opportunity.assignment_version + 1;

  insert into private.opportunity_assignment_write_tokens (
    transaction_id,
    backend_pid,
    opportunity_id,
    operation,
    assigned_to,
    assignment_version
  ) values (
    txid_current(),
    pg_backend_pid(),
    p_opportunity_id,
    'update',
    p_new_assigned_to,
    v_new_version
  );

  update public.opportunities
  set assigned_to = p_new_assigned_to,
      assignment_version = assignment_version + 1,
      updated_at = now()
  where id = p_opportunity_id
  returning assignment_version into v_new_version;

  insert into public.opportunity_assignment_events (
    company_id,
    opportunity_id,
    previous_assignee_id,
    new_assignee_id,
    actor_user_id,
    source,
    suggestion_id,
    assignment_version,
    previous_assignee_snapshot,
    new_assignee_snapshot,
    actor_snapshot,
    metadata
  ) values (
    v_opportunity.company_id,
    p_opportunity_id,
    v_opportunity.assigned_to,
    p_new_assigned_to,
    p_actor_user_id,
    p_source,
    p_suggestion_id,
    v_new_version,
    private.user_assignment_snapshot(v_opportunity.assigned_to),
    private.user_assignment_snapshot(p_new_assigned_to),
    private.user_assignment_snapshot(p_actor_user_id),
    p_metadata
  )
  returning id into v_event_id;

  update public.opportunity_assignment_suggestions
  set resolution_state = case
        when id = p_suggestion_id and p_source = 'suggestion_accept'
          then 'accepted'
        else 'superseded'
      end,
      resolved_at = now(),
      resolved_by = p_actor_user_id,
      resolution_event_id = v_event_id,
      resolution_metadata = jsonb_build_object(
        'assignment_source', p_source,
        'assignment_version', v_new_version
      ),
      updated_at = now()
  where company_id = v_opportunity.company_id
    and opportunity_id = p_opportunity_id
    and resolution_state = 'pending';

  if v_opportunity.assigned_to is not null
    and v_opportunity.assigned_to is distinct from p_new_assigned_to
  then
    v_previous_access_after := exists (
      select 1
      from public.users prior_user
      where prior_user.id = v_opportunity.assigned_to
        and prior_user.company_id = v_opportunity.company_id
        and prior_user.deleted_at is null
        and coalesce(prior_user.is_active, false)
        and (
          public.has_permission(
            v_opportunity.assigned_to,
            'pipeline.view',
            'all'
          )
          or private.should_use_pipeline_manage_compat(
            v_opportunity.assigned_to,
            v_opportunity.company_id,
            'pipeline.view'
          )
        )
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      v_opportunity.assigned_to,
      v_previous_access_after,
      false
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  if p_new_assigned_to is not null
    and p_new_assigned_to is distinct from v_opportunity.assigned_to
  then
    v_new_notify := not (
      not p_is_system
      and p_new_assigned_to = p_actor_user_id
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      p_new_assigned_to,
      true,
      v_new_notify
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'assigned_to', p_new_assigned_to,
    'assignment_version', v_new_version,
    'event_id', v_event_id
  );
end;
$function$;

-- The live definition with one allowlisted source added; nothing else changes.
create or replace function private.change_assignment_system_company_serialized_internal(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_system_source text,
  p_actor_user_id uuid default null::uuid,
  p_suggestion_id uuid default null::uuid,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_system_source is null or p_system_source not in (
    'personal_mailbox',
    'company_mailbox_default',
    'external_intake_default',
    'public_booking_default',
    'deactivation',
    'permission_change',
    'admin_correction',
    'system_repair'
  ) then
    raise exception 'invalid_system_assignment_source'
      using errcode = '22023';
  end if;

  select opportunity.company_id
  into v_company_id
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null
    and not exists (
      select 1
      from public.users actor
      where actor.id = p_actor_user_id
        and actor.company_id = v_company_id
        and actor.deleted_at is null
        and coalesce(actor.is_active, false)
    )
  then
    raise exception 'assignment_actor_ineligible'
      using errcode = '22023';
  end if;

  return private.change_opportunity_assignment_core(
    p_opportunity_id,
    p_expected_assignment_version,
    p_expected_assigned_to,
    p_new_assigned_to,
    p_system_source,
    p_actor_user_id,
    v_company_id,
    true,
    p_suggestion_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- Validators
-- ---------------------------------------------------------------------------

-- Weekly availability windows: at most 14 entries, each `{weekday, start,
-- end}` with weekday 0 (Sunday) through 6, wall-clock `HH:MM` bounds in
-- ascending order, and no two windows overlapping within one weekday. Pure
-- structural inspection, so it is honestly immutable and usable in a CHECK.
create or replace function private.booking_windows_valid(
  p_windows jsonb
) returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_entry jsonb;
  v_count integer;
  v_overlaps integer;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    return false;
  end if;

  v_count := jsonb_array_length(p_windows);
  if v_count > 14 then
    return false;
  end if;
  if v_count = 0 then
    return true;
  end if;

  for v_entry in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(v_entry) <> 'object' then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(v_entry)) <> 3
       or not (v_entry ? 'weekday' and v_entry ? 'start' and v_entry ? 'end') then
      return false;
    end if;
    if jsonb_typeof(v_entry -> 'weekday') <> 'number'
       or (v_entry ->> 'weekday') !~ '^[0-6]$' then
      return false;
    end if;
    if jsonb_typeof(v_entry -> 'start') <> 'string'
       or jsonb_typeof(v_entry -> 'end') <> 'string'
       or (v_entry ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_entry ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_entry ->> 'start') >= (v_entry ->> 'end') then
      return false;
    end if;
  end loop;

  -- No two windows on the same weekday may overlap. Half-open comparison:
  -- touching windows (08:00-12:00 and 12:00-16:00) are allowed.
  select count(*)
  into v_overlaps
  from jsonb_array_elements(p_windows) with ordinality as a(value, ord)
  join jsonb_array_elements(p_windows) with ordinality as b(value, ord)
    on b.ord > a.ord
   and (b.value ->> 'weekday') = (a.value ->> 'weekday')
   and (a.value ->> 'start') < (b.value ->> 'end')
   and (b.value ->> 'start') < (a.value ->> 'end');

  return v_overlaps = 0;
end;
$function$;

revoke all on function private.booking_windows_valid(jsonb)
  from public, anon, authenticated, service_role;

-- The website's own questions, carried verbatim onto the lead. Bounded the
-- same way the intake ledger bounds its ordered answers: an array of at most
-- 100 objects, every value a scalar, and the whole payload small enough that
-- no page can use it as storage.
create or replace function private.booking_answers_valid(
  p_answers jsonb
) returns boolean
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_entry jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_answers) > 100 then
    return false;
  end if;
  if length(p_answers::text) > 16384 then
    return false;
  end if;

  for v_entry in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(v_entry) <> 'object' then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(v_entry)) > 8 then
      return false;
    end if;
    if exists (
      select 1
      from jsonb_each(v_entry) as field(key, value)
      where jsonb_typeof(field.value) in ('object', 'array')
         or length(field.key) > 120
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

revoke all on function private.booking_answers_valid(jsonb)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Company booking policy (design §4.1, D9 + D10)
-- ---------------------------------------------------------------------------

create table if not exists public.site_visit_booking_policies (
  company_id uuid primary key
    references public.companies (id) on delete cascade,
  mode text not null default 'off'
    constraint site_visit_booking_policies_mode check (
      mode in ('off', 'request', 'instant')
    ),
  windows jsonb not null default '[]'::jsonb
    constraint site_visit_booking_policies_windows check (
      private.booking_windows_valid(windows)
    ),
  timezone text not null
    constraint site_visit_booking_policies_timezone_bounded check (
      length(timezone) between 1 and 100
    ),
  min_notice_hours integer not null default 48
    constraint site_visit_booking_policies_min_notice check (
      min_notice_hours between 0 and 720
    ),
  horizon_days integer not null default 21
    constraint site_visit_booking_policies_horizon check (
      horizon_days between 1 and 120
    ),
  visit_duration_minutes integer not null default 60
    constraint site_visit_booking_policies_duration check (
      visit_duration_minutes between 15 and 480
    ),
  slot_granularity_minutes integer not null default 60
    constraint site_visit_booking_policies_granularity check (
      slot_granularity_minutes in (15, 30, 60, 120)
    ),
  max_bookings_per_day integer
    constraint site_visit_booking_policies_daily_cap check (
      max_bookings_per_day is null or max_bookings_per_day >= 1
    ),
  default_owner_id uuid
    references public.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

comment on table public.site_visit_booking_policies is
  'Per-company public booking configuration: whether customers may book at all and how firmly (D9), and the business-defined availability windows OPS expands into offered slots (D10). An absent row means mode=off.';

-- A timezone must be a real IANA zone and an owner must belong to the company.
-- Neither is expressible in a CHECK, so both are enforced on write; the
-- runtime re-checks owner eligibility at booking time because a person can
-- lose it after the policy was saved.
create or replace function private.booking_policy_validate()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.timezone
  ) then
    raise exception 'booking_policy_timezone_invalid' using errcode = '22023';
  end if;

  if new.default_owner_id is not null and not exists (
    select 1
    from public.users owner
    where owner.id = new.default_owner_id
      and owner.company_id = new.company_id
      and owner.deleted_at is null
  ) then
    raise exception 'booking_policy_owner_not_in_company' using errcode = '22023';
  end if;

  return new;
end;
$function$;

revoke all on function private.booking_policy_validate()
  from public, anon, authenticated, service_role;

create trigger site_visit_booking_policies_validate
  before insert or update on public.site_visit_booking_policies
  for each row
  execute function private.booking_policy_validate();

create trigger site_visit_booking_policies_touch_updated_at
  before update on public.site_visit_booking_policies
  for each row
  execute function private.customer_touch_updated_at();

alter table public.site_visit_booking_policies enable row level security;

-- The house pair, targeting role `public` because the app runs as anon: one
-- PERMISSIVE tenant boundary, and RESTRICTIVE write policies that additionally
-- demand the settings permission.
create policy company_isolation on public.site_visit_booking_policies
  for all
  to public
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

create policy role_scope_insert on public.site_visit_booking_policies
  as restrictive
  for insert
  to public
  with check (
    (select private.current_user_has_permission('settings.company', 'own'))
  );

create policy role_scope_update on public.site_visit_booking_policies
  as restrictive
  for update
  to public
  using (
    (select private.current_user_has_permission('settings.company', 'own'))
  )
  with check (
    (select private.current_user_has_permission('settings.company', 'own'))
  );

-- Mirrors the grants on `site_visit_types`, the closest shipped per-company
-- settings table. The schema's default privileges hand every new public table
-- to anon and authenticated wholesale, including TRUNCATE — which bypasses RLS
-- entirely — so take it all back first and hand back only the three verbs a
-- settings screen needs. Turning booking off is `mode = 'off'`, never a
-- missing row, so the app roles get no DELETE.
revoke all on table public.site_visit_booking_policies from anon, authenticated;
grant select, insert, update on table public.site_visit_booking_policies
  to anon, authenticated;
grant select, insert, update, delete on table public.site_visit_booking_policies
  to service_role;

create index if not exists site_visit_booking_policies_owner_idx
  on public.site_visit_booking_policies (default_owner_id)
  where default_owner_id is not null;


-- ---------------------------------------------------------------------------
-- Guest intents and claims (design §4.2, §4.3)
-- ---------------------------------------------------------------------------

create table if not exists private.guest_booking_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete cascade,
  integration_id uuid not null
    references private.customer_integrations (id) on delete cascade,
  state text not null default 'held'
    constraint guest_booking_intents_state check (
      state in ('held', 'verified', 'confirmed', 'submitted', 'expired', 'cancelled')
    ),
  slot_start_at timestamptz not null,
  duration_minutes integer not null
    constraint guest_booking_intents_duration check (
      duration_minutes between 15 and 480
    ),
  hold_expires_at timestamptz not null,
  contact_name text
    constraint guest_booking_intents_name_bounded check (
      contact_name is null or length(contact_name) between 1 and 200
    ),
  -- Keyed HMAC of the normalized email, exactly as the P1 OTP ledger stores
  -- it. The plaintext reaches the confirm RPC as an argument and is never
  -- stored here.
  contact_email_digest text
    constraint guest_booking_intents_email_digest_shape check (
      contact_email_digest is null
      or contact_email_digest ~ '^[1-9][0-9]{0,4}:[0-9a-f]{64}$'
    ),
  -- Broker-owned ciphertext so the confirmation and manage mails can be sent
  -- later. Opaque to SQL: nothing in this migration reads or interprets it.
  contact_email_encrypted text
    constraint guest_booking_intents_email_ciphertext_bounded check (
      contact_email_encrypted is null
      or length(contact_email_encrypted) between 1 and 4096
    ),
  -- Evidence only. An unverified phone is never a match key (I1).
  contact_phone_raw text
    constraint guest_booking_intents_phone_bounded check (
      contact_phone_raw is null or length(contact_phone_raw) between 1 and 40
    ),
  verified_channel text
    constraint guest_booking_intents_channel check (
      verified_channel is null or verified_channel in ('email', 'phone')
    ),
  verified_at timestamptz,
  answers jsonb not null default '[]'::jsonb
    constraint guest_booking_intents_answers check (
      private.booking_answers_valid(answers)
    ),
  resolved_client_id uuid
    references public.clients (id) on delete set null,
  resolved_opportunity_id uuid
    references public.opportunities (id) on delete set null,
  resolved_site_visit_id uuid
    references public.site_visits (id) on delete set null,
  network_fingerprint text not null
    constraint guest_booking_intents_fingerprint_shape check (
      network_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  closed_reason text
    constraint guest_booking_intents_closed_reason_bounded check (
      closed_reason is null or length(closed_reason) between 1 and 200
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint guest_booking_intents_verified_shape check (
    (verified_channel is null) = (verified_at is null)
  ),
  -- A verified intent has proved a channel; a confirmed one carries the lead
  -- it produced, and only the instant branch carries a visit (I14).
  constraint guest_booking_intents_state_evidence check (
    (state not in ('verified', 'confirmed', 'submitted') or verified_at is not null)
    and (state not in ('confirmed', 'submitted')
         or (resolved_client_id is not null and resolved_opportunity_id is not null))
    and (state <> 'submitted' or resolved_site_visit_id is null)
    and (state in ('confirmed', 'cancelled') or resolved_site_visit_id is null)
  )
);

comment on table private.guest_booking_intents is
  'One public booking attempt: the slot it holds, the channel it proved, and the client, lead and visit it resolved to. `submitted` is the request-mode terminal, which deliberately carries no site visit (I14).';

-- Live holds are the hot read: availability subtracts them, the caps count
-- them, and the sweeper expires them.
create index if not exists guest_booking_intents_live_holds_idx
  on private.guest_booking_intents (company_id, slot_start_at)
  where state in ('held', 'verified');
create index if not exists guest_booking_intents_fingerprint_idx
  on private.guest_booking_intents (network_fingerprint)
  where state = 'held';
create index if not exists guest_booking_intents_expiry_idx
  on private.guest_booking_intents (hold_expires_at)
  where state in ('held', 'verified');
create index if not exists guest_booking_intents_opportunity_idx
  on private.guest_booking_intents (resolved_opportunity_id)
  where resolved_opportunity_id is not null;
create index if not exists guest_booking_intents_site_visit_idx
  on private.guest_booking_intents (resolved_site_visit_id)
  where resolved_site_visit_id is not null;
create index if not exists guest_booking_intents_client_idx
  on private.guest_booking_intents (resolved_client_id)
  where resolved_client_id is not null;
create index if not exists guest_booking_intents_integration_idx
  on private.guest_booking_intents (integration_id);
create index if not exists guest_booking_intents_claimable_idx
  on private.guest_booking_intents (company_id, contact_email_digest)
  where state in ('confirmed', 'submitted');

alter table private.guest_booking_intents enable row level security;
revoke all on table private.guest_booking_intents
  from public, anon, authenticated, service_role;

create trigger guest_booking_intents_touch_updated_at
  before update on private.guest_booking_intents
  for each row
  execute function private.customer_touch_updated_at();

create table if not exists private.customer_booking_claims (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null
    references private.guest_booking_intents (id) on delete cascade,
  identity_id uuid not null
    references private.customer_identities (id) on delete cascade,
  membership_id uuid
    references private.company_client_memberships (id) on delete set null,
  claimed_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint customer_booking_claims_intent_key unique (intent_id)
);

comment on table private.customer_booking_claims is
  'Exactly-once claim of a guest booking by a customer identity. A claim requires the intent''s verified channel to be verified on the claiming identity, and attaches that identity to the client the booking already resolved — it never creates one (P1 D6).';

create index if not exists customer_booking_claims_identity_idx
  on private.customer_booking_claims (identity_id);

alter table private.customer_booking_claims enable row level security;
revoke all on table private.customer_booking_claims
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Slot derivation — one definition, shared by availability and confirmation
-- ---------------------------------------------------------------------------

-- Expands the policy's weekly windows across a local date range. The caller
-- gets UTC instants; no crew row is ever read.
--
-- DST: a local wall-clock time inside a spring-forward gap does not exist.
-- Postgres would silently shift it forward, which would offer a slot the
-- business never declared, so any start that does not survive a round trip
-- through the policy timezone is dropped. A fall-back hour is ambiguous
-- rather than absent; Postgres resolves it deterministically and the round
-- trip holds, so exactly one slot is produced.
create or replace function private.booking_policy_slot_starts(
  p_policy public.site_visit_booking_policies,
  p_from date,
  p_to date
) returns table (slot_start_at timestamptz)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  with bounds as (
    select
      greatest(p_from, date '0001-01-01') as from_date,
      least(p_to, p_from + 400) as to_date
  ),
  days as (
    select day::date as local_date
    from bounds, generate_series(bounds.from_date, bounds.to_date, interval '1 day') as day
  ),
  window_rows as (
    select
      (entry ->> 'weekday')::integer as weekday,
      (entry ->> 'start')::time as window_start,
      (entry ->> 'end')::time as window_end
    from jsonb_array_elements(p_policy.windows) as entry
  ),
  candidates as (
    select
      (days.local_date
        + window_rows.window_start
        + make_interval(mins => step.offset_minutes)) as local_ts
    from days
    join window_rows
      on window_rows.weekday = extract(dow from days.local_date)::integer
    cross join lateral (
      select generate_series(
        0,
        greatest(
          0,
          (extract(epoch from (window_rows.window_end - window_rows.window_start))::integer / 60)
            - p_policy.visit_duration_minutes
        ),
        p_policy.slot_granularity_minutes
      ) as offset_minutes
    ) as step
    where extract(epoch from (window_rows.window_end - window_rows.window_start))::integer / 60
          >= p_policy.visit_duration_minutes
  )
  select (candidates.local_ts at time zone p_policy.timezone) as slot_start_at
  from candidates
  where ((candidates.local_ts at time zone p_policy.timezone)
          at time zone p_policy.timezone) = candidates.local_ts
  order by 1;
$function$;

revoke all on function private.booking_policy_slot_starts(
  public.site_visit_booking_policies, date, date
) from public, anon, authenticated, service_role;

-- The single truth for "is this instant bookable right now". Availability
-- filters a batch through it; the confirm re-asks it under the company lock,
-- so a replayed descriptor can never book what policy now forbids (I12).
--
-- `p_ignore_intent_id` lets an intent ignore its own live hold when it
-- confirms, and lets a reschedule ignore the visit it is moving.
create or replace function private.booking_slot_is_open(
  p_policy public.site_visit_booking_policies,
  p_slot_start_at timestamptz,
  p_ignore_intent_id uuid default null,
  p_ignore_site_visit_id uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_end timestamptz := p_slot_start_at + make_interval(mins => p_policy.visit_duration_minutes);
  v_local_date date := (p_slot_start_at at time zone p_policy.timezone)::date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_used integer;
begin
  if p_policy.mode = 'off' then
    return false;
  end if;

  -- The instant must be one the policy actually offers, inside notice and
  -- horizon. Deriving it from the same expander the availability read uses
  -- means the two can never disagree.
  if not exists (
    select 1
    from private.booking_policy_slot_starts(
      p_policy,
      (v_local_date - 1),
      (v_local_date + 1)
    ) as candidate
    where candidate.slot_start_at = p_slot_start_at
  ) then
    return false;
  end if;

  if p_slot_start_at < v_now + make_interval(hours => p_policy.min_notice_hours) then
    return false;
  end if;
  if p_slot_start_at >= ((v_now at time zone p_policy.timezone)::date
                          + p_policy.horizon_days + 1)::timestamp
                         at time zone p_policy.timezone then
    return false;
  end if;

  -- A live booked visit anywhere in the company blocks the slot. Company-wide
  -- on purpose: the public is never told anything about crew (I11).
  if exists (
    select 1
    from public.site_visits visit
    where visit.company_id = p_policy.company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status = 'scheduled'
      and (p_ignore_site_visit_id is null or visit.id <> p_ignore_site_visit_id)
      and visit.scheduled_at < v_end
      and (visit.scheduled_at + make_interval(mins => visit.duration_minutes)) > p_slot_start_at
  ) then
    return false;
  end if;

  -- A live hold blocks it too, and an expired one never does (I13).
  if exists (
    select 1
    from private.guest_booking_intents intent
    where intent.company_id = p_policy.company_id
      and intent.state in ('held', 'verified')
      and intent.hold_expires_at > v_now
      and (p_ignore_intent_id is null or intent.id <> p_ignore_intent_id)
      and intent.slot_start_at < v_end
      and (intent.slot_start_at + make_interval(mins => intent.duration_minutes)) > p_slot_start_at
  ) then
    return false;
  end if;

  if p_policy.max_bookings_per_day is not null then
    v_day_start := (v_local_date::timestamp) at time zone p_policy.timezone;
    v_day_end := ((v_local_date + 1)::timestamp) at time zone p_policy.timezone;

    select
      (
        select count(*)
        from public.site_visits visit
        where visit.company_id = p_policy.company_id::text
          and visit.deleted_at is null
          and visit.booked_at is not null
          and visit.status = 'scheduled'
          and (p_ignore_site_visit_id is null or visit.id <> p_ignore_site_visit_id)
          and visit.scheduled_at >= v_day_start
          and visit.scheduled_at < v_day_end
      )
      +
      (
        select count(*)
        from private.guest_booking_intents intent
        where intent.company_id = p_policy.company_id
          and intent.state in ('held', 'verified')
          and intent.hold_expires_at > v_now
          and (p_ignore_intent_id is null or intent.id <> p_ignore_intent_id)
          and intent.slot_start_at >= v_day_start
          and intent.slot_start_at < v_day_end
      )
    into v_used;

    if v_used >= p_policy.max_bookings_per_day then
      return false;
    end if;
  end if;

  return true;
end;
$function$;

revoke all on function private.booking_slot_is_open(
  public.site_visit_booking_policies, timestamptz, uuid, uuid
) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Hold expiry (I13)
-- ---------------------------------------------------------------------------

create or replace function private.booking_expire_stale_holds(
  p_company_id uuid default null
) returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_expired integer;
begin
  with expired as (
    update private.guest_booking_intents intent
    set state = 'expired',
        closed_reason = coalesce(intent.closed_reason, 'hold_expired')
    where intent.state in ('held', 'verified')
      and intent.hold_expires_at <= v_now
      and (p_company_id is null or intent.company_id = p_company_id)
    returning 1
  )
  select count(*)::integer into v_expired from expired;

  return coalesce(v_expired, 0);
end;
$function$;

revoke all on function private.booking_expire_stale_holds(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guest client resolution (P1 §5.3 with guest rules; I1, D6)
-- ---------------------------------------------------------------------------

-- Matching consumes the verified email only. Zero or many matches create a
-- fresh client so the lead is never orphaned; many additionally opens the
-- existing duplicate review and tells staff. No membership is created here —
-- a guest has no identity yet, and a later sign-in claims the booking.
create or replace function private.booking_resolve_guest_client(
  p_company_id uuid,
  p_email text,
  p_contact_name text,
  p_contact_phone text
) returns table (
  resolved_client_id uuid,
  resolved_outcome text
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_email text := private.agent_normalize_discovery_email(p_email);
  v_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_candidate_client_ids uuid[];
  v_candidate_client_id uuid;
  v_client_id uuid;
  v_outcome text;
  v_staff_user_id uuid;
begin
  if p_company_id is null or v_email is null then
    raise exception 'booking_guest_identity_required' using errcode = '22023';
  end if;

  -- Same lock key the intake and P1 resolvers take.
  perform pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || v_email));

  select array_agg(distinct matched.parent_client_id)
  into v_candidate_client_ids
  from (
    select client.id as parent_client_id
    from public.clients client
    where client.company_id = p_company_id
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and private.agent_normalize_discovery_email(client.email) = v_email
    union all
    select sub_client.client_id as parent_client_id
    from public.sub_clients sub_client
    join public.clients client
      on client.id = sub_client.client_id
     and client.company_id = sub_client.company_id
    where sub_client.company_id = p_company_id
      and sub_client.deleted_at is null
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and private.agent_normalize_discovery_email(sub_client.email) = v_email
  ) matched;

  if cardinality(coalesce(v_candidate_client_ids, array[]::uuid[])) = 1 then
    return query select v_candidate_client_ids[1], 'matched'::text;
    return;
  end if;

  insert into public.clients (company_id, name, email, phone_number)
  values (
    p_company_id,
    coalesce(v_name, v_email),
    v_email,
    nullif(btrim(coalesce(p_contact_phone, '')), '')
  )
  returning id into v_client_id;

  if cardinality(coalesce(v_candidate_client_ids, array[]::uuid[])) = 0 then
    return query select v_client_id, 'created'::text;
    return;
  end if;

  v_outcome := 'created_possible_duplicate';

  foreach v_candidate_client_id in array v_candidate_client_ids loop
    insert into public.duplicate_reviews (
      company_id, entity_type, entity_a_id, entity_b_id,
      confidence, signals, status
    ) values (
      p_company_id,
      'client',
      least(v_client_id, v_candidate_client_id),
      greatest(v_client_id, v_candidate_client_id),
      'high',
      jsonb_build_array(jsonb_build_object('type', 'same_email', 'detail', v_email)),
      'pending'
    )
    on conflict (company_id, entity_type, entity_a_id, entity_b_id) do nothing;
  end loop;

  for v_staff_user_id in
    select recipient
    from public.users_with_permission(p_company_id, 'pipeline.manage', 'all') recipient
  loop
    perform public.create_notification_if_new_with_identity(
      v_staff_user_id,
      p_company_id,
      'duplicates_found',
      'Potential duplicates found',
      'A booking came in on an email that is on more than one client record. Review and merge.',
      true,
      null,
      'Review',
      null,
      null,
      'customer_identity:possible_duplicate:' || v_client_id::text
    );
  end loop;

  return query select v_client_id, v_outcome;
end;
$function$;

revoke all on function private.booking_resolve_guest_client(uuid, text, text, text)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Staff notification for a public booking
-- ---------------------------------------------------------------------------

-- The owner hears about their own booking; with no owner, everyone who can
-- manage the pipeline does. `schedule_change` is the shipped rail type.
create or replace function private.booking_notify_staff(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_owner_user_id uuid,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_persistent boolean
) returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_action_url text := '/pipeline?opportunityId=' || p_opportunity_id::text;
  v_recipient uuid;
  v_sent integer := 0;
begin
  if p_owner_user_id is not null then
    perform public.create_notification_if_new_with_identity(
      p_owner_user_id, p_company_id, 'schedule_change',
      p_title, p_body, p_persistent, v_action_url, 'Open lead',
      null, 'lead', p_dedupe_key
    );
    return 1;
  end if;

  for v_recipient in
    select recipient
    from public.users_with_permission(p_company_id, 'pipeline.manage', 'all') recipient
  loop
    perform public.create_notification_if_new_with_identity(
      v_recipient, p_company_id, 'schedule_change',
      p_title, p_body, p_persistent, v_action_url, 'Open lead',
      null, 'lead', p_dedupe_key
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke all on function private.booking_notify_staff(uuid, uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- book_site_visit_as_system — the actorless twin (I10, I11)
-- ---------------------------------------------------------------------------

-- Mirrors every guard of the staff-actor `public.book_site_visit`: the
-- opportunity row lock as the booking mutex, the company match, the past-time
-- rule, the duration and reminder ranges, assignee validation, the
-- one-open-booking rule, the same `site_visits` insert shape, the same
-- `site_visit_scheduled` activity, the `activity_id` back-write and the
-- `new_lead → qualifying` nudge.
--
-- It differs in exactly three ways, all forced by there being no current user:
-- the actor arrives as a parameter instead of from the JWT, the assignees come
-- from the caller's policy-derived list rather than caller input on a public
-- path (I11), and there is no `current_user_can_edit_site_visit` gate because
-- there is no current user — the service-role gate and the explicit company
-- argument stand in its place. The staff RPC is untouched.
create or replace function public.book_site_visit_as_system(
  p_opportunity_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 60,
  p_assignee_ids text[] default null,
  p_reminder_lead_minutes integer default null,
  p_actor_user_id uuid default null,
  p_source text default 'public_booking'
) returns uuid
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_duration int := coalesce(p_duration_minutes, 60);
  v_raw_assignees text[];
  v_assignees text[];
  v_member_count int;
  v_visit_id uuid;
  v_activity_id uuid;
  v_created_by text;
  v_subject text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_opportunity_id is null then
    raise exception 'opportunity_id_required' using errcode = '22004';
  end if;
  if p_scheduled_at is null then
    raise exception 'scheduled_at_required' using errcode = '22004';
  end if;
  if p_source is null or p_source not in ('public_booking', 'booking_request_accepted') then
    raise exception 'site_visit_system_source_invalid' using errcode = '22023';
  end if;

  -- The opportunity row lock is the booking mutex, exactly as in the staff
  -- verb: concurrent bookings on one lead serialize here, so the
  -- one-open-booking check below cannot race.
  select * into v_opp
    from public.opportunities
   where id = p_opportunity_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null and not exists (
    select 1 from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_opp.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    raise exception 'site_visit_actor_ineligible' using errcode = '22023';
  end if;

  if p_scheduled_at <= now() - interval '5 minutes' then
    raise exception 'site_visit_time_in_past' using errcode = '22023';
  end if;
  if v_duration < 15 or v_duration > 480 then
    raise exception 'site_visit_duration_out_of_range' using errcode = '22023';
  end if;
  if p_reminder_lead_minutes is not null
     and (p_reminder_lead_minutes < 0 or p_reminder_lead_minutes > 1440) then
    raise exception 'site_visit_reminder_out_of_range' using errcode = '22023';
  end if;

  -- An empty assignee list is legitimate here and means the unassigned queue.
  -- There is no actor to fall back to, so nothing is invented.
  v_raw_assignees := nullif(p_assignee_ids, '{}'::text[]);
  if v_raw_assignees is null then
    v_assignees := '{}'::text[];
  else
    if exists (
      select 1 from unnest(v_raw_assignees) a
       where a is null or private.try_parse_uuid(a) is null
    ) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
    select array_agg(distinct a order by a) into v_assignees from unnest(v_raw_assignees) a;
    select count(*) into v_member_count
      from public.users u
     where u.id::text = any(v_assignees)
       and u.company_id = v_opp.company_id
       and u.deleted_at is null;
    if v_member_count <> array_length(v_assignees, 1) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.site_visits sv
     where sv.opportunity_id = p_opportunity_id
       and sv.booked_at is not null
       and sv.deleted_at is null
       and sv.status = 'scheduled'
  ) then
    raise exception 'site_visit_already_booked' using errcode = '55000';
  end if;

  -- `created_by` is text NOT NULL with no foreign key. A public booking has no
  -- staff creator, so the resolved owner records it when there is one and the
  -- all-zeros UUID does otherwise: parseable for the scope helpers that cast
  -- it, resolving to no user.
  v_created_by := coalesce(
    p_actor_user_id::text,
    (v_assignees)[1],
    '00000000-0000-0000-0000-000000000000'
  );

  insert into public.site_visits (
    company_id, opportunity_id, client_id, client_ref,
    scheduled_at, duration_minutes, assignee_ids, status,
    booked_at, reminder_lead_minutes, created_by
  ) values (
    v_opp.company_id::text,
    p_opportunity_id,
    v_opp.client_id::text,
    v_opp.client_id,
    p_scheduled_at,
    v_duration,
    v_assignees,
    'scheduled',
    now(),
    p_reminder_lead_minutes,
    v_created_by
  ) returning id into v_visit_id;

  v_subject := case
    when p_source = 'booking_request_accepted' then 'Site visit confirmed'
    else 'Site visit booked online'
  end;

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_opp.company_id, p_opportunity_id, v_opp.client_id,
    'site_visit_scheduled', v_subject,
    to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_duration, p_actor_user_id, '{}'::text[], true, v_visit_id
  ) returning id into v_activity_id;

  update public.site_visits set activity_id = v_activity_id where id = v_visit_id;

  if v_opp.stage = 'new_lead' then
    perform public.move_opportunity_stage(p_opportunity_id, 'qualifying', p_actor_user_id);
  end if;

  return v_visit_id;
end;
$function$;

revoke all on function public.book_site_visit_as_system(
  uuid, timestamptz, integer, text[], integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.book_site_visit_as_system(
  uuid, timestamptz, integer, text[], integer, uuid, text
) to service_role;


-- ---------------------------------------------------------------------------
-- Availability (design §5)
-- ---------------------------------------------------------------------------

-- Everything the hosted booking page may know about a company's schedule:
-- whether it takes bookings, in which timezone, and how long a visit is. No
-- counts, no crew, no internal identifiers.
create or replace function public.read_public_booking_policy_as_system(
  p_company_id uuid
) returns table (
  mode text,
  timezone text,
  visit_duration_minutes integer,
  min_notice_hours integer,
  horizon_days integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null then
    raise exception 'booking_company_required' using errcode = '22023';
  end if;

  return query
  select
    policy.mode,
    policy.timezone,
    policy.visit_duration_minutes,
    policy.min_notice_hours,
    policy.horizon_days
  from public.site_visit_booking_policies policy
  join public.companies company
    on company.id = policy.company_id
   and company.deleted_at is null
  where policy.company_id = p_company_id
    and policy.mode <> 'off';
end;
$function$;

revoke all on function public.read_public_booking_policy_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.read_public_booking_policy_as_system(uuid)
  to service_role;

-- Expands the policy across the requested local dates and drops everything a
-- customer may not have: inside the notice period, beyond the horizon,
-- colliding with a live booked visit or a live hold, or on a day already at
-- its cap. Returns nothing at all when the company does not take bookings.
create or replace function public.read_public_availability_as_system(
  p_company_id uuid,
  p_from date,
  p_to date
) returns table (slot_start_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_policy public.site_visit_booking_policies%rowtype;
  v_today date;
  v_from date;
  v_to date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null or p_from is null or p_to is null then
    raise exception 'booking_availability_range_required' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'booking_availability_range_invalid' using errcode = '22023';
  end if;

  select policy.* into v_policy
  from public.site_visit_booking_policies policy
  join public.companies company
    on company.id = policy.company_id
   and company.deleted_at is null
  where policy.company_id = p_company_id;

  if not found or v_policy.mode = 'off' then
    return;
  end if;

  -- Clamp the requested range to what policy could ever offer, so a wide
  -- request cannot turn into a wide scan.
  v_today := (statement_timestamp() at time zone v_policy.timezone)::date;
  v_from := greatest(p_from, v_today);
  v_to := least(p_to, v_today + v_policy.horizon_days);
  if v_to < v_from then
    return;
  end if;

  return query
  select candidate.slot_start_at
  from private.booking_policy_slot_starts(v_policy, v_from, v_to) as candidate
  where private.booking_slot_is_open(v_policy, candidate.slot_start_at)
  order by candidate.slot_start_at;
end;
$function$;

revoke all on function public.read_public_availability_as_system(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.read_public_availability_as_system(uuid, date, date)
  to service_role;


-- ---------------------------------------------------------------------------
-- Holds (I13)
-- ---------------------------------------------------------------------------

-- A refusal is shaped exactly like a success minus the intent, so the broker
-- cannot leak whether a slot exists, is taken, or the caller is rate-limited
-- (I5). Caps: 5-minute hold, at most 3 live unverified holds per network
-- fingerprint and 10 per company.
create or replace function public.hold_booking_slot_as_system(
  p_company_id uuid,
  p_integration_id uuid,
  p_slot_start_at timestamptz,
  p_network_fingerprint text
) returns table (
  intent_id uuid,
  hold_expires_at timestamptz,
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_policy public.site_visit_booking_policies%rowtype;
  v_expires timestamptz;
  v_intent_id uuid;
  v_fingerprint_holds integer;
  v_company_holds integer;
  v_next_free timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null or p_integration_id is null or p_slot_start_at is null then
    raise exception 'booking_hold_input_invalid' using errcode = '22023';
  end if;
  if p_network_fingerprint is null or p_network_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'booking_network_fingerprint_invalid' using errcode = '22023';
  end if;

  -- Serialize per company so two holds cannot both pass the caps or claim the
  -- same slot.
  perform pg_advisory_xact_lock(hashtext('public_booking:' || p_company_id::text));

  perform private.booking_expire_stale_holds(p_company_id);

  select policy.* into v_policy
  from public.site_visit_booking_policies policy
  join public.companies company
    on company.id = policy.company_id
   and company.deleted_at is null
  where policy.company_id = p_company_id;

  if not found or v_policy.mode = 'off' then
    return query select null::uuid, null::timestamptz, false, 60;
    return;
  end if;

  if not exists (
    select 1
    from private.customer_integrations integration
    where integration.id = p_integration_id
      and integration.company_id = p_company_id
      and integration.status = 'active'
      and integration.disabled_at is null
  ) then
    return query select null::uuid, null::timestamptz, false, 60;
    return;
  end if;

  select count(*) into v_fingerprint_holds
  from private.guest_booking_intents intent
  where intent.network_fingerprint = p_network_fingerprint
    and intent.state = 'held'
    and intent.hold_expires_at > v_now;

  if v_fingerprint_holds >= 3 then
    select min(intent.hold_expires_at) into v_next_free
    from private.guest_booking_intents intent
    where intent.network_fingerprint = p_network_fingerprint
      and intent.state = 'held'
      and intent.hold_expires_at > v_now;
    return query select
      null::uuid,
      null::timestamptz,
      false,
      greatest(1, ceil(extract(epoch from (v_next_free - v_now)))::integer);
    return;
  end if;

  select count(*) into v_company_holds
  from private.guest_booking_intents intent
  where intent.company_id = p_company_id
    and intent.state = 'held'
    and intent.hold_expires_at > v_now;

  if v_company_holds >= 10 then
    select min(intent.hold_expires_at) into v_next_free
    from private.guest_booking_intents intent
    where intent.company_id = p_company_id
      and intent.state = 'held'
      and intent.hold_expires_at > v_now;
    return query select
      null::uuid,
      null::timestamptz,
      false,
      greatest(1, ceil(extract(epoch from (v_next_free - v_now)))::integer);
    return;
  end if;

  if not private.booking_slot_is_open(v_policy, p_slot_start_at) then
    return query select null::uuid, null::timestamptz, false, 60;
    return;
  end if;

  v_expires := v_now + interval '5 minutes';

  insert into private.guest_booking_intents (
    company_id, integration_id, state, slot_start_at, duration_minutes,
    hold_expires_at, network_fingerprint
  ) values (
    p_company_id, p_integration_id, 'held', p_slot_start_at,
    v_policy.visit_duration_minutes, v_expires, p_network_fingerprint
  ) returning id into v_intent_id;

  return query select v_intent_id, v_expires, true, null::integer;
end;
$function$;

revoke all on function public.hold_booking_slot_as_system(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.hold_booking_slot_as_system(uuid, uuid, timestamptz, text)
  to service_role;

-- Records what the customer typed between the hold and the code. Nothing here
-- is proof of anything; the intent stays `held` until a channel is verified.
create or replace function public.record_guest_booking_contact_as_system(
  p_intent_id uuid,
  p_contact_name text,
  p_contact_email_digest text,
  p_contact_email_encrypted text,
  p_contact_phone text,
  p_answers jsonb default '[]'::jsonb
) returns table (
  intent_id uuid,
  hold_expires_at timestamptz,
  accepted boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_intent private.guest_booking_intents%rowtype;
  v_hold_expires_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null then
    raise exception 'booking_intent_required' using errcode = '22023';
  end if;
  if p_contact_email_digest is null
     or p_contact_email_digest !~ '^[1-9][0-9]{0,4}:[0-9a-f]{64}$' then
    raise exception 'booking_email_digest_invalid' using errcode = '22023';
  end if;
  if not private.booking_answers_valid(coalesce(p_answers, '[]'::jsonb)) then
    raise exception 'booking_answers_invalid' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found or v_intent.state <> 'held' or v_intent.hold_expires_at <= v_now then
    return query select p_intent_id, null::timestamptz, false;
    return;
  end if;

  update private.guest_booking_intents intent
  set contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
      contact_email_digest = p_contact_email_digest,
      contact_email_encrypted = nullif(btrim(coalesce(p_contact_email_encrypted, '')), ''),
      contact_phone_raw = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      answers = coalesce(p_answers, '[]'::jsonb)
  where intent.id = p_intent_id
  returning intent.hold_expires_at into v_hold_expires_at;

  return query select p_intent_id, v_hold_expires_at, true;
end;
$function$;

revoke all on function public.record_guest_booking_contact_as_system(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_guest_booking_contact_as_system(
  uuid, text, text, text, text, jsonb
) to service_role;


-- ---------------------------------------------------------------------------
-- The atomic confirm (design §5; I12, I14, I16)
-- ---------------------------------------------------------------------------

-- Under the company advisory lock: re-validate the slot against live policy,
-- live bookings, live holds and the per-day cap; resolve the client by the
-- verified email only; create the lead with `source='website'` and the
-- integration's provenance; assign it from policy; then branch on mode —
-- `instant` books the visit and returns `confirmed`, `request` stops there and
-- returns `submitted` with no visit and therefore no calendar work.
--
-- The intent moves `held → confirmed | submitted` in one transaction, because
-- the broker proves the channel and confirms in a single request. `verified`
-- stays in the state machine and in the live-hold predicate so a later split
-- of verify from confirm needs no schema change; nothing today writes it.
--
-- The refusals below name their cause because the broker is the only caller.
-- Shaping them into one indistinguishable browser response is the broker's
-- job at the HTTP boundary (I5), not this function's.
create or replace function public.confirm_guest_booking_as_system(
  p_intent_id uuid,
  p_contact_email_digest text,
  p_contact_email text,
  p_verified_channel text default 'email'
) returns table (
  outcome text,
  intent_id uuid,
  client_id uuid,
  opportunity_id uuid,
  site_visit_id uuid,
  scheduled_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_intent private.guest_booking_intents%rowtype;
  v_policy public.site_visit_booking_policies%rowtype;
  v_client_id uuid;
  v_client_outcome text;
  v_opportunity_id uuid := gen_random_uuid();
  v_owner_id uuid;
  v_assignees text[] := '{}'::text[];
  v_visit_id uuid;
  v_state text;
  v_outcome text;
  v_title text;
  v_local text;
  v_email text := private.agent_normalize_discovery_email(p_contact_email);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null then
    raise exception 'booking_intent_required' using errcode = '22023';
  end if;
  if p_verified_channel is null or p_verified_channel not in ('email', 'phone') then
    raise exception 'booking_verified_channel_invalid' using errcode = '22023';
  end if;
  if v_email is null then
    raise exception 'booking_verified_email_required' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found then
    raise exception 'booking_intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.state <> 'held' then
    raise exception 'booking_intent_not_holdable' using errcode = '55000';
  end if;
  if v_intent.hold_expires_at <= v_now then
    raise exception 'booking_hold_expired' using errcode = '55000';
  end if;

  -- The proved channel must be the one the customer gave this intent. A code
  -- verified for some other address never confirms this booking (I1).
  if v_intent.contact_email_digest is null
     or v_intent.contact_email_digest is distinct from p_contact_email_digest then
    raise exception 'booking_contact_mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public_booking:' || v_intent.company_id::text));
  perform private.booking_expire_stale_holds(v_intent.company_id);

  select policy.* into v_policy
  from public.site_visit_booking_policies policy
  join public.companies company
    on company.id = policy.company_id
   and company.deleted_at is null
  where policy.company_id = v_intent.company_id;

  if not found or v_policy.mode = 'off' then
    raise exception 'booking_not_available' using errcode = '55000';
  end if;

  -- I12: the descriptor the page held was a proposal. This is the only place
  -- that decides, and it decides against live state.
  if not private.booking_slot_is_open(v_policy, v_intent.slot_start_at, v_intent.id, null) then
    raise exception 'booking_slot_unavailable' using errcode = '55000';
  end if;

  select resolved.resolved_client_id, resolved.resolved_outcome
  into v_client_id, v_client_outcome
  from private.booking_resolve_guest_client(
    v_intent.company_id, v_email, v_intent.contact_name, v_intent.contact_phone_raw
  ) as resolved;

  v_local := to_char(
    v_intent.slot_start_at at time zone v_policy.timezone,
    'FMDay FMMon FMDD at FMHH12:MI AM'
  );
  v_title := left(
    coalesce(nullif(btrim(coalesce(v_intent.contact_name, '')), ''), v_email)
      || ' — site visit',
    240
  );

  perform private.lock_lead_assignment_company(v_intent.company_id);

  -- The lead spine (I16). Inserted directly, with no assignment, exactly as
  -- the live external-intake system RPC does: `create_opportunity_guarded`
  -- resolves its actor from the JWT and cannot run on a path with no user.
  insert into public.opportunities (
    id, company_id, client_id, client_ref, title, description,
    contact_name, contact_email, contact_phone,
    stage, source, assigned_to, assignment_version,
    source_metadata, source_thread_key, stage_entered_at
  ) values (
    v_opportunity_id,
    v_intent.company_id,
    v_client_id,
    v_client_id,
    v_title,
    concat_ws(
      E'\n\n',
      'Booked from the website for ' || v_local || ' (' || v_policy.timezone || ').',
      case
        when jsonb_array_length(v_intent.answers) = 0 then null
        else 'Answers: ' || v_intent.answers::text
      end
    ),
    v_intent.contact_name,
    v_email,
    v_intent.contact_phone_raw,
    'new_lead',
    'website',
    null,
    0,
    jsonb_build_object(
      'integration_type', 'public_booking',
      'integration_id', v_intent.integration_id,
      'booking_mode', v_policy.mode,
      'client_match', v_client_outcome
    ),
    'public_booking:' || v_intent.id::text,
    v_now
  );

  -- Ownership comes from policy, never from the customer (I11). An owner who
  -- has since lost eligibility silently leaves the lead unassigned rather than
  -- failing the booking.
  if v_policy.default_owner_id is not null
     and private.user_is_guarded_assignment_target_eligible(
       v_policy.default_owner_id, v_intent.company_id
     ) then
    perform public.change_opportunity_assignment_as_system(
      v_opportunity_id,
      0,
      null,
      v_policy.default_owner_id,
      'public_booking_default',
      null,
      null,
      jsonb_build_object('intent_id', v_intent.id, 'source', 'public_booking')
    );
    v_owner_id := v_policy.default_owner_id;
    v_assignees := array[v_owner_id::text];
  end if;

  if v_policy.mode = 'instant' then
    v_visit_id := public.book_site_visit_as_system(
      v_opportunity_id,
      v_intent.slot_start_at,
      v_policy.visit_duration_minutes,
      v_assignees,
      null,
      v_owner_id,
      'public_booking'
    );
    v_state := 'confirmed';
    v_outcome := 'confirmed';
  else
    -- I14: nothing on any calendar until a person says so.
    v_visit_id := null;
    v_state := 'submitted';
    v_outcome := 'submitted';
  end if;

  update private.guest_booking_intents intent
  set state = v_state,
      verified_channel = p_verified_channel,
      verified_at = coalesce(intent.verified_at, v_now),
      resolved_client_id = v_client_id,
      resolved_opportunity_id = v_opportunity_id,
      resolved_site_visit_id = v_visit_id,
      hold_expires_at = v_now
  where intent.id = v_intent.id;

  perform private.booking_notify_staff(
    v_intent.company_id,
    v_opportunity_id,
    v_owner_id,
    case when v_outcome = 'confirmed' then 'Site visit booked online'
         else 'Booking request' end,
    case when v_outcome = 'confirmed'
         then coalesce(v_intent.contact_name, v_email) || ' booked ' || v_local || '.'
         else coalesce(v_intent.contact_name, v_email) || ' asked for ' || v_local || '. Confirm or move it.'
    end,
    case when v_outcome = 'confirmed'
         then 'booking_confirmed:' || v_intent.id::text
         else 'booking_request:' || v_intent.id::text
    end,
    v_outcome = 'submitted'
  );

  return query select
    v_outcome, v_intent.id, v_client_id, v_opportunity_id, v_visit_id,
    case when v_outcome = 'confirmed' then v_intent.slot_start_at else null::timestamptz end;
end;
$function$;

revoke all on function public.confirm_guest_booking_as_system(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_guest_booking_as_system(uuid, text, text, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Request-mode staff decisions (design §8)
-- ---------------------------------------------------------------------------

-- Acceptance books the visit for real, honouring a staff-chosen time if they
-- moved it. The staff member is the actor, so the activity and the stage nudge
-- carry a real name.
create or replace function public.confirm_booking_request_as_system(
  p_intent_id uuid,
  p_staff_user_id uuid,
  p_scheduled_at timestamptz default null
) returns table (
  intent_id uuid,
  site_visit_id uuid,
  scheduled_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_intent private.guest_booking_intents%rowtype;
  v_policy public.site_visit_booking_policies%rowtype;
  v_when timestamptz;
  v_assignees text[] := '{}'::text[];
  v_owner_id uuid;
  v_visit_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null or p_staff_user_id is null then
    raise exception 'booking_request_input_invalid' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found then
    raise exception 'booking_intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.state <> 'submitted' then
    raise exception 'booking_request_not_pending' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.users u
     where u.id = p_staff_user_id
       and u.company_id = v_intent.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    raise exception 'booking_staff_ineligible' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public_booking:' || v_intent.company_id::text));

  select policy.* into v_policy
  from public.site_visit_booking_policies policy
  where policy.company_id = v_intent.company_id;
  if not found then
    raise exception 'booking_not_available' using errcode = '55000';
  end if;

  v_when := coalesce(p_scheduled_at, v_intent.slot_start_at);

  -- Staff may move a request to a time policy would not have offered — they
  -- are the business. What they may not do is double-book the calendar.
  if exists (
    select 1
    from public.site_visits visit
    where visit.company_id = v_intent.company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status = 'scheduled'
      and visit.scheduled_at < v_when + make_interval(mins => v_intent.duration_minutes)
      and (visit.scheduled_at + make_interval(mins => visit.duration_minutes)) > v_when
  ) then
    raise exception 'booking_slot_unavailable' using errcode = '55000';
  end if;

  select opportunity.assigned_to into v_owner_id
  from public.opportunities opportunity
  where opportunity.id = v_intent.resolved_opportunity_id;
  if v_owner_id is not null then
    v_assignees := array[v_owner_id::text];
  end if;

  v_visit_id := public.book_site_visit_as_system(
    v_intent.resolved_opportunity_id,
    v_when,
    v_intent.duration_minutes,
    v_assignees,
    null,
    p_staff_user_id,
    'booking_request_accepted'
  );

  update private.guest_booking_intents intent
  set state = 'confirmed',
      slot_start_at = v_when,
      resolved_site_visit_id = v_visit_id,
      hold_expires_at = v_now
  where intent.id = p_intent_id;

  update public.notifications notification
  set resolved_at = v_now,
      resolved_by = p_staff_user_id,
      resolution_reason = 'booking_request_accepted',
      is_read = true
  where notification.company_id = v_intent.company_id::text
    and notification.dedupe_key = 'booking_request:' || p_intent_id::text
    and notification.resolved_at is null;

  return query select p_intent_id, v_visit_id, v_when;
end;
$function$;

revoke all on function public.confirm_booking_request_as_system(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_booking_request_as_system(uuid, uuid, timestamptz)
  to service_role;

-- Declining closes the request. The lead stays — someone asked for work, and
-- that is worth keeping whatever happens to the time they picked.
create or replace function public.decline_booking_request_as_system(
  p_intent_id uuid,
  p_staff_user_id uuid,
  p_reason text default null
) returns table (intent_id uuid, opportunity_id uuid)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_intent private.guest_booking_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null or p_staff_user_id is null then
    raise exception 'booking_request_input_invalid' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found then
    raise exception 'booking_intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.state <> 'submitted' then
    raise exception 'booking_request_not_pending' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.users u
     where u.id = p_staff_user_id
       and u.company_id = v_intent.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    raise exception 'booking_staff_ineligible' using errcode = '42501';
  end if;

  update private.guest_booking_intents intent
  set state = 'cancelled',
      closed_reason = left(
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'declined_by_staff'), 200
      ),
      hold_expires_at = v_now
  where intent.id = p_intent_id;

  update public.notifications notification
  set resolved_at = v_now,
      resolved_by = p_staff_user_id,
      resolution_reason = 'booking_request_declined',
      is_read = true
  where notification.company_id = v_intent.company_id::text
    and notification.dedupe_key = 'booking_request:' || p_intent_id::text
    and notification.resolved_at is null;

  return query select p_intent_id, v_intent.resolved_opportunity_id;
end;
$function$;

revoke all on function public.decline_booking_request_as_system(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decline_booking_request_as_system(uuid, uuid, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Customer-side management after a fresh proof (I15)
-- ---------------------------------------------------------------------------

-- The broker calls these only after the customer has answered a fresh code, so
-- no capability outlives one exchange. Reschedule re-runs slot validation:
-- moving a booking is a new booking decision.
create or replace function public.reschedule_guest_booking_as_system(
  p_intent_id uuid,
  p_scheduled_at timestamptz
) returns table (
  intent_id uuid,
  site_visit_id uuid,
  scheduled_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent private.guest_booking_intents%rowtype;
  v_policy public.site_visit_booking_policies%rowtype;
  v_visit public.site_visits%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null or p_scheduled_at is null then
    raise exception 'booking_reschedule_input_invalid' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found then
    raise exception 'booking_intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.state <> 'confirmed' or v_intent.resolved_site_visit_id is null then
    raise exception 'booking_not_reschedulable' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtext('public_booking:' || v_intent.company_id::text));
  perform private.booking_expire_stale_holds(v_intent.company_id);

  select policy.* into v_policy
  from public.site_visit_booking_policies policy
  join public.companies company
    on company.id = policy.company_id
   and company.deleted_at is null
  where policy.company_id = v_intent.company_id;

  if not found or v_policy.mode = 'off' then
    raise exception 'booking_not_available' using errcode = '55000';
  end if;

  if not private.booking_slot_is_open(
    v_policy, p_scheduled_at, v_intent.id, v_intent.resolved_site_visit_id
  ) then
    raise exception 'booking_slot_unavailable' using errcode = '55000';
  end if;

  select visit.* into v_visit
  from public.site_visits visit
  where visit.id = v_intent.resolved_site_visit_id
  for update;

  if not found or v_visit.deleted_at is not null then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;
  if v_visit.booked_at is null then
    raise exception 'site_visit_not_a_booking' using errcode = '55000';
  end if;
  if v_visit.status::text <> 'scheduled' then
    raise exception 'site_visit_not_reschedulable' using errcode = '55000';
  end if;

  -- The scheduled_at change fires the Google sync trigger, which enqueues the
  -- remote update when a calendar-scoped connection exists.
  update public.site_visits visit
  set scheduled_at = p_scheduled_at,
      duration_minutes = v_policy.visit_duration_minutes
  where visit.id = v_visit.id;

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_intent.company_id,
    v_visit.opportunity_id,
    coalesce(v_visit.client_ref, private.try_parse_uuid(v_visit.client_id)),
    'site_visit_scheduled', 'Site visit rescheduled online',
    to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_policy.visit_duration_minutes, null, '{}'::text[], true, v_visit.id
  );

  update private.guest_booking_intents intent
  set slot_start_at = p_scheduled_at
  where intent.id = p_intent_id;

  perform private.booking_notify_staff(
    v_intent.company_id,
    v_intent.resolved_opportunity_id,
    (select opportunity.assigned_to from public.opportunities opportunity
      where opportunity.id = v_intent.resolved_opportunity_id),
    'Site visit moved',
    coalesce(v_intent.contact_name, 'The customer') || ' moved their site visit to '
      || to_char(p_scheduled_at at time zone v_policy.timezone, 'FMDay FMMon FMDD at FMHH12:MI AM')
      || '.',
    'booking_rescheduled:' || p_intent_id::text || ':'
      || to_char(p_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MI'),
    false
  );

  return query select p_intent_id, v_visit.id, p_scheduled_at;
end;
$function$;

revoke all on function public.reschedule_guest_booking_as_system(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reschedule_guest_booking_as_system(uuid, timestamptz)
  to service_role;

-- Cancelling mirrors the staff verb: the status flip enqueues the remote
-- delete, and any still-pending create/update work is neutralized so a
-- cancelled booking can never materialize on a calendar.
create or replace function public.cancel_guest_booking_as_system(
  p_intent_id uuid,
  p_reason text default null
) returns table (intent_id uuid, site_visit_id uuid)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_intent private.guest_booking_intents%rowtype;
  v_visit public.site_visits%rowtype;
  v_timezone text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null then
    raise exception 'booking_intent_required' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found then
    raise exception 'booking_intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.state not in ('confirmed', 'submitted') then
    raise exception 'booking_not_cancellable' using errcode = '55000';
  end if;

  if v_intent.resolved_site_visit_id is not null then
    select visit.* into v_visit
    from public.site_visits visit
    where visit.id = v_intent.resolved_site_visit_id
    for update;

    if found and v_visit.deleted_at is null and v_visit.status::text = 'scheduled' then
      update public.site_visits visit
      set status = 'cancelled'
      where visit.id = v_visit.id;

      update public.google_calendar_sync_queue queue
      set status = 'skipped',
          skip_reason = 'booking_cancelled',
          updated_at = now()
      where queue.site_visit_id = v_visit.id
        and queue.status = 'pending'
        and queue.operation in ('create', 'update');

      insert into public.activities (
        company_id, opportunity_id, client_id, type, subject, content,
        duration_minutes, created_by, attachments, is_read, site_visit_id
      ) values (
        v_intent.company_id,
        v_visit.opportunity_id,
        coalesce(v_visit.client_ref, private.try_parse_uuid(v_visit.client_id)),
        'site_visit_scheduled', 'Site visit cancelled online',
        to_char(v_visit.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        v_visit.duration_minutes, null, '{}'::text[], true, v_visit.id
      );
    end if;
  end if;

  update private.guest_booking_intents intent
  set state = 'cancelled',
      closed_reason = left(
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'cancelled_by_customer'), 200
      ),
      hold_expires_at = v_now
  where intent.id = p_intent_id;

  update public.notifications notification
  set resolved_at = v_now,
      resolution_reason = 'booking_cancelled',
      is_read = true
  where notification.company_id = v_intent.company_id::text
    and notification.dedupe_key = 'booking_request:' || p_intent_id::text
    and notification.resolved_at is null;

  select policy.timezone into v_timezone
  from public.site_visit_booking_policies policy
  where policy.company_id = v_intent.company_id;

  perform private.booking_notify_staff(
    v_intent.company_id,
    v_intent.resolved_opportunity_id,
    (select opportunity.assigned_to from public.opportunities opportunity
      where opportunity.id = v_intent.resolved_opportunity_id),
    'Site visit cancelled',
    coalesce(v_intent.contact_name, 'The customer') || ' cancelled the site visit on '
      || to_char(
           v_intent.slot_start_at at time zone coalesce(v_timezone, 'UTC'),
           'FMDay FMMon FMDD at FMHH12:MI AM'
         )
      || '.',
    'booking_cancelled:' || p_intent_id::text,
    false
  );

  return query select p_intent_id, v_intent.resolved_site_visit_id;
end;
$function$;

revoke all on function public.cancel_guest_booking_as_system(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_guest_booking_as_system(uuid, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Claiming a guest booking on a later sign-in (design §4.3, P1 §5.2)
-- ---------------------------------------------------------------------------

-- The claim requires the intent's verified channel to be verified on the
-- claiming identity, attaches that identity to the client the booking already
-- resolved, and never creates a client. Exactly once, by unique constraint.
create or replace function public.claim_guest_booking_as_system(
  p_intent_id uuid,
  p_identity_id uuid,
  p_contact_email_digest text
) returns table (
  claim_id uuid,
  membership_id uuid,
  client_id uuid,
  created boolean
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent private.guest_booking_intents%rowtype;
  v_membership_id uuid;
  v_claim_id uuid;
  v_existing private.customer_booking_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_intent_id is null or p_identity_id is null then
    raise exception 'booking_claim_input_invalid' using errcode = '22023';
  end if;
  if p_contact_email_digest is null
     or p_contact_email_digest !~ '^[1-9][0-9]{0,4}:[0-9a-f]{64}$' then
    raise exception 'booking_email_digest_invalid' using errcode = '22023';
  end if;

  select intent.* into v_intent
  from private.guest_booking_intents intent
  where intent.id = p_intent_id
  for update;

  if not found
     or v_intent.state not in ('confirmed', 'submitted')
     or v_intent.resolved_client_id is null then
    return;
  end if;

  select claim.* into v_existing
  from private.customer_booking_claims claim
  where claim.intent_id = p_intent_id;
  if found then
    return query select
      v_existing.id, v_existing.membership_id, v_intent.resolved_client_id, false;
    return;
  end if;

  -- The claiming identity must hold the very channel this booking proved. The
  -- digest key lives in the broker's key ring, not in the database, so the
  -- broker computes the digest of the identity's own verified email and this
  -- RPC checks two things it can check: that the digest is the one on the
  -- intent, and that the identity really holds a live verified contact on that
  -- channel. Neither check alone would be enough.
  if v_intent.contact_email_digest is null
     or v_intent.contact_email_digest is distinct from p_contact_email_digest then
    raise exception 'booking_claim_channel_unproven' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.customer_verified_contacts contact
    join private.customer_identities identity
      on identity.id = contact.identity_id
     and identity.status = 'active'
    where contact.identity_id = p_identity_id
      and contact.channel = coalesce(v_intent.verified_channel, 'email')
      and contact.revoked_at is null
  ) then
    raise exception 'booking_claim_channel_unproven' using errcode = '42501';
  end if;

  select member.id into v_membership_id
  from private.company_client_memberships member
  where member.identity_id = p_identity_id
    and member.company_id = v_intent.company_id
    and member.client_id = v_intent.resolved_client_id
    and member.state in ('active_forward_only', 'active_full')
  order by member.created_at desc
  limit 1;

  if v_membership_id is null then
    insert into private.company_client_memberships (
      identity_id, company_id, client_id, sub_client_id, state, evidence_kind
    ) values (
      p_identity_id, v_intent.company_id, v_intent.resolved_client_id, null,
      'active_full', 'guest_claim'
    )
    returning id into v_membership_id;

    perform private.customer_record_identity_event(
      'membership_created', p_identity_id, v_intent.company_id, null,
      v_membership_id, null,
      jsonb_build_object(
        'state', 'active_full',
        'evidence_kind', 'guest_claim',
        'intent_id', v_intent.id
      )
    );
  end if;

  insert into private.customer_booking_claims (intent_id, identity_id, membership_id)
  values (p_intent_id, p_identity_id, v_membership_id)
  returning id into v_claim_id;

  return query select v_claim_id, v_membership_id, v_intent.resolved_client_id, true;
end;
$function$;

revoke all on function public.claim_guest_booking_as_system(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_guest_booking_as_system(uuid, uuid, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- Hold sweeper (I13), on the shared controlled-cron runner
-- ---------------------------------------------------------------------------

-- Expired holds must never block a slot. The availability and confirm paths
-- already ignore them by predicate, so the sweep is hygiene, not correctness —
-- it keeps the table honest and lets the caps count by state alone.
create or replace function private.guest_booking_hold_sweep()
returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.booking_expire_stale_holds(null);

  -- Abandoned intents leave no trace worth keeping: an expired hold that never
  -- resolved anything is deleted after a week.
  delete from private.guest_booking_intents intent
  where intent.state in ('expired', 'cancelled')
    and intent.resolved_opportunity_id is null
    and intent.updated_at < statement_timestamp() - interval '7 days';
end;
$function$;

revoke all on function private.guest_booking_hold_sweep()
  from public, anon, authenticated, service_role;

-- Allowlist the sweep for the shared scheduled-workload runner. The body is
-- the live definition with one command added.
create or replace function private.run_scheduled_cron_workload_controlled(
  p_workload_key text,
  p_lease_seconds integer,
  p_command_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_owner_token uuid := gen_random_uuid();
  v_acquisition jsonb;
  v_completed boolean;
  v_sqlstate text;
  v_message text;
  v_failed boolean := false;
begin
  if p_command_name not in (
    'public.fire_due_task_reminders',
    'private.refresh_spec_board_snapshot',
    'private.capture_identity_linkage_metrics',
    'public.expense_envelope_sweep',
    'private.prune_cron_history_batch',
    'private.customer_identity_dormancy_sweep',
    'private.guest_booking_hold_sweep'
  ) then
    raise exception 'scheduled cron command is not allowlisted'
      using errcode = '42501';
  end if;

  v_acquisition := private.acquire_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    p_lease_seconds
  );
  if v_acquisition ->> 'acquired' <> 'true' then
    return v_acquisition || jsonb_build_object(
      'workload_key',
      p_workload_key
    );
  end if;

  -- Bound the database statement below the durable lease. The 30-second
  -- completion margin guarantees an overrun is cancelled and recorded before
  -- a successor can acquire the expired fence.
  perform set_config(
    'statement_timeout',
    (greatest(5, p_lease_seconds - 30) * 1000)::text,
    true
  );

  begin
    execute format('select %s()', p_command_name);
  exception
    when query_canceled then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
  end;

  if v_failed then
    v_completed := private.complete_cron_workload_lease_internal(
      p_workload_key,
      v_owner_token,
      (v_acquisition ->> 'fence_token')::bigint,
      (v_acquisition ->> 'global_fence_token')::bigint,
      false,
      private.is_cron_database_pressure_error(v_sqlstate, v_message),
      300
    );
    if not v_completed then
      raise exception 'scheduled cron workload lost its completion fence'
        using errcode = '55000';
    end if;

    -- Do not rethrow here: an exception escaping the pg_cron transaction
    -- would roll back the circuit update we just persisted. The failed
    -- command already ran inside this exception block's subtransaction, so
    -- its partial effects were rolled back before completion was recorded.
    raise warning
      'scheduled cron workload % failed [%]: %',
      p_workload_key,
      v_sqlstate,
      v_message;
    return jsonb_build_object(
      'acquired',
      true,
      'completed',
      false,
      'workload_key',
      p_workload_key,
      'error_sqlstate',
      v_sqlstate
    );
  end if;

  v_completed := private.complete_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    (v_acquisition ->> 'fence_token')::bigint,
    (v_acquisition ->> 'global_fence_token')::bigint,
    true,
    false,
    300
  );
  if not v_completed then
    raise exception 'scheduled cron workload lost its completion fence'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'acquired',
    true,
    'completed',
    true,
    'workload_key',
    p_workload_key
  );
end;
$function$;

create or replace function private.run_guest_booking_hold_sweep_controlled()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-guest-booking-hold-sweep',
    120,
    'private.guest_booking_hold_sweep'
  );
$function$;

revoke all on function private.run_guest_booking_hold_sweep_controlled()
  from public, anon, authenticated, service_role;

do $schedule_hold_sweep$
declare
  v_job_id bigint;
begin
  v_job_id := cron.schedule(
    'guest_booking_hold_sweep_5min',
    '*/5 * * * *',
    'select private.run_guest_booking_hold_sweep_controlled();'
  );
  perform cron.alter_job(
    job_id := v_job_id,
    active := true
  );
end;
$schedule_hold_sweep$;
