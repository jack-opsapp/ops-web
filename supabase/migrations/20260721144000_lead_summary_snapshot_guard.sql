-- Forward-only lead-summary write guard.
--
-- Model generation happens outside Postgres and may overlap a newer inbound or
-- outbound event. This RPC binds the write to the exact opportunity,
-- assignment, prior summary, correspondence counter, and meaningful-event
-- snapshot read by the generator. It changes summary fields only and performs
-- no historical backfill.

begin;

create or replace function public.commit_lead_summary_snapshot(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_summary text,
  p_generated_at timestamptz,
  p_expected_prior_summary text,
  p_expected_prior_summary_updated_at timestamptz,
  p_expected_opportunity_updated_at timestamptz,
  p_expected_assignment_version bigint,
  p_expected_correspondence_count bigint,
  p_expected_meaningful_event_count bigint,
  p_expected_latest_meaningful_event_id uuid
) returns table (
  changed boolean,
  guard_reason text,
  summary_updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_meaningful_event_count bigint;
  v_latest_meaningful_event_id uuid;
  v_summary_updated_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
    or p_opportunity_id is null
    or nullif(btrim(p_summary), '') is null
    or length(btrim(p_summary)) > 4000
    or p_generated_at is null
    or p_expected_opportunity_updated_at is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
    or p_expected_correspondence_count is null
    or p_expected_correspondence_count < 0
    or p_expected_meaningful_event_count is null
    or p_expected_meaningful_event_count < 0
    or (
      p_expected_meaningful_event_count = 0
      and p_expected_latest_meaningful_event_id is not null
    )
    or (
      p_expected_meaningful_event_count > 0
      and p_expected_latest_meaningful_event_id is null
    )
  then
    raise exception 'invalid_lead_summary_snapshot' using errcode = '22023';
  end if;

  if p_generated_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'invalid_lead_summary_generated_at' using errcode = '22023';
  end if;

  select opportunity.*
  into v_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
    and opportunity.merged_into_opportunity_id is null
  for update;

  if not found then
    return query select false, 'opportunity_not_available'::text, null::timestamptz;
    return;
  end if;

  -- Correspondence insertion takes this same opportunity lock before making
  -- its child event durable. Once the lock is ours, no newer event can cross
  -- this check. A meaningful event awaiting counter projection must be applied
  -- and the complete conversation regenerated before any summary retry,
  -- including an otherwise exact retry, can be accepted.
  if private.opportunity_has_pending_meaningful_email(
    p_company_id,
    p_opportunity_id
  ) then
    raise exception 'meaningful correspondence projection pending'
      using errcode = '40001';
  end if;

  -- Once the conversation is fully projected, an exact retry is successful
  -- even if the first application changed the opportunity row timestamp. This
  -- must precede the caller-supplied value-snapshot guards below.
  if v_opportunity.ai_summary is not distinct from btrim(p_summary)
    and v_opportunity.ai_summary_updated_at is not distinct from p_generated_at
  then
    return query select false, 'already_applied'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  -- Never let an older generator replace a newer summary. Reusing a timestamp
  -- for different output is also rejected so generated_at remains a stable,
  -- idempotent write identity.
  if v_opportunity.ai_summary_updated_at > p_generated_at then
    return query select false, 'stale_summary_generation'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  if v_opportunity.ai_summary_updated_at = p_generated_at then
    return query select false, 'summary_generation_conflict'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  if v_opportunity.ai_summary is distinct from p_expected_prior_summary
    or v_opportunity.ai_summary_updated_at is distinct from p_expected_prior_summary_updated_at
  then
    return query select false, 'summary_snapshot_mismatch'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  if v_opportunity.assignment_version is distinct from p_expected_assignment_version then
    return query select false, 'assignment_snapshot_mismatch'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  if v_opportunity.updated_at is distinct from p_expected_opportunity_updated_at then
    return query select false, 'opportunity_snapshot_mismatch'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  if coalesce(v_opportunity.correspondence_count, 0)::bigint
    is distinct from p_expected_correspondence_count
  then
    return query select false, 'conversation_snapshot_mismatch'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  select
    count(*)::bigint,
    (
      array_agg(
        event.id
        order by event.occurred_at desc, event.created_at desc, event.id desc
      )
    )[1]
  into
    v_meaningful_event_count,
    v_latest_meaningful_event_id
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.is_meaningful
    and event.opportunity_projection_applied;

  if v_meaningful_event_count is distinct from p_expected_meaningful_event_count
    or v_latest_meaningful_event_id is distinct from p_expected_latest_meaningful_event_id
  then
    return query select false, 'conversation_snapshot_mismatch'::text, v_opportunity.ai_summary_updated_at;
    return;
  end if;

  update public.opportunities opportunity
  set
    ai_summary = btrim(p_summary),
    ai_summary_updated_at = p_generated_at
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
  returning opportunity.ai_summary_updated_at into v_summary_updated_at;

  return query select true, null::text, v_summary_updated_at;
end;
$function$;

comment on function public.commit_lead_summary_snapshot(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  bigint,
  bigint,
  bigint,
  uuid
) is
  'Service-role-only lead-summary writer. Under the serialized opportunity lock, fails retryably while meaningful correspondence awaits projection; otherwise idempotently accepts exact retries, rejects stale generations or stale prior-summary, opportunity, assignment, correspondence-counter, or meaningful-event snapshots, and updates summary fields only.';

revoke all on function public.commit_lead_summary_snapshot(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  bigint,
  bigint,
  bigint,
  uuid
) from public, anon, authenticated;

grant execute on function public.commit_lead_summary_snapshot(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  bigint,
  bigint,
  bigint,
  uuid
) to service_role;

commit;
