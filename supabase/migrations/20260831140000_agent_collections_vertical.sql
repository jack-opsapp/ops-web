-- Inactive OPS MCP collections vertical.
--
-- This migration defines private prepare and approval ledgers for the inactive
-- v4 exposure. Preparation creates immutable OPS queue drafts. Approval marks
-- only the exact draft as approved inside OPS. Neither path sends a message,
-- moves money, nor issues a financial document.

begin;

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.agent_actions',
    'public.clients',
    'public.companies',
    'public.notifications',
    'public.sub_clients',
    'private.agent_mcp_rate_limit_buckets',
    'private.agent_provider_delivery_sources',
    'private.mcp_request_audit',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_collections_prerequisite_missing: %', v_relation
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_mcp_rate_limit_bucket_digest(text,uuid,uuid,uuid,text,text,timestamp with time zone)',
    'private.prune_agent_mcp_rate_limit_buckets(integer)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_collections_prerequisite_missing: %', v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

create table private.agent_collections_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null check (
    capability_manifest_revision = '2026-08-31.capability-manifest.v10'
  ),
  exposure_revision text not null check (
    exposure_revision = '2026-08-31.mcp-exposure.v4'
  ),
  schema_revision text not null check (
    schema_revision = '2026-08-31.v1'
  ),
  metric_definition_revision text not null check (
    metric_definition_revision = 'collections-aging:2026-08-31.v1'
  ),
  as_of_date date not null,
  timezone text not null,
  idempotency_key text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('clear', 'attention')),
  result_snapshot jsonb not null,
  prepared_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, id),
  unique (company_id, actor_user_id, oauth_client_id, idempotency_key),
  constraint agent_collections_runs_idempotency_bounded check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  )
);

create table private.agent_collections_change_sets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null check (
    capability_manifest_revision = '2026-08-31.capability-manifest.v10'
  ),
  exposure_revision text not null check (
    exposure_revision = '2026-08-31.mcp-exposure.v4'
  ),
  customer_id uuid not null references public.clients(id),
  prepare_capability text not null check (
    prepare_capability = 'prepare_collections'
  ),
  commit_capability text not null check (
    commit_capability = 'commit_collections_draft'
  ),
  payload jsonb not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, id),
  unique (run_id, customer_id),
  foreign key (company_id, run_id)
    references private.agent_collections_runs(company_id, id)
    on delete cascade,
  constraint agent_collections_change_sets_decision_exclusive check (
    not (consumed_at is not null and rejected_at is not null)
  ),
  constraint agent_collections_change_sets_expiry_valid check (
    expires_at > created_at
    and expires_at <= created_at + interval '3 days 5 minutes'
  )
);

create table private.agent_collections_confirmations (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.agent_actions(id),
  change_set_id uuid not null,
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  capability_manifest_revision text not null check (
    capability_manifest_revision = '2026-08-31.capability-manifest.v10'
  ),
  exposure_revision text not null check (
    exposure_revision = '2026-08-31.mcp-exposure.v4'
  ),
  commit_capability text not null check (
    commit_capability = 'commit_collections_draft'
  ),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  confirmed_at timestamptz not null default statement_timestamp(),
  consumed_at timestamptz not null,
  unique (company_id, change_set_id),
  foreign key (company_id, change_set_id)
    references private.agent_collections_change_sets(company_id, id)
    on delete restrict
);

create table private.agent_collections_receipts (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null unique
    references private.agent_collections_confirmations(id),
  action_id uuid not null unique references public.agent_actions(id),
  change_set_id uuid not null,
  run_id uuid not null,
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  capability_manifest_revision text not null check (
    capability_manifest_revision = '2026-08-31.capability-manifest.v10'
  ),
  exposure_revision text not null check (
    exposure_revision = '2026-08-31.mcp-exposure.v4'
  ),
  commit_capability text not null check (
    commit_capability = 'commit_collections_draft'
  ),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  committed_at timestamptz not null default statement_timestamp(),
  foreign key (company_id, change_set_id)
    references private.agent_collections_change_sets(company_id, id)
    on delete restrict,
  foreign key (company_id, run_id)
    references private.agent_collections_runs(company_id, id)
    on delete restrict
);

create index agent_collections_runs_grant_idx
  on private.agent_collections_runs (oauth_grant_id);
create index agent_collections_runs_client_idx
  on private.agent_collections_runs (oauth_client_id);
create index agent_collections_change_sets_run_idx
  on private.agent_collections_change_sets (run_id);
create index agent_collections_change_sets_grant_idx
  on private.agent_collections_change_sets (oauth_grant_id);
create index agent_collections_change_sets_client_idx
  on private.agent_collections_change_sets (oauth_client_id);
create index agent_collections_change_sets_customer_idx
  on private.agent_collections_change_sets (customer_id);
