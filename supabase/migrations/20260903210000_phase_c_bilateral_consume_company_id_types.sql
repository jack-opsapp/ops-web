-- Cluster N / bug aa2f5155: repair the two text = uuid comparisons that made
-- Phase C bilateral appointment consumption fail for every handoff.
--
-- email_connections.company_id and calendar_user_events.company_id are text;
-- opportunity_correspondence_events.company_id and the handoff's own
-- company_id are uuid. plpgsql plans a statement only on first execution, so
-- both comparisons were accepted at create time and raised
-- "operator does not exist: text = uuid" at runtime. The uuid side is cast to
-- text (never the reverse: casting a text column to uuid would throw for the
-- entire scan on one malformed row), matching the cast already used for
-- site_visits.company_id in the same predicate group.
--
-- The calendar_user_events comparison is latent only because the
-- email_connections one aborts first — they share one statement, so both must
-- ship together or the failure simply moves.
--
-- Function body is otherwise byte-identical to
-- 20260820222016_phase_c_bilateral_event_consumption.sql lines 193-443.

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
       and connection.company_id = event.company_id::text
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
       where event.company_id = v_handoff.company_id::text
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

revoke all on function public.consume_phase_c_bilateral_event_handoff(uuid, text)
  from public, anon, authenticated;
grant execute on function public.consume_phase_c_bilateral_event_handoff(uuid, text)
  to service_role;

comment on function public.consume_phase_c_bilateral_event_handoff(uuid, text) is
  'Atomically revalidates and books one Phase C bilateral appointment; ambiguity becomes review.';
