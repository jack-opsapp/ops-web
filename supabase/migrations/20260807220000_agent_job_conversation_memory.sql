-- OPS job conversation memory: immutable delivered turns, versioned running
-- memory, evidence, and append-only redaction overlays.
--
-- This migration is intentionally after the actor-authority foundation. It
-- creates storage and one service-only delivered-turn ingest boundary; it does
-- not generate memory, expose MCP, or grant a browser write path.

begin;

do $prerequisites$
declare
  v_signature text;
  v_table text;
begin
  foreach v_signature in array array[
    'private.get_user_company_id()',
    'private.current_user_can_view_opportunity(uuid)',
    'private.current_user_can_view_project_scoped(uuid)',
    'public.purge_company_rows(text,uuid)',
    'public.purge_company_data(uuid,jsonb)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'agent_job_conversation_memory_prerequisite_missing: %',
        v_signature;
    end if;
  end loop;

  foreach v_table in array array[
    'public.companies',
    'public.users',
    'public.opportunities',
    'public.projects',
    'public.email_connections',
    'public.activities',
    'public.opportunity_correspondence_events'
  ] loop
    if to_regclass(v_table) is null then
      raise exception 'agent_job_conversation_memory_prerequisite_missing: %',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.email_connections'::regclass
      and attribute.attname = 'company_id'
      and not attribute.attisdropped
      and pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) = 'text'
  ) then
    raise exception
      'agent_job_conversation_memory_prerequisite_missing: email_connections.company_id text';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception
      'agent_job_conversation_memory_prerequisite_missing: extensions.digest(bytea,text)';
  end if;
end;
$prerequisites$;

-- Tenant-paired anchor references must be enforced by PostgreSQL, not only by
-- the guarded ingest function. Project ids are already globally unique, so
-- this additive index cannot reject an existing row.
create unique index if not exists projects_company_id_id_uidx
  on public.projects (company_id, id);

-- PostgreSQL can use a non-partial unique index as the target of a composite
-- foreign key. Fail before creating any memory tables if an earlier migration
-- was skipped, an index is invalid/not ready, or a same-named index drifted to
-- a different table or key order. The projects index is created immediately
-- above because that legacy table did not previously need a tenant-paired key.
do $unique_fk_targets$
declare
  v_required record;
begin
  for v_required in
    select *
    from (values
      ('opportunities_company_id_id_uidx', 'opportunities'),
      ('projects_company_id_id_uidx', 'projects'),
      ('activities_company_id_id_uidx', 'activities'),
      (
        'opportunity_correspondence_events_company_id_id_uidx',
        'opportunity_correspondence_events'
      ),
      ('users_company_id_id_uidx', 'users')
    ) as required(index_name, table_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_index index_definition
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_definition.indexrelid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_relation.relnamespace
      where index_namespace.nspname = 'public'
        and index_relation.relname = v_required.index_name
        and index_definition.indrelid = pg_catalog.to_regclass(
          'public.' || v_required.table_name
        )
        and index_definition.indisunique
        and index_definition.indimmediate
        and index_definition.indisvalid
        and index_definition.indisready
        and index_definition.indpred is null
        and index_definition.indexprs is null
        and index_definition.indnkeyatts = 2
        and index_definition.indnatts = 2
        and pg_catalog.pg_get_indexdef(
          index_definition.indexrelid,
          1,
          true
        ) = 'company_id'
        and pg_catalog.pg_get_indexdef(
          index_definition.indexrelid,
          2,
          true
        ) = 'id'
    ) then
      raise exception
        'agent_job_conversation_memory_prerequisite_invalid_unique_index: %',
        v_required.index_name
        using errcode = '55000';
    end if;
  end loop;
end;
$unique_fk_targets$;

create table public.job_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  current_memory_version_id uuid,
  last_turn_sequence bigint not null default 0
    check (last_turn_sequence >= 0),
  source_state_revision bigint not null default 0
    check (source_state_revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, id)
);

comment on table public.job_conversations is
  'One business conversation per OPS opportunity/job. Provider threads are evidence links, never the memory boundary.';

create table public.job_conversation_anchors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  anchor_kind text not null
    check (anchor_kind in ('opportunity', 'project')),
  opportunity_id uuid,
  project_id uuid,
  source_id uuid generated always as (
    coalesce(opportunity_id, project_id)
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id)
    references public.job_conversations(company_id, id) on delete cascade,
  foreign key (company_id, opportunity_id)
    references public.opportunities(company_id, id) on delete restrict,
  foreign key (company_id, project_id)
    references public.projects(company_id, id) on delete restrict,
  unique (company_id, anchor_kind, source_id),
  unique (company_id, conversation_id, anchor_kind),
  check (
    (anchor_kind = 'opportunity'
      and opportunity_id is not null
      and project_id is null)
    or
    (anchor_kind = 'project'
      and project_id is not null
      and opportunity_id is null)
  )
);

comment on table public.job_conversation_anchors is
  'Typed opportunity/project anchors. Conversion adds the project to the opportunity conversation instead of creating a new memory.';

create table public.job_conversation_turns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  turn_sequence bigint not null check (turn_sequence > 0),
  source_state_revision bigint not null check (source_state_revision > 0),
  side text check (side in ('user', 'assistant')),
  participant_id text not null
    check (
      nullif(btrim(participant_id), '') is not null
      and participant_id = btrim(participant_id)
    ),
  participant_resolution_status text not null check (
    participant_resolution_status in ('resolved', 'unresolved', 'ambiguous')
  ),
  participant_resolution_revision text not null
    check (
      nullif(btrim(participant_resolution_revision), '') is not null
      and participant_resolution_revision = btrim(participant_resolution_revision)
    ),
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (channel in ('email')),
  delivered_at timestamptz not null,
  source_connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  provider_message_id text not null
    check (
      nullif(btrim(provider_message_id), '') is not null
      and provider_message_id = btrim(provider_message_id)
    ),
  provider_delivery_source_id uuid not null,
  provider_delivery_source_sha256 text not null
    check (provider_delivery_source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  subject text,
  recipient_identities text[] not null default '{}'::text[],
  cc_recipient_identities text[] not null default '{}'::text[],
  normalized_plain_text text not null,
  original_content_hash text not null
    check (original_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  attachment_evidence_ids text[] not null default '{}'::text[],
  ingested_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id)
    references public.job_conversations(company_id, id) on delete cascade,
  foreign key (company_id, source_activity_id)
    references public.activities(company_id, id) on delete restrict,
  foreign key (company_id, source_correspondence_event_id)
    references public.opportunity_correspondence_events(company_id, id)
    on delete restrict,
  unique (company_id, conversation_id, id),
  unique (company_id, conversation_id, turn_sequence),
  unique (company_id, source_connection_id, provider_message_id),
  check (
    (
      participant_resolution_status = 'resolved'
      and (
        (direction = 'inbound' and side = 'user')
        or (direction = 'outbound' and side = 'assistant')
      )
    )
    or
    (
      participant_resolution_status in ('unresolved', 'ambiguous')
      and side is null
    )
  ),
  check (
    source_activity_id is not null
    or source_correspondence_event_id is not null
  )
);

comment on table public.job_conversation_turns is
  'Exact, untruncated normalized content for provider-delivered inbound/outbound messages only. Prompt assembly applies its own bounded projection. Unresolved or ambiguous participants keep a NULL side instead of being guessed into user/assistant. Drafts and send intents never enter this table.';

create table public.job_memory_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  version_number integer not null check (version_number > 0),
  predecessor_version_id uuid,
  turn_high_watermark_id uuid not null,
  turn_high_watermark_sequence bigint not null
    check (turn_high_watermark_sequence > 0),
  source_state_revision bigint not null
    check (source_state_revision >= 0),
  generation_input_hash text not null
    check (generation_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  memory_document jsonb not null
    check (
      jsonb_typeof(memory_document) = 'object'
      and octet_length(memory_document::text) <= 60000
    ),
  memory_document_hash text not null
    check (memory_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  generator_revision text not null
    check (nullif(btrim(generator_revision), '') is not null),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id)
    references public.job_conversations(company_id, id) on delete cascade,
  unique (company_id, conversation_id, id),
  unique (company_id, conversation_id, version_number),
  foreign key (company_id, conversation_id, predecessor_version_id)
    references public.job_memory_versions (company_id, conversation_id, id)
    on delete no action
    deferrable initially deferred,
  foreign key (company_id, conversation_id, turn_high_watermark_id)
    references public.job_conversation_turns (company_id, conversation_id, id)
    on delete restrict,
  check (predecessor_version_id is distinct from id),
  check (source_state_revision >= turn_high_watermark_sequence)
);

comment on table public.job_memory_versions is
  'Append-only structured running-memory versions. Failed generation never advances job_conversations.current_memory_version_id.';

alter table public.job_conversations
  add constraint job_conversations_current_memory_version_fkey
  foreign key (company_id, id, current_memory_version_id)
  references public.job_memory_versions(company_id, conversation_id, id)
  on delete set null (current_memory_version_id)
  deferrable initially immediate;

