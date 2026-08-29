-- DELIVERY-SOURCE NORMALIZATION RE-PROJECTION — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. This contract stands up a column-faithful copy of
-- the immutable provider-delivery ledger as it exists before the repair (the
-- v1-only revision CHECK, the shared job-memory immutability trigger), applies
-- the forward migration, and exercises the capture function in PostgreSQL.
-- Every schema and role change is rolled back.
--
-- What it proves:
--   1. a re-capture whose retained source bytes are identical but whose
--      derived text projection moved to a newer revision updates the row in
--      place instead of raising the idempotency conflict;
--   2. the capture-time `source_sha256` — the tenant hash key immutable job
--      conversation turns reference — is never rewritten by that update;
--   3. a re-capture whose source bytes differ still raises
--      `agent_provider_delivery_source_idempotency_conflict`;
--   4. the ledger is otherwise still immutable: a bare UPDATE fails, and the
--      re-projection marker cannot smuggle a source-byte edit through.

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$roles$;

create schema auth;
create schema private;
create schema extensions;

-- Stands in for Supabase's request-scoped role resolver so the contract can
-- exercise both the service-role arm and the access-denied arm.
create function auth.role()
returns text
language sql
stable
as $function$
  select nullif(current_setting('contract.auth_role', true), '');
$function$;

-- The capture function only needs a deterministic 32-byte digest of the
-- canonical envelope; real sha256 (pgcrypto) is not what is under test here.
create function extensions.digest(p_value bytea, p_algorithm text)
returns bytea
language sql
immutable
as $function$
  select decode(md5(p_value) || md5(md5(p_value)), 'hex');
$function$;

-- Prompt-safety and identity canonicalization are contracted elsewhere; these
-- stand-ins keep their signatures so the ledger's CHECKs and the capture
-- function's argument validation resolve.
create function private.agent_prompt_text_is_safe(p_value text, p_allow_newlines boolean)
returns boolean
language sql
immutable
as $function$
  select p_value is not null;
$function$;

create function private.agent_provider_email_identity_is_valid(p_value text)
returns boolean
language sql
immutable
as $function$
  select p_value is not null
     and p_value = lower(btrim(p_value))
     and octet_length(p_value) <= 512
     and p_value ~ '^[^[:space:]@]+@[^[:space:]@]+$';
$function$;

create function private.agent_provider_identity_array_is_canonical(
  p_values text[],
  p_maximum integer
)
returns boolean
language sql
immutable
as $function$
  select p_values is not null
     and cardinality(p_values) <= p_maximum
     and not exists (
       select 1
       from unnest(p_values) identity(value)
       where identity.value is null
          or identity.value <> lower(btrim(identity.value))
     );
$function$;

-- Byte-faithful copy of the shared job-memory immutability guard. The forward
-- migration must NOT replace it — it still guards six other tables.
create function private.reject_agent_job_memory_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and pg_catalog.current_setting(
       'ops.company_data_purge_company_id',
       true
     ) = old.company_id::text
     and coalesce(
       pg_catalog.current_setting('request.jwt.claims', true),
       ''
     ) = '' then
    return old;
  end if;

  raise exception 'agent_job_memory_record_is_immutable'
    using errcode = '55000';
end;
$function$;

create table public.agent_control_plane_tenant_roots (
  company_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);

-- `company_id` really is text on this table in production.
create table public.email_connections (
  id uuid primary key,
  company_id text not null,
  provider text not null
);

-- Only reached through branches this contract never takes (outbound intents,
-- attachment descriptors). They exist because the capture function declares
-- %ROWTYPE variables against them, which resolve on first execution.
create table public.email_send_intents (
  id uuid primary key,
  actor_user_id uuid,
  opportunity_id uuid,
  project_id text
);
create table public.approved_action_email_intents (
  id uuid primary key,
  actor_user_id uuid,
  opportunity_id uuid,
  project_id text
);
create table public.email_attachments (
  id uuid primary key,
  company_id text,
  message_id text,
  attachment_id text
);

