-- Task 13: current customer job catalog, purpose-minimized job summaries,
-- bounded job-history search, and exact job-bound correspondence evidence.
-- All public entry points are fixed service-role capabilities. Authority,
-- entity visibility, source fences, source rows, projections, and proofs are
-- resolved inside one stable statement; browser roles receive no execution
-- authority and no function relies on RLS as its authorization boundary.

begin;

do $prerequisites$
declare
  v_signature text;
  v_relation text;
begin
  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)',
    'private.resolve_opportunity_client_id(uuid,uuid)',
    'private.canonical_agent_projection_json(jsonb)',
    'private.agent_rfc3339_utc(timestamp with time zone)',
    'private.agent_assert_operational_timezone_rules()',
    'private.bump_agent_operational_read_revision()',
    'extensions.digest(bytea,text)',
    'private.read_agent_job_participant_snapshot(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text,text)',
    'public.read_agent_job_communication_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text)',
    'public.read_agent_job_participants_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text)',
    'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
    'public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[])',
    'public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'agent_job_catalog_reads_prerequisite_missing: %',
        v_signature;
    end if;
  end loop;

  foreach v_relation in array array[
    'public.companies',
    'public.clients',
    'public.sub_clients',
    'public.opportunities',
    'public.projects',
    'public.project_tasks',
    'public.task_types',
    'public.project_photos',
    'public.estimates',
    'public.invoices',
    'public.stage_transitions',
    'public.project_status_lifecycle_outbox',
    'public.task_mutation_events',
    'public.job_conversations',
    'public.job_conversation_anchors',
    'public.job_conversation_turns',
    'public.email_attachments',
    'public.job_memory_versions',
    'public.job_conversation_redaction_events',
    'private.agent_operational_read_revisions'
  ] loop
    if to_regclass(v_relation) is null then
      raise exception 'agent_job_catalog_reads_prerequisite_missing: %',
        v_relation;
    end if;
  end loop;
end;
$prerequisites$;

-- Customer job keysets. Expression order exactly matches the two selectable
-- date fields and customer-resolution predicate. Soft-deleted rows never enter
-- either partial index.
create index if not exists opportunities_agent_customer_jobs_created_keyset_idx
  on public.opportunities (
    company_id,
    coalesce(client_ref, client_id),
    created_at desc,
    id desc
  )
  where deleted_at is null and merged_into_opportunity_id is null;

create index if not exists opportunities_agent_customer_jobs_updated_keyset_idx
  on public.opportunities (
    company_id,
    coalesce(client_ref, client_id),
    updated_at desc,
    id desc
  )
  where deleted_at is null and merged_into_opportunity_id is null;

create index if not exists projects_agent_customer_jobs_created_keyset_idx
  on public.projects (company_id, client_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists projects_agent_customer_jobs_updated_keyset_idx
  on public.projects (company_id, client_id, updated_at desc, id desc)
  where deleted_at is null;

-- Search expressions contain only fields approved for the Task 13 projection.
create index if not exists job_conversation_turns_agent_history_fts_idx
  on public.job_conversation_turns using gin (
    to_tsvector(
      'simple',
      case when octet_length(
        coalesce(subject, '') || ' ' || coalesce(normalized_plain_text, '')
      ) <= 524288 then
        coalesce(subject, '') || ' ' || coalesce(normalized_plain_text, '')
      else '' end
    )
  )
  where octet_length(
    coalesce(subject, '') || ' ' || coalesce(normalized_plain_text, '')
  ) <= 524288;

create index if not exists job_memory_versions_agent_history_fts_idx
  on public.job_memory_versions using gin (
    to_tsvector(
      'simple',
      case when octet_length(memory_document::text) <= 60000
        then memory_document::text else '' end
    )
  )
  where octet_length(memory_document::text) <= 60000;

create index if not exists stage_transitions_agent_history_keyset_idx
  on public.stage_transitions (
    company_id,
    opportunity_id,
    transitioned_at desc,
    id desc
  );

create index if not exists project_status_lifecycle_agent_history_keyset_idx
  on public.project_status_lifecycle_outbox (
    company_id,
    project_id,
    requested_at desc,
    id desc
  );

create index if not exists task_mutation_events_agent_history_keyset_idx
  on public.task_mutation_events (
    company_id,
    project_id,
    created_at desc,
    id desc
  );

create index if not exists estimates_agent_history_opportunity_keyset_idx
  on public.estimates (
    company_id,
    opportunity_id,
    updated_at desc,
    id desc
  )
  where deleted_at is null and opportunity_id is not null;

create index if not exists estimates_agent_history_project_keyset_idx
  on public.estimates (
    company_id,
    project_id,
    updated_at desc,
    id desc
  )
  where deleted_at is null and project_id is not null;

create index if not exists estimates_agent_history_fts_idx
  on public.estimates using gin (
    to_tsvector(
      'simple',
      case when octet_length(
        coalesce(estimate_number, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(client_message, '') || ' ' ||
        coalesce(terms, '') || ' ' ||
        coalesce(status, '')
      ) <= 524288 then
        coalesce(estimate_number, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(client_message, '') || ' ' ||
        coalesce(terms, '') || ' ' ||
        coalesce(status, '')
      else '' end
    )
  )
  where deleted_at is null
    and octet_length(
      coalesce(estimate_number, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(client_message, '') || ' ' ||
      coalesce(terms, '') || ' ' ||
      coalesce(status, '')
    ) <= 524288;

-- New current-state sources advance the existing tenant-local source fence.
-- Existing migrations already cover companies/clients/subclients,
-- opportunities/projects, tasks/types/photos, and conversation primitives.
drop trigger if exists estimates_bump_agent_operational_read_revision
  on public.estimates;
create trigger estimates_bump_agent_operational_read_revision
after insert or update or delete on public.estimates
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists invoices_bump_agent_operational_read_revision
  on public.invoices;
create trigger invoices_bump_agent_operational_read_revision
after insert or update or delete on public.invoices
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists job_memory_versions_bump_agent_operational_read_revision
  on public.job_memory_versions;
create trigger job_memory_versions_bump_agent_operational_read_revision
after insert or update or delete on public.job_memory_versions
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists stage_transitions_bump_agent_operational_read_revision
  on public.stage_transitions;
create trigger stage_transitions_bump_agent_operational_read_revision
after insert or update or delete on public.stage_transitions
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists project_status_lifecycle_outbox_bump_agent_operational_read_revision
  on public.project_status_lifecycle_outbox;
create trigger project_status_lifecycle_outbox_bump_agent_operational_read_revision
after insert or update or delete on public.project_status_lifecycle_outbox
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists task_mutation_events_bump_agent_operational_read_revision
  on public.task_mutation_events;
create trigger task_mutation_events_bump_agent_operational_read_revision
after insert or update or delete on public.task_mutation_events
for each row execute function private.bump_agent_operational_read_revision();

-- A distinct history fence prevents a current-state update from being
-- mistaken for an immutable-event snapshot. It is private, tenant-local,
-- monotonic, and constrained to the JavaScript safe-integer range.
create table if not exists private.agent_job_history_revisions (
  company_id uuid primary key
    references public.companies(id) on delete cascade,
  history_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint agent_job_history_revisions_safe_integer
    check (history_revision between 0 and 9007199254740991)
);

revoke all on table private.agent_job_history_revisions
  from public, anon, authenticated, service_role;

insert into private.agent_job_history_revisions (
  company_id,
  history_revision,
  updated_at
)
select company.id, 0, statement_timestamp()
from public.companies company
on conflict (company_id) do nothing;

create or replace function private.seed_agent_job_history_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
begin
  insert into private.agent_job_history_revisions (
    company_id,
    history_revision,
    updated_at
  ) values (
    new.id,
    0,
    statement_timestamp()
  )
  on conflict (company_id) do nothing;
  return null;
end;
$function$;

revoke all on function private.seed_agent_job_history_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists companies_seed_agent_job_history_revision
  on public.companies;
create trigger companies_seed_agent_job_history_revision
after insert on public.companies
for each row execute function private.seed_agent_job_history_revision();

create or replace function private.advance_agent_job_history_revision(
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
begin
  if p_company_id is null then
    return;
  end if;

  insert into private.agent_job_history_revisions as revision (
    company_id,
    history_revision,
    updated_at
  ) values (
    p_company_id,
    1,
    statement_timestamp()
  )
  on conflict (company_id) do update
  set history_revision = revision.history_revision + 1,
      updated_at = excluded.updated_at
  where revision.history_revision < 9007199254740991;

  if not found then
    raise exception 'agent_job_history_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$;

revoke all on function private.advance_agent_job_history_revision(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.bump_agent_job_history_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_company_id := old.company_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_company_id := new.company_id;
  end if;

  perform private.advance_agent_job_history_revision(v_old_company_id);
  if v_new_company_id is distinct from v_old_company_id then
    perform private.advance_agent_job_history_revision(v_new_company_id);
  end if;
  return null;
end;
$function$;

revoke all on function private.bump_agent_job_history_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists job_conversations_bump_agent_job_history_revision
  on public.job_conversations;
create trigger job_conversations_bump_agent_job_history_revision
after insert or update or delete on public.job_conversations
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists job_conversation_anchors_bump_agent_job_history_revision
  on public.job_conversation_anchors;
create trigger job_conversation_anchors_bump_agent_job_history_revision
after insert or update or delete on public.job_conversation_anchors
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists job_conversation_turns_bump_agent_job_history_revision
  on public.job_conversation_turns;
create trigger job_conversation_turns_bump_agent_job_history_revision
after insert or update or delete on public.job_conversation_turns
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists job_memory_versions_bump_agent_job_history_revision
  on public.job_memory_versions;
create trigger job_memory_versions_bump_agent_job_history_revision
after insert or update or delete on public.job_memory_versions
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists job_conversation_redaction_events_bump_agent_job_history_revision
  on public.job_conversation_redaction_events;
create trigger job_conversation_redaction_events_bump_agent_job_history_revision
after insert or update or delete on public.job_conversation_redaction_events
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists stage_transitions_bump_agent_job_history_revision
  on public.stage_transitions;
create trigger stage_transitions_bump_agent_job_history_revision
after insert or update or delete on public.stage_transitions
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists project_status_lifecycle_outbox_bump_agent_job_history_revision
  on public.project_status_lifecycle_outbox;
create trigger project_status_lifecycle_outbox_bump_agent_job_history_revision
after insert or update or delete on public.project_status_lifecycle_outbox
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists task_mutation_events_bump_agent_job_history_revision
  on public.task_mutation_events;
create trigger task_mutation_events_bump_agent_job_history_revision
after insert or update or delete on public.task_mutation_events
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists estimates_bump_agent_job_history_revision
  on public.estimates;
create trigger estimates_bump_agent_job_history_revision
after insert or update or delete on public.estimates
for each row execute function private.bump_agent_job_history_revision();

drop trigger if exists email_attachments_bump_agent_job_history_revision
  on public.email_attachments;
create trigger email_attachments_bump_agent_job_history_revision
after insert or update or delete on public.email_attachments
for each row execute function private.bump_agent_job_history_revision();

-- Canonical ISO 4217 minor-unit exponent. The accepted currency vocabulary is
-- the complete public contract vocabulary; codes with no currency minor unit
-- (fund/metal/test/reserved units) fail closed rather than inventing cents.
create or replace function private.agent_currency_minor_exponent(
  p_currency_code text
) returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog
as $function$
begin
  case upper(p_currency_code)
    when 'JPY' then
      return 0;
    when 'CAD' then
      return 2;
    when 'BHD' then
      return 3;
    when 'CLF' then
      return 4;
    when 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG',
         'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' then
      return 0;
    when 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' then
      return 3;
    when 'UYW' then
      return 4;
    when 'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
         'BAM', 'BBD', 'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BOV', 'BRL',
         'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CDF', 'CHE', 'CHW',
         'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK', 'DKK', 'DOP',
         'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL',
         'GHS', 'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF',
         'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR', 'KPW',
         'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL',
         'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK',
         'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
         'NZD', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'QAR', 'RON',
         'RSD', 'RUB', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP',
         'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
         'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'USD',
         'USN', 'UYU', 'UZS', 'VED', 'VES', 'WST', 'XCD', 'YER', 'ZAR',
         'ZMW', 'ZWL' then
      return 2;
    else
      raise exception 'agent_currency_minor_exponent_unknown: %',
        p_currency_code using errcode = '22023';
  end case;
end;
$function$;

revoke all on function private.agent_currency_minor_exponent(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_currency_minor_exponent_or_null(
  p_currency_code text
) returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
begin
  return private.agent_currency_minor_exponent(p_currency_code);
exception
  when sqlstate '22023' then
    return null;
end;
$function$;

revoke all on function private.agent_currency_minor_exponent_or_null(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_money_to_minor_units(
  p_amount numeric,
  p_currency_code text
) returns bigint
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_scaled numeric;
begin
  v_scaled := p_amount * power(10::numeric,
    private.agent_currency_minor_exponent(p_currency_code));
  if v_scaled::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  if trunc(v_scaled) is distinct from v_scaled then
    raise exception 'agent_money_minor_units_not_exact'
      using errcode = '22023';
  end if;
  if abs(v_scaled) > 9007199254740991::numeric then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  return v_scaled::bigint;
end;
$function$;

revoke all on function private.agent_money_to_minor_units(numeric, text)
  from public, anon, authenticated, service_role;

-- Recursively change a JSON string fragment while preserving every other JSON
-- type. The v6 bridge uses it for hashes embedded in version strings and in
-- retained-proof-source atoms.
create or replace function private.agent_replace_jsonb_text(
  p_value jsonb,
  p_from text,
  p_to text
) returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'array' then
      select coalesce(
        jsonb_agg(
          private.agent_replace_jsonb_text(element.value, p_from, p_to)
          order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality
        element(value, ordinality);
      return v_result;
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          member.key,
          private.agent_replace_jsonb_text(member.value, p_from, p_to)
        ),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) member(key, value);
      return v_result;
    when 'string' then
      return to_jsonb(replace(p_value #>> '{}', p_from, p_to));
    else
      return p_value;
  end case;
end;
$function$;

revoke all on function private.agent_replace_jsonb_text(jsonb, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_set_jsonb_key_recursive(
  p_value jsonb,
  p_key text,
  p_replacement jsonb
) returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'array' then
      select coalesce(
        jsonb_agg(
          private.agent_set_jsonb_key_recursive(
            element.value,
            p_key,
            p_replacement
          ) order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality
        element(value, ordinality);
      return v_result;
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          member.key,
          case when member.key = p_key then p_replacement else
            private.agent_set_jsonb_key_recursive(
              member.value,
              p_key,
              p_replacement
            )
          end
        ),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) member(key, value);
      return v_result;
    else
      return p_value;
  end case;
end;
$function$;

revoke all on function private.agent_set_jsonb_key_recursive(jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

-- Return every nested object so the bridge can recompute both Task 11's
-- direct projection proofs and Task 12's nested atomic claim proofs.
create or replace function private.agent_jsonb_objects(
  p_value jsonb
) returns setof jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    return next p_value;
    for v_child in select member.value from jsonb_each(p_value) member loop
      return query select nested.value
      from private.agent_jsonb_objects(v_child) nested(value);
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select element.value from jsonb_array_elements(p_value) element loop
      return query select nested.value
      from private.agent_jsonb_objects(v_child) nested(value);
    end loop;
  end if;
  return;
end;
$function$;

revoke all on function private.agent_jsonb_objects(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.reprove_agent_read_jsonb_for_manifest(
  p_result jsonb,
  p_capability_manifest_revision text
) returns jsonb
language plpgsql
stable
strict
security definer
set search_path = pg_catalog, private, extensions, pg_temp
as $function$
declare
  v_result jsonb;
  v_object jsonb;
  v_projection jsonb;
  v_old_hash text;
  v_new_hash text;
  v_pass integer;
  v_changed boolean;
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_manifest_reproof_request'
      using errcode = '22023';
  end if;

  v_result := private.agent_set_jsonb_key_recursive(
    p_result,
    'capability_manifest_revision',
    to_jsonb(p_capability_manifest_revision)
  );

  -- At most sixteen proof-dependency layers are allowed. Normal readers use
  -- two (item then envelope); the larger bound fails closed for unexpected
  -- legacy nesting without making the operation unbounded.
  for v_pass in 1..16 loop
    v_changed := false;
    for v_object in
      select object_value
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
    loop
      v_projection := v_object -> 'projection';
      v_old_hash := v_object ->> 'source_content_hash';
      v_new_hash := 'sha256:' || encode(
        extensions.digest(
          convert_to(
            private.canonical_agent_projection_json(v_projection),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );
      if v_new_hash is distinct from v_old_hash then
        v_result := private.agent_replace_jsonb_text(
          v_result,
          v_old_hash,
          v_new_hash
        );
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  if v_changed then
    raise exception 'agent_manifest_reproof_depth_exceeded'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.reprove_agent_read_jsonb_for_manifest(jsonb, text)
  from public, anon, authenticated, service_role;

-- Manifest v6 compatibility for Task 12's shared participant snapshot. The
-- complete v5 implementation remains private and unexecutable. The current
-- private name accepts only v6, delegates through a fixed-literal bridge, and
-- rebinds every returned projection/hash/version atom before it can reach a
-- current public wrapper.
alter function private.read_agent_job_participant_snapshot(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text, text
) rename to read_agent_job_participant_snapshot_v5_impl;

revoke all on function private.read_agent_job_participant_snapshot_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_job_participant_snapshot_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text,
  p_projection_kind text
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_job_participant_snapshot_v5_impl(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-13.capability-manifest.v5',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_projects_scope,
      p_calendar_scope,
      p_tasks_scope,
      p_photos_scope,
      p_job_kind,
      p_job_id,
      p_purpose,
      p_projection_kind
    ),
    '2026-08-14.capability-manifest.v6'
  );
$function$;

revoke all on function private.read_agent_job_participant_snapshot_v6_bridge(
  text, uuid, uuid, text, text[], text, text, text[], text, text, text, text,
  text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_job_participant_snapshot(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text,
  p_projection_kind text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_participant_snapshot_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_participant_snapshot_v6_bridge(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    p_required_oauth_scopes,
    p_inbox_scope,
    p_clients_scope,
    p_job_permission,
    p_job_scope,
    p_projects_scope,
    p_calendar_scope,
    p_tasks_scope,
    p_photos_scope,
    p_job_kind,
    p_job_id,
    p_purpose,
    p_projection_kind
  );
end;
$function$;

revoke all on function private.read_agent_job_participant_snapshot(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

-- Replace the two Task 12 public wrappers directly. They retain all fixed
-- capability/OAuth checks and now call the v6 snapshot name with the caller's
-- already-pinned current manifest revision.
alter function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) rename to read_agent_job_communication_context_v5_impl;
alter function public.read_agent_job_communication_context_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) set schema private;
revoke all on function private.read_agent_job_communication_context_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_communication_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_expected_oauth_scopes text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_job_communication_context'
     or p_capability_revision is distinct from
       'get_job_communication_context:2026-08-13.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.correspondence.read'::text as scope
    union all select 'ops.customer_contacts.read'::text
    union all select 'ops.customers.read'::text
    union all select 'ops.jobs.read'::text
    union all select 'ops.schedule.read'::text
      where p_purpose in ('schedule_notice', 'photo_request')
    union all select 'ops.photos.read'::text
      where p_purpose = 'photo_request'
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;

  return private.read_agent_job_participant_snapshot(
    p_request_id => p_request_id,
    p_actor_user_id => p_actor_user_id,
    p_company_id => p_company_id,
    p_permission_snapshot_revision => p_permission_snapshot_revision,
    p_registered_permission_keys => p_registered_permission_keys,
    p_capability_id => p_capability_id,
    p_capability_revision => p_capability_revision,
    p_capability_manifest_revision => p_capability_manifest_revision,
    p_required_oauth_scopes => p_required_oauth_scopes,
    p_inbox_scope => p_inbox_scope,
    p_clients_scope => p_clients_scope,
    p_job_permission => p_job_permission,
    p_job_scope => p_job_scope,
    p_projects_scope => p_projects_scope,
    p_calendar_scope => p_calendar_scope,
    p_tasks_scope => p_tasks_scope,
    p_photos_scope => p_photos_scope,
    p_job_kind => p_job_kind,
    p_job_id => p_job_id,
    p_purpose => p_purpose,
    p_projection_kind => 'communication'
  );
end;
$function$;

revoke all on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) to service_role;

alter function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) rename to read_agent_job_participants_v5_impl;
alter function public.read_agent_job_participants_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) set schema private;
revoke all on function private.read_agent_job_participants_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_participants_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'resolve_job_participants'
     or p_capability_revision is distinct from
       'resolve_job_participants:2026-08-13.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_required_oauth_scopes is distinct from array[
       'ops.correspondence.read',
       'ops.customer_contacts.read',
       'ops.customers.read',
       'ops.jobs.read'
     ]::text[] then
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;

  return private.read_agent_job_participant_snapshot(
    p_request_id => p_request_id,
    p_actor_user_id => p_actor_user_id,
    p_company_id => p_company_id,
    p_permission_snapshot_revision => p_permission_snapshot_revision,
    p_registered_permission_keys => p_registered_permission_keys,
    p_capability_id => p_capability_id,
    p_capability_revision => p_capability_revision,
    p_capability_manifest_revision => p_capability_manifest_revision,
    p_required_oauth_scopes => p_required_oauth_scopes,
    p_inbox_scope => p_inbox_scope,
    p_clients_scope => p_clients_scope,
    p_job_permission => p_job_permission,
    p_job_scope => p_job_scope,
    p_projects_scope => p_projects_scope,
    p_calendar_scope => null,
    p_tasks_scope => p_tasks_scope,
    p_photos_scope => null,
    p_job_kind => p_job_kind,
    p_job_id => p_job_id,
    p_purpose => p_purpose,
    p_projection_kind => 'participants'
  );
end;
$function$;

revoke all on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) to service_role;

-- The four earlier Task 9-11 public readers keep their externally stable
-- signatures. Their v5 wrappers become private implementation details. A
-- bridge supplies the legacy literal and the current public wrapper performs
-- the manifest-v6 proof rebind, so no current proof carries a legacy revision.
alter function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) rename to read_agent_job_conversation_context_v5_impl;
alter function public.read_agent_job_conversation_context_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) set schema private;
revoke all on function private.read_agent_job_conversation_context_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_job_conversation_context_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer,
  p_sections text[],
  p_required_through_turn_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.read_agent_job_conversation_context_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scopes,
    p_inbox_scope,
    p_clients_scope,
    p_job_permission,
    p_job_scope,
    p_job_kind,
    p_job_id,
    p_exact_turn_limit,
    p_sections,
    p_required_through_turn_id
  );
$function$;

revoke all on function private.read_agent_job_conversation_context_v6_bridge(
  text, uuid, uuid, text, text[], text, text, text[], text, text, text, text,
  text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer default 20,
  p_sections text[] default array[
    'memory', 'recent_turns', 'participants', 'gaps', 'cross_job_seed'
  ]::text[],
  p_required_through_turn_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_job_conversation_context_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_job_kind,
      p_job_id,
      p_exact_turn_limit,
      p_sections,
      p_required_through_turn_id
    ),
    p_capability_manifest_revision
  );
end;
$function$;

revoke all on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) to service_role;

alter function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) rename to read_agent_correspondence_evidence_v5_impl;
alter function public.read_agent_correspondence_evidence_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) set schema private;
revoke all on function private.read_agent_correspondence_evidence_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scope text,
  p_inbox_scope text,
  p_evidence_ids text[]
) returns table (
  evidence_id text,
  company_id uuid,
  source_id text,
  occurred_at text,
  subject text,
  side text,
  participant_id text,
  participant_resolution_status text,
  direction text,
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  recipient_identities text[],
  cc_recipient_identities text[],
  redaction_kinds text[],
  normalized_plain_text text,
  original_content_hash text,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_correspondence_evidence'
     or p_capability_revision is distinct from
       'get_correspondence_evidence:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  return query
  select legacy.evidence_id,
         legacy.company_id,
         legacy.source_id,
         legacy.occurred_at,
         legacy.subject,
         legacy.side,
         legacy.participant_id,
         legacy.participant_resolution_status,
         legacy.direction,
         legacy.source_activity_id,
         legacy.source_correspondence_event_id,
         legacy.recipient_identities,
         legacy.cc_recipient_identities,
         legacy.redaction_kinds,
         legacy.normalized_plain_text,
         legacy.original_content_hash,
         legacy.attachments
  from private.read_agent_correspondence_evidence_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    'get_correspondence_evidence:2026-08-07.v1',
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scope,
    p_inbox_scope,
    p_evidence_ids
  ) legacy;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) to service_role;

alter function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_scheduled_jobs_v5_impl;
alter function public.read_agent_scheduled_jobs_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_scheduled_jobs_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_scheduled_jobs_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[],
  p_display_timezone text,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_start_utc timestamptz,
  p_cursor_task_id uuid,
  p_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.read_agent_scheduled_jobs_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_task_statuses,
    p_confirmation_states,
    p_display_timezone,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_start_utc,
    p_cursor_task_id,
    p_limit
  );
