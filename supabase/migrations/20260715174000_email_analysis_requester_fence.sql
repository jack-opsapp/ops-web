-- Persist the canonical OPS requester and mailbox-owner snapshot for every
-- long-running inbox analysis. Chained service-role stages re-authorize this
-- requester before touching provider or company data; body identities are
-- never authorization inputs.

alter table public.gmail_scan_jobs
  add column if not exists requested_by_user_id uuid
    references public.users(id) on delete restrict,
  add column if not exists connection_owner_user_id uuid
    references public.users(id) on delete restrict;

create index if not exists gmail_scan_jobs_requester_idx
  on public.gmail_scan_jobs (requested_by_user_id, created_at desc);

comment on column public.gmail_scan_jobs.requested_by_user_id is
  'Canonical OPS users.id that initiated the scan. Chained stages must re-authorize this actor.';
comment on column public.gmail_scan_jobs.connection_owner_user_id is
  'Immutable canonical OPS owner snapshot for an individual mailbox; NULL for company mailboxes.';

-- email_connections retains legacy TEXT tenant/owner identifiers. Resolve
-- those identifiers only by joining their canonical UUID rows. Company
-- mailboxes deliberately return a NULL owner even when a legacy connector
-- user_id remains populated on the connection row.
create or replace function private.resolve_email_connection_identity(
  p_connection_id uuid
)
returns table (
  company_id uuid,
  owner_user_id uuid,
  connection_type text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    company.id,
    case when connection.type::text = 'individual'
      then owner.id
      else null::uuid
    end,
    connection.type::text
  from public.email_connections as connection
  join public.companies as company
    on company.id::text = connection.company_id
   and company.deleted_at is null
  left join public.users as owner
    on connection.type::text = 'individual'
   and owner.id::text = connection.user_id
   and owner.company_id = company.id
   and owner.deleted_at is null
   and coalesce(owner.is_active, false)
  where connection.id = p_connection_id
    and connection.type::text in ('individual', 'company')
    and (
      connection.type::text <> 'individual'
      or owner.id is not null
    );
$function$;

revoke all on function private.resolve_email_connection_identity(uuid)
  from public, anon, authenticated, service_role;

-- Existing job kinds share this table. Snapshot their current canonical
-- mailbox owner so status reads can still fail closed after an ownership
-- change even when the older route did not persist a requester. This also
-- clears any connector user from company-mailbox snapshots.
update public.gmail_scan_jobs as job
set connection_owner_user_id = identity.owner_user_id
from public.email_connections as connection
cross join lateral private.resolve_email_connection_identity(
  connection.id
) as identity
where connection.id = job.connection_id
  and connection.company_id = job.company_id;

create or replace function private.set_email_analysis_owner_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_owner_user_id uuid;
  v_connection_type text;
  v_actor_is_current boolean;
begin
  select identity.owner_user_id, identity.connection_type
    into v_owner_user_id, v_connection_type
  from private.resolve_email_connection_identity(
    new.connection_id
  ) as identity
  where identity.company_id::text = new.company_id;

  if not found then
    raise exception 'gmail scan connection is unavailable' using errcode = '23503';
  end if;

  if new.requested_by_user_id is not null then
    select exists (
      select 1
      from public.users as actor
      where actor.id = new.requested_by_user_id
        and actor.company_id::text = new.company_id
        and actor.deleted_at is null
        and coalesce(actor.is_active, false)
    ) into v_actor_is_current;

    if not coalesce(v_actor_is_current, false) then
      raise exception 'gmail scan requester is not an active company user'
        using errcode = '42501';
    end if;

    if v_connection_type = 'individual' then
      if new.requested_by_user_id is distinct from v_owner_user_id then
        raise exception 'gmail scan requester does not own the personal mailbox'
          using errcode = '42501';
      end if;
    elsif v_connection_type = 'company' then
      if not public.has_permission(
        new.requested_by_user_id,
        'settings.integrations',
        'all'
      ) then
        raise exception 'gmail scan requester cannot manage company integrations'
          using errcode = '42501';
      end if;
    else
      raise exception 'gmail scan connection type is unsupported'
        using errcode = '23514';
    end if;
  end if;

  new.connection_owner_user_id := v_owner_user_id;
  return new;
end;
$function$;

drop trigger if exists gmail_scan_jobs_set_owner_snapshot
  on public.gmail_scan_jobs;
create trigger gmail_scan_jobs_set_owner_snapshot
before insert on public.gmail_scan_jobs
for each row execute function private.set_email_analysis_owner_snapshot();

create or replace function private.guard_email_analysis_requester_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'gmail scan company is immutable' using errcode = '23514';
  end if;
  if new.connection_id is distinct from old.connection_id then
    raise exception 'gmail scan connection is immutable' using errcode = '23514';
  end if;
  if new.requested_by_user_id is distinct from old.requested_by_user_id then
    raise exception 'gmail scan requester is immutable' using errcode = '23514';
  end if;
  if new.connection_owner_user_id is distinct from old.connection_owner_user_id then
    raise exception 'gmail scan connection owner snapshot is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists gmail_scan_jobs_guard_requester_snapshot
  on public.gmail_scan_jobs;
create trigger gmail_scan_jobs_guard_requester_snapshot
before update of company_id, connection_id, requested_by_user_id, connection_owner_user_id
on public.gmail_scan_jobs
for each row execute function private.guard_email_analysis_requester_snapshot();

revoke all on function private.guard_email_analysis_requester_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.set_email_analysis_owner_snapshot()
  from public, anon, authenticated, service_role;

-- Phase B can run for several minutes while mailbox ownership, company
-- membership, or integration authority changes. Publish the completed job and
-- its mailbox wizard marker in one transaction, after serializing against the
-- same company-scoped permission lock used by lead assignment.
do $block$
begin
  if to_regprocedure('private.lock_lead_assignment_company(uuid)') is null then
    raise exception
      'email_analysis_requester_fence requires private.lock_lead_assignment_company(uuid)';
  end if;
end;
$block$;

create or replace function public.complete_email_analysis_job_as_system(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_result jsonb,
  p_progress jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job public.gmail_scan_jobs%rowtype;
  connection public.email_connections%rowtype;
  actor public.users%rowtype;
  identity record;
  v_company_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email analysis completion requires service role'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_actor_user_id is null then
    raise exception 'email analysis completion identity is required'
      using errcode = '22023';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'email analysis result must be an object'
      using errcode = '22023';
  end if;
  if p_progress is null or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'email analysis progress must be an object'
      using errcode = '22023';
  end if;

  -- Resolve only the lock key before taking the company advisory lock. Every
  -- authority-bearing row is selected again under a row lock below.
  select company.id
    into v_company_id
  from public.gmail_scan_jobs as candidate_job
  join public.companies as company
    on company.id::text = candidate_job.company_id
   and company.deleted_at is null
  where candidate_job.id = p_job_id;
  if not found then
    raise exception 'email analysis job is unavailable' using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select candidate_job.*
    into job
  from public.gmail_scan_jobs as candidate_job
  where candidate_job.id = p_job_id
  for update;
  if not found or job.company_id <> v_company_id::text then
    raise exception 'email analysis job changed during completion'
      using errcode = '40001';
  end if;

  select candidate_connection.*
    into connection
  from public.email_connections as candidate_connection
  where candidate_connection.id = job.connection_id
    and candidate_connection.company_id = job.company_id
  for update;
  if not found then
    raise exception 'email analysis connection is unavailable'
      using errcode = '42501';
  end if;

  select candidate_actor.*
    into actor
  from public.users as candidate_actor
  where candidate_actor.id = p_actor_user_id
    and candidate_actor.company_id = v_company_id
    and candidate_actor.deleted_at is null
    and coalesce(candidate_actor.is_active, false)
  for share;
  if not found then
    raise exception 'email analysis requester is unavailable'
      using errcode = '42501';
  end if;

  select resolved.*
    into identity
  from private.resolve_email_connection_identity(job.connection_id) as resolved
  where resolved.company_id = v_company_id;
  if not found then
    raise exception 'email analysis connection identity is unavailable'
      using errcode = '42501';
  end if;

  if job.requested_by_user_id is distinct from p_actor_user_id then
    raise exception 'email analysis requester does not match the immutable job actor'
      using errcode = '42501';
  end if;
  if job.connection_owner_user_id is distinct from identity.owner_user_id then
    raise exception 'email analysis mailbox ownership changed'
      using errcode = '42501';
  end if;
  if connection.sync_enabled is distinct from true
     or connection.status not in ('active', 'setup_incomplete') then
    raise exception 'email analysis connection is disabled'
      using errcode = '42501';
  end if;

  if identity.connection_type = 'individual' then
    if identity.owner_user_id is distinct from p_actor_user_id then
      raise exception 'email analysis requester does not own the personal mailbox'
        using errcode = '42501';
    end if;
  elsif identity.connection_type = 'company' then
    if identity.owner_user_id is not null
       or not public.has_permission(
         p_actor_user_id,
         'settings.integrations',
         'all'
       ) then
      raise exception 'email analysis requester cannot manage company integrations'
        using errcode = '42501';
    end if;
  else
    raise exception 'email analysis connection type is unsupported'
      using errcode = '42501';
  end if;

  if job.status <> 'analyzing_threads' then
    raise exception 'email analysis job is not ready for completion'
      using errcode = '55000';
  end if;

  update public.gmail_scan_jobs as completed_job
     set status = 'complete',
         progress = p_progress,
         result = p_result,
         error_message = null,
         updated_at = now()
   where completed_job.id = job.id;

  update public.email_connections as completed_connection
     set sync_filters = coalesce(completed_connection.sync_filters, '{}'::jsonb)
       || jsonb_build_object(
         'wizardStep', 3,
         'lastScanJobId', job.id::text,
         'lastScanComplete', true
       ),
         updated_at = now()
   where completed_connection.id = connection.id
     and completed_connection.company_id = job.company_id;

  return jsonb_build_object(
    'job_id', job.id,
    'company_id', v_company_id,
    'connection_id', connection.id,
    'connection_type', identity.connection_type,
    'actor_user_id', actor.id,
    'status', 'complete'
  );
end;
$function$;

revoke all on function public.complete_email_analysis_job_as_system(
  uuid,
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_analysis_job_as_system(
  uuid,
  uuid,
  jsonb,
  jsonb
) to service_role;
