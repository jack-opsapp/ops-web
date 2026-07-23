begin;

do $recovery_prerequisites$
begin
  if to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
    or to_regprocedure('private.user_can_create_opportunity(uuid,uuid)') is null
    or to_regprocedure('private.user_can_edit_opportunity(uuid,uuid)') is null
    or to_regprocedure(
      'private.effective_pipeline_scope_for_user(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.authorize_email_inbox_action_as_system(uuid,uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure('private.permission_try_parse_uuid(text)') is null
    or to_regprocedure(
      'private.opportunity_sender_is_persisted_customer(uuid,uuid,text)'
    ) is null
    or to_regprocedure('public.requeue_email_attachment_attribution()') is null
    or to_regprocedure(
      'private.reconcile_email_attachment_conversion_photo(uuid)'
    ) is null
    or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.activities'::regclass
        and trigger_row.tgname =
          'activities_requeue_email_attachment_attribution'
        and trigger_row.tgenabled <> 'D'
        and not trigger_row.tgisinternal
    )
    or not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.activities'::regclass
        and trigger_row.tgname = 'activities_revoke_email_conversion_photos'
        and trigger_row.tgenabled <> 'D'
        and not trigger_row.tgisinternal
    )
  then
    raise exception 'exact_email_message_recovery_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$recovery_prerequisites$;

-- Exact ingestion can create a lead or reconcile an existing company lead, so
-- mailbox visibility alone is insufficient. Keep the service-role writer
-- actor-aware and require the same canonical create + company-wide edit scopes
-- used by reviewed historical imports before any ingestion mutation begins.
create or replace function public.authorize_email_exact_message_ingest_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_company_id is null
    or p_connection_id is null
  then
    raise exception 'invalid_exact_message_ingest_authorization_request'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.email_connections connection
    where connection.id = p_connection_id
      and connection.company_id = p_company_id::text
      and connection.status = 'active'
  ) then
    return false;
  end if;
  if not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    null,
    'view'
  ) then
    return false;
  end if;
  if not private.user_can_create_opportunity(
    p_actor_user_id,
    p_company_id
  ) then
    return false;
  end if;
  if private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'pipeline.edit'
  ) is distinct from 'all' then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function public.authorize_email_exact_message_ingest_as_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_exact_message_ingest_as_system(
  uuid, uuid, uuid
) to service_role;

