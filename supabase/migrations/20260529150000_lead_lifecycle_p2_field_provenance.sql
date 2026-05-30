-- Lead Lifecycle P2 — progressive enrichment provenance + source pointers.
--
-- ADDITIVE / iOS-SAFE. This migration only:
--   1. creates a brand-new table public.lead_field_provenance, and
--   2. adds two new NULLABLE columns to public.opportunities
--      (source_message_id text, source_metadata jsonb).
--
-- No existing column is altered, renamed, retyped, or made NOT NULL. No CHECK
-- is added to any existing iOS-synced column. iOS never reads provenance and
-- treats the two new opportunities columns as optional. Safe to apply between
-- App Store releases per the iOS-sync constraint.
--
-- This migration is schema-only. It does not backfill or mutate production
-- opportunity/client data.

-- ─── 1. New nullable columns on opportunities (S2 / S3) ──────────────────────
-- source_message_id: the exact provider message id a fact came from. Distinct
--   from source_email_id, which holds the provider THREAD id (kept as-is for
--   back-compat; not repurposed, to stay iOS-safe).
-- source_metadata: structured platform signals
--   ({platform_name, detected_via, provider_thread_id}).
alter table public.opportunities
  add column if not exists source_message_id text;

alter table public.opportunities
  add column if not exists source_metadata jsonb;

-- ─── 2. Field-level provenance table (S1) ────────────────────────────────────
create table if not exists public.lead_field_provenance (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  entity_type         text not null check (entity_type in ('opportunity', 'client')),
  entity_id           uuid not null,             -- opportunities.id or clients.id
  field_name          text not null,             -- e.g. 'address', 'estimated_value', 'contact_email'
  value_snapshot      text,                       -- value written at provenance time (audit, not source of truth)
  source              text not null check (
    source in ('operator', 'ai', 'contact_form', 'inbound', 'outbound', 'import', 'merge')
  ),
  confidence          double precision,           -- 0..1; null for operator/contact_form (treated as 1.0)
  provider_thread_id  text,                        -- proof pointer when source is email-derived
  provider_message_id text,                        -- exact message the fact came from
  actor_user_id       uuid,                        -- set when source='operator'
  extracted_at        timestamptz not null default now(),
  confirmed_by        uuid,                        -- operator who confirmed/edited
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One provenance row per (company, entity, field): the upsert target.
create unique index if not exists lead_field_provenance_entity_field_uidx
  on public.lead_field_provenance (company_id, entity_type, entity_id, field_name);

-- Lookup by entity (timeline / dossier rendering).
create index if not exists lead_field_provenance_entity_idx
  on public.lead_field_provenance (entity_type, entity_id);

-- Company-scoped scans ("show all AI-sourced fields for this company").
create index if not exists lead_field_provenance_company_source_idx
  on public.lead_field_provenance (company_id, source, extracted_at desc);

-- ─── 3. Foreign keys (idempotent) ────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_field_provenance'::regclass
      and conname = 'lead_field_provenance_company_fkey'
  ) then
    alter table public.lead_field_provenance
      add constraint lead_field_provenance_company_fkey
      foreign key (company_id)
      references public.companies(id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_field_provenance'::regclass
      and conname = 'lead_field_provenance_actor_user_fkey'
  ) then
    alter table public.lead_field_provenance
      add constraint lead_field_provenance_actor_user_fkey
      foreign key (actor_user_id)
      references public.users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_field_provenance'::regclass
      and conname = 'lead_field_provenance_confirmed_by_fkey'
  ) then
    alter table public.lead_field_provenance
      add constraint lead_field_provenance_confirmed_by_fkey
      foreign key (confirmed_by)
      references public.users(id)
      on delete set null;
  end if;
end;
$$;

-- ─── 4. updated_at touch trigger (reuses the P4 helper) ──────────────────────
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

drop trigger if exists lead_field_provenance_touch_updated_at
  on public.lead_field_provenance;
create trigger lead_field_provenance_touch_updated_at
  before update on public.lead_field_provenance
  for each row execute function public.lead_lifecycle_touch_updated_at();

-- ─── 5. RLS — company-scoped, mirroring the P4 lifecycle tables ──────────────
alter table public.lead_field_provenance enable row level security;

drop policy if exists lead_field_provenance_company_select
  on public.lead_field_provenance;
drop policy if exists lead_field_provenance_company_insert
  on public.lead_field_provenance;
drop policy if exists lead_field_provenance_company_update
  on public.lead_field_provenance;

-- Company members may read their own provenance rows.
create policy lead_field_provenance_company_select
  on public.lead_field_provenance
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

-- Authenticated operators may record provenance for their own company
-- (operator edits write source='operator' rows from the app).
create policy lead_field_provenance_company_insert
  on public.lead_field_provenance
  for insert
  to authenticated
  with check (company_id = (select private.get_user_company_id()));

create policy lead_field_provenance_company_update
  on public.lead_field_provenance
  for update
  to authenticated
  using (company_id = (select private.get_user_company_id()))
  with check (company_id = (select private.get_user_company_id()));

-- Sync/import run under the service role, which bypasses RLS; no explicit
-- service-role policy is required.
