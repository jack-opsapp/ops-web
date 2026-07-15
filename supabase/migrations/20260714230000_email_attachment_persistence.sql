-- Durable, private, mailbox-scoped email attachment ingestion.
--
-- Every delivered email activity receives an exact-message scan job even when
-- the provider's hasAttachments flag is false (Gmail/M365 exclude some inline
-- files). Attachment bytes are copied into the private `email-attachments`
-- bucket by the application worker. Canonical rows point to the exact activity;
-- opportunity attribution is validated by the application and fails closed.

begin;

-- ── Canonical attachment rows ───────────────────────────────────────────────

alter table public.email_attachments
  add column if not exists activity_id uuid references public.activities(id) on delete set null,
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null,
  add column if not exists provider_kind text not null default 'file',
  add column if not exists provider_part_id text,
  add column if not exists content_id text,
  add column if not exists is_inline boolean not null default false,
  add column if not exists occurred_at timestamptz,
  add column if not exists detected_mime_type text,
  add column if not exists verified_size_bytes bigint,
  add column if not exists storage_backend text,
  add column if not exists storage_path text,
  add column if not exists content_sha256 text,
  add column if not exists source_url text,
  add column if not exists ingest_status text not null default 'discovered',
  add column if not exists attribution_status text not null default 'pending',
  add column if not exists ingest_attempts integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text,
  add column if not exists stored_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Existing production rows already carry connection_id. This recovery update
-- makes the migration safe for older snapshots that did not.
with candidate_activity as (
  select
    attachment.id as attachment_row_id,
    activity.email_connection_id,
    activity.id as activity_id,
    activity.created_at as occurred_at,
    count(*) over (partition by attachment.id) as candidate_count,
    row_number() over (
      partition by attachment.id order by activity.created_at asc, activity.id asc
    ) as candidate_rank
  from public.email_attachments attachment
  join public.activities activity
    on activity.company_id = attachment.company_id
   and activity.email_message_id = attachment.message_id
   and activity.type = 'email'
   and activity.email_connection_id is not null
   and (
     attachment.connection_id is null
     or activity.email_connection_id = attachment.connection_id
   )
), exact_activity as (
  select *
    from candidate_activity
   where candidate_count = 1 and candidate_rank = 1
)
update public.email_attachments attachment
   set connection_id = coalesce(attachment.connection_id, exact.email_connection_id),
       activity_id = coalesce(attachment.activity_id, exact.activity_id),
       occurred_at = coalesce(attachment.occurred_at, exact.occurred_at)
  from exact_activity exact
 where attachment.id = exact.attachment_row_id;

do $$
begin
  if exists (select 1 from public.email_attachments where connection_id is null) then
    raise exception 'email attachment rows without an owning mailbox must be reconciled before durable ingestion';
  end if;

  if exists (
    select 1
      from public.email_attachments attachment
      join public.email_connections connection on connection.id = attachment.connection_id
     where nullif(connection.company_id, '')::uuid is distinct from attachment.company_id
  ) then
    raise exception 'email attachment row references a mailbox from another company';
  end if;
end;
$$;

alter table public.email_attachments
  alter column connection_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_attachments'::regclass
       and conname = 'email_attachments_connection_id_fkey'
  ) then
    alter table public.email_attachments
      add constraint email_attachments_connection_id_fkey
      foreign key (connection_id) references public.email_connections(id) on delete restrict;
  end if;
end;
$$;

alter table public.email_attachments
  drop constraint if exists email_attachments_provider_kind_check,
  drop constraint if exists email_attachments_ingest_status_check,
  drop constraint if exists email_attachments_attribution_status_check,
  drop constraint if exists email_attachments_verified_size_check,
  drop constraint if exists email_attachments_sha256_check,
  drop constraint if exists email_attachments_storage_backend_check,
  drop constraint if exists email_attachments_attempts_check,
  drop constraint if exists email_attachments_stored_contract_check;

alter table public.email_attachments
  add constraint email_attachments_provider_kind_check
    check (provider_kind in ('file', 'inline', 'item', 'reference')),
  add constraint email_attachments_ingest_status_check
    check (ingest_status in (
      'discovered', 'processing', 'stored', 'external', 'oversized',
      'unavailable', 'retrying', 'failed'
    )),
  add constraint email_attachments_attribution_status_check
    check (attribution_status in ('pending', 'attributed', 'needs_review')),
  add constraint email_attachments_verified_size_check
    check (verified_size_bytes is null or verified_size_bytes >= 0),
  add constraint email_attachments_sha256_check
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint email_attachments_storage_backend_check
    check (storage_backend is null or storage_backend = 'supabase'),
  add constraint email_attachments_attempts_check
    check (ingest_attempts >= 0),
  add constraint email_attachments_stored_contract_check
    check (
      ingest_status <> 'stored'
      or (
        storage_backend = 'supabase'
        and nullif(btrim(storage_path), '') is not null
        and nullif(btrim(content_sha256), '') is not null
        and nullif(btrim(detected_mime_type), '') is not null
        and verified_size_bytes is not null
        and stored_at is not null
      )
    );

