-- Google Ads engine, phase 1: conversion outbox + click-id columns + activation trigger.
--
-- Three business moments become Google conversions — company created
-- (trial_started), first real project (trial_activated), first invoice.paid
-- (paid) — by enqueueing a row into ads_conversion_events from the trigger that
-- already observes each moment. An hourly cron sends the queue to the Data
-- Manager API. Triggers never abort the business write they observe: every
-- enqueue is exception-wrapped and idempotent on transaction_id.
--
-- Server-only tables, hardened like their ads_daily_* siblings (RLS on, client
-- grants revoked, service_role bypasses). Fully idempotent: safe to re-run.

begin;

-- ─── Conversion actions ledger ───────────────────────────────────────────────
-- The Google resource names of the three OPS UPLOAD_CLICKS actions, recorded by
-- /api/internal/ads/setup/conversion-actions after the apply.

create table if not exists public.ads_conversion_actions (
  kind text primary key check (kind in ('trial_started', 'trial_activated', 'paid')),
  resource_name text not null,
  google_id text not null,
  name text not null,
  synced_at timestamptz not null default now()
);

alter table public.ads_conversion_actions enable row level security;
revoke all on public.ads_conversion_actions from anon, authenticated;

-- ─── Conversion outbox ───────────────────────────────────────────────────────

