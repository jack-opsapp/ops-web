-- Preserve the versioned iOS analytics contract at the authenticated ingest
-- boundary. The shipped two-argument function remains available for older app
-- versions; current clients use this overload so debug data cannot be mislabeled
-- as production by column defaults.

begin;

set local search_path = public, private, pg_temp;

create or replace function analytics_ingest.append_analytics_events(
  p_events jsonb,
  p_expected_subject text,
  p_schema_version smallint,
  p_environment text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_subject text := nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '');
  v_user_id uuid;
  v_match_count bigint;
begin
  if p_schema_version is distinct from 1 then
    raise exception 'analytics_schema_version_invalid' using errcode = '22023';
  end if;

  if p_environment is null
     or p_environment not in ('production', 'preview', 'development', 'test') then
    raise exception 'analytics_environment_invalid' using errcode = '22023';
  end if;

  -- The established boundary performs signed-sub validation, canonical
  -- identity hydration, payload validation, quota enforcement, and idempotent
  -- insertion before any metadata is updated.
  v_result := analytics_ingest.append_analytics_events(
    p_events,
    p_expected_subject
  );

  select candidate.id, candidate.match_count
  into v_user_id, v_match_count
  from (
    select
      u.id,
      count(*) over () as match_count
    from public.users as u
    where (u.auth_id = v_subject or u.firebase_uid = v_subject)
      and u.deleted_at is null
      and u.is_active is true
    order by case when u.firebase_uid = v_subject then 0 else 1 end, u.id
    limit 1
  ) as candidate;

  if coalesce(v_match_count, 0) <> 1 then
    raise exception 'analytics_identity_invalid' using errcode = '42501';
  end if;

  update public.analytics_events as stored
  set schema_version = p_schema_version,
      environment = p_environment
  where stored.user_id = v_user_id
    and stored.platform = 'ios'
    and stored.id in (
      select (payload.event ->> 'id')::uuid
      from pg_catalog.jsonb_array_elements(p_events) as payload(event)
    );

  return v_result;
end
$function$;

revoke all on function analytics_ingest.append_analytics_events(
  jsonb, text, smallint, text
) from public, anon, authenticated;
grant execute on function analytics_ingest.append_analytics_events(
  jsonb, text, smallint, text
) to anon, authenticated;

comment on function analytics_ingest.append_analytics_events(
  jsonb, text, smallint, text
) is 'Versioned iOS analytics append boundary with canonical identity and explicit environment metadata.';

create or replace function public.append_analytics_events(
  p_events jsonb,
  p_expected_subject text,
  p_schema_version smallint,
  p_environment text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select analytics_ingest.append_analytics_events(
    p_events,
    p_expected_subject,
    p_schema_version,
    p_environment
  )
$function$;

revoke all on function public.append_analytics_events(
  jsonb, text, smallint, text
) from public, anon, authenticated;
grant execute on function public.append_analytics_events(
  jsonb, text, smallint, text
) to anon, authenticated;

comment on function public.append_analytics_events(
  jsonb, text, smallint, text
) is 'Unprivileged versioned iOS analytics wrapper with expected Firebase subject binding.';

commit;
