-- External intake attachment visibility, project projection, and privacy erasure.
--
-- Accepted website files remain private. Authorized OPS readers receive only
-- allowlisted descriptors and same-origin capability routes; storage keys,
-- object versions, inspection evidence, and scanner state never cross the
-- database boundary.

do $$
begin
  if to_regclass('private.external_intake_submissions') is null
    or to_regclass('private.external_intake_submission_uploads') is null
    or to_regclass('private.external_intake_upload_intents') is null
    or to_regclass('private.external_intake_inspection_jobs') is null
    or to_regclass('private.external_intake_delivery_objects') is null
    or to_regprocedure(
      'public.authorize_opportunity_action_as_system(uuid,uuid,text)'
    ) is null
    or to_regprocedure(
      'private.append_external_lead_projection_foundation(uuid,uuid,smallint,text,jsonb,jsonb,timestamp with time zone)'
    ) is null
    or to_regprocedure('public.get_opportunity_assigned_context(uuid)') is null
  then
    raise exception 'external_intake_lead_file_prerequisites_missing'
      using errcode = '55000';
  end if;
end
$$;

create table private.external_intake_project_file_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  project_id uuid not null
    references public.projects (id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  submission_id uuid not null,
  intent_id uuid not null,
  delivery_object_id uuid not null
    references private.external_intake_delivery_objects (id) on delete restrict,
  representation text not null,
  filename text not null,
  detected_content_type text not null,
  size_bytes bigint not null,
  storage_object_key text not null,
  object_version_id text not null,
  state text not null default 'visible',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  constraint external_intake_project_file_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_project_file_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_project_file_identity_key
    unique (project_id, intent_id),
  constraint external_intake_project_file_project_opportunity_key
    unique (project_id, opportunity_id, intent_id),
  constraint external_intake_project_file_representation_check
    check (representation in ('safe_image', 'download_document')),
  constraint external_intake_project_file_filename_check
    check (
      char_length(filename) between 1 and 255
      and filename = btrim(filename)
      and filename !~ '[[:cntrl:]]'
      and strpos(filename, '/') = 0
      and strpos(filename, chr(92)) = 0
      and filename not in ('.', '..')
    ),
  constraint external_intake_project_file_content_type_check
    check (
      char_length(detected_content_type) between 1 and 255
      and detected_content_type = lower(btrim(detected_content_type))
      and detected_content_type !~ '[[:cntrl:]]'
    ),
  constraint external_intake_project_file_size_check
    check (size_bytes between 1 and 26214400),
  constraint external_intake_project_file_object_check
    check (
      char_length(object_version_id) between 1 and 1024
      and object_version_id !~ '[[:cntrl:]]'
      and (
        (
          representation = 'safe_image'
          and storage_object_key
            ~ '^safe-derivative/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
          and detected_content_type like 'image/%'
        )
        or (
          representation = 'download_document'
          and storage_object_key
            ~ '^accepted-original/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
        )
      )
    ),
  constraint external_intake_project_file_state_check
    check (state in ('visible', 'delete_pending', 'deleted')),
  constraint external_intake_project_file_deletion_check
    check (
      (state = 'deleted' and deleted_at is not null)
      or (state <> 'deleted' and deleted_at is null)
    )
);

create index external_intake_project_files_project_idx
  on private.external_intake_project_file_relationships (
    company_id,
    project_id,
    created_at desc
  )
  where state = 'visible';

create table private.external_intake_project_file_projection_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  project_id uuid not null
    references public.projects (id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  submission_id uuid not null,
  intent_id uuid not null,
  state text not null default 'pending',
  attempt_count integer not null default 0,
  lease_generation bigint not null default 0,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  last_safe_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_project_file_outbox_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_project_file_outbox_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_project_file_outbox_identity_key
    unique (project_id, intent_id),
  constraint external_intake_project_file_outbox_state_check
    check (state in ('pending', 'processing', 'complete')),
  constraint external_intake_project_file_outbox_counter_check
    check (attempt_count >= 0 and lease_generation >= 0),
  constraint external_intake_project_file_outbox_lease_check
    check (
      (
        state = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        state <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint external_intake_project_file_outbox_completion_check
    check (
      (state = 'complete' and completed_at is not null)
      or (state <> 'complete' and completed_at is null)
    ),
  constraint external_intake_project_file_outbox_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[a-z][a-z0-9_]{0,63}$'
    )
);

create index external_intake_project_file_outbox_claim_idx
  on private.external_intake_project_file_projection_outbox (
    state,
    available_at,
    lease_expires_at,
    created_at
  )
  where state <> 'complete';

create table private.external_intake_legal_holds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  submission_id uuid not null,
  authority text not null,
  scope text not null,
  reason text not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint external_intake_legal_hold_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_legal_hold_authority_check
    check (
      char_length(authority) between 1 and 255
      and authority = btrim(authority)
      and authority !~ '[[:cntrl:]]'
    ),
  constraint external_intake_legal_hold_scope_check
    check (
      scope in ('submission', 'company')
    ),
  constraint external_intake_legal_hold_reason_check
    check (
      char_length(reason) between 1 and 2048
      and reason = btrim(reason)
      and reason !~ '[[:cntrl:]]'
    ),
  constraint external_intake_legal_hold_expiry_check
    check (expires_at > created_at),
  constraint external_intake_legal_hold_release_check
    check (released_at is null or released_at >= created_at)
);

