-- Durable browser-review approval for the historical email -> lead import.
-- Provider evidence is loaded from one completed gmail_scan_jobs result, then
-- persisted as an immutable canonical payload. Background work may continue
-- only while the original OPS actor still has the mailbox and bulk-import
-- permissions. Provider label writes are queued behind committed OPS state.

begin;

alter table public.gmail_scan_jobs
  add column if not exists source_scan_job_id uuid
    references public.gmail_scan_jobs(id) on delete restrict,
  add column if not exists approved_import_payload jsonb,
  add column if not exists approval_fingerprint text;

create unique index if not exists gmail_scan_jobs_source_import_uidx
  on public.gmail_scan_jobs (source_scan_job_id)
  where source_scan_job_id is not null;

comment on column public.gmail_scan_jobs.source_scan_job_id is
  'Completed analysis job whose immutable provider evidence was approved for this import.';
comment on column public.gmail_scan_jobs.approved_import_payload is
  'Canonical server-reconstructed import payload. Browser provider identities are never executed directly.';
comment on column public.gmail_scan_jobs.approval_fingerprint is
  'Lowercase SHA-256 of the canonical approved import payload.';

create or replace function private.email_import_actor_is_authorized(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_require_client_delete boolean default false
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_connection public.email_connections%rowtype;
begin
  if p_actor_user_id is null
    or p_company_id is null
    or p_connection_id is null
  then
    return false;
  end if;

  if not exists (
    select 1
      from public.users actor
     where actor.id = p_actor_user_id
       and actor.company_id = p_company_id
       and actor.deleted_at is null
       and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  select connection.*
    into v_connection
    from public.email_connections connection
   where connection.id = p_connection_id
     and connection.company_id = p_company_id::text;
  if not found then
    return false;
  end if;
  if v_connection.sync_enabled is distinct from true
    or v_connection.status not in ('active', 'setup_incomplete')
  then
    return false;
  end if;

  if v_connection.type::text = 'individual' then
    if v_connection.user_id is distinct from p_actor_user_id::text then
      return false;
    end if;
  elsif v_connection.type::text = 'company' then
    if not public.has_permission(
      p_actor_user_id,
      'settings.integrations',
      'all'
    ) then
      return false;
    end if;
  else
    return false;
  end if;

  -- Historical import searches and may reconcile any company lead. It is an
  -- administrative bulk operation, not an assigned-scope lead mutation.
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

  if not public.has_permission(p_actor_user_id, 'clients.view', 'all')
    or not public.has_permission(p_actor_user_id, 'clients.create', 'all')
    or not public.has_permission(p_actor_user_id, 'clients.edit', 'all')
  then
    return false;
  end if;
  if coalesce(p_require_client_delete, false)
    and not public.has_permission(
      p_actor_user_id,
      'clients.delete',
      'all'
    )
  then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function private.email_import_actor_is_authorized(
  uuid, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function private.guard_email_import_binding()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  source public.gmail_scan_jobs%rowtype;
  v_selected_client_count integer;
  v_available_client_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.source_scan_job_id is distinct from old.source_scan_job_id
      or new.approved_import_payload is distinct from old.approved_import_payload
      or new.approval_fingerprint is distinct from old.approval_fingerprint
    then
      raise exception 'email import binding is immutable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Analysis and other legacy job kinds do not carry an import binding.
  if new.source_scan_job_id is null
    and new.approved_import_payload is null
    and new.approval_fingerprint is null
  then
    return new;
  end if;

  if new.source_scan_job_id is null
    or new.approved_import_payload is null
    or new.approval_fingerprint is null
    or new.requested_by_user_id is null
  then
    raise exception 'email import binding is incomplete'
      using errcode = '23514';
  end if;
  if new.source_scan_job_id = new.id then
    raise exception 'email import cannot source itself'
      using errcode = '23514';
  end if;
  if new.approval_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'email import fingerprint is invalid'
      using errcode = '23514';
  end if;
  if jsonb_typeof(new.approved_import_payload) <> 'object'
    or jsonb_typeof(new.approved_import_payload -> 'leads') <> 'array'
    or jsonb_array_length(new.approved_import_payload -> 'leads') < 1
  then
    raise exception 'email import payload is invalid'
      using errcode = '23514';
  end if;
  if new.approved_import_payload ->> 'connectionId' is distinct from new.connection_id::text
    or new.approved_import_payload ->> 'companyId' is distinct from new.company_id
  then
    raise exception 'email import payload identity mismatch'
      using errcode = '23514';
  end if;

  select source_job.*
    into source
    from public.gmail_scan_jobs source_job
   where source_job.id = new.source_scan_job_id;
  if not found
    or source.status <> 'complete'
    or source.requested_by_user_id is distinct from new.requested_by_user_id
    or source.connection_owner_user_id is distinct from new.connection_owner_user_id
    or source.connection_id is distinct from new.connection_id
    or source.company_id is distinct from new.company_id
    or jsonb_typeof(source.result -> 'leads') <> 'array'
  then
    raise exception 'email import source is unavailable'
      using errcode = '23503';
  end if;

  with selected_clients as (
    select distinct nullif(lead ->> 'existingClientId', '') as client_id
      from jsonb_array_elements(new.approved_import_payload -> 'leads') lead
     where nullif(lead ->> 'existingClientId', '') is not null
  )
  select count(*), count(client.id)
    into v_selected_client_count, v_available_client_count
    from selected_clients selected
    left join public.clients client
      on client.id::text = selected.client_id
     and client.company_id::text = new.company_id
     and client.deleted_at is null;
  if v_available_client_count <> v_selected_client_count then
    raise exception 'email import selected clients are unavailable'
      using errcode = '23503';
  end if;

  return new;
end;
$function$;

drop trigger if exists gmail_scan_jobs_guard_import_binding
  on public.gmail_scan_jobs;
create trigger gmail_scan_jobs_guard_import_binding
before insert or update of source_scan_job_id, approved_import_payload, approval_fingerprint
on public.gmail_scan_jobs
for each row execute function private.guard_email_import_binding();

revoke all on function private.guard_email_import_binding()
  from public, anon, authenticated, service_role;

create or replace function public.get_email_import_source_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  connection public.email_connections%rowtype;
  source public.gmail_scan_jobs%rowtype;
  v_source_id_text text;
  v_source_id uuid;
  v_company_id uuid;
  v_connection_owner_user_id uuid;
  v_connection_type text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select mailbox.*
    into connection
    from public.email_connections mailbox
   where mailbox.id = p_connection_id
   for share;
  if not found then
    raise exception 'email_import_connection_not_found' using errcode = 'P0002';
  end if;

  select
    identity.company_id,
    identity.owner_user_id,
    identity.connection_type
    into
      v_company_id,
      v_connection_owner_user_id,
      v_connection_type
  from private.resolve_email_connection_identity(
    connection.id
  ) as identity
  where identity.company_id::text = connection.company_id;
  if not found then
    raise exception 'email_import_connection_not_found' using errcode = 'P0002';
  end if;

  if not private.email_import_actor_is_authorized(
    p_actor_user_id,
    v_company_id,
    connection.id,
    false
  ) then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  v_source_id_text := connection.sync_filters ->> 'lastScanJobId';
  if v_source_id_text is null
    or v_source_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'email_import_scan_not_ready' using errcode = 'P0002';
  end if;
  v_source_id := v_source_id_text::uuid;

  select source_job.*
    into source
    from public.gmail_scan_jobs source_job
   where source_job.id = v_source_id
     and source_job.connection_id = connection.id
     and source_job.company_id = connection.company_id
     and source_job.status = 'complete'
     and source_job.requested_by_user_id = p_actor_user_id
     and source_job.connection_owner_user_id is not distinct from v_connection_owner_user_id
     and jsonb_typeof(source_job.result -> 'leads') = 'array'
   for share;
  if not found then
    raise exception 'email_import_scan_not_ready' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'sourceScanJobId', source.id,
    'companyId', connection.company_id,
    'connectionId', connection.id,
    'connectionEmail', connection.email,
    'connectionOwnerUserId', v_connection_owner_user_id,
    'connectionType', v_connection_type,
    'result', source.result
  );
end;
$function$;

revoke all on function public.get_email_import_source_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_email_import_source_as_system(uuid, uuid)
  to service_role;

create or replace function public.create_email_import_job_as_system(
  p_actor_user_id uuid,
  p_source_scan_job_id uuid,
  p_approved_payload jsonb,
  p_approval_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  source public.gmail_scan_jobs%rowtype;
  connection public.email_connections%rowtype;
  existing public.gmail_scan_jobs%rowtype;
  inserted public.gmail_scan_jobs%rowtype;
  v_require_delete boolean;
  v_total_leads integer;
  v_should_dispatch boolean := false;
  v_company_id uuid;
  v_connection_owner_user_id uuid;
  v_connection_type text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_source_scan_job_id is null
    or p_approved_payload is null
    or p_approval_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_approved_payload) <> 'object'
    or jsonb_typeof(p_approved_payload -> 'leads') <> 'array'
  then
    raise exception 'email_import_approval_invalid' using errcode = '22023';
  end if;
  v_total_leads := jsonb_array_length(p_approved_payload -> 'leads');
  if v_total_leads < 1 or v_total_leads > 1000 then
    raise exception 'email_import_approval_invalid' using errcode = '22023';
  end if;

  select source_job.*
    into source
    from public.gmail_scan_jobs source_job
   where source_job.id = p_source_scan_job_id
     and source_job.status = 'complete'
     and source_job.requested_by_user_id = p_actor_user_id
     and jsonb_typeof(source_job.result -> 'leads') = 'array'
   for share;
  if not found then
    raise exception 'email_import_scan_not_ready' using errcode = 'P0002';
  end if;

  select mailbox.*
    into connection
    from public.email_connections mailbox
   where mailbox.id = source.connection_id
     and mailbox.company_id = source.company_id
     and mailbox.sync_filters ->> 'lastScanJobId' = source.id::text
   for share;
  if not found then
    raise exception 'email_import_scan_not_ready' using errcode = 'P0002';
  end if;

  select
    identity.company_id,
    identity.owner_user_id,
    identity.connection_type
    into
      v_company_id,
      v_connection_owner_user_id,
      v_connection_type
  from private.resolve_email_connection_identity(
    connection.id
  ) as identity
  where identity.company_id::text = source.company_id;
  if not found
    or source.connection_owner_user_id is distinct from v_connection_owner_user_id
  then
    raise exception 'email_import_scan_not_ready' using errcode = 'P0002';
  end if;
  if p_approved_payload ->> 'companyId' is distinct from source.company_id
    or p_approved_payload ->> 'connectionId' is distinct from source.connection_id::text
  then
    raise exception 'email_import_approval_identity_mismatch'
      using errcode = '22023';
  end if;

  select exists (
    select 1
      from jsonb_array_elements(p_approved_payload -> 'leads') lead
     where lead ->> 'action' = 'discard_existing'
  ) into v_require_delete;
  if not private.email_import_actor_is_authorized(
    p_actor_user_id,
    v_company_id,
    connection.id,
    v_require_delete
  ) then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  insert into public.gmail_scan_jobs (
    connection_id,
    company_id,
    requested_by_user_id,
    connection_owner_user_id,
    source_scan_job_id,
    approved_import_payload,
    approval_fingerprint,
    status,
    progress
  ) values (
    source.connection_id,
    source.company_id,
    p_actor_user_id,
    source.connection_owner_user_id,
    source.id,
    p_approved_payload,
    p_approval_fingerprint,
    'importing',
    jsonb_build_object(
      'stage', 'importing',
      'percent', 0,
      'message', format('Starting import of %s leads...', v_total_leads),
      'totalLeads', v_total_leads,
      'processedLeads', 0,
      'clientsCreated', 0,
      'leadsCreated', 0,
      'labelsApplied', 0
    )
  )
  on conflict (source_scan_job_id)
    where source_scan_job_id is not null
  do nothing
  returning * into inserted;

  if inserted.id is not null then
    update public.email_connections mailbox
       set sync_filters = jsonb_set(
         jsonb_set(
           coalesce(mailbox.sync_filters, '{}'::jsonb),
           '{lastImportJobId}',
           to_jsonb(inserted.id::text),
           true
         ),
         '{wizardStep}',
         '4'::jsonb,
         true
       ),
           updated_at = now()
     where mailbox.id = connection.id
       and mailbox.company_id = connection.company_id
       and mailbox.user_id is not distinct from connection.user_id;
    return jsonb_build_object(
      'jobId', inserted.id,
      'shouldDispatch', true,
      'resumed', false
    );
  end if;

  select import_job.*
    into existing
    from public.gmail_scan_jobs import_job
   where import_job.source_scan_job_id = source.id
   for update;
  if not found then
    raise exception 'email_import_job_conflict' using errcode = '40001';
  end if;
  if existing.requested_by_user_id is distinct from p_actor_user_id
    or existing.connection_id is distinct from source.connection_id
    or existing.company_id is distinct from source.company_id
    or existing.approval_fingerprint is distinct from p_approval_fingerprint
    or existing.approved_import_payload is distinct from p_approved_payload
  then
    raise exception 'email import approval fingerprint conflict'
      using errcode = '23505';
  end if;

  if existing.status = 'import_error'
    or (
      existing.status = 'importing'
      and coalesce(existing.updated_at, existing.created_at, now())
        < now() - interval '10 minutes'
    )
  then
    update public.gmail_scan_jobs
       set status = 'importing',
           error_message = null,
           updated_at = now(),
           progress = jsonb_build_object(
             'stage', 'importing',
             'percent', 0,
             'message', format('Resuming import of %s leads...', v_total_leads),
             'totalLeads', v_total_leads,
             'processedLeads', 0,
             'clientsCreated', 0,
             'leadsCreated', 0,
             'labelsApplied', 0
           )
     where id = existing.id;
    v_should_dispatch := true;
  elsif existing.status in ('importing', 'import_complete') then
    v_should_dispatch := false;
  else
    raise exception 'email_import_job_unavailable' using errcode = '55000';
  end if;

  update public.email_connections mailbox
     set sync_filters = jsonb_set(
       jsonb_set(
         coalesce(mailbox.sync_filters, '{}'::jsonb),
         '{lastImportJobId}',
         to_jsonb(existing.id::text),
         true
       ),
       '{wizardStep}',
       '4'::jsonb,
       true
     ),
         updated_at = now()
   where mailbox.id = connection.id
     and mailbox.company_id = connection.company_id
     and mailbox.user_id is not distinct from connection.user_id;

  return jsonb_build_object(
    'jobId', existing.id,
    'shouldDispatch', v_should_dispatch,
    'resumed', v_should_dispatch
  );
end;
$function$;

revoke all on function public.create_email_import_job_as_system(
  uuid, uuid, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_email_import_job_as_system(
  uuid, uuid, jsonb, text
) to service_role;

create or replace function public.authorize_email_import_job_as_system(
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  import_job public.gmail_scan_jobs%rowtype;
  source public.gmail_scan_jobs%rowtype;
  connection public.email_connections%rowtype;
  v_require_delete boolean;
  v_company_id uuid;
  v_connection_owner_user_id uuid;
  v_connection_type text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select job.*
    into import_job
    from public.gmail_scan_jobs job
   where job.id = p_job_id
     and job.status = 'importing'
     and job.source_scan_job_id is not null
     and job.requested_by_user_id is not null
     and job.approved_import_payload is not null
     and job.approval_fingerprint ~ '^[0-9a-f]{64}$'
   for share;
  if not found then
    raise exception 'email_import_job_unavailable' using errcode = 'P0002';
  end if;

  select source_job.*
    into source
    from public.gmail_scan_jobs source_job
   where source_job.id = import_job.source_scan_job_id
     and source_job.status = 'complete'
     and source_job.connection_id = import_job.connection_id
     and source_job.company_id = import_job.company_id
     and source_job.requested_by_user_id = import_job.requested_by_user_id
     and source_job.connection_owner_user_id is not distinct from import_job.connection_owner_user_id
   for share;
  if not found then
    raise exception 'email_import_source_unavailable' using errcode = '42501';
  end if;

  select mailbox.*
    into connection
    from public.email_connections mailbox
   where mailbox.id = import_job.connection_id
     and mailbox.company_id = import_job.company_id
   for share;
  if not found then
    raise exception 'email_import_connection_unavailable' using errcode = '42501';
  end if;

  select
    identity.company_id,
    identity.owner_user_id,
    identity.connection_type
    into
      v_company_id,
      v_connection_owner_user_id,
      v_connection_type
  from private.resolve_email_connection_identity(
    connection.id
  ) as identity
  where identity.company_id::text = import_job.company_id;
  if not found
    or import_job.connection_owner_user_id is distinct from v_connection_owner_user_id
  then
    raise exception 'email_import_connection_unavailable' using errcode = '42501';
  end if;

  select exists (
    select 1
      from jsonb_array_elements(import_job.approved_import_payload -> 'leads') lead
     where lead ->> 'action' = 'discard_existing'
  ) into v_require_delete;
  if not private.email_import_actor_is_authorized(
    import_job.requested_by_user_id,
    v_company_id,
    connection.id,
    v_require_delete
  ) then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'jobId', import_job.id,
    'sourceScanJobId', source.id,
    'actorUserId', import_job.requested_by_user_id,
    'companyId', connection.company_id,
    'connectionId', connection.id,
    'connectionOwnerUserId', v_connection_owner_user_id,
    'connectionType', v_connection_type,
    'approvalFingerprint', import_job.approval_fingerprint,
    'approvedPayload', import_job.approved_import_payload
  );
end;
$function$;

revoke all on function public.authorize_email_import_job_as_system(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_import_job_as_system(uuid)
  to service_role;

create or replace function public.complete_email_import_job_as_system(
  p_job_id uuid,
  p_result jsonb,
  p_progress jsonb
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  import_job public.gmail_scan_jobs%rowtype;
  source public.gmail_scan_jobs%rowtype;
  connection public.email_connections%rowtype;
  v_require_delete boolean;
  v_expected_operations integer;
  v_queued_operations integer;
  v_company_id uuid;
  v_connection_owner_user_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_result) <> 'object'
    or jsonb_typeof(p_result -> 'errors') <> 'array'
    or jsonb_array_length(p_result -> 'errors') <> 0
    or jsonb_typeof(p_progress) <> 'object'
    or p_progress ->> 'stage' is distinct from 'import_complete'
  then
    raise exception 'email_import_completion_invalid' using errcode = '22023';
  end if;

  select job.*
    into import_job
    from public.gmail_scan_jobs job
   where job.id = p_job_id
     and job.status = 'importing'
     and job.source_scan_job_id is not null
     and job.requested_by_user_id is not null
     and job.approved_import_payload is not null
   for update;
  if not found then
    raise exception 'email_import_job_unavailable' using errcode = 'P0002';
  end if;

  select source_job.*
    into source
    from public.gmail_scan_jobs source_job
   where source_job.id = import_job.source_scan_job_id
     and source_job.status = 'complete'
     and source_job.connection_id = import_job.connection_id
     and source_job.company_id = import_job.company_id
     and source_job.requested_by_user_id = import_job.requested_by_user_id
     and source_job.connection_owner_user_id is not distinct from import_job.connection_owner_user_id
   for share;
  if not found then
    raise exception 'email_import_source_unavailable' using errcode = '42501';
  end if;

  select mailbox.*
    into connection
    from public.email_connections mailbox
   where mailbox.id = import_job.connection_id
     and mailbox.company_id = import_job.company_id
   for update;
  if not found then
    raise exception 'email_import_connection_unavailable' using errcode = '42501';
  end if;

  select identity.company_id, identity.owner_user_id
    into v_company_id, v_connection_owner_user_id
  from private.resolve_email_connection_identity(
    connection.id
  ) as identity
  where identity.company_id::text = import_job.company_id;
  if not found
    or import_job.connection_owner_user_id is distinct from v_connection_owner_user_id
  then
    raise exception 'email_import_connection_unavailable' using errcode = '42501';
  end if;

  select exists (
    select 1
      from jsonb_array_elements(import_job.approved_import_payload -> 'leads') lead
     where lead ->> 'action' = 'discard_existing'
  ) into v_require_delete;
  if not private.email_import_actor_is_authorized(
    import_job.requested_by_user_id,
    v_company_id,
    connection.id,
    v_require_delete
  ) then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  with expected_threads as (
    select distinct candidate.provider_thread_id
      from jsonb_array_elements(
        import_job.approved_import_payload -> 'leads'
      ) lead
      cross join lateral (
        select coalesce(
          nullif(lead ->> 'providerThreadId', ''),
          nullif(lead ->> 'threadId', '')
        ) as provider_thread_id
        union all
        select nullif(message ->> 'providerThreadId', '')
          from jsonb_array_elements(
            coalesce(lead -> 'emails', '[]'::jsonb)
          ) message
      ) candidate
     where lead ->> 'action' <> 'discard'
       and candidate.provider_thread_id is not null
  )
  select count(*) into v_expected_operations from expected_threads;

  select count(distinct operation.provider_thread_id)
    into v_queued_operations
    from public.email_import_provider_operations operation
   where operation.import_job_id = import_job.id
     and operation.connection_id = import_job.connection_id
     and operation.company_id::text = import_job.company_id
     and operation.operation_type = 'apply_pipeline_label';
  if v_queued_operations <> v_expected_operations then
    raise exception 'email_import_provider_operations_incomplete'
      using errcode = '23514';
  end if;

  update public.email_connections mailbox
     set sync_filters = jsonb_set(
       jsonb_set(
         jsonb_set(
           coalesce(mailbox.sync_filters, '{}'::jsonb),
           '{lastImportJobId}',
           to_jsonb(import_job.id::text),
           true
         ),
         '{wizardStep}',
         '5'::jsonb,
         true
       ),
       '{importComplete}',
       'true'::jsonb,
       true
     ),
         updated_at = now()
   where mailbox.id = connection.id
     and mailbox.company_id = connection.company_id
     and mailbox.user_id is not distinct from connection.user_id;

  update public.gmail_scan_jobs
     set status = 'import_complete',
         progress = p_progress,
         result = p_result,
         error_message = null,
         updated_at = now()
   where id = import_job.id;

  return true;
end;
$function$;

revoke all on function public.complete_email_import_job_as_system(
  uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_import_job_as_system(
  uuid, jsonb, jsonb
) to service_role;

create table if not exists public.email_import_provider_operations (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null
    references public.gmail_scan_jobs(id) on delete restrict,
  company_id uuid not null
    references public.companies(id) on delete restrict,
  connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  provider_thread_id text not null,
  operation_type text not null default 'apply_pipeline_label'
    check (operation_type in ('apply_pipeline_label')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'applied', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_holder uuid,
  lease_expires_at timestamptz,
  provider_label_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (import_job_id, connection_id, provider_thread_id, operation_type),
  check (length(btrim(provider_thread_id)) > 0),
  check (
    (status = 'processing' and lease_holder is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_holder is null and lease_expires_at is null)
  )
);

create index if not exists email_import_provider_operations_claim_idx
  on public.email_import_provider_operations (
    status,
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  where status in ('pending', 'failed', 'processing');

alter table public.email_import_provider_operations enable row level security;
revoke all on public.email_import_provider_operations
  from public, anon, authenticated, service_role;

create or replace function private.guard_email_import_provider_operation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  import_job public.gmail_scan_jobs%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.import_job_id is distinct from old.import_job_id
    or new.company_id is distinct from old.company_id
    or new.connection_id is distinct from old.connection_id
    or new.provider_thread_id is distinct from old.provider_thread_id
    or new.operation_type is distinct from old.operation_type
  ) then
    raise exception 'email import provider operation identity is immutable'
      using errcode = '23514';
  end if;

  select job.*
    into import_job
    from public.gmail_scan_jobs job
   where job.id = new.import_job_id
     and job.source_scan_job_id is not null
     and job.company_id = new.company_id::text
     and job.connection_id = new.connection_id
     and job.status in ('importing', 'import_complete');
  if not found then
    raise exception 'email import provider operation job is unavailable'
      using errcode = '23503';
  end if;
  return new;
end;
$function$;

drop trigger if exists email_import_provider_operations_guard
  on public.email_import_provider_operations;
create trigger email_import_provider_operations_guard
before insert or update of import_job_id, company_id, connection_id, provider_thread_id, operation_type
on public.email_import_provider_operations
for each row execute function private.guard_email_import_provider_operation();

revoke all on function private.guard_email_import_provider_operation()
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_email_import_provider_operation_as_system(
  p_job_id uuid,
  p_provider_thread_id text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  import_job public.gmail_scan_jobs%rowtype;
  connection public.email_connections%rowtype;
  v_provider_thread_id text;
  v_is_expected boolean;
  v_company_id uuid;
  v_connection_owner_user_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  v_provider_thread_id := nullif(btrim(p_provider_thread_id), '');
  if p_job_id is null
    or v_provider_thread_id is null
    or length(v_provider_thread_id) > 2000
  then
    raise exception 'invalid_email_import_provider_operation'
      using errcode = '22023';
  end if;

  select job.*
    into import_job
    from public.gmail_scan_jobs job
   where job.id = p_job_id
     and job.status = 'importing'
     and job.source_scan_job_id is not null
     and job.requested_by_user_id is not null
     and job.approved_import_payload is not null
   for share;
  if not found then
    raise exception 'email_import_job_unavailable' using errcode = 'P0002';
  end if;

  select mailbox.*
    into connection
    from public.email_connections mailbox
   where mailbox.id = import_job.connection_id
     and mailbox.company_id = import_job.company_id
   for share;
  if not found then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  select identity.company_id, identity.owner_user_id
    into v_company_id, v_connection_owner_user_id
  from private.resolve_email_connection_identity(
    connection.id
  ) as identity
  where identity.company_id::text = import_job.company_id;
  if not found
    or import_job.connection_owner_user_id is distinct from v_connection_owner_user_id
    or not private.email_import_actor_is_authorized(
      import_job.requested_by_user_id,
      v_company_id,
      connection.id,
      false
    )
  then
    raise exception 'email_import_forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1
      from jsonb_array_elements(
        import_job.approved_import_payload -> 'leads'
      ) lead
      cross join lateral (
        select coalesce(
          nullif(lead ->> 'providerThreadId', ''),
          nullif(lead ->> 'threadId', '')
        ) as provider_thread_id
        union all
        select nullif(message ->> 'providerThreadId', '')
          from jsonb_array_elements(
            coalesce(lead -> 'emails', '[]'::jsonb)
          ) message
      ) candidate
     where lead ->> 'action' <> 'discard'
       and candidate.provider_thread_id = v_provider_thread_id
  ) into v_is_expected;
  if not v_is_expected then
    raise exception 'email_import_provider_thread_not_approved'
      using errcode = '42501';
  end if;

  insert into public.email_import_provider_operations (
    import_job_id,
    company_id,
    connection_id,
    provider_thread_id,
    operation_type,
    status
  ) values (
    import_job.id,
    v_company_id,
    connection.id,
    v_provider_thread_id,
    'apply_pipeline_label',
    'pending'
  )
  on conflict (
    import_job_id,
    connection_id,
    provider_thread_id,
    operation_type
  ) do nothing;

  return exists (
    select 1
      from public.email_import_provider_operations operation
     where operation.import_job_id = import_job.id
       and operation.connection_id = connection.id
       and operation.provider_thread_id = v_provider_thread_id
       and operation.operation_type = 'apply_pipeline_label'
  );
end;
$function$;

revoke all on function public.enqueue_email_import_provider_operation_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_import_provider_operation_as_system(
  uuid, text
) to service_role;

create or replace function public.claim_email_import_provider_operations(
  p_holder uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
) returns setof public.email_import_provider_operations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_holder is null
    or p_limit < 1 or p_limit > 100
    or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'invalid_email_import_provider_claim'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select operation.id
      from public.email_import_provider_operations operation
      join public.gmail_scan_jobs job on job.id = operation.import_job_id
      join public.email_connections connection on connection.id = operation.connection_id
      join lateral private.resolve_email_connection_identity(
        connection.id
      ) identity on true
     where (
         (
           operation.status in ('pending', 'failed')
           and operation.available_at <= now()
         )
         or (
           operation.status = 'processing'
           and operation.lease_expires_at is not null
           and operation.lease_expires_at <= now()
         )
       )
       and job.status = 'import_complete'
       and job.requested_by_user_id is not null
       and connection.company_id = operation.company_id::text
       and job.company_id = operation.company_id::text
       and identity.company_id = operation.company_id
       and identity.owner_user_id is not distinct from job.connection_owner_user_id
       and private.email_import_actor_is_authorized(
         job.requested_by_user_id,
         operation.company_id,
         operation.connection_id,
         false
       )
     order by operation.available_at, operation.created_at, operation.id
     for update of operation skip locked
     limit p_limit
  )
  update public.email_import_provider_operations operation
     set status = 'processing',
         lease_holder = p_holder,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = operation.attempt_count + 1,
         updated_at = now()
    from candidates
   where operation.id = candidates.id
  returning operation.*;
end;
$function$;

revoke all on function public.claim_email_import_provider_operations(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_import_provider_operations(uuid, integer, integer)
  to service_role;

-- Recheck the exact lease, mailbox identity and original import actor at the
-- last durable boundary before a provider label read/write. A claim alone is
-- not authority: permissions, mailbox ownership, or the lease can change while
-- a worker is loading the connection.
create or replace function public.authorize_email_import_provider_operation_as_system(
  p_operation_id uuid,
  p_holder uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_operation_id is null or p_holder is null then
    raise exception 'invalid_email_import_provider_authorization'
      using errcode = '22023';
  end if;

  return exists (
    select 1
      from public.email_import_provider_operations operation
      join public.gmail_scan_jobs job
        on job.id = operation.import_job_id
      join public.email_connections connection
        on connection.id = operation.connection_id
      join lateral private.resolve_email_connection_identity(
        connection.id
      ) identity on true
     where operation.id = p_operation_id
       and operation.operation_type = 'apply_pipeline_label'
       and operation.status = 'processing'
       and operation.lease_holder = p_holder
       and operation.lease_expires_at > now()
       and job.status = 'import_complete'
       and job.requested_by_user_id is not null
       and job.company_id = operation.company_id::text
       and job.connection_id = operation.connection_id
       and connection.company_id = operation.company_id::text
       and identity.company_id = operation.company_id
       and identity.owner_user_id is not distinct from job.connection_owner_user_id
       and private.email_import_actor_is_authorized(
         job.requested_by_user_id,
         operation.company_id,
         operation.connection_id,
         false
       )
  );
end;
$function$;

revoke all on function public.authorize_email_import_provider_operation_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_import_provider_operation_as_system(
  uuid, uuid
) to service_role;

create or replace function public.complete_email_import_provider_operation(
  p_operation_id uuid,
  p_holder uuid,
  p_provider_label_id text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_rows integer;
  v_provider_label_id text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  v_provider_label_id := nullif(btrim(p_provider_label_id), '');
  if p_operation_id is null
    or p_holder is null
    or v_provider_label_id is null
  then
    raise exception 'invalid_email_import_provider_completion'
      using errcode = '22023';
  end if;

  -- Completion is idempotent. If the provider accepted the label and this RPC
  -- committed but its response was lost, the worker may retry only this
  -- database transition without applying the provider label again.
  if exists (
    select 1
      from public.email_import_provider_operations operation
     where operation.id = p_operation_id
       and operation.status = 'applied'
       and operation.provider_label_id is not distinct from v_provider_label_id
  ) then
    return true;
  end if;

  -- Do not require an unexpired clock here: the current holder may finish a
  -- provider call just after its lease deadline. A reclaimed operation has a
  -- new holder, so the superseded worker still cannot complete it.
  update public.email_import_provider_operations
     set status = 'applied',
         provider_label_id = v_provider_label_id,
         lease_holder = null,
         lease_expires_at = null,
         last_error = null,
         completed_at = now(),
         updated_at = now()
   where id = p_operation_id
     and status = 'processing'
     and lease_holder = p_holder;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all on function public.complete_email_import_provider_operation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_email_import_provider_operation(uuid, uuid, text)
  to service_role;

create or replace function public.fail_email_import_provider_operation(
  p_operation_id uuid,
  p_holder uuid,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  update public.email_import_provider_operations
     set status = case when attempt_count >= 8 then 'failed' else 'pending' end,
         available_at = case
           when attempt_count >= 8 then now() + interval '24 hours'
           else now() + least(
             interval '1 hour',
             make_interval(secs => (15 * power(2, greatest(attempt_count - 1, 0)))::integer)
           )
         end,
         lease_holder = null,
         lease_expires_at = null,
         last_error = left(coalesce(p_error, 'provider label operation failed'), 2000),
         updated_at = now()
   where id = p_operation_id
     and status = 'processing'
     and lease_holder = p_holder;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all on function public.fail_email_import_provider_operation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_email_import_provider_operation(uuid, uuid, text)
  to service_role;

commit;