-- Column-faithful copy of private.agent_provider_delivery_sources, including
-- the pre-repair revision CHECK the migration has to widen.
create table private.agent_provider_delivery_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agent_control_plane_tenant_roots(company_id)
    on delete cascade,
  connection_id uuid not null,
  provider text not null
    check (provider in ('gmail', 'microsoft365')),
  provider_message_id text not null
    check (
      provider_message_id = btrim(provider_message_id)
      and nullif(provider_message_id, '') is not null
      and octet_length(provider_message_id) <= 512
      and private.agent_prompt_text_is_safe(provider_message_id, false)
    ),
  provider_thread_id text not null
    check (
      provider_thread_id = btrim(provider_thread_id)
      and nullif(provider_thread_id, '') is not null
      and octet_length(provider_thread_id) <= 512
      and private.agent_prompt_text_is_safe(provider_thread_id, false)
    ),
  direction text not null
    check (direction in ('inbound', 'outbound')),
  delivered_at timestamptz not null,
  subject text not null
    check (octet_length(subject) <= 8192),
  normalized_subject text
    check (octet_length(normalized_subject) <= 8192),
  normalized_plain_text text not null
    check (octet_length(normalized_plain_text) <= 8388608),
  normalization_revision text not null
    check (
      normalization_revision = 'ops.correspondence.normalized-text.v1'
    ),
  normalization_status text not null
    check (normalization_status in ('normalized', 'rejected')),
  sender_identity text not null
    check (
      sender_identity = lower(btrim(sender_identity))
      and octet_length(sender_identity) <= 512
      and sender_identity ~ '^[^[:space:]@]+@[^[:space:]@]+$'
      and private.agent_prompt_text_is_safe(sender_identity, false)
    ),
  recipient_identities text[] not null,
  cc_recipient_identities text[] not null,
  content_media_type text not null
    check (content_media_type in ('text/plain', 'text/html')),
  content_value text not null
    check (octet_length(content_value) <= 8388608),
  content_charset text,
  content_source_kind text not null
    check (
      content_source_kind in (
        'gmail_mime_part',
        'microsoft_graph_body',
        'ops_rendered_outbound'
      )
    ),
  content_selection_revision text not null,
  provider_part_id text,
  provider_body_attachment_id text,
  attachment_enumeration_complete boolean not null,
  attachment_descriptors jsonb not null,
  attachment_evidence_ids text[] not null,
  source_sha256 text not null
    check (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  captured_at timestamptz not null default clock_timestamp(),
  unique (company_id, connection_id, provider_message_id),
  constraint agent_provider_delivery_sources_tenant_hash_key
    unique (company_id, id, source_sha256),
  check (attachment_enumeration_complete),
  check (jsonb_typeof(attachment_descriptors) = 'array')
);

alter table private.agent_provider_delivery_sources enable row level security;
revoke all on table private.agent_provider_delivery_sources
  from public, anon, authenticated, service_role;

create trigger agent_provider_delivery_sources_immutable
before update or delete on private.agent_provider_delivery_sources
for each row execute function private.reject_agent_job_memory_mutation();

create table private.agent_provider_outbound_authority_attestations (
  company_id uuid not null,
  provider_source_id uuid not null,
  source_sha256 text not null,
  accepted_intent_kind text,
  accepted_intent_id uuid,
  actor_user_id uuid,
  opportunity_id uuid,
  project_id text,
  primary key (company_id, provider_source_id)
);

-- Everything above is the ledger as production carried it before the repair.
-- The forward migration installs the capture function, the widened revision
-- CHECK, the table-scoped mutation guard and the two backfill entry points —
-- all of which are what this contract exercises from here down.

\ir ../../supabase/migrations/20260830113400_delivery_source_normalization_reprojection.sql

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into public.email_connections (id, company_id, provider)
values (
  '8db73af6-0000-4000-8000-000000000002',
  '8db73af6-0000-4000-8000-000000000001',
  'gmail'
);

-- ── Privilege boundary ─────────────────────────────────────────────────────
do $contract$
declare
  v_capture regprocedure := (
    'public.capture_agent_provider_delivery_source_as_system('
      || 'uuid,uuid,text,text,text,text,timestamptz,text,text,text,text,text,'
      || 'text,text[],text[],text,text,text,text,text,text,text,text,uuid,'
      || 'boolean,jsonb)'
  )::regprocedure;
  v_list regprocedure :=
    'public.list_agent_provider_delivery_sources_for_renormalization_as_system(integer,timestamptz,uuid)'::regprocedure;
  v_reproject regprocedure :=
    'public.reproject_agent_provider_delivery_source_as_system(uuid,uuid,text,text,text,text)'::regprocedure;
  v_function regprocedure;
