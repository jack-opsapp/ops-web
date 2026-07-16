begin;

-- Phase C milestone state belongs to the exact OPS actor using a mailbox. It
-- is deliberately separate from email_connections.auto_send_settings, which
-- remains connection-wide transport/category configuration for shared and
-- personal mailboxes. email_connections still carries legacy text company/user
-- IDs, so tenant integrity is enforced against canonical UUID string forms.

create table public.email_autonomy_milestones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  draft_available_shown boolean not null default false,
  auto_draft_suggested boolean not null default false,
  auto_send_suggested boolean not null default false,
  comms_wizard_ready_shown boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connection_id, user_id),
  constraint email_autonomy_milestones_user_company_fkey
    foreign key (company_id, user_id)
    references public.users(company_id, id)
    on delete cascade
);

create index email_autonomy_milestones_user_lookup_idx
  on public.email_autonomy_milestones
  (company_id, user_id, updated_at desc);

alter table public.email_autonomy_milestones enable row level security;

-- This ledger is consumed only by authenticated server routes and workers.
-- No browser role receives a policy or table privilege.
revoke all on table public.email_autonomy_milestones from public;
revoke all on table public.email_autonomy_milestones from anon, authenticated;
grant select, insert, update, delete on table public.email_autonomy_milestones to service_role;

comment on table public.email_autonomy_milestones is
  'Server-only Phase C milestone state keyed by mailbox connection and canonical OPS actor UUID.';

create or replace function private.enforce_email_autonomy_milestone_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.email_connections connection
    where connection.id = new.connection_id
      and connection.company_id = new.company_id::text
  ) then
    raise exception 'email_autonomy_milestone_connection_tenant_invalid';
  end if;

  if not exists (
    select 1
    from public.users actor
    where actor.id = new.user_id
      and actor.company_id = new.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    raise exception 'email_autonomy_milestone_actor_tenant_invalid';
  end if;

  return new;
end;
$$;

create trigger email_autonomy_milestones_tenant_integrity
before insert or update of company_id, connection_id, user_id
on public.email_autonomy_milestones
for each row
execute function private.enforce_email_autonomy_milestone_tenant_integrity();

revoke all on function private.enforce_email_autonomy_milestone_tenant_integrity()
  from public, anon, authenticated, service_role;

-- A legacy milestone can be attributed safely only when the mailbox is a
-- personal connection with a canonical active OPS owner. Shared-company
-- mailbox flags are intentionally not copied because their actor is unknown.
insert into public.email_autonomy_milestones (
  company_id,
  connection_id,
  user_id,
  draft_available_shown,
  auto_draft_suggested,
  auto_send_suggested,
  comms_wizard_ready_shown
)
select
  actor.company_id,
  connection.id,
  actor.id,
  coalesce(
    connection.auto_send_settings -> 'milestones' ->> 'draft_available_shown',
    'false'
  ) = 'true',
  coalesce(
    connection.auto_send_settings -> 'milestones' ->> 'auto_draft_suggested',
    'false'
  ) = 'true',
  coalesce(
    connection.auto_send_settings -> 'milestones' ->> 'auto_send_suggested',
    'false'
  ) = 'true',
  coalesce(
    connection.auto_send_settings -> 'milestones' ->> 'comms_wizard_ready_shown',
    'false'
  ) = 'true'
from public.email_connections connection
join public.users actor
  on connection.user_id = actor.id::text
 and connection.company_id = actor.company_id::text
where connection.type::text = 'individual'
  and connection.user_id = actor.id::text
  and actor.deleted_at is null
  and coalesce(actor.is_active, false)
on conflict (company_id, connection_id, user_id) do nothing;

-- Atomically records the actor milestone and its durable notification. If the
-- notification insert fails, the milestone update rolls back in the same
-- transaction, so a later retry can complete without losing or duplicating the
-- transition.
create or replace function public.record_email_autonomy_milestone(
  p_company_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_milestone text,
  p_title text,
  p_body text,
  p_action_url text default null,
  p_action_label text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_dedupe_key text;
begin
  if p_company_id is null
     or p_connection_id is null
     or p_user_id is null then
    raise exception 'email_autonomy_milestone_identity_required';
  end if;

  if p_milestone not in (
    'draft_available_shown',
    'auto_draft_suggested',
    'auto_send_suggested',
    'comms_wizard_ready_shown'
  ) then
    raise exception 'email_autonomy_milestone_invalid';
  end if;

  if nullif(btrim(p_title), '') is null
     or nullif(btrim(p_body), '') is null then
    raise exception 'email_autonomy_milestone_notification_required';
  end if;

  if not exists (
    select 1
    from public.users actor
    where actor.id = p_user_id
      and actor.company_id = p_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    raise exception 'email_autonomy_milestone_actor_invalid';
  end if;

  if not exists (
    select 1
    from public.email_connections connection
    where connection.id = p_connection_id
      and connection.company_id = p_company_id::text
  ) then
    raise exception 'email_autonomy_milestone_connection_invalid';
  end if;

  insert into public.email_autonomy_milestones (
    company_id,
    connection_id,
    user_id
  )
  values (
    p_company_id,
    p_connection_id,
    p_user_id
  )
  on conflict (company_id, connection_id, user_id) do nothing;

  update public.email_autonomy_milestones milestone
  set
    draft_available_shown =
      milestone.draft_available_shown
      or p_milestone = 'draft_available_shown',
    auto_draft_suggested =
      milestone.auto_draft_suggested
      or p_milestone = 'auto_draft_suggested',
    auto_send_suggested =
      milestone.auto_send_suggested
      or p_milestone = 'auto_send_suggested',
    comms_wizard_ready_shown =
      milestone.comms_wizard_ready_shown
      or p_milestone = 'comms_wizard_ready_shown',
    updated_at = clock_timestamp()
  where milestone.company_id = p_company_id
    and milestone.connection_id = p_connection_id
    and milestone.user_id = p_user_id
    and (
      (p_milestone = 'draft_available_shown'
        and not milestone.draft_available_shown)
      or (p_milestone = 'auto_draft_suggested'
        and not milestone.auto_draft_suggested)
      or (p_milestone = 'auto_send_suggested'
        and not milestone.auto_send_suggested)
      or (p_milestone = 'comms_wizard_ready_shown'
        and not milestone.comms_wizard_ready_shown)
    );

  if not found then
    return false;
  end if;

  v_dedupe_key :=
    'email-autonomy-milestone:'
    || p_company_id::text || ':'
    || p_connection_id::text || ':'
    || p_user_id::text || ':'
    || p_milestone;

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
    dedupe_key
  )
  values (
    p_user_id::text,
    p_company_id::text,
    'ai_milestone',
    btrim(p_title),
    btrim(p_body),
    false,
    true,
    nullif(btrim(p_action_url), ''),
    nullif(btrim(p_action_label), ''),
    v_dedupe_key
  )
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.record_email_autonomy_milestone(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.record_email_autonomy_milestone(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) to service_role;

commit;