create index external_intake_legal_holds_active_idx
  on private.external_intake_legal_holds (
    company_id,
    submission_id,
    expires_at
  )
  where released_at is null;

create table private.external_intake_erasure_outbox (
  id uuid primary key default gen_random_uuid(),
  public_erasure_id uuid not null default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  submission_id uuid not null,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  requested_by_user_id uuid not null
    references public.users (id) on delete restrict,
  authority text not null,
  reason text not null,
  state text not null default 'blocked',
  not_before timestamptz not null,
  attempt_count integer not null default 0,
  lease_generation bigint not null default 0,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  invalidation_reference text,
  last_safe_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_erasure_public_key unique (public_erasure_id),
  constraint external_intake_erasure_submission_key unique (submission_id),
  constraint external_intake_erasure_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_erasure_authority_check
    check (
      char_length(authority) between 1 and 255
      and authority = btrim(authority)
      and authority !~ '[[:cntrl:]]'
    ),
  constraint external_intake_erasure_reason_check
    check (
      char_length(reason) between 1 and 2048
      and reason = btrim(reason)
      and reason !~ '[[:cntrl:]]'
    ),
  constraint external_intake_erasure_state_check
    check (state in ('blocked', 'processing', 'complete')),
  constraint external_intake_erasure_counter_check
    check (attempt_count >= 0 and lease_generation >= 0),
  constraint external_intake_erasure_lease_check
    check (
      (
        state = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        state <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint external_intake_erasure_completion_check
    check (
      (state = 'complete' and completed_at is not null)
      or (state <> 'complete' and completed_at is null)
    ),
  constraint external_intake_erasure_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[a-z][a-z0-9_]{0,63}$'
    )
);

create index external_intake_erasure_claim_idx
  on private.external_intake_erasure_outbox (
    state,
    not_before,
    available_at,
    lease_expires_at,
    created_at
  )
  where state <> 'complete';

create table private.external_intake_upload_erasure_write_tokens (
  transaction_id bigint not null,
  backend_pid integer not null,
  intent_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (transaction_id, backend_pid, intent_id)
);

create or replace function private.guard_external_intake_upload_transition()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_erasure_token boolean := false;
begin
  if new.caller_file_id is distinct from old.caller_file_id
    or new.original_filename is distinct from old.original_filename
    or new.expected_checksum_sha256
      is distinct from old.expected_checksum_sha256
    or (
      old.object_version_id is not null
      and new.observed_checksum_sha256
        is distinct from old.observed_checksum_sha256
    )
  then
    delete from private.external_intake_upload_erasure_write_tokens token
    where token.transaction_id = txid_current()
      and token.backend_pid = pg_backend_pid()
      and token.intent_id = old.id
    returning true into v_erasure_token;

    if not found
      or not coalesce(v_erasure_token, false)
      or new.caller_file_id <> 'erased:' || old.id::text
      or new.original_filename <> 'privacy-erased'
      or new.expected_checksum_sha256 is not null
      or new.observed_checksum_sha256 is not null
      or new.state <> old.state
    then
      raise exception 'external_intake_upload_identity_immutable'
        using errcode = '42501';
    end if;
  end if;

  if new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.batch_id is distinct from old.batch_id
    or new.public_upload_id is distinct from old.public_upload_id
    or new.ordinal is distinct from old.ordinal
    or (
      not v_erasure_token
      and (
        new.caller_file_id is distinct from old.caller_file_id
        or new.original_filename is distinct from old.original_filename
        or new.expected_checksum_sha256
          is distinct from old.expected_checksum_sha256
      )
    )
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.declared_content_type is distinct from old.declared_content_type
    or new.storage_object_key is distinct from old.storage_object_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'external_intake_upload_identity_immutable'
      using errcode = '42501';
  end if;

  if old.object_version_id is not null
    and (
      new.object_version_id is distinct from old.object_version_id
      or new.observed_size_bytes is distinct from old.observed_size_bytes
      or (
        not v_erasure_token
        and new.observed_checksum_sha256
          is distinct from old.observed_checksum_sha256
      )
      or new.uploaded_at is distinct from old.uploaded_at
    )
  then
    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if new.state <> old.state
    and not (
      (old.state = 'issued' and new.state in ('uploaded', 'expired'))
      or (
        old.state = 'uploaded'
        and new.state in ('claimed', 'closed_missing', 'expired')
      )
      or (
        old.state = 'claimed'
        and new.state in ('pending_inspection', 'closed_missing', 'expired')
      )
      or (
        old.state = 'pending_inspection'
        and new.state in ('accepted', 'rejected', 'closed_missing', 'expired')
      )
    )
  then
    raise exception 'external_intake_upload_transition_invalid'
      using errcode = '23514';
  end if;

  if (
      new.capability_expires_at is distinct from old.capability_expires_at
      or new.delete_not_before is distinct from old.delete_not_before
    )
    and old.state <> 'issued'
  then
    raise exception 'external_intake_upload_capability_immutable'
      using errcode = '42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

-- Projection enqueue -------------------------------------------------------

create or replace function private.enqueue_external_intake_project_files(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id uuid,
  p_intent_id uuid default null
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_count integer;
begin
  if p_company_id is null
    or p_opportunity_id is null
    or p_project_id is null
  then
    raise exception 'external_intake_project_file_enqueue_invalid'
      using errcode = '22023';
  end if;

  insert into private.external_intake_project_file_projection_outbox (
    company_id,
    project_id,
    opportunity_id,
    submission_id,
    intent_id
  )
  select
    submission.company_id,
    p_project_id,
    submission.opportunity_id,
    submission.id,
    upload.intent_id
  from private.external_intake_submissions submission
  join private.external_intake_submission_uploads upload
    on upload.submission_id = submission.id
   and upload.company_id = submission.company_id
  where submission.company_id = p_company_id
    and submission.opportunity_id = p_opportunity_id
    and (p_intent_id is null or upload.intent_id = p_intent_id)
    and not exists (
      select 1
      from private.external_intake_erasure_outbox erasure
      where erasure.submission_id = submission.id
    )
  on conflict (project_id, intent_id) do update
  set available_at = least(
        private.external_intake_project_file_projection_outbox.available_at,
        excluded.available_at
      ),
      updated_at = clock_timestamp()
  where private.external_intake_project_file_projection_outbox.state
    <> 'complete';

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function private.enqueue_external_intake_project_files_from_opportunity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.project_ref is not null
    and (
      tg_op = 'INSERT'
      or old.project_ref is distinct from new.project_ref
    )
  then
    perform private.enqueue_external_intake_project_files(
      new.company_id,
      new.id,
      new.project_ref,
      null
    );
  end if;
  return new;
end;
$function$;

create trigger external_intake_project_files_on_opportunity_link
after insert or update of project_ref on public.opportunities
for each row execute function
  private.enqueue_external_intake_project_files_from_opportunity();

create or replace function private.enqueue_external_intake_project_file_on_accept()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_submission private.external_intake_submissions%rowtype;
  v_project_id uuid;
begin
  if new.state <> 'accepted'
    or (tg_op = 'UPDATE' and old.state = 'accepted')
  then
    return new;
  end if;

  select submission.*
  into v_submission
  from private.external_intake_submission_uploads upload
  join private.external_intake_submissions submission
    on submission.id = upload.submission_id
   and submission.company_id = upload.company_id
  where upload.intent_id = new.id;

  if not found then
    return new;
  end if;

  select opportunity.project_ref
  into v_project_id
  from public.opportunities opportunity
  where opportunity.id = v_submission.opportunity_id
    and opportunity.company_id = v_submission.company_id
    and opportunity.deleted_at is null;

  if v_project_id is not null then
    perform private.enqueue_external_intake_project_files(
      v_submission.company_id,
      v_submission.opportunity_id,
      v_project_id,
      new.id
    );
  end if;
  return new;
end;
$function$;

create trigger external_intake_project_file_on_attachment_accept
after update of state on private.external_intake_upload_intents
for each row execute function
  private.enqueue_external_intake_project_file_on_accept();

-- Projection worker boundary ----------------------------------------------

create or replace function public.claim_external_intake_project_file_projections_as_system(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 360
) returns table (
  id uuid,
  company_id uuid,
  project_id uuid,
  opportunity_id uuid,
  submission_id uuid,
  intent_id uuid,
  attempt_count integer,
  lease_generation bigint,
  lease_token uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_project_file_claim_denied'
      using errcode = '42501';
  end if;
  if p_worker_id is null
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    or p_limit not between 1 and 25
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_project_file_claim_invalid'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select job.id
    from private.external_intake_project_file_projection_outbox job
    where job.state <> 'complete'
      and job.available_at <= clock_timestamp()
      and (
        job.state = 'pending'
        or job.lease_expires_at <= clock_timestamp()
      )
      and not exists (
        select 1
        from private.external_intake_erasure_outbox erasure
        where erasure.submission_id = job.submission_id
      )
    order by job.available_at, job.created_at, job.id
    for update skip locked
    limit p_limit
  )
  update private.external_intake_project_file_projection_outbox job
  set state = 'processing',
      attempt_count = job.attempt_count + 1,
      lease_generation = job.lease_generation + 1,
      lease_owner = p_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at =
        clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  from candidates
  where job.id = candidates.id
  returning
    job.id,
    job.company_id,
    job.project_id,
    job.opportunity_id,
    job.submission_id,
    job.intent_id,
    job.attempt_count,
    job.lease_generation,
    job.lease_token;
end;
$function$;

create or replace function public.finish_external_intake_project_file_projection_as_system(
  p_job_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_outcome text,
  p_safe_code text default null,
  p_available_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_job private.external_intake_project_file_projection_outbox%rowtype;
  v_intent private.external_intake_upload_intents%rowtype;
  v_inspection private.external_intake_inspection_jobs%rowtype;
  v_delivery private.external_intake_delivery_objects%rowtype;
  v_representation text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_project_file_finish_denied'
      using errcode = '42501';
  end if;
  if p_job_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation <= 0
    or p_lease_token is null
    or p_outcome not in ('project', 'retry')
    or (
      p_outcome = 'retry'
      and (
        p_safe_code is null
        or p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
        or p_available_at is null
      )
    )
  then
    raise exception 'external_intake_project_file_finish_invalid'
      using errcode = '22023';
  end if;

  select job.*
  into v_job
  from private.external_intake_project_file_projection_outbox job
  where job.id = p_job_id
  for update;

  if not found
    or v_job.state <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_generation <> p_generation
    or v_job.lease_token <> p_lease_token
  then
    return jsonb_build_object('status', 'stale');
  end if;

  if p_outcome = 'retry' then
    update private.external_intake_project_file_projection_outbox job
    set state = 'pending',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        available_at = p_available_at,
        last_safe_code = p_safe_code,
        updated_at = clock_timestamp()
    where job.id = v_job.id;
    return jsonb_build_object('status', 'retrying');
  end if;

  if exists (
    select 1
    from private.external_intake_erasure_outbox erasure
    where erasure.submission_id = v_job.submission_id
  ) then
    update private.external_intake_project_file_projection_outbox job
    set state = 'complete',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        completed_at = clock_timestamp(),
        last_safe_code = 'privacy_blocked',
        updated_at = clock_timestamp()
    where job.id = v_job.id;
    return jsonb_build_object('status', 'blocked');
  end if;

  select intent.*
  into v_intent
  from private.external_intake_upload_intents intent
  where intent.id = v_job.intent_id
    and intent.company_id = v_job.company_id
    and intent.state = 'accepted';

  if not found then
    update private.external_intake_project_file_projection_outbox job
    set state = 'pending',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        available_at = clock_timestamp() + interval '5 minutes',
        last_safe_code = 'attachment_pending',
        updated_at = clock_timestamp()
    where job.id = v_job.id;
    return jsonb_build_object('status', 'retrying');
  end if;

  select inspection.*
  into v_inspection
  from private.external_intake_inspection_jobs inspection
  where inspection.intent_id = v_job.intent_id
    and inspection.company_id = v_job.company_id
    and inspection.status = 'complete'
  order by inspection.generation desc, inspection.created_at desc
  limit 1;

  if not found then
    raise exception 'external_intake_project_file_source_invalid'
      using errcode = '55000';
  end if;

  v_representation := case
    when v_inspection.detected_content_type like 'image/%'
      then 'safe_image'
    else 'download_document'
  end;

  select delivery.*
  into v_delivery
  from private.external_intake_delivery_objects delivery
  where delivery.inspection_id = v_inspection.id
    and delivery.generation = v_inspection.generation
    and delivery.intent_id = v_job.intent_id
    and delivery.company_id = v_job.company_id
    and delivery.delivery_mode = case
      when v_representation = 'safe_image' then 'inline_image'
      else 'attachment'
    end
    and delivery.state = 'published'
  limit 1;

  if not found
    or v_delivery.object_version_id is null
    or v_delivery.size_bytes is null
  then
    raise exception 'external_intake_project_file_delivery_invalid'
      using errcode = '55000';
  end if;

  insert into private.external_intake_project_file_relationships (
    company_id,
    project_id,
    opportunity_id,
    submission_id,
    intent_id,
    delivery_object_id,
    representation,
    filename,
    detected_content_type,
    size_bytes,
    storage_object_key,
    object_version_id
  ) values (
    v_job.company_id,
    v_job.project_id,
    v_job.opportunity_id,
    v_job.submission_id,
    v_job.intent_id,
    v_delivery.id,
    v_representation,
    v_intent.original_filename,
    v_inspection.detected_content_type,
    v_delivery.size_bytes,
    v_delivery.storage_object_key,
    v_delivery.object_version_id
  )
  on conflict (project_id, intent_id) do update
  set delivery_object_id = excluded.delivery_object_id,
      representation = excluded.representation,
      filename = excluded.filename,
      detected_content_type = excluded.detected_content_type,
      size_bytes = excluded.size_bytes,
      storage_object_key = excluded.storage_object_key,
      object_version_id = excluded.object_version_id,
      updated_at = clock_timestamp()
  where private.external_intake_project_file_relationships.state = 'visible'
    and private.external_intake_project_file_relationships.company_id
      = excluded.company_id
    and private.external_intake_project_file_relationships.opportunity_id
      = excluded.opportunity_id
    and private.external_intake_project_file_relationships.submission_id
      = excluded.submission_id;

  perform 1
  from private.external_intake_project_file_relationships relationship
  where relationship.project_id = v_job.project_id
    and relationship.intent_id = v_job.intent_id
    and relationship.company_id = v_job.company_id
    and relationship.opportunity_id = v_job.opportunity_id
    and relationship.submission_id = v_job.submission_id
    and relationship.delivery_object_id = v_delivery.id
    and relationship.state = 'visible';
  if not found then
    raise exception 'external_intake_project_file_relationship_conflict'
      using errcode = '23505';
  end if;

  update private.external_intake_project_file_projection_outbox job
  set state = 'complete',
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      completed_at = clock_timestamp(),
      last_safe_code = null,
      updated_at = clock_timestamp()
  where job.id = v_job.id;

  return jsonb_build_object('status', 'complete');
end;
$function$;

-- Guarded descriptor reads -------------------------------------------------

create or replace function private.external_intake_attachment_descriptors(
  p_opportunity_id uuid
) returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', upload.public_upload_id,
        'filename', intent.original_filename,
        'kind', case
          when inspection.detected_content_type like 'image/%'
            then 'image'
          else 'document'
        end,
        'mime_type', inspection.detected_content_type,
        'size_bytes', original.size_bytes,
        'occurred_at', submission.created_at,
        'preview_url', case
          when derivative.id is null then null
          else format(
            '/api/opportunities/%s/intake-attachments/%s?mode=preview',
            submission.opportunity_id,
            upload.public_upload_id
          )
        end,
        'download_url', format(
          '/api/opportunities/%s/intake-attachments/%s?mode=download',
          submission.opportunity_id,
          upload.public_upload_id
        )
      )
      order by submission.created_at desc, upload.ordinal, upload.public_upload_id
    ),
    '[]'::jsonb
  )
  from private.external_intake_submissions submission
  join private.external_intake_submission_uploads upload
    on upload.submission_id = submission.id
   and upload.company_id = submission.company_id
  join private.external_intake_upload_intents intent
    on intent.id = upload.intent_id
   and intent.company_id = upload.company_id
   and intent.state = 'accepted'
  join lateral (
    select accepted.*
    from private.external_intake_inspection_jobs accepted
    where accepted.intent_id = intent.id
      and accepted.company_id = intent.company_id
      and accepted.status = 'complete'
    order by accepted.generation desc, accepted.created_at desc
    limit 1
  ) inspection on true
  join private.external_intake_delivery_objects original
    on original.inspection_id = inspection.id
   and original.generation = inspection.generation
   and original.delivery_mode = 'attachment'
   and original.state = 'published'
   and original.size_bytes is not null
  left join private.external_intake_delivery_objects derivative
    on derivative.inspection_id = inspection.id
   and derivative.generation = inspection.generation
   and derivative.delivery_mode = 'inline_image'
   and derivative.state = 'published'
  where submission.opportunity_id = p_opportunity_id
    and submission.personal_evidence_erased_at is null
    and not exists (
      select 1
      from private.external_intake_erasure_outbox erasure
      where erasure.submission_id = submission.id
    );