create unique index if not exists email_attachments_mailbox_identity_unique
  on public.email_attachments (company_id, connection_id, message_id, attachment_id);

create unique index if not exists email_attachments_storage_path_unique
  on public.email_attachments (storage_backend, storage_path)
  where storage_backend is not null and storage_path is not null;

create index if not exists email_attachments_activity_idx
  on public.email_attachments (activity_id, occurred_at, id)
  where activity_id is not null;

create index if not exists email_attachments_opportunity_idx
  on public.email_attachments (company_id, opportunity_id, occurred_at desc)
  where opportunity_id is not null and attribution_status = 'attributed';

create index if not exists email_attachments_retry_idx
  on public.email_attachments (next_retry_at, updated_at)
  where ingest_status in ('discovered', 'retrying', 'processing');

-- Keep the prior mailbox-agnostic unique constraint through the rolling
-- application deploy. The reviewed post-deploy contract in docs/migrations
-- removes it only after every writer uses the scoped identity above.

-- ── Cost-once inspection identity ──────────────────────────────────────────

alter table public.attachment_inspections
  add column if not exists connection_id uuid references public.email_connections(id) on delete restrict,
  add column if not exists email_attachment_id uuid references public.email_attachments(id) on delete cascade;

update public.attachment_inspections inspection
   set email_attachment_id = attachment.id,
       connection_id = attachment.connection_id
  from public.email_attachments attachment
 where inspection.email_attachment_id is null
   and attachment.company_id = inspection.company_id
   and attachment.message_id = inspection.message_id
   and attachment.attachment_id = inspection.attachment_id;

create unique index if not exists attachment_inspections_attachment_unique
  on public.attachment_inspections (email_attachment_id);

create unique index if not exists attachment_inspections_mailbox_identity_unique
  on public.attachment_inspections (
    company_id, connection_id, message_id, attachment_id
  )
  where connection_id is not null;

-- Vision/PDF analysis retries independently from provider enumeration and
-- private file storage. A stored file scan can complete while this job retries;
-- the immutable email_attachment_id is the cost-once identity.
create table if not exists public.email_attachment_inspection_jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  connection_id       uuid not null references public.email_connections(id) on delete cascade,
  email_attachment_id uuid not null references public.email_attachments(id) on delete cascade,
  generation          bigint not null default 1,
  status              text not null default 'pending',
  attempts            integer not null default 0,
  available_at        timestamptz not null default now(),
  lease_owner         uuid,
  lease_expires_at    timestamptz,
  last_error          text,
  skip_reason         text,
  inspected_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (email_attachment_id),
  constraint email_attachment_inspection_jobs_status_check
    check (status in ('pending', 'processing', 'retrying', 'complete', 'skipped', 'failed')),
  constraint email_attachment_inspection_jobs_attempts_check
    check (attempts >= 0),
  constraint email_attachment_inspection_jobs_lease_check
    check (
      (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
      or status <> 'processing'
    )
);

create index if not exists email_attachment_inspection_jobs_claim_idx
  on public.email_attachment_inspection_jobs (available_at, created_at, id)
  where status in ('pending', 'retrying', 'processing');

create index if not exists email_attachment_inspection_jobs_mailbox_idx
  on public.email_attachment_inspection_jobs (company_id, connection_id, status);

alter table public.email_attachment_inspection_jobs enable row level security;

drop policy if exists email_attachment_inspection_jobs_company_scope
  on public.email_attachment_inspection_jobs;

create policy email_attachment_inspection_jobs_company_scope
  on public.email_attachment_inspection_jobs
  for all
  using (company_id = ((auth.jwt() ->> 'company_id'))::uuid)
  with check (company_id = ((auth.jwt() ->> 'company_id'))::uuid);

revoke all on public.email_attachment_inspection_jobs
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.email_attachment_inspection_jobs to service_role;

create or replace function public.require_exact_email_attachment_inspection_job()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_connection_id uuid;
begin
  select attachment.company_id, attachment.connection_id
    into v_company_id, v_connection_id
    from public.email_attachments attachment
   where attachment.id = new.email_attachment_id;

  if v_company_id is null
     or v_connection_id is null
     or v_company_id is distinct from new.company_id
     or v_connection_id is distinct from new.connection_id then
    raise exception 'attachment inspection job must match its exact canonical attachment identity'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists email_attachment_inspection_jobs_exact_identity
  on public.email_attachment_inspection_jobs;

create trigger email_attachment_inspection_jobs_exact_identity
before insert or update of company_id, connection_id, email_attachment_id
on public.email_attachment_inspection_jobs
for each row execute function public.require_exact_email_attachment_inspection_job();

