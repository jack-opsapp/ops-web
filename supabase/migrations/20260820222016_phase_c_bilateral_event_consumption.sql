-- P1-17: consume the P1-16 bilateral appointment handoff through one
-- server-authoritative, exactly-once booking boundary.

alter table public.phase_c_bilateral_event_handoffs
  add column if not exists initial_status text,
  add column if not exists initial_review_reason text,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists processing_failed_at timestamptz;

update public.phase_c_bilateral_event_handoffs
   set initial_status = status,
       initial_review_reason = review_reason
 where initial_status is null;

alter table public.phase_c_bilateral_event_handoffs
  alter column initial_status set not null;

alter table public.site_visits
  add column if not exists appointment_handoff_id uuid
    references public.phase_c_bilateral_event_handoffs(id) on delete restrict,
  add column if not exists appointment_kind text,
  add column if not exists appointment_title text,
  add column if not exists appointment_location text,
  add column if not exists appointment_attendees jsonb;

alter table public.site_visits
  drop constraint if exists site_visits_appointment_kind_check,
  add constraint site_visits_appointment_kind_check check (
    appointment_kind is null
    or appointment_kind in ('site_visit', 'meeting', 'call', 'work')
  ),
  drop constraint if exists site_visits_appointment_attendees_check,
  add constraint site_visits_appointment_attendees_check check (
    appointment_attendees is null
    or jsonb_typeof(appointment_attendees) = 'array'
  );

create unique index if not exists site_visits_phase_c_handoff_key
  on public.site_visits(appointment_handoff_id)
  where appointment_handoff_id is not null;

create index if not exists phase_c_bilateral_event_handoffs_due_idx
  on public.phase_c_bilateral_event_handoffs(next_attempt_at, created_at)
  where notification_sent_at is null and processing_failed_at is null;

-- Preserve the immutable P1-16 replay contract after the consumer advances
-- mutable status from ready/review to consumed/review/cancelled.
create or replace function public.record_phase_c_bilateral_event_handoff(
  p_idempotency_key text,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_decision_id uuid,
  p_proposal_event_id uuid,
  p_acceptance_event_id uuid,
  p_requested_owner_user_id uuid,
  p_event_kind text,
  p_event_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_event_timezone text,
  p_location text,
  p_attendees jsonb,
  p_status text,
  p_review_reason text
) returns public.phase_c_bilateral_event_handoffs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted public.phase_c_bilateral_event_handoffs%rowtype;
  v_existing public.phase_c_bilateral_event_handoffs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_status not in ('ready', 'review') then
    raise exception 'invalid_bilateral_event_handoff_status' using errcode = '22023';
  end if;

  insert into public.phase_c_bilateral_event_handoffs (
    idempotency_key, company_id, opportunity_id, decision_id,
    proposal_event_id, acceptance_event_id, requested_owner_user_id,
    event_kind, event_title, starts_at, ends_at, event_timezone, location,
    attendees, status, review_reason, initial_status, initial_review_reason
  ) values (
    btrim(p_idempotency_key), p_company_id, p_opportunity_id, p_decision_id,
    p_proposal_event_id, p_acceptance_event_id, p_requested_owner_user_id,
    p_event_kind, nullif(btrim(p_event_title), ''), p_starts_at, p_ends_at,
    nullif(btrim(p_event_timezone), ''), nullif(btrim(p_location), ''),
    coalesce(p_attendees, '[]'::jsonb), p_status,
    nullif(btrim(p_review_reason), ''), p_status,
    nullif(btrim(p_review_reason), '')
  )
  on conflict (idempotency_key) do nothing
  returning * into v_inserted;
  if found then
    return v_inserted;
  end if;

  select handoff.* into v_existing
    from public.phase_c_bilateral_event_handoffs handoff
   where handoff.idempotency_key = btrim(p_idempotency_key);
  if v_existing.company_id is distinct from p_company_id
    or v_existing.opportunity_id is distinct from p_opportunity_id
    or v_existing.decision_id is distinct from p_decision_id
    or v_existing.proposal_event_id is distinct from p_proposal_event_id
    or v_existing.acceptance_event_id is distinct from p_acceptance_event_id
    or v_existing.requested_owner_user_id is distinct from p_requested_owner_user_id
    or v_existing.event_kind is distinct from p_event_kind
    or v_existing.event_title is distinct from nullif(btrim(p_event_title), '')
    or v_existing.starts_at is distinct from p_starts_at
    or v_existing.ends_at is distinct from p_ends_at
    or v_existing.event_timezone is distinct from nullif(btrim(p_event_timezone), '')
    or v_existing.location is distinct from nullif(btrim(p_location), '')
    or v_existing.attendees is distinct from coalesce(p_attendees, '[]'::jsonb)
    or v_existing.initial_status is distinct from p_status
    or v_existing.initial_review_reason is distinct from nullif(btrim(p_review_reason), '')
  then
    raise exception 'bilateral_event_handoff_replay_conflict' using errcode = '23505';
  end if;
  return v_existing;