create index agent_collections_confirmations_grant_idx
  on private.agent_collections_confirmations (oauth_grant_id);
create index agent_collections_confirmations_client_idx
  on private.agent_collections_confirmations (oauth_client_id);
create index agent_collections_receipts_change_set_idx
  on private.agent_collections_receipts (change_set_id);
create index agent_collections_receipts_run_idx
  on private.agent_collections_receipts (run_id);
create index agent_collections_receipts_grant_idx
  on private.agent_collections_receipts (oauth_grant_id);
create index agent_collections_receipts_client_idx
  on private.agent_collections_receipts (oauth_client_id);

alter table private.agent_collections_runs enable row level security;
alter table private.agent_collections_change_sets enable row level security;
alter table private.agent_collections_confirmations enable row level security;
alter table private.agent_collections_receipts enable row level security;

revoke all on table private.agent_collections_runs
  from public, anon, authenticated, service_role;
revoke all on table private.agent_collections_change_sets
  from public, anon, authenticated, service_role;
revoke all on table private.agent_collections_confirmations
  from public, anon, authenticated, service_role;
revoke all on table private.agent_collections_receipts
  from public, anon, authenticated, service_role;

alter table private.agent_mcp_rate_limit_buckets
  drop constraint agent_mcp_rate_limit_buckets_policy_closed;
alter table private.agent_mcp_rate_limit_buckets
  add constraint agent_mcp_rate_limit_buckets_policy_closed check (
    policy_id in (
      'mcp-lightweight-read:2026-08-23.v1',
      'mcp-evidence-search:2026-08-23.v1',
      'mcp-day-closeout-prepare:2026-08-30.v1',
      'mcp-collections-prepare:2026-08-31.v1'
    )
  );

create or replace function private.assert_agent_collections_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'clients.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    jsonb_build_object('permission', 'reports.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.financial_documents.read',
    'ops.operations.prepare',
    'ops.operations.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-31.capability-manifest.v10'
     or p_exposure_revision is distinct from
       '2026-08-31.mcp-exposure.v4' then
    raise exception 'AGENT_COLLECTIONS_REVISION_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array['clients.view', 'email.view', 'invoices.view', 'reports.view']
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or (
       p_permission_snapshot_revision is not null
       and v_permission_snapshot_revision is distinct from
         p_permission_snapshot_revision
     ) then
    raise exception 'AGENT_COLLECTIONS_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = '2026-08-31.mcp-exposure.v4'
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_COLLECTIONS_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_collections_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.resolve_agent_collections_timezone_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_timezone text;
begin
  perform private.assert_agent_collections_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision
  );
  select company.timezone into v_timezone
  from public.companies company
  where company.id = p_company_id and company.deleted_at is null;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = v_timezone
  ) then
    raise exception 'AGENT_COLLECTIONS_TIMEZONE_UNAVAILABLE'
      using errcode = '55000';
  end if;
  return v_timezone;
end;
$function$;

create or replace function public.inspect_agent_collections_correspondence_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_recipients jsonb,
  p_end_at timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  recipient jsonb;
  v_result jsonb := '[]'::jsonb;
  v_total integer;
  v_readable integer;
  v_unreadable integer;
  v_shared_count integer;
  v_latest_direction text;
  v_latest_delivered_at timestamptz;
  v_coverage_state text;
  v_gate_reason text;
