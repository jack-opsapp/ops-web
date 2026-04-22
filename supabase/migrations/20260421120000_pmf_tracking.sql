-- ============================================================================
-- PMF Tracking Dashboard — 2026-04-21
-- Adds prospects, deals, deal events, billing events, ad spend log,
-- trial attributions, threshold snapshots, notification log.
-- ============================================================================

-- pmf_prospects ---------------------------------------------------------------
create table public.pmf_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  source text not null check (source in (
    'outbound_cold','warm_network','paid_ad','organic_search','referral','direct'
  )),
  referred_by_company_id uuid references public.companies(id),
  deal_type text not null check (deal_type in ('tier_a','base_saas')),
  first_contact_at timestamptz not null,
  first_contact_direction text not null check (first_contact_direction in ('inbound','outbound')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pmf_prospects_deal_type_first_contact on public.pmf_prospects (deal_type, first_contact_at);
create index idx_pmf_prospects_source on public.pmf_prospects (source);

-- pmf_deals -------------------------------------------------------------------
create table public.pmf_deals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.pmf_prospects(id) on delete cascade,
  stage text not null check (stage in (
    'contacted','qualified','proposal','negotiation','signed',
    'in_delivery','delivered','closed_won','closed_lost'
  )),
  stage_entered_at timestamptz not null default now(),
  deal_type text not null check (deal_type in ('tier_a','base_saas')),
  sow_signed_at timestamptz,
  sow_url text,
  implementation_fee_cents bigint,
  deposit_paid_at timestamptz,
  deposit_amount_cents bigint,
  final_paid_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pmf_deals_prospect on public.pmf_deals (prospect_id);
create index idx_pmf_deals_stage_type on public.pmf_deals (stage, deal_type);

-- pmf_deal_events -------------------------------------------------------------
create table public.pmf_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.pmf_deals(id) on delete cascade,
  event_type text not null check (event_type in (
    'stage_change','note','sow_signed','payment_received','delivered','closed'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_pmf_deal_events_deal on public.pmf_deal_events (deal_id, occurred_at desc);

-- Trigger: log stage changes automatically
create or replace function public.pmf_log_deal_stage_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.pmf_deal_events (deal_id, event_type, payload, occurred_at)
    values (new.id, 'stage_change',
            jsonb_build_object('from', old.stage, 'to', new.stage),
            now());
    new.stage_entered_at := now();
  end if;
  return new;
end $$;

create trigger pmf_deals_stage_change
  before update on public.pmf_deals
  for each row execute function public.pmf_log_deal_stage_change();

-- billing_events --------------------------------------------------------------
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_customer_id text,
  company_id uuid references public.companies(id),
  amount_cents bigint,
  currency text default 'usd',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw jsonb not null
);
create index idx_billing_events_customer_time on public.billing_events (stripe_customer_id, occurred_at desc);
create index idx_billing_events_company_type_time on public.billing_events (company_id, event_type, occurred_at desc);
create index idx_billing_events_type_time on public.billing_events (event_type, occurred_at desc);

-- ad_spend_log ----------------------------------------------------------------
create table public.ad_spend_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('google_ads','meta_ads','apple_search_ads','other')),
  spend_date date not null,
  spend_cents bigint not null check (spend_cents >= 0),
  impressions bigint,
  clicks bigint,
  downloads bigint,
  source text not null check (source in ('auto_sync','manual_entry')),
  entered_by text,
  created_at timestamptz not null default now(),
  unique (channel, spend_date)
);
create index idx_ad_spend_log_date on public.ad_spend_log (spend_date);

-- trial_attributions ----------------------------------------------------------
create table public.trial_attributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) unique,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  fbclid text,
  landing_url text,
  trial_started_at timestamptz not null,
  first_paid_at timestamptz,
  attributed_channel text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trial_attributions_channel_paid on public.trial_attributions (attributed_channel, first_paid_at);
create index idx_trial_attributions_started on public.trial_attributions (trial_started_at);

-- Trigger: set trial_attributions.first_paid_at on first invoice.paid for a company
create or replace function public.pmf_update_first_paid_at()
returns trigger language plpgsql as $$
begin
  if new.event_type = 'invoice.paid' and new.company_id is not null then
    update public.trial_attributions
       set first_paid_at = new.occurred_at,
           updated_at = now()
     where company_id = new.company_id
       and first_paid_at is null;
  end if;
  return new;
end $$;

create trigger billing_events_first_paid
  after insert on public.billing_events
  for each row execute function public.pmf_update_first_paid_at();

-- pmf_threshold_snapshots -----------------------------------------------------
create table public.pmf_threshold_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  state jsonb not null
);
create index idx_pmf_threshold_snapshots_captured on public.pmf_threshold_snapshots (captured_at desc);

-- pmf_notification_log --------------------------------------------------------
create table public.pmf_notification_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('threshold_alert','daily_digest','weekly_digest')),
  trigger text not null,
  channel text not null check (channel in ('sms','email','in_app')),
  recipient text not null,
  payload jsonb not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index idx_pmf_notification_log_kind_trigger_time on public.pmf_notification_log (kind, trigger, created_at desc);

-- RLS -------------------------------------------------------------------------
alter table public.pmf_prospects            enable row level security;
alter table public.pmf_deals                enable row level security;
alter table public.pmf_deal_events          enable row level security;
alter table public.billing_events           enable row level security;
alter table public.ad_spend_log             enable row level security;
alter table public.trial_attributions       enable row level security;
alter table public.pmf_threshold_snapshots  enable row level security;
alter table public.pmf_notification_log     enable row level security;

-- Helper: is_admin()
create or replace function public.pmf_is_admin(user_email text)
returns boolean language sql stable as $$
  select exists (select 1 from public.admins where email = user_email);
$$;

-- Policy template applied per table
do $$
declare t text;
begin
  foreach t in array array[
    'pmf_prospects','pmf_deals','pmf_deal_events','billing_events',
    'ad_spend_log','trial_attributions','pmf_threshold_snapshots','pmf_notification_log'
  ]
  loop
    execute format($f$
      create policy %I_admin_all on public.%I
        for all using (public.pmf_is_admin(auth.jwt() ->> 'email'))
        with check (public.pmf_is_admin(auth.jwt() ->> 'email'));
    $f$, t, t);
  end loop;
end $$;

-- updated_at trigger for prospects
create or replace function public.pmf_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger pmf_prospects_touch before update on public.pmf_prospects
  for each row execute function public.pmf_touch_updated_at();

create trigger pmf_deals_touch before update on public.pmf_deals
  for each row execute function public.pmf_touch_updated_at();
