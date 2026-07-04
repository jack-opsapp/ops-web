begin;

-- Atomic, race-free out-of-order guard for the Deckset entitlement mirror.
--
-- The webhook previously read deck_subscriptions.last_event_at, compared it in
-- JS, then upserted — a read-then-write with a TOCTOU window: two concurrent
-- same-company deliveries (a stale subscription.updated and a newer
-- cancellation) could interleave so the stale one commits last and resurrects
-- Pro for free. This function collapses the guard into ONE statement: the
-- ON CONFLICT ... DO UPDATE ... WHERE runs under the row lock the conflict
-- takes, so the newer event always wins regardless of arrival order.
--
-- Returns true when the row was written (fresh insert, or the incoming event
-- is >= the stored one), false when skipped as stale. Service-role only — the
-- Stripe webhook is the sole caller.

create or replace function public.mirror_deck_subscription(p_row jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rec public.deck_subscriptions;
  v_count integer;
begin
  v_rec := jsonb_populate_record(null::public.deck_subscriptions, p_row);

  if v_rec.company_id is null then
    raise exception 'mirror_deck_subscription: company_id is required';
  end if;
  if v_rec.last_event_at is null then
    raise exception 'mirror_deck_subscription: last_event_at is required';
  end if;

  insert into public.deck_subscriptions as ds (
    company_id, entitlement, status, product_id, store, provider,
    customer_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    stripe_checkout_session_id, current_period_end, expires_at,
    last_event_at, deleted_at
  ) values (
    v_rec.company_id, v_rec.entitlement, v_rec.status, v_rec.product_id,
    v_rec.store, v_rec.provider, v_rec.customer_id, v_rec.stripe_customer_id,
    v_rec.stripe_subscription_id, v_rec.stripe_price_id,
    v_rec.stripe_checkout_session_id, v_rec.current_period_end,
    v_rec.expires_at, v_rec.last_event_at, v_rec.deleted_at
  )
  on conflict (company_id) do update set
    entitlement                = excluded.entitlement,
    status                     = excluded.status,
    product_id                 = excluded.product_id,
    store                      = excluded.store,
    provider                   = excluded.provider,
    customer_id                = excluded.customer_id,
    stripe_customer_id         = excluded.stripe_customer_id,
    stripe_subscription_id     = excluded.stripe_subscription_id,
    stripe_price_id            = excluded.stripe_price_id,
    stripe_checkout_session_id = excluded.stripe_checkout_session_id,
    current_period_end         = excluded.current_period_end,
    expires_at                 = excluded.expires_at,
    last_event_at              = excluded.last_event_at,
    deleted_at                 = excluded.deleted_at
  -- <= so a same-second event (Stripe's 1s granularity) still applies and a
  -- re-delivery of the same event is a harmless idempotent rewrite; a strictly
  -- newer stored event skips.
  where ds.last_event_at <= excluded.last_event_at;

  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

comment on function public.mirror_deck_subscription(jsonb) is
  'Atomic out-of-order-safe upsert of the Deckset entitlement mirror. Skips writes older than the stored last_event_at. Service-role only (Stripe webhook).';

revoke all on function public.mirror_deck_subscription(jsonb)
  from public, anon, authenticated;
grant execute on function public.mirror_deck_subscription(jsonb) to service_role;

commit;