begin
  foreach v_function in array array[v_capture, v_list, v_reproject] loop
    if has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute')
    then
      raise exception 'delivery-source function % is executable by a browser role', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'delivery-source function % is not executable by service_role', v_function;
    end if;
  end loop;
end;
$contract$;

do $contract$
begin
  perform set_config('contract.auth_role', 'anon', true);
  begin
    perform public.reproject_agent_provider_delivery_source_as_system(
      '8db73af6-0000-4000-8000-000000000001',
      '8db73af6-0000-4000-8000-000000000003',
      'Subject',
      'Body',
      'ops.correspondence.normalized-text.v2',
      'normalized'
    );
    raise exception 're-projection accepted a non-service role';
  exception
    when sqlstate '42501' then null;
  end;
  perform set_config('contract.auth_role', 'service_role', true);
end;
$contract$;

-- ── 1. First capture: the pre-repair reading of a real HTML message ────────
-- This is the production shape the bug produced: a styled HTML body the
-- operator reads fine in Gmail, stored with the omission placeholders because
-- the v1 normalizer rejected every construct real mail uses.
create table public.contract_first_capture as
select *
  from public.capture_agent_provider_delivery_source_as_system(
    '8db73af6-0000-4000-8000-000000000001',
    '8db73af6-0000-4000-8000-000000000002',
    'gmail',
    'provider-message-8db73af6',
    'provider-thread-8db73af6',
    'inbound',
    '2026-08-20 17:04:00+00',
    'Deck rebuild quote',
    '[SUBJECT OMITTED: UNSAFE SOURCE]',
    '[CONTENT OMITTED: UNSAFE SOURCE]',
    'ops.correspondence.normalized-text.v1',
    'rejected',
    'jane.doe@example.com',
    array['operator@example.com'],
    array[]::text[],
    'text/html',
    '<html><head><style>a:hover{color:#000}</style></head><body><p>Hi Jack, can you quote a deck rebuild?</p></body></html>',
    'utf-8',
    'gmail_mime_part',
    'gmail.mime.text-plain-first.charset-decoded.v2',
    '0.1',
    null,
    null,
    null,
    true,
    '[]'::jsonb
  );

do $contract$
declare
  v_result record;
  v_row private.agent_provider_delivery_sources%rowtype;
begin
  select * into v_result from public.contract_first_capture;
  if not v_result.inserted then
    raise exception 'first capture did not insert';
  end if;

  select * into v_row
    from private.agent_provider_delivery_sources source
   where source.id = v_result.source_id;

  if v_row.normalization_status <> 'rejected'
     or v_row.normalization_revision
       <> 'ops.correspondence.normalized-text.v1'
     or v_row.normalized_plain_text <> '[CONTENT OMITTED: UNSAFE SOURCE]' then
    raise exception 'first capture did not store the pre-repair projection';
  end if;
end;
$contract$;

-- ── 2. Re-capture, identical bytes, repaired projection ────────────────────
create table public.contract_reprojection_capture as
select *
  from public.capture_agent_provider_delivery_source_as_system(
    '8db73af6-0000-4000-8000-000000000001',
    '8db73af6-0000-4000-8000-000000000002',
    'gmail',
    'provider-message-8db73af6',
    'provider-thread-8db73af6',
    'inbound',
    '2026-08-20 17:04:00+00',
    'Deck rebuild quote',
    'Deck rebuild quote',
    'Hi Jack, can you quote a deck rebuild?',
    'ops.correspondence.normalized-text.v2',
    'normalized',
    'jane.doe@example.com',
    array['operator@example.com'],
    array[]::text[],
    'text/html',
    '<html><head><style>a:hover{color:#000}</style></head><body><p>Hi Jack, can you quote a deck rebuild?</p></body></html>',
    'utf-8',
    'gmail_mime_part',
    'gmail.mime.text-plain-first.charset-decoded.v2',
    '0.1',
    null,
    null,
    null,
    true,
    '[]'::jsonb
  );