create or replace function public.enqueue_email_attachment_inspection_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_should_enqueue boolean := false;
begin
  if tg_op = 'INSERT' then
    v_should_enqueue := true;
  else
    v_should_enqueue :=
      old.ingest_status is distinct from new.ingest_status
      or old.attribution_status is distinct from new.attribution_status;
  end if;

  if new.ingest_status = 'stored'
     and new.attribution_status = 'attributed'
     and v_should_enqueue then
    insert into public.email_attachment_inspection_jobs (
      company_id,
      connection_id,
      email_attachment_id,
      status,
      available_at
    ) values (
      new.company_id,
      new.connection_id,
      new.id,
      'pending',
      now()
    )
    on conflict (email_attachment_id) do update
      set status = 'pending',
          available_at = now(),
          lease_owner = null,
          lease_expires_at = null,
          last_error = null,
          skip_reason = null,
          generation = public.email_attachment_inspection_jobs.generation + 1,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists email_attachments_enqueue_inspection_job
  on public.email_attachments;

create trigger email_attachments_enqueue_inspection_job
after insert or update of ingest_status, attribution_status
on public.email_attachments
for each row execute function public.enqueue_email_attachment_inspection_job();

create or replace function public.claim_email_attachment_inspection_jobs(
  p_worker_id uuid,
  p_limit integer default 5,
  p_lease_seconds integer default 240
)
returns setof public.email_attachment_inspection_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null then
    raise exception 'attachment inspection worker id is required';
  end if;

  return query
  with candidates as (
    select job.id
      from public.email_attachment_inspection_jobs job
     where (
       (job.status in ('pending', 'retrying') and job.available_at <= now())
       or (job.status = 'processing' and job.lease_expires_at <= now())
     )
     order by job.available_at asc, job.created_at asc, job.id asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  update public.email_attachment_inspection_jobs job
     set status = 'processing',
         attempts = job.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 900))),
         updated_at = now()
    from candidates
   where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.claim_email_attachment_inspection_jobs(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_attachment_inspection_jobs(uuid, integer, integer)
  to service_role;

create or replace function public.claim_email_attachment_inspection_job(
  p_email_attachment_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer default 240
)
returns setof public.email_attachment_inspection_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_email_attachment_id is null or p_worker_id is null then
    raise exception 'attachment and worker ids are required';
  end if;

  return query
  with candidate as (
    select job.id
      from public.email_attachment_inspection_jobs job
     where job.email_attachment_id = p_email_attachment_id
       and (
         (job.status in ('pending', 'retrying') and job.available_at <= now())
         or (job.status = 'processing' and job.lease_expires_at <= now())
       )
     for update skip locked
     limit 1
  )
  update public.email_attachment_inspection_jobs job
     set status = 'processing',
         attempts = job.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 900))),
         updated_at = now()
    from candidate
   where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on function public.claim_email_attachment_inspection_job(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_attachment_inspection_job(uuid, uuid, integer)
  to service_role;

-- ── Durable exact-message scan queue ───────────────────────────────────────

create table if not exists public.email_attachment_scans (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  connection_id      uuid not null references public.email_connections(id) on delete cascade,
  activity_id        uuid not null references public.activities(id) on delete cascade,
  provider_thread_id text not null,
  message_id         text not null,
  generation         bigint not null default 1,
  status             text not null default 'pending',
  attempts           integer not null default 0,
  available_at       timestamptz not null default now(),
  lease_owner        uuid,
  lease_expires_at   timestamptz,
  last_error         text,
  scanned_at         timestamptz,
  exception_notified_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (activity_id),
  constraint email_attachment_scans_status_check
    check (status in ('pending', 'processing', 'retrying', 'complete', 'paused', 'failed')),
  constraint email_attachment_scans_identity_check
    check (btrim(provider_thread_id) <> '' and btrim(message_id) <> ''),
  constraint email_attachment_scans_lease_check
    check (
      (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
      or status <> 'processing'
    )
);

create index if not exists email_attachment_scans_claim_idx
  on public.email_attachment_scans (available_at, created_at, id)
  where status in ('pending', 'retrying', 'processing');

create index if not exists email_attachment_scans_mailbox_idx
  on public.email_attachment_scans (company_id, connection_id, message_id);

alter table public.email_attachment_scans enable row level security;

drop policy if exists email_attachment_scans_company_scope
  on public.email_attachment_scans;

create policy email_attachment_scans_company_scope
  on public.email_attachment_scans
  for all
  using (company_id = ((auth.jwt() ->> 'company_id'))::uuid)
  with check (company_id = ((auth.jwt() ->> 'company_id'))::uuid);

-- Queue internals are service-only even though RLS is present as defense in depth.
revoke all on public.email_attachment_scans from public, anon, authenticated;
grant select, insert, update, delete on public.email_attachment_scans to service_role;

create or replace function public.require_same_company_email_attachment_scan()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_connection_company uuid;
  v_activity_company uuid;
begin
  select nullif(company_id, '')::uuid into v_connection_company
    from public.email_connections where id = new.connection_id;
  select company_id into v_activity_company
    from public.activities where id = new.activity_id;

  if v_connection_company is null
     or v_activity_company is null
     or v_connection_company is distinct from new.company_id
     or v_activity_company is distinct from new.company_id then
    raise exception 'email attachment scan identity must remain inside one company';
  end if;
  return new;
end;
$$;

drop trigger if exists email_attachment_scans_same_company
  on public.email_attachment_scans;

create trigger email_attachment_scans_same_company
before insert or update of company_id, connection_id, activity_id
on public.email_attachment_scans
for each row execute function public.require_same_company_email_attachment_scan();

create or replace function public.enqueue_email_attachment_scan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type = 'email'
     and new.email_connection_id is not null
     and nullif(btrim(new.email_message_id), '') is not null
     and nullif(btrim(new.email_thread_id), '') is not null then
    insert into public.email_attachment_scans (
      company_id,
      connection_id,
      activity_id,
      provider_thread_id,
      message_id,
      status,
      available_at
    ) values (
      new.company_id,
      new.email_connection_id,
      new.id,
      btrim(new.email_thread_id),
      btrim(new.email_message_id),
      'pending',
      now()
    )
    on conflict (activity_id) do update
      set company_id = excluded.company_id,
          connection_id = excluded.connection_id,
          provider_thread_id = excluded.provider_thread_id,
          message_id = excluded.message_id,
          generation = public.email_attachment_scans.generation + 1,
          status = 'pending',
          available_at = now(),
          lease_owner = null,
          lease_expires_at = null,
          last_error = null,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists activities_enqueue_email_attachment_scan
  on public.activities;

create trigger activities_enqueue_email_attachment_scan
after insert or update of email_connection_id, email_message_id, email_thread_id
on public.activities
for each row execute function public.enqueue_email_attachment_scan();

create or replace function public.requeue_email_attachment_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type = 'email'
     and (
       old.opportunity_id is distinct from new.opportunity_id
       or old.match_needs_review is distinct from new.match_needs_review
     ) then
    update public.email_attachments
       set opportunity_id = null,
           attribution_status = 'pending',
           updated_at = now()
     where activity_id = new.id;

    if new.email_connection_id is not null
       and nullif(btrim(new.email_message_id), '') is not null
       and nullif(btrim(new.email_thread_id), '') is not null then
      insert into public.email_attachment_scans (
        company_id, connection_id, activity_id, provider_thread_id,
        message_id, status, available_at
      ) values (
        new.company_id, new.email_connection_id, new.id,
        btrim(new.email_thread_id), btrim(new.email_message_id), 'pending', now()
      )
      on conflict (activity_id) do update
        set generation = public.email_attachment_scans.generation + 1,
            status = 'pending',
            available_at = now(),
            lease_owner = null,
            lease_expires_at = null,
            last_error = null,
            updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists activities_requeue_email_attachment_attribution
  on public.activities;

create trigger activities_requeue_email_attachment_attribution
after update of opportunity_id, match_needs_review
on public.activities
for each row execute function public.requeue_email_attachment_attribution();

create or replace function public.mark_email_attachment_connection_needs_reconnect(
  p_connection_id uuid,
  p_company_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_company_id text;
  v_connection_user_id text;
  v_connection_email text;
  v_inserted_count integer := 0;
begin
  if p_connection_id is null or p_company_id is null then
    raise exception 'attachment connection and company are required';
  end if;

  select
    connection.company_id,
    connection.user_id,
    connection.email
  into
    v_connection_company_id,
    v_connection_user_id,
    v_connection_email
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
  for update;

  if not found then
    raise exception 'attachment connection is outside company scope'
      using errcode = '23514';
  end if;

  update public.email_connections
  set status = 'needs_reconnect',
      updated_at = now()
  where id = p_connection_id
    and company_id = v_connection_company_id;

  with direct_recipient as (
    select app_user.id::text as user_id
    from public.users app_user
    where nullif(btrim(v_connection_user_id), '') is not null
      and app_user.id::text = btrim(v_connection_user_id)
      and app_user.company_id = v_connection_company_id
      and app_user.deleted_at is null
      and coalesce(app_user.is_active, true)
    limit 1
  ), admin_recipients as (
    select app_user.id::text as user_id
    from public.users app_user
    where not exists (select 1 from direct_recipient)
      and app_user.company_id = v_connection_company_id
      and app_user.deleted_at is null
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.is_company_admin, false)
  ), fallback_recipient as (
    select app_user.id::text as user_id
    from public.users app_user
    where not exists (select 1 from direct_recipient)
      and not exists (select 1 from admin_recipients)
      and app_user.company_id = v_connection_company_id
      and app_user.deleted_at is null
      and coalesce(app_user.is_active, true)
    order by app_user.created_at asc nulls last, app_user.id asc
    limit 1
  ), recipients as (
    select direct.user_id from direct_recipient direct
    union all
    select admin.user_id from admin_recipients admin
    union all
    select fallback.user_id from fallback_recipient fallback
  ), inserted as (
    insert into public.notifications (
      user_id,
      company_id,
      type,
      title,
      body,
      is_read,
      persistent,
      action_url,
      action_label,
      deep_link_type,
      dedupe_key
    )
    select
      recipient.user_id,
      v_connection_company_id,
      'system',
      'Email connection paused',
      'Reconnect ' || coalesce(
        nullif(btrim(v_connection_email), ''),
        'this mailbox'
      ) || ' to resume email sync.',
      false,
      true,
      '/settings?tab=integrations',
      'Reconnect',
      'inbox',
      'email-attachment-reconnect:' || p_connection_id::text
    from recipients recipient
    where not exists (
      select 1
      from public.notifications notification
      where notification.user_id = recipient.user_id
        and notification.company_id = v_connection_company_id
        and notification.type = 'system'
        and notification.dedupe_key =
          'email-attachment-reconnect:' || p_connection_id::text
        and notification.resolved_at is null
    )
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_inserted_count from inserted;

  return v_inserted_count;
end;
$$;

revoke all on function public.mark_email_attachment_connection_needs_reconnect(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.mark_email_attachment_connection_needs_reconnect(
  uuid, uuid
) to service_role;

create or replace function public.resume_email_attachment_scans_on_reconnect()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active'
     and new.sync_enabled is true
     and (old.status is distinct from new.status or old.sync_enabled is distinct from new.sync_enabled) then
    update public.email_attachment_scans
       set status = 'pending',
           available_at = now(),
           lease_owner = null,
           lease_expires_at = null,
           last_error = null,
           updated_at = now()
     where connection_id = new.id and status = 'paused';

    update public.notifications
       set is_read = true,
           resolved_at = coalesce(resolved_at, now()),
           resolution_reason = 'email_reconnected'
     where company_id = new.company_id
       and type = 'system'
       and dedupe_key = 'email-attachment-reconnect:' || new.id::text
       and resolved_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists email_connections_resume_attachment_scans
  on public.email_connections;

create trigger email_connections_resume_attachment_scans
after update of status, sync_enabled
on public.email_connections
for each row execute function public.resume_email_attachment_scans_on_reconnect();

create or replace function public.claim_email_attachment_scans(
  p_worker_id uuid,
  p_limit integer default 10,
  p_lease_seconds integer default 240
)
returns setof public.email_attachment_scans
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null then
    raise exception 'attachment scan worker id is required';
  end if;

  return query
  with candidates as (
    select scan.id
      from public.email_attachment_scans scan
     where (
       (scan.status in ('pending', 'retrying') and scan.available_at <= now())
       or (scan.status = 'processing' and scan.lease_expires_at <= now())
     )
     order by scan.available_at asc, scan.created_at asc, scan.id asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.email_attachment_scans scan
     set status = 'processing',
         attempts = scan.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 900))),
         updated_at = now()
    from candidates
   where scan.id = candidates.id
  returning scan.*;
end;
$$;

revoke all on function public.claim_email_attachment_scans(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_attachment_scans(uuid, integer, integer)
  to service_role;

create or replace function public.claim_email_attachment_scan(
  p_company_id uuid,
  p_connection_id uuid,
  p_activity_id uuid,
  p_message_id text,
  p_worker_id uuid,
  p_lease_seconds integer default 240
)
returns setof public.email_attachment_scans
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company_id is null
     or p_connection_id is null
     or p_activity_id is null
     or nullif(btrim(p_message_id), '') is null
     or p_worker_id is null then
    raise exception 'exact attachment scan identity and worker id are required';
  end if;

  return query
  with candidate as (
    select scan.id
      from public.email_attachment_scans scan
     where scan.company_id = p_company_id
       and scan.connection_id = p_connection_id
       and scan.activity_id = p_activity_id
       and scan.message_id = p_message_id
       and (
         (scan.status in ('pending', 'retrying') and scan.available_at <= now())
         or (scan.status = 'processing' and scan.lease_expires_at <= now())
       )
     for update skip locked
     limit 1
  )
  update public.email_attachment_scans scan
     set status = 'processing',
         attempts = scan.attempts + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 900))),
         updated_at = now()
    from candidate
   where scan.id = candidate.id
  returning scan.*;