$function$;

create or replace function public.resolve_external_intake_attachment_as_system(
  p_actor_user_id uuid,
  p_opportunity_id uuid,
  p_public_upload_id uuid,
  p_mode text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_attachment_resolve_denied'
      using errcode = '42501';
  end if;
  if p_actor_user_id is null
    or p_opportunity_id is null
    or p_public_upload_id is null
    or p_mode not in ('preview', 'download')
  then
    return null;
  end if;
  if not public.authorize_opportunity_action_as_system(
    p_actor_user_id,
    p_opportunity_id,
    'view'
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'storage_object_key', delivery.storage_object_key,
    'delivery_mode', delivery.delivery_mode,
    'filename', intent.original_filename
  )
  into v_result
  from private.external_intake_submissions submission
  join private.external_intake_submission_uploads upload
    on upload.submission_id = submission.id
   and upload.company_id = submission.company_id
  join private.external_intake_upload_intents intent
    on intent.id = upload.intent_id
   and intent.company_id = upload.company_id
   and intent.state = 'accepted'
  join lateral (
    select accepted.*
    from private.external_intake_inspection_jobs accepted
    where accepted.intent_id = intent.id
      and accepted.company_id = intent.company_id
      and accepted.status = 'complete'
    order by accepted.generation desc, accepted.created_at desc
    limit 1
  ) inspection on true
  join private.external_intake_delivery_objects delivery
    on delivery.inspection_id = inspection.id
   and delivery.generation = inspection.generation
   and delivery.intent_id = intent.id
   and delivery.company_id = intent.company_id
   and delivery.delivery_mode = case
     when p_mode = 'preview' then 'inline_image'
     else 'attachment'
   end
   and delivery.state = 'published'
  where submission.opportunity_id = p_opportunity_id
    and upload.public_upload_id = p_public_upload_id
    and submission.personal_evidence_erased_at is null
    and not exists (
      select 1
      from private.external_intake_erasure_outbox erasure
      where erasure.submission_id = submission.id
    )
  limit 1;

  return v_result;
end;
$function$;

create or replace function public.list_project_intake_files(
  p_project_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if p_project_id is null
    or not private.current_user_can_view_project(p_project_id)
  then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', relationship.id,
        'filename', relationship.filename,
        'mime_type', relationship.detected_content_type,
        'size_bytes', relationship.size_bytes,
        'source_opportunity_id', relationship.opportunity_id,
        'updated_at', relationship.updated_at,
        'download_url', format(
          '/api/opportunities/%s/intake-attachments/%s?mode=download',
          relationship.opportunity_id,
          upload.public_upload_id
        )
      )
      order by relationship.updated_at desc, relationship.id
    ),
    '[]'::jsonb
  )
  into v_result
  from private.external_intake_project_file_relationships relationship
  join private.external_intake_submission_uploads upload
    on upload.submission_id = relationship.submission_id
   and upload.intent_id = relationship.intent_id
   and upload.company_id = relationship.company_id
  where relationship.project_id = p_project_id
    and relationship.state = 'visible'
    and not exists (
      select 1
      from private.external_intake_erasure_outbox erasure
      where erasure.submission_id = relationship.submission_id
    );

  return v_result;