begin
  perform private.assert_agent_collections_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision
  );
  if jsonb_typeof(p_recipients) is distinct from 'array'
     or jsonb_array_length(p_recipients) not between 1 and 25
     or p_end_at is null
     or p_end_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'AGENT_COLLECTIONS_CORRESPONDENCE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  for recipient in
    select value
    from jsonb_array_elements(p_recipients)
    order by value ->> 'customer_id'
  loop
    if jsonb_typeof(recipient) is distinct from 'object'
       or not (recipient ?& array[
         'customer_id', 'contact_kind', 'contact_id',
         'recipient_address', 'start_at'
       ])
       or recipient ->> 'contact_kind' not in ('client', 'sub_client')
       or recipient ->> 'customer_id' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or recipient ->> 'contact_id' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or recipient ->> 'recipient_address' is distinct from
         lower(btrim(recipient ->> 'recipient_address'))
       or recipient ->> 'recipient_address' !~
         '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or (recipient ->> 'start_at')::timestamptz >= p_end_at
       or p_end_at - (recipient ->> 'start_at')::timestamptz >
         interval '10 years' then
      raise exception 'AGENT_COLLECTIONS_RECIPIENT_INPUT_INVALID'
        using errcode = '22023';
    end if;

    if recipient ->> 'contact_kind' = 'client' then
      if not exists (
        select 1 from public.clients client
        where client.id = (recipient ->> 'contact_id')::uuid
          and client.id = (recipient ->> 'customer_id')::uuid
          and client.company_id = p_company_id
          and client.deleted_at is null
          and client.merged_into_client_id is null
          and lower(btrim(client.email)) = recipient ->> 'recipient_address'
      ) then
        raise exception 'AGENT_COLLECTIONS_RECIPIENT_BINDING_INVALID'
          using errcode = '42501';
      end if;
    else
      if not exists (
        select 1 from public.sub_clients sub_client
        join public.clients client on client.id = sub_client.client_id
        where sub_client.id = (recipient ->> 'contact_id')::uuid
          and sub_client.client_id = (recipient ->> 'customer_id')::uuid
          and sub_client.company_id = p_company_id
          and client.company_id = p_company_id
          and sub_client.deleted_at is null
          and client.deleted_at is null
          and client.merged_into_client_id is null
          and lower(btrim(sub_client.email)) =
            recipient ->> 'recipient_address'
      ) then
        raise exception 'AGENT_COLLECTIONS_RECIPIENT_BINDING_INVALID'
          using errcode = '42501';
      end if;
    end if;

    select count(*)::integer into v_shared_count
    from (
      select 'client:' || client.id::text as identity_key
      from public.clients client
      where client.company_id = p_company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and lower(btrim(client.email)) = recipient ->> 'recipient_address'
      union all
      select 'sub_client:' || sub_client.id::text
      from public.sub_clients sub_client
      join public.clients client on client.id = sub_client.client_id
      where sub_client.company_id = p_company_id
        and client.company_id = p_company_id
        and sub_client.deleted_at is null
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and lower(btrim(sub_client.email)) = recipient ->> 'recipient_address'
    ) active_identity;

    select count(*)::integer,
           count(*) filter (
             where source.normalization_status = 'normalized'
               and nullif(btrim(source.normalized_plain_text), '') is not null
               and source.normalization_revision =
                 'ops.correspondence.normalized-text.v2'
           )::integer,
           count(*) filter (
             where source.normalization_status <> 'normalized'
                or nullif(btrim(source.normalized_plain_text), '') is null
                or source.normalization_revision <>
                  'ops.correspondence.normalized-text.v2'
           )::integer
      into v_total, v_readable, v_unreadable
    from private.agent_provider_delivery_sources source
    where source.company_id = p_company_id
      and source.delivered_at >= (recipient ->> 'start_at')::timestamptz
      and source.delivered_at <= p_end_at
      and (
        source.sender_identity = recipient ->> 'recipient_address'
        or recipient ->> 'recipient_address' = any(source.recipient_identities)
        or recipient ->> 'recipient_address' = any(source.cc_recipient_identities)
      );

    select source.direction, source.delivered_at
      into v_latest_direction, v_latest_delivered_at
    from private.agent_provider_delivery_sources source
    where source.company_id = p_company_id
      and source.delivered_at >= (recipient ->> 'start_at')::timestamptz
      and source.delivered_at <= p_end_at
      and (
        source.sender_identity = recipient ->> 'recipient_address'
        or recipient ->> 'recipient_address' = any(source.recipient_identities)
        or recipient ->> 'recipient_address' = any(source.cc_recipient_identities)
      )
    order by source.delivered_at desc, source.id desc
    limit 1;

    v_coverage_state := 'complete';
    v_gate_reason := null;
    if v_shared_count > 1 then
      v_coverage_state := 'unavailable';
      v_gate_reason := 'recipient_shared';
    elsif v_unreadable > 0 then
      v_coverage_state := 'unavailable';
      v_gate_reason := 'correspondence_unavailable';
    elsif v_latest_direction = 'outbound' and
          v_latest_delivered_at > p_end_at - interval '7 days' then
      v_coverage_state := 'unavailable';
      v_gate_reason := 'correspondence_recent_outbound';
    elsif v_latest_direction = 'inbound' and
          v_latest_delivered_at > p_end_at - interval '3 days' then
      v_coverage_state := 'unavailable';
      v_gate_reason := 'correspondence_recent_inbound';
    end if;

    v_result := v_result || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'customer_id', recipient ->> 'customer_id',
        'coverage_state', v_coverage_state,
        'total_count', v_total,
        'readable_count', v_readable,
        'unreadable_count', v_unreadable,
        'latest_direction', v_latest_direction,
        'latest_delivered_at', v_latest_delivered_at,
        'fresh_at', statement_timestamp(),
        'normalization_revision', 'ops.correspondence.normalized-text.v2',
        'gate_reason', v_gate_reason
      ))
    );
  end loop;
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'AGENT_COLLECTIONS_RECIPIENT_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