$function$;

revoke all on function private.read_agent_scheduled_jobs_v6_bridge(
  text, uuid, uuid, text, text[], text, text, text[], text, text, text,
  timestamptz, timestamptz, text[], text[], text, timestamptz, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_scheduled_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_scheduled_jobs_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_required_oauth_scopes,
      p_calendar_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_task_statuses,
      p_confirmation_states,
      p_display_timezone,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_start_utc,
      p_cursor_task_id,
      p_limit
    ),
    p_capability_manifest_revision
  );
end;
$function$;

revoke all on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

alter function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_job_readiness_issues_v5_impl;
alter function public.read_agent_job_readiness_issues_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_job_readiness_issues_v5_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_job_readiness_issues_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_first_scheduled_start_utc timestamptz,
  p_cursor_project_id uuid,
  p_scan_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.read_agent_job_readiness_issues_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_clients_scope,
    p_photos_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_rule_codes,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_first_scheduled_start_utc,
    p_cursor_project_id,
    p_scan_limit
  );
$function$;

revoke all on function private.read_agent_job_readiness_issues_v6_bridge(
  text, uuid, uuid, text, text[], text, text, text[], text, text, text, text,
  text, timestamptz, timestamptz, text[], timestamptz, bigint, timestamptz,
  uuid, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_readiness_issues_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_job_readiness_issues_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_required_oauth_scopes,
      p_calendar_scope,
      p_clients_scope,
      p_photos_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_rule_codes,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_first_scheduled_start_utc,
      p_cursor_project_id,
      p_scan_limit
    ),
    p_capability_manifest_revision
  );
end;
$function$;

revoke all on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

create or replace function public.read_agent_customer_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_customer_kind text,
  p_customer_id uuid,
  p_job_kinds text[],
  p_lifecycle_states text[],
  p_opportunity_stages text[],
  p_project_statuses text[],
  p_date_field text,
  p_date_from timestamptz,
  p_date_to_exclusive timestamptz,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_sort_at timestamptz,
  p_cursor_job_kind text,
  p_cursor_job_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
  v_result jsonb;
  v_source_data_invalid boolean;
  v_canonical_conflict boolean;
  v_read_as_of timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_registered_permission_keys is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id is distinct from 'list_customer_jobs'
     or p_capability_revision is distinct from
       'list_customer_jobs:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_clients_scope is null
     or p_clients_scope not in ('all', 'assigned')
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_customer_kind not in ('client', 'sub_client')
     or p_customer_id is null
     or p_job_kinds is null
     or cardinality(p_job_kinds) not between 1 and 2
     or p_job_kinds <@ array['opportunity', 'project']::text[] is not true
     or (select count(distinct requested.value)
         from unnest(p_job_kinds) requested(value)) <>
        cardinality(p_job_kinds)
     or ('opportunity' = any(p_job_kinds)) is distinct from
        (p_pipeline_scope is not null)
     or ('project' = any(p_job_kinds)) is distinct from
        (p_projects_scope is not null)
     or p_lifecycle_states is not null and (
       cardinality(p_lifecycle_states) not between 1 and 3
       or p_lifecycle_states <@
          array['active', 'terminal', 'archived']::text[] is not true
       or (select count(distinct requested.value)
           from unnest(p_lifecycle_states) requested(value)) <>
          cardinality(p_lifecycle_states)
     )
     or p_opportunity_stages is not null and (
       cardinality(p_opportunity_stages) not between 1 and 9
       or p_opportunity_stages <@ array[
         'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
         'negotiation', 'won', 'lost', 'discarded'
       ]::text[] is not true
       or 'opportunity' <> all(p_job_kinds)
       or (select count(distinct requested.value)
           from unnest(p_opportunity_stages) requested(value)) <>
          cardinality(p_opportunity_stages)
     )
     or p_project_statuses is not null and (
       cardinality(p_project_statuses) not between 1 and 7
       or p_project_statuses <@ array[
         'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
         'closed', 'archived'
       ]::text[] is not true
       or 'project' <> all(p_job_kinds)
       or (select count(distinct requested.value)
           from unnest(p_project_statuses) requested(value)) <>
          cardinality(p_project_statuses)
     )
     or (p_date_field is null) is distinct from (p_date_from is null)
     or (p_date_field is null) is distinct from
        (p_date_to_exclusive is null)
     or p_date_field is not null
        and p_date_field not in ('created_at', 'updated_at')
     or p_date_from is not null and (
       p_date_to_exclusive > p_date_from is not true
       or p_date_to_exclusive - p_date_from > interval '365 days'
     )
     or (p_read_as_of is null) is distinct from
        (p_cursor_source_revision is null)
     or p_limit not between 1 and 50
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_sort_at is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_job_kind is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_job_id is null)
     or p_cursor_job_kind is not null
        and p_cursor_job_kind not in ('opportunity', 'project') then
    raise exception 'invalid_agent_customer_jobs_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or not ('clients.view' = any(p_registered_permission_keys))
  or ('opportunity' = any(p_job_kinds)
      and not ('pipeline.view' = any(p_registered_permission_keys)))
  or ('project' = any(p_job_kinds)
      and not ('projects.view' = any(p_registered_permission_keys))) then
    raise exception 'invalid_agent_customer_jobs_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.customers.read'::text as scope
    union all select 'ops.jobs.read'::text
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_customer_jobs_request'
      using errcode = '22023';
  end if;

  v_read_as_of := date_trunc(
    'milliseconds', coalesce(p_read_as_of, statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           revision.source_revision,
           date_trunc('milliseconds', statement_timestamp()) as statement_read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = p_company_id
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.clients_scope = p_clients_scope
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
  ), requested_customer as materialized (
    select client.id as parent_client_id,
           client.name as parent_client_name,
           sub_client.id as sub_client_id,
           sub_client.name as sub_client_name,
           case when p_customer_kind = 'sub_client'
             then 'sub_client_parent'
             else 'primary_client'
           end as relationship_basis
    from authority_context authority
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
     and (
       (p_customer_kind = 'client' and client.id = p_customer_id)
       or p_customer_kind = 'sub_client'
     )
    left join public.sub_clients sub_client
      on p_customer_kind = 'sub_client'
     and sub_client.id = p_customer_id
     and sub_client.company_id = p_company_id
     and sub_client.client_id = client.id
     and sub_client.deleted_at is null
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      'client',
      client.id,
      'view'
    )
      and (p_customer_kind = 'client' or sub_client.id is not null)
  ), opportunity_source as materialized (
    select opportunity.id as raw_job_id,
           'opportunity'::text as raw_job_kind,
           opportunity.title,
           opportunity.stage as status,
           case
             when opportunity.archived_at is not null
               or opportunity.stage = 'discarded' then 'archived'
             when opportunity.stage in ('won', 'lost')
               then 'terminal'
             else 'active'
           end as lifecycle_state,
           opportunity.created_at,
           opportunity.updated_at,
           null::date as start_date,
           null::date as end_date,
           case when p_date_field = 'created_at'
             then opportunity.created_at else opportunity.updated_at
           end as sort_at,
           private.resolve_opportunity_client_id(
             opportunity.client_ref,
             opportunity.client_id
           ) as resolved_client_id,
           coalesce(opportunity.project_ref, opportunity.project_id)
             as linked_project_id,
           opportunity.client_ref,
           opportunity.client_id,
           opportunity.project_ref,
           opportunity.project_id,
           opportunity.client_ref is not null
             and opportunity.client_id is not null
             and opportunity.client_ref is distinct from opportunity.client_id
             as client_mirror_conflict,
           opportunity.project_ref is not null
             and opportunity.project_id is not null
             and opportunity.project_ref is distinct from opportunity.project_id
             as project_mirror_conflict,
           not pg_input_is_valid(opportunity.id::text, 'uuid')
             or opportunity.client_ref is not null
                and not pg_input_is_valid(opportunity.client_ref::text, 'uuid')
             or opportunity.project_ref is not null
                and not pg_input_is_valid(opportunity.project_ref::text, 'uuid')
             or nullif(btrim(opportunity.title), '') is null
             or octet_length(opportunity.title) > 1000
             or opportunity.stage not in (
               'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
               'negotiation', 'won', 'lost', 'discarded'
             )
             as source_data_invalid
    from requested_customer customer
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
     and private.resolve_opportunity_client_id(
       opportunity.client_ref,
       opportunity.client_id
     ) = customer.parent_client_id
    where 'opportunity' = any(p_job_kinds)
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        opportunity.id,
        'view'
      )
      and (p_lifecycle_states is null or case
        when opportunity.archived_at is not null
          or opportunity.stage = 'discarded' then 'archived'
        when opportunity.stage in ('won', 'lost') then 'terminal'
        else 'active'
      end = any(p_lifecycle_states))
      and (p_opportunity_stages is null
        or opportunity.stage = any(p_opportunity_stages))
      and (p_date_from is null or case when p_date_field = 'created_at'
        then opportunity.created_at else opportunity.updated_at end >=
          p_date_from)
      and (p_date_to_exclusive is null or case
        when p_date_field = 'created_at' then opportunity.created_at
        else opportunity.updated_at end < p_date_to_exclusive)
      and opportunity.created_at <= v_read_as_of
      and opportunity.updated_at <= v_read_as_of
      and opportunity.created_at <= opportunity.updated_at
  ), project_source as materialized (
    select project.id as raw_job_id,
           'project'::text as raw_job_kind,
           project.title,
           project.status,
           case
             when project.status = 'archived' then 'archived'
             when project.status in ('completed', 'closed') then 'terminal'
             else 'active'
           end as lifecycle_state,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           case when p_date_field = 'created_at'
             then project.created_at else project.updated_at
           end as sort_at,
           project.client_id,
           coalesce(project.opportunity_ref, project.opportunity_id)
             as linked_opportunity_id,
           project.opportunity_ref,
           project.opportunity_id,
           project.opportunity_ref is not null
             and project.opportunity_id is not null
             and project.opportunity_id is distinct from project.opportunity_ref
             as opportunity_mirror_conflict,
           not pg_input_is_valid(project.id::text, 'uuid')
             or project.opportunity_ref is not null
                and not pg_input_is_valid(project.opportunity_ref::text, 'uuid')
             or nullif(btrim(project.title), '') is null
             or octet_length(project.title) > 1000
             or project.status not in (
               'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
               'closed', 'archived'
             )
             as source_data_invalid
    from requested_customer customer
    join public.projects project
      on project.company_id = p_company_id
     and project.client_id = customer.parent_client_id
     and project.deleted_at is null
    where 'project' = any(p_job_kinds)
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.id,
        'view'
      )
      and (p_lifecycle_states is null or case
        when project.status = 'archived' then 'archived'
        when project.status in ('completed', 'closed') then 'terminal'
        else 'active'
      end = any(p_lifecycle_states))
      and (p_project_statuses is null
        or project.status = any(p_project_statuses))
      and (p_date_from is null or case when p_date_field = 'created_at'
        then project.created_at else project.updated_at end >= p_date_from)
      and (p_date_to_exclusive is null or case
        when p_date_field = 'created_at' then project.created_at
        else project.updated_at end < p_date_to_exclusive)
      and project.created_at <= v_read_as_of
      and project.updated_at <= v_read_as_of
      and project.created_at <= project.updated_at
  ), raw_candidate as materialized (
    select case when project.raw_job_id is not null
             then 'project' else 'opportunity'
           end as canonical_job_kind,
           coalesce(project.raw_job_id, opportunity.raw_job_id)
             as canonical_job_id,
           opportunity.raw_job_kind,
           opportunity.raw_job_id,
           coalesce(project.title, opportunity.title) as title,
           coalesce(project.status, opportunity.status) as status,
           coalesce(project.lifecycle_state, opportunity.lifecycle_state)
             as lifecycle_state,
           coalesce(project.created_at, opportunity.created_at) as created_at,
           coalesce(project.updated_at, opportunity.updated_at) as updated_at,
           project.start_date,
           project.end_date,
           coalesce(project.sort_at, opportunity.sort_at) as sort_at,
           case
             when project.raw_job_id is not null then 'converted'
             when opportunity.linked_project_id is not null
               then 'linked_project_not_returned'
             else 'not_converted'
           end as conversion,
           case when project.raw_job_id is not null then jsonb_build_array(
             jsonb_build_object('kind', 'opportunity',
               'id', opportunity.raw_job_id),
             jsonb_build_object('kind', 'project', 'id', project.raw_job_id)
           ) else jsonb_build_array(jsonb_build_object(
             'kind', 'opportunity', 'id', opportunity.raw_job_id
           )) end as anchor_refs,
           opportunity.raw_job_id as opportunity_anchor_id,
           project.raw_job_id as project_anchor_id,
           opportunity.source_data_invalid
             or coalesce(project.source_data_invalid, false),
           opportunity.client_mirror_conflict
             or opportunity.project_mirror_conflict
             or coalesce(project.opportunity_mirror_conflict, false)
             as canonical_conflict
    from opportunity_source opportunity
    left join project_source project
      on project.raw_job_id = opportunity.linked_project_id
     and project.linked_opportunity_id = opportunity.raw_job_id
     and project.client_id = opportunity.resolved_client_id

    union all

    select 'project',
           project.raw_job_id,
           project.raw_job_kind,
           project.raw_job_id,
           project.title,
           project.status,
           project.lifecycle_state,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           project.sort_at,
           case when opportunity.raw_job_id is not null
             then 'converted'
             when project.linked_opportunity_id is not null
               then 'linked_opportunity_not_returned'
             else 'standalone_project'
           end,
           case when opportunity.raw_job_id is not null then jsonb_build_array(
             jsonb_build_object('kind', 'opportunity',
               'id', opportunity.raw_job_id),
             jsonb_build_object('kind', 'project', 'id', project.raw_job_id)
           ) else jsonb_build_array(jsonb_build_object(
             'kind', 'project', 'id', project.raw_job_id
           )) end,
           opportunity.raw_job_id,
           project.raw_job_id,
           project.source_data_invalid
             or coalesce(opportunity.source_data_invalid, false),
           project.opportunity_mirror_conflict
             or coalesce(opportunity.client_mirror_conflict, false)
             or coalesce(opportunity.project_mirror_conflict, false)
    from project_source project
    left join opportunity_source opportunity
      on opportunity.raw_job_id = project.linked_opportunity_id
     and opportunity.linked_project_id = project.raw_job_id
     and opportunity.resolved_client_id = project.client_id
  ), ranked_candidate as materialized (
    select candidate.*,
           row_number() over (
             partition by candidate.canonical_job_kind,
               candidate.canonical_job_id
             order by case candidate.raw_job_kind
               when 'project' then 0 else 1 end,
               candidate.raw_job_id
           ) as canonical_job_rank,
           count(*) over (
             partition by candidate.canonical_job_kind,
               candidate.canonical_job_id
           ) as canonical_job_count
    from raw_candidate candidate
  ), candidate as materialized (
    select ranked.canonical_job_kind as job_kind,
           ranked.canonical_job_id as job_id,
           ranked.title,
           ranked.status,
           ranked.lifecycle_state,
           ranked.created_at,
           ranked.updated_at,
           ranked.start_date,
           ranked.end_date,
           ranked.sort_at,
           ranked.conversion,
           ranked.anchor_refs,
           ranked.opportunity_anchor_id,
           ranked.project_anchor_id
    from ranked_candidate ranked
    cross join authority_context context
    where canonical_job_rank = 1
      and not ranked.source_data_invalid
      and not ranked.canonical_conflict
      and (p_lifecycle_states is null
        or ranked.lifecycle_state = any(p_lifecycle_states))
      and (ranked.canonical_job_kind <> 'opportunity'
        or p_opportunity_stages is null
        or ranked.status = any(p_opportunity_stages))
      and (ranked.canonical_job_kind <> 'project'
        or p_project_statuses is null
        or ranked.status = any(p_project_statuses))
      and (p_date_from is null or ranked.sort_at >= p_date_from)
      and (p_date_to_exclusive is null
        or ranked.sort_at < p_date_to_exclusive)
      and ranked.sort_at <= v_read_as_of
      and (
        p_cursor_sort_at is null
        or ranked.sort_at < p_cursor_sort_at
        or ranked.sort_at = p_cursor_sort_at
           and ranked.canonical_job_kind > p_cursor_job_kind
        or ranked.sort_at = p_cursor_sort_at
           and ranked.canonical_job_kind = p_cursor_job_kind
           and ranked.canonical_job_id < p_cursor_job_id
      )
  ), page_plus_one as materialized (
    select candidate.*
    from candidate
    order by candidate.sort_at desc, candidate.job_kind, candidate.job_id desc
    limit 51
  ), retained_page as materialized (
    select page.*
    from page_plus_one page
    order by page.sort_at desc, page.job_kind, page.job_id desc
    limit p_limit
  ), raw_item as materialized (
    select retained.*,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', retained.job_kind,
               'id', retained.job_id
             ),
             'anchor_refs', retained.anchor_refs,
             'display_title', left(btrim(retained.title), 1000),
             'content_kind', 'untrusted_business_data',
             'conversion', case retained.conversion
               when 'converted' then jsonb_build_object(
                 'state', 'converted',
                 'opportunity_ref', jsonb_build_object(
                   'kind', 'opportunity',
                   'id', retained.opportunity_anchor_id
                 ),
                 'project_ref', jsonb_build_object(
                   'kind', 'project', 'id', retained.project_anchor_id
                 )
               )
               else jsonb_build_object('state', retained.conversion)
             end,
             'relationship_basis', customer.relationship_basis,
             'visibility_reason', 'current_actor_authorized',
             'lifecycle_state', retained.lifecycle_state,
             'status', jsonb_build_object(
               'kind', retained.job_kind, 'value', retained.status
             ),
             'dates', case when retained.job_kind = 'project' then
               jsonb_build_object(
                 'kind', 'project',
                 'created_at', private.agent_rfc3339_utc(retained.created_at),
                 'updated_at', private.agent_rfc3339_utc(retained.updated_at),
                 'start_date', case when retained.start_date is null then null
                   else to_char(retained.start_date::date, 'YYYY-MM-DD') end,
                 'end_date', case when retained.end_date is null then null
                   else to_char(retained.end_date::date, 'YYYY-MM-DD') end
               )
               else jsonb_build_object(
                 'kind', 'opportunity',
                 'created_at', private.agent_rfc3339_utc(retained.created_at),
                 'updated_at', private.agent_rfc3339_utc(retained.updated_at)
               ) end,
             'evidence_ids', jsonb_build_array(
               'evidence:customer_job_projection:' || retained.job_kind || ':' ||
                 retained.job_id::text
             )
           ) as raw
    from retained_page retained
    cross join requested_customer customer
  ), item_projection as materialized (
    select item.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', jsonb_strip_nulls(jsonb_build_object(
               'customer_ref', jsonb_build_object(
                 'kind', p_customer_kind, 'id', p_customer_id
               ),
               'job_kinds', to_jsonb(p_job_kinds),
               'lifecycle_states', to_jsonb(p_lifecycle_states),
               'opportunity_stages', to_jsonb(p_opportunity_stages),
               'project_statuses', to_jsonb(p_project_statuses),
               'date_window', case when p_date_from is null then null else
                 jsonb_build_object(
                   'field', p_date_field,
                   'from', private.agent_rfc3339_utc(p_date_from),
                   'to_exclusive',
                     private.agent_rfc3339_utc(p_date_to_exclusive)
                 ) end,
               'limit', p_limit
             )),
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'retained_proof_sources', '[]'::jsonb,
             'job', item.raw
           ) as projection
    from raw_item item
    cross join authority_context context
  ), packaged_item as materialized (
    select projection.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   projection.projection
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as source_content_hash
    from item_projection projection
  ), item_claim as materialized (
    select packaged.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'customer_job_projection',
             'source_id', packaged.job_kind || ':' || packaged.job_id::text,
             'version', 'customer-job-projection:v1:' ||
               packaged.source_content_hash
           ) as source_version,
           'evidence:customer_job_projection:' || packaged.job_kind || ':' ||
             packaged.job_id::text as evidence_id
    from packaged_item packaged
  ), envelope_projection as materialized (
    select context.source_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', jsonb_strip_nulls(jsonb_build_object(
               'customer_ref', jsonb_build_object(
                 'kind', p_customer_kind, 'id', p_customer_id
               ),
               'job_kinds', to_jsonb(p_job_kinds),
               'lifecycle_states', to_jsonb(p_lifecycle_states),
               'opportunity_stages', to_jsonb(p_opportunity_stages),
               'project_statuses', to_jsonb(p_project_statuses),
               'date_window', case when p_date_from is null then null else
                 jsonb_build_object(
                   'field', p_date_field,
                   'from', private.agent_rfc3339_utc(p_date_from),
                   'to_exclusive',
                     private.agent_rfc3339_utc(p_date_to_exclusive)
                 ) end,
               'limit', p_limit
             )),
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(item.source_version
                 order by item.sort_at desc, item.job_kind, item.job_id desc)
               from item_claim item
             ), '[]'::jsonb),
             'collection', jsonb_build_object(
               'returned_job_count', (select count(*) from item_claim),
               'has_more', (select count(*) from page_plus_one) > p_limit,
               'next_cursor_claims', case
                 when (select count(*) from page_plus_one) > p_limit then (
                   select jsonb_build_object(
                     'source_revision', context.source_revision,
                     'read_as_of', private.agent_rfc3339_utc(v_read_as_of),
                     'sort_at', private.agent_rfc3339_utc(last_item.sort_at),
                     'job_kind', last_item.job_kind,
                     'job_id', last_item.job_id
                   )
                   from retained_page last_item
                   order by last_item.sort_at, last_item.job_kind desc,
                     last_item.job_id
                   limit 1
                 ) else null end,
               'gaps', '[]'::jsonb
             )
           ) as projection
    from authority_context context
  ), envelope_hashed as materialized (
    select envelope.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   envelope.projection
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as source_content_hash
    from envelope_projection envelope
  ), final_result as materialized (
    select jsonb_build_object(
      'company_id', p_company_id,
      'permission_snapshot_revision', p_permission_snapshot_revision,
      'read_at', private.agent_rfc3339_utc(v_read_as_of),
      'source_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || envelope.source_revision::text
      ),
      'job_claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'raw', item.raw,
          'proof', jsonb_build_object(
            'source_version', item.source_version,
            'source_content_hash', item.source_content_hash,
            'evidence_id', item.evidence_id,
            'projection', item.projection
          ),
          'source_version', item.source_version,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_id', item.evidence_id,
            'source_domain', 'operations',
            'source_type', 'customer_job_projection',
            'source_id', item.job_kind || ':' || item.job_id::text,
            'version', item.source_version ->> 'version',
            'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
            'relationship', 'supports',
            'trust', 'authoritative_ops',
            'locator', 'ops://evidence/' ||
              replace(item.evidence_id, ':', '%3A')
          ))
        ) order by item.sort_at desc, item.job_kind, item.job_id desc)
        from item_claim item
      ), '[]'::jsonb),
      'returned_job_count', (select count(*) from item_claim),
      'has_more', (select count(*) from page_plus_one) > p_limit,
      'next_cursor_claims', case
        when (select count(*) from page_plus_one) > p_limit then (
          select jsonb_build_object(
            'source_revision', envelope.source_revision,
            'read_as_of', private.agent_rfc3339_utc(v_read_as_of),
            'sort_at', private.agent_rfc3339_utc(last_item.sort_at),
            'job_kind', last_item.job_kind,
            'job_id', last_item.job_id
          )
          from retained_page last_item
          order by last_item.sort_at, last_item.job_kind desc,
            last_item.job_id
          limit 1
        ) else null end,
      'gaps', '[]'::jsonb,
      'collection_claim', jsonb_build_object(
        'raw', envelope.projection -> 'collection',
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'customer_jobs_collection_projection',
            'source_id', p_customer_kind || ':' || p_customer_id::text,
            'version', 'customer-jobs-collection-projection:v1:' ||
              envelope.source_content_hash
          ),
          'source_content_hash', envelope.source_content_hash,
          'evidence_id', 'evidence:customer_jobs_collection_projection:' ||
            p_customer_kind || ':' || p_customer_id::text,
          'projection', envelope.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'customer_jobs_collection_projection',
          'source_id', p_customer_kind || ':' || p_customer_id::text,
          'version', 'customer-jobs-collection-projection:v1:' ||
            envelope.source_content_hash
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', 'evidence:customer_jobs_collection_projection:' ||
            p_customer_kind || ':' || p_customer_id::text,
          'source_domain', 'operations',
          'source_type', 'customer_jobs_collection_projection',
          'source_id', p_customer_kind || ':' || p_customer_id::text,
          'version', 'customer-jobs-collection-projection:v1:' ||
            envelope.source_content_hash,
          'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://evidence/' || replace(
            'evidence:customer_jobs_collection_projection:' ||
              p_customer_kind || ':' || p_customer_id::text,
            ':',
            '%3A'
          )
        ))
      ),
      'prompt_reduction', jsonb_build_object(
        'max_output_characters', 60000,
        'atomic_claim_kind', 'customer_job',
        'retention', 'maximal_ordered_prefix',
        'claim_path', 'job_claims',
        'envelope_claim_path', 'collection_claim'
      )
    ) as result
    from envelope_hashed envelope
  )
  select final.result,
         exists(
           select 1 from ranked_candidate ranked
           where ranked.source_data_invalid
         ),
         exists(
           select 1 from ranked_candidate ranked
           where ranked.canonical_conflict
              or ranked.canonical_job_count > 2
         )
  into v_result, v_source_data_invalid, v_canonical_conflict
  from final_result final
  -- A current, visible customer with no matching jobs is a valid empty page.
  -- A missing, deleted, merged, cross-company, or invisible customer never
  -- reaches packaging and stays privacy-indistinguishable.
  where (select count(*) from requested_customer) = 1;

  if v_result is null then
    raise exception 'agent_customer_jobs_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if p_cursor_source_revision is not null and not exists (
    select 1
    from private.agent_operational_read_revisions revision
    where revision.company_id = p_company_id
      and revision.source_revision = p_cursor_source_revision
  ) then
    raise exception 'agent_customer_jobs_cursor_stale'
      using errcode = '40001';
  end if;
  if v_source_data_invalid then
    raise exception 'agent_customer_jobs_source_data_invalid'
      using errcode = '22000';
  end if;
  if v_canonical_conflict then
    raise exception 'agent_customer_jobs_canonical_conflict'
      using errcode = '22000';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_customer_jobs_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_customer_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_customer_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) to service_role;

