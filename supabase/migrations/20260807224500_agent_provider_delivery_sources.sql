-- Exact provider-delivery provenance for immutable job-conversation turns.
--
-- The private row is captured before mutable email ingestion. Provider
-- attachments are resolved to canonical public attachment ids in the same
-- transaction. Browser and service clients receive no direct table access;
-- service-role callers use bounded SECURITY DEFINER functions instead.

begin;

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.companies',
    'public.email_connections',
    'public.email_send_intents',
    'public.approved_action_email_intents',
    'public.email_attachments',
    'public.attachment_inspections',
    'public.activities',
    'public.opportunity_correspondence_events',
    'public.opportunities',
    'public.projects',
    'public.users',
    'public.clients',
    'public.sub_clients'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception
        'agent_provider_delivery_source_prerequisite_missing: %',
        v_relation
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'extensions.digest(bytea,text)',
    'private.agent_prompt_text_is_safe(text,boolean)',
    'private.reject_agent_job_memory_mutation()'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception
        'agent_provider_delivery_source_prerequisite_missing: %',
        v_signature
        using errcode = '55000';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.email_connections'::regclass
      and attribute.attname = 'company_id'
      and attribute.atttypid = 'text'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_missing: email_connections.company_id text'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Every current writer is mailbox-scoped. Retire the held legacy constraint
-- before this migration adds another mailbox-scoped writer; otherwise two
-- connections that reuse provider-local ids can collide across mailboxes.
do $attachment_identity_preflight$
begin
  if exists (
    select 1
    from public.email_attachments attachment
    where attachment.connection_id is null
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_missing: email_attachments.connection_id'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.attachment_inspections inspection
    where inspection.connection_id is null
       or inspection.email_attachment_id is null
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_missing: attachment_inspections mailbox identity'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.attachment_inspections inspection
    left join public.email_attachments attachment
      on attachment.id = inspection.email_attachment_id
     and attachment.company_id = inspection.company_id
     and attachment.connection_id = inspection.connection_id
     and attachment.message_id = inspection.message_id
     and attachment.attachment_id = inspection.attachment_id
    where attachment.id is null
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_missing: attachment_inspections exact attachment identity'
      using errcode = '55000';
  end if;
end;
$attachment_identity_preflight$;

do $attachment_inspection_index_preflight$
declare
  v_index_oid oid := pg_catalog.to_regclass(
    'public.attachment_inspections_mailbox_identity_unique'
  );
begin
  if v_index_oid is not null and (
    not exists (
      select 1
      from pg_catalog.pg_index index_definition
      where index_definition.indexrelid = v_index_oid
        and index_definition.indrelid =
          'public.attachment_inspections'::regclass
    )
    or exists (
      select 1
      from pg_catalog.pg_constraint constraint_definition
      where constraint_definition.conindid = v_index_oid
    )
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_invalid: attachment_inspections_mailbox_identity_unique'
      using errcode = '55000';
  end if;
end;
$attachment_inspection_index_preflight$;

alter table public.attachment_inspections
  alter column connection_id set not null,
  alter column email_attachment_id set not null;

create unique index if not exists email_attachments_mailbox_identity_unique
  on public.email_attachments (
    company_id,
    connection_id,
    message_id,
    attachment_id
  );

alter table public.email_attachments
  drop constraint if exists email_attachments_company_id_message_id_attachment_id_key;

alter table public.email_attachments
  add constraint email_attachments_mailbox_identity_id_key
  unique (company_id, connection_id, message_id, attachment_id, id);

alter table public.attachment_inspections
  add constraint attachment_inspections_exact_attachment_identity_fkey
  foreign key (
    company_id,
    connection_id,
    message_id,
    attachment_id,
    email_attachment_id
  ) references public.email_attachments (
    company_id,
    connection_id,
    message_id,
    attachment_id,
    id
  ) on delete cascade;

create unique index if not exists attachment_inspections_attachment_unique
  on public.attachment_inspections (email_attachment_id);

drop index if exists public.attachment_inspections_mailbox_identity_unique;

create unique index attachment_inspections_mailbox_identity_unique
  on public.attachment_inspections (
    company_id,
    connection_id,
    message_id,
    attachment_id
  );

do $attachment_inspection_index_validation$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname =
        'attachment_inspections_mailbox_identity_unique'
      and index_definition.indrelid =
        'public.attachment_inspections'::regclass
      and index_definition.indisunique
      and index_definition.indimmediate
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 4
      and index_definition.indnatts = 4
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        1,
        true
      ) = 'company_id'
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        2,
        true
      ) = 'connection_id'
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        3,
        true
      ) = 'message_id'
      and pg_catalog.pg_get_indexdef(
        index_definition.indexrelid,
        4,
        true
      ) = 'attachment_id'
  ) then
    raise exception
      'agent_provider_delivery_source_prerequisite_invalid: exact attachment_inspections_mailbox_identity_unique'
      using errcode = '55000';
  end if;
end;
$attachment_inspection_index_validation$;

alter table public.attachment_inspections
  drop constraint if exists attachment_inspections_company_id_message_id_attachment_id_key;