create or replace function public.persist_agent_collections_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_as_of_date date,
  p_timezone text,
  p_idempotency_key text,
  p_input_hash text,
  p_result_base jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  debtor jsonb;
  v_action_id uuid;
  v_approval_count integer := 0;
  v_change_set_id uuid;
  v_client_name text;
  v_existing private.agent_collections_runs%rowtype;
  v_expires_at timestamptz;
  v_permission_revision text;
  v_preview jsonb;
  v_preview_hash text;
  v_result jsonb;
  v_result_debtors jsonb := '[]'::jsonb;
  v_run_id uuid := gen_random_uuid();
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-31.capability-manifest.v10'
     or p_exposure_revision is distinct from
       '2026-08-31.mcp-exposure.v4'
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or p_input_hash !~ '^[0-9a-f]{64}$'
     or p_as_of_date is null
     or length(p_timezone) not between 1 and 128
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = p_timezone
     )
     or jsonb_typeof(p_result_base) is distinct from 'object'
     or p_result_base ->> 'schema_revision' is distinct from '2026-08-31.v1'
     or p_result_base ->> 'metric_definition_revision' is distinct from
       'collections-aging:2026-08-31.v1'
     or (p_result_base ->> 'as_of_date')::date is distinct from p_as_of_date
     or p_result_base ->> 'timezone' is distinct from p_timezone
     or p_result_base ->> 'state' not in ('clear', 'attention')
     or jsonb_typeof(p_result_base -> 'debtors') is distinct from 'array'
     or jsonb_array_length(p_result_base -> 'debtors') > 25
     or jsonb_typeof(p_result_base -> 'portfolio_balances') is distinct from
       'array'
     or jsonb_typeof(p_result_base -> 'evidence_refs') is distinct from 'array'
     or jsonb_array_length(p_result_base -> 'evidence_refs') > 100
     or p_result_base #>> '{receipt,kind}' is distinct from 'prepared'
     or (p_result_base #>> '{receipt,messages_sent}')::integer is distinct from 0
     or (p_result_base #>> '{receipt,money_moved}')::boolean is distinct from false
     or (p_result_base #>> '{receipt,financial_documents_issued}')::integer
       is distinct from 0 then
    raise exception 'AGENT_COLLECTIONS_PREPARE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  v_permission_revision := private.assert_agent_collections_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision
  );
  select client.client_name into strict v_client_name
  from private.mcp_oauth_clients client
  where client.client_id = p_oauth_client_id;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_actor_user_id::text || ':' ||
    p_oauth_client_id::text || ':' || p_idempotency_key,
    0
  ));
  select * into v_existing
  from private.agent_collections_runs run
  where run.company_id = p_company_id
    and run.actor_user_id = p_actor_user_id
    and run.oauth_client_id = p_oauth_client_id
    and run.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_hash is distinct from p_input_hash then
      raise exception 'AGENT_COLLECTIONS_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'result',
      v_existing.result_snapshot || jsonb_build_object(
        'receipt', (v_existing.result_snapshot -> 'receipt') ||
          jsonb_build_object('replayed', true)
      ),
      'replayed', true
    );
  end if;

  insert into private.agent_collections_runs (
    id, company_id, actor_user_id, oauth_grant_id, oauth_client_id,
    grant_revision, granted_scope_ceiling, permission_snapshot_revision,
    capability_manifest_revision, exposure_revision, schema_revision,
    metric_definition_revision, as_of_date, timezone, idempotency_key,
    input_hash, state, result_snapshot
  ) values (
    v_run_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
    p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
    v_permission_revision, p_capability_manifest_revision,
    p_exposure_revision, '2026-08-31.v1',
    'collections-aging:2026-08-31.v1', p_as_of_date, p_timezone,
    p_idempotency_key, p_input_hash, p_result_base ->> 'state', p_result_base
  );

  for debtor in select value from jsonb_array_elements(p_result_base -> 'debtors')
  loop
    if jsonb_typeof(debtor) is distinct from 'object'
       or debtor #>> '{customer_ref,kind}' is distinct from 'client'
       or debtor #>> '{customer_ref,id}' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or debtor #>> '{draft,kind}' not in ('prepared', 'blocked') then
      raise exception 'AGENT_COLLECTIONS_DEBTOR_INVALID'
        using errcode = '22023';
    end if;
    continue when debtor #>> '{draft,kind}' = 'blocked';

    v_preview := debtor #> '{draft,preview}';
    if jsonb_typeof(v_preview) is distinct from 'object'
       or v_preview #>> '{customer_ref,id}' is distinct from
         debtor #>> '{customer_ref,id}'
       or v_preview ->> 'truth_boundary' is distinct from
         'Draft approved inside OPS only. No message sent. No money moved. No financial document issued.' then
      raise exception 'AGENT_COLLECTIONS_PREVIEW_INVALID'
        using errcode = '22023';
    end if;
    v_preview_hash := encode(
      extensions.digest(convert_to(v_preview::text, 'UTF8'), 'sha256'),
      'hex'
    );
    v_expires_at := statement_timestamp() + interval '3 days';
    insert into private.agent_collections_change_sets (
      run_id, company_id, actor_user_id, oauth_grant_id, oauth_client_id,
      grant_revision, granted_scope_ceiling, permission_snapshot_revision,
      capability_manifest_revision, exposure_revision, customer_id,
      prepare_capability, commit_capability, payload, preview_hash, expires_at
    ) values (
      v_run_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
      p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
      v_permission_revision, p_capability_manifest_revision,
      p_exposure_revision, (debtor #>> '{customer_ref,id}')::uuid,
      'prepare_collections', 'commit_collections_draft', v_preview,
      v_preview_hash, v_expires_at
    ) returning id into v_change_set_id;

    insert into public.agent_actions (
      company_id, user_id, action_type, action_data, context_summary,
      context_source, source_id, confidence, priority, status, expires_at
    ) values (
      p_company_id, p_actor_user_id, 'approve_collections_draft',
      jsonb_build_object(
        'schema_revision', '2026-08-31.v1',
        'run_id', v_run_id,
        'change_set_id', v_change_set_id,
        'host_client_name', v_client_name,
        'context_source', 'collections',
        'customer_ref', debtor -> 'customer_ref',
        'customer_display_name', debtor ->> 'display_name',
        'preview', v_preview,
        'preview_sha256', 'sha256:' || v_preview_hash,
        'expires_at', v_expires_at,
        'delivery_state', 'not_sent'
      ),
      'Collection draft ready for review', 'collections',
      'agent-collections:' || v_change_set_id::text, 1, 'normal', 'pending',
      v_expires_at
    ) returning id into v_action_id;

    v_approval_count := v_approval_count + 1;
    v_result_debtors := v_result_debtors || jsonb_build_array(
      debtor - 'draft' || jsonb_build_object(
        'draft', jsonb_build_object(
          'kind', 'approval_required',
          'action_id', v_action_id,
          'change_set_id', v_change_set_id,
          'approval_url', '/agent/queue',
          'preview', v_preview,
          'preview_sha256', 'sha256:' || v_preview_hash,
          'expires_at', v_expires_at
        )
      )
    );
  end loop;

  for debtor in select value from jsonb_array_elements(p_result_base -> 'debtors')
  loop
    if debtor #>> '{draft,kind}' = 'blocked' then
      v_result_debtors := v_result_debtors || jsonb_build_array(debtor);
    end if;
  end loop;
  -- Restore the service-owned severity ordering after replacing prepared drafts.
  select coalesce(jsonb_agg(value order by
      (value ->> 'max_days_past_due')::integer desc,
      value #>> '{customer_ref,id}' asc), '[]'::jsonb)
    into v_result_debtors
  from jsonb_array_elements(v_result_debtors);

  v_result := p_result_base || jsonb_build_object(
    'run_id', v_run_id,
    'debtors', v_result_debtors,
    'receipt', (p_result_base -> 'receipt') || jsonb_build_object(
      'approvals_created', v_approval_count,
      'drafts_blocked', jsonb_array_length(p_result_base -> 'debtors') -
        v_approval_count,
      'messages_sent', 0,
      'money_moved', false,
      'financial_documents_issued', 0,
      'replayed', false
    )
  );
  update private.agent_collections_runs
  set result_snapshot = v_result
  where id = v_run_id and company_id = p_company_id;

  if v_approval_count > 0 then
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      p_actor_user_id::text, p_company_id::text, 'agent_suggestion',
      'Collection drafts ready',
      v_approval_count::text ||
        ' drafts ready for review. Nothing has been sent.',
      false, false, '/agent/queue', 'REVIEW',
      'collections-run:' || v_run_id::text
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('result', v_result, 'replayed', false);
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'AGENT_COLLECTIONS_PREPARE_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

create or replace function public.commit_agent_collections_draft_as_actor(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_action_id uuid,
  p_change_set_id uuid,
  p_preview_sha256 text,
  p_idempotency_key text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  action public.agent_actions%rowtype;
  change_set private.agent_collections_change_sets%rowtype;
  confirmation private.agent_collections_confirmations%rowtype;
  receipt private.agent_collections_receipts%rowtype;
  v_confirmation_id uuid;
  v_receipt_hash text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_action_id is null or p_change_set_id is null
     or p_preview_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception 'AGENT_COLLECTIONS_CONFIRMATION_INVALID'
      using errcode = '22023';
  end if;

  select source.* into action
  from public.agent_actions source
  where source.id = p_action_id
    and source.company_id = p_company_id
    and source.user_id = p_actor_user_id
  for update;
  if not found or action.action_type is distinct from
       'approve_collections_draft' then
    raise exception 'AGENT_COLLECTIONS_ACTION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  select source.* into receipt
  from private.agent_collections_receipts source
  where source.action_id = p_action_id
    and source.company_id = p_company_id
    and source.actor_user_id = p_actor_user_id;
  if found then
    select source.* into confirmation
    from private.agent_collections_confirmations source
    where source.id = receipt.confirmation_id
      and source.idempotency_key = p_idempotency_key;
    if not found
       or receipt.change_set_id is distinct from p_change_set_id
       or receipt.preview_hash is distinct from
         substring(p_preview_sha256 from 8) then
      raise exception 'AGENT_COLLECTIONS_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    select source.* into change_set
    from private.agent_collections_change_sets source
    where source.id = receipt.change_set_id
      and source.company_id = p_company_id
      and source.actor_user_id = p_actor_user_id;
    if not found then
      raise exception 'AGENT_COLLECTIONS_REPLAY_BINDING_INVALID'
        using errcode = '42501';
    end if;
    perform private.assert_agent_collections_authority(
      p_actor_user_id, p_company_id, change_set.oauth_grant_id,
      change_set.oauth_client_id, change_set.grant_revision,
      change_set.granted_scope_ceiling,
      change_set.permission_snapshot_revision,
      change_set.capability_manifest_revision,
      change_set.exposure_revision
    );
    return receipt.result || jsonb_build_object('replayed', true);
  end if;

  select source.* into change_set
  from private.agent_collections_change_sets source
  where source.id = p_change_set_id
    and source.id = (action.action_data ->> 'change_set_id')::uuid
    and source.company_id = p_company_id
    and source.actor_user_id = p_actor_user_id
    and source.preview_hash = substring(p_preview_sha256 from 8)
  for update;
  if not found
     or change_set.consumed_at is not null
     or change_set.rejected_at is not null
     or change_set.expires_at <= statement_timestamp()
     or action.status is distinct from 'pending'
     or action.expires_at <= statement_timestamp()
     or action.action_data ->> 'preview_sha256' is distinct from
       p_preview_sha256 then
    raise exception 'AGENT_COLLECTIONS_CHANGE_SET_STALE_OR_INVALID'
      using errcode = '55000';
  end if;
  perform private.assert_agent_collections_authority(
    p_actor_user_id, p_company_id, change_set.oauth_grant_id,
    change_set.oauth_client_id, change_set.grant_revision,
    change_set.granted_scope_ceiling,
    change_set.permission_snapshot_revision,
    change_set.capability_manifest_revision,
    change_set.exposure_revision
  );

  insert into private.agent_collections_confirmations (
    action_id, change_set_id, company_id, actor_user_id, oauth_grant_id,
    oauth_client_id, grant_revision, capability_manifest_revision,
    exposure_revision, commit_capability, preview_hash, idempotency_key,
    consumed_at
  ) values (
    p_action_id, change_set.id, p_company_id, p_actor_user_id,
    change_set.oauth_grant_id, change_set.oauth_client_id,
    change_set.grant_revision, change_set.capability_manifest_revision,
    change_set.exposure_revision, 'commit_collections_draft',
    change_set.preview_hash, p_idempotency_key, statement_timestamp()
  ) returning id into v_confirmation_id;

  v_result := jsonb_build_object(
    'ok', true,
    'effect', 'collections_draft_approved_inside_ops',
    'run_id', change_set.run_id,
    'action_id', p_action_id,
    'change_set_id', change_set.id,
    'confirmation_receipt_id', v_confirmation_id,
    'preview_sha256', p_preview_sha256,
    'messages_sent', 0,
    'money_moved', false,
    'financial_documents_issued', 0,
    'committed_at', statement_timestamp(),
    'replayed', false
  );
  v_receipt_hash := encode(
    extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_result := v_result || jsonb_build_object(
    'receipt_sha256', 'sha256:' || v_receipt_hash
  );

  update private.agent_collections_change_sets
  set consumed_at = statement_timestamp()
  where id = change_set.id and company_id = p_company_id
    and consumed_at is null and rejected_at is null;
  if not found then
    raise exception 'AGENT_COLLECTIONS_CHANGE_SET_CONFLICT'
      using errcode = '40001';
  end if;
  update public.agent_actions
  set status = 'executed', reviewed_by = p_actor_user_id,
      reviewed_at = statement_timestamp(), executed_at = statement_timestamp(),
      execution_result = v_result, error = null
  where id = p_action_id and company_id = p_company_id
    and user_id = p_actor_user_id and status = 'pending';
  if not found then
    raise exception 'AGENT_COLLECTIONS_ACTION_CONFLICT'
      using errcode = '40001';
  end if;

  insert into private.agent_collections_receipts (
    confirmation_id, action_id, change_set_id, run_id, company_id,
    actor_user_id, oauth_grant_id, oauth_client_id, grant_revision,
    capability_manifest_revision, exposure_revision, commit_capability,
    preview_hash, receipt_hash, result
  ) values (
    v_confirmation_id, p_action_id, change_set.id, change_set.run_id,
    p_company_id, p_actor_user_id, change_set.oauth_grant_id,
    change_set.oauth_client_id, change_set.grant_revision,
    change_set.capability_manifest_revision, change_set.exposure_revision,
    'commit_collections_draft', change_set.preview_hash, v_receipt_hash,
    v_result
  );
  return v_result;
end;
$function$;

create or replace function public.reject_agent_collections_draft_as_actor(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_action_id uuid,
  p_review_notes text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  action public.agent_actions%rowtype;
  change_set private.agent_collections_change_sets%rowtype;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_review_notes is not null and length(btrim(p_review_notes)) > 1000 then
    raise exception 'AGENT_COLLECTIONS_REJECTION_NOTES_INVALID'
      using errcode = '22023';
  end if;
  select source.* into action
  from public.agent_actions source
  where source.id = p_action_id
    and source.company_id = p_company_id
    and source.user_id = p_actor_user_id
  for update;
  if not found or action.action_type is distinct from
       'approve_collections_draft' or action.status is distinct from 'pending'
     or action.expires_at <= statement_timestamp() then
    raise exception 'AGENT_COLLECTIONS_REJECTION_INVALID'
      using errcode = '55000';
  end if;
  select source.* into change_set
  from private.agent_collections_change_sets source
  where source.id = (action.action_data ->> 'change_set_id')::uuid
    and source.company_id = p_company_id
    and source.actor_user_id = p_actor_user_id
  for update;
  if not found or change_set.consumed_at is not null
     or change_set.rejected_at is not null
     or change_set.expires_at <= statement_timestamp() then
    raise exception 'AGENT_COLLECTIONS_REJECTION_INVALID'
      using errcode = '55000';
  end if;
  perform private.assert_agent_collections_authority(
    p_actor_user_id, p_company_id, change_set.oauth_grant_id,
    change_set.oauth_client_id, change_set.grant_revision,
    change_set.granted_scope_ceiling,
    change_set.permission_snapshot_revision,
    change_set.capability_manifest_revision,
    change_set.exposure_revision
  );
  v_result := jsonb_build_object(
    'ok', true,
    'effect', 'left_open_inside_ops',
    'action_id', p_action_id,
    'change_set_id', change_set.id,
    'messages_sent', 0,
    'money_moved', false,
    'financial_documents_issued', 0,
    'rejected_at', statement_timestamp()
  );
  update private.agent_collections_change_sets
  set rejected_at = statement_timestamp()
  where id = change_set.id and company_id = p_company_id
    and consumed_at is null and rejected_at is null;
  update public.agent_actions
  set status = 'rejected', reviewed_by = p_actor_user_id,
      reviewed_at = statement_timestamp(), execution_result = v_result,
      review_notes = nullif(btrim(p_review_notes), ''), error = null
  where id = p_action_id and company_id = p_company_id
    and user_id = p_actor_user_id and status = 'pending';
  if not found then
    raise exception 'AGENT_COLLECTIONS_REJECTION_CONFLICT'
      using errcode = '40001';
  end if;
  return v_result;
end;
$function$;

create or replace function public.consume_agent_collections_prepare_rate_limit_as_system(
  p_request_id text,
  p_grant_id uuid,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_capability_id text,
  p_policy_id text,
  p_requested_units integer,
  p_protocol_era text
) returns table (
  allowed boolean,
  remaining_units integer,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_client_id uuid;
  v_actor_limit constant integer := 6;
  v_grant_limit constant integer := 6;
  v_company_limit constant integer := 30;
  v_window_seconds constant integer := 60;
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_expiry timestamptz;
  v_actor_digest bytea;
  v_grant_digest bytea;
  v_company_digest bytea;
  v_locked_count integer;
  v_allowed boolean;
  v_remaining integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_grant_id is null or p_actor_user_id is null or p_company_id is null
     or p_capability_id is distinct from 'prepare_collections'
     or p_policy_id is distinct from
       'mcp-collections-prepare:2026-08-31.v1'
     or p_requested_units is distinct from 1
     or p_protocol_era not in ('legacy', 'modern') then
    raise exception 'agent_collections_rate_limit_request_invalid'
      using errcode = '22023';
  end if;

  select client.client_id into v_client_id
  from private.mcp_oauth_grants grant_record
  join private.mcp_oauth_clients client
    on client.client_id = grant_record.client_id
   and client.disabled_at is null
   and grant_record.scopes <@ client.scope_ceiling
   and grant_record.exposure_revision = client.exposure_revision
   and grant_record.consent_catalog_revision = client.consent_catalog_revision
  where grant_record.id = p_grant_id
    and grant_record.user_id = p_actor_user_id
    and grant_record.company_id = p_company_id
    and grant_record.revoked_at is null
    and grant_record.exposure_revision = '2026-08-31.mcp-exposure.v4'
    and 'ops.operations.prepare' = any(grant_record.scopes);
  if not found then
    raise exception 'agent_collections_rate_limit_binding_invalid'
      using errcode = '42501';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from statement_timestamp()) / v_window_seconds) *
      v_window_seconds
  );
  v_reset_at := v_window_start + pg_catalog.make_interval(
    secs => v_window_seconds
  );
  v_expiry := v_reset_at + interval '5 minutes';
  perform private.prune_agent_mcp_rate_limit_buckets(64);
  v_actor_digest := private.agent_mcp_rate_limit_bucket_digest(
    'actor', p_company_id, p_actor_user_id, null,
    p_capability_id, p_policy_id, v_window_start
  );
  v_grant_digest := private.agent_mcp_rate_limit_bucket_digest(
    'grant', p_company_id, p_actor_user_id, p_grant_id,
    p_capability_id, p_policy_id, v_window_start
  );
  v_company_digest := private.agent_mcp_rate_limit_bucket_digest(
    'company', p_company_id, null, null,
    p_capability_id, p_policy_id, v_window_start
  );

  insert into private.agent_mcp_rate_limit_buckets (
    bucket_digest, bucket_kind, policy_id, window_start, units_used, expires_at
  ) values
    (v_actor_digest, 'actor', p_policy_id, v_window_start, 0, v_expiry),
    (v_grant_digest, 'grant', p_policy_id, v_window_start, 0, v_expiry),
    (v_company_digest, 'company', p_policy_id, v_window_start, 0, v_expiry)
  on conflict (bucket_digest) do nothing;

  perform 1
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest, v_grant_digest, v_company_digest
  )
  order by bucket.bucket_digest
  for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count is distinct from 3 or exists (
    select 1 from private.agent_mcp_rate_limit_buckets bucket
    where (
      bucket.bucket_digest = v_actor_digest
      and bucket.bucket_kind is distinct from 'actor'
    ) or (
      bucket.bucket_digest = v_grant_digest
      and bucket.bucket_kind is distinct from 'grant'
    ) or (
      bucket.bucket_digest = v_company_digest
      and bucket.bucket_kind is distinct from 'company'
    ) or (
      bucket.bucket_digest in (
        v_actor_digest, v_grant_digest, v_company_digest
      ) and (
        bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    )
  ) then
    raise exception 'agent_collections_rate_limit_bucket_collision'
      using errcode = '55000';
  end if;

  select bool_and(
      bucket.units_used + p_requested_units <= case bucket.bucket_kind
        when 'actor' then v_actor_limit
        when 'grant' then v_grant_limit
        when 'company' then v_company_limit
      end
    ) into v_allowed
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest, v_grant_digest, v_company_digest
  );
  if v_allowed then
    update private.agent_mcp_rate_limit_buckets bucket
    set units_used = bucket.units_used + p_requested_units
    where bucket.bucket_digest in (
      v_actor_digest, v_grant_digest, v_company_digest
    );
    select min(case bucket.bucket_kind
        when 'actor' then v_actor_limit
        when 'grant' then v_grant_limit
        when 'company' then v_company_limit
      end - bucket.units_used)::integer into v_remaining
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest, v_grant_digest, v_company_digest
    );
  else
    v_remaining := 0;
    insert into private.mcp_request_audit (
      request_id, grant_id, client_id, actor_user_id, company_id, tool,
      protocol_era, outcome, error_code, input_sha256, result_bytes,
      latency_ms
    ) values (
      p_request_id, p_grant_id, v_client_id, p_actor_user_id, p_company_id,
      p_capability_id, p_protocol_era, 'rate_limited', 'RATE_LIMITED',
      null, null, null
    );
  end if;
  return query select v_allowed, v_remaining, v_reset_at;
end;
$function$;

revoke all on function public.resolve_agent_collections_timezone_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_agent_collections_timezone_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) to service_role;

revoke all on function public.inspect_agent_collections_correspondence_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.inspect_agent_collections_correspondence_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, jsonb, timestamptz
) to service_role;

revoke all on function public.persist_agent_collections_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.persist_agent_collections_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb
) to service_role;

revoke all on function public.commit_agent_collections_draft_as_actor(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.commit_agent_collections_draft_as_actor(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

revoke all on function public.reject_agent_collections_draft_as_actor(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reject_agent_collections_draft_as_actor(
  uuid, uuid, uuid, text
) to service_role;

revoke all on function public.consume_agent_collections_prepare_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.consume_agent_collections_prepare_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) to service_role;

comment on function public.commit_agent_collections_draft_as_actor(
  uuid, uuid, uuid, uuid, text, text
) is 'Approves one exact immutable collection draft inside OPS only. Draft approved inside OPS only. No message sent. No money moved. No financial document issued.';

commit;
