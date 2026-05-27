-- Lead Lifecycle P4 foundation:
-- - meaningful correspondence proof
-- - audited follow-up drafts
-- - opportunity lifecycle state
-- - company lifecycle settings
--
-- This migration is schema-only. It does not backfill or mutate production
-- opportunity data.

create table if not exists public.opportunity_correspondence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete set null,
  connection_id uuid references public.email_connections(id) on delete set null,
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
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  connection_id uuid references public.email_connections(id) on delete set null,
  provider_thread_id text,
  source_event_id uuid references public.opportunity_correspondence_events(id) on delete set null,
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
  ai_draft_history_id uuid references public.ai_draft_history(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  edited_by uuid references public.users(id) on delete set null,
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
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  last_meaningful_event_id uuid references public.opportunity_correspondence_events(id) on delete set null,
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
  company_id uuid primary key references public.companies(id) on delete cascade,
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

create or replace function public.lead_lifecycle_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
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

alter table public.opportunity_correspondence_events enable row level security;
alter table public.opportunity_follow_up_drafts enable row level security;
alter table public.opportunity_lifecycle_state enable row level security;
alter table public.lead_lifecycle_settings enable row level security;

create policy opportunity_correspondence_events_company_select
  on public.opportunity_correspondence_events
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

create policy opportunity_correspondence_events_company_insert
  on public.opportunity_correspondence_events
  for insert
  to authenticated
  with check (company_id = (select private.get_user_company_id()));

create policy opportunity_correspondence_events_company_update
  on public.opportunity_correspondence_events
  for update
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

create policy opportunity_follow_up_drafts_company_all
  on public.opportunity_follow_up_drafts
  for all
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

create policy opportunity_lifecycle_state_company_all
  on public.opportunity_lifecycle_state
  for all
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

create policy lead_lifecycle_settings_company_all
  on public.lead_lifecycle_settings
  for all
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));