-- Provider evidence must survive an ordinary mailbox disconnect, but full
-- account closure must still erase it. A public root contains no message data;
-- the manifest purges it through the tenant-marker helper, which cascades into
-- the private immutable ledger without coupling retention to OAuth state.
create table public.agent_control_plane_tenant_roots (
  company_id uuid primary key
    references public.companies(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.agent_control_plane_tenant_roots is
  'Tenant-owned purge root for private agent-control-plane state. Contains no customer content.';

alter table public.agent_control_plane_tenant_roots enable row level security;

revoke all on table public.agent_control_plane_tenant_roots
  from public, anon, authenticated, service_role;

create trigger agent_control_plane_tenant_root_immutable
before update or delete on public.agent_control_plane_tenant_roots
for each row execute function private.reject_agent_job_memory_mutation();

create table private.agent_provider_delivery_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.agent_control_plane_tenant_roots(company_id)
    on delete cascade,
  -- Deliberately not an FK: disconnect deletes OAuth/mailbox state while exact
  -- delivered evidence remains available to job memory until account closure.
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
  content_charset text
    check (
      content_charset is null
      or (
        content_charset = lower(btrim(content_charset))
        and nullif(content_charset, '') is not null
        and octet_length(content_charset) <= 64
        and content_charset ~ '^[a-z0-9._:-]+$'
      )
    ),
  content_source_kind text not null
    check (
      content_source_kind in (
        'gmail_mime_part',
        'microsoft_graph_body',
        'ops_rendered_outbound'
      )
    ),
  content_selection_revision text not null
    check (
      content_selection_revision = btrim(content_selection_revision)
      and nullif(content_selection_revision, '') is not null
      and octet_length(content_selection_revision) <= 256
  ),
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
  check (jsonb_typeof(attachment_descriptors) = 'array'),
  check (cardinality(attachment_evidence_ids) <= 100),
  check (
    provider_part_id is null
    or (
      provider_part_id = btrim(provider_part_id)
      and nullif(provider_part_id, '') is not null
      and octet_length(provider_part_id) <= 512
    )
  ),
  check (
    provider_body_attachment_id is null
    or (
      provider_body_attachment_id = btrim(provider_body_attachment_id)
      and nullif(provider_body_attachment_id, '') is not null
      and octet_length(provider_body_attachment_id) <= 512
    )
  )
);

comment on table private.agent_provider_delivery_sources is
  'Immutable exact provider message content captured after delivery proof and before mutable OPS email projections. Direct access is denied; account erasure cascades through the tenant ledger root while mailbox disconnect preserves evidence.';

create index agent_provider_delivery_sources_connection_idx
  on private.agent_provider_delivery_sources (connection_id);

create index agent_provider_delivery_sources_company_delivered_idx
  on private.agent_provider_delivery_sources (
    company_id,
    delivered_at desc,
    id desc
  );

alter table private.agent_provider_delivery_sources enable row level security;

revoke all on table private.agent_provider_delivery_sources from public, anon, authenticated, service_role;

-- Provider evidence is append-only. The shared memory mutation guard permits
-- deletion only inside the audited, tenant-bound account-erasure transaction.
create trigger agent_provider_delivery_sources_immutable
before update or delete on private.agent_provider_delivery_sources
for each row execute function private.reject_agent_job_memory_mutation();

-- Polymorphic intent authority is stored with concrete tenant-bound foreign
-- keys. These composite indexes prevent a globally valid intent UUID from ever
-- being paired with a different company in the private attestation.
create unique index if not exists email_send_intents_company_id_id_uidx
  on public.email_send_intents (company_id, id);

create unique index if not exists approved_action_email_intents_company_id_id_uidx
  on public.approved_action_email_intents (company_id, id);

create table private.agent_provider_outbound_authority_attestations (
  company_id uuid not null
    references public.companies(id) on delete cascade,
  provider_source_id uuid not null,
  source_sha256 text not null
    check (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  accepted_intent_kind text not null
    check (accepted_intent_kind in (
      'email_send_intent',
      'approved_action_email_intent'
    )),
  email_send_intent_id uuid,
  approved_action_email_intent_id uuid,
  accepted_intent_id uuid generated always as (
    coalesce(email_send_intent_id, approved_action_email_intent_id)
  ) stored,
  actor_user_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  attested_at timestamptz not null default clock_timestamp(),
  primary key (company_id, provider_source_id),
  unique (company_id, accepted_intent_kind, accepted_intent_id),
  foreign key (company_id, provider_source_id, source_sha256)
    references private.agent_provider_delivery_sources(
      company_id,
      id,
      source_sha256
    ) on delete cascade,
  foreign key (company_id, email_send_intent_id)
    references public.email_send_intents(company_id, id) on delete restrict,
  foreign key (company_id, approved_action_email_intent_id)
    references public.approved_action_email_intents(company_id, id)
    on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.users(company_id, id) on delete restrict,
  foreign key (company_id, opportunity_id)
    references public.opportunities(company_id, id) on delete restrict,
  foreign key (company_id, project_id)
    references public.projects(company_id, id) on delete restrict,
  check (
    (accepted_intent_kind = 'email_send_intent'
      and email_send_intent_id is not null
      and approved_action_email_intent_id is null)
    or
    (accepted_intent_kind = 'approved_action_email_intent'
      and email_send_intent_id is null
      and approved_action_email_intent_id is not null)
  )
);

comment on table private.agent_provider_outbound_authority_attestations is
  'Append-only accepted OPS outbound authority bound to one tenant-owned immutable provider source and its exact content hash.';

alter table private.agent_provider_outbound_authority_attestations
  enable row level security;

revoke all on table private.agent_provider_outbound_authority_attestations
  from public, anon, authenticated, service_role;

create trigger agent_provider_outbound_authority_immutable
before update or delete
on private.agent_provider_outbound_authority_attestations
for each row execute function private.reject_agent_job_memory_mutation();

create or replace function private.agent_provider_email_identity_is_valid(
  p_value text
) returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
  select p_value is not null
    and p_value = lower(pg_catalog.btrim(p_value))
    and pg_catalog.octet_length(p_value) between 3 and 512
    and p_value ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and private.agent_prompt_text_is_safe(p_value, false);
$function$;

create or replace function private.agent_provider_identity_array_is_canonical(
  p_values text[],
  p_maximum integer
) returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
  v_previous text;
begin
  if p_values is null
     or p_maximum < 0
     or cardinality(p_values) > p_maximum then
    return false;
  end if;

  foreach v_value in array p_values loop
    if not private.agent_provider_email_identity_is_valid(v_value)
       or (
         v_previous is not null
         and (v_value collate "C") <= (v_previous collate "C")
       ) then
      return false;
    end if;
    v_previous := v_value;
  end loop;
  return true;
end;
$function$;

create or replace function private.agent_provider_canonical_identities(
  p_values text[]
) returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    pg_catalog.array_agg(identity order by identity collate "C"),
    '{}'::text[]
  )
  from (
    select distinct lower(pg_catalog.btrim(value)) as identity
    from pg_catalog.unnest(coalesce(p_values, '{}'::text[])) as item(value)
    where nullif(pg_catalog.btrim(value), '') is not null
  ) canonical;
$function$;

revoke all on function private.agent_provider_email_identity_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_provider_identity_array_is_canonical(
  text[], integer
) from public, anon, authenticated, service_role;
revoke all on function private.agent_provider_canonical_identities(text[])
  from public, anon, authenticated, service_role;

create or replace function public.preflight_agent_provider_delivery_source_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider text,
  p_provider_thread_id text,
  p_direction text
) returns table (
  source_id uuid,
  source_sha256 text,
  company_id uuid,
  connection_id uuid,
  provider_message_id text,
  provider text,
  provider_thread_id text,
  direction text,
  inserted boolean
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_provider_message_id is distinct from btrim(p_provider_message_id)
     or octet_length(p_provider_message_id) > 512
     or p_provider not in ('gmail', 'microsoft365')
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
     or octet_length(p_provider_thread_id) > 512
     or p_direction not in ('inbound', 'outbound') then
    raise exception 'agent_provider_delivery_source_preflight_invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.provider = p_provider;
  if not found then
    raise exception 'agent_provider_delivery_source_connection_invalid'
      using errcode = '23503';
  end if;

  return query
  select source.id,
         source.source_sha256,
         source.company_id,
         source.connection_id,
         source.provider_message_id,
         source.provider,
         source.provider_thread_id,
         source.direction,
         false
  from private.agent_provider_delivery_sources source
  where source.company_id = p_company_id
    and source.connection_id = p_connection_id
    and source.provider_message_id = btrim(p_provider_message_id)
    and exists (
      select 1
      from public.email_connections connection
      where connection.id = source.connection_id
        and connection.company_id = source.company_id::text
    );
end;
$function$;

revoke all on function public.preflight_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.preflight_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.capture_agent_provider_delivery_source_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_direction text,
  p_delivered_at timestamptz,
  p_subject text,
  p_sender_identity text,
  p_recipient_identities text[],
  p_cc_recipient_identities text[],
  p_content_media_type text,
  p_content_value text,
  p_content_charset text,
  p_content_source_kind text,
  p_content_selection_revision text,
  p_provider_part_id text,
  p_provider_body_attachment_id text,
  p_outbound_intent_kind text,
  p_outbound_intent_id uuid,
  p_attachment_enumeration_complete boolean,
  p_attachment_descriptors jsonb
) returns table (
  source_id uuid,
  source_sha256 text,
  inserted boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_approved_action_candidate_ids uuid[] := '{}'::uuid[];
  v_approved_action_intent public.approved_action_email_intents%rowtype;
  v_attachment public.email_attachments%rowtype;
  v_attachment_id uuid;
  v_attachment_evidence_ids text[] := '{}'::text[];
  v_attachment_provider_id text;
  v_canonical_descriptor jsonb;
  v_canonical_descriptors jsonb := '[]'::jsonb;
  v_content_id text;
  v_descriptor jsonb;
  v_descriptor_message_id text;
  v_existing_authority
    private.agent_provider_outbound_authority_attestations%rowtype;
  v_existing_source private.agent_provider_delivery_sources%rowtype;
  v_email_send_candidate_ids uuid[] := '{}'::uuid[];
  v_email_send_intent public.email_send_intents%rowtype;
  v_filename text;
  v_from_email text;
  v_is_inline boolean;
  v_mime_type text;
  v_occurred_at timestamptz;
  v_outbound_actor_user_id uuid;
  v_outbound_intent_id uuid := p_outbound_intent_id;
  v_outbound_intent_kind text := p_outbound_intent_kind;
  v_outbound_opportunity_id uuid;
  v_outbound_project_id uuid;
  v_previous_attachment_provider_id text;
  v_provider_kind text;
  v_provider_part_id text;
  v_size_bytes bigint;
  v_source_envelope jsonb;
  v_source_id uuid;
  v_source_sha256 text;
  v_source_url text;
  v_inserted boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_connection_id is null
     or p_provider not in ('gmail', 'microsoft365')
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_provider_message_id is distinct from btrim(p_provider_message_id)
     or octet_length(p_provider_message_id) > 512
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
     or octet_length(p_provider_thread_id) > 512
     or p_direction not in ('inbound', 'outbound')
     or p_delivered_at is null
     or p_subject is null
     or octet_length(p_subject) > 8192
     or not private.agent_provider_email_identity_is_valid(
       p_sender_identity
     )
     or cardinality(p_recipient_identities) > 100
     or cardinality(p_cc_recipient_identities) > 100
     or not private.agent_provider_identity_array_is_canonical(
       p_recipient_identities,
       100
     )
     or not private.agent_provider_identity_array_is_canonical(
       p_cc_recipient_identities,
       100
     )
     or p_content_media_type not in ('text/plain', 'text/html')
     or p_content_value is null
     or octet_length(p_content_value) > 8388608
     or (
       p_content_charset is not null
       and (
         p_content_charset is distinct from lower(btrim(p_content_charset))
         or nullif(p_content_charset, '') is null
         or octet_length(p_content_charset) > 64
         or p_content_charset !~ '^[a-z0-9._:-]+$'
       )
     )
     or nullif(btrim(coalesce(p_content_selection_revision, '')), '') is null
     or p_content_selection_revision
       is distinct from btrim(p_content_selection_revision)
     or octet_length(p_content_selection_revision) > 256
     or (
       p_provider_part_id is not null
       and (
         p_provider_part_id is distinct from btrim(p_provider_part_id)
         or nullif(p_provider_part_id, '') is null
         or octet_length(p_provider_part_id) > 512
       )
     )
     or (
       p_provider_body_attachment_id is not null
       and (
         p_provider_body_attachment_id
           is distinct from btrim(p_provider_body_attachment_id)
         or nullif(p_provider_body_attachment_id, '') is null
         or octet_length(p_provider_body_attachment_id) > 512
       )
     )
     or p_attachment_enumeration_complete is distinct from true
     or p_attachment_descriptors is null
     or jsonb_typeof(p_attachment_descriptors) <> 'array'
     or jsonb_array_length(p_attachment_descriptors) > 100 then
    raise exception 'agent_provider_delivery_source_invalid'
      using errcode = '22023';
  end if;

  if (
    p_content_source_kind = 'gmail_mime_part'
    and (
      p_provider <> 'gmail'
      or p_content_selection_revision
        <> 'gmail.mime.text-plain-first.charset-decoded.v2'
      or p_content_charset is null
      or p_outbound_intent_kind is not null
      or p_outbound_intent_id is not null
    )
  ) or (
    p_content_source_kind = 'microsoft_graph_body'
    and (
      p_provider <> 'microsoft365'
      or p_content_selection_revision <> 'microsoft.graph.body.v1'
      or p_content_charset is not null
      or p_outbound_intent_kind is not null
      or p_outbound_intent_id is not null
    )
  ) or (
    p_content_source_kind = 'ops_rendered_outbound'
    and (
      p_direction <> 'outbound'
      or p_content_selection_revision
        <> 'ops.accepted-send.rendered-body.v1'
      or p_content_charset is not null
      or p_outbound_intent_kind not in (
        'email_send_intent',
        'approved_action_email_intent'
      )
      or p_outbound_intent_id is null
      or jsonb_array_length(p_attachment_descriptors) <> 0
    )
  ) or p_content_source_kind not in (
    'gmail_mime_part',
    'microsoft_graph_body',
    'ops_rendered_outbound'
  ) then
    raise exception 'agent_provider_delivery_source_content_invalid'
      using errcode = '22023';
  end if;

  perform 1
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.provider = p_provider
  for share;
  if not found then
    raise exception 'agent_provider_delivery_source_connection_invalid'
      using errcode = '23503';
  end if;

  insert into public.agent_control_plane_tenant_roots (company_id)
  values (p_company_id)
  on conflict (company_id) do nothing;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'agent-provider-delivery-source:v1:'
        || p_company_id::text || ':'
        || p_connection_id::text || ':'
        || p_provider_message_id,
      0
    )
  );

  if p_content_source_kind = 'ops_rendered_outbound' then
    if p_outbound_intent_kind = 'email_send_intent' then
      select intent.actor_user_id,
             intent.opportunity_id
      into v_outbound_actor_user_id,
           v_outbound_opportunity_id
      from public.email_send_intents intent
      where intent.id = p_outbound_intent_id
        and intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
        and intent.provider_accepted_at = p_delivered_at
        and lower(btrim(intent.client_from_address_snapshot))
          = p_sender_identity
        and private.agent_provider_canonical_identities(intent.to_emails)
          = p_recipient_identities
        and private.agent_provider_canonical_identities(intent.cc_emails)
          = p_cc_recipient_identities
        and intent.subject = p_subject
        and intent.rendered_body = p_content_value
        and (
          (intent.content_type = 'text'
            and p_content_media_type = 'text/plain')
          or
          (intent.content_type = 'html'
            and p_content_media_type = 'text/html')
        )
        and intent.rendered_body_hash = encode(
          extensions.digest(
            convert_to(p_content_value, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      for share;
    elsif p_outbound_intent_kind = 'approved_action_email_intent' then
      select intent.actor_user_id,
             intent.opportunity_id,
             intent.project_id
      into v_outbound_actor_user_id,
           v_outbound_opportunity_id,
           v_outbound_project_id
      from public.approved_action_email_intents intent
      where intent.id = p_outbound_intent_id
        and intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
        and intent.provider_accepted_at = p_delivered_at
        and lower(btrim(intent.client_from_address_snapshot))
          = p_sender_identity
        and private.agent_provider_canonical_identities(intent.to_emails)
          = p_recipient_identities
        and private.agent_provider_canonical_identities(intent.cc_emails)
          = p_cc_recipient_identities
        and intent.subject = p_subject
        and intent.rendered_body = p_content_value
        and (
          (intent.content_type = 'text'
            and p_content_media_type = 'text/plain')
          or
          (intent.content_type = 'html'
            and p_content_media_type = 'text/html')
        )
        and intent.rendered_body_hash = encode(
          extensions.digest(
            convert_to(p_content_value, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      for share;
    end if;

    if not found then
      raise exception 'agent_provider_delivery_outbound_intent_invalid'
        using errcode = '23503';
    end if;
  end if;

  -- Provider sync can observe the accepted message before the reconciliation
  -- worker reaches this RPC. Resolve exactly one already-accepted intent while
  -- holding the same delivery-key lock so native content cannot be materialized
  -- into an immutable ops:system turn before its actor/job authority exists.
  if p_direction = 'outbound'
     and p_content_source_kind in (
       'gmail_mime_part',
       'microsoft_graph_body'
     ) then
    select array(
      select intent.id
      from public.email_send_intents intent
      where intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
      order by intent.id
      for share
    ) into v_email_send_candidate_ids;

    select array(
      select intent.id
      from public.approved_action_email_intents intent
      where intent.company_id = p_company_id
        and intent.connection_id = p_connection_id
        and intent.status in (
          'provider_accepted',
          'reconciling',
          'reconciliation_failed',
          'reconciled'
        )
        and intent.provider_message_id = p_provider_message_id
        and intent.accepted_provider_thread_id = p_provider_thread_id
      order by intent.id
      for share
    ) into v_approved_action_candidate_ids;

    if cardinality(v_email_send_candidate_ids)
         + cardinality(v_approved_action_candidate_ids) > 1 then
      raise exception 'agent_provider_delivery_outbound_intent_ambiguous'
        using errcode = '23505';
    elsif cardinality(v_email_send_candidate_ids) = 1 then
      select intent.*
      into v_email_send_intent
      from public.email_send_intents intent
      where intent.company_id = p_company_id
        and intent.id = v_email_send_candidate_ids[1]
      for share;

      if not found
         or lower(btrim(v_email_send_intent.client_from_address_snapshot))
           is distinct from p_sender_identity
         or private.agent_provider_canonical_identities(
           v_email_send_intent.to_emails
         ) is distinct from p_recipient_identities
         or private.agent_provider_canonical_identities(
           v_email_send_intent.cc_emails
         ) is distinct from p_cc_recipient_identities
         or v_email_send_intent.subject is distinct from p_subject
         or v_email_send_intent.rendered_body_hash is distinct from encode(
           extensions.digest(
             convert_to(v_email_send_intent.rendered_body, 'UTF8'),
             'sha256'
           ),
           'hex'
         ) then
        raise exception 'agent_provider_delivery_outbound_intent_invalid'
          using errcode = '23503';
      end if;

      v_outbound_intent_kind := 'email_send_intent';
      v_outbound_intent_id := v_email_send_intent.id;
      v_outbound_actor_user_id := v_email_send_intent.actor_user_id;
      v_outbound_opportunity_id := v_email_send_intent.opportunity_id;
      v_outbound_project_id := null;
    elsif cardinality(v_approved_action_candidate_ids) = 1 then
      select intent.*
      into v_approved_action_intent
      from public.approved_action_email_intents intent
      where intent.company_id = p_company_id
        and intent.id = v_approved_action_candidate_ids[1]
      for share;

      if not found
         or lower(btrim(
           v_approved_action_intent.client_from_address_snapshot
         )) is distinct from p_sender_identity
         or private.agent_provider_canonical_identities(
           v_approved_action_intent.to_emails
         ) is distinct from p_recipient_identities
         or private.agent_provider_canonical_identities(
           v_approved_action_intent.cc_emails
         ) is distinct from p_cc_recipient_identities
         or v_approved_action_intent.subject is distinct from p_subject
         or v_approved_action_intent.rendered_body is null
         or v_approved_action_intent.rendered_body_hash
           is distinct from encode(
             extensions.digest(
               convert_to(v_approved_action_intent.rendered_body, 'UTF8'),
               'sha256'
             ),
             'hex'
           ) then
        raise exception 'agent_provider_delivery_outbound_intent_invalid'
          using errcode = '23503';
      end if;

      v_outbound_intent_kind := 'approved_action_email_intent';
      v_outbound_intent_id := v_approved_action_intent.id;
      v_outbound_actor_user_id := v_approved_action_intent.actor_user_id;
      v_outbound_opportunity_id := v_approved_action_intent.opportunity_id;
      v_outbound_project_id := v_approved_action_intent.project_id;
    end if;
  end if;

  for v_descriptor in
    select descriptor.value
    from jsonb_array_elements(p_attachment_descriptors)
      with ordinality descriptor(value, position)
    order by descriptor.position
  loop
    if jsonb_typeof(v_descriptor) <> 'object'
       or not v_descriptor ?& array[
         'attachment_id',
         'filename',
         'mime_type',
         'size_bytes',
         'provider_kind',
         'provider_part_id',
         'content_id',
         'is_inline',
         'source_url',
         'occurred_at',
         'from_email'
       ]
       or v_descriptor - array[
         'attachment_id',
         'filename',
         'mime_type',
         'size_bytes',
         'provider_kind',
         'provider_part_id',
         'content_id',
         'is_inline',
         'source_url',
         'occurred_at',
         'from_email'
       ] <> '{}'::jsonb then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end if;

    begin
      v_attachment_provider_id := v_descriptor ->> 'attachment_id';
      v_filename := v_descriptor ->> 'filename';
      v_mime_type := v_descriptor ->> 'mime_type';
      v_size_bytes := (v_descriptor ->> 'size_bytes')::bigint;
      v_provider_kind := v_descriptor ->> 'provider_kind';
      v_provider_part_id := v_descriptor ->> 'provider_part_id';
      v_content_id := v_descriptor ->> 'content_id';
      v_is_inline := (v_descriptor ->> 'is_inline')::boolean;
      v_source_url := v_descriptor ->> 'source_url';
      v_occurred_at := (v_descriptor ->> 'occurred_at')::timestamptz;
      v_from_email := v_descriptor ->> 'from_email';
      v_descriptor_message_id := p_provider_message_id;
    exception when others then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end;

    if nullif(btrim(coalesce(v_attachment_provider_id, '')), '') is null
       or v_attachment_provider_id
         is distinct from btrim(v_attachment_provider_id)
       or octet_length(v_attachment_provider_id) > 512
       or (
         v_previous_attachment_provider_id is not null
         and (v_attachment_provider_id collate "C")
           <= (v_previous_attachment_provider_id collate "C")
       )
       or v_filename is null
       or octet_length(v_filename) > 4096
       or nullif(btrim(coalesce(v_mime_type, '')), '') is null
       or v_mime_type is distinct from lower(btrim(v_mime_type))
       or octet_length(v_mime_type) > 255
       or v_size_bytes is null
       or v_size_bytes < 0
       or v_provider_kind not in ('file', 'inline', 'item', 'reference')
       or (
         v_provider_part_id is not null
         and (
           nullif(btrim(v_provider_part_id), '') is null
           or v_provider_part_id is distinct from btrim(v_provider_part_id)
           or octet_length(v_provider_part_id) > 512
         )
       )
       or (
         v_content_id is not null
         and (
           nullif(btrim(v_content_id), '') is null
           or v_content_id is distinct from btrim(v_content_id)
           or octet_length(v_content_id) > 512
         )
       )
       or v_is_inline is null
       or (
         v_source_url is not null
         and (
           nullif(v_source_url, '') is null
           or octet_length(v_source_url) > 8192
         )
       )
       or v_occurred_at is distinct from p_delivered_at
       or v_descriptor_message_id is distinct from p_provider_message_id
       or not private.agent_provider_email_identity_is_valid(v_from_email)
       or v_from_email is distinct from p_sender_identity then
      raise exception 'agent_provider_delivery_attachment_descriptor_invalid'
        using errcode = '22023';
    end if;

    begin
      insert into public.email_attachments (
        company_id,
        connection_id,
        provider_thread_id,
        message_id,
        attachment_id,
        filename,
        mime_type,
        size_bytes,
        from_email,
        provider_kind,
        provider_part_id,
        content_id,
        is_inline,
        occurred_at,
        source_url,
        ingest_status,
        attribution_status,
        last_seen_at,
        updated_at
      ) values (
        p_company_id,
        p_connection_id,
        p_provider_thread_id,
        v_descriptor_message_id,
        v_attachment_provider_id,
        v_filename,
        v_mime_type,
        v_size_bytes,
        v_from_email,
        v_provider_kind,
        v_provider_part_id,
        v_content_id,
        v_is_inline,
        v_occurred_at,
        v_source_url,
        'discovered',
        'pending',
        clock_timestamp(),
        clock_timestamp()
      )
      on conflict (company_id, connection_id, message_id, attachment_id)
      do nothing;
    exception when unique_violation then
      raise exception
        'agent_provider_delivery_attachment_idempotency_conflict'
        using errcode = '23505';
    end;

    select attachment.*
    into v_attachment
    from public.email_attachments attachment
    where attachment.company_id = p_company_id
      and attachment.connection_id = p_connection_id
      and attachment.message_id = v_descriptor_message_id
      and attachment.attachment_id = v_attachment_provider_id
    for share;

    if not found
       or v_attachment.provider_thread_id
         is distinct from p_provider_thread_id
       or v_attachment.filename is distinct from v_filename
       or lower(v_attachment.mime_type) is distinct from v_mime_type
       or v_attachment.size_bytes is distinct from v_size_bytes
       or lower(btrim(v_attachment.from_email)) is distinct from v_from_email
       or v_attachment.provider_kind is distinct from v_provider_kind
       or v_attachment.provider_part_id is distinct from v_provider_part_id
       or v_attachment.content_id is distinct from v_content_id
       or v_attachment.is_inline is distinct from v_is_inline
       or v_attachment.occurred_at is distinct from v_occurred_at
       or v_attachment.source_url is distinct from v_source_url then
      raise exception
        'agent_provider_delivery_attachment_idempotency_conflict'
        using errcode = '23505';
    end if;

    v_attachment_id := v_attachment.id;
    v_attachment_evidence_ids := pg_catalog.array_append(
      v_attachment_evidence_ids,
      'email_attachment:' || v_attachment_id::text
    );
    if v_attachment_evidence_ids[cardinality(v_attachment_evidence_ids)]
       !~ '^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'agent_provider_delivery_attachment_identity_invalid'
        using errcode = '22023';
    end if;

    v_canonical_descriptor := jsonb_build_object(
      'attachment_id', v_attachment_provider_id,
      'filename', v_filename,
      'mime_type', v_mime_type,
      'size_bytes', v_size_bytes,
      'provider_kind', v_provider_kind,
      'provider_part_id', v_provider_part_id,
      'content_id', v_content_id,
      'is_inline', v_is_inline,
      'source_url', v_source_url,
      'occurred_at', to_char(
        v_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'from_email', v_from_email
    );
    v_canonical_descriptors := v_canonical_descriptors
      || jsonb_build_array(v_canonical_descriptor);
    v_previous_attachment_provider_id := v_attachment_provider_id;
  end loop;

  select coalesce(
    array_agg(evidence_id order by evidence_id collate "C"),
    '{}'::text[]
  )
  into v_attachment_evidence_ids
  from unnest(v_attachment_evidence_ids) evidence(evidence_id);

  v_source_envelope := jsonb_build_object(
    'schema', 'ops.agent-provider-delivery-source.v1',
    'company_id', p_company_id,
    'connection_id', p_connection_id,
    'provider', p_provider,
    'provider_message_id', p_provider_message_id,
    'provider_thread_id', p_provider_thread_id,
    'direction', p_direction,
    'delivered_at', to_char(
      p_delivered_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'subject', p_subject,
    'sender_identity', p_sender_identity,
    'recipient_identities', to_jsonb(p_recipient_identities),
    'cc_recipient_identities', to_jsonb(p_cc_recipient_identities),
    'content_media_type', p_content_media_type,
    'content_value', p_content_value,
    'content_charset', p_content_charset,
    'content_source_kind', p_content_source_kind,
    'content_selection_revision', p_content_selection_revision,
    'provider_part_id', p_provider_part_id,
    'provider_body_attachment_id', p_provider_body_attachment_id,
    'attachment_enumeration_complete', true,
    'attachment_descriptors', v_canonical_descriptors,
    'attachment_evidence_ids', to_jsonb(v_attachment_evidence_ids)
  );
  v_source_sha256 := 'sha256:' || encode(
    extensions.digest(
      convert_to(v_source_envelope::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into private.agent_provider_delivery_sources (
    company_id,
    connection_id,
    provider,
    provider_message_id,
    provider_thread_id,
    direction,
    delivered_at,
    subject,
    sender_identity,
    recipient_identities,
    cc_recipient_identities,
    content_media_type,
    content_value,
    content_charset,
    content_source_kind,
    content_selection_revision,
    provider_part_id,
    provider_body_attachment_id,
    attachment_enumeration_complete,
    attachment_descriptors,
    attachment_evidence_ids,
    source_sha256
  ) values (
    p_company_id,
    p_connection_id,
    p_provider,
    p_provider_message_id,
    p_provider_thread_id,
    p_direction,
    p_delivered_at,
    p_subject,
    p_sender_identity,
    p_recipient_identities,
    p_cc_recipient_identities,
    p_content_media_type,
    p_content_value,
    p_content_charset,
    p_content_source_kind,
    p_content_selection_revision,
    p_provider_part_id,
    p_provider_body_attachment_id,
    true,
    v_canonical_descriptors,
    v_attachment_evidence_ids,
    v_source_sha256
  )
  on conflict (company_id, connection_id, provider_message_id)
  do nothing
  returning id into v_source_id;

  v_inserted := v_source_id is not null;
  if not v_inserted then
    select source.*
    into v_existing_source
    from private.agent_provider_delivery_sources source
    where source.company_id = p_company_id
      and source.connection_id = p_connection_id
      and source.provider_message_id = p_provider_message_id
    for share;

    if not found
       or v_existing_source.provider is distinct from p_provider
       or v_existing_source.provider_thread_id
         is distinct from p_provider_thread_id
       or v_existing_source.direction is distinct from p_direction then
      raise exception
        'agent_provider_delivery_source_idempotency_conflict'
        using errcode = '23505';
    end if;

    if v_existing_source.content_source_kind = p_content_source_kind then
      if v_existing_source.delivered_at is distinct from p_delivered_at
         or v_existing_source.subject is distinct from p_subject
         or v_existing_source.sender_identity
           is distinct from p_sender_identity
         or v_existing_source.recipient_identities
           is distinct from p_recipient_identities
         or v_existing_source.cc_recipient_identities
           is distinct from p_cc_recipient_identities
         or v_existing_source.content_media_type
           is distinct from p_content_media_type
         or v_existing_source.content_value is distinct from p_content_value
         or v_existing_source.content_charset
           is distinct from p_content_charset
         or v_existing_source.content_selection_revision
           is distinct from p_content_selection_revision
         or v_existing_source.provider_part_id
           is distinct from p_provider_part_id
         or v_existing_source.provider_body_attachment_id
           is distinct from p_provider_body_attachment_id
         or v_existing_source.attachment_enumeration_complete
           is distinct from true
         or v_existing_source.attachment_descriptors
           is distinct from v_canonical_descriptors
         or v_existing_source.attachment_evidence_ids
           is distinct from v_attachment_evidence_ids
         or v_existing_source.source_sha256
           is distinct from v_source_sha256 then
        raise exception
          'agent_provider_delivery_source_idempotency_conflict'
          using errcode = '23505';
      end if;
    elsif not (
      p_direction = 'outbound'
      and (
        (
          v_existing_source.content_source_kind = 'ops_rendered_outbound'
          and p_content_source_kind in (
            'gmail_mime_part',
            'microsoft_graph_body'
          )
        )
        or
        (
          p_content_source_kind = 'ops_rendered_outbound'
          and v_existing_source.content_source_kind in (
            'gmail_mime_part',
            'microsoft_graph_body'
          )
        )
      )
    ) then
      raise exception
        'agent_provider_delivery_source_idempotency_conflict'
        using errcode = '23505';
    end if;

    v_source_id := v_existing_source.id;
    v_source_sha256 := v_existing_source.source_sha256;
  end if;

  if v_outbound_intent_kind is not null then
    begin
      insert into private.agent_provider_outbound_authority_attestations (
        company_id,
        provider_source_id,
        source_sha256,
        accepted_intent_kind,
        email_send_intent_id,
        approved_action_email_intent_id,
        actor_user_id,
        opportunity_id,
        project_id
      ) values (
        p_company_id,
        v_source_id,
        v_source_sha256,
        v_outbound_intent_kind,
        case
          when v_outbound_intent_kind = 'email_send_intent'
            then v_outbound_intent_id
          else null
        end,
        case
          when v_outbound_intent_kind = 'approved_action_email_intent'
            then v_outbound_intent_id
          else null
        end,
        v_outbound_actor_user_id,
        v_outbound_opportunity_id,
        v_outbound_project_id
      )
      on conflict (company_id, provider_source_id) do nothing;
    exception when unique_violation then
      raise exception
        'agent_provider_outbound_authority_idempotency_conflict'
        using errcode = '23505';
    end;

    select authority.*
    into v_existing_authority
    from private.agent_provider_outbound_authority_attestations authority
    where authority.company_id = p_company_id
      and authority.provider_source_id = v_source_id
    for share;

    if not found
       or v_existing_authority.source_sha256
         is distinct from v_source_sha256
       or v_existing_authority.accepted_intent_kind
         is distinct from v_outbound_intent_kind
       or v_existing_authority.accepted_intent_id
         is distinct from v_outbound_intent_id
       or v_existing_authority.actor_user_id
         is distinct from v_outbound_actor_user_id
       or v_existing_authority.opportunity_id
         is distinct from v_outbound_opportunity_id
       or v_existing_authority.project_id
         is distinct from v_outbound_project_id then
      raise exception
        'agent_provider_outbound_authority_idempotency_conflict'
        using errcode = '23505';
    end if;
  end if;

  return query select v_source_id, v_source_sha256, v_inserted;
end;
$function$;

revoke all on function public.capture_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text, timestamptz, text, text,
  text[], text[], text, text, text, text, text, text, text, text, uuid,
  boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.capture_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text, timestamptz, text, text,
  text[], text[], text, text, text, text, text, text, text, text, uuid,
  boolean, jsonb
) to service_role;

create or replace function public.read_agent_provider_delivery_source_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_source_activity_id uuid
) returns table (
  source_id uuid,
  company_id uuid,
  connection_id uuid,
  provider text,
  provider_message_id text,
  provider_thread_id text,
  direction text,
  delivered_at timestamptz,
  subject text,
  sender_identity text,
  recipient_identities text[],
  cc_recipient_identities text[],
  content_media_type text,
  content_value text,
  content_charset text,
  content_source_kind text,
  content_selection_revision text,
  provider_part_id text,
  provider_body_attachment_id text,
  attachment_enumeration_complete boolean,
  attachment_evidence_ids text[],
  source_sha256 text,
  captured_at timestamptz,
  source_activity_id uuid,
  activity_opportunity_id uuid,
  activity_project_id text,
  actor_user_id uuid,
  source_correspondence_event jsonb,
  confirmed_customer_participants jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_source_activity_id is null then
    raise exception 'agent_provider_delivery_source_read_invalid'
      using errcode = '22023';
  end if;

  return query
  select source.id,
         source.company_id,
         source.connection_id,
         source.provider,
         source.provider_message_id,
         source.provider_thread_id,
         source.direction,
         source.delivered_at,
         source.subject,
         source.sender_identity,
         source.recipient_identities,
         source.cc_recipient_identities,
         source.content_media_type,
         source.content_value,
         source.content_charset,
         source.content_source_kind,
         source.content_selection_revision,
         source.provider_part_id,
         source.provider_body_attachment_id,
         source.attachment_enumeration_complete,
         source.attachment_evidence_ids,
         source.source_sha256,
         source.captured_at,
         activity.id as source_activity_id,
         activity.opportunity_id as activity_opportunity_id,
         activity.project_id as activity_project_id,
         case
           when authority.provider_source_id is not null
             then authority.actor_user_id
           else null
         end as actor_user_id,
         case
           when event.id is null then null
           else jsonb_build_object(
             'id', event.id,
             'opportunity_id', event.opportunity_id,
             'activity_id', event.activity_id,
             'connection_id', event.connection_id,
             'provider_message_id', event.provider_message_id,
             'direction', event.direction,
             'party_role', event.party_role,
             'from_email', event.from_email
           )
         end as source_correspondence_event,
         coalesce(participants.confirmed, '[]'::jsonb)
           as confirmed_customer_participants
  from private.agent_provider_delivery_sources source
  left join private.agent_provider_outbound_authority_attestations authority
    on authority.company_id = source.company_id
   and authority.provider_source_id = source.id
   and authority.source_sha256 = source.source_sha256
  join public.activities activity
    on activity.company_id = source.company_id
   and activity.email_connection_id = source.connection_id
   and activity.email_message_id = source.provider_message_id
   and activity.id = p_source_activity_id
   and activity.type = 'email'
   and activity.direction = source.direction
  left join public.opportunity_correspondence_events event
    on event.company_id = source.company_id
   and event.activity_id = activity.id
   and event.connection_id = source.connection_id
   and event.provider_message_id = source.provider_message_id
   and event.direction = source.direction
   and event.opportunity_id = activity.opportunity_id
  left join public.opportunities opportunity
    on opportunity.id = activity.opportunity_id
   and opportunity.company_id = source.company_id
   and opportunity.deleted_at is null
  left join public.projects project
    on project.id::text = activity.project_id
   and project.company_id = source.company_id
   and project.deleted_at is null
  left join public.clients job_client
    on job_client.id = coalesce(opportunity.client_id, project.client_id)
   and job_client.company_id = source.company_id
   and job_client.deleted_at is null
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'kind', candidate.kind,
               'id', candidate.participant_id
             )
             order by candidate.kind, candidate.participant_id
           ) as confirmed
    from (
      select distinct candidate.kind, candidate.participant_id
      from (
        select event.linked_contact_kind as kind,
               event.linked_contact_id::text as participant_id
        where event.direction = 'inbound'
          and event.party_role = 'customer'
          and event.linked_contact_kind in ('client', 'sub_client')
          and event.linked_contact_id is not null
          and event.linked_contact_kind <> 'high_confidence_related_contact'
          and (
            (event.linked_contact_kind = 'client' and exists (
              select 1
              from public.clients linked_client
              where linked_client.id = event.linked_contact_id
                and linked_client.company_id = source.company_id
                and linked_client.deleted_at is null
            ))
            or
            (event.linked_contact_kind = 'sub_client' and exists (
              select 1
              from public.sub_clients linked_sub_client
              where linked_sub_client.id = event.linked_contact_id
                and linked_sub_client.company_id = source.company_id
                and linked_sub_client.deleted_at is null
            ))
          )

        union all

        select 'client'::text,
               job_client.id::text
        where source.direction = 'inbound'
          and (event.id is null or event.party_role = 'customer')
          and job_client.id is not null
          and lower(btrim(job_client.email)) = source.sender_identity

        union all

        select 'sub_client'::text,
               sub_client.id::text
        from public.sub_clients sub_client
        where source.direction = 'inbound'
          and (event.id is null or event.party_role = 'customer')
          and job_client.id is not null
          and sub_client.company_id = source.company_id
          and sub_client.client_id = job_client.id
          and sub_client.deleted_at is null
          and lower(btrim(sub_client.email)) = source.sender_identity
      ) candidate
      where candidate.participant_id is not null
    ) candidate
  ) participants on true
  where source.company_id = p_company_id
    and source.connection_id = p_connection_id
    and source.provider_message_id = btrim(p_provider_message_id)
    and octet_length(source.content_value) <= 8388608
    and (
      (
        authority.provider_source_id is null
        and source.content_source_kind <> 'ops_rendered_outbound'
        and not exists (
          select 1
          from public.email_send_intents accepted_intent
          where accepted_intent.company_id = source.company_id
            and accepted_intent.connection_id = source.connection_id
            and accepted_intent.provider_message_id
              = source.provider_message_id
            and accepted_intent.accepted_provider_thread_id
              = source.provider_thread_id
            and accepted_intent.status in (
              'provider_accepted',
              'reconciling',
              'reconciliation_failed',
              'reconciled'
            )
        )
        and not exists (
          select 1
          from public.approved_action_email_intents accepted_intent
          where accepted_intent.company_id = source.company_id
            and accepted_intent.connection_id = source.connection_id
            and accepted_intent.provider_message_id
              = source.provider_message_id
            and accepted_intent.accepted_provider_thread_id
              = source.provider_thread_id
            and accepted_intent.status in (
              'provider_accepted',
              'reconciling',
              'reconciliation_failed',
              'reconciled'
            )
        )
      )
      or (
        authority.provider_source_id is not null
        and activity.opportunity_id
          is not distinct from authority.opportunity_id
        and activity.project_id
          is not distinct from authority.project_id::text
      )
    )
    and (
      (
        activity.opportunity_id is not null
        and opportunity.id is not null
        and event.id is not null
      )
      or
      (
        activity.opportunity_id is null
        and activity.project_id is not null
        and project.id is not null
        and event.id is null
        and source.direction = 'outbound'
        and authority.provider_source_id is not null
      )
    );
end;
$function$;

revoke all on function public.read_agent_provider_delivery_source_as_system(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_provider_delivery_source_as_system(
  uuid, uuid, text, uuid
) to service_role;

comment on function public.capture_agent_provider_delivery_source_as_system(
  uuid, uuid, text, text, text, text, timestamptz, text, text,
  text[], text[], text, text, text, text, text, text, text, text, uuid,
  boolean, jsonb
) is
  'Retains the first exact provider or OPS-rendered outbound source plus complete attachment descriptors, then idempotently binds any exact accepted-send authority to that immutable source hash.';

comment on function public.read_agent_provider_delivery_source_as_system(
  uuid, uuid, text, uuid
) is
  'Returns one turn-ready provider source only when tenant, mailbox, activity, and job provenance agree. Accepted-send actor and project authority come only from the source-hash-bound attestation; exact opportunity events also admit unattested provider-native mail as ops:system.';

commit;
