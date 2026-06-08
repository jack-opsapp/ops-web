-- ads_daily_search_term: daily Google Ads search-term performance, synced server-side.
--
-- Server-only table — written and read exclusively by the service-role admin client
-- (getAdminSupabase, which bypasses RLS). Matches the lockdown of its siblings
-- ads_daily_account / ads_daily_campaign / ads_daily_keyword / ads_sync_status.
--
-- Hardening follows 20260601163600_rls_no_policy_revoke_client_grants: enable RLS so
-- anon/authenticated are default-denied, AND revoke their grants to make the deny-all
-- explicit (removing the latent risk of a stray permissive policy ever exposing the
-- table). No policy is required — service_role retains access via rolbypassrls=true.
-- We deliberately do NOT use auth.role(): it is deprecated by Supabase and passes
-- silently for the 'authenticated' Postgres role when anonymous sign-ins are enabled.
--
-- Fully idempotent: safe to re-run via apply_migration or `supabase db push`.

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

-- Explicit deny-all for client roles. No policy is defined; service_role bypasses RLS.
revoke all on public.ads_daily_search_term from anon, authenticated;

create index if not exists ads_daily_search_term_date_idx
  on public.ads_daily_search_term (date desc);

create index if not exists ads_daily_search_term_spend_idx
  on public.ads_daily_search_term (spend desc);