end;
$function$;

-- Extend the existing guarded context without duplicating its allowlist.
alter function public.get_opportunity_assigned_context(uuid)
  rename to get_opportunity_assigned_context_without_intake;
alter function public.get_opportunity_assigned_context_without_intake(uuid)
  set schema private;
revoke all on function
  private.get_opportunity_assigned_context_without_intake(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_opportunity_assigned_context(
  p_opportunity_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context :=
    private.get_opportunity_assigned_context_without_intake(p_opportunity_id);
  return v_context || jsonb_build_object(
    'intake_attachments',
    private.external_intake_attachment_descriptors(p_opportunity_id)
  );
end;
$function$;

-- Privacy erasure ----------------------------------------------------------

create or replace function public.request_external_intake_erasure_as_system(
  p_submission_id uuid,
  p_requested_by_user_id uuid,
  p_authority text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_submission private.external_intake_submissions%rowtype;
  v_request private.external_intake_erasure_outbox%rowtype;
  v_not_before timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_erasure_request_denied'
      using errcode = '42501';
  end if;
  if p_submission_id is null
    or p_requested_by_user_id is null
    or p_authority is null
    or char_length(btrim(p_authority)) not between 1 and 255
    or p_reason is null
    or char_length(btrim(p_reason)) not between 1 and 2048
  then
    raise exception 'external_intake_erasure_request_invalid'
      using errcode = '22023';
  end if;

  select submission.*
  into v_submission
  from private.external_intake_submissions submission
  where submission.id = p_submission_id
  for update;
  if not found
    or not public.authorize_opportunity_action_as_system(
      p_requested_by_user_id,
      v_submission.opportunity_id,
      'edit'
    )
    or not public.has_permission(
      p_requested_by_user_id,
      'pipeline.manage',
      'all'
    )
  then
    raise exception 'external_intake_erasure_request_denied'
      using errcode = '42501';
  end if;

  select greatest(
    clock_timestamp() + interval '6 minutes',
    coalesce(max(intent.delete_not_before), clock_timestamp())
  )
  into v_not_before
  from private.external_intake_submission_uploads upload
  join private.external_intake_upload_intents intent
    on intent.id = upload.intent_id
   and intent.company_id = upload.company_id
  where upload.submission_id = v_submission.id;

  insert into private.external_intake_erasure_outbox (
    company_id,
    submission_id,
    opportunity_id,
    requested_by_user_id,
    authority,
    reason,
    not_before,
    available_at
  ) values (
    v_submission.company_id,
    v_submission.id,
    v_submission.opportunity_id,
    p_requested_by_user_id,
    btrim(p_authority),
    btrim(p_reason),
    v_not_before,
    v_not_before
  )
  on conflict (submission_id) do nothing;

  update private.external_intake_project_file_relationships relationship
  set state = 'delete_pending',
      updated_at = clock_timestamp()
  where relationship.submission_id = v_submission.id
    and relationship.state = 'visible';

  select request.*
  into v_request
  from private.external_intake_erasure_outbox request
  where request.submission_id = v_submission.id;

  return jsonb_build_object(
    'public_erasure_id', v_request.public_erasure_id,
    'state', v_request.state,
    'not_before', v_request.not_before
  );
end;
$function$;

create or replace function public.claim_external_intake_erasures_as_system(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 360
) returns table (
  id uuid,
  submission_id uuid,
  company_id uuid,
  opportunity_id uuid,
  attempt_count integer,
  lease_generation bigint,
  lease_token uuid,
  invalidation_reference text,
  storage_objects jsonb,
  invalidation_paths jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_erasure_claim_denied'
      using errcode = '42501';
  end if;
  if p_worker_id is null
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    or p_limit not between 1 and 25
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'external_intake_erasure_claim_invalid'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select request.id
    from private.external_intake_erasure_outbox request
    where request.state <> 'complete'
      and request.not_before <= clock_timestamp()
      and request.available_at <= clock_timestamp()
      and (
        request.state = 'blocked'
        or request.lease_expires_at <= clock_timestamp()
      )
      and not exists (
        select 1
        from private.external_intake_legal_holds hold
        where hold.company_id = request.company_id
          and (
            hold.submission_id = request.submission_id
            or hold.scope = 'company'
          )
          and hold.released_at is null
          and hold.expires_at > clock_timestamp()
      )
    order by request.available_at, request.created_at, request.id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update private.external_intake_erasure_outbox request
    set state = 'processing',
        attempt_count = request.attempt_count + 1,
        lease_generation = request.lease_generation + 1,
        lease_owner = p_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at =
          clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    from candidates
    where request.id = candidates.id
    returning request.*
  )
  select
    claimed.id,
    claimed.submission_id,
    claimed.company_id,
    claimed.opportunity_id,
    claimed.attempt_count,
    claimed.lease_generation,
    claimed.lease_token,
    claimed.invalidation_reference,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'object_key', object_row.object_key,
            'object_version_id', object_row.object_version_id
          )
          order by object_row.object_key, object_row.object_version_id
        )
        from (
          select
            intent.storage_object_key as object_key,
            intent.object_version_id
          from private.external_intake_submission_uploads upload
          join private.external_intake_upload_intents intent
            on intent.id = upload.intent_id
           and intent.company_id = upload.company_id
          where upload.submission_id = claimed.submission_id
            and intent.object_version_id is not null
          union
          select
            delivery.storage_object_key,
            delivery.object_version_id
          from private.external_intake_submission_uploads upload
          join private.external_intake_delivery_objects delivery
            on delivery.intent_id = upload.intent_id
           and delivery.company_id = upload.company_id
          where upload.submission_id = claimed.submission_id
            and delivery.object_version_id is not null
            and delivery.state <> 'deleted'
        ) object_row
      ),
      '[]'::jsonb
    ) as storage_objects,
    coalesce(
      (
        select jsonb_agg(
          to_jsonb('/' || path.storage_object_key)
          order by path.storage_object_key
        )
        from (
          select distinct delivery.storage_object_key
          from private.external_intake_submission_uploads upload
          join private.external_intake_delivery_objects delivery
            on delivery.intent_id = upload.intent_id
           and delivery.company_id = upload.company_id
          where upload.submission_id = claimed.submission_id
            and delivery.state <> 'deleted'
        ) path
      ),
      '[]'::jsonb
    ) as invalidation_paths
  from claimed;