end;
$$;

revoke all on function public.claim_email_attachment_scan(
  uuid, uuid, uuid, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.claim_email_attachment_scan(
  uuid, uuid, uuid, text, uuid, integer
) to service_role;

create or replace function public.notify_email_attachment_scan_exception(
  p_scan_id uuid,
  p_company_id uuid,
  p_user_id text,
  p_title text,
  p_body text,
  p_action_url text,
  p_action_label text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notified_at timestamptz;
begin
  if p_scan_id is null
     or p_company_id is null then
    raise exception 'scan and company are required';
  end if;

  if nullif(btrim(p_user_id), '') is not null
     and not exists (
       select 1
         from public.users app_user
        where app_user.id::text = btrim(p_user_id)
          and app_user.company_id = p_company_id::text
          and app_user.deleted_at is null
          and coalesce(app_user.is_active, true)
     ) then
    raise exception 'attachment notification user is outside company scope'
      using errcode = '23514';
  end if;

  if nullif(btrim(p_user_id), '') is null
     and not exists (
       select 1
         from public.users app_user
        where app_user.company_id = p_company_id::text
          and app_user.deleted_at is null
          and coalesce(app_user.is_active, true)
     ) then
    raise exception 'attachment notification has no active company recipient';
  end if;

  select scan.exception_notified_at
    into v_notified_at
    from public.email_attachment_scans scan
   where scan.id = p_scan_id
     and scan.company_id = p_company_id
   for update;

  if not found then
    raise exception 'attachment scan is outside company scope'
      using errcode = '23514';
  end if;
  if v_notified_at is not null then return false; end if;

  with admin_recipients as (
    select app_user.id::text as user_id
      from public.users app_user
     where nullif(btrim(p_user_id), '') is null
       and app_user.company_id = p_company_id::text
       and app_user.deleted_at is null
       and coalesce(app_user.is_active, true)
       and coalesce(app_user.is_company_admin, false)
  ), fallback_recipient as (
    select app_user.id::text as user_id
      from public.users app_user
     where nullif(btrim(p_user_id), '') is null
       and app_user.company_id = p_company_id::text
       and app_user.deleted_at is null
       and coalesce(app_user.is_active, true)
     order by app_user.created_at asc nulls last, app_user.id asc
     limit 1
  ), recipients as (
    select btrim(p_user_id) as user_id
     where nullif(btrim(p_user_id), '') is not null
    union
    select admin.user_id from admin_recipients admin
    union
    select fallback.user_id
      from fallback_recipient fallback
     where not exists (select 1 from admin_recipients)
  )
  insert into public.notifications (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    deep_link_type,
    dedupe_key
  )
  select
    recipient.user_id,
    p_company_id,
    'system',
    p_title,
    p_body,
    false,
    false,
    p_action_url,
    p_action_label,
    'inbox',
    'email-attachment-scan:' || p_scan_id::text
  from recipients recipient
  on conflict do nothing;

  update public.email_attachment_scans
     set exception_notified_at = now(),
         updated_at = now()
   where id = p_scan_id;
  return true;
end;
$$;

revoke all on function public.notify_email_attachment_scan_exception(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.notify_email_attachment_scan_exception(
  uuid, uuid, text, text, text, text, text
) to service_role;

-- Exhausted work is terminal, visible, and cost-bounded. The transition and
-- its in-app review notification share one transaction, so a failed queue row
-- can never disappear silently or re-run forever after the attempt ceiling.
create or replace function public.notify_terminal_email_attachment_failure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := (to_jsonb(new) ->> 'company_id')::uuid;
  v_connection_id uuid := (to_jsonb(new) ->> 'connection_id')::uuid;
  v_connection_user_id text;
  v_provider_thread_id text;
  v_thread_id uuid;
  v_action_url text := '/inbox';
  v_title text;
  v_body text;
  v_dedupe_key text;
begin
  if new.status <> 'failed' or old.status = 'failed' then
    return new;
  end if;

  if tg_table_name = 'email_attachment_scans' then
    v_provider_thread_id := to_jsonb(new) ->> 'provider_thread_id';
    v_title := 'Email files need review';
    v_body := 'OPS could not finish copying files from this email after repeated attempts. Open the thread to review them.';
    v_dedupe_key := 'email-attachment-scan-failed:' || new.id::text;
  elsif tg_table_name = 'email_attachment_inspection_jobs' then
    select attachment.provider_thread_id
      into v_provider_thread_id
      from public.email_attachments attachment
     where attachment.id = new.email_attachment_id
       and attachment.company_id = v_company_id
       and attachment.connection_id = v_connection_id;
    v_title := 'Email file review incomplete';
    v_body := 'OPS could not finish checking an email file after repeated attempts. Open the thread to review it.';
    v_dedupe_key := 'email-attachment-inspection-failed:' || new.id::text;
  else
    raise exception 'unsupported attachment failure queue';
  end if;

  select connection.user_id
    into v_connection_user_id
    from public.email_connections connection
   where connection.id = v_connection_id
     and connection.company_id = v_company_id::text;

  select thread.id
    into v_thread_id
    from public.email_threads thread
   where thread.company_id = v_company_id
     and thread.connection_id = v_connection_id
     and thread.provider_thread_id = v_provider_thread_id
   order by thread.updated_at desc nulls last, thread.id asc
   limit 1;
  if v_thread_id is not null then
    v_action_url := '/inbox/' || v_thread_id::text;
  end if;

  with direct_recipient as (
    select app_user.id::text as user_id
      from public.users app_user
     where nullif(btrim(v_connection_user_id), '') is not null
       and app_user.id::text = btrim(v_connection_user_id)
       and app_user.company_id = v_company_id::text
       and app_user.deleted_at is null
       and coalesce(app_user.is_active, true)
     limit 1
  ), admin_recipients as (
    select app_user.id::text as user_id
      from public.users app_user
     where not exists (select 1 from direct_recipient)
       and app_user.company_id = v_company_id::text
       and app_user.deleted_at is null
       and coalesce(app_user.is_active, true)
       and coalesce(app_user.is_company_admin, false)
  ), fallback_recipient as (
    select app_user.id::text as user_id
      from public.users app_user
     where not exists (select 1 from direct_recipient)
       and not exists (select 1 from admin_recipients)
       and app_user.company_id = v_company_id::text
       and app_user.deleted_at is null
       and coalesce(app_user.is_active, true)
     order by app_user.created_at asc nulls last, app_user.id asc
     limit 1
  ), recipients as (
    select direct.user_id from direct_recipient direct
    union all
    select admin.user_id from admin_recipients admin
    union all
    select fallback.user_id from fallback_recipient fallback
  )
  insert into public.notifications (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    deep_link_type,
    dedupe_key
  )
  select
    recipient.user_id,
    v_company_id,
    'system',
    v_title,
    v_body,
    false,
    false,
    v_action_url,
    'Review thread',
    'inbox',
    v_dedupe_key
  from recipients recipient
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.notify_terminal_email_attachment_failure()
  from public, anon, authenticated;

drop trigger if exists email_attachment_scans_terminal_failure_notification
  on public.email_attachment_scans;
create trigger email_attachment_scans_terminal_failure_notification
after update of status on public.email_attachment_scans
for each row execute function public.notify_terminal_email_attachment_failure();

drop trigger if exists email_attachment_inspection_jobs_terminal_failure_notification
  on public.email_attachment_inspection_jobs;
create trigger email_attachment_inspection_jobs_terminal_failure_notification
after update of status on public.email_attachment_inspection_jobs
for each row execute function public.notify_terminal_email_attachment_failure();

-- ── Activity projection ────────────────────────────────────────────────────

create or replace function public.refresh_email_activity_attachments(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing text[] := '{}'::text[];
  v_urls text[] := '{}'::text[];
  v_discovered_count integer := 0;
begin
  if p_activity_id is null then return; end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_existing
    from (
      select unnest(coalesce(activity.attachments, '{}'::text[])) as value
        from public.activities activity
       where activity.id = p_activity_id
    ) existing
   where existing.value not like '/api/integrations/email/attachment?id=%';

  select
    coalesce(array_agg(
      '/api/integrations/email/attachment?id=' || attachment.id::text ||
      '&filename=' || regexp_replace(
        coalesce(nullif(attachment.filename, ''), 'attachment'),
        '[^A-Za-z0-9._-]+', '_', 'g'
      )
      order by attachment.occurred_at asc nulls last, attachment.id asc
    ) filter (
      where attachment.ingest_status = 'stored'
        and attachment.attribution_status = 'attributed'
    ), '{}'::text[]),
    count(*)::integer
  into v_urls, v_discovered_count
  from public.email_attachments attachment
  where attachment.activity_id = p_activity_id;

  update public.activities
     set attachments = v_existing || v_urls,
         has_attachments = (cardinality(v_existing) + v_discovered_count) > 0,
         attachment_count = cardinality(v_existing) + v_discovered_count
   where id = p_activity_id;
end;
$$;

create or replace function public.refresh_email_activity_attachments_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_email_activity_attachments(old.activity_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_email_activity_attachments(new.activity_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists email_attachments_refresh_activity
  on public.email_attachments;

create trigger email_attachments_refresh_activity
after insert or update of activity_id, ingest_status, attribution_status, filename or delete
on public.email_attachments
for each row execute function public.refresh_email_activity_attachments_trigger();

revoke all on function public.refresh_email_activity_attachments(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_email_activity_attachments(uuid)
  to service_role;

create or replace function public.require_exact_email_attachment_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_connection_company uuid;
  v_activity public.activities%rowtype;
begin
  -- Provider metadata is advisory. Once OPS has sniffed and byte-verified a
  -- stored object, later provider rescans must not downgrade its serving MIME.
  if tg_op = 'UPDATE'
     and old.ingest_status = 'stored'
     and old.detected_mime_type is not null then
    new.detected_mime_type := old.detected_mime_type;
  end if;

  select nullif(company_id, '')::uuid into v_connection_company
    from public.email_connections
   where id = new.connection_id;

  if v_connection_company is null
     or v_connection_company is distinct from new.company_id then
    raise exception 'email attachment connection must belong to attachment company'
      using errcode = '23514';
  end if;

  if new.activity_id is not null then
    select * into v_activity
      from public.activities
     where id = new.activity_id
     for share;

    if v_activity.id is null
       or v_activity.company_id is distinct from new.company_id
       or v_activity.email_connection_id is distinct from new.connection_id
       or v_activity.email_message_id is distinct from new.message_id then
      raise exception 'email attachment must match its exact mailbox activity identity'
        using errcode = '23514';
    end if;

    if new.attribution_status = 'attributed' then
      if v_activity.opportunity_id is null
         or coalesce(v_activity.match_needs_review, false)
         or new.opportunity_id is distinct from v_activity.opportunity_id then
        raise exception 'attributed email attachment requires the current reviewed activity owner'
          using errcode = '23514';
      end if;
      -- Caller cannot spoof a different opportunity. The application decides
      -- whether participant validation permits attribution; the database then
      -- derives the only possible opportunity from the exact activity.
      new.opportunity_id := v_activity.opportunity_id;
    else
      new.opportunity_id := null;
    end if;
  else
    new.opportunity_id := null;
    if new.attribution_status = 'attributed' then
      new.attribution_status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists email_attachments_exact_identity
  on public.email_attachments;

create trigger email_attachments_exact_identity
before insert or update of company_id, connection_id, message_id, activity_id,
  opportunity_id, attribution_status, ingest_status, detected_mime_type
on public.email_attachments
for each row execute function public.require_exact_email_attachment_identity();

-- Attachment metadata and raw bytes are service-only. Authenticated access is
-- mediated by permission-checked server routes; company RLS remains defense in
-- depth for future narrowly granted readers.
alter table public.email_attachments enable row level security;
drop policy if exists email_attachments_company_scope on public.email_attachments;
create policy email_attachments_company_scope
  on public.email_attachments for select
  using (company_id = ((auth.jwt() ->> 'company_id'))::uuid);

revoke all on public.email_attachments from public, anon, authenticated;
grant select, insert, update, delete on public.email_attachments to service_role;

alter table public.attachment_inspections enable row level security;
drop policy if exists attachment_inspections_company_scope
  on public.attachment_inspections;
create policy attachment_inspections_company_scope
  on public.attachment_inspections for select
  using (company_id = ((auth.jwt() ->> 'company_id'))::uuid);
revoke all on public.attachment_inspections from public, anon, authenticated;
grant select, insert, update, delete on public.attachment_inspections to service_role;

-- ── Private storage bucket ─────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('email-attachments', 'email-attachments', false, 26214400)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- No browser object policy is created. Only the service-role ingestion worker
-- and authenticated row-id proxy can read/write these objects.

-- ── Historical convergence ─────────────────────────────────────────────────

insert into public.email_attachment_scans (
  company_id,
  connection_id,
  activity_id,
  provider_thread_id,
  message_id,
  status,
  available_at
)
select
  activity.company_id,
  activity.email_connection_id,
  activity.id,
  btrim(activity.email_thread_id),
  btrim(activity.email_message_id),
  'pending',
  now()
from public.activities activity
where activity.type = 'email'
  and activity.email_connection_id is not null
  and nullif(btrim(activity.email_message_id), '') is not null
  and nullif(btrim(activity.email_thread_id), '') is not null
on conflict (activity_id) do update
  set company_id = excluded.company_id,
      connection_id = excluded.connection_id,
      provider_thread_id = excluded.provider_thread_id,
      message_id = excluded.message_id,
      status = 'pending',
      available_at = least(public.email_attachment_scans.available_at, now()),
      lease_owner = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now();

insert into public.email_attachment_inspection_jobs (
  company_id,
  connection_id,
  email_attachment_id,
  status,
  available_at
)
select
  attachment.company_id,
  attachment.connection_id,
  attachment.id,
  'pending',
  now()
from public.email_attachments attachment
where attachment.ingest_status = 'stored'
  and attachment.attribution_status = 'attributed'
on conflict (email_attachment_id) do nothing;

comment on table public.email_attachments is
  'Canonical mailbox-scoped email files. Bytes are private OPS copies; activity_id is exact message provenance and opportunity attribution fails closed.';
comment on table public.email_attachment_scans is
  'Durable exact-message queue for attachment enumeration, private storage, attribution, retries, and historical backfill.';
comment on table public.email_attachment_inspection_jobs is
  'Independent cost-once vision/PDF inspection queue keyed to canonical private email attachments.';

commit;