do $contract$
declare
  v_first record;
  v_again record;
  v_row private.agent_provider_delivery_sources%rowtype;
begin
  select * into v_first from public.contract_first_capture;
  select * into v_again from public.contract_reprojection_capture;

  if v_again.inserted then
    raise exception 're-capture inserted a second row';
  end if;
  if v_again.source_id is distinct from v_first.source_id then
    raise exception 're-capture moved the source id';
  end if;
  -- The digest is the tenant hash key immutable job conversation turns
  -- reference: the re-projection must leave it exactly where it was.
  if v_again.source_sha256 is distinct from v_first.source_sha256 then
    raise exception 're-projection rewrote the capture-time digest';
  end if;

  select * into v_row
    from private.agent_provider_delivery_sources source
   where source.id = v_first.source_id;

  -- re-projection updated the row in place
  if v_row.normalization_status <> 'normalized'
     or v_row.normalization_revision
       <> 'ops.correspondence.normalized-text.v2'
     or v_row.normalized_subject <> 'Deck rebuild quote'
     or v_row.normalized_plain_text
       <> 'Hi Jack, can you quote a deck rebuild?' then
    raise exception 're-projection did not update the stored projection: %',
      v_row.normalization_status;
  end if;
  if v_row.source_sha256 is distinct from v_first.source_sha256 then
    raise exception 'stored digest moved under the re-projection';
  end if;
  if v_row.content_value !~ 'deck rebuild' then
    raise exception 're-projection disturbed the retained source bytes';
  end if;
end;
$contract$;

-- ── 3. Replaying the repaired capture is a no-op, not a conflict ───────────
do $contract$
declare
  v_replay record;
  v_first record;
begin
  select * into v_first from public.contract_first_capture;
  select * into v_replay
    from public.capture_agent_provider_delivery_source_as_system(
      '8db73af6-0000-4000-8000-000000000001',
      '8db73af6-0000-4000-8000-000000000002',
      'gmail',
      'provider-message-8db73af6',
      'provider-thread-8db73af6',
      'inbound',
      '2026-08-20 17:04:00+00',
      'Deck rebuild quote',
      'Deck rebuild quote',
      'Hi Jack, can you quote a deck rebuild?',
      'ops.correspondence.normalized-text.v2',
      'normalized',
      'jane.doe@example.com',
      array['operator@example.com'],
      array[]::text[],
      'text/html',
      '<html><head><style>a:hover{color:#000}</style></head><body><p>Hi Jack, can you quote a deck rebuild?</p></body></html>',
      'utf-8',
      'gmail_mime_part',
      'gmail.mime.text-plain-first.charset-decoded.v2',
      '0.1',
      null,
      null,
      null,
      true,
      '[]'::jsonb
    );

  if v_replay.inserted
     or v_replay.source_id is distinct from v_first.source_id
     or v_replay.source_sha256 is distinct from v_first.source_sha256 then
    raise exception 'idempotent replay of the repaired capture was not stable';
  end if;
end;
$contract$;

-- ── 4. Different source bytes still conflict ──────────────────────────────
do $contract$
begin
  begin
    perform 1
      from public.capture_agent_provider_delivery_source_as_system(
        '8db73af6-0000-4000-8000-000000000001',
        '8db73af6-0000-4000-8000-000000000002',
        'gmail',
        'provider-message-8db73af6',
        'provider-thread-8db73af6',
        'inbound',
        '2026-08-20 17:04:00+00',
        'Deck rebuild quote',
        'Deck rebuild quote',
        'Hi Jack, can you quote a deck rebuild?',
        'ops.correspondence.normalized-text.v2',
        'normalized',
        'jane.doe@example.com',
        array['operator@example.com'],
        array[]::text[],
        'text/html',
        '<html><body><p>Different bytes entirely.</p></body></html>',
        'utf-8',
        'gmail_mime_part',
        'gmail.mime.text-plain-first.charset-decoded.v2',
        '0.1',
        null,
        null,
        null,
        true,
        '[]'::jsonb
      );
    raise exception 'a re-capture with different source bytes was accepted';
  exception
    when sqlstate '23505' then
      if sqlerrm <> 'agent_provider_delivery_source_idempotency_conflict' then
        raise exception 'unexpected conflict message: %', sqlerrm;
      end if;
  end;