create table public.job_memory_version_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  memory_version_id uuid not null,
  evidence_id text not null
    check (nullif(btrim(evidence_id), '') is not null),
  relationship text not null
    check (relationship in ('supports', 'contradicts', 'supersedes')),
  source_domain text not null
    check (nullif(btrim(source_domain), '') is not null),
  source_type text not null
    check (nullif(btrim(source_type), '') is not null),
  source_entity_id text not null
    check (nullif(btrim(source_entity_id), '') is not null),
  source_revision text not null
    check (nullif(btrim(source_revision), '') is not null),
  source_content_hash text
    check (
      source_content_hash is null
      or source_content_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id, memory_version_id)
    references public.job_memory_versions(company_id, conversation_id, id)
    on delete cascade,
  unique (memory_version_id, evidence_id, relationship)
);

comment on table public.job_memory_version_evidence is
  'Evidence references retained by one immutable memory version; summaries are never treated as source evidence.';

create table public.job_conversation_redaction_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  target_turn_id uuid not null,
  redaction_kind text not null check (
    redaction_kind in (
      'content_redacted',
      'attachment_redacted',
      'participant_pseudonymized'
    )
  ),
  reason text not null check (nullif(btrim(reason), '') is not null),
  replacement_plain_text text,
  actor_user_id uuid,
  authority_revision text not null
    check (nullif(btrim(authority_revision), '') is not null),
  source_state_revision bigint not null check (source_state_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id, target_turn_id)
    references public.job_conversation_turns(company_id, conversation_id, id)
    on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.users(company_id, id) on delete restrict,
  unique (company_id, conversation_id, source_state_revision),
  check (
    replacement_plain_text is null
    or char_length(replacement_plain_text) <= 60000
  )
);

comment on table public.job_conversation_redaction_events is
  'Append-only legal/retention overlay. The original delivered turn remains immutable and is never silently rewritten.';

-- Foreign-key and prompt-assembly paths. PostgreSQL does not automatically
-- index the referencing side of foreign keys.
create index job_conversations_current_memory_idx
  on public.job_conversations (current_memory_version_id)
  where current_memory_version_id is not null;
create index job_conversation_anchors_conversation_idx
  on public.job_conversation_anchors (company_id, conversation_id);
create index job_conversation_anchors_opportunity_idx
  on public.job_conversation_anchors (opportunity_id)
  where opportunity_id is not null;
create index job_conversation_anchors_project_idx
  on public.job_conversation_anchors (project_id)
  where project_id is not null;
create index job_conversation_turns_conversation_delivered_idx
  on public.job_conversation_turns (
    company_id,
    conversation_id,
    delivered_at desc,
    id desc
  );
create index job_conversation_turns_conversation_sequence_idx
  on public.job_conversation_turns (
    company_id,
    conversation_id,
    turn_sequence
  );
create index job_conversation_turns_source_revision_idx
  on public.job_conversation_turns (
    company_id,
    conversation_id,
    source_state_revision
  );
create index job_conversation_turns_connection_idx
  on public.job_conversation_turns (source_connection_id);
create index job_conversation_turns_activity_idx
  on public.job_conversation_turns (source_activity_id)
  where source_activity_id is not null;
create index job_conversation_turns_correspondence_idx
  on public.job_conversation_turns (source_correspondence_event_id)
  where source_correspondence_event_id is not null;
create index job_memory_versions_conversation_idx
  on public.job_memory_versions (
    company_id,
    conversation_id,
    version_number desc
  );
create index job_memory_versions_predecessor_idx
  on public.job_memory_versions (predecessor_version_id)
  where predecessor_version_id is not null;
create index job_memory_versions_watermark_idx
  on public.job_memory_versions (turn_high_watermark_id)
  where turn_high_watermark_id is not null;
create index job_memory_versions_source_revision_idx
  on public.job_memory_versions (
    company_id,
    conversation_id,
    source_state_revision desc
  );
create index job_memory_version_evidence_version_idx
  on public.job_memory_version_evidence (
    company_id,
    conversation_id,
    memory_version_id
  );
create index job_conversation_redactions_conversation_idx
  on public.job_conversation_redaction_events (
    company_id,
    conversation_id,
    created_at desc,
    id desc
  );
create index job_conversation_redactions_turn_idx
  on public.job_conversation_redaction_events (
    target_turn_id,
    created_at desc
  );
create index job_conversation_redactions_actor_idx
  on public.job_conversation_redaction_events (actor_user_id)
  where actor_user_id is not null;
create index job_conversation_redactions_source_revision_idx
  on public.job_conversation_redaction_events (
    company_id,
    conversation_id,
    source_state_revision
  );

-- Anchors are inserted only by guarded owner functions, but this trigger also
-- pins conversion identity for future privileged code. One conversation can
-- hold one opportunity and its reciprocal converted project, never two jobs.
create or replace function private.enforce_job_conversation_anchor_company()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_target_company_id uuid;
  v_linked_opportunity_id uuid;
  v_linked_project_id uuid;
  v_legacy_opportunity_id text;
  v_legacy_project_id uuid;
begin
  if new.anchor_kind = 'opportunity' then
    select opportunity.company_id,
           opportunity.project_ref,
           opportunity.project_id
    into v_target_company_id, v_linked_project_id, v_legacy_project_id
    from public.opportunities opportunity
    where opportunity.id = new.opportunity_id
      and opportunity.deleted_at is null;

    if v_linked_project_id is distinct from v_legacy_project_id then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;

    if v_linked_project_id is not null and not exists (
      select 1
      from public.projects project
      where project.id = v_linked_project_id
        and project.company_id = new.company_id
        and project.deleted_at is null
        and project.opportunity_ref = new.opportunity_id
        and nullif(btrim(project.opportunity_id), '') = new.opportunity_id::text
    ) then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;

    if exists (
      select 1
      from public.job_conversation_anchors anchor
      where anchor.company_id = new.company_id
        and anchor.conversation_id = new.conversation_id
        and anchor.anchor_kind = 'project'
        and anchor.project_id is distinct from v_linked_project_id
    ) then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;
  elsif new.anchor_kind = 'project' then
    select project.company_id,
           project.opportunity_ref,
           nullif(btrim(project.opportunity_id), '')
    into v_target_company_id,
         v_linked_opportunity_id,
         v_legacy_opportunity_id
    from public.projects project
    where project.id = new.project_id
      and project.deleted_at is null;

    if v_legacy_opportunity_id
         is distinct from v_linked_opportunity_id::text then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;

    if v_linked_opportunity_id is not null and not exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = v_linked_opportunity_id
        and opportunity.company_id = new.company_id
        and opportunity.deleted_at is null
        and opportunity.project_ref = new.project_id
        and opportunity.project_id = new.project_id
    ) then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;

    if exists (
      select 1
      from public.job_conversation_anchors anchor
      where anchor.company_id = new.company_id
        and anchor.conversation_id = new.conversation_id
        and anchor.anchor_kind = 'opportunity'
        and anchor.opportunity_id is distinct from v_linked_opportunity_id
    ) then
      raise exception 'job_conversation_anchor_conversion_mismatch'
        using errcode = '23503';
    end if;
  end if;

  if v_target_company_id is null
     or v_target_company_id is distinct from new.company_id then
    raise exception 'job_conversation_anchor_company_mismatch'
      using errcode = '23503';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_job_conversation_anchor_company()
  from public, anon, authenticated, service_role;

create trigger job_conversation_anchors_company_guard
before insert or update on public.job_conversation_anchors
for each row execute function private.enforce_job_conversation_anchor_company();

-- Provider identity and job relevance are storage invariants, not merely
-- promises made by the first ingest caller. The composite foreign keys above
-- pin UUID sources to the company; this trigger covers email_connections'
-- authoritative text company id and the message/job relationship.
create or replace function private.enforce_job_conversation_turn_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.email_connections connection
    where connection.id = new.source_connection_id
      and connection.company_id = new.company_id::text
  ) then
    raise exception 'job_conversation_source_connection_invalid'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from private.agent_provider_delivery_sources provider_source
    where provider_source.id = new.provider_delivery_source_id
      and provider_source.company_id = new.company_id
      and provider_source.source_sha256
        = new.provider_delivery_source_sha256
      and provider_source.connection_id = new.source_connection_id
      and provider_source.provider_message_id = new.provider_message_id
      and provider_source.direction = new.direction
      and provider_source.delivered_at = new.delivered_at
  ) then
    raise exception 'job_conversation_provider_source_invalid'
      using errcode = '23503';
  end if;

  if new.source_activity_id is not null and not exists (
    select 1
    from public.activities activity
    where activity.id = new.source_activity_id
      and activity.company_id = new.company_id
      and activity.type = 'email'
      and activity.direction = new.direction
      and activity.email_connection_id = new.source_connection_id
      and activity.email_message_id = new.provider_message_id
      and exists (
        select 1
        from public.job_conversation_anchors anchor
        where anchor.company_id = new.company_id
          and anchor.conversation_id = new.conversation_id
          and (
            (
              anchor.anchor_kind = 'opportunity'
              and activity.opportunity_id = anchor.opportunity_id
            )
            or
            (
              anchor.anchor_kind = 'project'
              and activity.project_id = anchor.project_id::text
            )
          )
      )
  ) then
    raise exception 'job_conversation_source_activity_invalid'
      using errcode = '23503';
  end if;

  if new.source_correspondence_event_id is not null and not exists (
    select 1
    from public.opportunity_correspondence_events event
    where event.id = new.source_correspondence_event_id
      and event.company_id = new.company_id
      and event.connection_id = new.source_connection_id
      and event.provider_message_id = new.provider_message_id
      and event.direction = new.direction
      and (
        new.source_activity_id is null
        or event.activity_id = new.source_activity_id
      )
      and exists (
        select 1
        from public.job_conversation_anchors anchor
        where anchor.company_id = new.company_id
          and anchor.conversation_id = new.conversation_id
          and anchor.anchor_kind = 'opportunity'
          and anchor.opportunity_id = event.opportunity_id
      )
  ) then
    raise exception 'job_conversation_source_event_invalid'
      using errcode = '23503';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_job_conversation_turn_source()
  from public, anon, authenticated, service_role;

