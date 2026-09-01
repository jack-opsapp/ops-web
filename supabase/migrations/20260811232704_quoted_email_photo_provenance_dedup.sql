-- Reject owner-authored images carried back inside inbound reply history and
-- enforce one active email-photo projection per project/source byte identity.

begin;

create index email_attachments_photo_thread_hash_idx
  on public.email_attachments
    (company_id, connection_id, provider_thread_id, content_sha256, occurred_at)
  where ingest_status = 'stored'
    and content_sha256 is not null;

create index email_attachments_photo_opportunity_hash_idx
  on public.email_attachments
    (company_id, opportunity_id, content_sha256, occurred_at, id)
  where ingest_status = 'stored'
    and content_sha256 is not null;

create or replace function private.email_conversion_photo_attachment_is_base_eligible(
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.email_attachments attachment
      join public.activities activity
        on activity.id = attachment.activity_id
       and activity.type = 'email'
       and activity.company_id = attachment.company_id
       and activity.email_connection_id = attachment.connection_id
       and activity.email_message_id = attachment.message_id
       and activity.opportunity_id = attachment.opportunity_id
     where attachment.id = p_attachment_id
       and attachment.opportunity_id is not null
       and attachment.ingest_status = 'stored'
       and attachment.attribution_status = 'attributed'
       and attachment.storage_backend = 'supabase'
       and nullif(btrim(attachment.storage_path), '') is not null
       and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
       and attachment.verified_size_bytes is not null
       and attachment.verified_size_bytes >= 0
       and attachment.occurred_at is not null
       and lower(coalesce(attachment.detected_mime_type, '')) like 'image/%'
       and activity.direction = 'inbound'
       and not coalesce(activity.match_needs_review, false)
  );
$function$;