create or replace function public.read_agent_job_summary_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_estimates_scope text,
  p_invoices_scope text,
  p_projects_financials_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_sections text[],
  p_readiness_rule_codes text[],
  p_financial_components text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_registered_permission_keys is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id is distinct from 'get_job_summary'
     or p_capability_revision is distinct from
       'get_job_summary:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_sections is null
     or cardinality(p_sections) not between 1 and 7
     or p_sections <@ array[
       'identity', 'schedule', 'readiness', 'participants', 'financials',
       'activity', 'conversation'
     ]::text[] is not true
     or (select count(distinct requested.section)
         from unnest(p_sections) requested(section)) <>
        cardinality(p_sections)
     or p_job_kind = 'opportunity' and (
       'schedule' = any(p_sections) or 'readiness' = any(p_sections)
     )
     and 'invalid_agent_job_summary_request' is not null
     or p_readiness_rule_codes is not null and not (
       'readiness' = any(p_sections)
     )
     or 'readiness' = any(p_sections) and (
       p_readiness_rule_codes is null
       or cardinality(p_readiness_rule_codes) not between 1 and 5
       or p_readiness_rule_codes <@ array[
         'SITE_PHOTOS_MISSING',
         'CUSTOMER_RECORD_UNRESOLVED',
         'SCHEDULE_UNCONFIRMED',
         'CREW_UNASSIGNED',
         'ADDRESS_INCOMPLETE'
       ]::text[] is not true
       or (select count(distinct requested.value)
           from unnest(p_readiness_rule_codes) requested(value)) <>
          cardinality(p_readiness_rule_codes)
     )
     or p_financial_components is not null and not (
       'financials' = any(p_sections)
     )
     or 'financials' = any(p_sections) and (
       p_financial_components is null
       or cardinality(p_financial_components) not between 1 and 2
       or p_financial_components <@
          array['estimate_rollup', 'invoice_rollup']::text[] is not true
       or (select count(distinct requested.value)
           from unnest(p_financial_components) requested(value)) <>
          cardinality(p_financial_components)
     )
     or p_job_kind = 'opportunity'
        and 'invoice_rollup' = any(p_financial_components)
        and 'invalid_agent_job_summary_request' is not null
     or p_inbox_scope is not null
        and p_inbox_scope not in ('all', 'assigned', 'own')
     or p_clients_scope is not null
        and p_clients_scope not in ('all', 'assigned')
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or p_tasks_scope is not null
        and p_tasks_scope not in ('all', 'assigned')
     or p_photos_scope is not null
        and p_photos_scope not in ('all', 'assigned')
     or p_estimates_scope is not null
        and p_estimates_scope not in ('all', 'assigned')
     or p_invoices_scope is not null
        and p_invoices_scope not in ('all', 'assigned')
     or p_projects_financials_scope is not null
        and p_projects_financials_scope <> 'all' then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  if (
       'schedule' = any(p_sections)
       or 'activity' = any(p_sections)
       or p_readiness_rule_codes && array[
         'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
       ]::text[]
     ) is distinct from (p_calendar_scope is not null)
     or (
       'schedule' = any(p_sections)
       or 'activity' = any(p_sections)
       or p_readiness_rule_codes && array[
         'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
       ]::text[]
     ) is distinct from (p_tasks_scope is not null)
     or (p_job_kind = 'opportunity') is distinct from
       (p_pipeline_scope is not null)
     or (
       p_job_kind = 'project'
       or p_job_kind = 'opportunity' and 'activity' = any(p_sections)
     ) is distinct from (p_projects_scope is not null)
     or (
       'participants' = any(p_sections)
       or 'conversation' = any(p_sections)
     ) is distinct from (p_inbox_scope is not null)
     or (
       'participants' = any(p_sections)
       or 'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes)
     ) is distinct from (p_clients_scope is not null)
     or ('SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)) is distinct from
       (p_photos_scope is not null)
     or ('estimate_rollup' = any(p_financial_components)) is distinct from
       (p_estimates_scope is not null)
     or ('invoice_rollup' = any(p_financial_components)) is distinct from
       (p_invoices_scope is not null)
     or (
       p_job_kind = 'project' and p_financial_components is not null
     ) is distinct from (p_projects_financials_scope is not null) then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or p_job_kind = 'opportunity'
     and not ('pipeline.view' = any(p_registered_permission_keys))
  or p_job_kind = 'project'
     and not ('projects.view' = any(p_registered_permission_keys))
  or ('schedule' = any(p_sections)
      and (not ('calendar.view' = any(p_registered_permission_keys))
        or not ('tasks.view' = any(p_registered_permission_keys))))
  or (p_readiness_rule_codes && array[
        'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
      ]::text[]
      and (not ('calendar.view' = any(p_registered_permission_keys))
        or not ('tasks.view' = any(p_registered_permission_keys))))
  or ('participants' = any(p_sections)
      and (not ('clients.view' = any(p_registered_permission_keys))
        or not ('inbox.view' = any(p_registered_permission_keys))))
  or ('activity' = any(p_sections) and (
      not ('calendar.view' = any(p_registered_permission_keys))
      or not ('tasks.view' = any(p_registered_permission_keys))
      or not ('projects.view' = any(p_registered_permission_keys))))
  or ('conversation' = any(p_sections)
      and not ('inbox.view' = any(p_registered_permission_keys)))
  or ('estimate_rollup' = any(p_financial_components)
      and not ('estimates.view' = any(p_registered_permission_keys)))
  or ('invoice_rollup' = any(p_financial_components)
      and not ('invoices.view' = any(p_registered_permission_keys)))
  or (p_job_kind = 'project'
      and p_financial_components is not null
      and not ('projects.view_financials' = any(p_registered_permission_keys)))
  then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.jobs.read'::text as scope
    union select 'ops.schedule.read'::text
      where 'schedule' = any(p_sections)
         or p_readiness_rule_codes && array[
           'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
         ]::text[]
         or 'activity' = any(p_sections)
    union select 'ops.photos.read'::text
      where 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
    union select 'ops.customers.read'::text
      where 'participants' = any(p_sections)
         or 'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes)
    union select 'ops.customer_contacts.read'::text
      where 'participants' = any(p_sections)
    union select 'ops.financials.read'::text
      where 'financials' = any(p_sections)
    union select 'ops.correspondence.read'::text
      where 'conversation' = any(p_sections)
         or 'participants' = any(p_sections)
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  perform private.agent_assert_operational_timezone_rules();

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'photos.view'
           ) as photos_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'estimates.view'
           ) as estimates_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'invoices.view'
           ) as invoices_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' =
               'projects.view_financials'
           ) as projects_financials_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           company.currency_code,
           company.timezone,
           source_revision.source_revision,
           history_revision.history_revision,
           date_trunc('milliseconds', statement_timestamp()) as read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions source_revision
      on source_revision.company_id = p_company_id
    join private.agent_job_history_revisions history_revision
      on history_revision.company_id = p_company_id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and (p_inbox_scope is null or authority.inbox_scope = p_inbox_scope)
      and (p_clients_scope is null or authority.clients_scope = p_clients_scope)
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and (p_calendar_scope is null
        or authority.calendar_scope = p_calendar_scope)
      and (p_tasks_scope is null or authority.tasks_scope = p_tasks_scope)
      and (p_photos_scope is null or authority.photos_scope = p_photos_scope)
      and (p_estimates_scope is null
        or authority.estimates_scope = p_estimates_scope)
      and (p_invoices_scope is null
        or authority.invoices_scope = p_invoices_scope)
      and (p_projects_financials_scope is null
        or authority.projects_financials_scope =
          p_projects_financials_scope)
      and source_revision.source_revision between 0 and 9007199254740991
      and history_revision.history_revision between 0 and 9007199254740991
      and exists (
        select 1
        from pg_catalog.pg_timezone_names timezone
        where timezone.name = company.timezone
      )
  ), requested_job as materialized (
    select opportunity.id as job_id,
           'opportunity'::text as job_kind,
           opportunity.title,
           opportunity.address,
           opportunity.stage as status,
           case
             when opportunity.archived_at is not null
               or opportunity.stage = 'discarded' then 'archived'
             when opportunity.stage in ('won', 'lost') then 'terminal'
             else 'active'
           end as lifecycle_state,
           opportunity.created_at,
           opportunity.updated_at,
           null::date as start_date,
           null::date as end_date,
           private.resolve_opportunity_client_id(
             opportunity.client_ref,
             opportunity.client_id
           ) as client_id,
           coalesce(opportunity.project_ref, opportunity.project_id)
             as project_id,
           opportunity.id as opportunity_id
    from authority_context authority
    join public.opportunities opportunity
      on p_job_kind = 'opportunity'
     and opportunity.id = p_job_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view'
    )
      and not (
        opportunity.client_ref is not null
        and opportunity.client_id is not null
        and opportunity.client_ref is distinct from opportunity.client_id
      )
      and not (
        opportunity.project_ref is not null
        and opportunity.project_id is not null
        and opportunity.project_ref is distinct from opportunity.project_id
      )

    union all

    select project.id,
           'project',
           project.title,
           project.address,
           project.status,
           case
             when project.status = 'archived' then 'archived'
             when project.status in ('completed', 'closed') then 'terminal'
             else 'active'
           end,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           project.client_id,
           project.id,
           coalesce(project.opportunity_ref, project.opportunity_id)
    from authority_context authority
    join public.projects project
      on p_job_kind = 'project'
     and project.id = p_job_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view'
    )
      and not (
        project.opportunity_ref is not null
        and project.opportunity_id is not null
        and project.opportunity_ref is distinct from project.opportunity_id
      )
  ), canonical_request as materialized (
    select jsonb_strip_nulls(jsonb_build_object(
      'job_ref', jsonb_build_object(
        'kind', p_job_kind,
        'id', p_job_id
      ),
      'sections', to_jsonb(p_sections),
      'readiness_rule_codes', to_jsonb(p_readiness_rule_codes),
      'financial_components', to_jsonb(p_financial_components)
    )) as canonical_input
  ), authorized_project_source as materialized (
    select project.id,
           project.title,
           project.address,
           project.status,
           project.status_version,
           project.updated_at,
           project.client_id,
           project.start_date,
           project.end_date,
           coalesce(project.opportunity_ref, project.opportunity_id)
             as opportunity_id,
           project.project_images
    from requested_job job
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
     and (
       job.job_kind = 'project' and project.id = job.job_id
       or job.job_kind = 'opportunity' and project.id = job.project_id
     )
    where not (
        project.opportunity_ref is not null
        and project.opportunity_id is not null
        and project.opportunity_ref is distinct from project.opportunity_id
      )
      and (
        job.job_kind = 'project'
        or coalesce(project.opportunity_ref, project.opportunity_id) =
             job.opportunity_id
          and project.client_id = job.client_id
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.id,
        'view'
      )
  ), readiness_customer_source as materialized (
    select job.client_id,
           client.id is not null as resolved,
           job.client_id is null
             or client.id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               client.id,
               'view'
             ) as source_authorized
    from requested_job job
    left join public.clients client
      on 'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes)
     and client.id = job.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
  ), summary_schedule_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           coalesce(
             nullif(btrim(task.custom_title), ''),
             nullif(btrim(task_type.display), ''),
             nullif(btrim(project.title), '')
           ) as task_title,
           task.status as task_status,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_locked,
           task.schedule_version,
           task.updated_at as task_updated_at,
           project.title as project_title,
           project.address as project_address,
           project.status as project_status,
           project.status_version as project_status_version,
           project.updated_at as project_updated_at,
           context.timezone as company_timezone,
           context.read_at
    from authority_context context
    join authorized_project_source project on true
    join public.project_tasks task
      on 'schedule' = any(p_sections)
     and p_job_kind = 'project'
     and task.project_id = project.id
     and task.company_id = p_company_id
     and task.deleted_at is null
     and task.start_date is not null
     and task.status in ('active', 'completed', 'cancelled')
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and (
        p_calendar_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_projects_scope = 'all'
        or exists (
          select 1
          from public.project_tasks project_assignment
          where project_assignment.project_id = project.id
            and project_assignment.company_id = p_company_id
            and project_assignment.deleted_at is null
            and project_assignment.status = 'active'
            and p_actor_user_id::text = any(coalesce(
              project_assignment.team_member_ids, array[]::text[]
            ))
        )
      )
    order by task.start_date, task.start_time nulls first, task.id
    limit 11
  ), summary_schedule_source_state as materialized (
    select count(*) = 11 as occurrence_sentinel,
           coalesce(sum(cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           ))) > 100, false) as assignment_source_query_bound,
           coalesce(bool_or(
             task.task_title is null
             or char_length(task.task_title) not between 1 and 1000
             or task.project_address is not null
                and nullif(btrim(task.project_address), '') is not null
                and char_length(btrim(task.project_address)) > 2000
             or task.task_status not in ('active', 'completed', 'cancelled')
             or task.all_day is null
             or not task.all_day and (
               task.start_time is null or task.end_time is null
             )
             or task.end_date is not null
                and (task.end_date at time zone 'UTC')::date <
                  (task.start_date at time zone 'UTC')::date
             or task.task_updated_at is null
             or task.project_updated_at is null
             or task.task_updated_at > task.read_at
             or task.project_updated_at > task.read_at
             or task.schedule_confirmed_at > task.read_at
             or task.schedule_version not between 0 and 9007199254740991
             or task.project_status_version not between 0 and 9007199254740991
             or cardinality(coalesce(
               task.team_member_ids, array[]::text[]
             )) > 100
           ), false) as source_data_invalid
    from summary_schedule_task_candidate task
  ), summary_schedule_local as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day then time '00:00:00'
                   else task.start_time end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case when task.end_time <= task.start_time then 1 else 0 end
               ) + task.end_time
             end
           )::timestamp without time zone as local_end_value
    from summary_schedule_task_candidate task
    cross join summary_schedule_source_state state
    where not state.source_data_invalid
      and not state.assignment_source_query_bound
  ), summary_schedule_resolved as materialized (
    select schedule.*,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_start_value::date,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_start_value,
               schedule.company_timezone
             )
           end as scheduled_start_utc,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_end_value::date + 1,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_end_value,
               schedule.company_timezone
             )
           end as scheduled_end_utc
    from summary_schedule_local schedule
  ), summary_schedule_resolved_state as materialized (
    select coalesce(bool_or(
      schedule.scheduled_start_utc is null
      or schedule.scheduled_end_utc is null
      or schedule.scheduled_end_utc <= schedule.scheduled_start_utc
    ), false) as source_data_invalid
    from summary_schedule_resolved schedule
  ), summary_schedule_raw_assignment as materialized (
    select schedule.task_id,
           member.user_id
    from summary_schedule_resolved schedule
    cross join lateral unnest(
      case when cardinality(coalesce(
        schedule.team_member_ids, array[]::text[]
      )) <= 100 then coalesce(
        schedule.team_member_ids, array[]::text[]
      )[1:100] else array[]::text[] end
    ) member(user_id)
  ), summary_schedule_assignment_state as materialized (
    select schedule.task_id,
           coalesce(bool_or(
             member.user_id is not null and (
               not pg_input_is_valid(member.user_id, 'uuid')
               or crew_user.id is null
               or char_length(btrim(concat_ws(
                 ' ', crew_user.first_name, crew_user.last_name
               ))) not between 1 and 256
             )
           ), false) as source_data_invalid,
           count(distinct crew_user.id)::integer as assignment_total
    from summary_schedule_resolved schedule
    left join summary_schedule_raw_assignment member
      on member.task_id = schedule.task_id
    left join public.users crew_user
      on pg_input_is_valid(member.user_id, 'uuid')
     and crew_user.id::text = member.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    group by schedule.task_id
  ), summary_schedule_valid_assignment as materialized (
    select distinct member.task_id,
           crew_user.id as user_id,
           btrim(concat_ws(
             ' ', crew_user.first_name, crew_user.last_name
           )) as display_name
    from summary_schedule_raw_assignment member
    join public.users crew_user
      on pg_input_is_valid(member.user_id, 'uuid')
     and crew_user.id::text = member.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    where char_length(btrim(concat_ws(
      ' ', crew_user.first_name, crew_user.last_name
    ))) between 1 and 256
  ), summary_schedule_assignment_projection as materialized (
    select ranked.task_id,
           jsonb_agg(jsonb_build_object(
             'user_id', ranked.user_id,
             'display_name', ranked.display_name
           ) order by ranked.user_id) filter (
             where ranked.assignment_rank <= 50
           ) as assignments
    from (
      select assignment.*,
             row_number() over (
               partition by assignment.task_id order by assignment.user_id
             ) as assignment_rank
      from summary_schedule_valid_assignment assignment
    ) ranked
    group by ranked.task_id
  ), summary_schedule_occurrence as materialized (
    select schedule.task_id,
           schedule.scheduled_start_utc,
           row_number() over (
             order by schedule.scheduled_start_utc, schedule.task_id
           ) as occurrence_rank,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'project', 'id', schedule.project_id
             ),
             'occurrence_ref', jsonb_build_object(
               'kind', 'project_task', 'id', schedule.task_id
             ),
             'title', schedule.task_title,
             'address', nullif(btrim(schedule.project_address), ''),
             'task_status', schedule.task_status,
             'timing_state', case
               when schedule.task_status <> 'active' then 'past'
               when schedule.scheduled_start_utc > schedule.read_at
                 then 'upcoming'
               when schedule.scheduled_end_utc > schedule.read_at
                 then 'in_progress'
               else 'past_due'
             end,
             'confirmation_state', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version then 'confirmed'
               else 'unconfirmed'
             end,
             'schedule_confirmed_at', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version
                 then private.agent_rfc3339_utc(
                   schedule.schedule_confirmed_at
                 )
               else null
             end,
             'confirmed_schedule_version', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version
                 then schedule.confirmed_schedule_version
               else null
             end,
             'schedule_locked', schedule.schedule_locked,
             'schedule_version', schedule.schedule_version,
             'task_updated_at', private.agent_rfc3339_utc(
               schedule.task_updated_at
             ),
             'project_status', schedule.project_status,
             'project_status_version', schedule.project_status_version,
             'project_updated_at', private.agent_rfc3339_utc(
               schedule.project_updated_at
             ),
             'schedule', jsonb_build_object(
               'all_day', schedule.all_day,
               'company_timezone', schedule.company_timezone,
               'local_start', to_char(
                 schedule.local_start_value, 'YYYY-MM-DD"T"HH24:MI:SS'
               ),
               'local_end_inclusive', case when schedule.all_day then
                 to_char(
                   schedule.local_end_value::date + time '23:59:59.999999',
                   'YYYY-MM-DD"T"HH24:MI:SS.US'
                 ) else to_char(
                   schedule.local_end_value, 'YYYY-MM-DD"T"HH24:MI:SS'
                 ) end,
               'start_utc', private.agent_rfc3339_utc(
                 schedule.scheduled_start_utc
               ),
               'start_utc_offset_minutes', (
                 extract(epoch from (
                   schedule.scheduled_start_utc at time zone
                     schedule.company_timezone
                   - schedule.scheduled_start_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'start_pre_boundary_utc_offset_minutes', case
                 when schedule.all_day then (
                   extract(epoch from (
                     (schedule.scheduled_start_utc - interval '1 millisecond')
                       at time zone schedule.company_timezone
                     - (schedule.scheduled_start_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer else null
               end,
               'end_utc_exclusive', private.agent_rfc3339_utc(
                 schedule.scheduled_end_utc
               ),
               'end_utc_offset_minutes', (
                 extract(epoch from (
                   schedule.scheduled_end_utc at time zone
                     schedule.company_timezone
                   - schedule.scheduled_end_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'end_pre_boundary_utc_offset_minutes', case
                 when schedule.all_day then (
                   extract(epoch from (
                     (schedule.scheduled_end_utc - interval '1 millisecond')
                       at time zone schedule.company_timezone
                     - (schedule.scheduled_end_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer else null
               end,
               'display', jsonb_build_object(
                 'timezone', schedule.company_timezone,
                 'local_start', to_char(
                   schedule.scheduled_start_utc at time zone
                     schedule.company_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'local_end_exclusive', to_char(
                   schedule.scheduled_end_utc at time zone
                     schedule.company_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'start_utc_offset_minutes', (
                   extract(epoch from (
                     schedule.scheduled_start_utc at time zone
                       schedule.company_timezone
                     - schedule.scheduled_start_utc at time zone 'UTC'
                   )) / 60
                 )::integer,
                 'end_utc_offset_minutes', (
                   extract(epoch from (
                     schedule.scheduled_end_utc at time zone
                       schedule.company_timezone
                     - schedule.scheduled_end_utc at time zone 'UTC'
                   )) / 60
                 )::integer
               )
             ),
             'assignments', coalesce(
               assignment.assignments, '[]'::jsonb
             ),
             'assignment_total', assignment_state.assignment_total,
             'assignments_omitted_count', greatest(
               assignment_state.assignment_total - jsonb_array_length(
                 coalesce(assignment.assignments, '[]'::jsonb)
               ), 0
             )
           ) as occurrence
    from summary_schedule_resolved schedule
    join summary_schedule_assignment_state assignment_state
      on assignment_state.task_id = schedule.task_id
    left join summary_schedule_assignment_projection assignment
      on assignment.task_id = schedule.task_id
    cross join summary_schedule_resolved_state resolved_state
    where not resolved_state.source_data_invalid
      and not assignment_state.source_data_invalid
  ), summary_schedule_failure_state as materialized (
    select source_state.assignment_source_query_bound as source_query_bound,
           source_state.source_data_invalid
             or resolved_state.source_data_invalid
             or exists (
               select 1 from summary_schedule_assignment_state assignment
               where assignment.source_data_invalid
             ) as source_data_invalid,
           source_state.occurrence_sentinel
    from summary_schedule_source_state source_state
    cross join summary_schedule_resolved_state resolved_state
  ), readiness_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_version,
           project.status as project_status,
           context.timezone as company_timezone
    from authority_context context
    join authorized_project_source project on true
    join public.project_tasks task
      on 'readiness' = any(p_sections)
     and p_readiness_rule_codes && array[
       'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
     ]::text[]
     and task.project_id = project.id
     and task.company_id = p_company_id
     and task.deleted_at is null
     and task.start_date is not null
     and task.status = 'active'
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and (
        p_calendar_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
    order by task.start_date, task.start_time nulls first, task.id
    limit 51
  ), readiness_task_source_state as materialized (
    select count(*) = 51 as source_query_bound,
           coalesce(bool_or(cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100), false) as assignment_source_query_bound,
           coalesce(bool_or(
             task.all_day is null
             or not task.all_day and (
               task.start_time is null or task.end_time is null
             )
             or task.end_date is not null
                and (task.end_date at time zone 'UTC')::date <
                  (task.start_date at time zone 'UTC')::date
             or task.schedule_version not between 0 and 9007199254740991
           ), false) as source_data_invalid
    from readiness_task_candidate task
  ), readiness_local_task as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day then time '00:00:00'
                   else task.start_time end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case when task.end_time <= task.start_time then 1 else 0 end
               ) + task.end_time
             end
           )::timestamp without time zone as local_end_value
    from readiness_task_candidate task
    cross join readiness_task_source_state state
    where not state.source_data_invalid
  ), readiness_resolved_task as materialized (
    select task.*,
           case when task.all_day then private.agent_civil_date_start(
             task.local_start_value::date, task.company_timezone
           ) else private.agent_unambiguous_local_instant(
             task.local_start_value, task.company_timezone
           ) end as scheduled_start_utc,
           case when task.all_day then private.agent_civil_date_start(
             task.local_end_value::date + 1, task.company_timezone
           ) else private.agent_unambiguous_local_instant(
             task.local_end_value, task.company_timezone
           ) end as scheduled_end_utc
    from readiness_local_task task
  ), readiness_assignment_state as materialized (
    select task.*,
           case when cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100 then false else exists (
             select 1
             from unnest(coalesce(
               task.team_member_ids, array[]::text[]
             )[1:100]) member(user_id)
             join public.users crew_user
               on pg_input_is_valid(member.user_id, 'uuid')
              and crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
           ) end as has_valid_assignment,
           case when cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100 then false else exists (
             select 1
             from unnest(coalesce(
               task.team_member_ids, array[]::text[]
             )[1:100]) member(user_id)
             left join public.users crew_user
               on pg_input_is_valid(member.user_id, 'uuid')
              and crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
             where member.user_id is null
                or not pg_input_is_valid(member.user_id, 'uuid')
                or crew_user.id is null
           ) end as assignment_source_invalid
    from readiness_resolved_task task
    where task.scheduled_start_utc is not null
      and task.scheduled_end_utc is not null
      and task.scheduled_end_utc > task.scheduled_start_utc
  ), readiness_task_rollup as materialized (
    select count(*)::integer as eligible_occurrence_count,
           count(*) filter (
             where task.schedule_confirmed_at is null
                or task.confirmed_schedule_version is distinct from
                  task.schedule_version
           )::integer as unconfirmed_occurrence_count,
           coalesce(jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) filter (
             where task.schedule_confirmed_at is null
                or task.confirmed_schedule_version is distinct from
                  task.schedule_version
           ), '[]'::jsonb) as unconfirmed_occurrence_refs,
           count(*) filter (
             where task.has_valid_assignment is false
           )::integer as unassigned_occurrence_count,
           coalesce(jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) filter (
             where task.has_valid_assignment is false
           ), '[]'::jsonb) as unassigned_occurrence_refs,
           coalesce(bool_or(task.assignment_source_invalid), false)
             as assignment_source_invalid
    from readiness_assignment_state task
  ), readiness_resolved_state as materialized (
    select coalesce(bool_or(
      task.scheduled_start_utc is null
      or task.scheduled_end_utc is null
      or task.scheduled_end_utc <= task.scheduled_start_utc
    ), false) as source_data_invalid
    from readiness_resolved_task task
  ), readiness_photo_candidate as materialized (
    select photo.id,
           photo.deleted_at,
           case when photo.url is not null
                  and octet_length(photo.url) between 1 and 2048
             then left(photo.url, 2048) else null end as bounded_url,
           coalesce(octet_length(photo.url) > 2048, false)
             as url_overlength,
           photo.source
    from authorized_project_source project
    join public.project_photos photo
      on 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
     and photo.project_id = project.id::text
     and photo.company_id = p_company_id::text
    where p_photos_scope = 'all'
       or exists (
         select 1 from public.project_tasks assigned_task
         where assigned_task.project_id = project.id
           and assigned_task.company_id = p_company_id
           and assigned_task.deleted_at is null
           and assigned_task.status = 'active'
           and p_actor_user_id::text = any(coalesce(
             assigned_task.team_member_ids, array[]::text[]
           ))
       )
    order by photo.id
    limit 1001
  ), readiness_photo_state as materialized (
    select count(*)::integer as structured_row_count,
           count(*) > 1000 as source_query_bound,
           count(*) filter (where photo.deleted_at is not null)::integer
             as tombstone_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'site_visit')::integer as site_visit_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'in_progress')::integer as in_progress_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'completion')::integer as completion_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'other')::integer as other_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'measurement')::integer as measurement_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'deck_design')::integer as deck_design_count,
           count(*) filter (where photo.deleted_at is null and not coalesce(
             photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source in (
               'site_visit', 'in_progress', 'completion', 'other',
               'measurement', 'deck_design'
             ), false))::integer as malformed_or_local_count
    from readiness_photo_candidate photo
  ), readiness_legacy_photo_state as materialized (
    select coalesce(source.legacy_count > 100, false)
             as source_query_bound,
           coalesce(bool_or(
             source.legacy_count <= 100
             and legacy.url is not null
             and octet_length(legacy.url) > 2048
           ), false) as source_data_invalid,
           count(*) filter (where case
             when source.legacy_count <= 100
              and legacy.url is not null
              and octet_length(legacy.url) between 1 and 2048
               then left(legacy.url, 2048) ~* '^https?://[^[:space:]]+$'
             else false end)::integer as legacy_remote_count
    from authorized_project_source project
    cross join readiness_photo_state photo
    left join lateral (
      select cardinality(coalesce(
               project.project_images, array[]::text[]
             )) as legacy_count,
             project.project_images
      where 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
        and photo.structured_row_count = 0
    ) source on true
    left join lateral unnest(
      case when source.legacy_count <= 100 then
        coalesce(source.project_images, array[]::text[])[1:100]
      else array[]::text[] end
    ) legacy(url) on true
    group by source.legacy_count
  ), readiness_raw_source as materialized (
    select jsonb_build_object(
      'site_photos', case
        when not ('SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'project_photos'
          )
        when photo.source_query_bound
          or coalesce(legacy.source_query_bound, false) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_QUERY_BOUND',
            'source_kind', 'project_photos'
          )
        when coalesce(legacy.source_data_invalid, false) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_DATA_INVALID',
            'source_kind', 'project_photos'
          )
        else jsonb_build_object(
          'available', true,
          'active_remote_by_source', jsonb_build_object(
            'site_visit', photo.site_visit_count,
            'in_progress', photo.in_progress_count,
            'completion', photo.completion_count,
            'other', photo.other_count,
            'measurement', photo.measurement_count,
            'deck_design', photo.deck_design_count
          ),
          'structured_row_count', photo.structured_row_count,
          'tombstone_count', photo.tombstone_count,
          'malformed_or_local_count', photo.malformed_or_local_count,
          'legacy_remote_count', coalesce(legacy.legacy_remote_count, 0)
        ) end,
      'customer_record', case
        when not ('CUSTOMER_RECORD_UNRESOLVED' =
          any(p_readiness_rule_codes)) then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'customer_record'
        )
        when not customer.source_authorized then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'customer_record'
        )
        else jsonb_build_object('resolved', customer.resolved) end,
      'schedule', case
        when not ('SCHEDULE_UNCONFIRMED' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'task_schedule'
          )
        when task_state.source_query_bound then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_QUERY_BOUND',
          'source_kind', 'task_schedule'
        )
        when task_state.source_data_invalid
          or resolved_state.source_data_invalid then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_DATA_INVALID',
          'source_kind', 'task_schedule'
        )
        when rollup.eligible_occurrence_count = 0 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'task_schedule'
        )
        else jsonb_build_object(
          'eligible_occurrence_count', rollup.eligible_occurrence_count,
          'unconfirmed_occurrence_count',
            rollup.unconfirmed_occurrence_count,
          'unconfirmed_occurrence_refs',
            rollup.unconfirmed_occurrence_refs
        ) end,
      'crew', case
        when not ('CREW_UNASSIGNED' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'task_assignments'
          )
        when task_state.source_query_bound
          or task_state.assignment_source_query_bound then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_QUERY_BOUND',
            'source_kind', 'task_assignments'
          )
        when task_state.source_data_invalid
          or resolved_state.source_data_invalid
          or rollup.assignment_source_invalid then jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_DATA_INVALID',
            'source_kind', 'task_assignments'
          )
        when rollup.eligible_occurrence_count = 0 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'task_assignments'
        )
        else jsonb_build_object(
          'eligible_occurrence_count', rollup.eligible_occurrence_count,
          'unassigned_occurrence_count', rollup.unassigned_occurrence_count,
          'unassigned_occurrence_refs', rollup.unassigned_occurrence_refs
        ) end,
      'address', case
        when not ('ADDRESS_INCOMPLETE' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'project_address'
          )
        when job.address is not null
          and char_length(btrim(job.address)) > 2000 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_DATA_INVALID',
          'source_kind', 'project_address'
        )
        else jsonb_build_object(
          'available', true,
          'project_address', nullif(btrim(job.address), '')
        ) end
    ) as raw_sources
    from requested_job job
    cross join readiness_customer_source customer
    cross join readiness_task_source_state task_state
    cross join readiness_resolved_state resolved_state
    cross join readiness_task_rollup rollup
    cross join readiness_photo_state photo
    left join readiness_legacy_photo_state legacy on true
    where 'readiness' = any(p_sections)
  ), participant_snapshot as materialized (
    select private.read_agent_job_participant_snapshot(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      'resolve_job_participants',
      'resolve_job_participants:2026-08-13.v1',
      '2026-08-14.capability-manifest.v6',
      array[
        'ops.correspondence.read',
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      p_inbox_scope,
      p_clients_scope,
      case p_job_kind when 'opportunity' then 'pipeline.view'
        else 'projects.view' end,
      case p_job_kind when 'opportunity' then p_pipeline_scope
        else p_projects_scope end,
      case when p_job_kind = 'project' then p_projects_scope else null end,
      null,
      null,
      null,
      p_job_kind,
      p_job_id,
      'general',
      'participants'
    ) as snapshot
    where 'participants' = any(p_sections)
  ), participant_source_candidate as materialized (
    select claim.value -> 'raw' as raw,
           case claim.value -> 'raw' ->> 'source_kind'
             when 'primary_client' then 1
             when 'sub_client' then 2
             when 'conversation_ambiguous' then 4
             when 'conversation_unresolved' then 4
             when 'conversation_redacted' then 4
             when 'ops_delivery_user' then 5
             when 'phase_c' then 7
             else 99
           end as source_rank,
           claim.value -> 'raw' -> 'participant_ref' ->> 'id'
             as participant_id
    from participant_snapshot snapshot
    cross join lateral jsonb_array_elements(
      snapshot.snapshot -> 'participant_claims'
    ) claim(value)
  ), participant_source_state as materialized (
    select coalesce(bool_or(
      source.source_rank = 99
      or source.participant_id is null
      or octet_length(source.participant_id) not between 1 and 256
    ), false) as source_data_invalid,
    coalesce((select (snapshot.snapshot ->> 'participant_total')::integer
      from participant_snapshot snapshot), 0) as participant_total,
    coalesce((select
      (snapshot.snapshot ->> 'participants_omitted_count')::integer
      from participant_snapshot snapshot), 0) as participants_omitted_count,
    coalesce((select
      snapshot.snapshot ->> 'participant_count_completeness'
      from participant_snapshot snapshot), 'exact')
      as participant_count_completeness
    from participant_source_candidate source
  ), participant_source as materialized (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'source_kind', source.raw ->> 'source_kind',
        'participant_ref', source.raw -> 'participant_ref',
        'display_name', source.raw -> 'display_name',
        'conversation_side', source.raw -> 'conversation_side',
        'resolution_status', source.raw -> 'resolution_status',
        'resolution_basis', source.raw -> 'resolution_basis',
        'resolution_revision', source.raw -> 'resolution_revision',
        case when source.raw ->> 'source_kind' =
          'conversation_ambiguous' then 'candidate_count_lower_bound'
          else 'candidate_count' end,
        case when source.raw ->> 'source_kind' =
          'conversation_ambiguous'
          then source.raw -> 'candidate_count_lower_bound'
          else 'null'::jsonb end,
        'content_kind', 'untrusted_business_data'
      ) order by source.source_rank, source.participant_id collate "C"
    ) filter (where source.raw is not null), '[]'::jsonb) as participants,
    state.participant_total,
    state.participants_omitted_count,
    state.participant_count_completeness,
    state.source_data_invalid
    from participant_source_state state
    left join participant_source_candidate source on source.source_rank < 99
    group by state.participant_total,
      state.participants_omitted_count,
      state.participant_count_completeness,
      state.source_data_invalid
  -- Financial documents are retained behind one 501st-row sentinel before
  -- status aggregation or exact numeric conversion.
  ), financial_currency_state as materialized (
    select context.currency_code,
           case upper(context.currency_code)
             when 'JPY' then 0
             when 'CAD' then 2
             when 'BHD' then 3
             when 'CLF' then 4
             when 'BIF' then 0 when 'CLP' then 0 when 'DJF' then 0
             when 'GNF' then 0 when 'ISK' then 0 when 'KMF' then 0
             when 'KRW' then 0 when 'PYG' then 0 when 'RWF' then 0
             when 'UGX' then 0 when 'UYI' then 0 when 'VND' then 0
             when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
             when 'XPF' then 0
             when 'IQD' then 3 when 'JOD' then 3 when 'KWD' then 3
             when 'LYD' then 3 when 'OMR' then 3 when 'TND' then 3
             when 'UYW' then 4
             when 'AED' then 2 when 'AFN' then 2 when 'ALL' then 2
             when 'AMD' then 2 when 'AOA' then 2 when 'ARS' then 2
             when 'AUD' then 2 when 'AWG' then 2 when 'AZN' then 2
             when 'BAM' then 2 when 'BBD' then 2 when 'BDT' then 2
             when 'BGN' then 2 when 'BMD' then 2 when 'BND' then 2
             when 'BOB' then 2 when 'BOV' then 2 when 'BRL' then 2
             when 'BSD' then 2 when 'BTN' then 2 when 'BWP' then 2
             when 'BYN' then 2 when 'BZD' then 2 when 'CDF' then 2
             when 'CHE' then 2 when 'CHW' then 2 when 'CNY' then 2
             when 'COP' then 2 when 'COU' then 2 when 'CRC' then 2
             when 'CUP' then 2 when 'CVE' then 2 when 'CZK' then 2
             when 'DKK' then 2 when 'DOP' then 2 when 'DZD' then 2
             when 'EGP' then 2 when 'ERN' then 2 when 'ETB' then 2
             when 'EUR' then 2 when 'FJD' then 2 when 'FKP' then 2
             when 'GBP' then 2 when 'GEL' then 2 when 'GHS' then 2
             when 'GIP' then 2 when 'GMD' then 2 when 'GTQ' then 2
             when 'GYD' then 2 when 'HKD' then 2 when 'HNL' then 2
             when 'HTG' then 2 when 'HUF' then 2 when 'IDR' then 2
             when 'ILS' then 2 when 'INR' then 2 when 'IRR' then 2
             when 'JMD' then 2 when 'KES' then 2 when 'KGS' then 2
             when 'KHR' then 2 when 'KPW' then 2 when 'KYD' then 2
             when 'KZT' then 2 when 'LAK' then 2 when 'LBP' then 2
             when 'LKR' then 2 when 'LRD' then 2 when 'LSL' then 2
             when 'MAD' then 2 when 'MDL' then 2 when 'MGA' then 2
             when 'MKD' then 2 when 'MMK' then 2 when 'MNT' then 2
             when 'MOP' then 2 when 'MRU' then 2 when 'MUR' then 2
             when 'MVR' then 2 when 'MWK' then 2 when 'MXN' then 2
             when 'MXV' then 2 when 'MYR' then 2 when 'MZN' then 2
             when 'NAD' then 2 when 'NGN' then 2 when 'NIO' then 2
             when 'NOK' then 2 when 'NPR' then 2 when 'NZD' then 2
             when 'PAB' then 2 when 'PEN' then 2 when 'PGK' then 2
             when 'PHP' then 2 when 'PKR' then 2 when 'PLN' then 2
             when 'QAR' then 2 when 'RON' then 2 when 'RSD' then 2
             when 'RUB' then 2 when 'SAR' then 2 when 'SBD' then 2
             when 'SCR' then 2 when 'SDG' then 2 when 'SEK' then 2
             when 'SGD' then 2 when 'SHP' then 2 when 'SLE' then 2
             when 'SOS' then 2 when 'SRD' then 2 when 'SSP' then 2
             when 'STN' then 2 when 'SVC' then 2 when 'SYP' then 2
             when 'SZL' then 2 when 'THB' then 2 when 'TJS' then 2
             when 'TMT' then 2 when 'TOP' then 2 when 'TRY' then 2
             when 'TTD' then 2 when 'TWD' then 2 when 'TZS' then 2
             when 'UAH' then 2 when 'USD' then 2 when 'USN' then 2
             when 'UYU' then 2 when 'UZS' then 2 when 'VED' then 2
             when 'VES' then 2 when 'WST' then 2 when 'XCD' then 2
             when 'YER' then 2 when 'ZAR' then 2 when 'ZMW' then 2
             when 'ZWL' then 2
             else null
           end::smallint as minor_exponent
    from authority_context context
  ), financial_document_source as materialized (
    select 'estimate_rollup'::text as component_kind,
           estimate.id as document_id,
           estimate.status,
           estimate.total::numeric as total,
           null::numeric as amount_paid,
           null::numeric as balance_due
    from requested_job job
    join public.estimates estimate
      on 'estimate_rollup' = any(p_financial_components)
     and estimate.company_id = p_company_id
     and estimate.deleted_at is null
     and (
       job.job_kind = 'opportunity'
         and estimate.opportunity_id = job.job_id
       or job.job_kind = 'project'
         and estimate.project_id = job.job_id
     )

    union all

    select 'invoice_rollup',
           invoice.id,
           invoice.status,
           invoice.total::numeric,
           invoice.amount_paid::numeric,
           invoice.balance_due::numeric
    from requested_job job
    join public.invoices invoice
      on 'invoice_rollup' = any(p_financial_components)
     and job.job_kind = 'project'
     and invoice.company_id = p_company_id
     and invoice.project_id = job.job_id
     and invoice.deleted_at is null
  ), financial_document_candidate as materialized (
    select source.*,
           row_number() over (
             order by source.component_kind, source.document_id
           ) as document_rank
    from financial_document_source source
    order by source.component_kind, source.document_id
    limit 501
  ), financial_input_state as materialized (
    select count(*) = 501 as source_query_bound,
           currency.minor_exponent is null
             or coalesce(bool_or(
               document.status is null
               or document.component_kind = 'estimate_rollup'
                  and document.status not in (
                    'draft', 'sent', 'viewed', 'approved',
                    'changes_requested', 'declined', 'converted',
                    'expired', 'superseded'
                  )
               or document.component_kind = 'invoice_rollup'
                  and document.status not in (
                    'draft', 'sent', 'awaiting_payment', 'partially_paid',
                    'past_due', 'paid', 'void', 'written_off'
                  )
               or document.total is null
               or document.total::text in ('NaN', 'Infinity', '-Infinity')
               or trunc(document.total * power(
                    10::numeric, currency.minor_exponent
                  )) is distinct from document.total * power(
                    10::numeric, currency.minor_exponent
                  )
               or abs(document.total * power(
                    10::numeric, currency.minor_exponent
                  )) > 9007199254740991::numeric
               or document.component_kind = 'invoice_rollup' and (
                 document.amount_paid is null
                 or document.balance_due is null
                 or document.amount_paid::text in (
                   'NaN', 'Infinity', '-Infinity'
                 )
                 or document.balance_due::text in (
                   'NaN', 'Infinity', '-Infinity'
                 )
                 or trunc(document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )) is distinct from document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )
                 or trunc(document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )) is distinct from document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )
                 or abs(document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )) > 9007199254740991::numeric
                 or abs(document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )) > 9007199254740991::numeric
               )
             ), false) as source_data_invalid
    from financial_document_candidate document
    cross join financial_currency_state currency
    group by currency.minor_exponent
  ), financial_converted as materialized (
    select document.*,
           private.agent_money_to_minor_units(
             document.total, currency.currency_code
           ) as total_minor,
           case when document.component_kind = 'invoice_rollup' then
             private.agent_money_to_minor_units(
               document.amount_paid, currency.currency_code
             ) end as amount_paid_minor,
           case when document.component_kind = 'invoice_rollup' then
             private.agent_money_to_minor_units(
               document.balance_due, currency.currency_code
             ) end as balance_due_minor
    from financial_document_candidate document
    cross join financial_currency_state currency
    cross join financial_input_state state
    where document.document_rank <= 500
      and not state.source_query_bound
      and not state.source_data_invalid
  ), financial_source_state as materialized (
    select input.source_query_bound,
           input.source_data_invalid
             or coalesce(abs(aggregate.total_minor) >
                  9007199254740991::numeric, false)
             or coalesce(abs(aggregate.amount_paid_minor) >
                  9007199254740991::numeric, false)
             or coalesce(abs(aggregate.balance_due_minor) >
                  9007199254740991::numeric, false)
             as source_data_invalid
    from financial_input_state input
    cross join lateral (
      select max(abs(component.total_minor)) as total_minor,
             max(abs(component.amount_paid_minor)) as amount_paid_minor,
             max(abs(component.balance_due_minor)) as balance_due_minor
      from (
        select document.component_kind,
               sum(document.total_minor)::numeric as total_minor,
               sum(document.amount_paid_minor)::numeric as amount_paid_minor,
               sum(document.balance_due_minor)::numeric as balance_due_minor
        from financial_converted document
        group by document.component_kind
      ) component
    ) aggregate
  ), financial_status_rollup as materialized (
    select document.component_kind,
           document.status,
           count(*)::integer as status_count
    from financial_converted document
    group by document.component_kind, document.status
  ), estimate_rollup as materialized (
    select count(document.document_id)::integer as document_count,
           sum(document.total_minor) as amount_minor,
           currency.currency_code,
           coalesce((select jsonb_agg(jsonb_build_object(
             'status', status.status,
             'count', status.status_count
           ) order by status.status)
           from financial_status_rollup status
           where status.component_kind = 'estimate_rollup'), '[]'::jsonb)
             as status_counts
    from financial_currency_state currency
    left join financial_converted document
      on document.component_kind = 'estimate_rollup'
    group by currency.currency_code
  ), invoice_rollup as materialized (
    select count(document.document_id)::integer as document_count,
           sum(document.total_minor) as total_amount_minor,
           sum(document.amount_paid_minor) as paid_amount_minor,
           sum(document.balance_due_minor) as due_amount_minor,
           currency.currency_code,
           coalesce((select jsonb_agg(jsonb_build_object(
             'status', status.status,
             'count', status.status_count
           ) order by status.status)
           from financial_status_rollup status
           where status.component_kind = 'invoice_rollup'), '[]'::jsonb)
             as status_counts
    from financial_currency_state currency
    left join financial_converted document
      on document.component_kind = 'invoice_rollup'
    group by currency.currency_code
  ), opportunity_status_activity as materialized (
    select transition.transitioned_at as occurred_at,
           'job_status_event'::text as event_kind,
           'stage_transition:' || transition.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'stage_transition:' || transition.id::text,
             'event_kind', 'job_status_event',
             'occurred_at', private.agent_rfc3339_utc(
               transition.transitioned_at
             ),
             'from_status', case when transition.from_stage is null then null
               else jsonb_build_object(
                 'kind', 'opportunity', 'value', transition.from_stage
               ) end,
             'to_status', jsonb_build_object(
               'kind', 'opportunity', 'value', transition.to_stage
             ),
             'status_version', null
           ) as event,
           transition.transitioned_at is null
             or transition.to_stage not in (
               'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
               'negotiation', 'won', 'lost', 'discarded'
             )
             or transition.from_stage is not null
                and transition.from_stage not in (
                  'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
                  'negotiation', 'won', 'lost', 'discarded'
                ) as source_data_invalid
    from requested_job job
    join public.stage_transitions transition
      on 'activity' = any(p_sections)
     and job.job_kind = 'opportunity'
     and transition.company_id = p_company_id
     and transition.opportunity_id = job.job_id
    cross join authority_context context
    where transition.transitioned_at <= context.read_at
    order by transition.transitioned_at desc, transition.id desc
    limit 51
  ), project_status_activity as materialized (
    select status_event.requested_at as occurred_at,
           'job_status_event'::text as event_kind,
           'project_status_event:' || status_event.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'project_status_event:' || status_event.id::text,
             'event_kind', 'job_status_event',
             'occurred_at', private.agent_rfc3339_utc(
               status_event.requested_at
             ),
             'from_status', case when status_event.old_status is null then null
               else jsonb_build_object(
                 'kind', 'project', 'value', status_event.old_status
               ) end,
             'to_status', jsonb_build_object(
               'kind', 'project', 'value', status_event.new_status
             ),
             'status_version', status_event.project_status_version
           ) as event,
           status_event.requested_at is null
             or status_event.new_status not in (
               'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
               'closed', 'archived'
             )
             or status_event.old_status is not null
                and status_event.old_status not in (
                  'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
                  'closed', 'archived'
                )
             or status_event.project_status_version not between
                  0 and 9007199254740991 as source_data_invalid
    from requested_job job
    join public.project_status_lifecycle_outbox status_event
      on 'activity' = any(p_sections)
     and job.job_kind = 'project'
     and status_event.company_id = p_company_id
     and status_event.project_id = job.job_id
    cross join authority_context context
    where status_event.requested_at <= context.read_at
    order by status_event.requested_at desc, status_event.id desc
    limit 51
  ), task_activity as materialized (
    select task_event.created_at as occurred_at,
           'task_event'::text as event_kind,
           'task_mutation_event:' || task_event.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'task_mutation_event:' || task_event.id::text,
             'event_kind', 'task_event',
             'occurred_at', private.agent_rfc3339_utc(
               task_event.created_at
             ),
             'task_ref', jsonb_build_object(
               'kind', 'project_task', 'id', task_event.task_id
             ),
             'event_type', task_event.event_type,
             'schedule_version', task_event.task_schedule_version
           ) as event,
           task_event.created_at is null
             or task_event.event_type not in (
               'task_assigned', 'task_completed', 'schedule_change'
             )
             or task_event.task_schedule_version not between
                  0 and 9007199254740991 as source_data_invalid
    from authorized_project_source project
    join public.task_mutation_events task_event
      on 'activity' = any(p_sections)
     and task_event.company_id = p_company_id
     and task_event.project_id = project.id
    cross join authority_context context
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      'task',
      task_event.task_id,
      'view'
    )
      and task_event.created_at <= context.read_at
    order by task_event.created_at desc, task_event.id desc
    limit 51
  ), activity_source as materialized (
    select event.*,
           row_number() over (
             order by event.occurred_at desc, event.event_kind,
               event.event_ref desc
           ) as event_rank,
           count(*) over ()::integer as event_total
    from (
      select opportunity.* from opportunity_status_activity opportunity
      union all
      select project.* from project_status_activity project
      union all
      select task.* from task_activity task
    ) event
    order by event.occurred_at desc, event.event_kind, event.event_ref desc
    limit 51
  ), activity_source_state as materialized (
    select count(*) = 51 as event_sentinel,
           coalesce(bool_or(activity.source_data_invalid), false)
             as source_data_invalid
    from activity_source activity
  ), conversation_anchor_candidate as materialized (
    select anchor.conversation_id,
           row_number() over (
             order by anchor.conversation_id
           ) as anchor_rank
    from requested_job job
    join public.job_conversation_anchors anchor
      on 'conversation' = any(p_sections)
     and anchor.company_id = p_company_id
     and anchor.anchor_kind = job.job_kind
     and anchor.source_id = job.job_id
    order by anchor.conversation_id
    limit 2
  ), conversation_anchor_state as materialized (
    select count(*) > 1 as source_data_invalid
    from conversation_anchor_candidate
  ), current_conversation_source as materialized (
    select conversation.id,
           conversation.current_memory_version_id
    from conversation_anchor_candidate anchor
    join public.job_conversations conversation
      on anchor.anchor_rank = 1
     and conversation.id = anchor.conversation_id
     and conversation.company_id = p_company_id
  ), conversation_visible_turn as materialized (
    select turn.id,
           turn.delivered_at
    from requested_job job
    join current_conversation_source conversation on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = conversation.id
     and private.user_can_view_inbox_connection(
       p_actor_user_id,
       p_company_id,
       turn.source_connection_id,
       job.opportunity_id
     )
    cross join authority_context context
    where turn.delivered_at <= context.read_at
    order by turn.delivered_at desc, turn.id desc
    limit 251
  ), conversation_turn_state as materialized (
    select count(*)::integer as actor_visible_delivered_turn_count,
           max(turn.delivered_at) as last_actor_visible_delivered_at
    from conversation_visible_turn turn
  ), conversation_memory_source as materialized (
    select memory.version_number,
           memory.turn_high_watermark_id,
           memory.version_number not between 0 and 9007199254740991
             as source_data_invalid,
           exists (
             select 1
             from requested_job job
             join public.job_conversation_turns high_watermark
              on high_watermark.id = memory.turn_high_watermark_id
             and high_watermark.company_id = p_company_id
             and high_watermark.conversation_id = conversation.id
              and high_watermark.delivered_at <= (
                select context.read_at from authority_context context
              )
              and private.user_can_view_inbox_connection(
                p_actor_user_id,
                p_company_id,
                high_watermark.source_connection_id,
                job.opportunity_id
              )
           ) as high_watermark_actor_visible
    from current_conversation_source conversation
    join public.job_memory_versions memory
      on p_inbox_scope = 'all'
     and memory.id = conversation.current_memory_version_id
     and memory.company_id = p_company_id
     and memory.conversation_id = conversation.id
  ), conversation_source as materialized (
    select conversation.id,
           turn_state.actor_visible_delivered_turn_count,
           case when turn_state.actor_visible_delivered_turn_count = 251
             then 'lower_bound' else 'exact' end
             as actor_visible_delivered_turn_count_completeness,
           turn_state.last_actor_visible_delivered_at,
           case when p_inbox_scope = 'all'
                  and not coalesce(memory.source_data_invalid, false)
             then memory.version_number else null end as memory_version,
           case when p_inbox_scope = 'all'
                  and not coalesce(memory.source_data_invalid, false)
                  and memory.high_watermark_actor_visible
             then memory.turn_high_watermark_id else null end
             as turn_high_watermark_id,
           anchor_state.source_data_invalid
             or coalesce(memory.source_data_invalid, false)
             as source_data_invalid
    from conversation_turn_state turn_state
    cross join conversation_anchor_state anchor_state
    left join current_conversation_source conversation on true
    left join conversation_memory_source memory on true
  ), requested_section as materialized (
    select requested.section,
           requested.ordinality as section_rank,
           'evidence:job_summary_section_projection:' || p_job_kind || ':' ||
             p_job_id::text || ':' || requested.section as evidence_id
    from unnest(p_sections) with ordinality requested(section, ordinality)
  ), raw_section as materialized (
    select requested.section,
           requested.section_rank,
           case requested.section
             when 'identity' then case when
               job.title is null
               or char_length(btrim(job.title)) not between 1 and 1000
               or job.address is not null
                  and nullif(btrim(job.address), '') is not null
                  and char_length(btrim(job.address)) > 2000
               or job.created_at is null
               or job.updated_at is null
               or job.created_at > (
                 select context.read_at from authority_context context
               )
               or job.updated_at > (
                 select context.read_at from authority_context context
               )
               or job.created_at > job.updated_at
               or job.lifecycle_state not in ('active', 'terminal', 'archived')
               or job.job_kind = 'opportunity' and job.status not in (
                 'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
                 'negotiation', 'won', 'lost', 'discarded'
               )
               or job.job_kind = 'project' and job.status not in (
                 'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
                 'closed', 'archived'
               ) then jsonb_build_object(
                 'section', 'identity',
                 'state', 'gap',
                 'value', null,
                 'gaps', jsonb_build_array(jsonb_build_object(
                   'code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'job_identity'
                 )),
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) else jsonb_build_object(
                 'section', 'identity',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'job_ref', jsonb_build_object(
                     'kind', job.job_kind, 'id', job.job_id
                   ),
                   'display_title', btrim(job.title),
                   'address', nullif(btrim(job.address), ''),
                   'content_kind', 'untrusted_business_data',
                   'lifecycle_state', job.lifecycle_state,
                   'status', jsonb_build_object(
                     'kind', job.job_kind, 'value', job.status
                   ),
                   'dates', jsonb_build_object(
                     'kind', job.job_kind,
                     'created_at', private.agent_rfc3339_utc(job.created_at),
                     'updated_at', private.agent_rfc3339_utc(job.updated_at)
                   ) || case when job.job_kind = 'project' then
                     jsonb_build_object(
                       'start_date', case when job.start_date is null then null
                         else job.start_date::text end,
                       'end_date', case when job.end_date is null then null
                         else job.end_date::text end
                     ) else '{}'::jsonb end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'schedule' then case
               when schedule_failure.source_query_bound then
                 jsonb_build_object(
                   'section', 'schedule',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_QUERY_BOUND',
                     'source_kind', 'task_schedule'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               when schedule_failure.source_data_invalid then
                 jsonb_build_object(
                   'section', 'schedule',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'task_schedule'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'schedule',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'occurrences', coalesce((select jsonb_agg(
                     occurrence.occurrence order by
                       occurrence.scheduled_start_utc,
                       occurrence.task_id
                   ) from summary_schedule_occurrence occurrence
                   where occurrence.occurrence_rank <= 10), '[]'::jsonb),
                   'occurrence_total', case
                     when schedule_failure.occurrence_sentinel then 11
                     else (select count(*)::integer
                       from summary_schedule_occurrence) end,
                   'occurrences_omitted_count', case
                     when schedule_failure.occurrence_sentinel then 1 else 0 end,
                   'count_completeness', case
                     when schedule_failure.occurrence_sentinel
                       then 'lower_bound' else 'exact' end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'readiness' then jsonb_build_object(
               'section', 'readiness',
               'state', 'readiness_sources',
               'value', readiness.raw_sources,
               'gaps', '[]'::jsonb,
               'evidence_ids', jsonb_build_array(requested.evidence_id)
             )
             when 'participants' then case when
               participant.source_data_invalid
               or participant.participant_count_completeness not in (
                 'exact', 'lower_bound'
               )
               or participant.participant_count_completeness = 'exact' and (
                 participant.participant_total <>
                   jsonb_array_length(participant.participants)
                 or participant.participants_omitted_count <> 0
               )
               or participant.participant_count_completeness = 'lower_bound'
                  and (
                    participant.participant_total <> 51
                    or participant.participants_omitted_count <> 1
                    or jsonb_array_length(participant.participants) <> 50
                  ) then jsonb_build_object(
                 'section', 'participants',
                 'state', 'gap',
                 'value', null,
                 'gaps', jsonb_build_array(jsonb_build_object(
                   'code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'job_participants'
                 )),
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) else jsonb_build_object(
                 'section', 'participants',
                 'state', 'participant_sources',
                 'value', jsonb_build_object(
                   'participants', participant.participants,
                   'participant_total', participant.participant_total,
                   'participants_omitted_count',
                     participant.participants_omitted_count,
                   'participant_count_completeness',
                     participant.participant_count_completeness
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'financials' then case
               when financial_state.source_query_bound then
                 jsonb_build_object(
                   'section', 'financials',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_QUERY_BOUND',
                     'source_kind', 'job_financials'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               when financial_state.source_data_invalid then
                 jsonb_build_object(
                   'section', 'financials',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_financials'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'financials',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'components', (select jsonb_agg(
                     case component.value
                       when 'estimate_rollup' then jsonb_build_object(
                         'kind', 'estimate_rollup',
                         'document_count', estimate.document_count,
                         'total', case when estimate.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', estimate.amount_minor,
                             'currency', estimate.currency_code
                           ) end,
                         'status_counts', estimate.status_counts
                       )
                       else jsonb_build_object(
                         'kind', 'invoice_rollup',
                         'document_count', invoice.document_count,
                         'total', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.total_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'amount_paid', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.paid_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'balance_due', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.due_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'status_counts', invoice.status_counts
                       ) end order by component.ordinality
                   ) from unnest(p_financial_components) with ordinality
                     component(value, ordinality)
                   cross join estimate_rollup estimate
                   cross join invoice_rollup invoice)
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'activity' then case
               when activity_state.source_data_invalid then
                 jsonb_build_object(
                   'section', 'activity',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_activity'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'activity',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'events', coalesce((select jsonb_agg(
                     activity.event order by activity.occurred_at desc,
                       activity.event_kind, activity.event_ref desc
                   ) from activity_source activity
                   where activity.event_rank <= 50), '[]'::jsonb),
                   'event_total', case when activity_state.event_sentinel
                     then 51 else (select count(*)::integer
                       from activity_source) end,
                   'events_omitted_count', case
                     when activity_state.event_sentinel then 1 else 0 end,
                   'count_completeness', case
                     when activity_state.event_sentinel
                       then 'lower_bound' else 'exact' end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'conversation' then case
               when conversation.source_data_invalid then
                 jsonb_build_object(
                   'section', 'conversation',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_conversation'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'conversation',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'conversation_id', conversation.id,
                   'actor_visible_delivered_turn_count',
                     conversation.actor_visible_delivered_turn_count,
                   'actor_visible_delivered_turn_count_completeness',
                     conversation.actor_visible_delivered_turn_count_completeness,
                   'last_actor_visible_delivered_at', case
                     when conversation.last_actor_visible_delivered_at is null
                       then null
                     else private.agent_rfc3339_utc(
                       conversation.last_actor_visible_delivered_at
                     ) end,
                   'memory_version', conversation.memory_version,
                   'turn_high_watermark_id',
                     conversation.turn_high_watermark_id
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
           end as raw
    from requested_section requested
    cross join requested_job job
    left join summary_schedule_failure_state schedule_failure
      on requested.section = 'schedule'
    left join readiness_raw_source readiness
      on requested.section = 'readiness'
    left join participant_source participant on true
    left join financial_source_state financial_state
      on requested.section = 'financials'
    left join activity_source_state activity_state
      on requested.section = 'activity'
    left join conversation_source conversation
      on requested.section = 'conversation'
  ), section_projection as materialized (
    select section.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', '[]'::jsonb,
             'section', section.raw
           ) as projection,
           context.read_at,
           context.source_revision,
           context.history_revision
    from raw_section section
    cross join authority_context context
    cross join canonical_request request
  ), section_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from section_projection projection
  ), section_claims as materialized (
    select section.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'job_summary_section_projection',
             'source_id', p_job_kind || ':' || p_job_id::text || ':' ||
               section.section,
             'version', 'job-summary-section-projection:v1:' ||
               section.source_content_hash
           ) as source_version,
           'evidence:job_summary_section_projection:' || p_job_kind || ':' ||
             p_job_id::text || ':' || section.section as evidence_id
    from section_hashed section
  ), summary_projection as materialized (
    select context.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(section.source_version
                 order by section.section_rank)
               from section_claims section
             ), '[]'::jsonb),
             'summary', jsonb_build_object(
               'requested_job', jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               ),
               'requested_sections', to_jsonb(p_sections),
               'section_count', cardinality(p_sections),
               'gaps', '[]'::jsonb
             )
           ) as projection
    from authority_context context
    cross join canonical_request request
  ), summary_hashed as materialized (
    select summary.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(summary.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from summary_projection summary
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'read_at', private.agent_rfc3339_utc(summary.read_at),
    'source_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || summary.source_revision::text
    ),
    'history_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'job_history_read_revision',
      'source_id', 'private.agent_job_history_revisions',
      'version', 'revision:' || summary.history_revision::text
    ),
    'requested_job', jsonb_build_object(
      'kind', p_job_kind, 'id', p_job_id
    ),
    'section_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw', section.raw,
        'proof', jsonb_build_object(
          'source_version', section.source_version,
          'source_content_hash', section.source_content_hash,
          'evidence_id', section.evidence_id,
          'projection', section.projection
        ),
        'source_version', section.source_version,
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', section.evidence_id,
          'source_domain', 'operations',
          'source_type', 'job_summary_section_projection',
          'source_id', p_job_kind || ':' || p_job_id::text || ':' ||
            section.section,
          'version', section.source_version ->> 'version',
          'occurred_at', private.agent_rfc3339_utc(summary.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://evidence/' ||
            replace(section.evidence_id, ':', '%3A')
        ))
      ) order by requested.section_rank)
      from section_claims section
      join requested_section requested using (section)
    ), '[]'::jsonb),
    'gaps', '[]'::jsonb,
    'summary_claim', jsonb_build_object(
      'raw', summary.projection -> 'summary',
      'proof', jsonb_build_object(
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'job_summary_projection',
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', 'job-summary-projection:v1:' ||
            summary.source_content_hash
        ),
        'source_content_hash', summary.source_content_hash,
        'evidence_id', 'evidence:job_summary_projection:' || p_job_kind || ':' ||
          p_job_id::text,
        'projection', summary.projection
      ),
      'source_version', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'job_summary_projection',
        'source_id', p_job_kind || ':' || p_job_id::text,
        'version', 'job-summary-projection:v1:' || summary.source_content_hash
      ),
      'evidence', jsonb_build_array(jsonb_build_object(
        'evidence_id', 'evidence:job_summary_projection:' || p_job_kind || ':' ||
          p_job_id::text,
        'source_domain', 'operations',
        'source_type', 'job_summary_projection',
        'source_id', p_job_kind || ':' || p_job_id::text,
        'version', 'job-summary-projection:v1:' || summary.source_content_hash,
        'occurred_at', private.agent_rfc3339_utc(summary.read_at),
        'relationship', 'supports',
        'trust', 'authoritative_ops',
        'locator', 'ops://evidence/' || replace(
          'evidence:job_summary_projection:' || p_job_kind || ':' ||
            p_job_id::text,
          ':',
          '%3A'
        )
      ))
    ),
    'prompt_reduction', jsonb_build_object(
      'max_output_characters', 60000,
      'atomic_claim_kind', 'job_summary_section',
      'retention', 'all_or_error',
      'claim_path', 'section_claims',
      'envelope_claim_path', 'summary_claim'
    )
  )
  into v_result
  from summary_hashed summary
  -- count(*) from section_claims = cardinality(p_sections) is the wire
  -- invariant; every requested section has one independent atomic claim.
  where (select count(*) from section_claims) = cardinality(p_sections);

  if v_result is null then
    raise exception 'agent_job_summary_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_job_summary_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_job_summary_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_summary_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) to service_role;

