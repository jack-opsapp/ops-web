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
  turn_high_watermark_id uuid,
  memory_document jsonb not null
    check (jsonb_typeof(memory_document) = 'object'),
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
  check (predecessor_version_id is distinct from id)
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
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, conversation_id, target_turn_id)
    references public.job_conversation_turns(company_id, conversation_id, id)
    on delete restrict,
  foreign key (company_id, actor_user_id)
    references public.users(company_id, id) on delete restrict,
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
  p_side text,
  p_participant_id text,
  p_participant_resolution_status text,
  p_participant_resolution_revision text,
  p_direction text,
  p_channel text,
  p_delivered_at timestamptz,
  p_source_connection_id uuid,
  p_provider_message_id text,
  p_source_activity_id uuid,
  p_source_correspondence_event_id uuid,
  p_subject text,
  p_normalized_plain_text text,
  p_original_content_hash text,
  p_recipient_identities text[] default '{}'::text[],
  p_cc_recipient_identities text[] default '{}'::text[],
  p_attachment_evidence_ids text[] default '{}'::text[]
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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_job_id is null
     or p_job_kind is null
     or p_job_kind not in ('opportunity', 'project')
     or (p_side is not null and p_side not in ('user', 'assistant'))
     or p_participant_resolution_status is null
     or p_participant_resolution_status not in (
       'resolved',
       'unresolved',
       'ambiguous'
     )
     or (
       p_participant_resolution_status = 'resolved'
       and not (
         (p_direction = 'inbound' and p_side = 'user')
         or (p_direction = 'outbound' and p_side = 'assistant')
       )
     )
     or (
       p_participant_resolution_status in ('unresolved', 'ambiguous')
       and p_side is not null
     )
     or p_direction is null
     or p_direction not in ('inbound', 'outbound')
     or p_channel is null
     or p_channel <> 'email'
     or p_delivered_at is null
     or p_source_connection_id is null
     or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_participant_id, '')), '') is null
     or nullif(
       btrim(coalesce(p_participant_resolution_revision, '')),
       ''
     ) is null
     or p_normalized_plain_text is null
     or p_original_content_hash is null
     or p_original_content_hash !~ '^sha256:[0-9a-f]{64}$'
     or (
       p_source_activity_id is null
       and p_source_correspondence_event_id is null
     ) then
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

  if p_source_activity_id is not null and not exists (
    select 1
    from public.activities activity
    where activity.id = p_source_activity_id
      and activity.company_id = p_company_id
      and activity.type = 'email'
      and activity.direction = p_direction
      and activity.email_connection_id = p_source_connection_id
      and activity.email_message_id = btrim(p_provider_message_id)
      and (
        (v_opportunity_id is not null
          and activity.opportunity_id = v_opportunity_id)
        or
        (v_project_id is not null
          and activity.project_id = v_project_id::text)
      )
  ) then
    raise exception 'job_conversation_source_activity_invalid'
      using errcode = '23503';
  end if;

  if p_source_correspondence_event_id is not null and not exists (
    select 1
    from public.opportunity_correspondence_events event
    where event.id = p_source_correspondence_event_id
      and event.company_id = p_company_id
      and event.opportunity_id = v_opportunity_id
      and event.connection_id = p_source_connection_id
      and event.provider_message_id = btrim(p_provider_message_id)
      and event.direction = p_direction
      and (
        p_source_activity_id is null
        or event.activity_id = p_source_activity_id
      )
  ) then
    raise exception 'job_conversation_source_event_invalid'
      using errcode = '23503';
  end if;

  insert into public.job_conversation_turns (
    company_id,
    conversation_id,
    side,
    participant_id,
    participant_resolution_status,
    participant_resolution_revision,
    direction,
    channel,
    delivered_at,
    source_connection_id,
    provider_message_id,
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
    p_side,
    btrim(p_participant_id),
    p_participant_resolution_status,
    btrim(p_participant_resolution_revision),
    p_direction,
    p_channel,
    p_delivered_at,
    p_source_connection_id,
    btrim(p_provider_message_id),
    p_source_activity_id,
    p_source_correspondence_event_id,
    p_subject,
    coalesce(p_recipient_identities, '{}'::text[]),
    coalesce(p_cc_recipient_identities, '{}'::text[]),
    p_normalized_plain_text,
    p_original_content_hash,
    coalesce(p_attachment_evidence_ids, '{}'::text[])
  )
  on conflict (company_id, source_connection_id, provider_message_id)
  do nothing
  returning id into v_turn_id;

  v_inserted := v_turn_id is not null;
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
       or v_existing_turn.side is distinct from p_side
       or v_existing_turn.participant_id is distinct from btrim(p_participant_id)
       or v_existing_turn.participant_resolution_status
         is distinct from p_participant_resolution_status
       or v_existing_turn.participant_resolution_revision
         is distinct from btrim(p_participant_resolution_revision)
       or v_existing_turn.direction is distinct from p_direction
       or v_existing_turn.channel is distinct from p_channel
       or v_existing_turn.delivered_at is distinct from p_delivered_at
       or v_existing_turn.source_activity_id
         is distinct from p_source_activity_id
       or v_existing_turn.source_correspondence_event_id
         is distinct from p_source_correspondence_event_id
       or v_existing_turn.subject is distinct from p_subject
       or v_existing_turn.recipient_identities
         is distinct from coalesce(p_recipient_identities, '{}'::text[])
       or v_existing_turn.cc_recipient_identities
         is distinct from coalesce(p_cc_recipient_identities, '{}'::text[])
       or v_existing_turn.normalized_plain_text
         is distinct from p_normalized_plain_text
       or v_existing_turn.original_content_hash
         is distinct from p_original_content_hash
       or v_existing_turn.attachment_evidence_ids
         is distinct from coalesce(p_attachment_evidence_ids, '{}'::text[]) then
      raise exception 'job_conversation_source_idempotency_conflict'
        using errcode = '23505';
    end if;
    v_turn_id := v_existing_turn.id;
  end if;

  return query select v_conversation_id, v_turn_id, v_inserted;
end;
$function$;

revoke all on function public.ingest_job_conversation_turn_as_system(
  uuid, text, uuid, text, text, text, text, text, text, timestamptz,
  uuid, text, uuid, uuid, text, text, text, text[], text[], text[]
) from public, anon, authenticated, service_role;
grant execute on function public.ingest_job_conversation_turn_as_system(
  uuid, text, uuid, text, text, text, text, text, text, timestamptz,
  uuid, text, uuid, uuid, text, text, text, text[], text[], text[]
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
