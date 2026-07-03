begin;

create table if not exists public.deck_subscriptions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  entitlement text not null default 'deck_pro'
    check (entitlement = 'deck_pro'),
  status text not null
    check (status in ('active', 'trialing', 'in_grace', 'expired', 'cancelled', 'revoked')),
  product_id text not null,
  store text not null default 'stripe'
    check (store in ('stripe', 'app_store', 'play_store', 'manual')),
  provider text not null default 'stripe'
    check (provider in ('stripe', 'revenuecat', 'manual')),
  customer_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  stripe_checkout_session_id text,
  current_period_end timestamptz,
  expires_at timestamptz,
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.deck_subscriptions is
  'Standalone Deckset Pro entitlement mirror. Stripe/webhook owned; separate from companies.subscription_* so Deckset billing cannot affect OPS lockout state.';

comment on column public.deck_subscriptions.entitlement is
  'Deckset entitlement key consumed by app clients. P0 ships deck_pro only.';

comment on column public.deck_subscriptions.status is
  'Deckset entitlement status. active, trialing, and in_grace unlock Pro; other values keep the free 1-deck gate.';

create unique index if not exists deck_subscriptions_stripe_subscription_uidx
  on public.deck_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists deck_subscriptions_active_lookup_idx
  on public.deck_subscriptions(company_id, status, updated_at desc)
  where deleted_at is null;

drop trigger if exists deck_subscriptions_set_updated_at
  on public.deck_subscriptions;
create trigger deck_subscriptions_set_updated_at
  before update on public.deck_subscriptions
  for each row execute function public.fn_set_updated_at();

alter table public.deck_subscriptions enable row level security;

drop policy if exists deck_subscriptions_company_read
  on public.deck_subscriptions;
create policy deck_subscriptions_company_read
  on public.deck_subscriptions
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

revoke all on table public.deck_subscriptions from anon, authenticated;
grant select on table public.deck_subscriptions to authenticated;
grant all on table public.deck_subscriptions to service_role;

commit;