create table if not exists public.ads_conversion_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('trial_started', 'trial_activated', 'paid')),
  occurred_at timestamptz not null,
  value numeric(12, 2),
  currency text not null default 'CAD',
  -- kind:company_id — Google deduplicates on it, so a re-send never double counts.
  transaction_id text not null unique,
  state text not null default 'queued' check (state in ('queued', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  google_request_id text,
  created_at timestamptz not null default now()
);

alter table public.ads_conversion_events enable row level security;
revoke all on public.ads_conversion_events from anon, authenticated;

create index if not exists ads_conversion_events_ready_idx
  on public.ads_conversion_events (state, next_attempt_at)
  where state = 'queued';

create index if not exists ads_conversion_events_company_idx
  on public.ads_conversion_events (company_id, kind);

-- ─── Click ids: gbraid / wbraid alongside gclid ──────────────────────────────

alter table public.trial_attributions
  add column if not exists gbraid text,
  add column if not exists wbraid text;

-- ─── Annualised plan value for the paid event ────────────────────────────────
-- /plans: starter $90, team $140, business $190 per month, CAD. Unknown plans
-- fall back to the invoice amount annualised.

create or replace function public.ads_plan_annual_value(p_plan text, p_amount_cents bigint)
returns numeric
language sql
immutable
as $$
  select case p_plan
    when 'starter' then 1080::numeric
    when 'team' then 1680::numeric
    when 'business' then 2280::numeric
    else case
      when p_amount_cents is null then null
      else round(p_amount_cents::numeric * 12 / 100, 2)
    end
  end
$$;

revoke all on function public.ads_plan_annual_value(text, bigint) from public, anon, authenticated;
grant execute on function public.ads_plan_annual_value(text, bigint) to service_role;

-- ─── Enqueue (idempotent, never raises) ──────────────────────────────────────

create or replace function public.ads_enqueue_conversion_event(
  p_company_id uuid,
  p_kind text,
  p_occurred_at timestamptz,
  p_value numeric
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  begin
    insert into public.ads_conversion_events (company_id, kind, occurred_at, value, transaction_id)
    values (
      p_company_id,
      p_kind,
      coalesce(p_occurred_at, now()),
      p_value,
      p_kind || ':' || p_company_id::text
    )
    on conflict (transaction_id) do nothing;
  exception when others then
    raise warning 'ads_enqueue_conversion_event(%, %) failed: %', p_kind, p_company_id, sqlerrm;
  end;
end
$$;

revoke all on function public.ads_enqueue_conversion_event(uuid, text, timestamptz, numeric)
  from public, anon, authenticated;
-- pmf_update_first_paid_at runs as the inserting role (the Stripe webhook's
-- service_role), so the webhook's role must be able to call the enqueue.
grant execute on function public.ads_enqueue_conversion_event(uuid, text, timestamptz, numeric)
  to service_role;

-- ─── trial_started: ride the existing seed trigger (every platform) ─────────

create or replace function public.seed_trial_attribution_for_company()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  begin
    insert into public.trial_attributions (company_id, trial_started_at, attributed_channel)
    values (
      new.id,
      coalesce(new.trial_start_date, new.created_at, now()),
      'unknown'
    )
    on conflict (company_id) do nothing;
  exception when others then
    raise warning 'seed_trial_attribution_for_company failed for company %: %', new.id, sqlerrm;
  end;
  begin
    perform public.ads_enqueue_conversion_event(
      new.id,
      'trial_started',
      coalesce(new.trial_start_date, new.created_at, now()),
      null
    );
  exception when others then
    raise warning 'seed_trial_attribution_for_company: ads enqueue failed for company %: %', new.id, sqlerrm;
  end;
  return new;
end
$$;

-- ─── trial_activated: the company's first real project, excluding bulk imports

create or replace function public.ads_enqueue_trial_activation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company_created timestamptz;
  v_found boolean;
  v_created_at timestamptz;
begin
  begin
    if new.deleted_at is not null then
      return new;
    end if;
    v_created_at := coalesce(new.created_at, now());

    select c.created_at, true
      into v_company_created, v_found
      from public.companies c
     where c.id = new.company_id;
    if v_found is not true then
      return new;
    end if;

    -- Projects landing within two minutes of the company's birth are a bulk
    -- import, not activation. A company without created_at (legacy rows) has
    -- no import window to judge by, so its first live project counts.
    if v_company_created is not null
       and v_created_at < v_company_created + interval '2 minutes' then
      return new;
    end if;

    -- An earlier *real* project means this is not the first one. Projects
    -- inside the import window are imports, so they do not count.
    if exists (
      select 1
        from public.projects p
       where p.company_id = new.company_id
         and p.id <> new.id
         and p.deleted_at is null
         and coalesce(p.created_at, now()) < v_created_at
         and (
           v_company_created is null
           or coalesce(p.created_at, now()) >= v_company_created + interval '2 minutes'
         )
    ) then
      return new;
    end if;

    perform public.ads_enqueue_conversion_event(new.company_id, 'trial_activated', v_created_at, null);
  exception when others then
    raise warning 'ads_enqueue_trial_activation failed for project %: %', new.id, sqlerrm;
  end;
  return new;
end
$$;

drop trigger if exists projects_ads_enqueue_trial_activation on public.projects;
create trigger projects_ads_enqueue_trial_activation
  after insert on public.projects
  for each row execute function public.ads_enqueue_trial_activation();

-- ─── paid: extend the existing first-paid stamp ─────────────────────────────

create or replace function public.pmf_update_first_paid_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_plan text;
  v_stamped boolean := false;
begin
  if new.event_type = 'invoice.paid' and new.company_id is not null then
    update public.trial_attributions
       set first_paid_at = new.occurred_at,
           updated_at = now()
     where company_id = new.company_id
       and first_paid_at is null;
    v_stamped := found;

    if v_stamped then
      begin
        select c.subscription_plan into v_plan
          from public.companies c
         where c.id = new.company_id;
        perform public.ads_enqueue_conversion_event(
          new.company_id,
          'paid',
          new.occurred_at,
          public.ads_plan_annual_value(v_plan, new.amount_cents)
        );
      exception when others then
        raise warning 'pmf_update_first_paid_at: ads enqueue failed for company %: %', new.company_id, sqlerrm;
      end;
    end if;
  end if;
  return new;
end
$$;

-- ─── First-touch RPC learns gbraid / wbraid ─────────────────────────────────
-- Body identical to the live function except for the two new ids, which are
-- read, capped, nulled after 30 days, and written exactly like gclid.

create or replace function public.record_first_touch_attribution(
  p_company_id uuid,
  p_touch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_trial public.trial_attributions%rowtype;
  v_existing_dedupe text;
  v_anonymous_id text;
  v_occurred_at timestamptz;
  v_landing_path text;
  v_referrer_domain text;
  v_channel text;
  v_basis text;
  v_confidence numeric(4, 3);
  v_reason text;
  v_capture_version smallint;
  v_dedupe_key text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_content text;
  v_utm_term text;
  v_gclid text;
  v_gbraid text;
  v_wbraid text;
  v_fbclid text;
begin
  if p_company_id is null
     or p_touch is null
     or jsonb_typeof(p_touch) <> 'object' then
    raise exception 'INVALID_FIRST_TOUCH';
  end if;

  v_anonymous_id := nullif(left(btrim(p_touch ->> 'anonymous_id'), 36), '');
  if v_anonymous_id is null or v_anonymous_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_FIRST_TOUCH_ANONYMOUS_ID';
  end if;

  begin
    v_occurred_at := (p_touch ->> 'captured_at')::timestamptz;
  exception when others then
    raise exception 'INVALID_FIRST_TOUCH_TIMESTAMP';
  end;
  if v_occurred_at is null then
    raise exception 'INVALID_FIRST_TOUCH_TIMESTAMP';
  end if;
  if v_occurred_at > now() + interval '5 minutes'
     or v_occurred_at < now() - interval '31 days' then
    raise exception 'FIRST_TOUCH_OUTSIDE_RETENTION_WINDOW';
  end if;

  v_landing_path := nullif(left(btrim(p_touch ->> 'landing_path'), 2048), '');
  if v_landing_path is null
     or left(v_landing_path, 1) <> '/'
     or strpos(v_landing_path, '?') > 0
     or strpos(v_landing_path, '#') > 0 then
    raise exception 'INVALID_FIRST_TOUCH_LANDING_PATH';
  end if;

  v_referrer_domain := nullif(lower(left(btrim(p_touch ->> 'referrer_domain'), 253)), '');
  if v_referrer_domain is not null then
    v_referrer_domain := regexp_replace(v_referrer_domain, '^www\.', '');
    if v_referrer_domain !~ '^[a-z0-9.-]+$' then
      raise exception 'INVALID_FIRST_TOUCH_REFERRER';
    end if;
    if v_referrer_domain = 'opsapp.co'
       or v_referrer_domain like '%.opsapp.co' then
      v_referrer_domain := null;
    end if;
  end if;

  v_channel := nullif(left(btrim(p_touch ->> 'channel'), 64), '');
  if v_channel is null or v_channel not in (
    'google_ads', 'meta_ads', 'apple_search_ads', 'organic_search',
    'organic_social', 'referral', 'app_store_search', 'app_store_browse',
    'direct', 'other', 'unknown'
  ) then
    raise exception 'INVALID_FIRST_TOUCH_CHANNEL';
  end if;

  v_basis := nullif(left(btrim(p_touch ->> 'basis'), 64), '');
  if v_basis is null or v_basis not in (
    'verified_click_id', 'deterministic_first_party', 'utm_referrer', 'direct'
  ) then
    raise exception 'INVALID_FIRST_TOUCH_BASIS';
  end if;

  begin
    v_confidence := (p_touch ->> 'confidence')::numeric(4, 3);
  exception when others then
    raise exception 'INVALID_FIRST_TOUCH_CONFIDENCE';
  end;
  if v_confidence is null or v_confidence < 0 or v_confidence > 1 then
    raise exception 'INVALID_FIRST_TOUCH_CONFIDENCE';
  end if;

  v_reason := nullif(left(btrim(p_touch ->> 'reason'), 128), '');
  if v_reason is null or v_reason !~ '^[a-z0-9_]+$' then
    raise exception 'INVALID_FIRST_TOUCH_REASON';
  end if;

  begin
    v_capture_version := (p_touch ->> 'version')::smallint;
  exception when others then
    raise exception 'INVALID_FIRST_TOUCH_VERSION';
  end;
  if v_capture_version is null or v_capture_version < 1 then
    raise exception 'INVALID_FIRST_TOUCH_VERSION';
  end if;

  v_utm_source := nullif(left(btrim(p_touch ->> 'utm_source'), 256), '');
  v_utm_medium := nullif(left(btrim(p_touch ->> 'utm_medium'), 256), '');
  v_utm_campaign := nullif(left(btrim(p_touch ->> 'utm_campaign'), 256), '');
  v_utm_content := nullif(left(btrim(p_touch ->> 'utm_content'), 256), '');
  v_utm_term := nullif(left(btrim(p_touch ->> 'utm_term'), 256), '');
  v_gclid := nullif(left(btrim(p_touch ->> 'gclid'), 512), '');
  v_gbraid := nullif(left(btrim(p_touch ->> 'gbraid'), 512), '');
  v_wbraid := nullif(left(btrim(p_touch ->> 'wbraid'), 512), '');
  v_fbclid := nullif(left(btrim(p_touch ->> 'fbclid'), 512), '');
  if v_occurred_at < now() - interval '30 days' then
    v_gclid := null;
    v_gbraid := null;
    v_wbraid := null;
    v_fbclid := null;
  end if;
  v_dedupe_key := concat(
    'first-touch:v', v_capture_version, ':', v_anonymous_id, ':',
    extract(epoch from v_occurred_at)::numeric(20, 3)
  );

  select *
    into v_trial
    from public.trial_attributions
   where company_id = p_company_id
   for update;

  if not found then
    raise exception 'TRIAL_ATTRIBUTION_NOT_SEEDED';
  end if;

  select dedupe_key
    into v_existing_dedupe
    from public.touchpoints
   where company_id = p_company_id
   order by occurred_at asc, created_at asc
   limit 1;

  if v_existing_dedupe is not null then
    if v_existing_dedupe <> v_dedupe_key then
      return jsonb_build_object('status', 'first_touch_preserved');
    end if;

    update public.trial_attributions
       set utm_source = coalesce(utm_source, v_utm_source),
           utm_medium = coalesce(utm_medium, v_utm_medium),
           utm_campaign = coalesce(utm_campaign, v_utm_campaign),
           utm_content = coalesce(utm_content, v_utm_content),
           utm_term = coalesce(utm_term, v_utm_term),
           gclid = coalesce(gclid, v_gclid),
           gbraid = coalesce(gbraid, v_gbraid),
           wbraid = coalesce(wbraid, v_wbraid),
           fbclid = coalesce(fbclid, v_fbclid),
           landing_url = coalesce(landing_url, v_landing_path),
           referrer = coalesce(referrer, v_referrer_domain),
           first_touch_at = coalesce(first_touch_at, v_occurred_at),
           updated_at = now()
     where company_id = p_company_id;
    return jsonb_build_object('status', 'duplicate_ignored');
  end if;

  if v_trial.attribution_basis not in ('unknown', 'self_reported')
     or (
       v_trial.attributed_channel <> 'unknown'
       and v_trial.attribution_basis <> 'self_reported'
     ) then
    return jsonb_build_object('status', 'stronger_evidence_preserved');
  end if;

  update public.trial_attributions
     set utm_source = v_utm_source,
         utm_medium = v_utm_medium,
         utm_campaign = v_utm_campaign,
         utm_content = v_utm_content,
         utm_term = v_utm_term,
         gclid = v_gclid,
         gbraid = v_gbraid,
         wbraid = v_wbraid,
         fbclid = v_fbclid,
         landing_url = v_landing_path,
         referrer = v_referrer_domain,
         first_touch_at = v_occurred_at,
         attributed_channel = v_channel,
         attribution_basis = v_basis,
         attribution_confidence = v_confidence,
         classification_reason = v_reason,
         capture_version = v_capture_version,
         updated_at = now()
   where company_id = p_company_id;

  insert into public.touchpoints (
    company_id,
    anonymous_id,
    occurred_at,
    canonical_channel,
    sub_channel,
    campaign,
    landing_path,
    referrer_domain,
    click_ids,
    raw_source,
    attribution_basis,
    attribution_confidence,
    capture_version,
    dedupe_key,
    expires_at
  ) values (
    p_company_id,
    v_anonymous_id,
    v_occurred_at,
    v_channel,
    v_utm_source,
    v_utm_campaign,
    v_landing_path,
    v_referrer_domain,
    jsonb_strip_nulls(jsonb_build_object(
      'gclid', v_gclid,
      'gbraid', v_gbraid,
      'wbraid', v_wbraid,
      'fbclid', v_fbclid
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'utm_source', v_utm_source,
      'utm_medium', v_utm_medium,
      'utm_campaign', v_utm_campaign,
      'utm_content', v_utm_content,
      'utm_term', v_utm_term
    )),
    v_basis,
    v_confidence,
    v_capture_version,
    v_dedupe_key,
    v_occurred_at + interval '30 days'
  );

  return jsonb_build_object('status', 'recorded');
end
$function$;

revoke all on function public.record_first_touch_attribution(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_first_touch_attribution(uuid, jsonb)
  to service_role;

-- ─── Expiry scrub covers the new columns ─────────────────────────────────────
-- Body taken from the LIVE function (which deletes expired touchpoints and pins
-- pg_catalog), not from its drifted migration file; only the two new columns
-- are added.

create or replace function public.expire_attribution_click_ids(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_trial_rows bigint;
  v_touchpoint_rows bigint;
begin
  update public.trial_attributions
     set gclid = null,
         gbraid = null,
         wbraid = null,
         fbclid = null,
         updated_at = clock_timestamp()
   where first_touch_at < p_now - interval '30 days'
     and (gclid is not null or gbraid is not null or wbraid is not null or fbclid is not null);
  get diagnostics v_trial_rows = row_count;

  delete from public.touchpoints as touchpoint
   where touchpoint.expires_at is not null
     and touchpoint.expires_at <= p_now;
  get diagnostics v_touchpoint_rows = row_count;

  return jsonb_build_object(
    'trial_rows_scrubbed', v_trial_rows,
    'touchpoint_rows_deleted', v_touchpoint_rows
  );
end
$function$;

revoke all on function public.expire_attribution_click_ids(timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_attribution_click_ids(timestamptz)
  to service_role;

commit;
