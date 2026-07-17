-- Scope provider message identities to the mailbox that issued them.
--
-- Provider message IDs are not a cross-tenant identity contract. The former
-- global unique index allowed one company's message to suppress or redirect
-- another company's ingestion when two providers/mailboxes emitted the same
-- opaque ID. This is the additive half of an expand/deploy/contract rollout:
-- the legacy unique indexes and activity trigger contract stay untouched until
-- the compatible application is live.

begin;

-- Normalize the exact value used by the new OAuth conflict target. Refuse the
-- migration rather than silently merge rows if trimming/case-folding would
-- collapse two identities for one company/provider.
do $$
begin
  if exists (
    select 1
      from public.email_connections
     group by company_id, provider, lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'email connection normalization would create duplicate company/provider/mailbox identities';
  end if;

  -- The legacy `(company_id, email)` index intentionally remains through the
  -- rolling application deploy. Even distinct providers cannot coexist under
  -- that old identity yet, so fail before normalization would collide with it.
  if exists (
    select 1
      from public.email_connections
     group by company_id, lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'email connection normalization would collide with the temporary legacy company/mailbox identity';
  end if;

  if exists (
    select 1
      from public.email_connections
     where email is null
        or lower(btrim(email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'email connection contains an invalid mailbox identity';
  end if;
end;
$$;

-- Keep old callbacks compatible during the expand -> application deploy
-- window: providers may return mixed-case mailbox addresses, but both the old
-- and new conflict targets must always see the same normalized value.
create or replace function public.normalize_email_connection_email()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists email_connections_normalize_email
  on public.email_connections;

create trigger email_connections_normalize_email
before insert or update of email
on public.email_connections
for each row
execute function public.normalize_email_connection_email();

update public.email_connections
   set email = lower(btrim(email))
 where email is distinct from lower(btrim(email));

alter table public.email_connections
  drop constraint if exists email_connections_email_normalized_check;

alter table public.email_connections
  add constraint email_connections_email_normalized_check
  check (
    email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  );

-- Gmail and Microsoft can legitimately expose the same normalized mailbox
-- address. Add the provider-scoped identity now, but retain the legacy
-- `(company_id, email)` index until the post-deploy contract migration so both
-- the old and new application versions remain executable during rollout.

create unique index if not exists email_connections_company_provider_email_unique
  on public.email_connections (company_id, provider, email);

alter table public.email_connections
  add column if not exists sync_lock_owner uuid;

alter table public.email_connections
  add column if not exists webhook_client_state_hash text;

alter table public.email_connections
  add column if not exists history_recovery_anchor timestamptz;

alter table public.email_connections
  add column if not exists history_recovery_page_token text;

alter table public.email_connections
  add column if not exists history_recovery_target_token text;

comment on column public.email_connections.sync_lock_owner is
  'Opaque owner of the current sync lease; release and renewal must match this value.';

comment on column public.email_connections.webhook_client_state_hash is
  'SHA-256 digest of the random Microsoft Graph subscription clientState secret.';

comment on column public.email_connections.history_recovery_anchor is
  'Inclusive mailbox timestamp lower bound for an in-progress Gmail expired-history replay.';

comment on column public.email_connections.history_recovery_page_token is
  'Gmail messages.list continuation after the last fully persisted expired-history recovery batch.';

comment on column public.email_connections.history_recovery_target_token is
  'Fresh Gmail historyId held until every expired-history recovery page has persisted.';

alter table public.email_connections
  drop constraint if exists email_connections_history_recovery_state_check;

alter table public.email_connections
  add constraint email_connections_history_recovery_state_check
  check (
    (
      history_recovery_target_token is null
      and history_recovery_anchor is null
      and history_recovery_page_token is null
    )
    or (
      history_recovery_target_token is not null
      and history_recovery_anchor is not null
    )
  );

create unique index if not exists email_connections_webhook_client_state_hash_unique
  on public.email_connections (webhook_client_state_hash)
  where webhook_client_state_hash is not null;

alter table public.activities
  add column if not exists email_connection_id uuid
    references public.email_connections(id) on delete restrict;

comment on column public.activities.email_connection_id is
  'Mailbox connection that issued email_message_id; required for new provider-backed email activities.';

create index if not exists activities_email_connection_id_idx
  on public.activities (email_connection_id)
  where email_connection_id is not null;

-- Add the connection-scoped identity while keeping the legacy global provider
-- message unique index in place. The short coexistence window is intentionally
-- stricter; the post-deploy contract migration removes the old identity only
-- after every application writer supplies `email_connection_id`.
create unique index if not exists activities_email_provider_identity_unique
  on public.activities (company_id, email_connection_id, email_message_id)
  where email_connection_id is not null
    and email_message_id is not null
    and btrim(email_message_id) <> '';

-- A provider thread is scoped by its mailbox connection. Service-role writers
-- bypass RLS, so enforce that the linked opportunity belongs to the same
-- company at the database boundary. Nullable connection_id remains supported
-- for legacy rows and ON DELETE SET NULL behavior.
do $$
begin
  if exists (
    select 1
      from public.opportunity_email_threads link
      left join public.email_connections connection
        on connection.id = link.connection_id
      left join public.companies connection_company
        on connection_company.id::text = connection.company_id
      left join public.opportunities opportunity
        on opportunity.id = link.opportunity_id
     where link.connection_id is not null
       and (
         connection.id is null
         or connection_company.id is null
         or opportunity.id is null
         or connection_company.id is distinct from opportunity.company_id
       )
  ) then
    raise exception 'opportunity email thread contains a cross-company or orphaned provider identity';
  end if;
end;
$$;

create or replace function public.require_same_company_opportunity_email_thread()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_connection_company_id uuid;
  v_opportunity_company_id uuid;
begin
  -- The production application being replaced used an updating upsert on the
  -- unique (thread_id, connection_id) key. During a rolling deploy, reject that
  -- old writer at the database boundary instead of allowing it to reassign the
  -- canonical opportunity selected by the first successful insert.
  if tg_op = 'UPDATE'
     and old.opportunity_id is distinct from new.opportunity_id then
    raise exception 'opportunity email thread ownership is immutable';
  end if;

  if new.connection_id is null then
    return new;
  end if;

  select connection_company.id
    into v_connection_company_id
    from public.email_connections connection
    join public.companies connection_company
      on connection_company.id::text = connection.company_id
   where connection.id = new.connection_id;

  select opportunity.company_id
    into v_opportunity_company_id
    from public.opportunities opportunity
   where opportunity.id = new.opportunity_id;

  if v_connection_company_id is null
     or v_opportunity_company_id is null
     or v_connection_company_id is distinct from v_opportunity_company_id then
    raise exception 'opportunity email thread must reference a mailbox and opportunity in the same company';
  end if;

  return new;
end;
$$;

drop trigger if exists opportunity_email_threads_same_company
  on public.opportunity_email_threads;

create trigger opportunity_email_threads_same_company
before insert or update of opportunity_id, connection_id
on public.opportunity_email_threads
for each row
execute function public.require_same_company_opportunity_email_thread();

commit;