end;
$function$;

create or replace function public.finish_external_intake_erasure_as_system(
  p_erasure_id uuid,
  p_worker_id text,
  p_generation bigint,
  p_lease_token uuid,
  p_outcome text,
  p_invalidation_reference text default null,
  p_safe_code text default null,
  p_available_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_request private.external_intake_erasure_outbox%rowtype;
  v_submission private.external_intake_submissions%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'external_intake_erasure_finish_denied'
      using errcode = '42501';
  end if;
  if p_erasure_id is null
    or p_worker_id is null
    or p_generation is null
    or p_generation <= 0
    or p_lease_token is null
    or p_outcome not in ('deleted', 'retry')
    or (
      p_outcome = 'deleted'
      and (
        p_invalidation_reference is null
        or char_length(p_invalidation_reference) not between 1 and 1024
      )
    )
    or (
      p_outcome = 'retry'
      and (
        p_safe_code is null
        or p_safe_code !~ '^[a-z][a-z0-9_]{0,63}$'
        or p_available_at is null
      )
    )
  then
    raise exception 'external_intake_erasure_finish_invalid'
      using errcode = '22023';
  end if;

  select request.*
  into v_request
  from private.external_intake_erasure_outbox request
  where request.id = p_erasure_id
  for update;

  if not found
    or v_request.state <> 'processing'
    or v_request.lease_owner <> p_worker_id
    or v_request.lease_generation <> p_generation
    or v_request.lease_token <> p_lease_token
  then
    return false;
  end if;

  if p_outcome = 'retry' then
    update private.external_intake_erasure_outbox request
    set state = 'blocked',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        available_at = p_available_at,
        invalidation_reference = coalesce(
          p_invalidation_reference,
          request.invalidation_reference
        ),
        last_safe_code = p_safe_code,
        updated_at = clock_timestamp()
    where request.id = v_request.id;
    return true;
  end if;

  if exists (
    select 1
    from private.external_intake_legal_holds hold
    where hold.company_id = v_request.company_id
      and (
        hold.submission_id = v_request.submission_id
        or hold.scope = 'company'
      )
      and hold.released_at is null
      and hold.expires_at > clock_timestamp()
  ) then
    raise exception 'external_intake_erasure_legal_hold'
      using errcode = '55000';
  end if;

  update private.external_intake_delivery_objects delivery
  set state = 'deleted',
      size_bytes = null,
      checksum_sha256 = null,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      deleted_at = coalesce(delivery.deleted_at, clock_timestamp()),
      last_safe_code = 'privacy_erased',
      updated_at = clock_timestamp()
  where delivery.intent_id in (
    select upload.intent_id
    from private.external_intake_submission_uploads upload
    where upload.submission_id = v_request.submission_id
  )
    and delivery.state <> 'deleted';

  delete from private.external_intake_project_file_relationships relationship
  where relationship.submission_id = v_request.submission_id;

  delete from private.external_intake_project_file_projection_outbox job
  where job.submission_id = v_request.submission_id;

  insert into private.external_intake_upload_erasure_write_tokens (
    transaction_id,
    backend_pid,
    intent_id
  )
  select
    txid_current(),
    pg_backend_pid(),
    upload.intent_id
  from private.external_intake_submission_uploads upload
  where upload.submission_id = v_request.submission_id
  on conflict do nothing;

  update private.external_intake_upload_intents intent
  set caller_file_id = 'erased:' || intent.id::text,
      original_filename = 'privacy-erased',
      expected_checksum_sha256 = null,
      observed_checksum_sha256 = null,
      updated_at = clock_timestamp()
  where intent.id in (
    select upload.intent_id
    from private.external_intake_submission_uploads upload
    where upload.submission_id = v_request.submission_id
  );

  select submission.*
  into v_submission
  from private.external_intake_submissions submission
  where submission.id = v_request.submission_id
  for update;

  if v_submission.personal_evidence_erased_at is null then
    insert into private.external_intake_submission_erasure_write_tokens (
      transaction_id,
      backend_pid,
      submission_id
    ) values (
      txid_current(),
      pg_backend_pid(),
      v_submission.id
    );

    update private.external_intake_submissions submission
    set normalized_email = null,
        normalized_phone = null,
        original_contact = '{"state":"privacy_erased"}'::jsonb,
        original_organization = '{"state":"privacy_erased"}'::jsonb,
        original_work = '{"state":"privacy_erased"}'::jsonb,
        original_service_address = '{"state":"privacy_erased"}'::jsonb,
        ordered_answers = '[]'::jsonb,
        raw_attribution = '{"state":"privacy_erased"}'::jsonb,
        raw_source_payload = '{"state":"privacy_erased"}'::jsonb,
        external_reference = '{"state":"privacy_erased"}'::jsonb,
        personal_evidence_erased_at = clock_timestamp(),
        personal_evidence_tombstone = '{"state":"privacy_erased"}'::jsonb
    where submission.id = v_submission.id;

    perform private.append_external_lead_projection_foundation(
      v_submission.company_id,
      v_submission.opportunity_id,
      1::smallint,
      'deletion',
      '{"state":"privacy_erased"}'::jsonb,
      '{"state":"privacy_erased"}'::jsonb,
      clock_timestamp()
    );
  end if;

  update private.external_intake_erasure_outbox request
  set state = 'complete',
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      invalidation_reference = p_invalidation_reference,
      last_safe_code = null,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where request.id = v_request.id;

  return true;
end;
$function$;

-- Task 10 reserved the erasure token path. Task 12 now makes it genuinely
-- privacy-complete by removing plaintext normalized identifiers and raw source
-- content while retaining only replay digests, canonical request hash, and the
-- non-identifying creation/audit spine.
create or replace function private.guard_external_intake_submission_evidence()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token_consumed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.public_submission_id is distinct from old.public_submission_id
    or new.company_id is distinct from old.company_id
    or new.principal_id is distinct from old.principal_id
    or new.credential_id is distinct from old.credential_id
    or new.source_id is distinct from old.source_id
    or new.form_id is distinct from old.form_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.matched_client_id is distinct from old.matched_client_id
    or new.matched_sub_client_id is distinct from old.matched_sub_client_id
    or new.customer_outcome is distinct from old.customer_outcome
    or new.evidence_schema_version is distinct from old.evidence_schema_version
    or new.canonicalization_version is distinct from old.canonicalization_version
    or new.canonical_request_hash is distinct from old.canonical_request_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  delete from private.external_intake_submission_erasure_write_tokens token
  where token.transaction_id = txid_current()
    and token.backend_pid = pg_backend_pid()
    and token.submission_id = old.id
  returning true into v_token_consumed;

  if not found or not coalesce(v_token_consumed, false) then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  if new.personal_evidence_erased_at is null
    or old.personal_evidence_erased_at is not null
    or new.personal_evidence_tombstone
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.normalized_email is not null
    or new.normalized_phone is not null
    or new.original_contact
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_organization
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_work
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_service_address
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.ordered_answers is distinct from '[]'::jsonb
    or new.raw_attribution
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.raw_source_payload
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.external_reference
      is distinct from '{"state":"privacy_erased"}'::jsonb
  then
    raise exception 'external_intake_submission_erasure_invalid'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- Lock down every private relation and helper.
alter table private.external_intake_project_file_relationships
  enable row level security;
alter table private.external_intake_project_file_projection_outbox
  enable row level security;
alter table private.external_intake_legal_holds
  enable row level security;
alter table private.external_intake_erasure_outbox
  enable row level security;
alter table private.external_intake_upload_erasure_write_tokens
  enable row level security;

revoke all on table private.external_intake_project_file_relationships
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_project_file_projection_outbox
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_legal_holds
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_erasure_outbox
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_upload_erasure_write_tokens
  from public, anon, authenticated, service_role;

revoke all on function private.enqueue_external_intake_project_files(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function
  private.enqueue_external_intake_project_files_from_opportunity()
  from public, anon, authenticated, service_role;
revoke all on function
  private.enqueue_external_intake_project_file_on_accept()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_intake_attachment_descriptors(uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.claim_external_intake_project_file_projections_as_system(
    text, integer, integer
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.claim_external_intake_project_file_projections_as_system(
    text, integer, integer
  )
  to service_role;

revoke all on function
  public.finish_external_intake_project_file_projection_as_system(
    uuid, text, bigint, uuid, text, text, timestamptz
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.finish_external_intake_project_file_projection_as_system(
    uuid, text, bigint, uuid, text, text, timestamptz
  )
  to service_role;

revoke all on function public.resolve_external_intake_attachment_as_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_external_intake_attachment_as_system(
  uuid, uuid, uuid, text
) to service_role;

revoke all on function public.list_project_intake_files(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_intake_files(uuid)
  to anon, authenticated;

revoke all on function public.get_opportunity_assigned_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_opportunity_assigned_context(uuid)
  to anon, authenticated;

revoke all on function public.request_external_intake_erasure_as_system(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_external_intake_erasure_as_system(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.claim_external_intake_erasures_as_system(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_external_intake_erasures_as_system(
  text, integer, integer
) to service_role;

revoke all on function public.finish_external_intake_erasure_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finish_external_intake_erasure_as_system(
  uuid, text, bigint, uuid, text, text, text, timestamptz
) to service_role;

comment on table private.external_intake_project_file_relationships is
  'Private, idempotent project representation of one accepted website attachment. Never writes to the public project-photos bucket.';
comment on table private.external_intake_project_file_projection_outbox is
  'Durable conversion/acceptance convergence queue for private website-file project relationships.';
comment on table private.external_intake_erasure_outbox is
  'Durable privacy-erasure queue. Presence blocks all operator attachment visibility before object deletion begins.';
