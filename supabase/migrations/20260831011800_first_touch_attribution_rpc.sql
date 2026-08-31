begin;

-- Persist the validated first touch and its raw touchpoint together. The
-- company trigger has already seeded trial_attributions, so this function
-- locks and upgrades that row rather than risking a conflicting insert.
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
  v_fbclid := nullif(left(btrim(p_touch ->> 'fbclid'), 512), '');
  if v_occurred_at < now() - interval '30 days' then
    v_gclid := null;
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
           fbclid = coalesce(fbclid, v_fbclid),
           landing_url = coalesce(landing_url, v_landing_path),
           referrer = coalesce(referrer, v_referrer_domain),
           first_touch_at = coalesce(first_touch_at, v_occurred_at),
           updated_at = now()
     where company_id = p_company_id;
    return jsonb_build_object('status', 'duplicate_ignored');
  end if;

  if v_trial.attribution_basis <> 'unknown'
     or v_trial.attributed_channel <> 'unknown' then
    return jsonb_build_object('status', 'stronger_evidence_preserved');
  end if;

  update public.trial_attributions
     set utm_source = v_utm_source,
         utm_medium = v_utm_medium,
         utm_campaign = v_utm_campaign,
         utm_content = v_utm_content,
         utm_term = v_utm_term,
         gclid = v_gclid,
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
    jsonb_strip_nulls(jsonb_build_object('gclid', v_gclid, 'fbclid', v_fbclid)),
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

-- Remove raw click identifiers after the approved 30-day attribution window.
-- The classified channel, basis, confidence, and aggregate facts remain.
create or replace function public.expire_attribution_click_ids(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_trial_rows bigint;
  v_touchpoint_rows bigint;
begin
  update public.trial_attributions
     set gclid = null,
         fbclid = null,
         updated_at = now()
   where first_touch_at < p_now - interval '30 days'
     and (gclid is not null or fbclid is not null);
  get diagnostics v_trial_rows = row_count;

  update public.touchpoints
     set click_ids = '{}'::jsonb,
         expires_at = null
   where expires_at is not null
     and expires_at <= p_now;
  get diagnostics v_touchpoint_rows = row_count;

  return jsonb_build_object(
    'trial_rows_scrubbed', v_trial_rows,
    'touchpoints_scrubbed', v_touchpoint_rows
  );
end
$function$;

revoke all on function public.expire_attribution_click_ids(timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_attribution_click_ids(timestamptz)
  to service_role;

-- Supabase production includes pg_cron; the guard keeps isolated PostgreSQL
-- migration replay valid when that extension is intentionally absent.
do $schedule$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'expire-attribution-click-ids',
      '17 4 * * *',
      'select public.expire_attribution_click_ids();'
    );
  end if;
end
$schedule$;

commit;
