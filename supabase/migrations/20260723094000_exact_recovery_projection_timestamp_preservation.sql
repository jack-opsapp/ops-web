begin;

-- Exact-message moves recompute correspondence projections on both leads.
-- The legacy opportunity timestamp trigger touches updated_at for every
-- UPDATE, even when only those derived counters change. Preserve the manifest
-- concurrency token only through an inaccessible, transaction-scoped
-- capability consumed by a projection-only trigger.

create table private.exact_recovery_opportunity_timestamp_tokens (
  transaction_id bigint not null,
  backend_pid integer not null,
  company_id uuid not null,
  opportunity_id uuid not null,
  expected_updated_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    transaction_id,
    backend_pid,
    company_id,
    opportunity_id
  )
);

revoke all on table private.exact_recovery_opportunity_timestamp_tokens
  from public, anon, authenticated, service_role;

create or replace function private.preserve_exact_recovery_opportunity_updated_at()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_consumed boolean;
begin
  if old.id is distinct from new.id
    or old.company_id is distinct from new.company_id
    or to_jsonb(new) - array[
      'correspondence_count',
      'inbound_count',
      'outbound_count',
      'last_inbound_at',
      'last_outbound_at',
      'last_message_direction',
      'last_activity_at',
      'updated_at'
    ] is distinct from to_jsonb(old) - array[
      'correspondence_count',
      'inbound_count',
      'outbound_count',
      'last_inbound_at',
      'last_outbound_at',
      'last_message_direction',
      'last_activity_at',
      'updated_at'
    ]
  then
    return new;
  end if;

  delete from private.exact_recovery_opportunity_timestamp_tokens token
  where token.transaction_id = pg_catalog.txid_current()
    and token.backend_pid = pg_catalog.pg_backend_pid()
    and token.company_id = old.company_id
    and token.opportunity_id = old.id
    and token.expected_updated_at is not distinct from old.updated_at
  returning true into v_consumed;

  if found and coalesce(v_consumed, false) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$function$;

revoke all on function
  private.preserve_exact_recovery_opportunity_updated_at()
  from public, anon, authenticated, service_role;

drop trigger if exists
  zz_exact_recovery_preserve_opportunity_updated_at
  on public.opportunities;
create trigger zz_exact_recovery_preserve_opportunity_updated_at
before update on public.opportunities
for each row execute function
  private.preserve_exact_recovery_opportunity_updated_at();

create or replace function private.recompute_exact_message_opportunity_projection(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_moved_direction text,
  p_count_delta integer
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_correspondence_count integer;
  v_inbound_count integer;
  v_outbound_count integer;
  v_last_inbound_at timestamptz;
  v_last_outbound_at timestamptz;
  v_last_direction text;
  v_last_activity_at timestamptz;
  v_updated_at timestamptz;
begin
  if p_company_id is null
    or p_opportunity_id is null
    or p_moved_direction not in ('inbound', 'outbound')
    or p_count_delta not in (-1, 1)
  then
    raise exception 'invalid_exact_message_projection_request'
      using errcode = '22023';
  end if;

  select
    coalesce(opportunity.correspondence_count, 0),
    coalesce(opportunity.inbound_count, 0),
    coalesce(opportunity.outbound_count, 0),
    opportunity.updated_at
  into
    v_correspondence_count,
    v_inbound_count,
    v_outbound_count,
    v_updated_at
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if p_count_delta = -1 and (
    v_correspondence_count < 1
    or (p_moved_direction = 'inbound' and v_inbound_count < 1)
    or (p_moved_direction = 'outbound' and v_outbound_count < 1)
  ) then
    raise exception 'exact_message_projection_underflow'
      using errcode = '23514';
  end if;

  select
    max(event.occurred_at) filter (where event.direction = 'inbound'),
    max(event.occurred_at) filter (where event.direction = 'outbound')
  into v_last_inbound_at, v_last_outbound_at
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.opportunity_projection_applied is true;

  select case latest.direction when 'inbound' then 'in' else 'out' end
  into v_last_direction
  from public.opportunity_correspondence_events latest
  where latest.company_id = p_company_id
    and latest.opportunity_id = p_opportunity_id
    and latest.opportunity_projection_applied is true
  order by latest.occurred_at desc, latest.id desc
  limit 1;

  select max(activity.created_at)
  into v_last_activity_at
  from public.activities activity
  where activity.company_id = p_company_id
    and activity.opportunity_id = p_opportunity_id;

  insert into private.exact_recovery_opportunity_timestamp_tokens (
    transaction_id,
    backend_pid,
    company_id,
    opportunity_id,
    expected_updated_at
  ) values (
    pg_catalog.txid_current(),
    pg_catalog.pg_backend_pid(),
    p_company_id,
    p_opportunity_id,
    v_updated_at
  )
  on conflict (
    transaction_id,
    backend_pid,
    company_id,
    opportunity_id
  ) do update set
    expected_updated_at = excluded.expected_updated_at,
    created_at = pg_catalog.clock_timestamp();

  update public.opportunities opportunity
  set correspondence_count = v_correspondence_count + p_count_delta,
      inbound_count = v_inbound_count + case
        when p_moved_direction = 'inbound' then p_count_delta else 0 end,
      outbound_count = v_outbound_count + case
        when p_moved_direction = 'outbound' then p_count_delta else 0 end,
      last_inbound_at = v_last_inbound_at,
      last_outbound_at = v_last_outbound_at,
      last_message_direction = v_last_direction,
      last_activity_at = v_last_activity_at
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from private.exact_recovery_opportunity_timestamp_tokens token
    where token.transaction_id = pg_catalog.txid_current()
      and token.backend_pid = pg_catalog.pg_backend_pid()
      and token.company_id = p_company_id
      and token.opportunity_id = p_opportunity_id
  ) then
    raise exception 'exact_recovery_projection_timestamp_token_not_consumed'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.recompute_exact_message_opportunity_projection(
  uuid, uuid, text, integer
) from public, anon, authenticated, service_role;

commit;