end;
$function$;

create or replace function public.claim_phase_c_bilateral_event_handoffs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns table (
  id uuid,
  company_id uuid,
  opportunity_id uuid,
  requested_owner_user_id uuid,
  status text,
  canonical_event_kind text,
  canonical_event_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null
     or p_limit not between 1 and 50
     or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid_bilateral_event_claim' using errcode = '22023';
  end if;

  return query
  with due as (
    select handoff.id
      from public.phase_c_bilateral_event_handoffs handoff
     where handoff.status in ('ready', 'review', 'consumed')
       and handoff.notification_sent_at is null
       and handoff.processing_failed_at is null
       and handoff.attempt_count < 8
       and handoff.next_attempt_at <= now()
       and (handoff.lease_expires_at is null or handoff.lease_expires_at <= now())
     order by handoff.next_attempt_at, handoff.created_at, handoff.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.phase_c_bilateral_event_handoffs handoff
       set lease_owner = btrim(p_worker_id),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempt_count = handoff.attempt_count + 1,
           last_error_code = null,
           last_error_message = null,
           updated_at = now()
      from due
     where handoff.id = due.id
     returning handoff.*
  )
  select claimed.id, claimed.company_id, claimed.opportunity_id,
         claimed.requested_owner_user_id, claimed.status,
         claimed.canonical_event_kind, claimed.canonical_event_id,
         claimed.attempt_count
    from claimed;
end;
$function$;

create or replace function public.consume_phase_c_bilateral_event_handoff(
  p_handoff_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_handoff public.phase_c_bilateral_event_handoffs%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_owner_email text;
  v_connection_owner uuid;
  v_visit_id uuid;
  v_activity_id uuid;
  v_duration integer;
  v_review_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select handoff.* into v_handoff
    from public.phase_c_bilateral_event_handoffs handoff
   where handoff.id = p_handoff_id
   for update;
  if not found then
    raise exception 'bilateral_event_handoff_not_found' using errcode = 'P0002';
  end if;
  if v_handoff.lease_owner is distinct from btrim(p_worker_id)
     or v_handoff.lease_expires_at <= now() then
    raise exception 'bilateral_event_handoff_lease_lost' using errcode = '55000';
  end if;
  if v_handoff.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'review_reason', 'handoff_cancelled');
  end if;
  if v_handoff.status = 'consumed' then
    return jsonb_build_object(
      'status', 'consumed',
      'canonical_event_kind', v_handoff.canonical_event_kind,
      'canonical_event_id', v_handoff.canonical_event_id
    );
  end if;
  if v_handoff.status = 'review' then
    return jsonb_build_object('status', 'review', 'review_reason', v_handoff.review_reason);
  end if;

  select opportunity.* into v_opportunity
    from public.opportunities opportunity
   where opportunity.id = v_handoff.opportunity_id
     and opportunity.company_id = v_handoff.company_id
     and opportunity.deleted_at is null
   for key share;
  if not found then
    v_review_reason := 'event_lead_identity_mismatch';
  end if;

  if v_review_reason is null then
    select connection.user_id into v_connection_owner
      from public.opportunity_correspondence_events event
      join public.email_connections connection
        on connection.id = event.connection_id
       and connection.company_id = event.company_id
     where event.id = v_handoff.proposal_event_id
       and event.company_id = v_handoff.company_id;
    if v_handoff.requested_owner_user_id is null
       or v_handoff.requested_owner_user_id is distinct from
          coalesce(v_opportunity.assigned_to, v_connection_owner) then
      v_review_reason := 'event_owner_identity_mismatch';
    end if;
  end if;

  if v_review_reason is null then
    select lower(btrim(actor.email)) into v_owner_email
      from public.users actor
     where actor.id = v_handoff.requested_owner_user_id
       and actor.company_id = v_handoff.company_id
       and actor.deleted_at is null
       and coalesce(actor.is_active, false);
    if v_owner_email is null then
      v_review_reason := 'event_owner_identity_mismatch';
    end if;
  end if;

  if v_review_reason is null
     and not public.has_permission(
       v_handoff.requested_owner_user_id,
       'calendar.create',
       'all'
     ) then
    v_review_reason := 'calendar_create_permission_missing';
  end if;

  if v_review_reason is null and (
    jsonb_typeof(v_handoff.attendees) <> 'array'
    or not exists (
      select 1 from jsonb_array_elements(v_handoff.attendees) attendee
       where attendee->>'role' = 'operator'
         and lower(btrim(attendee->>'email')) = v_owner_email
    )
    or not exists (
      select 1 from jsonb_array_elements(v_handoff.attendees) attendee
       where attendee->>'role' = 'customer'
         and nullif(lower(btrim(attendee->>'email')), '') is not null
    )
  ) then
    v_review_reason := 'event_attendees_unresolved';
  end if;

  if v_review_reason is null and (
    nullif(btrim(v_handoff.event_timezone), '') is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names zone
       where zone.name = v_handoff.event_timezone
    )
  ) then
    v_review_reason := 'event_timezone_unresolved';
  end if;
  if v_review_reason is null
     and nullif(btrim(v_handoff.location), '') is null then
    v_review_reason := 'event_location_unresolved';
  end if;
  if v_review_reason is null and (
    nullif(btrim(v_handoff.event_title), '') is null
    or v_handoff.starts_at is null
    or v_handoff.ends_at is null
    or v_handoff.ends_at <= v_handoff.starts_at
    or v_handoff.starts_at <= now() - interval '5 minutes'
    or v_handoff.starts_at > now() + interval '2 years'
  ) then
    v_review_reason := 'event_time_unresolved';
  end if;

  v_duration := ceil(
    extract(epoch from (v_handoff.ends_at - v_handoff.starts_at)) / 60.0
  )::integer;
  if v_review_reason is null and v_duration not between 15 and 480 then
    v_review_reason := 'event_duration_unresolved';
  end if;

  if v_review_reason is null and (
    exists (
      select 1
        from public.site_visits visit
       where visit.company_id = v_handoff.company_id::text
         and visit.deleted_at is null
         and visit.status::text in ('scheduled', 'in_progress')
         and v_handoff.requested_owner_user_id::text = any(coalesce(visit.assignee_ids, '{}'::text[]))
         and visit.scheduled_at < v_handoff.ends_at
         and visit.scheduled_at + make_interval(mins => visit.duration_minutes) > v_handoff.starts_at
         and visit.appointment_handoff_id is distinct from v_handoff.id
    )
    or exists (
      select 1
        from public.calendar_user_events event
       where event.company_id = v_handoff.company_id
         and event.deleted_at is null
         and lower(event.status) <> 'denied'
         and v_handoff.requested_owner_user_id::text = any(coalesce(event.team_member_ids, array[event.user_id::text]))
         and event.start_date < v_handoff.ends_at
         and event.end_date > v_handoff.starts_at
    )
    or exists (
      select 1
        from public.project_tasks task
       where task.company_id = v_handoff.company_id
         and task.deleted_at is null
         and lower(task.status) not in ('completed', 'cancelled')
         and v_handoff.requested_owner_user_id::text = any(coalesce(task.team_member_ids, '{}'::text[]))
         and task.start_date is not null
         and task.end_date is not null
         and (case when task.all_day
                then task.start_date::date::timestamp
                else task.start_date::date + coalesce(task.start_time, '00:00')::time
              end at time zone v_handoff.event_timezone) < v_handoff.ends_at
         and (case when task.all_day
                then task.end_date::date + time '23:59:59'
                else task.end_date::date + coalesce(task.end_time, '23:59:59')::time
              end at time zone v_handoff.event_timezone) > v_handoff.starts_at
    )
  ) then
    v_review_reason := 'event_time_conflict';
  end if;

  if v_review_reason is not null then
    update public.phase_c_bilateral_event_handoffs
       set status = 'review',
           review_reason = v_review_reason,
           canonical_event_kind = null,
           canonical_event_id = null,
           updated_at = now()
     where id = v_handoff.id;
    return jsonb_build_object('status', 'review', 'review_reason', v_review_reason);
  end if;

  insert into public.site_visits (
    company_id, opportunity_id, scheduled_at, duration_minutes,
    assignee_ids, status, booked_at, created_by, appointment_handoff_id,
    appointment_kind, appointment_title, appointment_location,
    appointment_attendees, notes
  ) values (
    v_handoff.company_id::text, v_handoff.opportunity_id,
    v_handoff.starts_at, v_duration,
    array[v_handoff.requested_owner_user_id::text], 'scheduled', now(),
    v_handoff.requested_owner_user_id::text, v_handoff.id,
    v_handoff.event_kind, btrim(v_handoff.event_title),
    btrim(v_handoff.location), v_handoff.attendees,
    'Booked from bilateral email confirmation.'
  )
  on conflict (appointment_handoff_id) where appointment_handoff_id is not null
  do update set appointment_handoff_id = excluded.appointment_handoff_id
  returning id into v_visit_id;

  insert into public.activities (
    company_id, opportunity_id, type, subject, content, duration_minutes,
    created_by, is_read, site_visit_id
  ) values (
    v_handoff.company_id, v_handoff.opportunity_id,
    'site_visit_scheduled', btrim(v_handoff.event_title),
    btrim(v_handoff.location), v_duration,
    v_handoff.requested_owner_user_id, true, v_visit_id
  ) returning id into v_activity_id;

  update public.site_visits
     set activity_id = v_activity_id
   where id = v_visit_id;

  if v_opportunity.stage = 'new_lead' then
    perform public.move_opportunity_stage(
      v_handoff.opportunity_id,
      'qualifying',
      v_handoff.requested_owner_user_id
    );
  end if;

  update public.phase_c_bilateral_event_handoffs
     set status = 'consumed',
         review_reason = null,
         canonical_event_kind = 'site_visit',
         canonical_event_id = v_visit_id,
         consumed_at = coalesce(consumed_at, now()),
         updated_at = now()
   where id = v_handoff.id;

  return jsonb_build_object(
    'status', 'consumed',
    'canonical_event_kind', 'site_visit',
    'canonical_event_id', v_visit_id
  );