end;
$contract$;

-- A drifting raw subject is source drift too, not projection drift.
do $contract$
begin
  begin
    perform 1
      from public.capture_agent_provider_delivery_source_as_system(
        '8db73af6-0000-4000-8000-000000000001',
        '8db73af6-0000-4000-8000-000000000002',
        'gmail',
        'provider-message-8db73af6',
        'provider-thread-8db73af6',
        'inbound',
        '2026-08-20 17:04:00+00',
        'Deck rebuild quote (edited)',
        'Deck rebuild quote',
        'Hi Jack, can you quote a deck rebuild?',
        'ops.correspondence.normalized-text.v2',
        'normalized',
        'jane.doe@example.com',
        array['operator@example.com'],
        array[]::text[],
        'text/html',
        '<html><head><style>a:hover{color:#000}</style></head><body><p>Hi Jack, can you quote a deck rebuild?</p></body></html>',
        'utf-8',
        'gmail_mime_part',
        'gmail.mime.text-plain-first.charset-decoded.v2',
        '0.1',
        null,
        null,
        null,
        true,
        '[]'::jsonb
      );
    raise exception 'a re-capture with a drifting raw subject was accepted';
  exception
    when sqlstate '23505' then null;
  end;
end;
$contract$;

-- ── 5. The ledger is still immutable outside the re-projection ────────────
do $contract$
declare
  v_first record;
begin
  select * into v_first from public.contract_first_capture;

  begin
    update private.agent_provider_delivery_sources
       set normalized_plain_text = 'hand-edited'
     where id = v_first.source_id;
    raise exception 'a bare update was accepted by the immutability guard';
  exception
    when sqlstate '55000' then null;
  end;

  -- The marker names a row; it does not license editing that row's bytes.
  begin
    perform set_config(
      'ops.agent_provider_delivery_source_reprojection',
      v_first.source_id::text,
      true
    );
    update private.agent_provider_delivery_sources
       set normalized_plain_text = 'smuggled',
           content_value = 'tampered'
     where id = v_first.source_id;
    raise exception 'the re-projection marker admitted a source-byte edit';
  exception
    when sqlstate '55000' then
      perform set_config(
        'ops.agent_provider_delivery_source_reprojection',
        '',
        true
      );
  end;
end;
$contract$;

-- ── 6. The backfill write path ────────────────────────────────────────────
do $contract$
declare
  v_first record;
  v_moved boolean;
begin
  select * into v_first from public.contract_first_capture;

  -- An unknown revision is refused outright.
  begin
    perform public.reproject_agent_provider_delivery_source_as_system(
      '8db73af6-0000-4000-8000-000000000001',
      v_first.source_id,
      'Deck rebuild quote',
      'Hi Jack, can you quote a deck rebuild?',
      'ops.correspondence.normalized-text.v9',
      'normalized'
    );
    raise exception 're-projection accepted an unknown revision';
  exception
    when sqlstate '22023' then null;
  end;

  -- A rejection must carry the fixed prompt-safe placeholders.
  begin
    perform public.reproject_agent_provider_delivery_source_as_system(
      '8db73af6-0000-4000-8000-000000000001',
      v_first.source_id,
      'Deck rebuild quote',
      'Hi Jack, can you quote a deck rebuild?',
      'ops.correspondence.normalized-text.v2',
      'rejected'
    );
    raise exception 're-projection accepted a rejection without placeholders';
  exception
    when sqlstate '22023' then null;
  end;

  -- Already at these values: reports no movement, writes nothing.
  v_moved := public.reproject_agent_provider_delivery_source_as_system(
    '8db73af6-0000-4000-8000-000000000001',
    v_first.source_id,
    'Deck rebuild quote',
    'Hi Jack, can you quote a deck rebuild?',
    'ops.correspondence.normalized-text.v2',
    'normalized'
  );
  if v_moved then
    raise exception 're-projection claimed to move an unchanged row';
  end if;

  v_moved := public.reproject_agent_provider_delivery_source_as_system(
    '8db73af6-0000-4000-8000-000000000001',
    v_first.source_id,
    'Deck rebuild quote',
    'Hi Jack, can you quote a deck rebuild? Thanks.',
    'ops.correspondence.normalized-text.v2',
    'normalized'
  );
  if not v_moved then
    raise exception 're-projection did not report the write it made';
  end if;

  if not exists (
    select 1
      from private.agent_provider_delivery_sources source
     where source.id = v_first.source_id
       and source.normalized_plain_text
         = 'Hi Jack, can you quote a deck rebuild? Thanks.'
       and source.source_sha256 = v_first.source_sha256
  ) then
    raise exception 're-projection write did not land, or moved the digest';
  end if;
