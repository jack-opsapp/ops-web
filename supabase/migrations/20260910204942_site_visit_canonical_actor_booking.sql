-- Phase 19. Explicit-actor canonical appointment primitives and compatibility guard.
-- This migration does not activate a company or expose a new public write tool.
-- All staff callers retain their original public RPC signature and business flow.
begin;
create table private.site_visit_booking_write_tokens (
 transaction_id bigint not null, backend_pid integer not null, site_visit_id uuid not null,
 changes jsonb not null, primary key(transaction_id,backend_pid,site_visit_id),
 check(jsonb_typeof(changes)='object' and octet_length(changes::text)<=16384)
);
alter table private.site_visit_booking_write_tokens enable row level security;
alter table private.site_visit_booking_write_tokens force row level security;
revoke all on private.site_visit_booking_write_tokens from public,anon,authenticated,service_role;
create function private.allow_site_visit_booking_write(p_visit uuid,p_company text,p_changes jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if private.site_visit_concurrency_enabled(p_company) then
  insert into private.site_visit_booking_write_tokens values(txid_current(),pg_backend_pid(),p_visit,p_changes)
  on conflict(transaction_id,backend_pid,site_visit_id) do update set changes=excluded.changes;
 end if;
end $$;
revoke all on function private.allow_site_visit_booking_write(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function private.guard_site_visit_booking_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare allowed jsonb; old_row jsonb:='{}'; next_row jsonb:=to_jsonb(new); k text;
 keys text[]:=array['company_id','scheduled_at','duration_minutes','assignee_ids','booked_at','reminder_lead_minutes','activity_id','google_calendar_event_id','google_calendar_id','google_calendar_synced_at','calendar_event_id','deleted_at'];
begin
 if tg_op='DELETE' then
  if old.booked_at is not null and private.site_visit_concurrency_enabled(old.company_id) and auth.role() is distinct from 'service_role' then
   raise exception 'SITE_VISIT_BOOKING_RPC_REQUIRED' using errcode='42501';
  end if;
  return old;
 end if;
 if tg_op='UPDATE' then old_row:=to_jsonb(old);end if;
 if coalesce(next_row->>'booked_at',old_row->>'booked_at') is null or
    not (private.site_visit_concurrency_enabled(new.company_id) or private.site_visit_concurrency_enabled(old_row->>'company_id')) then return new;end if;
 -- The private token is bound to one backend, transaction, row and exact values.
 delete from private.site_visit_booking_write_tokens t where t.transaction_id=txid_current()
 and t.backend_pid=pg_backend_pid() and t.site_visit_id=new.id returning changes into allowed;
 if allowed is not null then
  if exists(select 1 from jsonb_each(allowed) x where next_row->x.key is distinct from x.value) then
   raise exception 'SITE_VISIT_BOOKING_WRITE_CHANGED' using errcode='42501';
  end if;
 end if;
 -- Existing server-owned guest/confirmed-email booking RPCs and the calendar
 -- provider worker remain trusted backend writers. A phone JWT cannot take this path.
 if auth.role()='service_role' then return new;end if;
 if tg_op='INSERT' then
  if allowed is null or not allowed ?& array['company_id','scheduled_at','duration_minutes','assignee_ids','booked_at','status','created_by'] then
   raise exception 'SITE_VISIT_BOOKING_RPC_REQUIRED' using errcode='42501';
  end if;
  return new;
 end if;
 foreach k in array keys loop
  if old_row->k is distinct from next_row->k and (allowed is null or not allowed?k) then
   raise exception 'SITE_VISIT_BOOKING_RPC_REQUIRED' using errcode='42501';
  end if;
 end loop;
 if (old.status='cancelled') is distinct from (new.status='cancelled') and (allowed is null or not allowed?'status') then
  raise exception 'SITE_VISIT_BOOKING_RPC_REQUIRED' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_site_visit_booking_write() from public,anon,authenticated,service_role;
create trigger site_visits_guard_booking_write before insert or update or delete on public.site_visits
for each row execute function private.guard_site_visit_booking_write();
CREATE OR REPLACE FUNCTION private.book_site_visit_for_actor(p_actor_user_id uuid, p_opportunity_id uuid, p_scheduled_at timestamp with time zone, p_duration_minutes integer DEFAULT 60, p_assignee_ids text[] DEFAULT NULL::text[], p_reminder_lead_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
  v_opp public.opportunities%rowtype;
  v_duration int := coalesce(p_duration_minutes, 60);
  v_raw_assignees text[];
  v_assignees text[];
  v_member_count int;
  v_visit_id uuid;
  v_activity_id uuid;
begin
  if p_opportunity_id is null then
    raise exception 'opportunity_id_required' using errcode = '22004';
  end if;
  if p_scheduled_at is null then
    raise exception 'scheduled_at_required' using errcode = '22004';
  end if;

  v_actor_user_id := p_actor_user_id;
  select u.company_id into v_company_id from public.users u
  join public.companies c on c.id=u.company_id and c.deleted_at is null
  where u.id=p_actor_user_id and u.deleted_at is null and coalesce(u.is_active,false);
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;

  -- Match the canonical stage mover's lock order before taking the lead row.
  -- The same company lock is reentrant when stage movement runs below.
  perform private.lock_lead_assignment_company(v_company_id);
  -- The opportunity row lock is the booking mutex: concurrent book calls on the
  -- same lead serialize here, so the one-open-booking check below cannot race.
  select * into v_opp
    from public.opportunities
   where id = p_opportunity_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if v_opp.company_id is distinct from v_company_id then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;
  if not private.actor_can_edit_site_visit(
    v_actor_user_id,     v_opp.company_id::text, p_opportunity_id, null, null
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;

  if p_scheduled_at <= now() - interval '5 minutes' then
    raise exception 'site_visit_time_in_past' using errcode = '22023';
  end if;
  if v_duration < 15 or v_duration > 480 then
    raise exception 'site_visit_duration_out_of_range' using errcode = '22023';
  end if;
  if p_reminder_lead_minutes is not null
     and (p_reminder_lead_minutes < 0 or p_reminder_lead_minutes > 1440) then
    raise exception 'site_visit_reminder_out_of_range' using errcode = '22023';
  end if;

  v_raw_assignees := coalesce(nullif(p_assignee_ids, '{}'::text[]), array[v_actor_user_id::text]);
  if exists (
    select 1 from unnest(v_raw_assignees) a
     where a is null or private.try_parse_uuid(a) is null
  ) then
    raise exception 'site_visit_assignees_invalid' using errcode = '22023';
  end if;
  select array_agg(distinct a order by a) into v_assignees from unnest(v_raw_assignees) a;
  select count(*) into v_member_count
    from public.users u
   where u.id::text = any(v_assignees)
     and u.company_id = v_company_id
     and u.deleted_at is null;
  if v_member_count <> array_length(v_assignees, 1) then
    raise exception 'site_visit_assignees_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.site_visits sv
     where sv.opportunity_id = p_opportunity_id
       and sv.booked_at is not null
       and sv.deleted_at is null
       and sv.status = 'scheduled'
  ) then
    raise exception 'site_visit_already_booked' using errcode = '55000';
  end if;

  v_visit_id := gen_random_uuid();
  perform private.allow_site_visit_booking_write(v_visit_id,v_company_id::text,
    jsonb_build_object('company_id',v_company_id::text,'scheduled_at',p_scheduled_at,'duration_minutes',v_duration,
      'assignee_ids',v_assignees,'booked_at',now(),'status','scheduled','created_by',v_actor_user_id::text));
  insert into public.site_visits (
    id, company_id, opportunity_id, client_id, client_ref,
    scheduled_at, duration_minutes, assignee_ids, status,
    booked_at, reminder_lead_minutes, created_by
  ) values (
    v_visit_id, v_opp.company_id::text,
    p_opportunity_id,
    v_opp.client_id::text,
    v_opp.client_id,
    p_scheduled_at,
    v_duration,
    v_assignees,
    'scheduled',
    now(),
    p_reminder_lead_minutes,
    v_actor_user_id::text
  ) returning id into v_visit_id;

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_opp.company_id, p_opportunity_id, v_opp.client_id,
    'site_visit_scheduled', 'Site visit booked',
    to_char(p_scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_duration, v_actor_user_id, '{}'::text[], true, v_visit_id
  ) returning id into v_activity_id;

  perform private.allow_site_visit_booking_write(v_visit_id,v_company_id::text,jsonb_build_object('activity_id',v_activity_id));
  update public.site_visits set activity_id = v_activity_id where id = v_visit_id;

  if v_opp.stage = 'new_lead' then
    perform public.move_opportunity_stage(p_opportunity_id, 'qualifying', v_actor_user_id);
  end if;

  return v_visit_id;
end;
$function$
;

revoke all on function private.book_site_visit_for_actor(uuid,uuid,timestamp with time zone,integer,text[],integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.book_site_visit(p_opportunity_id uuid, p_scheduled_at timestamp with time zone, p_duration_minutes integer DEFAULT 60, p_assignee_ids text[] DEFAULT NULL::text[], p_reminder_lead_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
 begin
   return private.book_site_visit_for_actor(private.get_current_user_id(),p_opportunity_id,p_scheduled_at,p_duration_minutes,p_assignee_ids,p_reminder_lead_minutes);
 end;
 $function$;


CREATE OR REPLACE FUNCTION private.cancel_site_visit_booking_for_actor(p_actor_user_id uuid, p_site_visit_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
  v_visit public.site_visits%rowtype;
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;

  v_actor_user_id := p_actor_user_id;
  select u.company_id into v_company_id from public.users u
  join public.companies c on c.id=u.company_id and c.deleted_at is null
  where u.id=p_actor_user_id and u.deleted_at is null and coalesce(u.is_active,false);
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;

  select * into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not private.actor_can_edit_site_visit(
    v_actor_user_id,     v_visit.company_id, v_visit.opportunity_id, v_visit.project_id, v_visit.project_ref
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;
  if private.try_parse_uuid(v_visit.company_id) is distinct from v_company_id then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_cancel_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.booked_at is null then
    raise exception 'site_visit_not_a_booking' using errcode = '55000';
  end if;
  if v_visit.status::text = 'cancelled' then
    return p_site_visit_id;
  end if;
  if v_visit.status::text = 'completed' then
    raise exception 'cannot_cancel_completed_site_visit' using errcode = '55000';
  end if;
  if v_visit.status::text = 'in_progress' then
    raise exception 'site_visit_already_started' using errcode = '55000';
  end if;

  -- The status flip fires the Google sync trigger, which enqueues the remote
  -- delete when a calendar-scoped connection exists.
  perform private.allow_site_visit_booking_write(p_site_visit_id,v_company_id::text,jsonb_build_object('status','cancelled'));
  update public.site_visits
     set status = 'cancelled'
   where id = p_site_visit_id;

  -- A cancelled booking must never materialize remotely: neutralize any
  -- still-pending create/update work the booking enqueued earlier.
  update public.google_calendar_sync_queue
     set status = 'skipped',
         skip_reason = 'booking_cancelled',
         updated_at = now()
   where site_visit_id = p_site_visit_id
     and status = 'pending'
     and operation in ('create', 'update');

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_company_id,
    v_visit.opportunity_id,
    coalesce(v_visit.client_ref, private.try_parse_uuid(v_visit.client_id)),
    'site_visit_scheduled', 'Site visit cancelled',
    to_char(v_visit.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_visit.duration_minutes, v_actor_user_id, '{}'::text[], true, p_site_visit_id
  );

  return p_site_visit_id;
end;
$function$
;

revoke all on function private.cancel_site_visit_booking_for_actor(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cancel_site_visit_booking(p_site_visit_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
 begin
   return private.cancel_site_visit_booking_for_actor(private.get_current_user_id(),p_site_visit_id);
 end;
 $function$;


CREATE OR REPLACE FUNCTION private.reschedule_site_visit_for_actor(p_actor_user_id uuid, p_site_visit_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer, p_assignee_ids text[] DEFAULT NULL::text[], p_reminder_lead_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
  v_visit public.site_visits%rowtype;
  v_new_scheduled timestamptz;
  v_new_duration int;
  v_new_reminder int;
  v_raw_assignees text[];
  v_new_assignees text[];
  v_current_sorted text[];
  v_member_count int;
  v_changed boolean;
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;

  v_actor_user_id := p_actor_user_id;
  select u.company_id into v_company_id from public.users u
  join public.companies c on c.id=u.company_id and c.deleted_at is null
  where u.id=p_actor_user_id and u.deleted_at is null and coalesce(u.is_active,false);
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;

  select * into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not private.actor_can_edit_site_visit(
    v_actor_user_id,     v_visit.company_id, v_visit.opportunity_id, v_visit.project_id, v_visit.project_ref
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;
  if private.try_parse_uuid(v_visit.company_id) is distinct from v_company_id then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_reschedule_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.booked_at is null then
    raise exception 'site_visit_not_a_booking' using errcode = '55000';
  end if;
  if v_visit.status::text <> 'scheduled' then
    raise exception 'site_visit_not_reschedulable' using errcode = '55000';
  end if;

  -- NULL / same time = keep, and the past-time rule only judges a real move.
  if p_scheduled_at is null or p_scheduled_at = v_visit.scheduled_at then
    v_new_scheduled := v_visit.scheduled_at;
  else
    if p_scheduled_at <= now() - interval '5 minutes' then
      raise exception 'site_visit_time_in_past' using errcode = '22023';
    end if;
    v_new_scheduled := p_scheduled_at;
  end if;

  v_new_duration := coalesce(p_duration_minutes, v_visit.duration_minutes);
  if v_new_duration < 15 or v_new_duration > 480 then
    raise exception 'site_visit_duration_out_of_range' using errcode = '22023';
  end if;

  -- Reminder override semantics: NULL = keep, -1 = clear back to the user default,
  -- 0..1440 = set. Documented for iOS/web/MCP callers.
  if p_reminder_lead_minutes is null then
    v_new_reminder := v_visit.reminder_lead_minutes;
  elsif p_reminder_lead_minutes = -1 then
    v_new_reminder := null;
  elsif p_reminder_lead_minutes between 0 and 1440 then
    v_new_reminder := p_reminder_lead_minutes;
  else
    raise exception 'site_visit_reminder_out_of_range' using errcode = '22023';
  end if;

  if p_assignee_ids is null or p_assignee_ids = '{}'::text[] then
    v_new_assignees := v_visit.assignee_ids;
  else
    v_raw_assignees := p_assignee_ids;
    if exists (
      select 1 from unnest(v_raw_assignees) a
       where a is null or private.try_parse_uuid(a) is null
    ) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
    select array_agg(distinct a order by a) into v_new_assignees from unnest(v_raw_assignees) a;
    select count(*) into v_member_count
      from public.users u
     where u.id::text = any(v_new_assignees)
       and u.company_id = v_company_id
       and u.deleted_at is null;
    if v_member_count <> array_length(v_new_assignees, 1) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
  end if;

  select array_agg(x order by x) into v_current_sorted from unnest(coalesce(v_visit.assignee_ids, '{}'::text[])) x;
  v_changed := v_visit.scheduled_at is distinct from v_new_scheduled
    or v_visit.duration_minutes is distinct from v_new_duration
    or v_current_sorted is distinct from (select array_agg(x order by x) from unnest(coalesce(v_new_assignees, '{}'::text[])) x)
    or v_visit.reminder_lead_minutes is distinct from v_new_reminder;
  if not v_changed then
    return p_site_visit_id;
  end if;

  perform private.allow_site_visit_booking_write(p_site_visit_id,v_company_id::text,
    jsonb_build_object('scheduled_at',v_new_scheduled,'duration_minutes',v_new_duration,
      'assignee_ids',v_new_assignees,'reminder_lead_minutes',v_new_reminder));
  update public.site_visits
     set scheduled_at = v_new_scheduled,
         duration_minutes = v_new_duration,
         assignee_ids = v_new_assignees,
         reminder_lead_minutes = v_new_reminder
   where id = p_site_visit_id;

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_company_id,
    v_visit.opportunity_id,
    coalesce(v_visit.client_ref, private.try_parse_uuid(v_visit.client_id)),
    'site_visit_scheduled', 'Site visit rescheduled',
    to_char(v_new_scheduled at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_new_duration, v_actor_user_id, '{}'::text[], true, p_site_visit_id
  );

  return p_site_visit_id;
end;
$function$
;

revoke all on function private.reschedule_site_visit_for_actor(uuid,uuid,timestamp with time zone,integer,text[],integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.reschedule_site_visit(p_site_visit_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer, p_assignee_ids text[] DEFAULT NULL::text[], p_reminder_lead_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
 begin
   return private.reschedule_site_visit_for_actor(private.get_current_user_id(),p_site_visit_id,p_scheduled_at,p_duration_minutes,p_assignee_ids,p_reminder_lead_minutes);
 end;
 $function$;


CREATE OR REPLACE FUNCTION private.complete_site_visit_guarded(p_site_visit_id uuid, p_completion jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_visit public.site_visits%rowtype;
  v_company_id uuid;
  v_actor_user_id uuid;
  v_client_id uuid;
  v_activity_id uuid;
  v_photos text[];
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;
  if p_completion is null or jsonb_typeof(p_completion) <> 'object' then
    raise exception 'site_visit_completion_must_be_an_object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_completion) key
     where key <> all (array['notes', 'measurements', 'photos', 'internal_notes'])
  ) then
    raise exception 'site_visit_completion_has_unknown_fields'
      using errcode = '22023';
  end if;
  if (p_completion ? 'notes' and jsonb_typeof(p_completion -> 'notes') not in ('string', 'null'))
     or (p_completion ? 'measurements' and jsonb_typeof(p_completion -> 'measurements') not in ('string', 'null'))
     or (p_completion ? 'internal_notes' and jsonb_typeof(p_completion -> 'internal_notes') not in ('string', 'null'))
     or (p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') not in ('array', 'null')) then
    raise exception 'site_visit_completion_has_invalid_types'
      using errcode = '22023';
  end if;
  if pg_column_size(p_completion) > 1048576
     or char_length(p_completion ->> 'notes') > 200000
     or char_length(p_completion ->> 'measurements') > 200000
     or char_length(p_completion ->> 'internal_notes') > 200000 then
    raise exception 'site_visit_completion_exceeds_size_limit'
      using errcode = '22001';
  end if;
  if p_completion ? 'photos'
     and jsonb_typeof(p_completion -> 'photos') = 'array'
     and (
       jsonb_array_length(p_completion -> 'photos') > 100
       or exists (
         select 1
           from jsonb_array_elements(p_completion -> 'photos') as photo(value)
          where jsonb_typeof(photo.value) <> 'string'
             or char_length(photo.value #>> '{}') > 4096
       )
     ) then
    raise exception 'site_visit_completion_has_invalid_photos'
      using errcode = '22023';
  end if;

  select *
    into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not private.current_user_can_edit_site_visit(
    v_visit.company_id,
    v_visit.opportunity_id,
    v_visit.project_id,
    v_visit.project_ref
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;

  v_company_id := private.get_user_company_id();
  v_actor_user_id := private.get_current_user_id();
  if v_company_id is null or v_visit.company_id is distinct from v_company_id::text then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_actor_user_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_complete_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.status::text = 'cancelled' then
    raise exception 'cannot_complete_cancelled_site_visit' using errcode = '55000';
  end if;

  if p_completion ? 'photos' and jsonb_typeof(p_completion -> 'photos') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_photos
      from jsonb_array_elements_text(p_completion -> 'photos') value;
  elsif p_completion ? 'photos' then
    v_photos := null;
  else
    v_photos := v_visit.photos;
  end if;

  update public.site_visits
     set notes = case when p_completion ? 'notes'
                      then p_completion ->> 'notes' else notes end,
         measurements = case when p_completion ? 'measurements'
                             then p_completion ->> 'measurements' else measurements end,
         photos = case when p_completion ? 'photos' then v_photos else photos end,
         internal_notes = case when p_completion ? 'internal_notes'
                               then p_completion ->> 'internal_notes' else internal_notes end
   where id = p_site_visit_id;

  perform private.refresh_site_visit_compatibility(p_site_visit_id);

  update public.site_visits
     set status = 'completed',
         completed_at = coalesce(completed_at, clock_timestamp())
   where id = p_site_visit_id
   returning * into v_visit;

  v_activity_id := v_visit.activity_id;
  v_client_id := coalesce(
    v_visit.client_ref,
    private.try_parse_uuid(v_visit.client_id)
  );

  if v_visit.opportunity_id is not null
     or v_client_id is not null
     or coalesce(v_visit.project_ref::text, v_visit.project_id) is not null then
    insert into public.activities (
      company_id,
      opportunity_id,
      client_id,
      type,
      subject,
      content,
      duration_minutes,
      created_by,
      attachments,
      is_read,
      site_visit_id,
      project_id
    ) values (
      v_company_id,
      v_visit.opportunity_id,
      v_client_id,
      'site_visit',
      'Site visit completed',
      v_visit.notes,
      v_visit.duration_minutes,
      v_actor_user_id,
      coalesce(v_visit.photos, '{}'::text[]),
      true,
      v_visit.id,
      coalesce(v_visit.project_ref::text, v_visit.project_id)
    )
    on conflict (site_visit_id)
      where type = 'site_visit' and site_visit_id is not null
    do update set
      company_id = excluded.company_id,
      opportunity_id = excluded.opportunity_id,
      client_id = excluded.client_id,
      subject = excluded.subject,
      content = excluded.content,
      duration_minutes = excluded.duration_minutes,
      attachments = excluded.attachments,
      project_id = excluded.project_id
    returning id into v_activity_id;

    perform private.allow_site_visit_booking_write(p_site_visit_id,v_company_id::text,jsonb_build_object('activity_id',v_activity_id));
    update public.site_visits
       set activity_id = v_activity_id
     where id = p_site_visit_id
     returning * into v_visit;
  end if;

  return jsonb_build_object(
    'visit', to_jsonb(v_visit),
    'activity_id', v_activity_id
  );
end;
$function$
;
commit;
