-- Contract the legacy provider-agnostic email identities.
--
-- IMPORTANT: this reviewed SQL artifact is deliberately held outside
-- `supabase/migrations` so an "apply all pending" command cannot run the
-- contract before the compatible application is deployed and verified.
-- Promote/apply it only as a second, explicit post-deploy change.

begin;

-- The additive 2030 migration installed the replacement conflict targets while
-- retaining these old indexes for rolling-deploy compatibility. Remove them
-- only after the new application is the sole writer.
drop index if exists public.idx_gmail_connections_company_email;

-- Production exposes the legacy activity identity as a standalone partial
-- unique index. Drop a same-named constraint as well for local/preview schemas
-- that may have materialized the contract differently.
alter table public.activities
  drop constraint if exists activities_email_message_id_unique;

drop index if exists public.activities_email_message_id_unique;

-- Enforce the invariant whenever an update can turn a row into a provider-
-- backed email or change its ownership. Unrelated updates to old legacy rows
-- remain possible; the review-only repair plan can populate those separately
-- without guessing historical associations.
create or replace function public.require_email_activity_connection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_connection_company_id uuid;
begin
  if new.email_connection_id is not null then
    select connection.company_id
      into v_connection_company_id
      from public.email_connections connection
     where connection.id = new.email_connection_id;

    if v_connection_company_id is null
       or v_connection_company_id is distinct from new.company_id then
      raise exception 'email activity connection must belong to activity company'
        using errcode = '23514';
    end if;
  end if;

  if new.type = 'email'
     and new.email_message_id is not null
     and btrim(new.email_message_id) <> ''
     and new.email_connection_id is null then
    raise exception 'provider-backed email activity requires email_connection_id'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists activities_require_email_connection_insert
  on public.activities;

create trigger activities_require_email_connection_insert
before insert or update of email_connection_id, company_id, type, email_message_id
on public.activities
for each row
execute function public.require_email_activity_connection();

commit;
