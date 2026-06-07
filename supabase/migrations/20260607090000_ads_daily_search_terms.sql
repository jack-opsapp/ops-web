create table if not exists public.ads_daily_search_term (
  date date not null,
  search_term text not null,
  campaign_name text not null,
  ad_group_name text not null default '',
  spend numeric not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric not null default 0,
  cpa numeric not null default 0,
  ctr numeric not null default 0,
  waste_flag text,
  synced_at timestamptz not null default now(),
  primary key (date, search_term, campaign_name, ad_group_name)
);

alter table public.ads_daily_search_term enable row level security;

create policy "service role manages ads_daily_search_term"
  on public.ads_daily_search_term
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists ads_daily_search_term_date_idx
  on public.ads_daily_search_term (date desc);

create index if not exists ads_daily_search_term_spend_idx
  on public.ads_daily_search_term (spend desc);
