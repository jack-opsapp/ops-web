begin;

create table if not exists public.deck_zoning_parcel_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  jurisdiction_id text,
  normalized_site_address text not null,
  parcel_zoning jsonb not null,
  source_status text not null default 'available'
    check (source_status in ('available', 'partial', 'userEntered')),
  provider text default 'ops_verified_cache',
  source_url text,
  retrieved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint deck_zoning_parcel_records_address_present
    check (btrim(normalized_site_address) <> ''),
  constraint deck_zoning_parcel_records_parcel_zoning_object
    check (jsonb_typeof(parcel_zoning) = 'object')
);

comment on table public.deck_zoning_parcel_records is
  'Verified parcel zoning payloads returned by POST /api/decks/zoning/parcel. Service-role only; no client-side Data API access.';

comment on column public.deck_zoning_parcel_records.parcel_zoning is
  'DeckKit ParcelZoningPlan JSON. Values must be verified source data or user-entered/manual data, never inferred code criteria.';

create unique index if not exists deck_zoning_parcel_records_active_unique_idx
  on public.deck_zoning_parcel_records (
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_site_address,
    coalesce(jurisdiction_id, '')
  )
  where deleted_at is null;

create index if not exists deck_zoning_parcel_records_lookup_idx
  on public.deck_zoning_parcel_records (
    normalized_site_address,
    jurisdiction_id,
    company_id,
    updated_at desc
  )
  where deleted_at is null;

drop trigger if exists deck_zoning_parcel_records_set_updated_at
  on public.deck_zoning_parcel_records;
create trigger deck_zoning_parcel_records_set_updated_at
  before update on public.deck_zoning_parcel_records
  for each row execute function public.fn_set_updated_at();

alter table public.deck_zoning_parcel_records enable row level security;

revoke all on table public.deck_zoning_parcel_records from anon, authenticated;
grant all on table public.deck_zoning_parcel_records to service_role;

commit;