create or replace function public.read_agent_correspondence_evidence_page_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_evidence_ids text[],
  p_mode text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
  v_result jsonb;
  v_requested_evidence_count integer;
  v_returned_evidence_count integer;
  v_full_text_too_large boolean;
  v_attachment_source_bound boolean;
  v_source_data_invalid boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_registered_permission_keys is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id is distinct from 'get_correspondence_evidence'
     or p_capability_revision is distinct from
       'get_correspondence_evidence:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_inbox_scope is null
     or p_inbox_scope not in ('all', 'assigned', 'own')
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or (p_job_kind = 'opportunity') is distinct from
        (p_pipeline_scope is not null)
     or (p_job_kind = 'project') is distinct from
        (p_projects_scope is not null)
     or p_evidence_ids is null
     or cardinality(p_evidence_ids) not between 1 and 20
     or cardinality(p_evidence_ids) > 20
     or p_mode in ('excerpt', 'full_text') is not true
     or exists (
       select 1 from unnest(p_evidence_ids) requested(evidence_id)
       where requested.evidence_id !~
         '^job_conversation_turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     or (select count(distinct requested.evidence_id)
         from unnest(p_evidence_ids) requested(evidence_id)) <>
        cardinality(p_evidence_ids) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or not ('inbox.view' = any(p_registered_permission_keys))
  or p_job_kind = 'opportunity'
     and not ('pipeline.view' = any(p_registered_permission_keys))
  or p_job_kind = 'project'
     and not ('projects.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.correspondence.read'::text as scope
    union all select 'ops.jobs.read'::text
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           history.history_revision,
           date_trunc('milliseconds', statement_timestamp()) as read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_job_history_revisions history
      on history.company_id = p_company_id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.inbox_scope = p_inbox_scope
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and history.history_revision between 0 and 9007199254740991
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        p_job_kind,
        p_job_id,
        'view'
      )
  ), requested_evidence as materialized (
    select requested.evidence_id,
           substring(
             requested.evidence_id
             from char_length('job_conversation_turn:') + 1
           )::uuid as turn_id,
           requested.ordinality
    from unnest(p_evidence_ids) with ordinality
      requested(evidence_id, ordinality)
  ), requested_job as materialized (
    select opportunity.id as job_id,
           opportunity.id as opportunity_id,
           false as canonical_conflict
    from authority_context authority
    join public.opportunities opportunity
      on p_job_kind = 'opportunity'
     and opportunity.company_id = p_company_id
     and opportunity.id = p_job_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
     and not (
       opportunity.client_ref is not null
       and opportunity.client_id is not null
       and opportunity.client_ref is distinct from opportunity.client_id
     )
     and not (
       opportunity.project_ref is not null
       and opportunity.project_id is not null
       and opportunity.project_ref is distinct from opportunity.project_id
     )

    union all

    select project.id,
           case when project.opportunity_ref is not null
             then project.opportunity_ref else project.opportunity_id end,
           false
    from authority_context authority
    join public.projects project
      on p_job_kind = 'project'
     and project.company_id = p_company_id
     and project.id = p_job_id
     and project.deleted_at is null
     and not (
       project.opportunity_ref is not null
       and project.opportunity_id is not null
       and project.opportunity_ref is distinct from project.opportunity_id
     )
  ), current_turn_candidate as materialized (
    select requested.evidence_id,
           requested.ordinality,
           requested.turn_id,
           turn.conversation_id,
           turn.delivered_at,
           turn.delivered_at is null
             or turn.delivered_at > authority.read_at
             as timestamp_source_invalid,
           content_redaction.id is null
             and octet_length(turn.normalized_plain_text) > 1048576
             as text_source_query_bound,
           turn.direction,
           turn.source_connection_id,
           case
             when participant_redaction.id is not null
               or turn.participant_resolution_status <> 'resolved'
               then null
             else turn.side
           end as safe_side,
           case when participant_redaction.id is not null
             then 'redacted'
             else turn.participant_resolution_status
           end as participant_resolution_status,
           content_redaction.id as content_redaction_id,
           participant_redaction.id as participant_redaction_id,
           attachment_redaction.id as attachment_redaction_id,
           case when content_redaction.id is null
             then turn.subject else null end as safe_subject,
           case when content_redaction.id is null
                  and octet_length(turn.normalized_plain_text) <= 1048576
             then turn.normalized_plain_text else null end
             as safe_normalized_plain_text,
           case when content_redaction.id is null
                  and octet_length(turn.normalized_plain_text) <= 1048576 then
             left(btrim(turn.normalized_plain_text), 2000)
             else null end as excerpt_plain_text,
           case
             when content_redaction.id is not null
               or attachment_redaction.id is not null
               or participant_redaction.id is not null then
               'sha256:' || encode(extensions.digest(convert_to(
                 'ops.redacted-source-version.v1:' || turn.id::text || ':' ||
                 turn.original_content_hash || ':' ||
                 coalesce(content_redaction.id::text, '') || ':' ||
                 coalesce(attachment_redaction.id::text, '') || ':' ||
                 coalesce(participant_redaction.id::text, ''),
                 'UTF8'
               ), 'sha256'), 'hex')
             else turn.original_content_hash
           end as safe_original_content_hash,
           case
             when content_redaction.id is not null then
               'sha256:' || encode(extensions.digest(convert_to(
                 'CONTENT_REDACTED', 'UTF8'
               ), 'sha256'), 'hex')
             when octet_length(turn.normalized_plain_text) <= 1048576 then
               'sha256:' || encode(extensions.digest(convert_to(
                 turn.normalized_plain_text, 'UTF8'
               ), 'sha256'), 'hex')
             else null
           end as normalized_content_hash,
           array_remove(array[
             case when content_redaction.id is not null
               then 'subject_redacted' end,
             case when content_redaction.id is not null
               then 'content_redacted' end,
             case when participant_redaction.id is not null
               then 'contact_identity_redacted' end,
             case when attachment_redaction.id is not null
               then 'attachment_metadata_redacted' end
           ]::text[], null) as redaction_kinds,
           case when attachment_redaction.id is not null
             then array[]::text[]
             else turn.attachment_evidence_ids
           end as attachment_evidence_ids
    from authority_context authority
    cross join requested_job job
    join public.job_conversation_anchors anchor
      on anchor.company_id = p_company_id
     and anchor.anchor_kind = p_job_kind
     and anchor.source_id = p_job_id
    join public.job_conversations conversation
      on conversation.company_id = p_company_id
     and conversation.id = anchor.conversation_id
    join requested_evidence requested on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = conversation.id
     and turn.id = requested.turn_id
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = p_company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'content_redacted'
        and redaction.source_state_revision <=
          conversation.source_state_revision
      order by redaction.source_state_revision desc, redaction.id desc
      limit 1
    ) content_redaction on true
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = p_company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'participant_pseudonymized'
        and redaction.source_state_revision <=
          conversation.source_state_revision
      order by redaction.source_state_revision desc, redaction.id desc
      limit 1
    ) participant_redaction on true
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = p_company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'attachment_redacted'
        and redaction.source_state_revision <=
          conversation.source_state_revision
      order by redaction.source_state_revision desc, redaction.id desc
      limit 1
    ) attachment_redaction on true
    where private.user_can_view_inbox_connection(
      p_actor_user_id,
      p_company_id,
      turn.source_connection_id,
      job.opportunity_id
    )
      and turn.direction in ('inbound', 'outbound')
      and turn.participant_resolution_status in (
        'resolved', 'ambiguous', 'unresolved'
      )
      and (
        turn.participant_resolution_status <> 'resolved'
        or turn.direction = 'inbound' and turn.side = 'user'
        or turn.direction = 'outbound' and turn.side = 'assistant'
      )
      and turn.original_content_hash ~ '^sha256:[0-9a-f]{64}$'
      and (
        content_redaction.id is not null
        or turn.normalized_plain_text is not null
          and octet_length(turn.normalized_plain_text) <= 8388608
      )
      and (
        content_redaction.id is not null
        or turn.subject is null
        or char_length(btrim(turn.subject)) <= 1000
      )
  ), attachment_array_state as materialized (
    select exists (
      select 1 from current_turn_candidate turn
      where cardinality(turn.attachment_evidence_ids) > 100
    ) as query_bound,
    exists (
      select 1
      from current_turn_candidate turn
      where cardinality(turn.attachment_evidence_ids) <= 100
        and (
          exists (
            select 1
            from unnest(turn.attachment_evidence_ids[1:100])
              source_attachment(evidence_id)
            where source_attachment.evidence_id !~
              '^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          or (
            select count(distinct source_attachment.evidence_id)
            from unnest(turn.attachment_evidence_ids[1:100])
              source_attachment(evidence_id)
          ) <> cardinality(turn.attachment_evidence_ids)
        )
    ) as data_invalid
  ), current_turn as materialized (
    select turn.*
    from current_turn_candidate turn
    where not turn.timestamp_source_invalid
      and not turn.text_source_query_bound
      and cardinality(turn.attachment_evidence_ids) <= 100
      and not exists (
        select 1
        from unnest(case
          when cardinality(turn.attachment_evidence_ids) <= 100
            then turn.attachment_evidence_ids[1:100]
          else array[]::text[] end
        ) source_attachment(evidence_id)
        where source_attachment.evidence_id !~
          '^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      and (
        select count(distinct source_attachment.evidence_id)
        from unnest(case
          when cardinality(turn.attachment_evidence_ids) <= 100
            then turn.attachment_evidence_ids[1:100]
          else array[]::text[] end
        )
          source_attachment(evidence_id)
      ) = cardinality(turn.attachment_evidence_ids)
  ), attachment_candidate as materialized (
    select turn.evidence_id,
           turn.source_connection_id,
           attachment.attachment_evidence_id,
           substring(
             attachment.attachment_evidence_id
             from char_length('email_attachment:') + 1
           )::uuid as attachment_id,
           attachment.ordinality,
           row_number() over (
             order by turn.ordinality, attachment.ordinality,
               attachment.attachment_evidence_id collate "C"
           ) as global_attachment_rank
    from current_turn turn
    cross join lateral unnest(case
      when cardinality(turn.attachment_evidence_ids) <= 100
        then turn.attachment_evidence_ids[1:100]
      else array[]::text[] end
    ) with ordinality
      attachment(attachment_evidence_id, ordinality)
  ), safe_attachment as materialized (
    select requested.evidence_id,
           requested.ordinality,
           requested.global_attachment_rank,
           jsonb_build_object(
             'attachment_id', requested.attachment_evidence_id,
             'mime_type', lower(coalesce(
               attachment.detected_mime_type, attachment.mime_type
             )),
             'size_bytes', attachment.verified_size_bytes,
             'inline', attachment.is_inline,
             'content_hash', 'sha256:' || attachment.content_sha256
           ) as attachment
    from attachment_candidate requested
    join public.email_attachments attachment
      on attachment.id = requested.attachment_id
     and attachment.company_id = p_company_id
     and attachment.connection_id = requested.source_connection_id
    where requested.global_attachment_rank <= 20
      and lower(coalesce(
        attachment.detected_mime_type, attachment.mime_type
      )) ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
      and octet_length(lower(coalesce(
        attachment.detected_mime_type, attachment.mime_type
      ))) between 3 and 255
      and attachment.verified_size_bytes between 0 and 9007199254740991
      and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
      and attachment.is_inline is not null
  ), attachment_projection as materialized (
    select attachment.evidence_id,
           jsonb_agg(
             attachment.attachment
             order by attachment.ordinality,
               (attachment.attachment ->> 'attachment_id') collate "C"
           ) as attachments
    from safe_attachment attachment
    group by attachment.evidence_id
  ), raw_evidence as materialized (
    select turn.evidence_id,
           turn.ordinality,
           turn.turn_id,
           turn.delivered_at,
           jsonb_build_object(
             'evidence_id', turn.evidence_id,
             'job_ref', jsonb_build_object(
               'kind', p_job_kind, 'id', p_job_id
             ),
             'delivered_at', private.agent_rfc3339_utc(turn.delivered_at),
             'direction', turn.direction,
             'side', turn.safe_side,
             'participant_resolution_status',
               turn.participant_resolution_status,
             'subject', case
               when turn.content_redaction_id is not null then
                 jsonb_build_object(
                   'state', 'redacted', 'code', 'SUBJECT_REDACTED'
                 )
               when nullif(btrim(turn.safe_subject), '') is null then
                 jsonb_build_object('state', 'absent', 'code', 'NO_SUBJECT')
               else jsonb_build_object(
                 'state', 'available',
                 'text', btrim(turn.safe_subject),
                 'content_kind', 'untrusted_external_content'
               )
             end,
             'content', case
               when turn.content_redaction_id is not null then
                 jsonb_build_object(
                   'state', 'redacted', 'code', 'CONTENT_REDACTED'
                 )
               when nullif(btrim(turn.safe_normalized_plain_text), '') is null
                 then
                 jsonb_build_object(
                   'state', 'absent', 'code', 'NO_CONTENT'
                 )
               else jsonb_build_object(
                 'state', 'available',
                 'mode', p_mode,
                 'normalized_plain_text', case
                   when p_mode = 'full_text'
                     then turn.safe_normalized_plain_text
                   else turn.excerpt_plain_text
                 end,
                 'truncated', p_mode = 'excerpt' and char_length(
                   btrim(turn.safe_normalized_plain_text)
                 ) > 2000,
                 'content_kind', 'untrusted_external_content'
               )
             end,
             'original_content_hash', turn.safe_original_content_hash,
             'normalized_content_hash', turn.normalized_content_hash,
             'redaction_kinds', to_jsonb(turn.redaction_kinds),
             'attachments', coalesce(attachment.attachments, '[]'::jsonb),
             'trust', 'delivered_correspondence',
             'evidence_ids', jsonb_build_array(turn.evidence_id)
           ) as raw
    from current_turn turn
    left join attachment_projection attachment
      on attachment.evidence_id = turn.evidence_id
  ), evidence_projection as materialized (
    select evidence.*,
           context.read_at,
           context.history_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', jsonb_build_object(
               'job_ref', jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               ),
               'evidence_ids', to_jsonb(p_evidence_ids),
               'mode', p_mode
             ),
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'history_revision', context.history_revision,
             'retained_proof_sources', '[]'::jsonb,
             'correspondence_evidence', evidence.raw
           ) as projection
    from raw_evidence evidence
    cross join authority_context context
  ), evidence_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from evidence_projection projection
  ), evidence_claim as materialized (
    select evidence.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'correspondence_evidence_projection',
             'source_id', evidence.evidence_id,
             'version', 'correspondence-evidence-projection:v1:' ||
               evidence.source_content_hash
           ) as source_version
    from evidence_hashed evidence
  ), envelope_projection as materialized (
    select context.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', jsonb_build_object(
               'job_ref', jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               ),
               'evidence_ids', to_jsonb(p_evidence_ids),
               'mode', p_mode
             ),
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'history_revision', context.history_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(evidence.source_version
                 order by evidence.ordinality)
               from evidence_claim evidence
             ), '[]'::jsonb),
             'collection', jsonb_build_object(
               'requested_job', jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               ),
               'requested_evidence_count', cardinality(p_evidence_ids),
               'returned_evidence_count', (select count(*) from evidence_claim),
               'gaps', '[]'::jsonb
             )
           ) as projection
    from authority_context context
  ), envelope_hashed as materialized (
    select envelope.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(envelope.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from envelope_projection envelope
  ), final_result as materialized (
    select jsonb_build_object(
      'company_id', p_company_id,
      'permission_snapshot_revision', p_permission_snapshot_revision,
      'read_at', private.agent_rfc3339_utc(envelope.read_at),
      'history_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'job_history_read_revision',
        'source_id', 'private.agent_job_history_revisions',
        'version', 'revision:' || envelope.history_revision::text
      ),
      'requested_job', jsonb_build_object(
        'kind', p_job_kind, 'id', p_job_id
      ),
      'evidence_claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'raw', evidence.raw,
          'proof', jsonb_build_object(
            'source_version', evidence.source_version,
            'source_content_hash', evidence.source_content_hash,
            'evidence_id', evidence.evidence_id,
            'projection', evidence.projection
          ),
          'source_version', evidence.source_version,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_id', evidence.evidence_id,
            'source_domain', 'operations',
            'source_type', 'correspondence_evidence_projection',
            'source_id', evidence.evidence_id,
            'version', evidence.source_version ->> 'version',
            'occurred_at', private.agent_rfc3339_utc(envelope.read_at),
            'relationship', 'supports',
            'trust', 'delivered_correspondence',
            'locator', 'ops://evidence/' ||
              replace(evidence.evidence_id, ':', '%3A')
          ))
        ) order by evidence.ordinality)
        from evidence_claim evidence
      ), '[]'::jsonb),
      'requested_evidence_count', cardinality(p_evidence_ids),
      'returned_evidence_count', (select count(*) from evidence_claim),
      'gaps', '[]'::jsonb,
      'collection_claim', jsonb_build_object(
        'raw', envelope.projection -> 'collection',
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'correspondence_evidence_collection_projection',
            'source_id', p_job_kind || ':' || p_job_id::text,
            'version', 'correspondence-evidence-collection-projection:v1:' ||
              envelope.source_content_hash
          ),
          'source_content_hash', envelope.source_content_hash,
          'evidence_id',
            'evidence:correspondence_evidence_collection_projection:' ||
            p_job_kind || ':' || p_job_id::text,
          'projection', envelope.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'correspondence_evidence_collection_projection',
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', 'correspondence-evidence-collection-projection:v1:' ||
            envelope.source_content_hash
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id',
            'evidence:correspondence_evidence_collection_projection:' ||
            p_job_kind || ':' || p_job_id::text,
          'source_domain', 'operations',
          'source_type', 'correspondence_evidence_collection_projection',
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', 'correspondence-evidence-collection-projection:v1:' ||
            envelope.source_content_hash,
          'occurred_at', private.agent_rfc3339_utc(envelope.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://evidence/' || replace(
            'evidence:correspondence_evidence_collection_projection:' ||
              p_job_kind || ':' || p_job_id::text,
            ':',
            '%3A'
          )
        ))
      ),
      'prompt_reduction', jsonb_build_object(
        'max_output_characters', 60000,
        'atomic_claim_kind', 'correspondence_evidence',
        'retention', 'all_or_error',
        'claim_path', 'evidence_claims',
        'envelope_claim_path', 'collection_claim'
      )
    ) as result
    from envelope_hashed envelope
  )
  select final.result,
         cardinality(p_evidence_ids),
         (select count(*) from evidence_claim),
         exists(
           select 1 from current_turn turn
           where p_mode = 'full_text'
             and turn.content_redaction_id is null
             and char_length(turn.safe_normalized_plain_text) > 59000
         ),
    exists(
      select 1 from attachment_candidate attachment
      where attachment.global_attachment_rank > 20
    ) or (select query_bound from attachment_array_state)
      or exists (
        select 1 from current_turn_candidate turn
        where turn.text_source_query_bound
      ),
         exists(
           select 1
           from attachment_candidate requested
           where requested.global_attachment_rank <= 20
             and not exists (
               select 1 from safe_attachment safe
               where safe.evidence_id = requested.evidence_id
                 and safe.ordinality = requested.ordinality
             )
         ) or (select data_invalid from attachment_array_state)
           or exists (
           select 1 from current_turn_candidate turn
           where turn.timestamp_source_invalid
         )
  into v_result,
       v_requested_evidence_count,
       v_returned_evidence_count,
       v_full_text_too_large,
       v_attachment_source_bound,
       v_source_data_invalid
  from final_result final;

  if v_full_text_too_large then
    raise exception 'agent_correspondence_evidence_full_text_too_large'
      using errcode = '54000';
  end if;
  if v_attachment_source_bound then
    raise exception 'agent_correspondence_evidence_source_query_bound'
      using errcode = '54000';
  end if;
  if v_source_data_invalid then
    raise exception 'agent_correspondence_evidence_source_data_invalid'
      using errcode = '22000';
  end if;
  if v_result is null
     or v_returned_evidence_count <> v_requested_evidence_count then
    -- returned_evidence_count = requested_evidence_count is mandatory; any
    -- missing, inaccessible, cross-job, or malformed source stays
    -- indistinguishable at the capability boundary.
    raise exception 'agent_correspondence_evidence_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_correspondence_evidence_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_page_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_page_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) to service_role;