create trigger job_conversation_turns_source_guard
before insert or update on public.job_conversation_turns
for each row execute function private.enforce_job_conversation_turn_source();

-- A legal/privacy overlay changes the effective source state even though the
-- delivered turn remains immutable. Memory versions must therefore capture a
-- source revision in addition to a turn watermark.
create or replace function private.assign_job_conversation_redaction_source_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_next_revision bigint;
begin
  select conversation.source_state_revision + 1
  into v_next_revision
  from public.job_conversations conversation
  where conversation.id = new.conversation_id
    and conversation.company_id = new.company_id
  for update;

  if v_next_revision is null then
    raise exception 'job_conversation_redaction_conversation_invalid'
      using errcode = '23503';
  end if;

  new.source_state_revision := v_next_revision;
  update public.job_conversations conversation
  set source_state_revision = v_next_revision,
      updated_at = clock_timestamp()
  where conversation.id = new.conversation_id
    and conversation.company_id = new.company_id;
  return new;
end;
$function$;

revoke all on function private.assign_job_conversation_redaction_source_revision()
  from public, anon, authenticated, service_role;

create trigger job_conversation_redactions_source_revision
before insert on public.job_conversation_redaction_events
for each row execute function
  private.assign_job_conversation_redaction_source_revision();

-- Immutable records accept only the transaction-local marker used by the
-- audited company-data purge. Ordinary UPDATE and DELETE always fail.
create or replace function private.reject_agent_job_memory_mutation()
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

revoke all on function private.reject_agent_job_memory_mutation()
  from public, anon, authenticated, service_role;

create trigger job_conversations_delete_guard
before delete on public.job_conversations
for each row execute function private.reject_agent_job_memory_mutation();
create trigger job_conversation_anchors_immutable
before update or delete on public.job_conversation_anchors
for each row execute function private.reject_agent_job_memory_mutation();
create trigger job_conversation_turns_immutable
before update or delete on public.job_conversation_turns
for each row execute function private.reject_agent_job_memory_mutation();
create trigger job_memory_versions_immutable
before update or delete on public.job_memory_versions
for each row execute function private.reject_agent_job_memory_mutation();
create trigger job_memory_version_evidence_immutable
before update or delete on public.job_memory_version_evidence
for each row execute function private.reject_agent_job_memory_mutation();
create trigger job_conversation_redaction_events_immutable
before update or delete on public.job_conversation_redaction_events
for each row execute function private.reject_agent_job_memory_mutation();

-- Browser reads intersect company tenancy with current job visibility. The
-- helper intentionally checks every active anchor: opportunity conversion
-- does not make a new conversation, and access to either live anchor is enough
-- to read the shared history.
create or replace function private.current_user_can_view_job_conversation(
  p_conversation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    p_conversation_id is not null
    and exists (
      select 1
      from public.job_conversations conversation
      where conversation.id = p_conversation_id
        and conversation.company_id = private.get_user_company_id()
    )
    and exists (
      select 1
      from public.job_conversation_anchors anchor
      where anchor.conversation_id = p_conversation_id
        and anchor.company_id = private.get_user_company_id()
        and (
          (
            anchor.anchor_kind = 'opportunity'
            and private.current_user_can_view_opportunity(
              anchor.opportunity_id
            )
          )
          or
          (
            anchor.anchor_kind = 'project'
            and private.current_user_can_view_project_scoped(
              anchor.project_id
            )
          )
        )
    );
$function$;

revoke all on function private.current_user_can_view_job_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_job_conversation(uuid)
  to authenticated;

alter table public.job_conversations enable row level security;
alter table public.job_conversations force row level security;
alter table public.job_conversation_anchors enable row level security;
alter table public.job_conversation_anchors force row level security;
alter table public.job_conversation_turns enable row level security;
alter table public.job_conversation_turns force row level security;
alter table public.job_memory_versions enable row level security;
alter table public.job_memory_versions force row level security;
alter table public.job_memory_version_evidence enable row level security;
alter table public.job_memory_version_evidence force row level security;
alter table public.job_conversation_redaction_events enable row level security;
alter table public.job_conversation_redaction_events force row level security;

create policy job_conversations_company_select
on public.job_conversations
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_conversations_job_scope_select
on public.job_conversations
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(id));

create policy job_conversation_anchors_company_select
on public.job_conversation_anchors
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_conversation_anchors_job_scope_select
on public.job_conversation_anchors
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(conversation_id));

create policy job_conversation_turns_company_select
on public.job_conversation_turns
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_conversation_turns_job_scope_select
on public.job_conversation_turns
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(conversation_id));

create policy job_memory_versions_company_select
on public.job_memory_versions
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_memory_versions_job_scope_select
on public.job_memory_versions
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(conversation_id));

create policy job_memory_version_evidence_company_select
on public.job_memory_version_evidence
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_memory_version_evidence_job_scope_select
on public.job_memory_version_evidence
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(conversation_id));

create policy job_conversation_redaction_events_company_select
on public.job_conversation_redaction_events
for select to authenticated
using (company_id = (select private.get_user_company_id()));
create policy job_conversation_redaction_events_job_scope_select
on public.job_conversation_redaction_events
as restrictive for select to authenticated
using (private.current_user_can_view_job_conversation(conversation_id));

