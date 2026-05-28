-- Lead Lifecycle P4 foundation:
-- - meaningful correspondence proof
-- - audited follow-up drafts
-- - opportunity lifecycle state
-- - company lifecycle settings
--
-- This migration is schema-only. It does not backfill or mutate production
-- opportunity data.

-- Composite foreign keys below need tenant-paired uniqueness on referenced
-- company-owned tables. These indexes are additive and cannot introduce a new
-- duplicate failure because each target table already has a globally unique id.
create unique index if not exists opportunities_company_id_id_uidx
  on public.opportunities (company_id, id);

create unique index if not exists activities_company_id_id_uidx
  on public.activities (company_id, id);

create unique index if not exists ai_draft_history_company_id_id_uidx
  on public.ai_draft_history (company_id, id);

create unique index if not exists users_company_id_id_uidx
  on public.users (company_id, id);

create unique index if not exists clients_company_id_id_uidx
  on public.clients (company_id, id);

create unique index if not exists sub_clients_company_id_id_uidx
  on public.sub_clients (company_id, id);

create table if not exists public.opportunity_correspondence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  opportunity_id uuid not null,
  activity_id uuid,
  connection_id uuid,
  provider_thread_id text not null,
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  party_role text not null check (
    party_role in (
      'customer',
      'ops',
      'internal',
      'provider',
      'system',
      'marketing',
      'unknown'
    )
  ),
  is_meaningful boolean not null,
  noise_reason text check (
    noise_reason is null
    or noise_reason in (
      'provider_noise',
      'bounce',
      'internal_system',
      'duplicate_provider_message_id',
      'marketing_noise',
      'missing_provider_id'
    )
  ),
  occurred_at timestamptz not null,
  linked_contact_kind text check (
    linked_contact_kind is null
    or linked_contact_kind in (
      'customer',
      'client',
      'sub_client',
      'related_contact',
      'high_confidence_related_contact',
      'unknown'
    )
  ),
  linked_contact_id uuid,
  source text not null,
  subject text,
  from_email text,
  to_emails text[] not null default '{}'::text[],
  cc_emails text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create unique index if not exists opportunity_correspondence_events_company_id_id_uidx
  on public.opportunity_correspondence_events (company_id, id);

create unique index if not exists opportunity_correspondence_events_provider_message_uidx
  on public.opportunity_correspondence_events (
    company_id,
    coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider_message_id
  )
  where provider_message_id is not null;

create index if not exists opportunity_correspondence_events_opportunity_time_idx
  on public.opportunity_correspondence_events (opportunity_id, occurred_at desc);

create index if not exists opportunity_correspondence_events_company_meaningful_idx
  on public.opportunity_correspondence_events (company_id, is_meaningful, occurred_at desc);

create table if not exists public.opportunity_follow_up_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  opportunity_id uuid not null,
  connection_id uuid,
  provider_thread_id text,
  source_event_id uuid,
  origin text not null check (
    origin in ('operator', 'template_follow_up', 'phase_c', 'system_handoff')
  ),
  sequence_number integer check (sequence_number is null or sequence_number > 0),
  subject text not null default '',
  original_body text not null,
  current_body text,
  final_sent_body text,
  status text not null default 'drafted' check (
    status in ('drafted', 'sent', 'discarded', 'superseded', 'archived')
  ),
  provider_draft_id text,
  ai_draft_history_id uuid,
  created_by uuid,
  edited_by uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  sent_at timestamptz,
  discarded_at timestamptz,
  superseded_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists opportunity_follow_up_drafts_opportunity_status_idx
  on public.opportunity_follow_up_drafts (opportunity_id, status, created_at desc);

create index if not exists opportunity_follow_up_drafts_thread_idx
  on public.opportunity_follow_up_drafts (connection_id, provider_thread_id, created_at desc)
  where provider_thread_id is not null;

create unique index if not exists opportunity_follow_up_drafts_open_template_uidx
  on public.opportunity_follow_up_drafts (company_id, opportunity_id, origin)
  where origin = 'template_follow_up' and status = 'drafted';

