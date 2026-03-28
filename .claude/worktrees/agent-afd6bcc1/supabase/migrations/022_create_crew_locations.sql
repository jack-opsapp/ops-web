-- Migration: Create crew_locations table
-- Mobile app upserts crew positions; web reads for map display.

create table if not exists public.crew_locations (
  user_id       uuid        not null references public.users(id) on delete cascade,
  org_id        uuid        not null references public.companies(id) on delete cascade,
  first_name    text        not null default '',
  last_name     text,
  lat           double precision not null,
  lng           double precision not null,
  heading       double precision,
  speed         double precision,
  accuracy      double precision,
  battery_level double precision,
  is_background boolean     not null default false,
  current_task_name       text,
  current_project_name    text,
  current_project_id      uuid,
  current_project_address text,
  phone_number  text,
  updated_at    timestamptz not null default now(),

  primary key (user_id)
);

-- Index for org-level queries (the standard access pattern)
create index if not exists idx_crew_locations_org_id on public.crew_locations(org_id);

-- RLS
alter table public.crew_locations enable row level security;

-- Authenticated users can read crew locations within their org
create policy "Users can read crew locations in their org"
  on public.crew_locations for select
  using (
    org_id in (
      select u.company_id from public.users u where u.firebase_uid = auth.uid()::text
    )
  );

-- Service role can insert/update (mobile app writes via service key)
create policy "Service role full access to crew_locations"
  on public.crew_locations for all
  using (true)
  with check (true);