-- Resolve or create one conversation and insert one exact delivered turn in a
-- single transaction. A company-wide advisory lock serializes the conversion
-- no-row case; source identity remains the durable idempotency arbiter.
create or replace function public.ingest_job_conversation_turn_as_system(
  p_company_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_source_connection_id uuid,
  p_provider_message_id text,
  p_provider_delivery_source_id uuid,
  p_provider_delivery_source_sha256 text,
  p_source_activity_id uuid
) returns table (
  conversation_id uuid,
  turn_id uuid,
  inserted boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_conversation_id uuid;
  v_existing_conversation_ids uuid[];
  v_turn_id uuid;
  v_inserted boolean := false;
  v_opportunity_id uuid;
  v_project_id uuid;
  v_conversion_mismatch boolean;
  v_existing_turn public.job_conversation_turns%rowtype;
  v_provider_source record;
  v_source_activity record;
  v_source_event_ids uuid[];
  v_source_event_id uuid;
  v_source_event_party_role text;
  v_source_event_linked_contact_kind text;
  v_source_event_linked_contact_id uuid;
  v_outbound_actor_user_id uuid;
  v_authority_opportunity_id uuid;
  v_authority_project_id uuid;
  v_side text;
  v_participant_id text;
  v_participant_resolution_status text;
  v_participant_resolution_revision text :=
    'job-participant-side:v1';
  v_participant_candidate_count bigint := 0;
  v_participant_candidate_kind text;
  v_participant_candidate_id text;
  v_last_turn_sequence bigint;
  v_source_state_revision bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_job_id is null
     or p_job_kind is null
     or p_job_kind not in ('opportunity', 'project')
     or p_source_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or p_provider_delivery_source_id is null
     or p_provider_delivery_source_sha256 is null
     or p_provider_delivery_source_sha256
       !~ '^sha256:[0-9a-f]{64}$'
     or p_source_activity_id is null then
    raise exception 'invalid_job_conversation_turn'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'agent-job-conversation:v1:' || p_company_id::text,
      0
    )
  );

  if p_job_kind = 'opportunity' then
    select opportunity.id,
           opportunity.project_ref,
           opportunity.project_ref is distinct from opportunity.project_id
    into v_opportunity_id, v_project_id, v_conversion_mismatch
    from public.opportunities opportunity
    where opportunity.id = p_job_id
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
    for share;
    if not found then
      raise exception 'job_not_found' using errcode = 'P0002';
    end if;
    if v_conversion_mismatch then
      raise exception 'job_conversion_link_invalid' using errcode = '23503';
    end if;
  else
    select project.opportunity_ref,
           project.id,
           nullif(btrim(project.opportunity_id), '')
             is distinct from project.opportunity_ref::text
    into v_opportunity_id, v_project_id, v_conversion_mismatch
    from public.projects project
    where project.id = p_job_id
      and project.company_id = p_company_id
      and project.deleted_at is null
    for share;
    if not found then
      raise exception 'job_not_found' using errcode = 'P0002';
    end if;
    if v_conversion_mismatch then
      raise exception 'job_conversion_link_invalid' using errcode = '23503';
    end if;
  end if;

  if v_opportunity_id is not null and not exists (
    select 1
    from public.opportunities opportunity
    where opportunity.id = v_opportunity_id
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and (
        v_project_id is null
        or (
          opportunity.project_ref = v_project_id
          and opportunity.project_id = v_project_id
        )
      )
  ) then
    raise exception 'job_conversion_link_invalid' using errcode = '23503';
  end if;

  if v_project_id is not null and not exists (
    select 1
    from public.projects project
    where project.id = v_project_id
      and project.company_id = p_company_id
      and project.deleted_at is null
      and (
        v_opportunity_id is null
        or (
          project.opportunity_ref = v_opportunity_id
          and nullif(btrim(project.opportunity_id), '') = v_opportunity_id::text
        )
      )
  ) then
    raise exception 'job_conversion_link_invalid' using errcode = '23503';
  end if;

  select array_agg(distinct anchor.conversation_id order by anchor.conversation_id)
  into v_existing_conversation_ids
  from public.job_conversation_anchors anchor
  where anchor.company_id = p_company_id
    and (
      (v_opportunity_id is not null
        and anchor.anchor_kind = 'opportunity'
        and anchor.opportunity_id = v_opportunity_id)
      or
      (v_project_id is not null
        and anchor.anchor_kind = 'project'
        and anchor.project_id = v_project_id)
    );

  if cardinality(v_existing_conversation_ids) > 1 then
    raise exception 'job_conversion_conversation_conflict'
      using errcode = '23505';
  end if;
  v_conversation_id := v_existing_conversation_ids[1];

  if v_conversation_id is null then
    insert into public.job_conversations (company_id)
    values (p_company_id)
    returning id into v_conversation_id;
  end if;

  if v_opportunity_id is not null then
    insert into public.job_conversation_anchors (
      company_id,
      conversation_id,
      anchor_kind,
      opportunity_id
    ) values (
      p_company_id,
      v_conversation_id,
      'opportunity',
      v_opportunity_id
    )
    on conflict (company_id, anchor_kind, source_id) do nothing;
  end if;

  if v_project_id is not null then
    insert into public.job_conversation_anchors (
      company_id,
      conversation_id,
      anchor_kind,
      project_id
    ) values (
      p_company_id,
      v_conversation_id,
      'project',
      v_project_id
    )
    on conflict (company_id, anchor_kind, source_id) do nothing;
  end if;

  if exists (
    select 1
    from public.job_conversation_anchors anchor
    where anchor.company_id = p_company_id
      and (
        (v_opportunity_id is not null
          and anchor.anchor_kind = 'opportunity'
          and anchor.opportunity_id = v_opportunity_id)
        or
        (v_project_id is not null
          and anchor.anchor_kind = 'project'
          and anchor.project_id = v_project_id)
      )
      and anchor.conversation_id is distinct from v_conversation_id
  ) then
    raise exception 'job_conversion_conversation_conflict'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.email_connections connection
    where connection.id = p_source_connection_id
      and connection.company_id = p_company_id::text
  ) then
    raise exception 'job_conversation_source_connection_invalid'
      using errcode = '23503';
  end if;

  select provider_source.*
  into v_provider_source
  from private.agent_provider_delivery_sources provider_source
  where provider_source.id = p_provider_delivery_source_id
    and provider_source.company_id = p_company_id
    and provider_source.source_sha256 = p_provider_delivery_source_sha256
    and provider_source.connection_id = p_source_connection_id
    and provider_source.provider_message_id = btrim(p_provider_message_id)
  for share;

  if not found then
    raise exception 'job_conversation_provider_source_invalid'
      using errcode = '23503';
  end if;

  select activity.*
  into v_source_activity
  from public.activities activity
  where activity.id = p_source_activity_id
    and activity.company_id = p_company_id
    and activity.type = 'email'
    and activity.direction = v_provider_source.direction
    and activity.email_connection_id = p_source_connection_id
    and activity.email_message_id = btrim(p_provider_message_id)
    and (
      (v_opportunity_id is not null
        and activity.opportunity_id = v_opportunity_id)
      or
      (v_project_id is not null
        and activity.project_id = v_project_id::text)
    )
  for share;

  if not found then
    raise exception 'job_conversation_source_activity_invalid'
      using errcode = '23503';
  end if;

  select coalesce(
    array_agg(event.id order by event.id),
    '{}'::uuid[]
  )
  into v_source_event_ids
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.activity_id = p_source_activity_id
    and event.connection_id = p_source_connection_id
    and event.provider_message_id = btrim(p_provider_message_id)
    and event.direction = v_provider_source.direction
    and event.opportunity_id = v_source_activity.opportunity_id;

  if cardinality(v_source_event_ids) > 1 then
    raise exception 'job_conversation_source_event_ambiguous'
      using errcode = '23505';
  end if;
  v_source_event_id := v_source_event_ids[1];

  if v_source_event_id is not null then
    select event.party_role,
           event.linked_contact_kind,
           event.linked_contact_id
    into v_source_event_party_role,
         v_source_event_linked_contact_kind,
         v_source_event_linked_contact_id
    from public.opportunity_correspondence_events event
    where event.id = v_source_event_id
      and event.company_id = p_company_id
    for share;
  end if;

  select authority.actor_user_id,
         authority.opportunity_id,
         authority.project_id
  into v_outbound_actor_user_id,
       v_authority_opportunity_id,
       v_authority_project_id
  from private.agent_provider_outbound_authority_attestations authority
  where authority.company_id = p_company_id
    and authority.provider_source_id = v_provider_source.id
    and authority.source_sha256 = v_provider_source.source_sha256
  for share;

  if v_outbound_actor_user_id is not null and (
    v_source_activity.opportunity_id
      is distinct from v_authority_opportunity_id
    or v_source_activity.project_id
      is distinct from v_authority_project_id::text
  ) then
    raise exception 'job_conversation_source_authority_invalid'
      using errcode = '23503';
  end if;

  if v_source_activity.opportunity_id is not null then
    if v_source_event_id is null then
      raise exception 'job_conversation_source_event_invalid'
        using errcode = '23503';
    end if;
  elsif v_source_activity.project_id is not null then
    if v_provider_source.direction <> 'outbound'
       or v_source_event_id is not null
       or v_outbound_actor_user_id is null then
      raise exception 'job_conversation_source_authority_invalid'
        using errcode = '23503';
    end if;
  else
    raise exception 'job_conversation_source_activity_invalid'
      using errcode = '23503';
  end if;

  if v_provider_source.direction = 'outbound'
     and v_outbound_actor_user_id is null
     and (
       v_provider_source.content_source_kind = 'ops_rendered_outbound'
       or exists (
         select 1
         from public.email_send_intents accepted_intent
         where accepted_intent.company_id = p_company_id
           and accepted_intent.connection_id = p_source_connection_id
           and accepted_intent.provider_message_id
             = v_provider_source.provider_message_id
           and accepted_intent.accepted_provider_thread_id
             = v_provider_source.provider_thread_id
           and accepted_intent.status in (
             'provider_accepted',
             'reconciling',
             'reconciliation_failed',
             'reconciled'
           )
       )
       or exists (
         select 1
         from public.approved_action_email_intents accepted_intent
         where accepted_intent.company_id = p_company_id
           and accepted_intent.connection_id = p_source_connection_id
           and accepted_intent.provider_message_id
             = v_provider_source.provider_message_id
           and accepted_intent.accepted_provider_thread_id
             = v_provider_source.provider_thread_id
           and accepted_intent.status in (
             'provider_accepted',
             'reconciling',
             'reconciliation_failed',
             'reconciled'
           )
       )
     ) then
    raise exception 'job_conversation_source_authority_invalid'
      using errcode = '23503';
  end if;

  if v_provider_source.direction = 'outbound' and (
    v_source_event_party_role = 'ops'
    or v_provider_source.content_source_kind = 'ops_rendered_outbound'
    or v_outbound_actor_user_id is not null
  ) then
    v_side := 'assistant';
    v_participant_id := case
      when v_outbound_actor_user_id is null then 'ops:system'
      else 'ops_user:' || v_outbound_actor_user_id::text
    end;
    v_participant_resolution_status := 'resolved';
  elsif v_provider_source.direction = 'inbound'
        and v_source_event_party_role = 'customer' then
    select count(*),
           min(candidate.kind),
           min(candidate.participant_id)
    into v_participant_candidate_count,
         v_participant_candidate_kind,
         v_participant_candidate_id
    from (
      select distinct candidate.kind, candidate.participant_id
      from (
        select v_source_event_linked_contact_kind as kind,
               v_source_event_linked_contact_id::text as participant_id
        where v_source_event_linked_contact_kind in ('client', 'sub_client')
          and v_source_event_linked_contact_id is not null
          and (
            (v_source_event_linked_contact_kind = 'client' and exists (
              select 1
              from public.clients linked_client
              where linked_client.id = v_source_event_linked_contact_id
                and linked_client.company_id = p_company_id
                and linked_client.deleted_at is null
            ))
            or
            (v_source_event_linked_contact_kind = 'sub_client' and exists (
              select 1
              from public.sub_clients linked_sub_client
              where linked_sub_client.id = v_source_event_linked_contact_id
                and linked_sub_client.company_id = p_company_id
                and linked_sub_client.deleted_at is null
            ))
          )

        union all

        select 'client'::text, job_client.id::text
        from public.clients job_client
        where job_client.id = coalesce(
            (
              select opportunity.client_id
              from public.opportunities opportunity
              where opportunity.id = v_source_activity.opportunity_id
                and opportunity.company_id = p_company_id
            ),
            (
              select project.client_id
              from public.projects project
              where project.id::text = v_source_activity.project_id
                and project.company_id = p_company_id
            )
          )
          and job_client.company_id = p_company_id
          and job_client.deleted_at is null
          and lower(btrim(job_client.email))
            = v_provider_source.sender_identity

        union all

        select 'sub_client'::text, sub_client.id::text
        from public.sub_clients sub_client
        join public.clients job_client
          on job_client.id = sub_client.client_id
         and job_client.company_id = p_company_id
         and job_client.deleted_at is null
        where job_client.id = coalesce(
            (
              select opportunity.client_id
              from public.opportunities opportunity
              where opportunity.id = v_source_activity.opportunity_id
                and opportunity.company_id = p_company_id
            ),
            (
              select project.client_id
              from public.projects project
              where project.id::text = v_source_activity.project_id
                and project.company_id = p_company_id
            )
          )
          and sub_client.company_id = p_company_id
          and sub_client.deleted_at is null
          and lower(btrim(sub_client.email))
            = v_provider_source.sender_identity
      ) candidate
      where candidate.participant_id is not null
    ) candidate;

    if v_participant_candidate_count = 1 then
      v_side := 'user';
      v_participant_id := v_participant_candidate_kind
        || ':' || v_participant_candidate_id;
      v_participant_resolution_status := 'resolved';
    end if;
  end if;

  if v_participant_resolution_status is null then
    v_side := null;
    v_participant_id := 'ambiguous:email:'
      || v_provider_source.sender_identity;
    v_participant_resolution_status := 'ambiguous';
  end if;

  select conversation.last_turn_sequence,
         conversation.source_state_revision
  into v_last_turn_sequence, v_source_state_revision
  from public.job_conversations conversation
  where conversation.id = v_conversation_id
    and conversation.company_id = p_company_id
  for update;

  if not found then
    raise exception 'job_conversation_not_found' using errcode = 'P0002';
  end if;

  insert into public.job_conversation_turns (
    company_id,
    conversation_id,
    turn_sequence,
    source_state_revision,
    side,
    participant_id,
    participant_resolution_status,
    participant_resolution_revision,
    direction,
    channel,
    delivered_at,
    source_connection_id,
    provider_message_id,
    provider_delivery_source_id,
    provider_delivery_source_sha256,
    source_activity_id,
    source_correspondence_event_id,
    subject,
    recipient_identities,
    cc_recipient_identities,
    normalized_plain_text,
    original_content_hash,
    attachment_evidence_ids
  ) values (
    p_company_id,
    v_conversation_id,
    v_last_turn_sequence + 1,
    v_source_state_revision + 1,
    v_side,
    v_participant_id,
    v_participant_resolution_status,
    v_participant_resolution_revision,
    v_provider_source.direction,
    'email',
    v_provider_source.delivered_at,
    p_source_connection_id,
    btrim(p_provider_message_id),
    p_provider_delivery_source_id,
    p_provider_delivery_source_sha256,
    p_source_activity_id,
    v_source_event_id,
    v_provider_source.normalized_subject,
    v_provider_source.recipient_identities,
    v_provider_source.cc_recipient_identities,
    v_provider_source.normalized_plain_text,
    v_provider_source.source_sha256,
    v_provider_source.attachment_evidence_ids
  )
  on conflict (company_id, source_connection_id, provider_message_id)
  do nothing
  returning id into v_turn_id;

  v_inserted := v_turn_id is not null;
  if v_inserted then
    update public.job_conversations conversation
    set last_turn_sequence = v_last_turn_sequence + 1,
        source_state_revision = v_source_state_revision + 1,
        updated_at = clock_timestamp()
    where conversation.id = v_conversation_id
      and conversation.company_id = p_company_id;
  end if;
  if not v_inserted then
    select turn.*
    into v_existing_turn
    from public.job_conversation_turns turn
    where turn.company_id = p_company_id
      and turn.source_connection_id = p_source_connection_id
      and turn.provider_message_id = btrim(p_provider_message_id)
    for share;

    if not found
       or v_existing_turn.conversation_id is distinct from v_conversation_id
       or v_existing_turn.side is distinct from v_side
       or v_existing_turn.participant_id is distinct from v_participant_id
       or v_existing_turn.participant_resolution_status
         is distinct from v_participant_resolution_status
       or v_existing_turn.participant_resolution_revision
         is distinct from v_participant_resolution_revision
       or v_existing_turn.direction is distinct from v_provider_source.direction
       or v_existing_turn.channel is distinct from 'email'
       or v_existing_turn.delivered_at
         is distinct from v_provider_source.delivered_at
       or v_existing_turn.provider_delivery_source_id
         is distinct from p_provider_delivery_source_id
       or v_existing_turn.provider_delivery_source_sha256
         is distinct from p_provider_delivery_source_sha256
       or v_existing_turn.source_activity_id
         is distinct from p_source_activity_id
       or v_existing_turn.source_correspondence_event_id
         is distinct from v_source_event_id
       or v_existing_turn.subject
         is distinct from v_provider_source.normalized_subject
       or v_existing_turn.recipient_identities
         is distinct from v_provider_source.recipient_identities
       or v_existing_turn.cc_recipient_identities
         is distinct from v_provider_source.cc_recipient_identities
       or v_existing_turn.normalized_plain_text
         is distinct from v_provider_source.normalized_plain_text
       or v_existing_turn.original_content_hash
         is distinct from v_provider_source.source_sha256
       or v_existing_turn.attachment_evidence_ids
         is distinct from v_provider_source.attachment_evidence_ids then
      raise exception 'job_conversation_source_idempotency_conflict'
        using errcode = '23505';
    end if;
    v_turn_id := v_existing_turn.id;
  end if;

  return query select v_conversation_id, v_turn_id, v_inserted;
