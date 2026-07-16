-- Materialize exact attributed inbound email images into a converted project's
-- public photo gallery without coupling email ingestion to lead conversion.
--
-- Every public Storage mutation is represented first by a durable, immutable
-- generation-specific object identity. Stale generations can only be removed
-- through the separately leased cleanup queue, so provider success followed by
-- database failure never causes a resend/re-upload race or an untracked object.

begin;

-- ── Projection jobs ────────────────────────────────────────────────────────

create table public.email_conversion_photo_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  conversion_event_id uuid not null references public.opportunity_conversion_events(id) on delete restrict,
  email_attachment_id uuid not null references public.email_attachments(id) on delete restrict,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  source_content_sha256 text not null,
  source_verified_size_bytes bigint not null,
  operation text not null default 'materialize',
  status text not null default 'pending',
  generation bigint not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  lease_owner uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  project_storage_path text,
  project_content_sha256 text,
  project_verified_size_bytes bigint,
  project_photo_id uuid references public.project_photos(id) on delete restrict,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversion_event_id, email_attachment_id),
  constraint email_conversion_photo_jobs_source_hash_check
    check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint email_conversion_photo_jobs_source_size_check
    check (source_verified_size_bytes >= 0),
  constraint email_conversion_photo_jobs_project_hash_check
    check (
      project_content_sha256 is null
      or project_content_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint email_conversion_photo_jobs_operation_check
    check (operation in ('materialize', 'revoke')),
  constraint email_conversion_photo_jobs_status_check
    check (status in (
      'pending', 'processing', 'retrying', 'complete',
      'failed', 'skipped', 'revoked'
    )),
  constraint email_conversion_photo_jobs_attempts_check
    check (
      attempts >= 0
      and max_attempts between 1 and 100
    ),
  constraint email_conversion_photo_jobs_generation_check
    check (generation >= 0),
  constraint email_conversion_photo_jobs_size_check
    check (
      project_verified_size_bytes is null
      or project_verified_size_bytes >= 0
    ),
  constraint email_conversion_photo_jobs_lease_check
    check (
      (
        status = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint email_conversion_photo_jobs_complete_check
    check (
      status <> 'complete'
      or (
        operation = 'materialize'
        and project_storage_path is not null
        and project_content_sha256 is not null
        and project_verified_size_bytes is not null
        and project_photo_id is not null
        and completed_at is not null
      )
    )
);

comment on table public.email_conversion_photo_jobs is
  'Conversion-event projection of exact attributed inbound email image bytes into project_photos. Every claim increments generation so public object paths are never reused.';

create index email_conversion_photo_jobs_claim_idx
  on public.email_conversion_photo_jobs (available_at, created_at, id)
  where status in ('pending', 'retrying', 'processing');

create index email_conversion_photo_jobs_attachment_idx
  on public.email_conversion_photo_jobs (email_attachment_id, status);

create index email_conversion_photo_jobs_project_idx
  on public.email_conversion_photo_jobs (company_id, project_id, status);

-- ── Durable public-object ledger ───────────────────────────────────────────

create table public.email_conversion_photo_objects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.email_conversion_photo_jobs(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  conversion_event_id uuid not null references public.opportunity_conversion_events(id) on delete restrict,
  email_attachment_id uuid not null references public.email_attachments(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  generation bigint not null,
  object_path text not null,
  job_lease_token uuid not null,
  state text not null default 'staged',
  cleanup_available_at timestamptz not null,
  attempts integer not null default 0,
  lease_owner uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  project_photo_url text,
  project_content_sha256 text,
  project_verified_size_bytes bigint,
  project_photo_id uuid references public.project_photos(id) on delete restrict,
  last_error text,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, generation),
  unique (object_path),
  unique (project_photo_id),
  constraint email_conversion_photo_objects_generation_check
    check (generation >= 1),
  constraint email_conversion_photo_objects_path_check
    check (nullif(btrim(object_path), '') is not null),
  constraint email_conversion_photo_objects_state_check
    check (state in ('staged', 'published', 'delete_pending', 'deleting', 'deleted')),
  constraint email_conversion_photo_objects_attempts_check
    check (attempts >= 0),
  constraint email_conversion_photo_objects_hash_check
    check (
      project_content_sha256 is null
      or project_content_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint email_conversion_photo_objects_size_check
    check (
      project_verified_size_bytes is null
      or project_verified_size_bytes between 0 and 10485760
    ),
  constraint email_conversion_photo_objects_cleanup_lease_check
    check (
      (
        state = 'deleting'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        state <> 'deleting'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint email_conversion_photo_objects_published_check
    check (
      state <> 'published'
      or (
        project_photo_url is not null
        and project_content_sha256 is not null
        and project_verified_size_bytes is not null
        and project_photo_id is not null
        and published_at is not null
      )
    ),
  constraint email_conversion_photo_objects_deleted_check
    check (state <> 'deleted' or deleted_at is not null)
);

comment on table public.email_conversion_photo_objects is
  'Durable pre-upload reservation and indefinitely retryable cleanup ledger for generation-specific project-photos Storage objects.';

create index email_conversion_photo_objects_cleanup_idx
  on public.email_conversion_photo_objects (cleanup_available_at, created_at, id)
  where state in ('staged', 'delete_pending', 'deleting');

create index email_conversion_photo_objects_job_idx
  on public.email_conversion_photo_objects (job_id, generation desc, state);

alter table public.email_conversion_photo_jobs enable row level security;
revoke all on table public.email_conversion_photo_jobs
  from public, anon, authenticated, service_role;
grant select on table public.email_conversion_photo_jobs to service_role;

alter table public.email_conversion_photo_objects enable row level security;
revoke all on table public.email_conversion_photo_objects
  from public, anon, authenticated, service_role;
grant select on table public.email_conversion_photo_objects to service_role;

-- ── Identity guards ────────────────────────────────────────────────────────

create or replace function private.require_email_conversion_photo_job_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  conversion_event public.opportunity_conversion_events%rowtype;
  attachment public.email_attachments%rowtype;
  activity public.activities%rowtype;
begin
  select * into conversion_event
    from public.opportunity_conversion_events event
   where event.id = new.conversion_event_id;
  select * into attachment
    from public.email_attachments source_attachment
   where source_attachment.id = new.email_attachment_id;

  if conversion_event.id is null
    or attachment.id is null
    or conversion_event.event_type <> 'converted_to_project'
    or conversion_event.company_id is distinct from new.company_id
    or conversion_event.opportunity_id is distinct from new.opportunity_id
    or conversion_event.project_id is distinct from new.project_id
    or attachment.company_id is distinct from new.company_id
  then
    raise exception 'email conversion photo job identity does not match its conversion event and attachment'
      using errcode = '23514';
  end if;

  if new.operation = 'materialize' then
    if attachment.activity_id is null then
      raise exception 'email conversion photo source requires an exact inbound activity'
        using errcode = '23514';
    end if;
    select * into activity
      from public.activities exact_activity
     where exact_activity.id = attachment.activity_id;

    if attachment.opportunity_id is distinct from new.opportunity_id
      or attachment.ingest_status <> 'stored'
      or attachment.attribution_status <> 'attributed'
      or attachment.storage_backend <> 'supabase'
      or nullif(btrim(attachment.storage_path), '') is null
      or attachment.content_sha256 is distinct from new.source_content_sha256
      or attachment.verified_size_bytes is distinct from new.source_verified_size_bytes
      or lower(coalesce(attachment.detected_mime_type, '')) not like 'image/%'
      or activity.id is null
      or activity.type is distinct from 'email'
      or activity.company_id is distinct from new.company_id
      or activity.email_connection_id is distinct from attachment.connection_id
      or activity.email_message_id is distinct from attachment.message_id
      or activity.opportunity_id is distinct from new.opportunity_id
      or activity.direction is distinct from 'inbound'
      or coalesce(activity.match_needs_review, false)
    then
      raise exception 'email conversion photo source is not an exact attributed inbound image'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.require_email_conversion_photo_job_identity()
  from public, anon, authenticated, service_role;

create trigger email_conversion_photo_jobs_exact_identity
before insert or update of
  company_id,
  conversion_event_id,
  email_attachment_id,
  opportunity_id,
  project_id,
  source_content_sha256,
  source_verified_size_bytes,
  operation
on public.email_conversion_photo_jobs
for each row execute function private.require_email_conversion_photo_job_identity();

create or replace function private.require_email_conversion_photo_object_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  job public.email_conversion_photo_jobs%rowtype;
begin
  select * into job
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = new.job_id;

  if job.id is null
    or new.company_id is distinct from job.company_id
    or new.conversion_event_id is distinct from job.conversion_event_id
    or new.email_attachment_id is distinct from job.email_attachment_id
    or new.project_id is distinct from job.project_id
    or new.generation < 1
  then
    raise exception 'email conversion photo object identity does not match its job'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.require_email_conversion_photo_object_identity()
  from public, anon, authenticated, service_role;

create trigger email_conversion_photo_objects_exact_identity
before insert or update of
  job_id,
  company_id,
  conversion_event_id,
  email_attachment_id,
  project_id,
  generation,
  object_path,
  job_lease_token
on public.email_conversion_photo_objects
for each row execute function private.require_email_conversion_photo_object_identity();

create or replace function private.guard_projected_email_attachment_bytes()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if (
    old.content_sha256 is distinct from new.content_sha256
    or old.storage_path is distinct from new.storage_path
    or old.verified_size_bytes is distinct from new.verified_size_bytes
  ) and exists (
    select 1
      from public.email_conversion_photo_jobs job
     where job.email_attachment_id = old.id
  ) then
    raise exception 'projected email attachment bytes are immutable; create a new canonical attachment identity'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_projected_email_attachment_bytes()
  from public, anon, authenticated, service_role;

create trigger email_attachments_guard_projected_bytes
before update of content_sha256, storage_path, verified_size_bytes
on public.email_attachments
for each row execute function private.guard_projected_email_attachment_bytes();

-- ── Reconciliation and invalidation ────────────────────────────────────────

create or replace function private.revoke_email_conversion_photo_jobs(
  p_job_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(cardinality(p_job_ids), 0) = 0 then
    return;
  end if;

  update public.email_conversion_photo_jobs job
     set operation = 'revoke',
         status = 'pending',
         generation = job.generation + 1,
         attempts = 0,
         available_at = now(),
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         last_error = null,
         completed_at = null,
         updated_at = now()
   where job.id = any(p_job_ids);

  -- Visibility fails closed immediately. Public Storage deletion remains on
  -- the durable cleanup queue and may retry for as long as necessary.
  update public.project_photos photo
     set deleted_at = coalesce(photo.deleted_at, now())
   where photo.id in (
     select job.project_photo_id
       from public.email_conversion_photo_jobs job
      where job.id = any(p_job_ids)
        and job.project_photo_id is not null
   );

  update public.email_conversion_photo_objects object_row
     set state = case
           when object_row.state = 'deleting' then 'deleting'
           else 'delete_pending'
         end,
         cleanup_available_at = greatest(object_row.cleanup_available_at, now()),
         last_error = coalesce(object_row.last_error, 'SOURCE_IDENTITY_REVOKED'),
         updated_at = now()
   where object_row.job_id = any(p_job_ids)
     and object_row.state <> 'deleted';
end;
$function$;

revoke all on function private.revoke_email_conversion_photo_jobs(uuid[])
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_email_attachment_conversion_photo(
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  attachment public.email_attachments%rowtype;
  activity public.activities%rowtype;
  eligible boolean := false;
  revoked_job_ids uuid[] := '{}'::uuid[];
begin
  select * into attachment
    from public.email_attachments source_attachment
   where source_attachment.id = p_attachment_id;

  if attachment.id is null then
    return;
  end if;

  if attachment.activity_id is not null then
    select * into activity
      from public.activities exact_activity
     where exact_activity.id = attachment.activity_id;
  end if;

  eligible :=
    attachment.opportunity_id is not null
    and attachment.ingest_status = 'stored'
    and attachment.attribution_status = 'attributed'
    and attachment.storage_backend = 'supabase'
    and nullif(btrim(attachment.storage_path), '') is not null
    and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
    and attachment.verified_size_bytes is not null
    and attachment.verified_size_bytes >= 0
    and lower(coalesce(attachment.detected_mime_type, '')) like 'image/%'
    and activity.id is not null
    and activity.type is not distinct from 'email'
    and activity.company_id is not distinct from attachment.company_id
    and activity.email_connection_id is not distinct from attachment.connection_id
    and activity.email_message_id is not distinct from attachment.message_id
    and activity.opportunity_id is not distinct from attachment.opportunity_id
    and activity.direction is not distinct from 'inbound'
    and not coalesce(activity.match_needs_review, false);

  select coalesce(array_agg(job.id), '{}'::uuid[])
    into revoked_job_ids
    from public.email_conversion_photo_jobs job
   where job.email_attachment_id = attachment.id
     and (
       not eligible
       or job.opportunity_id is distinct from attachment.opportunity_id
     )
     and not (
       job.operation = 'revoke'
       and job.status in ('pending', 'processing', 'retrying', 'revoked')
     );

  perform private.revoke_email_conversion_photo_jobs(revoked_job_ids);

  if eligible then
    insert into public.email_conversion_photo_jobs (
      company_id,
      conversion_event_id,
      email_attachment_id,
      opportunity_id,
      project_id,
      source_content_sha256,
      source_verified_size_bytes,
      operation,
      status,
      available_at
    )
    select
      event.company_id,
      event.id,
      attachment.id,
      event.opportunity_id,
      event.project_id,
      attachment.content_sha256,
      attachment.verified_size_bytes,
      'materialize',
      'pending',
      now()
    from public.opportunity_conversion_events event
    where event.company_id = attachment.company_id
      and event.opportunity_id = attachment.opportunity_id
      and event.event_type = 'converted_to_project'
    on conflict (conversion_event_id, email_attachment_id) do update
      set source_content_sha256 = excluded.source_content_sha256,
          source_verified_size_bytes = excluded.source_verified_size_bytes,
          operation = 'materialize',
          status = 'pending',
          generation = public.email_conversion_photo_jobs.generation + 1,
          attempts = 0,
          available_at = now(),
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          last_error = null,
          completed_at = null,
          updated_at = now()
    where public.email_conversion_photo_jobs.operation = 'revoke'
       or public.email_conversion_photo_jobs.status in ('revoked', 'failed', 'skipped');
  end if;
end;
$function$;

revoke all on function private.reconcile_email_attachment_conversion_photo(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_conversion_event_email_photos()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.event_type is distinct from 'converted_to_project' then
    return new;
  end if;

  insert into public.email_conversion_photo_jobs (
    company_id,
    conversion_event_id,
    email_attachment_id,
    opportunity_id,
    project_id,
    source_content_sha256,
    source_verified_size_bytes,
    operation,
    status,
    available_at
  )
  select
    new.company_id,
    new.id,
    attachment.id,
    new.opportunity_id,
    new.project_id,
    attachment.content_sha256,
    attachment.verified_size_bytes,
    'materialize',
    'pending',
    now()
  from public.email_attachments attachment
  join public.activities activity
    on activity.id = attachment.activity_id
   and activity.type = 'email'
   and activity.company_id = attachment.company_id
   and activity.email_connection_id = attachment.connection_id
   and activity.email_message_id = attachment.message_id
  where attachment.company_id = new.company_id
    and attachment.opportunity_id = new.opportunity_id
    and attachment.ingest_status = 'stored'
    and attachment.attribution_status = 'attributed'
    and attachment.storage_backend = 'supabase'
    and nullif(btrim(attachment.storage_path), '') is not null
    and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
    and attachment.verified_size_bytes is not null
    and lower(coalesce(attachment.detected_mime_type, '')) like 'image/%'
    and activity.opportunity_id = new.opportunity_id
    and activity.direction = 'inbound'
    and not coalesce(activity.match_needs_review, false)
  on conflict (conversion_event_id, email_attachment_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_conversion_event_email_photos()
  from public, anon, authenticated, service_role;

create trigger email_conversion_events_enqueue_photos
after insert on public.opportunity_conversion_events
for each row execute function private.enqueue_conversion_event_email_photos();

create or replace function private.reconcile_email_attachment_conversion_photo_jobs()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.reconcile_email_attachment_conversion_photo(new.id);
  return new;
end;
$function$;

revoke all on function private.reconcile_email_attachment_conversion_photo_jobs()
  from public, anon, authenticated, service_role;

create trigger email_attachments_enqueue_converted_project_photo
after insert or update of
  activity_id,
  opportunity_id,
  attribution_status,
  ingest_status,
  storage_backend,
  storage_path,
  content_sha256,
  verified_size_bytes,
  detected_mime_type
on public.email_attachments
for each row execute function private.reconcile_email_attachment_conversion_photo_jobs();

create or replace function private.revoke_email_conversion_photos_for_activity_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  linked_attachment record;
begin
  if old.type is not distinct from new.type
    and old.company_id is not distinct from new.company_id
    and old.email_connection_id is not distinct from new.email_connection_id
    and old.email_message_id is not distinct from new.email_message_id
    and old.opportunity_id is not distinct from new.opportunity_id
    and old.direction is not distinct from new.direction
    and old.match_needs_review is not distinct from new.match_needs_review
  then
    return new;
  end if;

  -- Symmetric reconciliation: an invalid change revokes and hides; correcting
  -- the same activity later can enqueue a fresh generation without requiring
  -- an unrelated attachment update.
  for linked_attachment in
    select attachment.id
      from public.email_attachments attachment
     where attachment.activity_id = new.id
  loop
    perform private.reconcile_email_attachment_conversion_photo(linked_attachment.id);
  end loop;

  return new;
end;
$function$;

revoke all on function private.revoke_email_conversion_photos_for_activity_change()
  from public, anon, authenticated, service_role;

create trigger activities_revoke_email_conversion_photos
after update of
  type,
  company_id,
  email_connection_id,
  email_message_id,
  opportunity_id,
  direction,
  match_needs_review
on public.activities
for each row execute function private.revoke_email_conversion_photos_for_activity_change();

-- ── Job claim and durable object staging ───────────────────────────────────

create or replace function public.claim_email_conversion_photo_jobs(
  p_worker_id uuid,
  p_limit integer default 5,
  p_lease_seconds integer default 360
)
returns setof public.email_conversion_photo_jobs
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  claimed_job_ids uuid[] := '{}'::uuid[];
begin
  if p_worker_id is null then
    raise exception 'email conversion photo worker id is required';
  end if;

  with candidates as (
    select job.id
      from public.email_conversion_photo_jobs job
     where (
       (
         job.status in ('pending', 'retrying')
         and job.available_at <= now()
         and (
           job.operation = 'revoke'
           or job.attempts < job.max_attempts
         )
       )
       -- An expired processing claim must always be recoverable, including a
       -- worker crash on the nominal final materialization attempt.
       or (job.status = 'processing' and job.lease_expires_at <= now())
     )
     order by job.available_at, job.created_at, job.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  ), claimed as (
    update public.email_conversion_photo_jobs job
       set status = 'processing',
           generation = job.generation + 1,
           attempts = job.attempts + 1,
           lease_owner = p_worker_id,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + make_interval(
             secs => greatest(30, least(coalesce(p_lease_seconds, 360), 900))
           ),
           updated_at = now()
      from candidates
     where job.id = candidates.id
    returning job.id
  )
  select coalesce(array_agg(claimed.id), '{}'::uuid[])
    into claimed_job_ids
    from claimed;

  if cardinality(claimed_job_ids) = 0 then
    return;
  end if;

  -- A new attempt always gets a new path. Every older reservation becomes a
  -- cleanup candidate, while an in-flight delete retains its own cleanup lease.
  update public.email_conversion_photo_objects object_row
     set state = case
           when object_row.state = 'deleting' then 'deleting'
           else 'delete_pending'
         end,
         cleanup_available_at = greatest(object_row.cleanup_available_at, now()),
         last_error = coalesce(object_row.last_error, 'SUPERSEDED_GENERATION'),
         updated_at = now()
    from public.email_conversion_photo_jobs job
   where job.id = object_row.job_id
     and job.id = any(claimed_job_ids)
     and object_row.generation < job.generation
     and object_row.state <> 'deleted';

  return query
  select queued_job.*
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = any(claimed_job_ids)
   order by queued_job.available_at, queued_job.created_at, queued_job.id;
end;
$function$;

revoke all on function public.claim_email_conversion_photo_jobs(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_conversion_photo_jobs(uuid, integer, integer)
  to service_role;

create or replace function public.stage_email_conversion_photo_object(
  p_job_id uuid,
  p_generation bigint,
  p_lease_token uuid,
  p_object_path text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  job public.email_conversion_photo_jobs%rowtype;
  object_row public.email_conversion_photo_objects%rowtype;
  expected_path text;
begin
  select * into job
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = p_job_id
   for update;

  if job.id is null
    or job.status <> 'processing'
    or job.operation <> 'materialize'
    or job.generation is distinct from p_generation
    or job.lease_token is distinct from p_lease_token
    or job.lease_expires_at <= now()
  then
    return false;
  end if;

  expected_path :=
    job.company_id::text || '/' || job.project_id::text || '/email/'
    || job.conversion_event_id::text || '/'
    || job.email_attachment_id::text || '-'
    || left(job.source_content_sha256, 32) || '-g'
    || job.generation::text || '.jpg';

  if p_object_path is distinct from expected_path then
    raise exception 'email conversion photo object path is not the exact job generation'
      using errcode = '23514';
  end if;

  update public.email_conversion_photo_objects prior_object
     set state = case
           when prior_object.state = 'deleting' then 'deleting'
           else 'delete_pending'
         end,
         cleanup_available_at = greatest(prior_object.cleanup_available_at, now()),
         last_error = coalesce(prior_object.last_error, 'SUPERSEDED_GENERATION'),
         updated_at = now()
   where prior_object.job_id = job.id
     and prior_object.generation < job.generation
     and prior_object.state <> 'deleted';

  select * into object_row
    from public.email_conversion_photo_objects existing_object
   where existing_object.job_id = job.id
     and existing_object.generation = job.generation
   for update;

  if object_row.id is not null then
    if object_row.object_path is distinct from expected_path
      or object_row.job_lease_token is distinct from p_lease_token
    then
      raise exception 'email conversion photo generation has a conflicting object reservation'
        using errcode = '23505';
    end if;
    return object_row.state = 'staged';
  end if;

  insert into public.email_conversion_photo_objects (
    job_id,
    company_id,
    conversion_event_id,
    email_attachment_id,
    project_id,
    generation,
    object_path,
    job_lease_token,
    state,
    cleanup_available_at
  ) values (
    job.id,
    job.company_id,
    job.conversion_event_id,
    job.email_attachment_id,
    job.project_id,
    job.generation,
    expected_path,
    p_lease_token,
    'staged',
    job.lease_expires_at
  );

  return true;
end;
$function$;

revoke all on function public.stage_email_conversion_photo_object(uuid, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.stage_email_conversion_photo_object(uuid, bigint, uuid, text)
  to service_role;

create or replace function public.mark_email_conversion_photo_object_cleanup(
  p_job_id uuid,
  p_generation bigint,
  p_object_path text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  object_row public.email_conversion_photo_objects%rowtype;
begin
  select * into object_row
    from public.email_conversion_photo_objects staged_object
   where staged_object.job_id = p_job_id
     and staged_object.generation = p_generation
     and staged_object.object_path = p_object_path
   for update;

  if object_row.id is null then
    return false;
  end if;

  if object_row.state = 'published' then
    return false;
  end if;

  -- A stale uploader can resume after a cleanup lease has already deleted and
  -- finalized this generation. Re-arm every non-published state so its
  -- post-upload cleanup request wins regardless of whether the prior delete is
  -- pending, in flight, or already recorded as complete.
  update public.email_conversion_photo_objects staged_object
     set state = 'delete_pending',
         cleanup_available_at = now(),
         last_error = left(coalesce(p_reason, 'STALE_MATERIALIZATION'), 2000),
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         deleted_at = null,
         updated_at = now()
   where staged_object.id = object_row.id;

  return true;
end;
$function$;

revoke all on function public.mark_email_conversion_photo_object_cleanup(uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_email_conversion_photo_object_cleanup(uuid, bigint, text, text)
  to service_role;

-- ── Object cleanup queue ───────────────────────────────────────────────────

create or replace function public.claim_email_conversion_photo_object_cleanups(
  p_worker_id uuid,
  p_limit integer default 20,
  p_lease_seconds integer default 360,
  p_job_id uuid default null
)
returns setof public.email_conversion_photo_objects
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_worker_id is null then
    raise exception 'email conversion photo cleanup worker id is required';
  end if;

  return query
  with candidates as (
    select object_row.id
      from public.email_conversion_photo_objects object_row
      join public.email_conversion_photo_jobs job on job.id = object_row.job_id
     where (p_job_id is null or object_row.job_id = p_job_id)
       and (
         (
           object_row.state = 'delete_pending'
           and object_row.cleanup_available_at <= now()
         )
         or (
           object_row.state = 'deleting'
           and object_row.lease_expires_at <= now()
         )
         or (
           object_row.state = 'staged'
           and object_row.cleanup_available_at <= now()
           and not (
             job.status = 'processing'
             and job.operation = 'materialize'
             and job.generation = object_row.generation
             and job.lease_token = object_row.job_lease_token
             and job.lease_expires_at > now()
           )
         )
       )
     order by object_row.cleanup_available_at, object_row.created_at, object_row.id
     for update of object_row skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.email_conversion_photo_objects object_row
     set state = 'deleting',
         attempts = object_row.attempts + 1,
         lease_owner = p_worker_id,
         lease_token = gen_random_uuid(),
         lease_expires_at = now() + make_interval(
           secs => greatest(30, least(coalesce(p_lease_seconds, 360), 900))
         ),
         updated_at = now()
    from candidates
   where object_row.id = candidates.id
  returning object_row.*;
end;
$function$;

revoke all on function public.claim_email_conversion_photo_object_cleanups(uuid, integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_conversion_photo_object_cleanups(uuid, integer, integer, uuid)
  to service_role;

create or replace function public.finish_email_conversion_photo_object_cleanup(
  p_object_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error text,
  p_available_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  object_row public.email_conversion_photo_objects%rowtype;
begin
  if p_outcome not in ('deleted', 'retrying') then
    raise exception 'invalid email conversion photo object cleanup outcome';
  end if;

  select * into object_row
    from public.email_conversion_photo_objects cleanup_object
   where cleanup_object.id = p_object_id
   for update;

  if object_row.id is null
    or object_row.state <> 'deleting'
    or object_row.lease_token is distinct from p_lease_token
  then
    return false;
  end if;

  update public.email_conversion_photo_objects cleanup_object
     set state = case
           when p_outcome = 'deleted' then 'deleted'
           else 'delete_pending'
         end,
         cleanup_available_at = case
           when p_outcome = 'retrying' then coalesce(p_available_at, now())
           else cleanup_object.cleanup_available_at
         end,
         last_error = case
           when p_outcome = 'deleted' then null
           else left(coalesce(p_error, 'PROJECT_PHOTO_DELETE_FAILED'), 2000)
         end,
         deleted_at = case
           when p_outcome = 'deleted' then now()
           else null
         end,
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()
   where cleanup_object.id = object_row.id;

  if p_outcome = 'deleted'
    and not exists (
      select 1
        from public.email_conversion_photo_objects remaining_object
       where remaining_object.job_id = object_row.job_id
         and remaining_object.state <> 'deleted'
    )
  then
    update public.email_conversion_photo_jobs job
       set status = case
             when job.status = 'processing' then 'processing'
             else 'retrying'
           end,
           available_at = case
             when job.status = 'processing' then job.available_at
             else now()
           end,
           lease_owner = case when job.status = 'processing' then job.lease_owner else null end,
           lease_token = case when job.status = 'processing' then job.lease_token else null end,
           lease_expires_at = case when job.status = 'processing' then job.lease_expires_at else null end,
           completed_at = null,
           updated_at = now()
     where job.id = object_row.job_id
       and job.operation = 'revoke'
       and job.status <> 'revoked';
  end if;

  return true;
end;
$function$;

revoke all on function public.finish_email_conversion_photo_object_cleanup(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finish_email_conversion_photo_object_cleanup(
  uuid, uuid, text, text, timestamptz
) to service_role;

-- ── Transactional adoption and revocation ─────────────────────────────────

create or replace function public.complete_email_conversion_photo_job(
  p_job_id uuid,
  p_generation bigint,
  p_lease_token uuid,
  p_project_storage_path text,
  p_project_photo_url text,
  p_project_content_sha256 text,
  p_project_verified_size_bytes bigint,
  p_filename text default null,
  p_occurred_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  job public.email_conversion_photo_jobs%rowtype;
  object_row public.email_conversion_photo_objects%rowtype;
  attachment public.email_attachments%rowtype;
  activity public.activities%rowtype;
  conversion_event public.opportunity_conversion_events%rowtype;
  photo_id uuid;
  expected_path text;
  expected_url_suffix text;
begin
  select * into job
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = p_job_id
   for update;

  if job.id is null
    or job.status <> 'processing'
    or job.operation <> 'materialize'
    or job.generation is distinct from p_generation
    or job.lease_token is distinct from p_lease_token
    or job.lease_expires_at <= now()
  then
    return false;
  end if;

  select * into object_row
    from public.email_conversion_photo_objects ledger_object
   where ledger_object.job_id = job.id
     and ledger_object.generation = p_generation
     and ledger_object.object_path = p_project_storage_path
   for update;

  if object_row.id is null
    or object_row.state <> 'staged'
    or object_row.job_lease_token is distinct from p_lease_token
  then
    return false;
  end if;

  select * into attachment
    from public.email_attachments source_attachment
   where source_attachment.id = job.email_attachment_id
   for share;
  if attachment.activity_id is not null then
    select * into activity
      from public.activities exact_activity
     where exact_activity.id = attachment.activity_id
     for share;
  end if;
  select * into conversion_event
    from public.opportunity_conversion_events event
   where event.id = job.conversion_event_id;

  if attachment.id is null
    or conversion_event.id is null
    or attachment.company_id is distinct from job.company_id
    or attachment.opportunity_id is distinct from job.opportunity_id
    or attachment.ingest_status <> 'stored'
    or attachment.attribution_status <> 'attributed'
    or attachment.storage_backend <> 'supabase'
    or nullif(btrim(attachment.storage_path), '') is null
    or attachment.content_sha256 is distinct from job.source_content_sha256
    or attachment.verified_size_bytes is distinct from job.source_verified_size_bytes
    or lower(coalesce(attachment.detected_mime_type, '')) not like 'image/%'
    or activity.id is null
    or activity.type is distinct from 'email'
    or activity.company_id is distinct from job.company_id
    or activity.email_connection_id is distinct from attachment.connection_id
    or activity.email_message_id is distinct from attachment.message_id
    or activity.opportunity_id is distinct from job.opportunity_id
    or activity.direction is distinct from 'inbound'
    or coalesce(activity.match_needs_review, false)
    or conversion_event.event_type <> 'converted_to_project'
    or conversion_event.company_id is distinct from job.company_id
    or conversion_event.opportunity_id is distinct from job.opportunity_id
    or conversion_event.project_id is distinct from job.project_id
  then
    raise exception 'email conversion photo source changed before completion'
      using errcode = '40001';
  end if;

  expected_path :=
    job.company_id::text || '/' || job.project_id::text || '/email/'
    || job.conversion_event_id::text || '/'
    || job.email_attachment_id::text || '-'
    || left(job.source_content_sha256, 32) || '-g'
    || job.generation::text || '.jpg';
  expected_url_suffix :=
    '/storage/v1/object/public/project-photos/' || expected_path;

  if p_project_storage_path is distinct from expected_path
    or nullif(btrim(p_project_photo_url), '') is null
    or p_project_photo_url !~ '^https://'
    or right(p_project_photo_url, length(expected_url_suffix)) is distinct from expected_url_suffix
    or p_project_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_project_verified_size_bytes is null
    or p_project_verified_size_bytes < 0
    or p_project_verified_size_bytes > 10485760
  then
    raise exception 'email conversion project photo result is invalid'
      using errcode = '23514';
  end if;

  photo_id := job.project_photo_id;
  if photo_id is not null then
    perform 1
      from public.project_photos mapped_photo
     where mapped_photo.id = photo_id
       and mapped_photo.project_id = job.project_id::text
       and mapped_photo.company_id = job.company_id::text
     for update;
    if not found then
      raise exception 'email conversion project photo mapping is invalid'
        using errcode = '23514';
    end if;
  else
    select existing_photo.id into photo_id
      from public.project_photos existing_photo
     where existing_photo.project_id = job.project_id::text
       and existing_photo.company_id = job.company_id::text
       and existing_photo.url = p_project_photo_url
     order by existing_photo.created_at, existing_photo.id
     limit 1
     for update;
  end if;

  if photo_id is null then
    insert into public.project_photos (
      id,
      project_id,
      company_id,
      url,
      thumbnail_url,
      source,
      site_visit_id,
      uploaded_by,
      taken_at,
      caption,
      is_client_visible,
      deleted_at,
      created_at
    ) values (
      gen_random_uuid(),
      job.project_id::text,
      job.company_id::text,
      p_project_photo_url,
      p_project_photo_url,
      'other',
      null,
      coalesce(conversion_event.actor_user_id::text, 'system'),
      p_occurred_at,
      nullif(btrim(p_filename), ''),
      false,
      null,
      now()
    ) returning id into photo_id;
  end if;

  -- Adoption, refresh, and undelete are part of the same transaction as the
  -- object publication and job completion.
  update public.project_photos photo
     set project_id = job.project_id::text,
         company_id = job.company_id::text,
         url = p_project_photo_url,
         thumbnail_url = p_project_photo_url,
         source = 'other',
         site_visit_id = null,
         uploaded_by = coalesce(conversion_event.actor_user_id::text, 'system'),
         taken_at = p_occurred_at,
         caption = nullif(btrim(p_filename), ''),
         is_client_visible = false,
         deleted_at = null
   where photo.id = photo_id;

  -- The ledger's unique project_photo_id is the mapping concurrency guard.
  update public.email_conversion_photo_objects prior_object
     set project_photo_id = null,
         updated_at = now()
   where prior_object.job_id = job.id
     and prior_object.id <> object_row.id
     and prior_object.project_photo_id = photo_id;

  update public.email_conversion_photo_objects published_object
     set state = 'published',
         project_photo_url = p_project_photo_url,
         project_content_sha256 = p_project_content_sha256,
         project_verified_size_bytes = p_project_verified_size_bytes,
         project_photo_id = photo_id,
         last_error = null,
         published_at = now(),
         deleted_at = null,
         updated_at = now()
   where published_object.id = object_row.id;

  update public.email_conversion_photo_jobs queued_job
     set status = 'complete',
         project_storage_path = p_project_storage_path,
         project_content_sha256 = p_project_content_sha256,
         project_verified_size_bytes = p_project_verified_size_bytes,
         project_photo_id = photo_id,
         last_error = null,
         completed_at = now(),
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()
   where queued_job.id = job.id;

  return true;
end;
$function$;

revoke all on function public.complete_email_conversion_photo_job(
  uuid, bigint, uuid, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_conversion_photo_job(
  uuid, bigint, uuid, text, text, text, bigint, text, timestamptz
) to service_role;

create or replace function public.complete_email_conversion_photo_revocation(
  p_job_id uuid,
  p_generation bigint,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  job public.email_conversion_photo_jobs%rowtype;
begin
  select * into job
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = p_job_id
   for update;

  if job.id is null
    or job.status <> 'processing'
    or job.operation <> 'revoke'
    or job.generation is distinct from p_generation
    or job.lease_token is distinct from p_lease_token
    or job.lease_expires_at <= now()
  then
    return false;
  end if;

  if exists (
    select 1
      from public.email_conversion_photo_objects object_row
     where object_row.job_id = job.id
       and object_row.state <> 'deleted'
  ) then
    return false;
  end if;

  if job.project_photo_id is not null then
    update public.project_photos photo
       set deleted_at = coalesce(photo.deleted_at, now())
     where photo.id = job.project_photo_id
       and photo.project_id = job.project_id::text
       and photo.company_id = job.company_id::text;
  end if;

  update public.email_conversion_photo_jobs queued_job
     set status = 'revoked',
         project_storage_path = null,
         project_content_sha256 = null,
         project_verified_size_bytes = null,
         last_error = null,
         completed_at = now(),
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()
   where queued_job.id = job.id;

  return true;
end;
$function$;

revoke all on function public.complete_email_conversion_photo_revocation(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_email_conversion_photo_revocation(uuid, bigint, uuid)
  to service_role;

create or replace function public.finish_email_conversion_photo_job(
  p_job_id uuid,
  p_generation bigint,
  p_lease_token uuid,
  p_outcome text,
  p_error text,
  p_available_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  job public.email_conversion_photo_jobs%rowtype;
  effective_outcome text;
begin
  if p_outcome not in ('retrying', 'failed', 'skipped') then
    raise exception 'invalid email conversion photo job outcome';
  end if;

  select * into job
    from public.email_conversion_photo_jobs queued_job
   where queued_job.id = p_job_id
   for update;

  if job.id is null
    or job.status <> 'processing'
    or job.generation is distinct from p_generation
    or job.lease_token is distinct from p_lease_token
  then
    return false;
  end if;

  -- Revocation is never terminal while a public object could remain. Its job
  -- and the independent object cleanup queue both retry until reconciled.
  effective_outcome := case
    when job.operation = 'revoke' then 'retrying'
    else p_outcome
  end;

  update public.email_conversion_photo_objects staged_object
     set state = 'delete_pending',
         cleanup_available_at = now(),
         last_error = left(coalesce(p_error, 'MATERIALIZATION_NOT_COMPLETED'), 2000),
         updated_at = now()
   where staged_object.job_id = job.id
     and staged_object.generation = job.generation
     and staged_object.state = 'staged';

  update public.email_conversion_photo_jobs queued_job
     set status = effective_outcome,
         available_at = case
           when effective_outcome = 'retrying' then coalesce(p_available_at, now())
           else queued_job.available_at
         end,
         last_error = left(coalesce(p_error, 'unknown error'), 2000),
         completed_at = case
           when effective_outcome in ('failed', 'skipped') then now()
           else null
         end,
         lease_owner = null,
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()
   where queued_job.id = job.id;

  return true;
end;
$function$;

revoke all on function public.finish_email_conversion_photo_job(
  uuid, bigint, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finish_email_conversion_photo_job(
  uuid, bigint, uuid, text, text, timestamptz
) to service_role;

-- ── Existing-row convergence ───────────────────────────────────────────────

insert into public.email_conversion_photo_jobs (
  company_id,
  conversion_event_id,
  email_attachment_id,
  opportunity_id,
  project_id,
  source_content_sha256,
  source_verified_size_bytes,
  operation,
  status,
  available_at
)
select
  event.company_id,
  event.id,
  attachment.id,
  event.opportunity_id,
  event.project_id,
  attachment.content_sha256,
  attachment.verified_size_bytes,
  'materialize',
  'pending',
  now()
from public.opportunity_conversion_events event
join public.email_attachments attachment
  on attachment.company_id = event.company_id
 and attachment.opportunity_id = event.opportunity_id
join public.activities activity
  on activity.id = attachment.activity_id
 and activity.type = 'email'
 and activity.company_id = attachment.company_id
 and activity.email_connection_id = attachment.connection_id
 and activity.email_message_id = attachment.message_id
where event.event_type = 'converted_to_project'
  and attachment.ingest_status = 'stored'
  and attachment.attribution_status = 'attributed'
  and attachment.storage_backend = 'supabase'
  and nullif(btrim(attachment.storage_path), '') is not null
  and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
  and attachment.verified_size_bytes is not null
  and lower(coalesce(attachment.detected_mime_type, '')) like 'image/%'
  and activity.opportunity_id = event.opportunity_id
  and activity.direction = 'inbound'
  and not coalesce(activity.match_needs_review, false)
on conflict (conversion_event_id, email_attachment_id) do nothing;

commit;