end;
$function$;

create or replace function public.read_phase_c_bilateral_event_handoff(
  p_handoff_id uuid,
  p_canonical_event_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'handoff_id', handoff.id,
    'company_id', handoff.company_id,
    'opportunity_id', handoff.opportunity_id,
    'requested_owner_user_id', handoff.requested_owner_user_id,
    'status', handoff.status,
    'review_reason', handoff.review_reason,
    'canonical_event_kind', handoff.canonical_event_kind,
    'canonical_event_id', handoff.canonical_event_id,
    'event_kind', handoff.event_kind,
    'event_title', handoff.event_title,
    'starts_at', handoff.starts_at,
    'event_timezone', handoff.event_timezone,
    'location', handoff.location,
    'lead_title', opportunity.title,
    'appointment', case when visit.id is null then null else jsonb_build_object(
      'id', visit.id,
      'scheduled_at', visit.scheduled_at,
      'duration_minutes', visit.duration_minutes,
      'assignee_ids', visit.assignee_ids,
      'status', visit.status,
      'booked_at', visit.booked_at,
      'appointment_handoff_id', visit.appointment_handoff_id,
      'appointment_kind', visit.appointment_kind,
      'appointment_title', visit.appointment_title,
      'appointment_location', visit.appointment_location
    ) end
  ) into v_result
  from public.phase_c_bilateral_event_handoffs handoff
  join public.opportunities opportunity
    on opportunity.id = handoff.opportunity_id
   and opportunity.company_id = handoff.company_id
  left join public.site_visits visit
    on visit.id = handoff.canonical_event_id
   and visit.appointment_handoff_id = handoff.id
  where handoff.id = p_handoff_id
    and (p_canonical_event_id is null
         or handoff.canonical_event_id = p_canonical_event_id);
  if v_result is null then
    raise exception 'bilateral_event_readback_failed' using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