end;
$function$;

revoke all on function public.ingest_job_conversation_turn_as_system(
  uuid, text, uuid, uuid, text, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.ingest_job_conversation_turn_as_system(
  uuid, text, uuid, uuid, text, uuid, text, uuid
) to service_role;

create or replace function private.job_memory_version_as_json(
  p_company_id uuid,
  p_conversation_id uuid,
  p_version_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select jsonb_build_object(
    'id', version.id,
    'company_id', version.company_id,
    'conversation_id', version.conversation_id,
    'version_number', version.version_number,
    'predecessor_version_id', version.predecessor_version_id,
    'turn_high_watermark_id', version.turn_high_watermark_id,
    'turn_high_watermark_sequence', version.turn_high_watermark_sequence,
    'source_state_revision', version.source_state_revision,
    'generation_input_hash', version.generation_input_hash,
    'memory_document', version.memory_document,
    'memory_document_hash', version.memory_document_hash,
    'generator_revision', version.generator_revision,
    'created_at', version.created_at
  )
  from public.job_memory_versions version
  where version.company_id = p_company_id
    and version.conversation_id = p_conversation_id
    and version.id = p_version_id;
$function$;

revoke all on function private.job_memory_version_as_json(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.job_memory_document_evidence_links(
  p_memory_document jsonb
) returns table (
  evidence_id text,
  relationship text
)
language sql
immutable
set search_path = pg_catalog, pg_temp
as $function$
  select link.value ->> 'evidence_id',
         link.value ->> 'relationship'
  from (
    select item.value
    from jsonb_array_elements(p_memory_document -> 'facts') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'decisions') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'commitments') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'preferences') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'open_questions') item
    union all
    select claim.value
    from jsonb_array_elements(p_memory_document -> 'contradictions') item
    cross join lateral jsonb_array_elements(
      item.value -> 'competing_claims'
    ) claim
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'schedule_assertions') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'financial_facts') item
    union all
    select item.value
    from jsonb_array_elements(p_memory_document -> 'excluded_assumptions') item
  ) claim
  cross join lateral jsonb_array_elements(claim.value -> 'evidence') link;
$function$;

revoke all on function private.job_memory_document_evidence_links(jsonb)
  from public, anon, authenticated, service_role;

