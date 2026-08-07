-- Lead-assignment notification copy alignment (MY LEADS day sheet).
-- Approved by Jackson 2026-07-28; reviewed staged artifact (full rationale,
-- caps analysis, and safety review):
--   ops-ios docs/migrations/2026-07-27-lead-assignment-copy-alignment.staged.sql
--
-- Copy-only CREATE OR REPLACE of public.claim_opportunity_assignment_deliveries:
-- the rail row's title/body move to the day-sheet spec §8 OPS voice —
--   title  'Lead assigned'                          -> 'NEW LEAD — <NAME>' (<= 32)
--   body   '<title> is now assigned to you.'        -> '<address> · <job line>' (<= 140)
-- Signature, staleness revalidation, dedupe, suppression, preference
-- resolution, leasing, retry, and the returned result set are unchanged; the
-- returned lead_title (fed to the OneSignal push by the TS worker) is
-- deliberately untouched. Two columns are added to the claim SELECT
-- (o.contact_name, o.address) solely to build the copy. The companion
-- OneSignal PUSH strings are hardcoded in ops-web TypeScript
-- (lead-assignment-delivery-service.ts) and ship separately — until then the
-- push keeps the old wording while the rail carries the new.

-- Refuse to run anywhere the shipped worker is not already present. This is a
-- REPLACE of a live function, never a first definition.
do $do$
begin
  if to_regprocedure(
       'public.claim_opportunity_assignment_deliveries(uuid,integer,integer)'
     ) is null
  then
    raise exception
      'lead assignment delivery worker is not installed; apply 20260715161600 first';
  end if;
end
$do$;

