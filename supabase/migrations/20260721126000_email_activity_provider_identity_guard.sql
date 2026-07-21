-- Refuse any new provider-backed email activity that cannot be traced to its
-- exact OPS mailbox, provider thread, and provider message. Existing legacy
-- rows remain untouched; the update trigger only runs when an identity field
-- is explicitly rewritten.

begin;

create index if not exists opportunity_correspondence_events_activity_connection_idx
  on public.opportunity_correspondence_events
  (company_id, activity_id, connection_id)
  where connection_id is not null;

create or replace function public.require_email_activity_provider_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_company_id uuid;
  v_event_connection_count bigint := 0;
  v_event_connection_id uuid;
  v_legacy_claim_proven boolean := false;
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if tg_op = 'UPDATE' then
    if old.type::text = 'email'
       and new.type::text is distinct from 'email' then
      raise exception 'email activity type is immutable'
        using errcode = '23514';
    end if;

    if old.type::text is distinct from 'email'
       and new.type::text = 'email' then
      raise exception 'email activity type is immutable'
        using errcode = '23514';
    end if;

    if old.type::text is distinct from 'email' then
      return new;
    end if;

    -- The existing review tool quarantines an unresolved row by
    -- changing only `provider-thread` to the deterministic `legacy:<old>`
    -- marker. Permit that exact transition once while keeping every other
    -- provider-identity field byte-for-byte unchanged.
    if old.type::text = 'email'
       and new.type::text = 'email'
       and new.email_connection_id is not distinct from old.email_connection_id
       and new.company_id is not distinct from old.company_id
       and new.email_message_id is not distinct from old.email_message_id
       and nullif(btrim(old.email_thread_id), '') is not null
       and left(old.email_thread_id, length('legacy:')) <> 'legacy:'
       and new.email_thread_id = 'legacy:' || old.email_thread_id then
      if v_request_role is distinct from 'service_role' then
        raise exception 'email activity quarantine requires trusted service transport'
          using errcode = '42501';
      end if;
      return new;
    end if;

    -- Sync may claim a pre-connection legacy activity only after reproducing
    -- the same deterministic mailbox proof used by the application: an
    -- immutable correspondence event, an exact opportunity/thread link, or
    -- the canonical email_threads row. All other provider identity remains
    -- byte-for-byte unchanged.
    if old.email_connection_id is null
       and new.email_connection_id is not null
       and new.company_id is not distinct from old.company_id
       and new.email_message_id is not distinct from old.email_message_id
       and new.email_thread_id is not distinct from old.email_thread_id
       and nullif(btrim(new.email_message_id), '') is not null
       and nullif(btrim(new.email_thread_id), '') is not null
       and new.email_message_id is not distinct from btrim(new.email_message_id)
       and new.email_thread_id is not distinct from btrim(new.email_thread_id) then
      if v_request_role is distinct from 'service_role' then
        raise exception 'legacy email activity claim requires trusted service transport'
          using errcode = '42501';
      end if;

      select company.id
        into v_connection_company_id
        from public.email_connections connection
        join public.companies company
          on company.id::text = connection.company_id
       where connection.id = new.email_connection_id;

      if v_connection_company_id is null
         or v_connection_company_id is distinct from new.company_id then
        raise exception 'email activity mailbox must belong to the activity company'
          using errcode = '23514';
      end if;

      -- Immutable correspondence events are authoritative. A conflict is
      -- never allowed to fall through to weaker thread/link evidence.
      select
        count(distinct event.connection_id),
        (array_agg(distinct event.connection_id))[1]
        into v_event_connection_count, v_event_connection_id
        from public.opportunity_correspondence_events event
       where event.company_id = old.company_id
         and event.activity_id = old.id
         and event.connection_id is not null;

      if v_event_connection_count > 1 then
        raise exception 'legacy email activity has conflicting connection evidence'
          using errcode = '23514';
      end if;

      if v_event_connection_count = 1 then
        if v_event_connection_id is distinct from new.email_connection_id then
          raise exception 'legacy email activity belongs to another mailbox'
            using errcode = '23514';
        else
          v_legacy_claim_proven := true;
        end if;
      else
        select
          (
          old.opportunity_id is not null
          and exists (
            select 1
              from public.opportunity_email_threads link
             where link.opportunity_id = old.opportunity_id
               and link.thread_id = old.email_thread_id
               and link.connection_id = new.email_connection_id
          )
          )
          or exists (
            select 1
              from public.email_threads thread
             where thread.company_id = old.company_id
               and thread.connection_id = new.email_connection_id
               and thread.provider_thread_id = old.email_thread_id
          )
          into v_legacy_claim_proven;
      end if;

      if not coalesce(v_legacy_claim_proven, false) then
        raise exception 'legacy email activity mailbox ownership is unproven'
          using errcode = '23514';
      end if;

      return new;
    end if;

    if new.company_id is distinct from old.company_id
       or new.email_connection_id is distinct from old.email_connection_id
       or new.email_message_id is distinct from old.email_message_id
       or new.email_thread_id is distinct from old.email_thread_id then
      raise exception 'email activity provider identity is immutable'
        using errcode = '23514';
    end if;
  end if;

  if new.type::text = 'email' then
    if new.email_connection_id is null
       or nullif(btrim(new.email_message_id), '') is null
       or nullif(btrim(new.email_thread_id), '') is null
       or new.email_message_id is distinct from btrim(new.email_message_id)
       or new.email_thread_id is distinct from btrim(new.email_thread_id) then
      raise exception
        'email activity requires exact mailbox, provider message, and provider thread identity'
        using errcode = '23514';
    end if;

    select company.id
      into v_connection_company_id
      from public.email_connections connection
      join public.companies company
        on company.id::text = connection.company_id
     where connection.id = new.email_connection_id;

    if v_connection_company_id is null
       or v_connection_company_id is distinct from new.company_id then
      raise exception 'email activity mailbox must belong to the activity company'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.require_email_activity_provider_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_require_provider_identity_on_insert
  on public.activities;

create trigger activities_require_provider_identity_on_insert
before insert on public.activities
for each row execute function public.require_email_activity_provider_identity();

drop trigger if exists activities_require_provider_identity_on_identity_update
  on public.activities;

create trigger activities_require_provider_identity_on_identity_update
before update of
  type,
  company_id,
  email_connection_id,
  email_message_id,
  email_thread_id
on public.activities
for each row execute function public.require_email_activity_provider_identity();

commit;