-- One statement returns a source-consistent generation snapshot. Turn
-- coverage follows the monotonic per-conversation sequence, never delivery
-- timestamps or UUID ordering. Effective content applies every current
-- redaction overlay before it can enter a model prompt.
create or replace function public.read_job_memory_generation_snapshot_as_system(
  p_company_id uuid,
  p_conversation_id uuid,
  p_required_through_turn_id uuid,
  p_max_turns integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_current_version_id uuid;
  v_last_turn_sequence bigint;
  v_source_state_revision bigint;
  v_current public.job_memory_versions%rowtype;
  v_current_json jsonb;
  v_current_evidence jsonb := '[]'::jsonb;
  v_pending_turns jsonb := '[]'::jsonb;
  v_invalidated_evidence_ids jsonb := '[]'::jsonb;
  v_required_sequence bigint;
  v_required_state text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_conversation_id is null
     or p_max_turns is null
     or p_max_turns < 1
     or p_max_turns > 50 then
    raise exception 'job_memory_snapshot_invalid'
      using errcode = '22023';
  end if;

  select conversation.current_memory_version_id,
         conversation.last_turn_sequence,
         conversation.source_state_revision
  into v_current_version_id,
       v_last_turn_sequence,
       v_source_state_revision
  from public.job_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.company_id = p_company_id;

  if not found then
    raise exception 'job_memory_conversation_not_found'
      using errcode = 'P0002';
  end if;

  if v_current_version_id is not null then
    select version.*
    into v_current
    from public.job_memory_versions version
    where version.id = v_current_version_id
      and version.company_id = p_company_id
      and version.conversation_id = p_conversation_id;
    if not found then
      raise exception 'job_memory_current_pointer_invalid'
        using errcode = '23503';
    end if;
    v_current_json := private.job_memory_version_as_json(
      p_company_id,
      p_conversation_id,
      v_current_version_id
    );

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'evidence_id', evidence.evidence_id,
                 'relationship', evidence.relationship,
                 'source_domain', evidence.source_domain,
                 'source_type', evidence.source_type,
                 'source_entity_id', evidence.source_entity_id,
                 'source_revision', evidence.source_revision,
                 'source_content_hash', evidence.source_content_hash,
                 'source_participant_id',
                   case
                     when coalesce(redaction.participant_redacted, false)
                       then '[PARTICIPANT REDACTED]'
                     else turn.participant_id
                   end,
                 'source_participant_resolution_status',
                   case
                     when coalesce(redaction.participant_redacted, false)
                       then 'unresolved'
                     else turn.participant_resolution_status
                   end
               ) order by evidence.evidence_id, evidence.relationship
             ),
             '[]'::jsonb
           )
    into v_current_evidence
    from public.job_memory_version_evidence evidence
    join public.job_conversation_turns turn
      on turn.company_id = evidence.company_id
     and turn.conversation_id = evidence.conversation_id
     and turn.id::text = evidence.source_entity_id
    left join lateral (
      select bool_or(event.redaction_kind = 'participant_pseudonymized')
               as participant_redacted
      from public.job_conversation_redaction_events event
      where event.company_id = turn.company_id
        and event.conversation_id = turn.conversation_id
        and event.target_turn_id = turn.id
        and event.source_state_revision <= v_current.source_state_revision
    ) redaction on true
    where evidence.company_id = p_company_id
      and evidence.conversation_id = p_conversation_id
      and evidence.memory_version_id = v_current_version_id;

    select coalesce(
             jsonb_agg(invalidated.evidence_id order by invalidated.evidence_id),
             '[]'::jsonb
           )
    into v_invalidated_evidence_ids
    from (
      select distinct evidence.evidence_id
      from public.job_conversation_redaction_events redaction
      join public.job_conversation_turns turn
        on turn.company_id = redaction.company_id
       and turn.conversation_id = redaction.conversation_id
       and turn.id = redaction.target_turn_id
      join public.job_memory_version_evidence evidence
        on evidence.company_id = redaction.company_id
       and evidence.conversation_id = redaction.conversation_id
       and evidence.memory_version_id = v_current_version_id
       and evidence.source_entity_id = turn.id::text
      where redaction.company_id = p_company_id
        and redaction.conversation_id = p_conversation_id
        and redaction.source_state_revision > v_current.source_state_revision
        and turn.turn_sequence <= v_current.turn_high_watermark_sequence
    ) invalidated;
  end if;

  select coalesce(
           jsonb_agg(projected.payload order by projected.turn_sequence),
           '[]'::jsonb
         )
  into v_pending_turns
  from (
    select turn.turn_sequence,
           jsonb_build_object(
             'id', turn.id,
             'turn_sequence', turn.turn_sequence,
             'source_state_revision', turn.source_state_revision,
             'side',
               case
                 when coalesce(redaction.participant_redacted, false)
                   then null
                 else turn.side
               end,
             'participant_id',
               case
                 when coalesce(redaction.participant_redacted, false)
                   then '[PARTICIPANT REDACTED]'
                 else turn.participant_id
               end,
             'participant_resolution_status',
               case
                 when coalesce(redaction.participant_redacted, false)
                   then 'unresolved'
                 else turn.participant_resolution_status
               end,
             'direction', turn.direction,
             'channel', turn.channel,
             'delivered_at', turn.delivered_at,
             'ingested_at', turn.ingested_at,
             'subject',
               case
                 when coalesce(redaction.content_redacted, false)
                   then '[SUBJECT REDACTED]'
                 else turn.subject
               end,
             'normalized_plain_text',
               case
                 when coalesce(redaction.content_redacted, false)
                   then '[CONTENT REDACTED]'
                 else turn.normalized_plain_text
               end,
             'attachment_evidence_ids',
               case
                 when coalesce(redaction.attachment_redacted, false)
                   then '[]'::jsonb
                 else to_jsonb(turn.attachment_evidence_ids)
               end,
             'provider_delivery_source_id', turn.provider_delivery_source_id,
             'provider_delivery_source_sha256',
               turn.provider_delivery_source_sha256,
             'evidence_source_revision',
               'job-conversation-turn-projection:v1:' ||
               greatest(
                 turn.source_state_revision,
                 coalesce(redaction.max_source_state_revision, 0)
               )::text,
             'evidence_content_hash',
               'sha256:' || encode(
                 extensions.digest(
                   convert_to(
                     jsonb_build_object(
                       'schema', 'ops.job-conversation-turn-projection.v1',
                       'turn_id', turn.id,
                       'provider_source_sha256', provider_source.source_sha256,
                       'subject',
                         case
                           when coalesce(redaction.content_redacted, false)
                             then '[SUBJECT REDACTED]'
                           else turn.subject
                         end,
                       'participant_id',
                         case
                           when coalesce(redaction.participant_redacted, false)
                             then '[PARTICIPANT REDACTED]'
                           else turn.participant_id
                         end,
                       'normalized_plain_text',
                         case
                           when coalesce(redaction.content_redacted, false)
                             then '[CONTENT REDACTED]'
                           else turn.normalized_plain_text
                         end,
                       'attachment_evidence_ids',
                         case
                           when coalesce(redaction.attachment_redacted, false)
                             then '[]'::jsonb
                           else to_jsonb(turn.attachment_evidence_ids)
                         end,
                       'redaction_event_ids',
                         to_jsonb(coalesce(redaction.event_ids, '{}'::uuid[]))
                     )::text,
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               ),
             'redaction_kinds',
               to_jsonb(coalesce(redaction.kinds, '{}'::text[]))
           ) as payload
    from public.job_conversation_turns turn
    join private.agent_provider_delivery_sources provider_source
      on provider_source.company_id = turn.company_id
     and provider_source.id = turn.provider_delivery_source_id
     and provider_source.source_sha256
       = turn.provider_delivery_source_sha256
    left join lateral (
      select bool_or(event.redaction_kind = 'content_redacted')
               as content_redacted,
             bool_or(event.redaction_kind = 'attachment_redacted')
               as attachment_redacted,
             bool_or(event.redaction_kind = 'participant_pseudonymized')
               as participant_redacted,
             max(event.source_state_revision) as max_source_state_revision,
             array_agg(
               event.id order by event.source_state_revision, event.id
             ) as event_ids,
             array_agg(
               distinct event.redaction_kind order by event.redaction_kind
             ) as kinds
      from public.job_conversation_redaction_events event
      where event.company_id = turn.company_id
        and event.conversation_id = turn.conversation_id
        and event.target_turn_id = turn.id
        and event.source_state_revision <= v_source_state_revision
    ) redaction on true
    where turn.company_id = p_company_id
      and turn.conversation_id = p_conversation_id
      and turn.turn_sequence
        > coalesce(v_current.turn_high_watermark_sequence, 0)
    order by turn.turn_sequence
    limit p_max_turns
  ) projected;

  if p_required_through_turn_id is null then
    v_required_state := 'not_requested';
  else
    select turn.turn_sequence
    into v_required_sequence
    from public.job_conversation_turns turn
    where turn.id = p_required_through_turn_id
      and turn.company_id = p_company_id
      and turn.conversation_id = p_conversation_id;
    if not found then
      v_required_state := 'missing';
    elsif v_current_version_id is not null
       and v_current.turn_high_watermark_sequence >= v_required_sequence
       and v_current.turn_high_watermark_sequence = v_last_turn_sequence
       and v_current.source_state_revision = v_source_state_revision then
      v_required_state := 'summarized';
    else
      v_required_state := 'pending';
    end if;
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'conversation_id', p_conversation_id,
    'source_state_revision', v_source_state_revision,
    'last_turn_sequence', v_last_turn_sequence,
    'current_version', v_current_json,
    'current_evidence', v_current_evidence,
    'pending_turns', v_pending_turns,
    'invalidated_evidence_ids', v_invalidated_evidence_ids,
    'required_through', jsonb_build_object(
      'turn_id', p_required_through_turn_id,
      'state', v_required_state
    )
  );
end;
$function$;

revoke all on function public.read_job_memory_generation_snapshot_as_system(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_job_memory_generation_snapshot_as_system(
  uuid, uuid, uuid, integer
) to service_role;

-- The only memory-version write path. The conversation row serializes source
-- mutation and competing builders. Every failure rolls back the version,
-- derived evidence, and pointer together, so immutable orphan versions cannot
-- be created by a partial client-side sequence.
create or replace function public.commit_job_memory_version_as_system(
  p_company_id uuid,
  p_conversation_id uuid,
  p_expected_current_memory_version_id uuid,
  p_expected_source_state_revision bigint,
  p_processed_turn_ids uuid[],
  p_turn_high_watermark_id uuid,
  p_turn_high_watermark_sequence bigint,
  p_generation_input_hash text,
  p_generator_revision text,
  p_memory_document jsonb
) returns table (
  result_kind text,
  current_version jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_conversation public.job_conversations%rowtype;
  v_current public.job_memory_versions%rowtype;
  v_base_turn_sequence bigint := 0;
  v_expected_turn_ids uuid[] := '{}'::uuid[];
  v_memory_version_id uuid;
  v_memory_document_hash text;
  v_next_version_number integer;
  v_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_conversation_id is null
     or p_expected_source_state_revision is null
     or p_expected_source_state_revision < 0
     or p_processed_turn_ids is null
     or p_turn_high_watermark_id is null
     or p_turn_high_watermark_sequence is null
     or p_turn_high_watermark_sequence < 1
     or p_generation_input_hash is null
     or p_generation_input_hash !~ '^sha256:[0-9a-f]{64}$'
     or nullif(btrim(coalesce(p_generator_revision, '')), '') is null
     or p_memory_document is null
     or jsonb_typeof(p_memory_document) <> 'object'
     or octet_length(p_memory_document::text) > 60000 then
    raise exception 'job_memory_commit_invalid'
      using errcode = '22023';
  end if;

  select conversation.*
  into v_conversation
  from public.job_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.company_id = p_company_id
  for update;
  if not found then
    raise exception 'job_memory_conversation_not_found'
      using errcode = 'P0002';
  end if;

  if v_conversation.current_memory_version_id is not null then
    select version.*
    into v_current
    from public.job_memory_versions version
    where version.id = v_conversation.current_memory_version_id
      and version.company_id = p_company_id
      and version.conversation_id = p_conversation_id;
    if not found then
      raise exception 'job_memory_current_pointer_invalid'
        using errcode = '23503';
    end if;
  end if;

  if v_conversation.current_memory_version_id
       is distinct from p_expected_current_memory_version_id then
    if v_conversation.current_memory_version_id is not null
       and v_current.predecessor_version_id
         is not distinct from p_expected_current_memory_version_id
       and v_current.turn_high_watermark_id = p_turn_high_watermark_id
       and v_current.turn_high_watermark_sequence
         = p_turn_high_watermark_sequence
       and v_current.source_state_revision
         = p_expected_source_state_revision
       and v_current.generation_input_hash = p_generation_input_hash
       and v_current.generator_revision = btrim(p_generator_revision)
       and v_current.memory_document = p_memory_document then
      return query
      select 'already_committed'::text,
             private.job_memory_version_as_json(
               p_company_id,
               p_conversation_id,
               v_conversation.current_memory_version_id
             );
      return;
    end if;

    return query
    select 'conflict'::text,
           private.job_memory_version_as_json(
             p_company_id,
             p_conversation_id,
             v_conversation.current_memory_version_id
           );
    return;
  end if;

  if v_conversation.source_state_revision
       <> p_expected_source_state_revision then
    return query
    select 'conflict'::text,
           private.job_memory_version_as_json(
             p_company_id,
             p_conversation_id,
             v_conversation.current_memory_version_id
           );
    return;
  end if;

  if v_conversation.current_memory_version_id is not null then
    v_base_turn_sequence := v_current.turn_high_watermark_sequence;
    v_next_version_number := v_current.version_number + 1;
  else
    v_next_version_number := 1;
  end if;

  if p_turn_high_watermark_sequence < v_base_turn_sequence
     or p_turn_high_watermark_sequence > v_conversation.last_turn_sequence
     or cardinality(p_processed_turn_ids)
       <> p_turn_high_watermark_sequence - v_base_turn_sequence then
    raise exception 'job_memory_turn_watermark_invalid'
      using errcode = '22023';
  end if;

  select coalesce(
           array_agg(turn.id order by turn.turn_sequence),
           '{}'::uuid[]
         )
  into v_expected_turn_ids
  from public.job_conversation_turns turn
  where turn.company_id = p_company_id
    and turn.conversation_id = p_conversation_id
    and turn.turn_sequence > v_base_turn_sequence
    and turn.turn_sequence <= p_turn_high_watermark_sequence;

  if v_expected_turn_ids is distinct from p_processed_turn_ids
     or not exists (
       select 1
       from public.job_conversation_turns turn
       where turn.id = p_turn_high_watermark_id
         and turn.company_id = p_company_id
         and turn.conversation_id = p_conversation_id
         and turn.turn_sequence = p_turn_high_watermark_sequence
     ) then
    raise exception 'job_memory_turn_watermark_invalid'
      using errcode = '22023';
  end if;

  if cardinality(p_processed_turn_ids) = 0
     and (
       v_conversation.current_memory_version_id is null
       or v_current.source_state_revision
         = p_expected_source_state_revision
     ) then
    raise exception 'job_memory_commit_has_no_source_change'
      using errcode = '22023';
  end if;

  if not (p_memory_document ?& array[
       'schema_version',
       'facts',
       'decisions',
       'commitments',
       'preferences',
       'open_questions',
       'contradictions',
       'schedule_assertions',
       'financial_facts',
       'excluded_assumptions'
     ])
     or p_memory_document ->> 'schema_version'
       is distinct from 'ops.job-memory.v1'
     or p_memory_document - array[
       'schema_version',
       'facts',
       'decisions',
       'commitments',
       'preferences',
       'open_questions',
       'contradictions',
       'schedule_assertions',
       'financial_facts',
       'excluded_assumptions'
     ] <> '{}'::jsonb then
    raise exception 'job_memory_document_schema_invalid'
      using errcode = '22023';
  end if;

  foreach v_key in array array[
    'facts',
    'decisions',
    'commitments',
    'preferences',
    'open_questions',
    'contradictions',
    'schedule_assertions',
    'financial_facts',
    'excluded_assumptions'
  ] loop
    if jsonb_typeof(p_memory_document -> v_key)
         is distinct from 'array' then
      raise exception 'job_memory_document_schema_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select item.value
      from jsonb_array_elements(p_memory_document -> 'facts') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'decisions') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'commitments') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'preferences') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'open_questions') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'schedule_assertions') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'financial_facts') item
      union all
      select item.value
      from jsonb_array_elements(p_memory_document -> 'excluded_assumptions') item
    ) claim
    where jsonb_typeof(claim.value) is distinct from 'object'
       or jsonb_typeof(claim.value -> 'evidence') is distinct from 'array'
       or case
            when jsonb_typeof(claim.value -> 'evidence') = 'array'
              then jsonb_array_length(claim.value -> 'evidence') = 0
            else false
          end
  ) or exists (
    select 1
    from jsonb_array_elements(p_memory_document -> 'contradictions') item
    where jsonb_typeof(item.value) is distinct from 'object'
       or jsonb_typeof(item.value -> 'competing_claims')
         is distinct from 'array'
       or case
            when jsonb_typeof(item.value -> 'competing_claims') = 'array'
              then jsonb_array_length(
                item.value -> 'competing_claims'
              ) < 2
            else false
          end
  ) or exists (
    select 1
    from jsonb_array_elements(p_memory_document -> 'contradictions') item
    cross join lateral jsonb_array_elements(
      item.value -> 'competing_claims'
    ) claim
    where jsonb_typeof(claim.value) is distinct from 'object'
       or jsonb_typeof(claim.value -> 'evidence') is distinct from 'array'
       or case
            when jsonb_typeof(claim.value -> 'evidence') = 'array'
              then jsonb_array_length(claim.value -> 'evidence') = 0
            else false
          end
  ) then
    raise exception 'job_memory_document_evidence_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.job_memory_document_evidence_links(p_memory_document) link
    where link.evidence_id is null
       or link.evidence_id !~ (
         '^job_conversation_turn:[0-9a-f]{8}-[0-9a-f]{4}-' ||
         '[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
       or link.relationship is null
       or link.relationship not in (
         'supports',
         'contradicts',
         'supersedes'
       )
  ) then
    raise exception 'job_memory_document_evidence_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.job_memory_document_evidence_links(p_memory_document) link
    left join public.job_conversation_turns turn
      on turn.id = substring(
        link.evidence_id from length('job_conversation_turn:') + 1
      )::uuid
     and turn.company_id = p_company_id
     and turn.conversation_id = p_conversation_id
     and turn.turn_sequence <= p_turn_high_watermark_sequence
    left join private.agent_provider_delivery_sources provider_source
      on provider_source.company_id = turn.company_id
     and provider_source.id = turn.provider_delivery_source_id
     and provider_source.source_sha256
       = turn.provider_delivery_source_sha256
    where turn.id is null or provider_source.id is null
  ) then
    raise exception 'job_memory_evidence_source_invalid'
      using errcode = '23503';
  end if;

  v_memory_document_hash := 'sha256:' || encode(
    extensions.digest(
      convert_to(p_memory_document::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.job_memory_versions (
    company_id,
    conversation_id,
    version_number,
    predecessor_version_id,
    turn_high_watermark_id,
    turn_high_watermark_sequence,
    source_state_revision,
    generation_input_hash,
    memory_document,
    memory_document_hash,
    generator_revision
  ) values (
    p_company_id,
    p_conversation_id,
    v_next_version_number,
    p_expected_current_memory_version_id,
    p_turn_high_watermark_id,
    p_turn_high_watermark_sequence,
    p_expected_source_state_revision,
    p_generation_input_hash,
    p_memory_document,
    v_memory_document_hash,
    btrim(p_generator_revision)
  ) returning id into v_memory_version_id;

  insert into public.job_memory_version_evidence (
    company_id,
    conversation_id,
    memory_version_id,
    evidence_id,
    relationship,
    source_domain,
    source_type,
    source_entity_id,
    source_revision,
    source_content_hash
  )
  select distinct
         p_company_id,
         p_conversation_id,
         v_memory_version_id,
         link.evidence_id,
         link.relationship,
         'job_conversation',
         'delivered_email_turn',
         turn.id::text,
         'job-conversation-turn-projection:v1:' ||
           greatest(
             turn.source_state_revision,
             coalesce(redaction.max_source_state_revision, 0)
           )::text,
         'sha256:' || encode(
           extensions.digest(
             convert_to(
               jsonb_build_object(
                 'schema', 'ops.job-conversation-turn-projection.v1',
                 'turn_id', turn.id,
                 'provider_source_sha256', provider_source.source_sha256,
                 'subject',
                   case
                     when coalesce(redaction.content_redacted, false)
                       then '[SUBJECT REDACTED]'
                     else turn.subject
                   end,
                 'participant_id',
                   case
                     when coalesce(redaction.participant_redacted, false)
                       then '[PARTICIPANT REDACTED]'
                     else turn.participant_id
                   end,
                 'normalized_plain_text',
                   case
                     when coalesce(redaction.content_redacted, false)
                       then '[CONTENT REDACTED]'
                     else turn.normalized_plain_text
                   end,
                 'attachment_evidence_ids',
                   case
                     when coalesce(redaction.attachment_redacted, false)
                       then '[]'::jsonb
                     else to_jsonb(turn.attachment_evidence_ids)
                   end,
                 'redaction_event_ids',
                   to_jsonb(coalesce(redaction.event_ids, '{}'::uuid[]))
               )::text,
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
  from private.job_memory_document_evidence_links(p_memory_document) link
  join public.job_conversation_turns turn
    on turn.id = substring(
      link.evidence_id from length('job_conversation_turn:') + 1
    )::uuid
   and turn.company_id = p_company_id
   and turn.conversation_id = p_conversation_id
   and turn.turn_sequence <= p_turn_high_watermark_sequence
  join private.agent_provider_delivery_sources provider_source
    on provider_source.company_id = turn.company_id
   and provider_source.id = turn.provider_delivery_source_id
   and provider_source.source_sha256
     = turn.provider_delivery_source_sha256
  left join lateral (
    select bool_or(event.redaction_kind = 'content_redacted')
             as content_redacted,
           bool_or(event.redaction_kind = 'attachment_redacted')
             as attachment_redacted,
           bool_or(event.redaction_kind = 'participant_pseudonymized')
             as participant_redacted,
           max(event.source_state_revision) as max_source_state_revision,
           array_agg(
             event.id order by event.source_state_revision, event.id
           ) as event_ids
    from public.job_conversation_redaction_events event
    where event.company_id = turn.company_id
      and event.conversation_id = turn.conversation_id
      and event.target_turn_id = turn.id
      and event.source_state_revision <= p_expected_source_state_revision
  ) redaction on true;

  update public.job_conversations conversation
  set current_memory_version_id = v_memory_version_id,
      updated_at = clock_timestamp()
  where conversation.id = p_conversation_id
    and conversation.company_id = p_company_id;

  return query
  select 'committed'::text,
         private.job_memory_version_as_json(
           p_company_id,
           p_conversation_id,
           v_memory_version_id
         );
end;
$function$;

revoke all on function public.commit_job_memory_version_as_system(
  uuid, uuid, uuid, bigint, uuid[], uuid, bigint, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.commit_job_memory_version_as_system(
  uuid, uuid, uuid, bigint, uuid[], uuid, bigint, text, text, jsonb
) to service_role;

-- Account closure is manifest-driven and service_role intentionally has no
-- direct DELETE privilege on these append-only records. Keep the final helper
-- definition in this migration synchronized with DEFINER_PURGED_TABLES. The
-- marker is transaction-local, scoped to one exact company, and accepted by
-- immutable triggers only after purge_company_data has cleared request claims.
create or replace function public.purge_company_rows(
  p_table text,
  p_company_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_allowed constant text[] := array[
    'email_assignment_contact_form_draft_queue',
    'email_import_provider_operations',
    'email_outbound_edit_evidence',
    'email_outbound_edit_promotions',
    'email_outbound_learning_queue',
    'email_outbound_memory_evidence',
    'email_outbound_writing_samples',
    'email_provider_mutation_attempts',
    'opportunity_conversion_notification_deliveries',
    'phase_c_category_auto_send_acceptances',
    'project_status_lifecycle_outbox',
    'task_mutation_events',
    'task_schedule_automation_outbox',
    'unassigned_lead_assignment_deliveries',
    'user_permission_change_deliveries',
    'email_conversion_photo_jobs',
    'email_conversion_photo_objects',
    'email_ingestion_recovery_queue',
    'email_send_intents',
    'email_signature_notification_lifecycle_outbox',
    'email_signatures',
    'lead_intake_correction_runs',
    'opportunity_assignment_deliveries',
    'opportunity_assignment_events',
    'opportunity_assignment_suggestions',
    'opportunity_conversion_events',
    'opportunity_manual_outbound_cycle_receipts',
    'project_note_mention_events',
    'stage_transitions',
    'user_email_aliases',
    'agent_control_plane_tenant_roots',
    'job_memory_version_evidence',
    'job_memory_versions',
    'job_conversation_redaction_events',
    'job_conversation_turns',
    'job_conversation_anchors',
    'job_conversations'
  ];
  v_column_type text;
  v_deleted bigint;
  v_previous_purge_company_id text :=
    pg_catalog.current_setting('ops.company_data_purge_company_id', true);
begin
  if p_company_id is null then
    raise exception 'purge_company_rows: p_company_id is required'
      using errcode = '22004';
  end if;

  if not (p_table = any (v_allowed)) then
    raise exception
      'purge_company_rows: % is not purgeable through this function',
      p_table
      using errcode = '42501';
  end if;

  select case
           when attribute.atttypid = 'uuid'::regtype then 'uuid'
           when attribute.atttypid in (
             'text'::regtype,
             'varchar'::regtype
           ) then 'text'
         end
  into v_column_type
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation
    on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = p_table
    and attribute.attname = 'company_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_column_type is null then
    raise exception
      'purge_company_rows: %.company_id is missing or unsupported',
      p_table
      using errcode = '42703';
  end if;

  begin
    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      p_company_id::text,
      true
    );

    execute pg_catalog.format(
      'delete from public.%I where company_id = $1::%s',
      p_table,
      v_column_type
    ) using p_company_id;

    get diagnostics v_deleted = row_count;

    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      coalesce(v_previous_purge_company_id, ''),
      true
    );
  exception when others then
    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      coalesce(v_previous_purge_company_id, ''),
      true
    );
    raise;
  end;

  return v_deleted;
end;
$function$;

revoke all on function public.purge_company_rows(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_company_rows(text, uuid)
  to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one of thirty-seven allowlisted company-data tables. The transaction-local marker preserves immutable ledgers while account closure erases the exact tenant.';

-- Direct writes remain unavailable even to service_role; future memory-version
-- writes receive their own optimistic, guarded functions. Service repositories
-- may read exact rows after ActorContext authorization.
revoke all on table public.job_conversations
  from public, anon, authenticated, service_role;
revoke all on table public.job_conversation_anchors
  from public, anon, authenticated, service_role;
revoke all on table public.job_conversation_turns
  from public, anon, authenticated, service_role;
revoke all on table public.job_memory_versions
  from public, anon, authenticated, service_role;
revoke all on table public.job_memory_version_evidence
  from public, anon, authenticated, service_role;
revoke all on table public.job_conversation_redaction_events
  from public, anon, authenticated, service_role;

revoke insert, update, delete on table public.job_conversations
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.job_conversation_anchors
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.job_conversation_turns
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.job_memory_versions
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.job_memory_version_evidence
  from anon, authenticated, service_role;
revoke insert, update, delete on table public.job_conversation_redaction_events
  from anon, authenticated, service_role;

grant select on table public.job_conversations
  to authenticated, service_role;
grant select on table public.job_conversation_anchors
  to authenticated, service_role;
grant select on table public.job_conversation_turns
  to service_role;
grant select on table public.job_memory_versions
  to service_role;
grant select on table public.job_memory_version_evidence
  to service_role;
grant select on table public.job_conversation_redaction_events
  to service_role;

commit;