create or replace function public.acknowledge_phase_c_bilateral_event_handoff(
  p_handoff_id uuid,
  p_worker_id text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  update public.phase_c_bilateral_event_handoffs
     set notification_sent_at = coalesce(notification_sent_at, now()),
         lease_owner = null,
         lease_expires_at = null,
         last_error_code = null,
         last_error_message = null,
         updated_at = now()
   where id = p_handoff_id
     and lease_owner = btrim(p_worker_id)
     and lease_expires_at > now();
  if not found then
    raise exception 'bilateral_event_handoff_lease_lost' using errcode = '55000';
  end if;
  return 'acknowledged';
end;
$function$;

create or replace function public.fail_phase_c_bilateral_event_handoff(
  p_handoff_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  update public.phase_c_bilateral_event_handoffs
     set lease_owner = null,
         lease_expires_at = null,
         last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'unknown'), 100),
         last_error_message = left(coalesce(p_error_message, 'unknown'), 1000),
         next_attempt_at = now() + make_interval(
           secs => least(3600, 30 * power(2, greatest(attempt_count - 1, 0))::integer)
         ),
         processing_failed_at = case when attempt_count >= 8 then now() else null end,
         updated_at = now()
   where id = p_handoff_id
     and lease_owner = btrim(p_worker_id)
     and lease_expires_at > now()
  returning attempt_count into v_attempt_count;
  if not found then
    raise exception 'bilateral_event_handoff_lease_lost' using errcode = '55000';
  end if;
  return case when v_attempt_count >= 8 then 'failed' else 'retrying' end;
end;
$function$;

revoke all on function public.record_phase_c_bilateral_event_handoff(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.record_phase_c_bilateral_event_handoff(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, text, text, jsonb, text, text
) to service_role;

revoke all on function public.claim_phase_c_bilateral_event_handoffs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_phase_c_bilateral_event_handoffs(text, integer, integer)
  to service_role;
revoke all on function public.consume_phase_c_bilateral_event_handoff(uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_phase_c_bilateral_event_handoff(uuid, text)
  to service_role;
revoke all on function public.read_phase_c_bilateral_event_handoff(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_phase_c_bilateral_event_handoff(uuid, uuid)
  to service_role;
revoke all on function public.acknowledge_phase_c_bilateral_event_handoff(uuid, text)
  from public, anon, authenticated;
grant execute on function public.acknowledge_phase_c_bilateral_event_handoff(uuid, text)
  to service_role;
revoke all on function public.fail_phase_c_bilateral_event_handoff(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_phase_c_bilateral_event_handoff(uuid, text, text, text)
  to service_role;

comment on function public.consume_phase_c_bilateral_event_handoff(uuid, text) is
  'Atomically revalidates and books one Phase C bilateral appointment; ambiguity becomes review.';