create table if not exists public.opportunity_lifecycle_state (
  opportunity_id uuid primary key,
  company_id uuid not null,
  last_meaningful_event_id uuid,
  last_meaningful_at timestamptz,
  last_meaningful_direction text check (
    last_meaningful_direction is null
    or last_meaningful_direction in ('inbound', 'outbound')
  ),
  unanswered_follow_up_count integer not null default 0 check (unanswered_follow_up_count >= 0),
  second_follow_up_sent_at timestamptz,
  operator_follow_up_miss_at timestamptz,
  stale_status text check (
    stale_status is null
    or stale_status in (
      'follow_up_draft_due',
      'archive_due_two_unanswered',
      'archive_due_no_correspondence',
      'operator_follow_up_miss',
      'lost_due_operator_no_response',
      'reactivation_due',
      'clear'
    )
  ),
  stale_status_at timestamptz,
  protected_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists opportunity_lifecycle_state_company_status_idx
  on public.opportunity_lifecycle_state (company_id, stale_status, updated_at desc);

create index if not exists opportunity_lifecycle_state_last_meaningful_idx
  on public.opportunity_lifecycle_state (company_id, last_meaningful_at desc);

create table if not exists public.lead_lifecycle_settings (
  company_id uuid primary key,
  follow_up_after_days integer not null default 7 check (follow_up_after_days > 0),
  second_follow_up_archive_after_days integer not null default 7 check (second_follow_up_archive_after_days > 0),
  no_correspondence_archive_days integer not null default 14 check (no_correspondence_archive_days > 0),
  inbound_unreplied_lost_days integer not null default 30 check (inbound_unreplied_lost_days > 0),
  follow_up_template_subject text not null default '',
  follow_up_template_body text not null default 'Hey there {{first_name}}, just following up on this as I didn''t see anything back from you.',
  auto_archive_enabled boolean not null default true,
  auto_lost_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_correspondence_events'::regclass
      and conname = 'opportunity_correspondence_events_company_fkey'
  ) then
    alter table public.opportunity_correspondence_events
      add constraint opportunity_correspondence_events_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_correspondence_events'::regclass
      and conname = 'opportunity_correspondence_events_opportunity_company_fkey'
  ) then
    alter table public.opportunity_correspondence_events
      add constraint opportunity_correspondence_events_opportunity_company_fkey
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_correspondence_events'::regclass
      and conname = 'opportunity_correspondence_events_activity_company_fkey'
  ) then
    alter table public.opportunity_correspondence_events
      add constraint opportunity_correspondence_events_activity_company_fkey
      foreign key (company_id, activity_id)
      references public.activities(company_id, id)
      on delete set null (activity_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_correspondence_events'::regclass
      and conname = 'opportunity_correspondence_events_connection_fkey'
  ) then
    alter table public.opportunity_correspondence_events
      add constraint opportunity_correspondence_events_connection_fkey
      foreign key (connection_id)
      references public.email_connections(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_opportunity_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_opportunity_company_fkey
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_connection_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_connection_fkey
      foreign key (connection_id)
      references public.email_connections(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_source_event_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_source_event_company_fkey
      foreign key (company_id, source_event_id)
      references public.opportunity_correspondence_events(company_id, id)
      on delete set null (source_event_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_ai_draft_history_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_ai_draft_history_company_fkey
      foreign key (company_id, ai_draft_history_id)
      references public.ai_draft_history(company_id, id)
      on delete set null (ai_draft_history_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_created_by_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_created_by_company_fkey
      foreign key (company_id, created_by)
      references public.users(company_id, id)
      on delete set null (created_by);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_follow_up_drafts'::regclass
      and conname = 'opportunity_follow_up_drafts_edited_by_company_fkey'
  ) then
    alter table public.opportunity_follow_up_drafts
      add constraint opportunity_follow_up_drafts_edited_by_company_fkey
      foreign key (company_id, edited_by)
      references public.users(company_id, id)
      on delete set null (edited_by);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_lifecycle_state'::regclass
      and conname = 'opportunity_lifecycle_state_company_fkey'
  ) then
    alter table public.opportunity_lifecycle_state
      add constraint opportunity_lifecycle_state_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_lifecycle_state'::regclass
      and conname = 'opportunity_lifecycle_state_opportunity_company_fkey'
  ) then
    alter table public.opportunity_lifecycle_state
      add constraint opportunity_lifecycle_state_opportunity_company_fkey
      foreign key (company_id, opportunity_id)
      references public.opportunities(company_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opportunity_lifecycle_state'::regclass
      and conname = 'opportunity_lifecycle_state_last_meaningful_event_company_fkey'
  ) then
    alter table public.opportunity_lifecycle_state
      add constraint opportunity_lifecycle_state_last_meaningful_event_company_fkey
      foreign key (company_id, last_meaningful_event_id)
      references public.opportunity_correspondence_events(company_id, id)
      on delete set null (last_meaningful_event_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_lifecycle_settings'::regclass
      and conname = 'lead_lifecycle_settings_company_fkey'
  ) then
    alter table public.lead_lifecycle_settings
      add constraint lead_lifecycle_settings_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;
end;
$$;

create or replace function public.lead_lifecycle_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.lead_lifecycle_enforce_connection_company()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  connection_company_id text;
begin
  if new.connection_id is null then
    return new;
  end if;

  select email_connections.company_id
    into connection_company_id
    from public.email_connections
   where email_connections.id = new.connection_id;

  -- The plain FK reports missing connections. This trigger only validates the
  -- tenant match that cannot be expressed as a composite FK because
  -- email_connections.company_id is text in the live schema.
  if connection_company_id is null then
    return new;
  end if;

  if connection_company_id <> new.company_id::text then
    raise exception 'lead lifecycle connection company mismatch on %.connection_id: connection % belongs to company %, row belongs to company %',
      tg_table_name,
      new.connection_id,
      connection_company_id,
      new.company_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.lead_lifecycle_enforce_linked_contact_company()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  linked_contact_exists boolean;
begin
  if new.linked_contact_id is null then
    return new;
  end if;

  case new.linked_contact_kind
    when 'client' then
      select exists (
        select 1
          from public.clients
         where clients.id = new.linked_contact_id
           and clients.company_id = new.company_id
      ) into linked_contact_exists;
    when 'sub_client' then
      select exists (
        select 1
          from public.sub_clients
         where sub_clients.id = new.linked_contact_id
           and sub_clients.company_id = new.company_id
      ) into linked_contact_exists;
    else
      raise exception 'lead lifecycle linked_contact_id requires linked_contact_kind client or sub_client until a concrete related-contact table exists'
        using errcode = '23514';
  end case;

  if not linked_contact_exists then
    raise exception 'lead lifecycle linked contact company mismatch on %.linked_contact_id: kind %, id %, row company %',
      tg_table_name,
      new.linked_contact_kind,
      new.linked_contact_id,
      new.company_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
      from public.opportunity_correspondence_events event
      join public.email_connections connection
        on connection.id = event.connection_id
     where event.connection_id is not null
       and connection.company_id <> event.company_id::text
  ) then
    raise exception 'existing opportunity_correspondence_events rows contain cross-company connection references';
  end if;

  if exists (
    select 1
      from public.opportunity_follow_up_drafts draft
      join public.email_connections connection
        on connection.id = draft.connection_id
     where draft.connection_id is not null
       and connection.company_id <> draft.company_id::text
  ) then
    raise exception 'existing opportunity_follow_up_drafts rows contain cross-company connection references';
  end if;

  if exists (
    select 1
      from public.opportunity_correspondence_events event
      left join public.clients client
        on client.id = event.linked_contact_id
       and client.company_id = event.company_id
     where event.linked_contact_id is not null
       and event.linked_contact_kind = 'client'
       and client.id is null
  ) then
    raise exception 'existing opportunity_correspondence_events rows contain cross-company client linked-contact references';
  end if;

  if exists (
    select 1
      from public.opportunity_correspondence_events event
      left join public.sub_clients sub_client
        on sub_client.id = event.linked_contact_id
       and sub_client.company_id = event.company_id
     where event.linked_contact_id is not null
       and event.linked_contact_kind = 'sub_client'
       and sub_client.id is null
  ) then
    raise exception 'existing opportunity_correspondence_events rows contain cross-company sub-client linked-contact references';
  end if;

  if exists (
    select 1
      from public.opportunity_correspondence_events event
     where event.linked_contact_id is not null
       and (
         event.linked_contact_kind is null
         or event.linked_contact_kind not in ('client', 'sub_client')
       )
  ) then
    raise exception 'existing opportunity_correspondence_events rows contain linked-contact ids without a concrete relational target';
  end if;