-- Claim a pre-identity activity only after locking the exact row and
-- re-proving its immutable correspondence event inside the same transaction.
-- The caller's earlier read is discovery only; it never authorizes this write.
create or replace function public.claim_legacy_email_activity_connection_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_activity_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_activity public.activities%rowtype;
  locked_event public.opportunity_correspondence_events%rowtype;
  moved_rows integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
    or p_connection_id is null
    or p_activity_id is null
    or nullif(btrim(p_provider_thread_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
    or p_provider_message_id is distinct from btrim(p_provider_message_id)
  then
    raise exception 'invalid_legacy_email_activity_connection_claim'
      using errcode = '22023';
  end if;

  perform 1
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for key share;
  if not found then
    raise exception 'legacy_email_activity_connection_not_found'
      using errcode = 'P0002';
  end if;

  -- Follow the reparent RPC's event-before-activity lock order. Provider
  -- identity is unique for one company/mailbox/message, so this exact event
  -- is the only accepted ownership proof for a legacy identity claim.
  select event.*
  into locked_event
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.activity_id = p_activity_id
    and event.connection_id = p_connection_id
    and event.provider_thread_id = p_provider_thread_id
    and event.provider_message_id = p_provider_message_id
  for key share;
  if not found then
    raise exception 'legacy_email_activity_connection_unproven'
      using errcode = '23514';
  end if;

  select activity.*
  into locked_activity
  from public.activities activity
  where activity.id = p_activity_id
    and activity.company_id = p_company_id
    and activity.type = 'email'
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
  for update;
  if not found then
    raise exception 'legacy_email_activity_not_found'
      using errcode = 'P0002';
  end if;
  if locked_activity.email_connection_id is not null
    and locked_activity.email_connection_id is distinct from p_connection_id
  then
    raise exception 'legacy_email_activity_connection_conflict'
      using errcode = '23505';
  end if;

  if locked_event.opportunity_id is distinct from locked_activity.opportunity_id
    or locked_event.direction is distinct from locked_activity.direction
    or exists (
      select 1
      from public.opportunity_correspondence_events event
      where event.company_id = p_company_id
        and event.activity_id = p_activity_id
        and event.id <> locked_event.id
    )
  then
    raise exception 'legacy_email_activity_connection_conflict'
      using errcode = '23505';
  end if;

  if locked_activity.email_connection_id = p_connection_id then
    return true;
  end if;

  update public.activities activity
  set email_connection_id = p_connection_id
  where activity.id = p_activity_id
    and activity.company_id = p_company_id
    and activity.email_connection_id is null
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
    and activity.opportunity_id = locked_activity.opportunity_id
    and activity.direction = locked_activity.direction
    and activity.type = 'email';
  get diagnostics moved_rows = row_count;
  if moved_rows <> 1 then
    raise exception 'legacy_email_activity_connection_claim_race'
      using errcode = '40001';
  end if;

  return true;
end;
$function$;

revoke all on function public.claim_legacy_email_activity_connection_as_system(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_legacy_email_activity_connection_as_system(
  uuid, uuid, uuid, text, text
) to service_role;

-- One immutable application record per provider message and mailbox. The
-- manifest and entry hashes make a retry distinguishable from a conflicting
-- attempt to reuse the same provider identity for another move.
create table private.email_exact_message_recovery_applications (
  company_id uuid not null,
  connection_id uuid not null,
  provider_message_id text not null,
  provider_thread_id text not null,
  source_opportunity_id uuid not null,
  target_opportunity_id uuid not null,
  activity_id uuid not null,
  correspondence_event_id uuid not null,
  target_email text not null,
  actor_user_id uuid not null,
  manifest_sha256 text not null check (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  entry_sha256 text not null check (
    entry_sha256 ~ '^[0-9a-f]{64}$'
  ),
  target_resolution text check (
    target_resolution is null or target_resolution in ('created', 'existing')
  ),
  target_source_thread_key text,
  target_initial_title text,
  target_initial_contact_name text,
  status text not null check (
    status in ('attachment_pending', 'complete')
  ),
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attachment_scan_generation bigint not null check (
    attachment_scan_generation >= 1
  ),
  attachment_ids uuid[] not null default '{}'::uuid[],
  applied_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  primary key (company_id, connection_id, provider_message_id),
  foreign key (source_opportunity_id)
    references public.opportunities(id) on delete restrict,
  foreign key (target_opportunity_id)
    references public.opportunities(id) on delete restrict,
  foreign key (activity_id)
    references public.activities(id) on delete restrict,
  foreign key (correspondence_event_id)
    references public.opportunity_correspondence_events(id) on delete restrict,
  foreign key (actor_user_id)
    references public.users(id) on delete restrict,
  check (
    (
      target_resolution is null
      and target_source_thread_key is null
      and target_initial_title is null
      and target_initial_contact_name is null
    ) or (
      target_resolution in ('created', 'existing')
      and nullif(btrim(target_source_thread_key), '') is not null
      and nullif(btrim(target_initial_title), '') is not null
    )
  ),
  check (
    (
      status = 'attachment_pending'
      and attachment_count = 0
      and attachment_ids = '{}'::uuid[]
      and finalized_at is null
    ) or (
      status = 'complete'
      and attachment_count = cardinality(attachment_ids)
      and finalized_at is not null
    )
  )
);

revoke all on table private.email_exact_message_recovery_applications
  from public, anon, authenticated, service_role;

-- Read-only proof used only to reopen an expired, content-addressed manifest
-- whose exact attachment move is already durable. Returning NULL for any
-- identity/hash mismatch keeps stale manifests away from provider reads and
-- every mutation path.
create or replace function public.inspect_exact_message_recovery_application_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_manifest_sha256 text,
  p_entry_sha256 text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select application.status
  into v_status
  from private.email_exact_message_recovery_applications application
  where application.company_id = p_company_id
    and application.connection_id = p_connection_id
    and application.provider_thread_id = p_provider_thread_id
    and application.provider_message_id = p_provider_message_id
    and application.manifest_sha256 = p_manifest_sha256
    and application.entry_sha256 = p_entry_sha256;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object('status', v_status);
end;
$function$;

revoke all on function public.inspect_exact_message_recovery_application_as_system(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.inspect_exact_message_recovery_application_as_system(
  uuid, uuid, text, text, text, text
) to service_role;

-- Immutable all-action recovery outbox. Identity and approved content never
-- change; only monotonic step timestamps and resolved canonical row identities
-- advance. This is the durable source of truth for crash/stale resumption.
create table private.email_exact_message_recovery_work (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  provider_message_id text not null,
  provider_thread_id text not null,
  action text not null check (
    action in ('ingest', 'reparent', 'create_target_and_reparent')
  ),
  actor_user_id uuid not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  entry_sha256 text not null check (entry_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_generated_at timestamptz not null,
  manifest_cutoff_at timestamptz not null,
  message_payload jsonb not null check (
    jsonb_typeof(message_payload) = 'object'
  ),
  activity_id uuid,
  opportunity_id uuid,
  source_opportunity_id uuid,
  target_opportunity_id uuid,
  correspondence_event_id uuid,
  attachment_scan_generation bigint check (
    attachment_scan_generation is null or attachment_scan_generation >= 1
  ),
  attachment_ids uuid[],
  attachment_required boolean not null,
  repair_required boolean not null,
  draft_projection_required boolean not null,
  mutation_completed_at timestamptz,
  attachment_completed_at timestamptz,
  repair_completed_at timestamptz,
  draft_projection_completed_at timestamptz,
  abandoned_at timestamptz,
  abandoned_by uuid,
  superseded_by_manifest_sha256 text check (
    superseded_by_manifest_sha256 is null
      or superseded_by_manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  superseded_by_entry_sha256 text check (
    superseded_by_entry_sha256 is null
      or superseded_by_entry_sha256 ~ '^[0-9a-f]{64}$'
  ),
  state text not null check (
    state in (
      'ingest_pending',
      'mutation_pending',
      'attachment_scan_pending',
      'repair_pending',
      'draft_projection_pending',
      'abandoned',
      'complete'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (actor_user_id) references public.users(id) on delete restrict,
  foreign key (abandoned_by) references public.users(id) on delete restrict,
  check (
    (action = 'ingest' and not attachment_required and not repair_required)
    or (action <> 'ingest' and attachment_required and repair_required)
  ),
  check (
    message_payload ->> 'id' = provider_message_id
    and message_payload ->> 'threadId' = provider_thread_id
    and nullif(message_payload ->> 'date', '') is not null
  ),
  check (
    (
      state = 'abandoned'
      and abandoned_at is not null
      and abandoned_by is not null
      and superseded_by_manifest_sha256 is not null
      and superseded_by_entry_sha256 is not null
      and mutation_completed_at is null
      and attachment_scan_generation is null
      and attachment_ids is null
      and attachment_completed_at is null
      and repair_completed_at is null
      and draft_projection_completed_at is null
    ) or (
      state <> 'abandoned'
      and abandoned_at is null
      and abandoned_by is null
      and superseded_by_manifest_sha256 is null
      and superseded_by_entry_sha256 is null
    )
  ),
  check (manifest_cutoff_at <= manifest_generated_at),
  check (
    (state = 'ingest_pending'
      and action = 'ingest'
      and mutation_completed_at is null
      and attachment_scan_generation is null
      and attachment_ids is null
      and attachment_completed_at is null
      and repair_completed_at is null
      and draft_projection_completed_at is null)
    or (state = 'mutation_pending'
      and action <> 'ingest'
      and mutation_completed_at is null
      and attachment_scan_generation is null
      and attachment_ids is null
      and attachment_completed_at is null
      and repair_completed_at is null
      and draft_projection_completed_at is null)
    or (state = 'attachment_scan_pending'
      and action <> 'ingest'
      and mutation_completed_at is not null
      and attachment_scan_generation is not null
      and attachment_ids is null
      and attachment_completed_at is null
      and repair_completed_at is null
      and draft_projection_completed_at is null)
    or (state = 'repair_pending'
      and mutation_completed_at is not null
      and attachment_scan_generation is not null
      and attachment_ids is not null
      and attachment_completed_at is not null
      and repair_completed_at is null
      and draft_projection_completed_at is null)
    or (state = 'draft_projection_pending'
      and draft_projection_required
      and mutation_completed_at is not null
      and (not attachment_required or attachment_scan_generation is not null)
      and (not attachment_required or attachment_ids is not null)
      and (not attachment_required or attachment_completed_at is not null)
      and (not repair_required or repair_completed_at is not null)
      and draft_projection_completed_at is null)
    or (state = 'complete'
      and mutation_completed_at is not null
      and (attachment_required = (attachment_scan_generation is not null))
      and (attachment_required = (attachment_ids is not null))
      and (attachment_required = (attachment_completed_at is not null))
      and (repair_required = (repair_completed_at is not null))
      and (draft_projection_required =
        (draft_projection_completed_at is not null)))
    or state = 'abandoned'
  )
);

create unique index email_exact_message_recovery_work_active_message_uidx
  on private.email_exact_message_recovery_work (
    company_id, connection_id, provider_message_id
  )
  where abandoned_at is null;

revoke all on table private.email_exact_message_recovery_work
  from public, anon, authenticated, service_role;

create or replace function private.exact_message_recovery_work_json(
  p_work private.email_exact_message_recovery_work
) returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select pg_catalog.jsonb_build_object(
    'action', p_work.action,
    'activity_id', p_work.activity_id,
    'opportunity_id', p_work.opportunity_id,
    'source_opportunity_id', p_work.source_opportunity_id,
    'target_opportunity_id', p_work.target_opportunity_id,
    'correspondence_event_id', p_work.correspondence_event_id,
    'message_payload', p_work.message_payload,
    'mutation_completed', p_work.mutation_completed_at is not null,
    'attachment_required', p_work.attachment_required,
    'attachment_completed', p_work.attachment_completed_at is not null,
    'repair_required', p_work.repair_required,
    'repair_completed', p_work.repair_completed_at is not null,
    'draft_projection_required', p_work.draft_projection_required,
    'draft_projection_completed',
      p_work.draft_projection_completed_at is not null,
    'state', p_work.state
  );
$function$;

revoke all on function private.exact_message_recovery_work_json(
  private.email_exact_message_recovery_work
) from public, anon, authenticated, service_role;

create or replace function public.inspect_exact_message_recovery_work_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_manifest_sha256 text,
  p_entry_sha256 text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_work private.email_exact_message_recovery_work%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_thread_id = p_provider_thread_id
    and work.provider_message_id = p_provider_message_id
    and work.manifest_sha256 = p_manifest_sha256
    and work.entry_sha256 = p_entry_sha256
    and work.abandoned_at is null;
  if not found then return null; end if;
  return private.exact_message_recovery_work_json(v_work);
end;
$function$;

revoke all on function public.inspect_exact_message_recovery_work_as_system(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.inspect_exact_message_recovery_work_as_system(
  uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.register_exact_message_recovery_work_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_action text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_manifest_generated_at timestamptz,
  p_manifest_cutoff_at timestamptz,
  p_activity_id uuid,
  p_opportunity_id uuid,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_correspondence_event_id uuid,
  p_attachment_required boolean,
  p_repair_required boolean,
  p_draft_projection_required boolean,
  p_message_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_work private.email_exact_message_recovery_work%rowtype;
  v_activity public.activities%rowtype;
  v_event public.opportunity_correspondence_events%rowtype;
  v_application private.email_exact_message_recovery_applications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(p_company_id);
  perform 1 from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_inactive' using errcode = '42501';
  end if;
  perform 1 from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for share;
  if not found then
    raise exception 'recovery_connection_inactive' using errcode = '42501';
  end if;
  if not public.authorize_email_inbox_action_as_system(
    p_actor_user_id, p_connection_id, null, 'view'
  ) then
    raise exception 'recovery_actor_cannot_view_mailbox' using errcode = '42501';
  end if;
  if p_action not in ('ingest', 'reparent', 'create_target_and_reparent')
    or p_message_payload ->> 'id' is distinct from p_provider_message_id
    or p_message_payload ->> 'threadId' is distinct from p_provider_thread_id
    or nullif(p_message_payload ->> 'date', '') is null
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_generated_at is null
    or p_manifest_generated_at > clock_timestamp()
    or p_manifest_generated_at < clock_timestamp() - interval '24 hours'
    or p_manifest_cutoff_at is null
    or p_manifest_cutoff_at > p_manifest_generated_at
  then
    raise exception 'invalid_exact_recovery_work' using errcode = '22023';
  end if;

  if p_action = 'ingest' then
    if p_attachment_required
      or p_repair_required
      or p_source_opportunity_id is not null
      or p_target_opportunity_id is not null
      or p_correspondence_event_id is not null
      or (p_activity_id is null and p_opportunity_id is not null)
      or not public.authorize_email_exact_message_ingest_as_system(
        p_actor_user_id, p_company_id, p_connection_id
      )
    then
      raise exception 'recovery_ingest_registration_denied'
        using errcode = '42501';
    end if;

    select activity.* into v_activity
    from public.activities activity
    where activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or activity.email_connection_id is null
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    limit 1
    for share;
    if found and (
      p_activity_id is null
      or v_activity.id is distinct from p_activity_id
      or v_activity.opportunity_id is distinct from p_opportunity_id
    ) then
      raise exception 'recovery_ingest_activity_identity_changed'
        using errcode = '40001';
    elsif not found and p_activity_id is not null then
      raise exception 'recovery_ingest_activity_not_found'
        using errcode = '40001';
    end if;
    if v_activity.id is not null
      and v_activity.email_connection_id is null
      and not exists (
        select 1
        from public.opportunity_correspondence_events event
        where event.company_id = p_company_id
          and event.connection_id = p_connection_id
          and event.provider_thread_id = p_provider_thread_id
          and event.provider_message_id = p_provider_message_id
          and event.activity_id = v_activity.id
          and event.opportunity_id is not distinct from v_activity.opportunity_id
          and event.opportunity_projection_applied is true
          and event.direction = 'inbound'
          and event.party_role = 'customer'
          and event.is_meaningful is true
      )
    then
      raise exception 'recovery_ingest_legacy_mailbox_unproven'
        using errcode = '40001';
    end if;
  else
    if not p_attachment_required
      or not p_repair_required
      or p_opportunity_id is not null
      or p_activity_id is null
      or p_source_opportunity_id is null
      or p_correspondence_event_id is null
      or not private.user_can_edit_opportunity(
        p_actor_user_id, p_source_opportunity_id
      )
    then
      raise exception 'recovery_reparent_registration_denied'
        using errcode = '42501';
    end if;
    if p_action = 'reparent' then
      if p_target_opportunity_id is null
        or p_target_opportunity_id = p_source_opportunity_id
        or not private.user_can_edit_opportunity(
          p_actor_user_id, p_target_opportunity_id
        )
      then
        raise exception 'recovery_reparent_target_denied'
          using errcode = '42501';
      end if;
    elsif not public.authorize_email_exact_message_ingest_as_system(
      p_actor_user_id, p_company_id, p_connection_id
    ) or (
      p_target_opportunity_id is not null
      and not private.user_can_edit_opportunity(
        p_actor_user_id, p_target_opportunity_id
      )
    ) then
      raise exception 'recovery_target_creation_registration_denied'
        using errcode = '42501';
    end if;

    select activity.* into v_activity
    from public.activities activity
    where activity.id = p_activity_id
      and activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or activity.email_connection_id is null
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    for share;
    if not found then
      raise exception 'recovery_registration_activity_not_found'
        using errcode = '40001';
    end if;

    select event.* into v_event
    from public.opportunity_correspondence_events event
    where event.id = p_correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.activity_id = p_activity_id
      and event.opportunity_projection_applied is true
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
    for share;
    if not found
      or v_event.opportunity_id is distinct from v_activity.opportunity_id
    then
      raise exception 'recovery_registration_event_not_found'
        using errcode = '40001';
    end if;

    if v_activity.opportunity_id is distinct from p_source_opportunity_id then
      if p_target_opportunity_id is null
        or v_activity.opportunity_id is distinct from p_target_opportunity_id
      then
        raise exception 'recovery_registration_owner_changed'
          using errcode = '40001';
      end if;
      select application.* into v_application
      from private.email_exact_message_recovery_applications application
      where application.company_id = p_company_id
        and application.connection_id = p_connection_id
        and application.provider_thread_id = p_provider_thread_id
        and application.provider_message_id = p_provider_message_id
        and application.activity_id = p_activity_id
        and application.correspondence_event_id = p_correspondence_event_id
        and application.source_opportunity_id = p_source_opportunity_id
        and application.target_opportunity_id = p_target_opportunity_id
        and application.actor_user_id = p_actor_user_id
        and application.manifest_sha256 = p_manifest_sha256
        and application.entry_sha256 = p_entry_sha256
      for share;
      if not found then
        raise exception 'recovery_registration_applied_proof_missing'
          using errcode = '40001';
      end if;
    end if;
  end if;

  select prior.* into v_work
  from private.email_exact_message_recovery_work prior
  where prior.company_id = p_company_id
    and prior.connection_id = p_connection_id
    and prior.provider_message_id = p_provider_message_id
    and prior.state = 'abandoned'
  order by prior.abandoned_at desc
  limit 1;
  if found and (
    v_work.superseded_by_manifest_sha256 is distinct from p_manifest_sha256
    or v_work.superseded_by_entry_sha256 is distinct from p_entry_sha256
  ) then
    raise exception 'recovery_superseding_manifest_conflict'
      using errcode = '23505';
  end if;

  insert into private.email_exact_message_recovery_work (
    company_id, connection_id, provider_message_id, provider_thread_id,
    action, actor_user_id, manifest_sha256, entry_sha256,
    manifest_generated_at, manifest_cutoff_at, message_payload,
    activity_id, opportunity_id, source_opportunity_id,
    target_opportunity_id, correspondence_event_id,
    attachment_required, repair_required, draft_projection_required, state
  ) values (
    p_company_id, p_connection_id, p_provider_message_id,
    p_provider_thread_id, p_action, p_actor_user_id, p_manifest_sha256,
    p_entry_sha256, p_manifest_generated_at, p_manifest_cutoff_at,
    p_message_payload, p_activity_id, p_opportunity_id,
    p_source_opportunity_id, p_target_opportunity_id,
    p_correspondence_event_id, p_attachment_required, p_repair_required,
    p_draft_projection_required,
    case when p_action = 'ingest' then 'ingest_pending'
      else 'mutation_pending' end
  ) on conflict (company_id, connection_id, provider_message_id)
    where abandoned_at is null
    do nothing;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_message_id = p_provider_message_id
    and work.abandoned_at is null
  for update;
  if v_work.provider_thread_id is distinct from p_provider_thread_id
    or v_work.action is distinct from p_action
    or v_work.actor_user_id is distinct from p_actor_user_id
    or v_work.manifest_sha256 is distinct from p_manifest_sha256
    or v_work.entry_sha256 is distinct from p_entry_sha256
    or v_work.manifest_generated_at is distinct from p_manifest_generated_at
    or v_work.manifest_cutoff_at is distinct from p_manifest_cutoff_at
    or v_work.message_payload is distinct from p_message_payload
    or v_work.attachment_required is distinct from p_attachment_required
    or v_work.repair_required is distinct from p_repair_required
    or v_work.draft_projection_required is distinct from
      p_draft_projection_required
    or (v_work.activity_id is not null and
      v_work.activity_id is distinct from p_activity_id)
    or (v_work.opportunity_id is not null and
      v_work.opportunity_id is distinct from p_opportunity_id)
    or v_work.source_opportunity_id is distinct from p_source_opportunity_id
    or (p_target_opportunity_id is not null and
      v_work.target_opportunity_id is distinct from p_target_opportunity_id)
    or v_work.correspondence_event_id is distinct from
      p_correspondence_event_id
  then
    raise exception 'recovery_manifest_conflict' using errcode = '23505';
  end if;
  return private.exact_message_recovery_work_json(v_work);
end;
$function$;

revoke all on function public.register_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.register_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, boolean, jsonb
) to service_role;

create or replace function public.abandon_exact_message_recovery_work_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_superseding_manifest_sha256 text,
  p_superseding_entry_sha256 text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_work private.email_exact_message_recovery_work%rowtype;
  v_activity public.activities%rowtype;
  v_event public.opportunity_correspondence_events%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_sha256 !~ '^[0-9a-f]{64}$'
    or p_superseding_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_superseding_entry_sha256 !~ '^[0-9a-f]{64}$'
    or p_superseding_manifest_sha256 = p_manifest_sha256
  then
    raise exception 'invalid_exact_recovery_supersede'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);
  perform 1 from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_inactive' using errcode = '42501';
  end if;
  perform 1 from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for share;
  if not found or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id, p_connection_id, null, 'view'
  ) then
    raise exception 'recovery_supersede_mailbox_denied'
      using errcode = '42501';
  end if;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_thread_id = p_provider_thread_id
    and work.provider_message_id = p_provider_message_id
    and work.manifest_sha256 = p_manifest_sha256
    and work.entry_sha256 = p_entry_sha256
    and work.abandoned_at is null
  for update;
  if not found then
    if exists (
      select 1 from private.email_exact_message_recovery_work work
      where work.company_id = p_company_id
        and work.connection_id = p_connection_id
        and work.provider_thread_id = p_provider_thread_id
        and work.provider_message_id = p_provider_message_id
        and work.manifest_sha256 = p_manifest_sha256
        and work.entry_sha256 = p_entry_sha256
        and work.state = 'abandoned'
        and work.superseded_by_manifest_sha256 =
          p_superseding_manifest_sha256
        and work.superseded_by_entry_sha256 = p_superseding_entry_sha256
    ) then
      return true;
    end if;
    raise exception 'exact_recovery_work_not_found' using errcode = 'P0002';
  end if;

  if v_work.mutation_completed_at is not null
    or v_work.attachment_completed_at is not null
    or v_work.repair_completed_at is not null
    or v_work.draft_projection_completed_at is not null
    or exists (
      select 1
      from private.email_exact_message_recovery_applications application
      where application.company_id = p_company_id
        and application.connection_id = p_connection_id
        and application.provider_message_id = p_provider_message_id
    )
  then
    raise exception 'exact_recovery_started_work_cannot_be_superseded'
      using errcode = '55000';
  end if;

  if v_work.action = 'ingest' then
    if not public.authorize_email_exact_message_ingest_as_system(
      p_actor_user_id, p_company_id, p_connection_id
    ) then
      raise exception 'recovery_ingest_supersede_denied'
        using errcode = '42501';
    end if;
    select activity.* into v_activity
    from public.activities activity
    where activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or (
          activity.email_connection_id is null
          and exists (
            select 1
            from public.opportunity_correspondence_events event
            where event.company_id = p_company_id
              and event.connection_id = p_connection_id
              and event.provider_thread_id = p_provider_thread_id
              and event.provider_message_id = p_provider_message_id
              and event.activity_id = activity.id
              and event.opportunity_id is not distinct from
                activity.opportunity_id
              and event.opportunity_projection_applied is true
              and event.direction = 'inbound'
              and event.party_role = 'customer'
              and event.is_meaningful is true
          )
        )
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
    limit 1
    for share;
    if (v_work.activity_id is null and found)
      or (v_work.activity_id is not null and (
        not found
        or v_activity.id is distinct from v_work.activity_id
        or v_activity.opportunity_id is distinct from v_work.opportunity_id
      ))
    then
      raise exception 'exact_recovery_supersede_ingest_state_changed'
        using errcode = '40001';
    end if;
  else
    if not private.user_can_edit_opportunity(
      p_actor_user_id, v_work.source_opportunity_id
    ) or (
      v_work.target_opportunity_id is not null
      and not private.user_can_edit_opportunity(
        p_actor_user_id, v_work.target_opportunity_id
      )
    ) or (
      v_work.action = 'create_target_and_reparent'
      and not public.authorize_email_exact_message_ingest_as_system(
        p_actor_user_id, p_company_id, p_connection_id
      )
    ) then
      raise exception 'recovery_reparent_supersede_denied'
        using errcode = '42501';
    end if;

    select activity.* into v_activity
    from public.activities activity
    where activity.id = v_work.activity_id
      and activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or activity.email_connection_id is null
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.opportunity_id = v_work.source_opportunity_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    for share;
    select event.* into v_event
    from public.opportunity_correspondence_events event
    where event.id = v_work.correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.activity_id = v_work.activity_id
      and event.opportunity_id = v_work.source_opportunity_id
      and event.opportunity_projection_applied is true
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
    for share;
    if v_activity.id is null or v_event.id is null then
      raise exception 'exact_recovery_supersede_message_moved'
        using errcode = '40001';
    end if;
  end if;

  update private.email_exact_message_recovery_work work
  set state = 'abandoned',
      abandoned_at = clock_timestamp(),
      abandoned_by = p_actor_user_id,
      superseded_by_manifest_sha256 = p_superseding_manifest_sha256,
      superseded_by_entry_sha256 = p_superseding_entry_sha256,
      updated_at = clock_timestamp()
  where work.id = v_work.id
    and work.mutation_completed_at is null
    and work.abandoned_at is null;
  if not found then
    raise exception 'exact_recovery_supersede_race' using errcode = '40001';
  end if;
  return true;
end;
$function$;

revoke all on function public.abandon_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.abandon_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;

create or replace function public.mark_exact_message_recovery_work_step_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_step text,
  p_activity_id uuid,
  p_opportunity_id uuid,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_correspondence_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_work private.email_exact_message_recovery_work%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(p_company_id);
  perform 1 from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_inactive' using errcode = '42501';
  end if;
  perform 1 from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for share;
  if not found or not public.authorize_email_inbox_action_as_system(
    p_actor_user_id, p_connection_id, null, 'view'
  ) then
    raise exception 'recovery_step_mailbox_denied' using errcode = '42501';
  end if;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_thread_id = p_provider_thread_id
    and work.provider_message_id = p_provider_message_id
    and work.actor_user_id = p_actor_user_id
    and work.manifest_sha256 = p_manifest_sha256
    and work.entry_sha256 = p_entry_sha256
    and work.abandoned_at is null
  for update;
  if not found then
    raise exception 'exact_recovery_work_not_found' using errcode = 'P0002';
  end if;
  if v_work.action = 'ingest' then
    if not public.authorize_email_exact_message_ingest_as_system(
      p_actor_user_id, p_company_id, p_connection_id
    ) then
      raise exception 'recovery_ingest_step_denied' using errcode = '42501';
    end if;
  elsif not private.user_can_edit_opportunity(
    p_actor_user_id, v_work.source_opportunity_id
  ) or (
    v_work.target_opportunity_id is not null
    and not private.user_can_edit_opportunity(
      p_actor_user_id, v_work.target_opportunity_id
    )
  ) or (
    v_work.action = 'create_target_and_reparent'
    and not public.authorize_email_exact_message_ingest_as_system(
      p_actor_user_id, p_company_id, p_connection_id
    )
  ) then
    raise exception 'recovery_reparent_step_denied' using errcode = '42501';
  end if;
  if p_step not in ('mutation', 'attachment', 'repair', 'draft_projection')
    or (v_work.activity_id is not null and
      v_work.activity_id is distinct from p_activity_id)
    or (v_work.opportunity_id is not null and
      v_work.opportunity_id is distinct from p_opportunity_id)
    or (v_work.source_opportunity_id is not null and
      v_work.source_opportunity_id is distinct from p_source_opportunity_id)
    or (v_work.target_opportunity_id is not null and
      v_work.target_opportunity_id is distinct from p_target_opportunity_id)
    or (v_work.correspondence_event_id is not null and
      v_work.correspondence_event_id is distinct from p_correspondence_event_id)
  then
    raise exception 'exact_recovery_work_identity_changed'
      using errcode = '40001';
  end if;

  if p_step = 'mutation' then
    if p_activity_id is null
      or (v_work.action = 'ingest' and p_opportunity_id is null)
      or (v_work.action <> 'ingest' and (
        p_source_opportunity_id is null
        or p_target_opportunity_id is null
        or p_correspondence_event_id is null
      ))
    then
      raise exception 'exact_recovery_mutation_identity_incomplete'
        using errcode = '23514';
    end if;
    update private.email_exact_message_recovery_work work
    set activity_id = p_activity_id,
        opportunity_id = p_opportunity_id,
        source_opportunity_id = p_source_opportunity_id,
        target_opportunity_id = p_target_opportunity_id,
        correspondence_event_id = p_correspondence_event_id,
        mutation_completed_at = coalesce(work.mutation_completed_at,
          clock_timestamp()),
        state = case
          when work.action = 'ingest' and work.draft_projection_required
            then 'draft_projection_pending'
          when work.action = 'ingest' then 'complete'
          else 'attachment_scan_pending' end,
        updated_at = clock_timestamp()
    where work.id = v_work.id
      and work.mutation_completed_at is null;
  elsif p_step = 'attachment' then
    if not v_work.attachment_required
      or v_work.mutation_completed_at is null
    then
      raise exception 'exact_recovery_attachment_step_out_of_order'
        using errcode = '23514';
    end if;
    update private.email_exact_message_recovery_work work
    set attachment_completed_at = coalesce(work.attachment_completed_at,
          clock_timestamp()),
        state = 'repair_pending',
        updated_at = clock_timestamp()
    where work.id = v_work.id
      and work.attachment_completed_at is null;
  elsif p_step = 'repair' then
    if not v_work.repair_required
      or v_work.mutation_completed_at is null
      or (v_work.attachment_required and
        v_work.attachment_completed_at is null)
    then
      raise exception 'exact_recovery_repair_step_out_of_order'
        using errcode = '23514';
    end if;
    update private.email_exact_message_recovery_work work
    set repair_completed_at = coalesce(work.repair_completed_at,
          clock_timestamp()),
        state = case when work.draft_projection_required
          then 'draft_projection_pending' else 'complete' end,
        updated_at = clock_timestamp()
    where work.id = v_work.id
      and work.repair_completed_at is null;
  else
    if not v_work.draft_projection_required
      or v_work.mutation_completed_at is null
      or (v_work.repair_required and v_work.repair_completed_at is null)
    then
      raise exception 'exact_recovery_draft_step_out_of_order'
        using errcode = '23514';
    end if;
    update private.email_exact_message_recovery_work work
    set draft_projection_completed_at = coalesce(
          work.draft_projection_completed_at, clock_timestamp()),
        state = 'complete',
        updated_at = clock_timestamp()
    where work.id = v_work.id
      and work.draft_projection_completed_at is null;
  end if;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.id = v_work.id
    and work.abandoned_at is null;
  return private.exact_message_recovery_work_json(v_work);
end;
$function$;

revoke all on function public.mark_exact_message_recovery_work_step_as_system(
  uuid, uuid, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mark_exact_message_recovery_work_step_as_system(
  uuid, uuid, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid
) to service_role;

-- Move one already-projected event between the two existing opportunity
-- projections. Counts use an exact delta because legacy counters can predate
-- the correspondence ledger. High-water timestamps are recomputed from the
-- durable event/activity rows after the move.
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
    coalesce(opportunity.outbound_count, 0)
  into
    v_correspondence_count,
    v_inbound_count,
    v_outbound_count
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

  -- updated_at is intentionally unchanged. A single approved manifest can
  -- contain several exact messages with the same source snapshot; projection-
  -- only changes from its earlier entries must not invalidate later entries.
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
end;
$function$;

revoke all on function private.recompute_exact_message_opportunity_projection(
  uuid, uuid, text, integer
) from public, anon, authenticated, service_role;

-- A moved meaningful event may already have reset lifecycle counters and
-- superseded drafts on the wrong opportunity. Those values cannot be inferred
-- from the current high-water row alone. Recovery therefore proceeds only for
-- lifecycle-passive leads with no durable lifecycle action history. Anything
-- else requires a separately reviewed, evidence-complete reconciliation.
create or replace function private.assert_exact_message_lifecycle_recomputable(
  p_company_id uuid,
  p_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform 1
  from public.opportunity_lifecycle_state state
  where state.company_id = p_company_id
    and state.opportunity_id = p_opportunity_id
  for update;

  if exists (
    select 1
    from public.opportunity_lifecycle_state state
    where state.company_id = p_company_id
      and state.opportunity_id = p_opportunity_id
      and (
        state.unanswered_follow_up_count <> 0
        or state.second_follow_up_sent_at is not null
        or state.operator_follow_up_miss_at is not null
        or state.stale_status is not null
        or state.stale_status_at is not null
        or state.protected_until is not null
      )
  ) or exists (
    select 1
    from public.opportunity_follow_up_drafts draft
    where draft.company_id = p_company_id
      and draft.opportunity_id = p_opportunity_id
  ) or exists (
    select 1
    from public.opportunity_lifecycle_action_audit action
    where action.company_id = p_company_id
      and action.opportunity_id = p_opportunity_id
      and action.status = 'applied'
  ) or exists (
    select 1
    from public.notifications notification
    where notification.company_id = p_company_id
      and notification.type = 'leads_waiting'
      and notification.dedupe_key =
        'lead_lifecycle:operator_follow_up_miss:' || p_opportunity_id::text
  ) then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_exact_message_lifecycle_recomputable(
  uuid, uuid
) from public, anon, authenticated, service_role;

-- The fail-closed guard above proves all action-derived fields are passive.
-- Only then is it safe to rebuild the durable meaningful-event high-water.
create or replace function private.recompute_exact_message_lifecycle_projection(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_moved_event_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_latest_event_id uuid;
  v_latest_at timestamptz;
  v_latest_direction text;
  v_state public.opportunity_lifecycle_state%rowtype;
begin
  select state.*
  into v_state
  from public.opportunity_lifecycle_state state
  where state.opportunity_id = p_opportunity_id
    and state.company_id = p_company_id
  for update;

  select event.id, event.occurred_at, event.direction
  into v_latest_event_id, v_latest_at, v_latest_direction
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.is_meaningful is true
    and event.opportunity_projection_applied is true
  order by event.occurred_at desc, event.id desc
  limit 1;

  if v_state.opportunity_id is null and v_latest_event_id is not null then
    insert into public.opportunity_lifecycle_state (
      opportunity_id,
      company_id,
      last_meaningful_event_id,
      last_meaningful_at,
      last_meaningful_direction,
      updated_at
    ) values (
      p_opportunity_id,
      p_company_id,
      v_latest_event_id,
      v_latest_at,
      v_latest_direction,
      clock_timestamp()
    );
  elsif v_state.opportunity_id is not null then
    update public.opportunity_lifecycle_state state
    set last_meaningful_event_id = v_latest_event_id,
        last_meaningful_at = v_latest_at,
        last_meaningful_direction = v_latest_direction,
        updated_at = clock_timestamp()
    where state.opportunity_id = p_opportunity_id
      and state.company_id = p_company_id;
  end if;
end;
$function$;

revoke all on function private.recompute_exact_message_lifecycle_projection(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function private.exact_message_recovery_attachment_state(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_activity_id uuid,
  p_target_opportunity_id uuid,
  p_expected_scan_generation bigint
) returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scan_generation bigint;
  v_scan_status text;
begin
  perform 1
  from public.email_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by attachment.id
  for update;

  if exists (
    select 1
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and attachment.attribution_status = 'needs_review'
  ) then
    raise exception 'exact_recovery_attachment_needs_review'
      using errcode = '55000';
  end if;

  select scan.status, scan.generation
  into v_scan_status, v_scan_generation
  from public.email_attachment_scans scan
  where scan.company_id = p_company_id
    and scan.connection_id = p_connection_id
    and scan.provider_thread_id = p_provider_thread_id
    and scan.message_id = p_provider_message_id
    and scan.activity_id = p_activity_id
  for update;
  if not found then
    raise exception 'exact_recovery_attachment_scan_missing'
      using errcode = '55000';
  end if;
  if v_scan_generation is distinct from p_expected_scan_generation then
    raise exception 'exact_recovery_attachment_scan_generation_changed'
      using errcode = '40001';
  end if;
  if v_scan_status in ('failed', 'paused') then
    raise exception 'exact_recovery_attachment_scan_failed'
      using errcode = '55000';
  end if;
  if v_scan_status <> 'complete' or exists (
    select 1
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and (
        attachment.attribution_status = 'pending'
        or attachment.opportunity_id is distinct from p_target_opportunity_id
      )
  ) then
    return 'pending';
  end if;

  perform 1
  from public.email_attachment_inspection_jobs inspection_job
  join public.email_attachments attachment
    on attachment.id = inspection_job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by inspection_job.id
  for update of inspection_job;

  if exists (
    select 1
    from public.email_attachments attachment
    left join public.email_attachment_inspection_jobs inspection_job
      on inspection_job.email_attachment_id = attachment.id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and attachment.ingest_status = 'stored'
      and inspection_job.id is null
  ) then
    return 'pending';
  end if;
  if exists (
    select 1
    from public.email_attachment_inspection_jobs inspection_job
    join public.email_attachments attachment
      on attachment.id = inspection_job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and inspection_job.status = 'failed'
  ) then
    raise exception 'exact_recovery_attachment_inspection_failed'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_attachment_inspection_jobs inspection_job
    join public.email_attachments attachment
      on attachment.id = inspection_job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and inspection_job.status not in ('complete', 'skipped')
  ) then
    return 'pending';
  end if;

  perform 1
  from public.email_conversion_photo_jobs job
  join public.email_attachments attachment
    on attachment.id = job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_activity_id
  order by job.id
  for update of job;

  if exists (
    select 1
    from public.email_conversion_photo_jobs job
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.status = 'failed'
  ) then
    raise exception 'exact_recovery_attachment_materialization_failed'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_conversion_photo_jobs job
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.status in ('pending', 'processing', 'retrying')
  ) or exists (
    select 1
    from public.email_conversion_photo_objects object_row
    join public.email_conversion_photo_jobs job on job.id = object_row.job_id
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_activity_id
      and job.operation = 'revoke'
      and object_row.state <> 'deleted'
  ) then
    return 'pending';
  end if;

  return 'complete';
end;
$function$;

revoke all on function private.exact_message_recovery_attachment_state(
  uuid, uuid, text, text, uuid, uuid, bigint
) from public, anon, authenticated, service_role;

create or replace function public.reparent_opportunity_email_message_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_expected_activity_id uuid,
  p_expected_correspondence_event_id uuid,
  p_target_email text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_expected_source_updated_at timestamptz,
  p_expected_target_updated_at timestamptz,
  p_expected_source_stage text,
  p_expected_target_stage text,
  p_expected_source_stage_manually_set boolean,
  p_expected_target_stage_manually_set boolean,
  p_expected_source_assigned_to uuid,
  p_expected_target_assigned_to uuid,
  p_expected_source_assignment_version bigint,
  p_expected_target_assignment_version bigint,
  p_expected_source_project_id uuid,
  p_expected_target_project_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing private.email_exact_message_recovery_applications%rowtype;
  locked_connection public.email_connections%rowtype;
  source_opportunity public.opportunities%rowtype;
  target_opportunity public.opportunities%rowtype;
  locked_opportunity public.opportunities%rowtype;
  locked_activity public.activities%rowtype;
  locked_event public.opportunity_correspondence_events%rowtype;
  actual_source public.opportunities%rowtype;
  actual_target public.opportunities%rowtype;
  target_client_id uuid;
  attachment_state text;
  v_attachment_count integer := 0;
  v_attachment_ids uuid[] := '{}'::uuid[];
  v_prior_scan_generation bigint := 0;
  v_attachment_scan_generation bigint;
  moved_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_company_id is null
    or p_connection_id is null
    or p_source_opportunity_id is null
    or p_target_opportunity_id is null
    or p_expected_activity_id is null
    or p_expected_correspondence_event_id is null
    or p_source_opportunity_id = p_target_opportunity_id
    or nullif(btrim(p_provider_thread_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or nullif(btrim(p_target_email), '') is null
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_exact_message_recovery_request'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  select connection.*
  into locked_connection
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for update;
  if not found then
    raise exception 'recovery_connection_not_found'
      using errcode = 'P0002';
  end if;
  if not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    null,
    'view'
  ) then
    raise exception 'recovery_actor_cannot_view_mailbox'
      using errcode = '42501';
  end if;

  for locked_opportunity in
    select opportunity.*
    from public.opportunities opportunity
    where opportunity.company_id = p_company_id
      and opportunity.id = any(
        array[p_source_opportunity_id, p_target_opportunity_id]
      )
      and opportunity.deleted_at is null
    order by opportunity.id
    for update
  loop
    if locked_opportunity.id = p_source_opportunity_id then
      source_opportunity := locked_opportunity;
    elsif locked_opportunity.id = p_target_opportunity_id then
      target_opportunity := locked_opportunity;
    end if;
  end loop;
  if source_opportunity.id is null or target_opportunity.id is null then
    raise exception 'recovery_opportunity_not_found'
      using errcode = 'P0002';
  end if;

  -- Hold the actor identity stable through every permission proof and write.
  -- Without this row lock, deactivation/deletion could commit after the
  -- authorization read while this SECURITY DEFINER transaction continued.
  perform 1
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_not_active'
      using errcode = '42501';
  end if;
  if not private.user_can_edit_opportunity(
    p_actor_user_id,
    p_source_opportunity_id
  ) or not private.user_can_edit_opportunity(
    p_actor_user_id,
    p_target_opportunity_id
  ) then
    raise exception 'recovery_actor_cannot_edit_both_opportunities'
      using errcode = '42501';
  end if;

  select application.*
  into existing
  from private.email_exact_message_recovery_applications application
  where application.company_id = p_company_id
    and application.connection_id = p_connection_id
    and application.provider_message_id = p_provider_message_id
  for update;
  if found then
    if existing.entry_sha256 is distinct from p_entry_sha256
      or existing.manifest_sha256 is distinct from p_manifest_sha256
      or existing.provider_thread_id is distinct from p_provider_thread_id
      or existing.source_opportunity_id is distinct from
        p_source_opportunity_id
      or existing.target_opportunity_id is distinct from
        p_target_opportunity_id
      or existing.activity_id is distinct from p_expected_activity_id
      or existing.correspondence_event_id is distinct from
        p_expected_correspondence_event_id
      or lower(btrim(existing.target_email)) is distinct from
        lower(btrim(p_target_email))
      or existing.actor_user_id is distinct from p_actor_user_id
    then
      raise exception 'recovery_manifest_conflict'
        using errcode = '23505';
    end if;

    select activity.*
    into locked_activity
    from public.activities activity
    where activity.id = existing.activity_id
      and activity.company_id = p_company_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.opportunity_id = p_target_opportunity_id
      and activity.type = 'email'
    for update;
    if not found then
      raise exception 'exact_recovery_applied_activity_changed'
        using errcode = '40001';
    end if;

    select event.*
    into locked_event
    from public.opportunity_correspondence_events event
    where event.id = existing.correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.opportunity_id = p_target_opportunity_id
      and event.activity_id = existing.activity_id
      and event.opportunity_projection_applied is true
    for update;
    if not found or locked_activity.direction is distinct from
      locked_event.direction
    then
      raise exception 'exact_recovery_applied_event_changed'
        using errcode = '40001';
    end if;

    attachment_state := private.exact_message_recovery_attachment_state(
      p_company_id,
      p_connection_id,
      p_provider_thread_id,
      p_provider_message_id,
      p_expected_activity_id,
      p_target_opportunity_id,
      existing.attachment_scan_generation
    );

    if existing.status = 'complete' then
      if attachment_state <> 'complete' then
        raise exception 'exact_recovery_completed_attachment_state_changed'
          using errcode = '40001';
      end if;
      select
        count(*)::integer,
        coalesce(
          array_agg(attachment.id order by attachment.id),
          '{}'::uuid[]
        )
      into v_attachment_count, v_attachment_ids
      from public.email_attachments attachment
      where attachment.company_id = p_company_id
        and attachment.connection_id = p_connection_id
        and attachment.provider_thread_id = p_provider_thread_id
        and attachment.message_id = p_provider_message_id
        and attachment.activity_id = p_expected_activity_id;
      if existing.attachment_count is distinct from v_attachment_count
        or existing.attachment_ids is distinct from v_attachment_ids
      then
        raise exception 'exact_recovery_completed_attachment_set_changed'
          using errcode = '40001';
      end if;
      return pg_catalog.jsonb_build_object(
        'applied', false,
        'already_applied', true,
        'pending_attachment_attribution', false,
        'activity_id', existing.activity_id,
        'correspondence_event_id', existing.correspondence_event_id,
        'source_opportunity_id', existing.source_opportunity_id,
        'target_opportunity_id', existing.target_opportunity_id
      );
    end if;

    if attachment_state = 'pending' then
      return pg_catalog.jsonb_build_object(
        'applied', false,
        'already_applied', false,
        'pending_attachment_attribution', true,
        'activity_id', existing.activity_id,
        'correspondence_event_id', existing.correspondence_event_id,
        'source_opportunity_id', existing.source_opportunity_id,
        'target_opportunity_id', existing.target_opportunity_id
      );
    end if;
    if attachment_state <> 'complete' then
      raise exception 'exact_recovery_attachment_state_invalid'
        using errcode = '55000';
    end if;

    select
      count(*)::integer,
      coalesce(
        array_agg(attachment.id order by attachment.id),
        '{}'::uuid[]
      )
    into v_attachment_count, v_attachment_ids
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_expected_activity_id;

    update private.email_exact_message_recovery_applications application
    set status = 'complete',
        attachment_count = v_attachment_count,
        attachment_ids = v_attachment_ids,
        finalized_at = clock_timestamp()
    where application.company_id = p_company_id
      and application.connection_id = p_connection_id
      and application.provider_message_id = p_provider_message_id
      and application.status = 'attachment_pending';
    get diagnostics moved_rows = row_count;
    if moved_rows <> 1 then
      raise exception 'exact_recovery_finalize_race'
        using errcode = '40001';
    end if;

    return pg_catalog.jsonb_build_object(
      'applied', true,
      'already_applied', false,
      'pending_attachment_attribution', false,
      'activity_id', existing.activity_id,
      'correspondence_event_id', existing.correspondence_event_id,
      'source_opportunity_id', existing.source_opportunity_id,
      'target_opportunity_id', existing.target_opportunity_id
    );
  end if;

  if source_opportunity.updated_at is distinct from p_expected_source_updated_at
    or source_opportunity.stage is distinct from p_expected_source_stage
    or source_opportunity.stage_manually_set is distinct from
      p_expected_source_stage_manually_set
    or source_opportunity.assigned_to is distinct from
      p_expected_source_assigned_to
    or source_opportunity.assignment_version is distinct from
      p_expected_source_assignment_version
    or source_opportunity.project_id is distinct from
      p_expected_source_project_id
    or source_opportunity.project_ref is distinct from
      p_expected_source_project_id
  then
    raise exception 'source_opportunity_snapshot_changed'
      using errcode = '40001';
  end if;
  if target_opportunity.updated_at is distinct from p_expected_target_updated_at
    or target_opportunity.stage is distinct from p_expected_target_stage
    or target_opportunity.stage_manually_set is distinct from
      p_expected_target_stage_manually_set
    or target_opportunity.assigned_to is distinct from
      p_expected_target_assigned_to
    or target_opportunity.assignment_version is distinct from
      p_expected_target_assignment_version
    or target_opportunity.project_id is distinct from
      p_expected_target_project_id
    or target_opportunity.project_ref is distinct from
      p_expected_target_project_id
  then
    raise exception 'target_opportunity_snapshot_changed'
      using errcode = '40001';
  end if;

  -- Lock the immutable correspondence event first. It is the authoritative
  -- mailbox proof for a pre-identity activity whose email_connection_id is
  -- still NULL; an opaque provider id or shared thread is never enough.
  select event.*
  into locked_event
  from public.opportunity_correspondence_events event
  where event.id = p_expected_correspondence_event_id
    and event.company_id = p_company_id
    and event.connection_id = p_connection_id
    and event.provider_thread_id = p_provider_thread_id
    and event.provider_message_id = p_provider_message_id
    and event.opportunity_id = p_source_opportunity_id
    and event.activity_id = p_expected_activity_id
  for update;
  if not found then
    raise exception 'exact_recovery_correspondence_event_not_found'
      using errcode = 'P0002';
  end if;

  select activity.*
  into locked_activity
  from public.activities activity
  where activity.id = p_expected_activity_id
    and activity.company_id = p_company_id
    and (
      activity.email_connection_id = p_connection_id
      or activity.email_connection_id is null
    )
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
    and activity.opportunity_id = p_source_opportunity_id
    and activity.type = 'email'
  for update;
  if not found then
    raise exception 'exact_recovery_activity_not_found'
      using errcode = 'P0002';
  end if;

  if locked_activity.email_connection_id is null then
    update public.activities activity
    set email_connection_id = p_connection_id
    where activity.id = p_expected_activity_id
      and activity.company_id = p_company_id
      and activity.email_connection_id is null
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.opportunity_id = p_source_opportunity_id
      and activity.type = 'email';
    get diagnostics moved_rows = row_count;
    if moved_rows <> 1 then
      raise exception 'exact_recovery_legacy_connection_claim_race'
        using errcode = '40001';
    end if;

    -- Identity/quarantine triggers execute during the claim. Re-read the exact
    -- row so any concurrent or policy-driven identity rewrite fails the whole
    -- transaction before ownership or projection moves.
    select activity.*
    into locked_activity
    from public.activities activity
    where activity.id = p_expected_activity_id
      and activity.company_id = p_company_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.opportunity_id = p_source_opportunity_id
      and activity.type = 'email'
    for update;
    if not found then
      raise exception 'exact_recovery_legacy_connection_claim_race'
        using errcode = '40001';
    end if;
  end if;

  if not locked_event.opportunity_projection_applied then
    raise exception 'exact_recovery_projection_pending'
      using errcode = '55000';
  end if;
  if locked_activity.direction is distinct from locked_event.direction
    or locked_event.direction not in ('inbound', 'outbound')
  then
    raise exception 'exact_recovery_direction_mismatch'
      using errcode = '23514';
  end if;
  if locked_event.is_meaningful then
    perform private.assert_exact_message_lifecycle_recomputable(
      p_company_id,
      p_source_opportunity_id
    );
    perform private.assert_exact_message_lifecycle_recomputable(
      p_company_id,
      p_target_opportunity_id
    );
  end if;

  if lower(btrim(coalesce(locked_activity.from_email, ''))) is distinct from
      lower(btrim(p_target_email))
    and not exists (
      select 1
      from unnest(
        coalesce(locked_activity.to_emails, '{}'::text[])
        || coalesce(locked_activity.cc_emails, '{}'::text[])
      ) participant(email)
      where lower(btrim(participant.email)) = lower(btrim(p_target_email))
    )
  then
    raise exception 'target_email_mismatch: activity participant'
      using errcode = '23514';
  end if;

  target_client_id := private.resolve_opportunity_client_id(
    target_opportunity.client_ref,
    target_opportunity.client_id
  );
  if target_client_id is not null then
    perform 1
    from public.clients owning_client
    where owning_client.id = target_client_id
      and owning_client.company_id = p_company_id
      and owning_client.deleted_at is null
    for share;
    perform 1
    from public.sub_clients alternate_contact
    where alternate_contact.client_id = target_client_id
      and alternate_contact.company_id = p_company_id
      and alternate_contact.deleted_at is null
    order by alternate_contact.id
    for share;
  end if;

  if not private.opportunity_sender_is_persisted_customer(
    p_company_id,
    p_target_opportunity_id,
    p_target_email
  ) or not exists (
    select 1
    from public.opportunities opportunity
    left join public.clients owning_client
      on owning_client.id = private.resolve_opportunity_client_id(
        opportunity.client_ref,
        opportunity.client_id
      )
     and owning_client.company_id = opportunity.company_id
     and owning_client.deleted_at is null
    where opportunity.id = p_target_opportunity_id
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and (
        lower(btrim(coalesce(opportunity.contact_email, ''))) =
          lower(btrim(p_target_email))
        or lower(btrim(coalesce(owning_client.email, ''))) =
          lower(btrim(p_target_email))
        or exists (
          select 1
          from public.sub_clients alternate_contact
          where alternate_contact.client_id = owning_client.id
            and alternate_contact.company_id = p_company_id
            and alternate_contact.deleted_at is null
            and lower(btrim(coalesce(alternate_contact.email, ''))) =
              lower(btrim(p_target_email))
        )
      )
  ) then
    raise exception 'target_email_mismatch: persisted customer identity'
      using errcode = '23514';
  end if;

  -- Moving a source that already drove a draft or approved transport would
  -- split that durable action from its evidence. Those cases require a wider,
  -- separately reviewed reconciliation and fail closed here.
  if exists (
    select 1
    from public.opportunity_follow_up_drafts draft
    where draft.company_id = p_company_id
      and draft.source_event_id = p_expected_correspondence_event_id
  ) or exists (
    select 1
    from public.approved_action_email_intents intent
    where intent.company_id = p_company_id
      and intent.source_activity_id = p_expected_activity_id
  ) or exists (
    select 1
    from public.email_assignment_contact_form_draft_queue queue
    where queue.company_id = p_company_id
      and queue.source_activity_id = p_expected_activity_id
  ) then
    raise exception 'exact_recovery_has_dependent_email_action'
      using errcode = '55000';
  end if;

  -- Match the existing trigger's lock/mutation order. The activity move makes
  -- every exact attachment temporarily unattributed, queues a new exact scan,
  -- and revokes any project-photo materialization tied to the old lead.
  select count(*)::integer
  into v_attachment_count
  from public.email_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_expected_activity_id;

  if exists (
    select 1
    from public.email_attachments attachment
    where attachment.activity_id = p_expected_activity_id
      and (
        attachment.company_id is distinct from p_company_id
        or attachment.connection_id is distinct from p_connection_id
        or attachment.provider_thread_id is distinct from p_provider_thread_id
        or attachment.message_id is distinct from p_provider_message_id
      )
  ) then
    raise exception 'exact_recovery_attachment_identity_mismatch'
      using errcode = '23514';
  end if;

  perform 1
  from public.email_attachments attachment
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_expected_activity_id
  order by attachment.id
  for update;

  perform 1
  from public.email_conversion_photo_jobs job
  join public.email_attachments attachment
    on attachment.id = job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_expected_activity_id
  order by job.id
  for update of job;

  perform 1
  from public.project_photos photo
  join public.email_conversion_photo_jobs job
    on job.project_photo_id = photo.id
  join public.email_attachments attachment
    on attachment.id = job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_expected_activity_id
  order by photo.id
  for update of photo;

  perform 1
  from public.email_conversion_photo_objects object_row
  join public.email_conversion_photo_jobs job on job.id = object_row.job_id
  join public.email_attachments attachment
    on attachment.id = job.email_attachment_id
  where attachment.company_id = p_company_id
    and attachment.connection_id = p_connection_id
    and attachment.provider_thread_id = p_provider_thread_id
    and attachment.message_id = p_provider_message_id
    and attachment.activity_id = p_expected_activity_id
  order by object_row.id
  for update of object_row;

  select scan.generation
  into v_prior_scan_generation
  from public.email_attachment_scans scan
  where scan.company_id = p_company_id
    and scan.connection_id = p_connection_id
    and scan.provider_thread_id = p_provider_thread_id
    and scan.message_id = p_provider_message_id
    and scan.activity_id = p_expected_activity_id
  for update;
  if not found then
    v_prior_scan_generation := 0;
  end if;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  ) values
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'activities',
      p_expected_activity_id,
      p_source_opportunity_id,
      p_target_opportunity_id
    ),
    (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'opportunity_correspondence_events',
      p_expected_correspondence_event_id,
      p_source_opportunity_id,
      p_target_opportunity_id
    )
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set
    old_opportunity_id = excluded.old_opportunity_id,
    new_opportunity_id = excluded.new_opportunity_id;

  update public.opportunity_correspondence_events event
  set opportunity_id = p_target_opportunity_id
  where event.id = p_expected_correspondence_event_id
    and event.company_id = p_company_id
    and event.connection_id = p_connection_id
    and event.provider_thread_id = p_provider_thread_id
    and event.provider_message_id = p_provider_message_id
    and event.opportunity_id = p_source_opportunity_id
    and event.activity_id = p_expected_activity_id;
  get diagnostics moved_rows = row_count;
  if moved_rows <> 1 then
    raise exception 'exact_recovery_event_move_race'
      using errcode = '40001';
  end if;

  update public.activities activity
  set opportunity_id = p_target_opportunity_id
  where activity.id = p_expected_activity_id
    and activity.company_id = p_company_id
    and activity.email_connection_id = p_connection_id
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
    and activity.opportunity_id = p_source_opportunity_id
    and activity.type = 'email';
  get diagnostics moved_rows = row_count;
  if moved_rows <> 1 then
    raise exception 'exact_recovery_activity_move_race'
      using errcode = '40001';
  end if;

  select scan.generation
  into v_attachment_scan_generation
  from public.email_attachment_scans scan
  where scan.company_id = p_company_id
    and scan.connection_id = p_connection_id
    and scan.provider_thread_id = p_provider_thread_id
    and scan.message_id = p_provider_message_id
    and scan.activity_id = p_expected_activity_id
    and scan.status = 'pending'
    and scan.lease_owner is null
    and scan.lease_expires_at is null
  for update;
  if not found
    or v_attachment_scan_generation is distinct from
      v_prior_scan_generation + 1
  then
    raise exception 'exact_recovery_attachment_scan_not_queued'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_expected_activity_id
      and (
        attachment.opportunity_id is not null
        or attachment.attribution_status <> 'pending'
      )
  ) then
    raise exception 'exact_recovery_attachment_requeue_failed'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_conversion_photo_jobs job
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_expected_activity_id
      and (
        job.operation <> 'revoke'
        or job.status not in (
          'pending', 'processing', 'retrying', 'revoked'
        )
      )
  ) then
    raise exception 'exact_recovery_attachment_materialization_not_revoked'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.email_conversion_photo_objects object_row
    join public.email_conversion_photo_jobs job on job.id = object_row.job_id
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_expected_activity_id
      and object_row.state not in (
        'delete_pending', 'deleting', 'deleted'
      )
  ) then
    raise exception 'exact_recovery_attachment_object_not_revoked'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.project_photos photo
    join public.email_conversion_photo_jobs job
      on job.project_photo_id = photo.id
    join public.email_attachments attachment
      on attachment.id = job.email_attachment_id
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.provider_thread_id = p_provider_thread_id
      and attachment.message_id = p_provider_message_id
      and attachment.activity_id = p_expected_activity_id
      and photo.deleted_at is null
  ) then
    raise exception 'exact_recovery_attachment_photo_not_hidden'
      using errcode = '55000';
  end if;

  perform private.recompute_exact_message_opportunity_projection(
    p_company_id,
    p_source_opportunity_id,
    locked_event.direction,
    -1
  );
  perform private.recompute_exact_message_opportunity_projection(
    p_company_id,
    p_target_opportunity_id,
    locked_event.direction,
    1
  );
  select opportunity.*
  into actual_source
  from public.opportunities opportunity
  where opportunity.id = p_source_opportunity_id
    and opportunity.company_id = p_company_id;
  select opportunity.*
  into actual_target
  from public.opportunities opportunity
  where opportunity.id = p_target_opportunity_id
    and opportunity.company_id = p_company_id;

  if actual_source.stage is distinct from source_opportunity.stage
    or actual_source.stage_manually_set is distinct from
      source_opportunity.stage_manually_set
    or actual_source.assigned_to is distinct from source_opportunity.assigned_to
    or actual_source.assignment_version is distinct from
      source_opportunity.assignment_version
    or actual_source.project_id is distinct from source_opportunity.project_id
    or actual_source.project_ref is distinct from source_opportunity.project_ref
    or actual_source.updated_at is distinct from source_opportunity.updated_at
    or actual_target.stage is distinct from target_opportunity.stage
    or actual_target.stage_manually_set is distinct from
      target_opportunity.stage_manually_set
    or actual_target.assigned_to is distinct from target_opportunity.assigned_to
    or actual_target.assignment_version is distinct from
      target_opportunity.assignment_version
    or actual_target.project_id is distinct from target_opportunity.project_id
    or actual_target.project_ref is distinct from target_opportunity.project_ref
    or actual_target.updated_at is distinct from target_opportunity.updated_at
  then
    raise exception 'protected opportunity fields changed'
      using errcode = '23514';
  end if;

  -- Lifecycle high-water must move in this transaction even when attachment
  -- attribution continues asynchronously. Otherwise cron can act on the wrong
  -- lead during attachment_pending, and a later lifecycle action can make the
  -- approved recovery impossible to finalize.
  perform private.recompute_exact_message_lifecycle_projection(
    p_company_id,
    p_source_opportunity_id,
    p_expected_correspondence_event_id
  );
  perform private.recompute_exact_message_lifecycle_projection(
    p_company_id,
    p_target_opportunity_id,
    p_expected_correspondence_event_id
  );

  insert into private.email_exact_message_recovery_applications (
    company_id,
    connection_id,
    provider_message_id,
    provider_thread_id,
    source_opportunity_id,
    target_opportunity_id,
    activity_id,
    correspondence_event_id,
    target_email,
    actor_user_id,
    manifest_sha256,
    entry_sha256,
    status,
    attachment_count,
    attachment_scan_generation,
    attachment_ids,
    finalized_at
  ) values (
    p_company_id,
    p_connection_id,
    p_provider_message_id,
    p_provider_thread_id,
    p_source_opportunity_id,
    p_target_opportunity_id,
    p_expected_activity_id,
    p_expected_correspondence_event_id,
    lower(btrim(p_target_email)),
    p_actor_user_id,
    p_manifest_sha256,
    p_entry_sha256,
    'attachment_pending',
    0,
    v_attachment_scan_generation,
    '{}'::uuid[],
    null
  )
  on conflict (company_id, connection_id, provider_message_id) do nothing;
  get diagnostics moved_rows = row_count;
  if moved_rows <> 1 then
    raise exception 'recovery_manifest_conflict'
      using errcode = '23505';
  end if;

  delete from private.opportunity_child_reparent_tokens token
  where token.transaction_id = pg_catalog.txid_current()
    and token.backend_pid = pg_catalog.pg_backend_pid()
    and token.table_name in ('activities', 'opportunity_correspondence_events')
    and token.row_id in (
      p_expected_activity_id,
      p_expected_correspondence_event_id
    );

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'already_applied', false,
    'pending_attachment_attribution', true,
    'activity_id', p_expected_activity_id,
    'correspondence_event_id', p_expected_correspondence_event_id,
    'source_opportunity_id', p_source_opportunity_id,
    'target_opportunity_id', p_target_opportunity_id
  );
exception when others then
  delete from private.opportunity_child_reparent_tokens token
  where token.transaction_id = pg_catalog.txid_current()
    and token.backend_pid = pg_catalog.pg_backend_pid()
    and token.table_name in ('activities', 'opportunity_correspondence_events')
    and token.row_id in (
      p_expected_activity_id,
      p_expected_correspondence_event_id
    );
  raise;
end;
$function$;

revoke all on function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) to service_role;

-- Some exact wrong-parent messages have no safe target opportunity yet. This
-- wrapper proves the already-persisted effective customer inbound, creates (or
-- converges on) the canonical message-scoped lead without touching assignment,
-- then invokes the guarded reparent function inside this same transaction.
create or replace function public.create_target_and_reparent_opportunity_email_message_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_source_opportunity_id uuid,
  p_expected_activity_id uuid,
  p_expected_correspondence_event_id uuid,
  p_target_email text,
  p_target_source_thread_key text,
  p_target_title text,
  p_target_contact_name text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_expected_source_updated_at timestamptz,
  p_expected_source_stage text,
  p_expected_source_stage_manually_set boolean,
  p_expected_source_assigned_to uuid,
  p_expected_source_assignment_version bigint,
  p_expected_source_project_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing private.email_exact_message_recovery_applications%rowtype;
  locked_connection public.email_connections%rowtype;
  source_opportunity public.opportunities%rowtype;
  target_opportunity public.opportunities%rowtype;
  locked_activity public.activities%rowtype;
  locked_event public.opportunity_correspondence_events%rowtype;
  v_expected_source_thread_key text;
  v_target_resolution text;
  v_connection_owner_id uuid;
  v_assignment_result jsonb;
  v_result jsonb;
  v_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_company_id is null
    or p_connection_id is null
    or p_source_opportunity_id is null
    or p_expected_activity_id is null
    or p_expected_correspondence_event_id is null
    or nullif(btrim(p_provider_thread_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or nullif(btrim(p_target_email), '') is null
    or p_target_email is distinct from lower(btrim(p_target_email))
    or nullif(btrim(p_target_source_thread_key), '') is null
    or p_target_source_thread_key is distinct from btrim(p_target_source_thread_key)
    or nullif(btrim(p_target_title), '') is null
    or p_target_title is distinct from btrim(p_target_title)
    or length(p_target_title) > 500
    or (
      p_target_contact_name is not null
      and (
        nullif(btrim(p_target_contact_name), '') is null
        or p_target_contact_name is distinct from btrim(p_target_contact_name)
        or length(p_target_contact_name) > 200
      )
    )
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_exact_message_target_creation_request'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  select connection.*
  into locked_connection
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for update;
  if not found then
    raise exception 'recovery_connection_not_found' using errcode = 'P0002';
  end if;
  if not public.authorize_email_inbox_action_as_system(
    p_actor_user_id,
    p_connection_id,
    null,
    'view'
  ) then
    raise exception 'recovery_actor_cannot_view_mailbox'
      using errcode = '42501';
  end if;
  perform 1
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_not_active' using errcode = '42501';
  end if;
  if not private.user_can_create_opportunity(
    p_actor_user_id,
    p_company_id
  ) then
    raise exception 'recovery_actor_cannot_create_opportunity'
      using errcode = '42501';
  end if;
  if not private.user_can_edit_opportunity(
    p_actor_user_id,
    p_source_opportunity_id
  ) then
    raise exception 'recovery_actor_cannot_edit_source_opportunity'
      using errcode = '42501';
  end if;
  if private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'pipeline.edit'
  ) is distinct from 'all' then
    raise exception 'recovery_actor_cannot_edit_created_opportunity'
      using errcode = '42501';
  end if;

  select opportunity.*
  into source_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_source_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;
  if not found then
    raise exception 'recovery_source_opportunity_not_found'
      using errcode = 'P0002';
  end if;

  v_expected_source_thread_key := pg_catalog.format(
    'email:%s:%s:message:%s',
    lower(locked_connection.provider),
    p_connection_id,
    p_provider_message_id
  );
  if p_target_source_thread_key is distinct from v_expected_source_thread_key
  then
    raise exception 'exact_recovery_target_source_key_mismatch'
      using errcode = '23514';
  end if;

  select application.*
  into existing
  from private.email_exact_message_recovery_applications application
  where application.company_id = p_company_id
    and application.connection_id = p_connection_id
    and application.provider_message_id = p_provider_message_id
  for update;

  if found then
    if existing.entry_sha256 is distinct from p_entry_sha256
      or existing.manifest_sha256 is distinct from p_manifest_sha256
      or existing.provider_thread_id is distinct from p_provider_thread_id
      or existing.source_opportunity_id is distinct from p_source_opportunity_id
      or existing.activity_id is distinct from p_expected_activity_id
      or existing.correspondence_event_id is distinct from
        p_expected_correspondence_event_id
      or existing.actor_user_id is distinct from p_actor_user_id
      or existing.target_email is distinct from p_target_email
      or existing.target_resolution is null
      or existing.target_resolution not in ('created', 'existing')
      or existing.target_source_thread_key is distinct from
        p_target_source_thread_key
      or existing.target_initial_title is distinct from p_target_title
      or existing.target_initial_contact_name is distinct from
        p_target_contact_name
    then
      raise exception 'recovery_manifest_conflict' using errcode = '23505';
    end if;

    select opportunity.*
    into target_opportunity
    from public.opportunities opportunity
    where opportunity.id = existing.target_opportunity_id
      and opportunity.company_id = p_company_id
      and opportunity.source_thread_key = p_target_source_thread_key
      and opportunity.deleted_at is null
    for update;
    if not found then
      raise exception 'exact_recovery_applied_target_changed'
        using errcode = '40001';
    end if;
  else
    if source_opportunity.updated_at is distinct from p_expected_source_updated_at
      or source_opportunity.stage is distinct from p_expected_source_stage
      or source_opportunity.stage_manually_set is distinct from
        p_expected_source_stage_manually_set
      or source_opportunity.assigned_to is distinct from
        p_expected_source_assigned_to
      or source_opportunity.assignment_version is distinct from
        p_expected_source_assignment_version
      or source_opportunity.project_id is distinct from
        p_expected_source_project_id
      or source_opportunity.project_ref is distinct from
        p_expected_source_project_id
    then
      raise exception 'source_opportunity_snapshot_changed'
        using errcode = '40001';
    end if;
  end if;

  select event.*
  into locked_event
  from public.opportunity_correspondence_events event
  where event.id = p_expected_correspondence_event_id
    and event.company_id = p_company_id
    and event.connection_id = p_connection_id
    and event.provider_thread_id = p_provider_thread_id
    and event.provider_message_id = p_provider_message_id
    and event.activity_id = p_expected_activity_id
    and event.opportunity_id = case
      when existing.company_id is null then p_source_opportunity_id
      else existing.target_opportunity_id
    end
  for update;
  if not found then
    raise exception 'exact_recovery_correspondence_event_not_found'
      using errcode = 'P0002';
  end if;

  select activity.*
  into locked_activity
  from public.activities activity
  where activity.id = p_expected_activity_id
    and activity.company_id = p_company_id
    and (
      activity.email_connection_id = p_connection_id
      or (
        existing.company_id is null
        and activity.email_connection_id is null
      )
    )
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
    and activity.opportunity_id = case
      when existing.company_id is null then p_source_opportunity_id
      else existing.target_opportunity_id
    end
    and activity.type = 'email'
  for update;
  if not found then
    raise exception 'exact_recovery_activity_not_found'
      using errcode = 'P0002';
  end if;

  if locked_event.opportunity_projection_applied is not true
    or locked_event.direction <> 'inbound'
    or locked_event.party_role <> 'customer'
    or locked_event.is_meaningful is not true
    or locked_activity.direction is distinct from 'inbound'
    or lower(btrim(coalesce(locked_event.from_email, ''))) is distinct from
      p_target_email
    or lower(btrim(coalesce(locked_activity.from_email, ''))) is distinct from
      p_target_email
  then
    raise exception 'exact_recovery_target_customer_evidence_mismatch'
      using errcode = '23514';
  end if;

  if existing.company_id is null then
    insert into public.opportunities (
      company_id,
      title,
      contact_name,
      contact_email,
      stage,
      source,
      source_thread_key,
      tags
    ) values (
      p_company_id,
      p_target_title,
      p_target_contact_name,
      p_target_email,
      'new_lead',
      'email',
      p_target_source_thread_key,
      array['email-import']::text[]
    )
    on conflict (company_id, source_thread_key) do nothing
    returning * into target_opportunity;

    if target_opportunity.id is null then
      select opportunity.*
      into target_opportunity
      from public.opportunities opportunity
      where opportunity.company_id = p_company_id
        and opportunity.source_thread_key = p_target_source_thread_key
      for update;
      if not found then
        raise exception 'exact_recovery_target_create_race'
          using errcode = '40001';
      end if;
      v_target_resolution := 'existing';
    else
      v_target_resolution := 'created';
    end if;

    if target_opportunity.id = p_source_opportunity_id
      or target_opportunity.deleted_at is not null
      or target_opportunity.archived_at is not null
      or target_opportunity.merged_into_opportunity_id is not null
      or target_opportunity.project_id is not null
      or target_opportunity.project_ref is not null
      or target_opportunity.stage_manually_set is true
      or target_opportunity.stage not in (
        'new_lead',
        'qualifying',
        'quoting',
        'quoted',
        'follow_up',
        'negotiation'
      )
      or target_opportunity.source_thread_key is distinct from
        p_target_source_thread_key
      or not private.opportunity_sender_is_persisted_customer(
        p_company_id,
        target_opportunity.id,
        p_target_email
      )
    then
      raise exception 'exact_recovery_target_source_conflict'
        using errcode = '23505';
    end if;

    -- Match ordinary ingestion: a new/recovered personal-mailbox lead belongs
    -- to the canonical OPS connection owner when that owner remains eligible.
    -- The assignment RPC owns the protected write/event/delivery; this recovery
    -- function never writes opportunities.assigned_to directly. Company mailbox
    -- targets, missing owners, and ineligible owners remain unassigned.
    if locked_connection.type::text = 'individual'
      and target_opportunity.assigned_to is null
      and target_opportunity.assignment_version = 0
    then
      v_connection_owner_id := private.permission_try_parse_uuid(
        locked_connection.user_id
      );
      if v_connection_owner_id is not null then
        begin
          v_assignment_result := public.change_opportunity_assignment_as_system(
            target_opportunity.id,
            target_opportunity.assignment_version,
            target_opportunity.assigned_to,
            v_connection_owner_id,
            'personal_mailbox',
            null,
            null,
            pg_catalog.jsonb_build_object(
              'connection_id', p_connection_id,
              'provider_thread_id', p_provider_thread_id,
              'ingestion_source', 'email_recovery',
              'provider_mutations_disabled', true
            )
          );
        exception when sqlstate '22023' then
          if sqlerrm <> 'assignment_target_ineligible' then
            raise;
          end if;
          v_assignment_result := null;
        end;

        select opportunity.*
        into target_opportunity
        from public.opportunities opportunity
        where opportunity.id = target_opportunity.id
          and opportunity.company_id = p_company_id
          and opportunity.deleted_at is null
        for update;
        if not found then
          raise exception 'exact_recovery_target_assignment_race'
            using errcode = '40001';
        end if;
        if v_assignment_result is not null and (
          target_opportunity.assigned_to is distinct from v_connection_owner_id
          or target_opportunity.assignment_version < 1
        ) then
          raise exception 'exact_recovery_target_assignment_failed'
            using errcode = '40001';
        end if;
      end if;
    end if;
  else
    v_target_resolution := existing.target_resolution;
  end if;

  v_result := public.reparent_opportunity_email_message_guarded(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_provider_message_id,
    p_source_opportunity_id,
    target_opportunity.id,
    p_expected_activity_id,
    p_expected_correspondence_event_id,
    p_target_email,
    p_manifest_sha256,
    p_entry_sha256,
    source_opportunity.updated_at,
    target_opportunity.updated_at,
    source_opportunity.stage,
    target_opportunity.stage,
    source_opportunity.stage_manually_set,
    target_opportunity.stage_manually_set,
    source_opportunity.assigned_to,
    target_opportunity.assigned_to,
    source_opportunity.assignment_version,
    target_opportunity.assignment_version,
    source_opportunity.project_id,
    target_opportunity.project_id
  );

  if existing.company_id is null then
    update private.email_exact_message_recovery_applications application
    set target_resolution = v_target_resolution,
        target_source_thread_key = p_target_source_thread_key,
        target_initial_title = p_target_title,
        target_initial_contact_name = p_target_contact_name
    where application.company_id = p_company_id
      and application.connection_id = p_connection_id
      and application.provider_message_id = p_provider_message_id
      and application.target_opportunity_id = target_opportunity.id
      and application.entry_sha256 = p_entry_sha256
      and application.target_resolution is null;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'exact_recovery_target_application_race'
        using errcode = '40001';
    end if;
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'target_resolution', v_target_resolution
  );
end;
$function$;

revoke all on function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) to service_role;

commit;