end;
$contract$;

-- ── 7. The backfill read path is bounded and rejected-only ────────────────
do $contract$
declare
  v_rejected integer;
begin
  select count(*) into v_rejected
    from public.list_agent_provider_delivery_sources_for_renormalization_as_system(
      100,
      null,
      null
    );
  if v_rejected <> 0 then
    raise exception 'a normalized row was offered for re-normalization: %',
      v_rejected;
  end if;
end;
$contract$;

-- A second, still-rejected message: the reader must surface exactly this one.
select *
  from public.capture_agent_provider_delivery_source_as_system(
    '8db73af6-0000-4000-8000-000000000001',
    '8db73af6-0000-4000-8000-000000000002',
    'gmail',
    'provider-message-8db73af6-b',
    'provider-thread-8db73af6',
    'inbound',
    '2026-08-21 09:00:00+00',
    'Second message',
    '[SUBJECT OMITTED: UNSAFE SOURCE]',
    '[CONTENT OMITTED: UNSAFE SOURCE]',
    'ops.correspondence.normalized-text.v1',
    'rejected',
    'jane.doe@example.com',
    array['operator@example.com'],
    array[]::text[],
    'text/html',
    '<html><body><p>Second message body.</p></body></html>',
    'utf-8',
    'gmail_mime_part',
    'gmail.mime.text-plain-first.charset-decoded.v2',
    '0.1',
    null,
    null,
    null,
    true,
    '[]'::jsonb
  );

do $contract$
declare
  v_listed record;
  v_count integer;
begin
  select count(*) into v_count
    from public.list_agent_provider_delivery_sources_for_renormalization_as_system(
      100,
      null,
      null
    );
  if v_count <> 1 then
    raise exception 'expected exactly the rejected row, got %', v_count;
  end if;

  select * into v_listed
    from public.list_agent_provider_delivery_sources_for_renormalization_as_system(
      100,
      null,
      null
    );
  if v_listed.provider_message_id <> 'provider-message-8db73af6-b'
     or v_listed.content_value !~ 'Second message body'
     or v_listed.normalization_status <> 'rejected' then
    raise exception 'the reader did not return the retained source bytes';
  end if;

  -- The keyset cursor excludes the page it was taken from.
  select count(*) into v_count
    from public.list_agent_provider_delivery_sources_for_renormalization_as_system(
      100,
      v_listed.delivered_at,
      v_listed.source_id
    );
  if v_count <> 0 then
    raise exception 'the keyset cursor did not advance past its own row';
  end if;
end;
$contract$;

-- ── 8. The widened CHECK admits both revisions and nothing else ───────────
do $contract$
declare
  v_definition text;
begin
  select pg_get_constraintdef(constraint_definition.oid)
    into v_definition
    from pg_catalog.pg_constraint constraint_definition
   where constraint_definition.conrelid =
           'private.agent_provider_delivery_sources'::regclass
     and constraint_definition.conname =
           'agent_provider_delivery_sources_normalization_revision_check';

  if v_definition is null then
    raise exception 'the widened revision CHECK was not installed';
  end if;
  if v_definition !~ 'normalized-text\.v1'
     or v_definition !~ 'normalized-text\.v2' then
    raise exception 'the revision CHECK does not admit both revisions: %',
      v_definition;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_constraint constraint_definition
     where constraint_definition.conrelid =
             'private.agent_provider_delivery_sources'::regclass
       and constraint_definition.contype = 'c'
       and constraint_definition.conname <>
             'agent_provider_delivery_sources_normalization_revision_check'
       and pg_get_constraintdef(constraint_definition.oid)
             like '%normalization_revision%'
  ) then
    raise exception 'the pre-repair revision CHECK survived the migration';
  end if;
end;
$contract$;

rollback;