end;
$$;

drop trigger if exists opportunity_follow_up_drafts_touch_updated_at
  on public.opportunity_follow_up_drafts;
create trigger opportunity_follow_up_drafts_touch_updated_at
  before update on public.opportunity_follow_up_drafts
  for each row execute function public.lead_lifecycle_touch_updated_at();

drop trigger if exists opportunity_lifecycle_state_touch_updated_at
  on public.opportunity_lifecycle_state;
create trigger opportunity_lifecycle_state_touch_updated_at
  before update on public.opportunity_lifecycle_state
  for each row execute function public.lead_lifecycle_touch_updated_at();

drop trigger if exists lead_lifecycle_settings_touch_updated_at
  on public.lead_lifecycle_settings;
create trigger lead_lifecycle_settings_touch_updated_at
  before update on public.lead_lifecycle_settings
  for each row execute function public.lead_lifecycle_touch_updated_at();

drop trigger if exists opportunity_correspondence_events_connection_company_guard
  on public.opportunity_correspondence_events;
create trigger opportunity_correspondence_events_connection_company_guard
  before insert or update of company_id, connection_id on public.opportunity_correspondence_events
  for each row execute function public.lead_lifecycle_enforce_connection_company();

drop trigger if exists opportunity_correspondence_events_linked_contact_company_guard
  on public.opportunity_correspondence_events;