create or replace function public.claim_opportunity_assignment_deliveries(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns table (
  delivery_id uuid,
  delivery_lease_token uuid,
  assignment_event_id uuid,
  company_id uuid,
  opportunity_id uuid,
  recipient_user_id uuid,
  notification_id uuid,
  lead_title text,
  should_push boolean,
  requires_notification boolean,
  disposition text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(0, least(coalesce(p_limit, 25), 100));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 180), 900));
  v_row record;
  v_notification_id uuid;
  v_lease_token uuid;
  v_dedupe_key text;
  v_lead_title text;
  v_notification_body text;
  v_pref_push jsonb;
  v_should_push boolean;
  v_disposition text;
  -- Copy-alignment locals (spec §8). Separate from v_lead_title, which stays
  -- the returned push value and must not shift.
  v_lead_name text;
  v_notification_title text;
  v_title_prefix constant text := 'NEW LEAD — ';
  v_title_budget integer;
  v_address text;
  v_job_line text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using
      message = 'lead assignment delivery claims require service role';
  end if;
  if p_worker_id is null then
    raise exception 'lead assignment delivery worker id is required';
  end if;
  if v_limit = 0 then
    return;
  end if;

  for v_row in
    select
      d.*,
      o.title as opportunity_title,
      -- Added for spec §8 copy only; no effect on row selection or locking.
      o.contact_name as opportunity_contact_name,
      o.address as opportunity_address,
      o.assigned_to as current_assignee_id,
      o.assignment_version as current_assignment_version,
      o.deleted_at as opportunity_deleted_at,
      o.archived_at as opportunity_archived_at,
      e.new_assignee_id,
      e.assignment_version as event_assignment_version,
      e.company_id as event_company_id,
      e.opportunity_id as event_opportunity_id,
      u.company_id as user_company_id,
      u.deleted_at as user_deleted_at,
      u.is_active as user_is_active,
      np.push_enabled as preference_push_enabled,
      np.channel_preferences
    from public.opportunity_assignment_deliveries d
    join public.opportunities o
      on o.id = d.opportunity_id
    join public.opportunity_assignment_events e
      on e.id = d.assignment_event_id
    join public.users u
      on u.id = d.recipient_user_id
    left join public.notification_preferences np
      on np.user_id = d.recipient_user_id
     and np.company_id = d.company_id
    where (
      (
        d.state in ('pending', 'failed')
        and d.available_at <= now()
        and d.attempts < d.max_attempts
      )
      or (d.state = 'processing' and d.lease_expires_at <= now())
    )
    order by
      case
        when d.state = 'processing' then d.lease_expires_at
        else d.available_at
      end,
      d.created_at,
      d.id
    for update of d, o skip locked
    limit v_limit
  loop
    v_disposition := null;

    -- A crashed worker that exhausted its final lease is terminal, but still
    -- returned so the cron reports the condition instead of hiding it.
    if v_row.state = 'processing'
       and v_row.attempts >= v_row.max_attempts
    then
      update public.opportunity_assignment_deliveries d
         set state = 'failed',
             disposition = 'terminal_failure',
             terminal_at = now(),
             claimed_at = null,
             claimed_by = null,
             lease_token = null,
             lease_expires_at = null,
             available_at = 'infinity'::timestamptz,
             last_error = coalesce(
               d.last_error,
               'lease expired after maximum attempts'
             ),
             updated_at = now()
       where d.id = v_row.id;

      return query values (
        v_row.id,
        null::uuid,
        v_row.assignment_event_id,
        v_row.company_id,
        v_row.opportunity_id,
        v_row.recipient_user_id,
        v_row.notification_id,
        coalesce(nullif(btrim(v_row.opportunity_title), ''), 'New lead'),
        false,
        false,
        'terminal_failure'::text
      );
      continue;
    end if;

    if v_row.notify = false then
      v_disposition := 'silent';
    elsif v_row.access_after = false
       or v_row.company_id is distinct from v_row.event_company_id
       or v_row.opportunity_id is distinct from v_row.event_opportunity_id
       or v_row.assignment_version is distinct from v_row.event_assignment_version
       or v_row.assignment_version is distinct from v_row.current_assignment_version
       or v_row.new_assignee_id is distinct from v_row.recipient_user_id
       or v_row.current_assignee_id is distinct from v_row.recipient_user_id
       or v_row.opportunity_deleted_at is not null
       or v_row.opportunity_archived_at is not null
    then
      v_disposition := 'stale';
    elsif v_row.user_company_id is distinct from v_row.company_id
       or v_row.user_deleted_at is not null
       or not coalesce(v_row.user_is_active, false)
       or not private.user_can_view_opportunity(
         v_row.recipient_user_id,
         v_row.opportunity_id
       )
    then
      v_disposition := 'inaccessible';
    end if;

    if v_disposition is not null then
      if v_disposition in ('stale', 'inaccessible')
         and v_row.notification_id is not null
      then
        update public.notifications n
           set is_read = true,
               resolved_at = now(),
               resolution_reason = 'assignment_delivery_suppressed'
         where n.id = v_row.notification_id
           and n.dedupe_key =
             'lead-assignment-delivery:' || v_row.id::text;
      end if;

      update public.opportunity_assignment_deliveries d
         set state = 'delivered',
             attempts = d.attempts + 1,
             claimed_at = null,
             claimed_by = null,
             lease_token = null,
             lease_expires_at = null,
             delivered_at = now(),
             disposition = v_disposition,
             push_state = 'suppressed',
             terminal_at = null,
             last_error = case v_disposition
               when 'silent' then null
               when 'stale' then 'suppressed stale assignment delivery'
               else 'suppressed delivery for inaccessible recipient'
             end,
             updated_at = now()
       where d.id = v_row.id;

      return query values (
        v_row.id,
        null::uuid,
        v_row.assignment_event_id,
        v_row.company_id,
        v_row.opportunity_id,
        v_row.recipient_user_id,
        v_row.notification_id,
        coalesce(nullif(btrim(v_row.opportunity_title), ''), 'New lead'),
        false,
        false,
        v_disposition
      );
      continue;
    end if;

    -- Returned to the caller and used by the ops-web worker to build the push.
    -- UNCHANGED from the shipped definition — see the staged file's SAFETY
    -- REVIEW note 2.
    v_lead_title := coalesce(
      nullif(btrim(v_row.opportunity_title), ''),
      'New lead'
    );

    -- ---- spec §8 rail copy -------------------------------------------------
    -- Every copy fragment is whitespace-collapsed first. Addresses are stored
    -- multi-line ('123 Main St\nVancouver, BC'), and a raw newline inside a
    -- notification title or body renders as a broken line on both rails and in
    -- the push. This mirrors the normalization the ops-web push builder already
    -- applies (`leadTitle.replace(/\s+/g, " ").trim()`).
    --
    -- <NAME>: mirrors iOS Opportunity.displayContactName
    -- (contact_name -> title -> 'New lead').
    v_lead_name := upper(
      coalesce(
        nullif(btrim(regexp_replace(
          coalesce(v_row.opportunity_contact_name, ''), '\s+', ' ', 'g'
        )), ''),
        nullif(btrim(regexp_replace(
          coalesce(v_row.opportunity_title, ''), '\s+', ' ', 'g'
        )), ''),
        'New lead'
      )
    );

    -- 'NEW LEAD — <NAME>' capped at 32 characters. Only the name is cut, and
    -- a cut name ends in '…' so a truncated lead never reads as a real name.
    if char_length(v_title_prefix || v_lead_name) <= 32 then
      v_notification_title := v_title_prefix || v_lead_name;
    else
      v_title_budget := 32 - char_length(v_title_prefix) - 1;
      v_notification_title :=
        v_title_prefix
        || rtrim(left(v_lead_name, v_title_budget))
        || '…';
    end if;

    -- '<address> · <job line>', capped at 140. Either half may be missing:
    -- the separator only appears between two present halves. When the lead
    -- carries neither an address nor a job line the body falls back to the
    -- previously shipped sentence, which still names a concrete entity as
    -- §14.3.1 requires — an empty body would be a contract violation.
    v_address := nullif(btrim(regexp_replace(
      coalesce(v_row.opportunity_address, ''), '\s+', ' ', 'g'
    )), '');
    v_job_line := nullif(btrim(regexp_replace(
      coalesce(v_row.opportunity_title, ''), '\s+', ' ', 'g'
    )), '');
    v_notification_body := left(
      case
        when v_address is not null and v_job_line is not null
          then v_address || ' · ' || v_job_line
        when v_address is not null then v_address
        when v_job_line is not null then v_job_line
        else v_lead_title || ' is now assigned to you.'
      end,
      140
    );
    -- ------------------------------------------------------------------------

    v_dedupe_key := 'lead-assignment-delivery:' || v_row.id::text;
    v_notification_id := null;

    insert into public.notifications (
      user_id,
      company_id,
      type,
      title,
      body,
      is_read,
      persistent,
      action_url,
      action_label,
      project_id,
      deep_link_type,
      dedupe_key
    ) values (
      v_row.recipient_user_id::text,
      v_row.company_id::text,
      'lead_assigned',
      v_notification_title,
      v_notification_body,
      false,
      false,
      '/pipeline?opportunityId=' || v_row.opportunity_id::text,
      'OPEN LEAD',
      null,
      'lead',
      v_dedupe_key
    )
    on conflict do nothing
    returning id into v_notification_id;

    if v_notification_id is null then
      select n.id
        into v_notification_id
        from public.notifications n
       where n.dedupe_key = v_dedupe_key
         and n.user_id = v_row.recipient_user_id::text
         and n.company_id = v_row.company_id::text
         and n.type = 'lead_assigned';
    end if;

    if v_notification_id is null then
      raise exception 'lead assignment notification could not be materialized';
    end if;

    v_pref_push := v_row.channel_preferences #> '{lead_assignments,push}';
    v_should_push := coalesce(v_row.preference_push_enabled, true)
      and case
        when jsonb_typeof(v_pref_push) = 'boolean'
          then (v_pref_push #>> '{}')::boolean
        else true
      end;

    v_lease_token := gen_random_uuid();
    update public.opportunity_assignment_deliveries d
       set state = 'processing',
           attempts = d.attempts + 1,
           claimed_at = now(),
           claimed_by = p_worker_id::text,
           lease_token = v_lease_token,
           lease_expires_at = now() + make_interval(secs => v_lease_seconds),
           notification_id = v_notification_id,
           disposition = null,
           push_state = 'pending',
           terminal_at = null,
           last_error = null,
           updated_at = now()
     where d.id = v_row.id;

    return query values (
      v_row.id,
      v_lease_token,
      v_row.assignment_event_id,
      v_row.company_id,
      v_row.opportunity_id,
      v_row.recipient_user_id,
      v_notification_id,
      v_lead_title,
      v_should_push,
      true,
      'notified'::text
    );
  end loop;
end;
$function$;

-- `create or replace` preserves grants and comments; these are restated so the
-- file is self-contained and the privilege surface is provable from one read.
revoke all on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer)
  to service_role;

comment on function public.claim_opportunity_assignment_deliveries(uuid, integer, integer) is
  'Service-only SKIP LOCKED lead-assignment delivery claim. Silently consumes old-assignee, stale, and inaccessible rows; materializes one durable rail notification before returning push work.';