revoke all on function private.email_conversion_photo_attachment_is_base_eligible(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.email_conversion_photo_source_is_eligible(
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.email_attachments attachment
     where attachment.id = p_attachment_id
       and private.email_conversion_photo_attachment_is_base_eligible(attachment.id)
       -- The reply envelope is inbound, but identical bytes already sent by
       -- the operator in this provider thread or attributed opportunity remain
       -- operator-authored even when Gmail splits the reply into a new thread.
       and not exists (
         select 1
           from public.email_attachments outbound_attachment
           join public.activities outbound_activity
             on outbound_activity.id = outbound_attachment.activity_id
            and outbound_activity.type = 'email'
            and outbound_activity.company_id = outbound_attachment.company_id
            and outbound_activity.email_connection_id = outbound_attachment.connection_id
            and outbound_activity.email_message_id = outbound_attachment.message_id
          where outbound_attachment.company_id = attachment.company_id
            and outbound_attachment.content_sha256 = attachment.content_sha256
            and (
              (
                outbound_attachment.connection_id = attachment.connection_id
                and outbound_attachment.provider_thread_id is not distinct from attachment.provider_thread_id
              )
              or (
                attachment.opportunity_id is not null
                and outbound_attachment.opportunity_id is not distinct from attachment.opportunity_id
              )
            )
            and outbound_attachment.ingest_status = 'stored'
            and outbound_attachment.occurred_at is not null
            and outbound_activity.direction = 'outbound'
            and outbound_attachment.occurred_at <= attachment.occurred_at
       )
       -- Only the earliest genuinely inbound copy of exact bytes may project
       -- into a converted project's photo gallery.
       and not exists (
         select 1
           from public.email_attachments prior_attachment
          where prior_attachment.company_id = attachment.company_id
            and prior_attachment.opportunity_id = attachment.opportunity_id
            and prior_attachment.content_sha256 = attachment.content_sha256
            and (prior_attachment.occurred_at, prior_attachment.id)
                < (attachment.occurred_at, attachment.id)
            and private.email_conversion_photo_attachment_is_base_eligible(prior_attachment.id)
            and not exists (
              select 1
                from public.email_attachments prior_outbound_attachment
                join public.activities prior_outbound_activity
                  on prior_outbound_activity.id = prior_outbound_attachment.activity_id
                 and prior_outbound_activity.type = 'email'
                 and prior_outbound_activity.company_id = prior_outbound_attachment.company_id
                 and prior_outbound_activity.email_connection_id = prior_outbound_attachment.connection_id
                 and prior_outbound_activity.email_message_id = prior_outbound_attachment.message_id
               where prior_outbound_attachment.company_id = prior_attachment.company_id
                 and prior_outbound_attachment.content_sha256 = prior_attachment.content_sha256
                 and (
                   (
                     prior_outbound_attachment.connection_id = prior_attachment.connection_id
                     and prior_outbound_attachment.provider_thread_id is not distinct from prior_attachment.provider_thread_id
                   )
                   or (
                     prior_attachment.opportunity_id is not null
                     and prior_outbound_attachment.opportunity_id is not distinct from prior_attachment.opportunity_id
                   )
                 )
                 and prior_outbound_attachment.ingest_status = 'stored'
                 and prior_outbound_attachment.occurred_at is not null
                 and prior_outbound_activity.direction = 'outbound'
                 and prior_outbound_attachment.occurred_at <= prior_attachment.occurred_at
            )
       )
  );
$function$;

revoke all on function private.email_conversion_photo_source_is_eligible(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.require_email_conversion_photo_job_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  conversion_event public.opportunity_conversion_events%rowtype;
  attachment public.email_attachments%rowtype;
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

  if new.operation = 'materialize'
    and (
      attachment.opportunity_id is distinct from new.opportunity_id
      or attachment.content_sha256 is distinct from new.source_content_sha256
      or attachment.verified_size_bytes is distinct from new.source_verified_size_bytes
      or not private.email_conversion_photo_source_is_eligible(attachment.id)
    )
  then
    raise exception 'email conversion photo source is not an exact attributed inbound image'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.require_email_conversion_photo_job_identity()
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
  conversion_event public.opportunity_conversion_events%rowtype;
  eligible boolean := false;
  reactivated boolean := false;
  revoked_job_ids uuid[] := '{}'::uuid[];
begin
  select * into attachment
    from public.email_attachments source_attachment
   where source_attachment.id = p_attachment_id;

  if attachment.id is null then
    return;
  end if;

  eligible := private.email_conversion_photo_source_is_eligible(attachment.id);

  select coalesce(array_agg(job.id order by job.id), '{}'::uuid[])
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
    for conversion_event in
      select event.*
        from public.opportunity_conversion_events event
       where event.company_id = attachment.company_id
         and event.opportunity_id = attachment.opportunity_id
         and event.event_type = 'converted_to_project'
       order by event.id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          conversion_event.company_id::text || ':'
          || conversion_event.project_id::text || ':'
          || attachment.content_sha256,
          0
        )
      );

      reactivated := false;
      update public.email_conversion_photo_jobs job
         set source_content_sha256 = attachment.content_sha256,
             source_verified_size_bytes = attachment.verified_size_bytes,
             operation = 'materialize',
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
       where job.conversion_event_id = conversion_event.id
         and job.email_attachment_id = attachment.id
         and (
           job.operation = 'revoke'
           or job.status in ('revoked', 'failed', 'skipped')
         )
         and not exists (
           select 1
             from public.email_conversion_photo_jobs competing_job
            where competing_job.company_id = conversion_event.company_id
              and competing_job.project_id = conversion_event.project_id
              and competing_job.source_content_sha256 = attachment.content_sha256
              and competing_job.operation = 'materialize'
              and competing_job.id <> job.id
         )
      returning true into reactivated;

      if not coalesce(reactivated, false) then
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
        ) values (
          conversion_event.company_id,
          conversion_event.id,
          attachment.id,
          conversion_event.opportunity_id,
          conversion_event.project_id,
          attachment.content_sha256,
          attachment.verified_size_bytes,
          'materialize',
          'pending',
          now()
        )
        on conflict do nothing;
      end if;
    end loop;
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
  where attachment.company_id = new.company_id
    and attachment.opportunity_id = new.opportunity_id
    and private.email_conversion_photo_source_is_eligible(attachment.id)
  order by attachment.occurred_at, attachment.id
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_conversion_event_email_photos()
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_related_email_conversion_photo_sources(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_content_sha256 text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  related_attachment record;
begin
  if p_company_id is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or (
      p_opportunity_id is null
      and (p_connection_id is null or p_provider_thread_id is null)
    )
  then
    return;
  end if;

  for related_attachment in
    select related_attachment.id
      from public.email_attachments as related_attachment
     where related_attachment.company_id = p_company_id
       and related_attachment.content_sha256 is not distinct from p_content_sha256
       and (
         (
           p_opportunity_id is not null
           and related_attachment.opportunity_id is not distinct from p_opportunity_id
         )
         or (
           p_connection_id is not null
           and p_provider_thread_id is not null
           and related_attachment.connection_id = p_connection_id
           and related_attachment.provider_thread_id is not distinct from p_provider_thread_id
         )
       )
     order by related_attachment.occurred_at, related_attachment.id
  loop
    perform private.reconcile_email_attachment_conversion_photo(related_attachment.id);
  end loop;
end;
$function$;

revoke all on function private.reconcile_related_email_conversion_photo_sources(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_email_attachment_conversion_photo_jobs()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.reconcile_related_email_conversion_photo_sources(
    new.company_id,
    new.opportunity_id,
    new.connection_id,
    new.provider_thread_id,
    new.content_sha256
  );

  if tg_op = 'UPDATE'
    and (
      old.company_id is distinct from new.company_id
      or old.opportunity_id is distinct from new.opportunity_id
      or old.connection_id is distinct from new.connection_id
      or old.provider_thread_id is distinct from new.provider_thread_id
      or old.content_sha256 is distinct from new.content_sha256
    )
  then
    perform private.reconcile_related_email_conversion_photo_sources(
      old.company_id,
      old.opportunity_id,
      old.connection_id,
      old.provider_thread_id,
      old.content_sha256
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.reconcile_email_attachment_conversion_photo_jobs()
  from public, anon, authenticated, service_role;

drop trigger if exists email_attachments_enqueue_converted_project_photo
  on public.email_attachments;

create trigger email_attachments_enqueue_converted_project_photo
after insert or update of
  company_id,
  connection_id,
  provider_thread_id,
  message_id,
  activity_id,
  opportunity_id,
  occurred_at,
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

  for linked_attachment in
    select distinct
      attachment.company_id,
      attachment.opportunity_id,
      attachment.connection_id,
      attachment.provider_thread_id,
      attachment.content_sha256
      from public.email_attachments attachment
     where attachment.activity_id = new.id
     order by
       attachment.company_id,
       attachment.opportunity_id,
       attachment.connection_id,
       attachment.provider_thread_id,
       attachment.content_sha256
  loop
    perform private.reconcile_related_email_conversion_photo_sources(
      linked_attachment.company_id,
      linked_attachment.opportunity_id,
      linked_attachment.connection_id,
      linked_attachment.provider_thread_id,
      linked_attachment.content_sha256
    );
  end loop;

  return new;
end;
$function$;

revoke all on function private.revoke_email_conversion_photos_for_activity_change()
  from public, anon, authenticated, service_role;

-- Converge existing rows before the concurrency guard is installed. Revocation
-- hides mapped photos transactionally and delegates physical object deletion
-- to the existing indefinitely retryable cleanup ledger.
do $function$
declare
  revoked_job_ids uuid[] := '{}'::uuid[];
begin
  with invalid_jobs as (
    select job.id
      from public.email_conversion_photo_jobs job
     where job.operation = 'materialize'
       and not private.email_conversion_photo_source_is_eligible(job.email_attachment_id)
  ),
  eligible_ranked as (
    select
      job.id,
      row_number() over (
        partition by job.company_id, job.project_id, job.source_content_sha256
        order by attachment.occurred_at, attachment.id, job.id
      ) as source_rank
      from public.email_conversion_photo_jobs job
      join public.email_attachments attachment
        on attachment.id = job.email_attachment_id
     where job.operation = 'materialize'
       and private.email_conversion_photo_source_is_eligible(job.email_attachment_id)
  ),
  revoke_candidates as (
    select invalid_jobs.id from invalid_jobs
    union
    select eligible_ranked.id
      from eligible_ranked
     where eligible_ranked.source_rank > 1
  )
  select coalesce(array_agg(revoke_candidates.id order by revoke_candidates.id), '{}'::uuid[])
    into revoked_job_ids
    from revoke_candidates;

  perform private.revoke_email_conversion_photo_jobs(revoked_job_ids);
end;
$function$;

create unique index email_conversion_photo_jobs_active_project_hash_unique
  on public.email_conversion_photo_jobs
    (company_id, project_id, source_content_sha256)
  where operation = 'materialize';

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
    or not private.email_conversion_photo_source_is_eligible(attachment.id)
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

commit;