create trigger opportunity_correspondence_events_linked_contact_company_guard
  before insert or update of company_id, linked_contact_kind, linked_contact_id on public.opportunity_correspondence_events
  for each row execute function public.lead_lifecycle_enforce_linked_contact_company();

drop trigger if exists opportunity_follow_up_drafts_connection_company_guard
  on public.opportunity_follow_up_drafts;
create trigger opportunity_follow_up_drafts_connection_company_guard
  before insert or update of company_id, connection_id on public.opportunity_follow_up_drafts
  for each row execute function public.lead_lifecycle_enforce_connection_company();

alter table public.opportunity_correspondence_events enable row level security;
alter table public.opportunity_follow_up_drafts enable row level security;
alter table public.opportunity_lifecycle_state enable row level security;
alter table public.lead_lifecycle_settings enable row level security;

drop policy if exists opportunity_correspondence_events_company_select
  on public.opportunity_correspondence_events;
drop policy if exists opportunity_correspondence_events_company_insert
  on public.opportunity_correspondence_events;
drop policy if exists opportunity_correspondence_events_company_update
  on public.opportunity_correspondence_events;
drop policy if exists opportunity_follow_up_drafts_company_all
  on public.opportunity_follow_up_drafts;
drop policy if exists opportunity_follow_up_drafts_company_select
  on public.opportunity_follow_up_drafts;
drop policy if exists opportunity_lifecycle_state_company_all
  on public.opportunity_lifecycle_state;
drop policy if exists opportunity_lifecycle_state_company_select
  on public.opportunity_lifecycle_state;
drop policy if exists lead_lifecycle_settings_company_all
  on public.lead_lifecycle_settings;
drop policy if exists lead_lifecycle_settings_company_select
  on public.lead_lifecycle_settings;

create policy opportunity_correspondence_events_company_select
  on public.opportunity_correspondence_events
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

create policy opportunity_follow_up_drafts_company_select
  on public.opportunity_follow_up_drafts
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

create policy opportunity_lifecycle_state_company_select
  on public.opportunity_lifecycle_state
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

create policy lead_lifecycle_settings_company_select
  on public.lead_lifecycle_settings
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));