create or replace function public.read_agent_job_history_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_estimates_scope text,
  p_projects_financials_scope text,
  p_query text,
  p_scope_kind text,
  p_customer_kind text,
  p_customer_id uuid,
  p_scope_job_kinds text[],
  p_job_refs jsonb,
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_source_types text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_history_revision bigint,
  p_cursor_rank_micros bigint,
  p_cursor_occurred_at timestamptz,
  p_cursor_source_type text,
  p_cursor_source_id text,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
  v_query tsquery;
  v_result jsonb;
  v_source_query_bound boolean;
  v_total_query_bound boolean;
  v_read_as_of timestamptz;
  v_effective_from timestamptz;
  v_effective_to_exclusive timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_registered_permission_keys is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id is distinct from 'search_job_history'
     or p_capability_revision is distinct from
       'search_job_history:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_query is null
     or p_query is distinct from btrim(p_query)
     or char_length(p_query) > 500
     or octet_length(p_query) not between 1 and 2000
     or p_scope_kind in ('customer', 'jobs') is not true
     or p_scope_kind = 'customer' and (
       p_customer_kind not in ('client', 'sub_client')
       or p_customer_id is null
       or p_scope_job_kinds is null
       or cardinality(p_scope_job_kinds) not between 1 and 2
       or p_scope_job_kinds <@
          array['opportunity', 'project']::text[] is not true
       or (select count(distinct requested.job_kind)
           from unnest(p_scope_job_kinds) requested(job_kind)) <>
          cardinality(p_scope_job_kinds)
       or p_job_refs is not null
     )
     or p_scope_kind = 'jobs' and (
       p_customer_kind is not null
       or p_customer_id is not null
       or p_scope_job_kinds is not null
       or p_job_refs is null
       or jsonb_typeof(p_job_refs) <> 'array'
       or jsonb_array_length(p_job_refs) not between 1 and 50
       or jsonb_array_length(p_job_refs) > 50
     )
     or (p_from is null) is distinct from (p_to_exclusive is null)
     or p_from is not null and (
       p_to_exclusive <= p_from
       or p_to_exclusive - p_from > interval '365 days'
     )
     or p_source_types is null
     or cardinality(p_source_types) not between 1 and 5
     or p_source_types <@ array[
       'delivered_correspondence',
       'current_memory_summary',
       'job_status_event',
       'task_event',
       'estimate_document'
     ]::text[] is not true
     or (select count(distinct requested.source_type)
         from unnest(p_source_types) requested(source_type)) <>
        cardinality(p_source_types)
     or (p_read_as_of is null) is distinct from
        (p_cursor_source_revision is null)
     or p_limit not between 1 and 20
     or p_inbox_scope is not null
        and p_inbox_scope not in ('all', 'assigned', 'own')
     or p_clients_scope is not null
        and p_clients_scope not in ('all', 'assigned')
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or p_tasks_scope is not null
        and p_tasks_scope not in ('all', 'assigned')
     or p_estimates_scope is not null
        and p_estimates_scope not in ('all', 'assigned')
     or p_projects_financials_scope is not null
        and p_projects_financials_scope <> 'all'
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_history_revision is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_rank_micros is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_occurred_at is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_source_type is null)
     or (p_cursor_source_revision is null) is distinct from
        (p_cursor_source_id is null)
     or p_cursor_rank_micros is not null
        and p_cursor_rank_micros not between 0 and 1000000
     or p_cursor_source_type is not null
        and p_cursor_source_type <> all(p_source_types)
     or p_cursor_source_id is not null
        and octet_length(p_cursor_source_id) not between 1 and 512 then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  if p_scope_kind = 'jobs' and exists (
    select 1
    from jsonb_array_elements(p_job_refs) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
       or requested.value ->> 'kind' not in ('opportunity', 'project')
       or not pg_input_is_valid(requested.value ->> 'id', 'uuid')
       or requested.value - array['kind', 'id'] <> '{}'::jsonb
  ) then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  if p_scope_kind = 'jobs' and (
    select count(*) <> count(distinct (
      requested.value ->> 'kind', requested.value ->> 'id'
    ))
    from jsonb_array_elements(p_job_refs) requested(value)
  ) then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  if (p_scope_kind = 'customer') is distinct from
       (p_clients_scope is not null)
     or (p_source_types && array[
          'delivered_correspondence', 'current_memory_summary'
        ]::text[]) is distinct from (p_inbox_scope is not null)
     or (
       p_scope_kind = 'customer'
         and 'opportunity' = any(p_scope_job_kinds)
       or p_scope_kind = 'jobs' and exists (
         select 1
         from jsonb_array_elements(p_job_refs) requested(value)
         where requested.value ->> 'kind' = 'opportunity'
       )
     ) is distinct from (p_pipeline_scope is not null)
     or (
       p_scope_kind = 'customer'
         and 'project' = any(p_scope_job_kinds)
       or p_scope_kind = 'jobs' and exists (
         select 1
         from jsonb_array_elements(p_job_refs) requested(value)
         where requested.value ->> 'kind' = 'project'
       )
       or 'task_event' = any(p_source_types)
     ) is distinct from (p_projects_scope is not null)
     or ('task_event' = any(p_source_types)) is distinct from
       (p_calendar_scope is not null)
     or ('task_event' = any(p_source_types)) is distinct from
       (p_tasks_scope is not null)
     or ('estimate_document' = any(p_source_types)) is distinct from
       (p_estimates_scope is not null)
     or (
       'estimate_document' = any(p_source_types)
       and (
         p_scope_kind = 'customer'
           and 'project' = any(p_scope_job_kinds)
         or p_scope_kind = 'jobs' and exists (
           select 1
           from jsonb_array_elements(p_job_refs) requested(value)
           where requested.value ->> 'kind' = 'project'
         )
       )
     ) is distinct from (p_projects_financials_scope is not null) then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  v_read_as_of := date_trunc(
    'milliseconds', coalesce(p_read_as_of, statement_timestamp())
  );
  -- Omitted windows are an exact 365 * 24-hour instant range. Using a day
  -- interval against timestamptz would drift by an hour across a session-timezone
  -- DST boundary.
  v_effective_from := coalesce(p_from, v_read_as_of - interval '8760 hours');
  v_effective_to_exclusive := coalesce(p_to_exclusive, v_read_as_of);

  v_query := plainto_tsquery('simple', p_query);
  if numnode(v_query) not between 1 and 64 then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or (p_scope_kind = 'customer'
      and not ('clients.view' = any(p_registered_permission_keys)))
  or (p_pipeline_scope is not null
      and not ('pipeline.view' = any(p_registered_permission_keys)))
  or (p_projects_scope is not null
      and not ('projects.view' = any(p_registered_permission_keys)))
  or (p_source_types && array[
        'delivered_correspondence', 'current_memory_summary'
      ]::text[]
      and not ('inbox.view' = any(p_registered_permission_keys)))
  or ('task_event' = any(p_source_types) and (
      not ('calendar.view' = any(p_registered_permission_keys))
      or not ('projects.view' = any(p_registered_permission_keys))
      or not ('tasks.view' = any(p_registered_permission_keys))))
  or ('estimate_document' = any(p_source_types)
      and not ('estimates.view' = any(p_registered_permission_keys)))
  or ('estimate_document' = any(p_source_types)
      and p_projects_financials_scope is not null
      and not ('projects.view_financials' = any(p_registered_permission_keys)))
  then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.jobs.read'::text as scope
    union select 'ops.customers.read'::text
      where p_scope_kind = 'customer'
    union select 'ops.correspondence.read'::text
      where p_source_types && array[
        'delivered_correspondence', 'current_memory_summary'
      ]::text[]
    union select 'ops.schedule.read'::text
      where 'task_event' = any(p_source_types)
    union select 'ops.financials.read'::text
      where 'estimate_document' = any(p_source_types)
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'estimates.view'
           ) as estimates_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' =
               'projects.view_financials'
           ) as projects_financials_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           company.currency_code,
           source_revision.source_revision,
           history_revision.history_revision,
           date_trunc('milliseconds', statement_timestamp()) as statement_read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions source_revision
      on source_revision.company_id = p_company_id
    join private.agent_job_history_revisions history_revision
      on history_revision.company_id = p_company_id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and (p_clients_scope is null or authority.clients_scope = p_clients_scope)
      and (p_inbox_scope is null or authority.inbox_scope = p_inbox_scope)
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and (p_calendar_scope is null
        or authority.calendar_scope = p_calendar_scope)
      and (p_tasks_scope is null or authority.tasks_scope = p_tasks_scope)
      and (p_estimates_scope is null
        or authority.estimates_scope = p_estimates_scope)
      and (p_projects_financials_scope is null
        or authority.projects_financials_scope =
          p_projects_financials_scope)
      and source_revision.source_revision between 0 and 9007199254740991
      and history_revision.history_revision between 0 and 9007199254740991
      and (
        p_cursor_source_revision is null
        or (
          source_revision.source_revision = p_cursor_source_revision
          and history_revision.history_revision = p_cursor_history_revision
        )
      )
  ), canonical_request as materialized (
    select jsonb_strip_nulls(jsonb_build_object(
      'query', p_query,
      'scope', case when p_scope_kind = 'customer' then
        jsonb_build_object(
          'kind', 'customer',
          'customer_ref', jsonb_build_object(
            'kind', p_customer_kind, 'id', p_customer_id
          ),
          'job_kinds', to_jsonb(p_scope_job_kinds)
        ) else jsonb_build_object(
          'kind', 'jobs',
          'job_refs', p_job_refs
        ) end,
      'window', case when p_from is not null then jsonb_build_object(
        'from', private.agent_rfc3339_utc(p_from),
        'to_exclusive', private.agent_rfc3339_utc(p_to_exclusive)
      ) else null end,
      'source_types', to_jsonb(p_source_types),
      'limit', p_limit
    )) as canonical_input
  ), requested_customer as materialized (
    select client.id as parent_client_id
    from authority_context authority
    join public.clients client
      on p_scope_kind = 'customer'
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
     and (
       (p_customer_kind = 'client' and client.id = p_customer_id)
       or exists (
         select 1 from public.sub_clients sub_client
         where p_customer_kind = 'sub_client'
           and sub_client.company_id = p_company_id
           and sub_client.id = p_customer_id
           and sub_client.client_id = client.id
           and sub_client.deleted_at is null
       )
     )
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, 'client', client.id, 'view'
    )
  ), explicit_job_ref as materialized (
    select requested.value ->> 'kind' as job_kind,
           (requested.value ->> 'id')::uuid as job_id
    from jsonb_array_elements(coalesce(p_job_refs, '[]'::jsonb))
      requested(value)
  ), scope_job_candidate as materialized (
    select 'opportunity'::text as job_kind,
           opportunity.id as job_id,
           opportunity.id as opportunity_id,
           case when opportunity.project_ref is not null
             then opportunity.project_ref else opportunity.project_id end
             as project_id,
           private.resolve_opportunity_client_id(
             opportunity.client_ref, opportunity.client_id
           ) as client_id,
           opportunity.client_ref is not null
             and opportunity.client_id is not null
             and opportunity.client_ref is distinct from opportunity.client_id
             or opportunity.project_ref is not null
             and opportunity.project_id is not null
             and opportunity.project_ref is distinct from opportunity.project_id
             as canonical_conflict
    from authority_context authority
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join requested_customer customer on true
    left join explicit_job_ref requested
      on requested.job_kind = 'opportunity'
     and requested.job_id = opportunity.id
    where (
      (p_scope_kind = 'customer'
        and 'opportunity' = any(p_scope_job_kinds)
        and private.resolve_opportunity_client_id(
          opportunity.client_ref, opportunity.client_id
        ) = customer.parent_client_id)
      or (p_scope_kind = 'jobs' and requested.job_id is not null)
    )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'opportunity', opportunity.id, 'view'
      )

    union all

    select 'project',
           project.id,
           case when project.opportunity_ref is not null
             then project.opportunity_ref else project.opportunity_id end,
           project.id,
           project.client_id,
           project.opportunity_ref is not null
             and project.opportunity_id is not null
             and project.opportunity_ref is distinct from project.opportunity_id
    from authority_context authority
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
    left join requested_customer customer on true
    left join explicit_job_ref requested
      on requested.job_kind = 'project'
     and requested.job_id = project.id
    where (
      (p_scope_kind = 'customer'
        and 'project' = any(p_scope_job_kinds)
        and project.client_id = customer.parent_client_id)
      or (p_scope_kind = 'jobs' and requested.job_id is not null)
    )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', project.id, 'view'
      )
  ), scope_anchor_state as materialized (
    select coalesce(bool_or(candidate.canonical_conflict), false) as conflict
    from scope_job_candidate candidate
  ), scope_job as materialized (
    select candidate.job_kind,
           candidate.job_id,
           candidate.opportunity_id,
           candidate.project_id,
           candidate.client_id
    from scope_job_candidate candidate
    cross join scope_anchor_state state
    where not state.conflict
  ), anchored_conversation_candidate as materialized (
    select distinct job.job_kind,
           job.job_id,
           job.opportunity_id,
           anchor.conversation_id,
           conversation.source_state_revision
             as conversation_source_state_revision
    from scope_job job
    join public.job_conversation_anchors anchor
      on anchor.company_id = p_company_id
     and anchor.anchor_kind = job.job_kind
     and anchor.source_id = job.job_id
    join public.job_conversations conversation
      on conversation.company_id = p_company_id
     and conversation.id = anchor.conversation_id
  ), anchored_conversation_ranked as materialized (
    select candidate.*,
           row_number() over (
             partition by candidate.conversation_id
             order by case candidate.job_kind
               when 'project' then 1 else 2 end,
               candidate.job_id::text collate "C"
           ) as anchor_rank,
           count(*) over (
             partition by candidate.conversation_id, candidate.job_kind
           ) as same_kind_anchor_count
    from anchored_conversation_candidate candidate
  ), conversation_anchor_state as materialized (
    select exists (
      select 1 from anchored_conversation_ranked ranked
      where ranked.same_kind_anchor_count > 1
    ) as invalid
  ), anchored_conversation as materialized (
    select ranked.job_kind,
           ranked.job_id,
           ranked.opportunity_id,
           ranked.conversation_id,
           ranked.conversation_source_state_revision
    from anchored_conversation_ranked ranked
    where ranked.anchor_rank = 1
  ), oversized_delivered_source as materialized (
    select true as exceeded
    from anchored_conversation job
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = job.conversation_id
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = p_company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'content_redacted'
        and redaction.source_state_revision <=
          job.conversation_source_state_revision
      order by redaction.source_state_revision desc, redaction.id desc
      limit 1
    ) redaction on true
    where 'delivered_correspondence' = any(p_source_types)
      and redaction.id is null
      and private.user_can_view_inbox_connection(
        p_actor_user_id,
        p_company_id,
        turn.source_connection_id,
        job.opportunity_id
      )
      and turn.delivered_at >= v_effective_from
      and turn.delivered_at < v_effective_to_exclusive
      and turn.delivered_at <= v_read_as_of
      and octet_length(
        coalesce(turn.subject, '') || ' ' ||
        coalesce(turn.normalized_plain_text, '')
      ) > 524288
    limit 1
  ), current_redacted_turn as materialized (
    select job.job_kind,
           job.job_id,
           job.opportunity_id,
           job.conversation_id,
           turn.id,
           turn.delivered_at,
           case when redaction.id is not null
             then ''::text
             else concat_ws(
               ' ', nullif(btrim(turn.subject), ''),
               turn.normalized_plain_text
             )
           end as searchable_text,
           turn.source_connection_id
    from anchored_conversation job
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = job.conversation_id
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = p_company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'content_redacted'
        and redaction.source_state_revision <=
          job.conversation_source_state_revision
      order by redaction.source_state_revision desc, redaction.id desc
      limit 1
    ) redaction on true
    where private.user_can_view_inbox_connection(
      p_actor_user_id,
      p_company_id,
      turn.source_connection_id,
      job.opportunity_id
    )
      and turn.delivered_at >= v_effective_from
      and turn.delivered_at < v_effective_to_exclusive
      and turn.delivered_at <= v_read_as_of
      and octet_length(
        coalesce(turn.subject, '') || ' ' ||
        coalesce(turn.normalized_plain_text, '')
      ) <= 524288
      -- This predicate is deliberately byte-for-byte aligned with the GIN
      -- expression above. The exact safe-text predicate is reapplied only
      -- after the latest current redaction has been resolved.
      and to_tsvector(
        'simple',
        case when octet_length(
          coalesce(turn.subject, '') || ' ' ||
          coalesce(turn.normalized_plain_text, '')
        ) <= 524288 then
          coalesce(turn.subject, '') || ' ' ||
          coalesce(turn.normalized_plain_text, '')
        else '' end
      ) @@ v_query
  ), history_source_contract as materialized (
    select jsonb_build_object(
      'source_type', 'delivered_correspondence',
      'truth_kind', 'immutable_event',
      'content_kind', 'untrusted_external_content'
    ) as contract
    union all select jsonb_build_object(
      'source_type', 'current_memory_summary',
      'truth_kind', 'derived_summary',
      'content_kind', 'model_transcribed_summary'
    )
    union all select jsonb_build_object(
      'source_type', 'job_status_event',
      'truth_kind', 'immutable_event',
      'content_kind', 'untrusted_business_data'
    )
    union all select jsonb_build_object(
      'source_type', 'task_event',
      'truth_kind', 'immutable_event',
      'content_kind', 'untrusted_business_data'
    )
    union all select jsonb_build_object(
      'source_type', 'estimate_document',
      'truth_kind', 'current_snapshot',
      'content_kind', 'untrusted_business_data'
    )
  ), delivered_source_candidate as materialized (
    select 'delivered_correspondence'::text as source_type,
           'immutable_event'::text as truth_kind,
           'untrusted_external_content'::text as content_kind,
           'job_history_match:delivered:' || turn.id::text as source_id,
           turn.job_kind,
           turn.job_id,
           turn.conversation_id,
           turn.delivered_at as occurred_at,
           left(turn.searchable_text, 2000) as excerpt,
           char_length(turn.searchable_text) > 2000 as excerpt_truncated,
           least(1000000::bigint, greatest(0::bigint,
             round(ts_rank_cd(
               to_tsvector('simple', turn.searchable_text),
               v_query
             ) * 1000000)::bigint
           )) as rank_micros,
           'evidence:job_history_event_projection:' ||
             'job_history_match:delivered:' || turn.id::text as evidence_id,
           jsonb_build_array(
             'job_conversation_turn:' || turn.id::text
           ) as correspondence_evidence_ids,
           null::jsonb as memory_fragment
    from current_redacted_turn turn
    where 'delivered_correspondence' = any(p_source_types)
      and to_tsvector('simple', turn.searchable_text) @@ v_query
    order by rank_micros desc, turn.delivered_at desc, turn.id desc
    limit 501
  ), memory_version_candidate as materialized (
    select job.job_kind,
           job.job_id,
           job.opportunity_id,
           job.conversation_id,
           memory.id as memory_id,
           memory.created_at,
           memory.memory_document
    from anchored_conversation job
    join public.job_conversations conversation
      on conversation.company_id = p_company_id
     and conversation.id = job.conversation_id
    join public.job_memory_versions memory
      on memory.company_id = p_company_id
     and memory.conversation_id = conversation.id
     and conversation.current_memory_version_id = memory.id
    where 'current_memory_summary' = any(p_source_types)
      and memory.created_at >= v_effective_from
      and memory.created_at < v_effective_to_exclusive
      and memory.created_at <= v_read_as_of
  ), memory_document_state as materialized (
    select coalesce(bool_or(
             jsonb_typeof(memory.memory_document) <> 'object'
           ), false) as invalid,
           coalesce(bool_or(
             octet_length(memory.memory_document::text) > 60000
           ), false) as query_bound
    from memory_version_candidate memory
  ), memory_version_source as materialized (
    select memory.*
    from memory_version_candidate memory
    where jsonb_typeof(memory.memory_document) = 'object'
      and octet_length(memory.memory_document::text) <= 60000
      and to_tsvector(
        'simple',
        case when octet_length(memory.memory_document::text) <= 60000
          then memory.memory_document::text else '' end
      ) @@ v_query
  ), memory_fragment_shape_state as materialized (
    select (
      exists (
        select 1
        from memory_version_candidate memory
        cross join lateral (values
          ('facts'::text, memory.memory_document -> 'facts'),
          ('decisions'::text, memory.memory_document -> 'decisions'),
          ('commitments'::text, memory.memory_document -> 'commitments'),
          ('preferences'::text, memory.memory_document -> 'preferences'),
          ('open_questions'::text,
            memory.memory_document -> 'open_questions'),
          ('schedule_assertions'::text,
            memory.memory_document -> 'schedule_assertions'),
          ('financial_facts'::text,
            memory.memory_document -> 'financial_facts'),
          ('excluded_assumptions'::text,
            memory.memory_document -> 'excluded_assumptions')
        ) fragment(fragment_kind, fragment_array)
        where fragment.fragment_array is not null
          and jsonb_typeof(fragment.fragment_array) <> 'array'
      ) or exists (
        select 1
        from memory_version_source memory
        cross join lateral (values
          ('facts'::text, memory.memory_document -> 'facts'),
          ('decisions'::text, memory.memory_document -> 'decisions'),
          ('commitments'::text,
            memory.memory_document -> 'commitments'),
          ('preferences'::text,
            memory.memory_document -> 'preferences'),
          ('open_questions'::text,
            memory.memory_document -> 'open_questions'),
          ('schedule_assertions'::text,
            memory.memory_document -> 'schedule_assertions'),
          ('financial_facts'::text,
            memory.memory_document -> 'financial_facts'),
          ('excluded_assumptions'::text,
            memory.memory_document -> 'excluded_assumptions')
        ) fragment(fragment_kind, fragment_array)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(fragment.fragment_array) = 'array'
            then fragment.fragment_array else '[]'::jsonb end
        ) item(value)
        where jsonb_typeof(item.value) <> 'object'
          or jsonb_typeof(item.value -> 'evidence') <> 'array'
          or jsonb_array_length(case
            when jsonb_typeof(item.value -> 'evidence') = 'array'
              then item.value -> 'evidence'
            else '[]'::jsonb end) not between 1 and 8
          or coalesce(char_length(btrim(case fragment.fragment_kind
            when 'open_questions' then item.value ->> 'question'
            when 'excluded_assumptions' then item.value ->> 'assumption'
            else item.value ->> 'statement'
          end)), 0) not between 1 and 1000
      ) or exists (
        select 1
        from memory_version_candidate memory
        where memory.memory_document -> 'contradictions' is not null
          and jsonb_typeof(
            memory.memory_document -> 'contradictions'
          ) <> 'array'
      ) or exists (
        select 1
        from memory_version_source memory
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(
            memory.memory_document -> 'contradictions'
          ) = 'array' then memory.memory_document -> 'contradictions'
            else '[]'::jsonb end
        ) contradiction(value)
        where jsonb_typeof(contradiction.value) <> 'object'
          or coalesce(char_length(btrim(
            contradiction.value ->> 'topic'
          )), 0) not between 1 and 300
          or jsonb_typeof(
            contradiction.value -> 'competing_claims'
          ) <> 'array'
          or exists (
            select 1
            from jsonb_array_elements(case when jsonb_typeof(
              contradiction.value -> 'competing_claims'
            ) = 'array' then
              contradiction.value -> 'competing_claims'
            else '[]'::jsonb end) claim(value)
            where jsonb_typeof(claim.value) <> 'object'
              or coalesce(char_length(btrim(
                claim.value ->> 'statement'
              )), 0) not between 1 and 1000
              or jsonb_typeof(claim.value -> 'evidence') <> 'array'
              or jsonb_array_length(case when jsonb_typeof(
                claim.value -> 'evidence'
              ) = 'array' then claim.value -> 'evidence'
                else '[]'::jsonb end) not between 1 and 8
          )
      )
    ) as invalid
  ), memory_fragment as materialized (
    select 'job_history_match:memory:' || memory.memory_id::text || ':' ||
             fragment.fragment_kind || ':' || item.ordinality::text
             as source_id,
           memory.job_kind,
           memory.job_id,
           memory.opportunity_id,
           memory.conversation_id,
           memory.memory_id,
           memory.created_at,
           fragment.fragment_kind,
           null::text as topic,
           btrim(case fragment.fragment_kind
             when 'open_questions' then item.value ->> 'question'
             when 'excluded_assumptions' then item.value ->> 'assumption'
             else item.value ->> 'statement'
           end) as statement,
           item.value -> 'evidence' as evidence_links
    from memory_version_source memory
    cross join lateral (values
      ('facts'::text, memory.memory_document -> 'facts'),
      ('decisions'::text, memory.memory_document -> 'decisions'),
      ('commitments'::text, memory.memory_document -> 'commitments'),
      ('preferences'::text, memory.memory_document -> 'preferences'),
      ('open_questions'::text, memory.memory_document -> 'open_questions'),
      ('schedule_assertions'::text,
        memory.memory_document -> 'schedule_assertions'),
      ('financial_facts'::text,
        memory.memory_document -> 'financial_facts'),
      ('excluded_assumptions'::text,
        memory.memory_document -> 'excluded_assumptions')
    ) fragment(fragment_kind, fragment_array)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(fragment.fragment_array) = 'array'
        then fragment.fragment_array else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
    where jsonb_typeof(item.value) = 'object'
      and jsonb_typeof(item.value -> 'evidence') = 'array'
      and jsonb_array_length(item.value -> 'evidence') between 1 and 8
      and char_length(btrim(case fragment.fragment_kind
        when 'open_questions' then item.value ->> 'question'
        when 'excluded_assumptions' then item.value ->> 'assumption'
        else item.value ->> 'statement'
      end)) between 1 and 1000

    union all

    select 'job_history_match:memory:' || memory.memory_id::text ||
             ':contradictions:' || contradiction.ordinality::text || ':' ||
             claim.ordinality::text,
           memory.job_kind,
           memory.job_id,
           memory.opportunity_id,
           memory.conversation_id,
           memory.memory_id,
           memory.created_at,
           'contradictions',
           btrim(contradiction.value ->> 'topic'),
           btrim(claim.value ->> 'statement'),
           claim.value -> 'evidence'
    from memory_version_source memory
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(
        memory.memory_document -> 'contradictions'
      ) = 'array' then memory.memory_document -> 'contradictions'
        else '[]'::jsonb end
    ) with ordinality contradiction(value, ordinality)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(
        contradiction.value -> 'competing_claims'
      ) = 'array' then contradiction.value -> 'competing_claims'
        else '[]'::jsonb end
    ) with ordinality claim(value, ordinality)
    where jsonb_typeof(contradiction.value) = 'object'
      and jsonb_typeof(claim.value) = 'object'
      and char_length(btrim(contradiction.value ->> 'topic')) between 1 and 300
      and char_length(btrim(claim.value ->> 'statement')) between 1 and 1000
      and jsonb_typeof(claim.value -> 'evidence') = 'array'
      and jsonb_array_length(claim.value -> 'evidence') between 1 and 8
  ), memory_evidence_link as materialized (
    select memory.source_id,
           link.ordinality,
           link.value ->> 'evidence_id' as evidence_id,
           jsonb_typeof(link.value) = 'object'
             and link.value - array['evidence_id', 'relationship'] = '{}'::jsonb
             and link.value ->> 'evidence_id' ~
               '^job_conversation_turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             and link.value ->> 'relationship' in (
               'supports', 'contradicts', 'supersedes'
             )
             and turn.id is not null
             and turn.delivered_at is not null
             and turn.delivered_at <= v_read_as_of
             and case when turn.id is not null then
               private.user_can_view_inbox_connection(
                 p_actor_user_id,
                 p_company_id,
                 turn.source_connection_id,
                 memory.opportunity_id
               )
             else false end as valid
    from memory_fragment memory
    cross join lateral jsonb_array_elements(memory.evidence_links)
      with ordinality link(value, ordinality)
    left join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = memory.conversation_id
     and turn.id = case when link.value ->> 'evidence_id' ~
       '^job_conversation_turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then substring(
         link.value ->> 'evidence_id'
         from char_length('job_conversation_turn:') + 1
       )::uuid else null end
  ), memory_evidence_state as materialized (
    select link.source_id,
           count(*) between 1 and 8
             and count(distinct link.evidence_id) = count(*)
             and bool_and(link.valid) as valid
    from memory_evidence_link link
    group by link.source_id
  ), memory_source_data_invalid as materialized (
    select (
      (select invalid from memory_document_state)
      or (select invalid from memory_fragment_shape_state)
      or (select invalid from conversation_anchor_state)
      or exists (
        select 1 from memory_evidence_state state where not state.valid
      )
    ) as invalid
  ), memory_evidence_selector as materialized (
    select selector.source_id,
           jsonb_agg(
             selector.evidence_id order by selector.evidence_id collate "C"
           ) as correspondence_evidence_ids
    from (
      select distinct link.source_id, link.evidence_id
      from memory_evidence_link link
      join memory_evidence_state state using (source_id)
      where state.valid
    ) selector
    group by selector.source_id
    having count(*) between 1 and 8
  ), memory_source_candidate as materialized (
    select 'current_memory_summary'::text as source_type,
           'derived_summary'::text as truth_kind,
           'model_transcribed_summary'::text as content_kind,
           memory.source_id,
           memory.job_kind,
           memory.job_id,
           memory.conversation_id,
           memory.created_at as occurred_at,
           memory.statement as excerpt,
           false as excerpt_truncated,
           least(1000000::bigint, greatest(0::bigint,
             round(ts_rank_cd(to_tsvector('simple',
               concat_ws(' ', memory.topic, memory.statement)
             ), v_query) * 1000000)::bigint
           )) as rank_micros,
           'evidence:job_history_event_projection:' || memory.source_id
             as evidence_id,
           selector.correspondence_evidence_ids,
           jsonb_strip_nulls(jsonb_build_object(
             'fragment_kind', memory.fragment_kind,
             'topic', memory.topic,
             'statement', memory.statement
           )) as memory_fragment
    from memory_fragment memory
    join memory_evidence_selector selector using (source_id)
    where to_tsvector(
      'simple', concat_ws(' ', memory.topic, memory.statement)
    ) @@ v_query
    order by rank_micros desc, memory.created_at desc,
      memory.source_id desc
    limit 501
  ), status_event_source as materialized (
    select job.job_kind,
           job.job_id,
           transition.transitioned_at as occurred_at,
           'job_history_match:stage:' || transition.id::text as source_id,
           concat_ws(' ', transition.from_stage, transition.to_stage)
             as searchable_text,
           'stage_transition:' || transition.id::text as evidence_id
    from scope_job job
    join public.stage_transitions transition
      on job.job_kind = 'opportunity'
     and transition.company_id = p_company_id
     and transition.opportunity_id = job.job_id

    union all

    select job.job_kind,
           job.job_id,
           status_event.requested_at,
           'job_history_match:project_status:' || status_event.id::text,
           concat_ws(' ', status_event.old_status, status_event.new_status),
           'project_status_event:' || status_event.id::text
    from scope_job job
    join public.project_status_lifecycle_outbox status_event
      on job.job_kind = 'project'
     and status_event.company_id = p_company_id
     and status_event.project_id = job.job_id
  ), status_source_candidate as materialized (
    select 'job_status_event'::text as source_type,
           'immutable_event'::text as truth_kind,
           'untrusted_business_data'::text as content_kind,
           status.source_id,
           status.job_kind,
           status.job_id,
           null::uuid as conversation_id,
           status.occurred_at,
           left(status.searchable_text, 2000) as excerpt,
           char_length(status.searchable_text) > 2000 as excerpt_truncated,
           least(1000000::bigint, greatest(0::bigint,
             round(ts_rank_cd(to_tsvector('simple', status.searchable_text),
               v_query) * 1000000)::bigint
           )) as rank_micros,
           'evidence:job_history_event_projection:' || status.source_id
             as evidence_id,
           '[]'::jsonb as correspondence_evidence_ids,
           null::jsonb as memory_fragment
    from status_event_source status
    where 'job_status_event' = any(p_source_types)
      and status.occurred_at >= v_effective_from
      and status.occurred_at < v_effective_to_exclusive
      and status.occurred_at <= v_read_as_of
      and to_tsvector('simple', status.searchable_text) @@ v_query
    order by rank_micros desc, status.occurred_at desc, status.source_id desc
    limit 501
  ), task_event_source as materialized (
    select job.job_kind,
           job.job_id,
           task_event.id,
           task_event.created_at,
           task_event.event_type,
           task_event.after_snapshot,
           row_number() over (
             partition by task_event.id
             order by case job.job_kind
               when 'project' then 1 else 2 end,
               job.job_id::text collate "C"
           ) as anchor_rank
    from scope_job job
    join public.task_mutation_events task_event
      on task_event.company_id = p_company_id
     and task_event.project_id = job.project_id
    where 'task_event' = any(p_source_types)
      and job.project_id is not null
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        job.project_id,
        'view'
      )
  ), oversized_task_source as materialized (
    select true as exceeded
    from task_event_source task_event
    where task_event.anchor_rank = 1
      and task_event.event_type in (
        'task_assigned', 'task_completed', 'schedule_change'
      )
      and task_event.created_at >= v_effective_from
      and task_event.created_at < v_effective_to_exclusive
      and task_event.created_at <= v_read_as_of
      and octet_length(concat_ws(' ',
        task_event.event_type,
        task_event.after_snapshot ->> 'status',
        task_event.after_snapshot ->> 'custom_title'
      )) > 65536
    limit 1
  ), task_source_candidate as materialized (
    select 'task_event'::text as source_type,
           'immutable_event'::text as truth_kind,
           'untrusted_business_data'::text as content_kind,
           'job_history_match:task:' || task_event.id::text as source_id,
           task_event.job_kind,
           task_event.job_id,
           null::uuid as conversation_id,
           task_event.created_at as occurred_at,
           left(concat_ws(' ', task_event.event_type,
             task_event.after_snapshot ->> 'status',
             task_event.after_snapshot ->> 'custom_title'), 2000) as excerpt,
           char_length(concat_ws(' ', task_event.event_type,
             task_event.after_snapshot ->> 'status',
             task_event.after_snapshot ->> 'custom_title')) > 2000
             as excerpt_truncated,
           least(1000000::bigint, greatest(0::bigint,
             round(ts_rank_cd(to_tsvector('simple', case when octet_length(
               concat_ws(' ',
                 task_event.event_type,
                 task_event.after_snapshot ->> 'status',
                 task_event.after_snapshot ->> 'custom_title'
               )
             ) <= 65536 then concat_ws(' ',
               task_event.event_type,
               task_event.after_snapshot ->> 'status',
               task_event.after_snapshot ->> 'custom_title'
             ) else '' end), v_query) * 1000000)::bigint
           )) as rank_micros,
           'evidence:job_history_event_projection:' ||
             'job_history_match:task:' || task_event.id::text as evidence_id,
           '[]'::jsonb as correspondence_evidence_ids,
           null::jsonb as memory_fragment
    from task_event_source task_event
    where task_event.anchor_rank = 1
      and task_event.event_type in (
        'task_assigned', 'task_completed', 'schedule_change'
      )
      and task_event.created_at >= v_effective_from
      and task_event.created_at < v_effective_to_exclusive
      and task_event.created_at <= v_read_as_of
      and octet_length(concat_ws(' ',
        task_event.event_type,
        task_event.after_snapshot ->> 'status',
        task_event.after_snapshot ->> 'custom_title'
      )) <= 65536
      and to_tsvector('simple', case when octet_length(concat_ws(' ',
        task_event.event_type,
        task_event.after_snapshot ->> 'status',
        task_event.after_snapshot ->> 'custom_title'
      )) <= 65536 then concat_ws(' ',
        task_event.event_type,
        task_event.after_snapshot ->> 'status',
        task_event.after_snapshot ->> 'custom_title'
      ) else '' end) @@ v_query
    order by rank_micros desc, task_event.created_at desc, task_event.id desc
    limit 501
  ), estimate_job_source as materialized (
    select job.job_kind,
           job.job_id,
           estimate.*,
           row_number() over (
             partition by estimate.id
             order by case job.job_kind
               when 'project' then 1 else 2 end,
               job.job_id::text collate "C"
           ) as anchor_rank
    from scope_job job
    join public.estimates estimate
      on estimate.company_id = p_company_id
     and estimate.deleted_at is null
     and (
       (job.job_kind = 'opportunity'
         and estimate.opportunity_id = job.job_id)
       or (job.job_kind = 'project'
         and estimate.project_id = job.job_id)
     )
    where 'estimate_document' = any(p_source_types)
      and (job.job_kind <> 'project'
        or p_projects_financials_scope = 'all')
      and estimate.updated_at >= v_effective_from
      and estimate.updated_at < v_effective_to_exclusive
      and estimate.updated_at <= v_read_as_of
  ), history_currency_state as materialized (
    select context.currency_code,
           private.agent_currency_minor_exponent_or_null(
             context.currency_code
           ) as minor_exponent
    from authority_context context
  ), estimate_source_state as materialized (
    select coalesce(bool_or(
             currency.minor_exponent is null
             or estimate.total is null
             or estimate.total::text in ('NaN', 'Infinity', '-Infinity')
             or trunc(estimate.total::numeric * power(
                  10::numeric, currency.minor_exponent
                )) is distinct from estimate.total::numeric * power(
                  10::numeric, currency.minor_exponent
                )
             or abs(estimate.total::numeric * power(
                  10::numeric, currency.minor_exponent
                )) > 9007199254740991::numeric
             or estimate.version is null
             or estimate.version not between 0 and 9007199254740991
           ), false) as invalid
    from estimate_job_source estimate
    cross join history_currency_state currency
  ), estimate_valid_source as materialized (
    select estimate.*,
           currency.currency_code,
           private.agent_money_to_minor_units(
             estimate.total,
             currency.currency_code
           ) as total_minor
    from estimate_job_source estimate
    cross join history_currency_state currency
    cross join estimate_source_state state
    where not state.invalid
  ), oversized_estimate_source as materialized (
    select true as exceeded
    from estimate_job_source estimate
    where estimate.anchor_rank = 1
      and octet_length(
        coalesce(estimate.estimate_number, '') || ' ' ||
        coalesce(estimate.title, '') || ' ' ||
        coalesce(estimate.client_message, '') || ' ' ||
        coalesce(estimate.terms, '') || ' ' ||
        coalesce(estimate.status, '')
      ) > 524288
    limit 1
  ), estimate_source_candidate as materialized (
    select 'estimate_document'::text as source_type,
           'current_snapshot'::text as truth_kind,
           'untrusted_business_data'::text as content_kind,
           'job_history_match:estimate:' || estimate.id::text as source_id,
           estimate.job_kind,
           estimate.job_id,
           null::uuid as conversation_id,
           estimate.updated_at as occurred_at,
           left(concat_ws(' ',
             estimate.estimate_number,
             estimate.title,
             estimate.client_message,
             estimate.terms,
             estimate.status,
             estimate.total_minor::text,
             estimate.issue_date::text,
             estimate.updated_at::text,
             estimate.version::text
           ), 2000) as excerpt,
           char_length(concat_ws(' ',
             estimate.estimate_number,
             estimate.title,
             estimate.client_message,
             estimate.terms,
             estimate.status,
             estimate.total_minor::text,
             estimate.issue_date::text,
             estimate.updated_at::text,
             estimate.version::text
           )) > 2000 as excerpt_truncated,
           least(1000000::bigint, greatest(0::bigint,
             round(ts_rank_cd(to_tsvector('simple', concat_ws(' ',
               estimate.estimate_number,
               estimate.title,
               estimate.client_message,
               estimate.terms,
               estimate.status
             )), v_query) * 1000000)::bigint
           )) as rank_micros,
           'evidence:job_history_event_projection:' ||
             'job_history_match:estimate:' || estimate.id::text as evidence_id,
           '[]'::jsonb as correspondence_evidence_ids,
           null::jsonb as memory_fragment
    from estimate_valid_source estimate
    where estimate.anchor_rank = 1
      and octet_length(
        coalesce(estimate.estimate_number, '') || ' ' ||
        coalesce(estimate.title, '') || ' ' ||
        coalesce(estimate.client_message, '') || ' ' ||
        coalesce(estimate.terms, '') || ' ' ||
        coalesce(estimate.status, '')
      ) <= 524288
      and to_tsvector(
        'simple',
        case when octet_length(
          coalesce(estimate.estimate_number, '') || ' ' ||
          coalesce(estimate.title, '') || ' ' ||
          coalesce(estimate.client_message, '') || ' ' ||
          coalesce(estimate.terms, '') || ' ' ||
          coalesce(estimate.status, '')
        ) <= 524288 then
          coalesce(estimate.estimate_number, '') || ' ' ||
          coalesce(estimate.title, '') || ' ' ||
          coalesce(estimate.client_message, '') || ' ' ||
          coalesce(estimate.terms, '') || ' ' ||
          coalesce(estimate.status, '')
        else '' end
      ) @@ v_query
    order by rank_micros desc, estimate.updated_at desc, estimate.id desc
    limit 501
  ), source_data_invalid as materialized (
    select memory.invalid or estimate.invalid as invalid
    from memory_source_data_invalid memory
    cross join estimate_source_state estimate
  ), all_source_candidate as materialized (
    select delivered.* from delivered_source_candidate delivered
    union all select memory.* from memory_source_candidate memory
    union all select status.* from status_source_candidate status
    union all select task.* from task_source_candidate task
    union all select estimate.* from estimate_source_candidate estimate
  ), source_ranked as materialized (
    select candidate.*,
           row_number() over (
             partition by candidate.source_type
             order by candidate.rank_micros desc,
               candidate.occurred_at desc,
               candidate.source_id desc
           ) as source_candidate_rank
    from all_source_candidate candidate
  ), source_query_bound as materialized (
    select (
      exists(
        select 1 from source_ranked candidate
        where candidate.source_candidate_rank > 500
      )
      or exists(select 1 from oversized_delivered_source)
      or exists(select 1 from oversized_task_source)
      or exists(select 1 from oversized_estimate_source)
      or (select query_bound from memory_document_state)
    ) as exceeded
  ), source_bounded as materialized (
    select candidate.*
    from source_ranked candidate
    where source_candidate_rank <= 500
  ), union_plus_one as materialized (
    select candidate.*
    from source_bounded candidate
    order by candidate.rank_micros desc, candidate.occurred_at desc,
      candidate.source_type, candidate.source_id desc
    limit 2001
  ), total_ranked as materialized (
    select candidate.*,
           row_number() over (
             order by candidate.rank_micros desc,
               candidate.occurred_at desc,
               candidate.source_type,
               candidate.source_id desc
           ) as total_candidate_rank
    from union_plus_one candidate
  ), total_query_bound as materialized (
    select exists(
      select 1 from total_ranked candidate
      where candidate.total_candidate_rank > 2000
    ) as exceeded
  ), total_bounded as materialized (
    select candidate.*
    from total_ranked candidate
    where total_candidate_rank <= 2000
      and (
        p_cursor_rank_micros is null
        or candidate.rank_micros < p_cursor_rank_micros
        or candidate.rank_micros = p_cursor_rank_micros
           and candidate.occurred_at < p_cursor_occurred_at
        or candidate.rank_micros = p_cursor_rank_micros
           and candidate.occurred_at = p_cursor_occurred_at
           and candidate.source_type > p_cursor_source_type
        or candidate.rank_micros = p_cursor_rank_micros
           and candidate.occurred_at = p_cursor_occurred_at
           and candidate.source_type = p_cursor_source_type
           and candidate.source_id < p_cursor_source_id
      )
  ), page_plus_one as materialized (
    select candidate.*
    from total_bounded candidate
    order by candidate.rank_micros desc, candidate.occurred_at desc,
      candidate.source_type, candidate.source_id desc
    limit 21
  ), retained_page as materialized (
    select page.*
    from page_plus_one page
    order by page.rank_micros desc, page.occurred_at desc,
      page.source_type, page.source_id desc
    limit p_limit
  ), page_state as materialized (
    select (select count(*) from page_plus_one) > p_limit as has_more,
           case when (select count(*) from page_plus_one) > p_limit then (
             select jsonb_build_object(
               'source_revision', context.source_revision,
               'history_revision', context.history_revision,
               'read_as_of', private.agent_rfc3339_utc(v_read_as_of),
               'rank_micros', last_event.rank_micros,
               'occurred_at',
                 private.agent_rfc3339_utc(last_event.occurred_at),
               'source_type', last_event.source_type,
               'source_id', last_event.source_id
             )
             from retained_page last_event
             order by last_event.rank_micros,
               last_event.occurred_at,
               last_event.source_type desc,
               last_event.source_id
             limit 1
           ) else null end as next_cursor_claims
    from authority_context context
  ), raw_event as materialized (
    select retained.*,
           jsonb_build_object(
             'match_ref', retained.source_id,
             'job_ref', jsonb_build_object(
               'kind', retained.job_kind, 'id', retained.job_id
             ),
             'conversation_id', retained.conversation_id,
             'source_type', retained.source_type,
             'truth_kind', retained.truth_kind,
             'occurred_at', private.agent_rfc3339_utc(retained.occurred_at),
             'excerpt', retained.excerpt,
             'content_kind', retained.content_kind,
             'excerpt_truncated', retained.excerpt_truncated,
             'relevance', jsonb_build_object(
               'ranking_revision', 'job-history-ranking:v1',
               'score_millionths', retained.rank_micros,
               'reason_codes', case
                 when retained.source_type = 'current_memory_summary'
                  and retained.memory_fragment ->> 'fragment_kind' =
                    'contradictions'
                   then jsonb_build_array(
                     'QUERY_TOKEN_MATCH', 'CONTRADICTS_MEMORY_CLAIM'
                   )
                 else jsonb_build_array('QUERY_TOKEN_MATCH') end
             ),
             'evidence_ids', jsonb_build_array(retained.evidence_id),
             'correspondence_evidence_ids',
               retained.correspondence_evidence_ids
           ) || case
             when retained.source_type = 'current_memory_summary'
               then jsonb_build_object(
                 'memory_fragment', retained.memory_fragment
               )
             else '{}'::jsonb end as raw
    from retained_page retained
    join history_source_contract contract
      on contract.contract ->> 'source_type' = retained.source_type
     and contract.contract ->> 'truth_kind' = retained.truth_kind
     and contract.contract ->> 'content_kind' = retained.content_kind
  ), event_projection as materialized (
    select event.*,
           context.source_revision,
           context.history_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', '[]'::jsonb,
             'event', event.raw
           ) as projection
    from raw_event event
    cross join authority_context context
    cross join canonical_request request
  ), event_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from event_projection projection
  ), event_claim as materialized (
    select event.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'job_history_event_projection',
             'source_id', event.source_id,
             'version', 'job-history-event-projection:v1:' ||
               event.source_content_hash
           ) as source_version
    from event_hashed event
  ), envelope_projection as materialized (
    select context.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(event.source_version order by
                 event.rank_micros desc, event.occurred_at desc,
                 event.source_type, event.source_id desc)
               from event_claim event
             ), '[]'::jsonb),
             'collection', jsonb_build_object(
               'scope', request.canonical_input -> 'scope',
               'effective_window', jsonb_build_object(
                 'from', private.agent_rfc3339_utc(v_effective_from),
                 'to_exclusive',
                   private.agent_rfc3339_utc(v_effective_to_exclusive)
               ),
               'returned_event_count', (select count(*) from event_claim),
               'has_more', page.has_more,
               'next_cursor_claims', page.next_cursor_claims,
               'gaps', case
                 when (source_bound.exceeded or total_bound.exceeded)
                    and invalid_state.invalid
                   then jsonb_build_array(
                     'SOURCE_QUERY_BOUND', 'SOURCE_DATA_INVALID'
                   )
                 when source_bound.exceeded or total_bound.exceeded
                   then jsonb_build_array('SOURCE_QUERY_BOUND')
                 when invalid_state.invalid
                   then jsonb_build_array('SOURCE_DATA_INVALID')
                 else '[]'::jsonb end
             )
           ) as projection
    from authority_context context
    cross join canonical_request request
    cross join page_state page
    cross join source_query_bound source_bound
    cross join total_query_bound total_bound
    cross join source_data_invalid invalid_state
    cross join scope_anchor_state anchor_state
    where not anchor_state.conflict
      and (
        p_scope_kind = 'customer'
          and (select count(*) from requested_customer) = 1
        or p_scope_kind = 'jobs'
          and (select count(*) from scope_job) = jsonb_array_length(p_job_refs)
      )
  ), envelope_hashed as materialized (
    select envelope.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(envelope.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from envelope_projection envelope
  ), final_result as materialized (
    select jsonb_build_object(
      'company_id', p_company_id,
      'permission_snapshot_revision', p_permission_snapshot_revision,
      'read_at', private.agent_rfc3339_utc(v_read_as_of),
      'source_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || envelope.source_revision::text
      ),
      'history_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'job_history_read_revision',
        'source_id', 'private.agent_job_history_revisions',
        'version', 'revision:' || envelope.history_revision::text
      ),
      'event_claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'raw', event.raw,
          'proof', jsonb_build_object(
            'source_version', event.source_version,
            'source_content_hash', event.source_content_hash,
            'evidence_id', event.evidence_id,
            'projection', event.projection
          ),
          'source_version', event.source_version,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_id', event.evidence_id,
            'source_domain', 'operations',
            'source_type', event.source_version ->> 'source_type',
            'source_id', event.source_version ->> 'source_id',
            'version', event.source_version ->> 'version',
            'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
            'relationship', 'supports',
            'trust', case event.source_type
              when 'delivered_correspondence' then 'delivered_correspondence'
              when 'current_memory_summary' then 'model_transcribed'
              else 'authoritative_ops' end,
            'locator', 'ops://evidence/' || replace(event.evidence_id, ':', '%3A')
          ))
        ) order by event.rank_micros desc, event.occurred_at desc,
          event.source_type, event.source_id desc)
        from event_claim event
      ), '[]'::jsonb),
      'returned_event_count', (select count(*) from event_claim),
      'has_more', page.has_more,
      'next_cursor_claims', page.next_cursor_claims,
      'gaps', case
        when (source_bound.exceeded or total_bound.exceeded)
           and invalid_state.invalid
          then jsonb_build_array(
            'SOURCE_QUERY_BOUND', 'SOURCE_DATA_INVALID'
          )
        when source_bound.exceeded or total_bound.exceeded
          then jsonb_build_array('SOURCE_QUERY_BOUND')
        when invalid_state.invalid
          then jsonb_build_array('SOURCE_DATA_INVALID')
        else '[]'::jsonb end,
      'collection_claim', jsonb_build_object(
        'raw', envelope.projection -> 'collection',
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'job_history_collection_projection',
            'source_id', p_scope_kind || ':' || p_company_id::text,
            'version', 'job-history-collection-projection:v1:' ||
              envelope.source_content_hash
          ),
          'source_content_hash', envelope.source_content_hash,
          'evidence_id', 'evidence:job_history_collection_projection:' ||
            p_scope_kind || ':' || p_company_id::text,
          'projection', envelope.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'job_history_collection_projection',
          'source_id', p_scope_kind || ':' || p_company_id::text,
          'version', 'job-history-collection-projection:v1:' ||
            envelope.source_content_hash
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', 'evidence:job_history_collection_projection:' ||
            p_scope_kind || ':' || p_company_id::text,
          'source_domain', 'operations',
          'source_type', 'job_history_collection_projection',
          'source_id', p_scope_kind || ':' || p_company_id::text,
          'version', 'job-history-collection-projection:v1:' ||
            envelope.source_content_hash,
          'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://evidence/' || replace(
            'evidence:job_history_collection_projection:' ||
              p_scope_kind || ':' || p_company_id::text,
            ':',
            '%3A'
          )
        ))
      ),
      'prompt_reduction', jsonb_build_object(
        'max_output_characters', 60000,
        'atomic_claim_kind', 'job_history_event',
        'retention', 'maximal_ordered_prefix',
        'claim_path', 'event_claims',
        'envelope_claim_path', 'collection_claim'
      )
    ) as result
    from envelope_hashed envelope
    cross join page_state page
    cross join source_query_bound source_bound
    cross join total_query_bound total_bound
    cross join source_data_invalid invalid_state
  )
  select final.result, source_bound.exceeded, total_bound.exceeded
  into v_result, v_source_query_bound, v_total_query_bound
  from final_result final
  cross join source_query_bound source_bound
  cross join total_query_bound total_bound;

  if v_result is null then
    if p_cursor_source_revision is not null then
      raise exception 'agent_job_history_cursor_stale'
        using errcode = '40001';
    end if;
    raise exception 'agent_job_history_scope_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_job_history_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_job_history_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_history_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) to service_role;

commit;
