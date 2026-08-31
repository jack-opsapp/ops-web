-- Foundation Zero: OPS-owned day-closeout state and exact filing authority.
--
-- The active MCP v2 exposure remains read-only. These private records and
-- service-role RPCs support the inactive v3 vertical only. The prepare path
-- can file nothing; the commit path can only mark the exact prepared closeout
-- as filed inside OPS. Neither path can send a message or move money.

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.agent_actions',
    'public.companies',
    'public.notifications',
    'private.agent_mcp_rate_limit_buckets',
    'private.mcp_request_audit',
    'private.agent_provider_delivery_sources',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_day_closeout_prerequisite_missing: %', v_relation
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
      raise exception 'agent_day_closeout_prerequisite_missing: %', v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

create table private.agent_day_closeout_routines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  local_time time not null,
  timezone text not null,
  weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  claimed_at timestamptz,
  claim_token uuid,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_code text,
  change_cursor jsonb not null default '{}'::jsonb,
  schedule_revision bigint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint agent_day_closeout_routines_weekdays_valid check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint agent_day_closeout_routines_timezone_bounded check (
    length(timezone) between 1 and 128
  ),
  constraint agent_day_closeout_routines_revision_valid check (
    schedule_revision between 0 and 9007199254740991
  ),
  unique (company_id, actor_user_id, oauth_client_id)
);

create table private.agent_day_closeout_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid references private.agent_day_closeout_routines(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  schema_revision text not null,
  metric_definition_revision text not null,
  trigger_kind text not null check (trigger_kind in ('interactive', 'routine')),
  business_date date not null,
  timezone text not null,
  idempotency_key text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('clear', 'attention', 'partial')),
  status text not null check (status in ('prepared', 'filed', 'failed')),
  result_snapshot jsonb not null,
  failure_code text,
  prepared_at timestamptz not null default statement_timestamp(),
  filed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (company_id, actor_user_id, oauth_client_id, idempotency_key),
  constraint agent_day_closeout_runs_idempotency_bounded check (
    length(idempotency_key) between 8 and 200
  )
);

create table private.agent_day_closeout_change_sets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique
    references private.agent_day_closeout_runs(id) on delete cascade,
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null,
  oauth_client_id uuid not null,
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  prepare_capability text not null check (
    prepare_capability = 'prepare_day_closeout'
  ),
  commit_capability text not null check (
    commit_capability = 'commit_day_closeout'
  ),
  payload jsonb not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint agent_day_closeout_change_sets_expiry_valid check (
    expires_at > created_at and expires_at <= created_at + interval '24 hours'
  )
);

create table private.agent_day_closeout_confirmations (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.agent_actions(id),
  change_set_id uuid not null unique
    references private.agent_day_closeout_change_sets(id),
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null,
  oauth_client_id uuid not null,
  grant_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  commit_capability text not null check (
    commit_capability = 'commit_day_closeout'
  ),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null,
  confirmed_at timestamptz not null default statement_timestamp(),
  consumed_at timestamptz,
  constraint agent_day_closeout_confirmations_single_use check (
    consumed_at is null or consumed_at >= confirmed_at
  )
);

create table private.agent_day_closeout_receipts (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null unique
    references private.agent_day_closeout_confirmations(id),
  action_id uuid not null unique references public.agent_actions(id),
  change_set_id uuid not null unique
    references private.agent_day_closeout_change_sets(id),
  run_id uuid not null unique references private.agent_day_closeout_runs(id),
  company_id uuid not null,
  actor_user_id uuid not null,
  oauth_grant_id uuid not null,
  oauth_client_id uuid not null,
  grant_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  commit_capability text not null check (
    commit_capability = 'commit_day_closeout'
  ),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  committed_at timestamptz not null default statement_timestamp()
);

create index agent_day_closeout_routines_due_idx
  on private.agent_day_closeout_routines (next_run_at, id)
  where enabled and claim_token is null;
create index agent_day_closeout_runs_company_date_idx
  on private.agent_day_closeout_runs (company_id, business_date desc, prepared_at desc);

alter table private.agent_day_closeout_routines enable row level security;
alter table private.agent_day_closeout_runs enable row level security;
alter table private.agent_day_closeout_change_sets enable row level security;
alter table private.agent_day_closeout_confirmations enable row level security;
alter table private.agent_day_closeout_receipts enable row level security;

alter table private.agent_mcp_rate_limit_buckets
  drop constraint agent_mcp_rate_limit_buckets_policy_closed;
alter table private.agent_mcp_rate_limit_buckets
  add constraint agent_mcp_rate_limit_buckets_policy_closed check (
    policy_id in (
      'mcp-lightweight-read:2026-08-23.v1',
      'mcp-evidence-search:2026-08-23.v1',
      'mcp-day-closeout-prepare:2026-08-30.v1'
    )
  );

revoke all on table private.agent_day_closeout_routines
  from public, anon, authenticated, service_role;
revoke all on table private.agent_day_closeout_runs
  from public, anon, authenticated, service_role;
revoke all on table private.agent_day_closeout_change_sets
  from public, anon, authenticated, service_role;
revoke all on table private.agent_day_closeout_confirmations
  from public, anon, authenticated, service_role;
revoke all on table private.agent_day_closeout_receipts
  from public, anon, authenticated, service_role;

create or replace function private.assert_agent_day_closeout_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
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
    jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
    jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
    jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
begin
  if p_exposure_revision is distinct from '2026-08-30.mcp-exposure.v3' then
    raise exception 'AGENT_DAY_CLOSEOUT_EXPOSURE_INVALID' using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array[
      'calendar.view', 'email.view', 'invoices.view', 'pipeline.view',
      'projects.view', 'reports.view', 'tasks.view'
    ]
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or (
       p_permission_snapshot_revision is not null
       and v_permission_snapshot_revision is distinct from
         p_permission_snapshot_revision
     ) then
    raise exception 'AGENT_DAY_CLOSEOUT_AUTHORITY_STALE_OR_DENIED'
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
      and grant_record.exposure_revision = p_exposure_revision
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_DAY_CLOSEOUT_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_day_closeout_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text
) from public, anon, authenticated, service_role;

create or replace function public.resolve_agent_day_closeout_timezone_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
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
  perform private.assert_agent_day_closeout_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_exposure_revision
  );
  select company.timezone into v_timezone
  from public.companies company
  where company.id = p_company_id and company.deleted_at is null;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = v_timezone
  ) then
    raise exception 'AGENT_DAY_CLOSEOUT_TIMEZONE_UNAVAILABLE'
      using errcode = '55000';
  end if;
  return v_timezone;
end;
$function$;

create or replace function public.inspect_agent_day_closeout_correspondence_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_exposure_revision text,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_total integer;
  v_readable integer;
  v_unreadable integer;
begin
  perform private.assert_agent_day_closeout_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_exposure_revision
  );
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at
     or p_end_at > statement_timestamp() + interval '5 minutes'
     or p_end_at - p_start_at > interval '14 days' then
    raise exception 'AGENT_DAY_CLOSEOUT_CORRESPONDENCE_WINDOW_INVALID'
      using errcode = '22023';
  end if;

  select count(*)::integer,
         count(*) filter (
           where source.normalization_status = 'normalized'
             and nullif(btrim(source.normalized_plain_text), '') is not null
         )::integer,
         count(*) filter (
           where source.normalization_status <> 'normalized'
              or nullif(btrim(source.normalized_plain_text), '') is null
         )::integer
    into v_total, v_readable, v_unreadable
  from private.agent_provider_delivery_sources source
  where source.company_id = p_company_id
    and source.delivered_at >= p_start_at
    and source.delivered_at < p_end_at;

  return jsonb_build_object(
    'coverage_state', case when v_unreadable = 0 then 'complete' else 'unavailable' end,
    'total_count', v_total,
    'readable_count', v_readable,
    'unreadable_count', v_unreadable,
    'fresh_at', statement_timestamp(),
    'normalization_revision', 'ops.correspondence.normalized-text.v2'
  );
end;
$function$;

create or replace function public.persist_agent_day_closeout_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_business_date date,
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
  v_action_id uuid;
  v_change_payload jsonb;
  v_change_set_id uuid;
  v_client_name text;
  v_correspondence_component jsonb;
  v_existing private.agent_day_closeout_runs%rowtype;
  v_expires_at timestamptz := statement_timestamp() + interval '24 hours';
  v_finding_count integer;
  v_permission_revision text;
  v_preview_hash text;
  v_result jsonb;
  v_run_id uuid := gen_random_uuid();
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-30.capability-manifest.v9'
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or p_input_hash !~ '^[0-9a-f]{64}$'
     or length(p_timezone) not between 1 and 128
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = p_timezone
     )
     or jsonb_typeof(p_result_base) is distinct from 'object'
     or p_result_base ->> 'schema_revision' is distinct from '2026-08-30.v1'
     or p_result_base ->> 'metric_definition_revision' is distinct from
       'day-closeout:2026-08-30.v1'
     or p_result_base ->> 'state' not in ('clear', 'attention', 'partial')
     or jsonb_typeof(p_result_base -> 'components') is distinct from 'array'
     or jsonb_array_length(p_result_base -> 'components') <> 5
     or jsonb_typeof(p_result_base -> 'findings') is distinct from 'array'
     or jsonb_array_length(p_result_base -> 'findings') > 100
     or jsonb_typeof(p_result_base -> 'outstanding_balances') is distinct from
       'array'
     or jsonb_typeof(p_result_base -> 'communication_briefs') is distinct from
       'array'
     or jsonb_array_length(p_result_base -> 'communication_briefs') > 25 then
    raise exception 'AGENT_DAY_CLOSEOUT_PREPARE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  v_permission_revision := private.assert_agent_day_closeout_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_exposure_revision
  );
  select client.client_name into strict v_client_name
  from private.mcp_oauth_clients client
  where client.client_id = p_oauth_client_id;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id::text || ':' || p_actor_user_id::text || ':' ||
      p_oauth_client_id::text || ':' || p_idempotency_key,
      0
    )
  );

  select * into v_existing
  from private.agent_day_closeout_runs run
  where run.company_id = p_company_id
    and run.actor_user_id = p_actor_user_id
    and run.oauth_client_id = p_oauth_client_id
    and run.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.input_hash is distinct from p_input_hash then
      raise exception 'AGENT_DAY_CLOSEOUT_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'run_id', v_existing.id,
      'result', v_existing.result_snapshot,
      'replayed', true
    );
  end if;

  v_finding_count := jsonb_array_length(p_result_base -> 'findings');
  select component into v_correspondence_component
  from jsonb_array_elements(p_result_base -> 'components') component
  where component ->> 'component' = 'unresolved_correspondence'
  limit 1;
  if v_correspondence_component is null
     or v_correspondence_component ->> 'state' not in (
       'clear', 'attention', 'not_evaluated'
     )
     or v_correspondence_component #>> '{coverage,state}' not in (
       'complete', 'partial', 'unavailable'
     ) then
    raise exception 'AGENT_DAY_CLOSEOUT_CORRESPONDENCE_RESULT_INVALID'
      using errcode = '22023';
  end if;
  insert into private.agent_day_closeout_runs (
    id, company_id, actor_user_id, oauth_grant_id, oauth_client_id,
    grant_revision, granted_scope_ceiling, permission_snapshot_revision,
    capability_manifest_revision, exposure_revision, schema_revision,
    metric_definition_revision, trigger_kind, business_date, timezone,
    idempotency_key, input_hash, state, status, result_snapshot
  ) values (
    v_run_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
    p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
    v_permission_revision, p_capability_manifest_revision,
    p_exposure_revision, '2026-08-30.v1',
    'day-closeout:2026-08-30.v1', 'interactive', p_business_date,
    p_timezone, p_idempotency_key, p_input_hash, p_result_base ->> 'state',
    'prepared', p_result_base
  );

  if v_finding_count = 0 then
    v_result := p_result_base || jsonb_build_object(
      'run_id', v_run_id,
      'filing', jsonb_build_object('kind', 'not_required')
    );
  else
    v_change_payload := jsonb_build_object(
      'schema_revision', '2026-08-30.v1',
      'metric_definition_revision', 'day-closeout:2026-08-30.v1',
      'business_date', p_business_date,
      'findings', p_result_base -> 'findings',
      'outstanding_balances', p_result_base -> 'outstanding_balances',
      'filing_statement', 'File this day closeout inside OPS.',
      'truth_boundary', 'No messages sent. No money moved.'
    );
    v_preview_hash := encode(
      extensions.digest(convert_to(v_change_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );
    insert into private.agent_day_closeout_change_sets (
      run_id, company_id, actor_user_id, oauth_grant_id, oauth_client_id,
      grant_revision, granted_scope_ceiling, permission_snapshot_revision,
      capability_manifest_revision, exposure_revision, prepare_capability,
      commit_capability, payload, preview_hash, expires_at
    ) values (
      v_run_id, p_company_id, p_actor_user_id, p_oauth_grant_id,
      p_oauth_client_id, p_grant_revision, p_granted_scope_ceiling,
      v_permission_revision, p_capability_manifest_revision,
      p_exposure_revision, 'prepare_day_closeout', 'commit_day_closeout',
      v_change_payload, v_preview_hash, v_expires_at
    ) returning id into v_change_set_id;

    insert into public.agent_actions (
      company_id, user_id, action_type, action_data, context_summary,
      context_source, source_id, confidence, priority, status, expires_at
    ) values (
      p_company_id, p_actor_user_id, 'file_day_closeout',
      jsonb_build_object(
        'schema_revision', '2026-08-30.v1',
        'run_id', v_run_id,
        'change_set_id', v_change_set_id,
        'host_client_name', v_client_name,
        'business_date', p_business_date,
        'finding_count', v_finding_count,
        'findings', p_result_base -> 'findings',
        'outstanding_balances', p_result_base -> 'outstanding_balances',
        'correspondence_state', v_correspondence_component ->> 'state',
        'correspondence_coverage_state',
          v_correspondence_component #>> '{coverage,state}',
        'communication_brief_count',
          jsonb_array_length(p_result_base -> 'communication_briefs'),
        'filing_statement', 'File this day closeout inside OPS.',
        'truth_boundary', 'No messages sent. No money moved.',
        'preview_sha256', 'sha256:' || v_preview_hash,
        'expires_at', v_expires_at
      ),
      'Day closeout ready for review', 'day_closeout',
      'agent-day-closeout:' || v_run_id::text, 1, 'normal', 'pending',
      v_expires_at
    ) returning id into v_action_id;

    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      p_actor_user_id::text, p_company_id::text, 'agent_suggestion',
      'Day closeout ready',
      v_finding_count::text ||
        ' items need review before the record is filed.',
      false, true, '/agent/queue', 'REVIEW',
      'day-closeout:' || v_action_id::text
    ) on conflict do nothing;

    v_result := p_result_base || jsonb_build_object(
      'run_id', v_run_id,
      'filing', jsonb_build_object(
        'kind', 'approval_required',
        'action_id', v_action_id,
        'change_set_id', v_change_set_id,
        'approval_url', '/agent/queue',
        'preview', jsonb_build_object(
          'business_date', p_business_date,
          'finding_count', v_finding_count,
          'filing_statement', 'File this day closeout inside OPS.',
          'truth_boundary', 'No messages sent. No money moved.',
          'preview_sha256', 'sha256:' || v_preview_hash
        )
      )
    );
  end if;

  update private.agent_day_closeout_runs
  set result_snapshot = v_result
  where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'action_id', v_action_id,
    'change_set_id', v_change_set_id,
    'result', v_result,
    'replayed', false
  );
end;
$function$;

create or replace function public.commit_agent_day_closeout_as_actor(
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
  v_action public.agent_actions%rowtype;
  v_change private.agent_day_closeout_change_sets%rowtype;
  v_confirmation private.agent_day_closeout_confirmations%rowtype;
  v_confirmation_id uuid;
  v_existing_receipt private.agent_day_closeout_receipts%rowtype;
  v_receipt_hash text;
  v_result jsonb;
  v_run private.agent_day_closeout_runs%rowtype;
begin
  if p_change_set_id is null
     or p_preview_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception 'AGENT_DAY_CLOSEOUT_CONFIRMATION_INVALID'
      using errcode = '22023';
  end if;

  select * into v_action
  from public.agent_actions action
  where action.id = p_action_id
    and action.company_id = p_company_id
    and action.user_id = p_actor_user_id
  for update;
  if not found or v_action.action_type is distinct from 'file_day_closeout' then
    raise exception 'AGENT_DAY_CLOSEOUT_ACTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select receipt.* into v_existing_receipt
  from private.agent_day_closeout_receipts receipt
  where receipt.action_id = p_action_id
    and receipt.company_id = p_company_id
    and receipt.actor_user_id = p_actor_user_id;
  if found then
    select confirmation.* into v_confirmation
    from private.agent_day_closeout_confirmations confirmation
    where confirmation.id = v_existing_receipt.confirmation_id
      and confirmation.idempotency_key = p_idempotency_key;
    if not found then
      raise exception 'AGENT_DAY_CLOSEOUT_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    if v_existing_receipt.change_set_id is distinct from p_change_set_id
       or v_existing_receipt.preview_hash is distinct from
         substring(p_preview_sha256 from 8) then
      raise exception 'AGENT_DAY_CLOSEOUT_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    select change_set.* into v_change
    from private.agent_day_closeout_change_sets change_set
    where change_set.id = v_existing_receipt.change_set_id
      and change_set.id = p_change_set_id
      and change_set.company_id = p_company_id
      and change_set.actor_user_id = p_actor_user_id;
    if not found then
      raise exception 'AGENT_DAY_CLOSEOUT_REPLAY_BINDING_INVALID'
        using errcode = '42501';
    end if;
    perform private.assert_agent_day_closeout_authority(
      p_actor_user_id, p_company_id, v_change.oauth_grant_id,
      v_change.oauth_client_id, v_change.grant_revision,
      v_change.granted_scope_ceiling, v_change.permission_snapshot_revision,
      v_change.exposure_revision
    );
    return v_existing_receipt.result || jsonb_build_object('replayed', true);
  end if;

  select change_set.* into v_change
  from private.agent_day_closeout_change_sets change_set
  where change_set.id = p_change_set_id
    and change_set.id = (v_action.action_data ->> 'change_set_id')::uuid
    and change_set.company_id = p_company_id
    and change_set.actor_user_id = p_actor_user_id
    and change_set.preview_hash = substring(p_preview_sha256 from 8)
  for update;
  if not found or v_change.consumed_at is not null
     or v_change.expires_at <= statement_timestamp()
     or v_action.status is distinct from 'pending'
     or v_action.expires_at <= statement_timestamp() then
    raise exception 'AGENT_DAY_CLOSEOUT_CHANGE_SET_STALE_OR_INVALID'
      using errcode = '55000';
  end if;

  perform private.assert_agent_day_closeout_authority(
    p_actor_user_id, p_company_id, v_change.oauth_grant_id,
    v_change.oauth_client_id, v_change.grant_revision,
    v_change.granted_scope_ceiling, v_change.permission_snapshot_revision,
    v_change.exposure_revision
  );

  select * into v_run
  from private.agent_day_closeout_runs run
  where run.id = v_change.run_id and run.company_id = p_company_id
  for update;
  if not found or v_run.status is distinct from 'prepared' then
    raise exception 'AGENT_DAY_CLOSEOUT_RUN_STALE' using errcode = '55000';
  end if;

  insert into private.agent_day_closeout_confirmations (
    action_id, change_set_id, company_id, actor_user_id, oauth_grant_id,
    oauth_client_id, grant_revision, capability_manifest_revision,
    exposure_revision, commit_capability, preview_hash, idempotency_key,
    consumed_at
  ) values (
    p_action_id, v_change.id, p_company_id, p_actor_user_id,
    v_change.oauth_grant_id, v_change.oauth_client_id,
    v_change.grant_revision, v_change.capability_manifest_revision,
    v_change.exposure_revision, 'commit_day_closeout',
    v_change.preview_hash, p_idempotency_key, statement_timestamp()
  ) returning id into v_confirmation_id;

  v_result := jsonb_build_object(
    'ok', true,
    'effect', 'filed_inside_ops',
    'run_id', v_run.id,
    'action_id', p_action_id,
    'change_set_id', v_change.id,
    'confirmation_receipt_id', v_confirmation_id,
    'preview_sha256', p_preview_sha256,
    'messages_sent', 0,
    'money_moved', false,
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

  update private.agent_day_closeout_change_sets
  set consumed_at = statement_timestamp()
  where id = v_change.id and consumed_at is null;
  update private.agent_day_closeout_runs
  set status = 'filed', filed_at = statement_timestamp()
  where id = v_run.id and status = 'prepared';
  update public.agent_actions
  set status = 'executed', reviewed_by = p_actor_user_id,
      reviewed_at = statement_timestamp(), executed_at = statement_timestamp(),
      execution_result = v_result, error = null
  where id = p_action_id and company_id = p_company_id and status = 'pending';
  if not found then
    raise exception 'AGENT_DAY_CLOSEOUT_ACTION_CONFLICT' using errcode = '40001';
  end if;
  update public.notifications notification
  set is_read = true, resolved_at = statement_timestamp()
  where notification.user_id = p_actor_user_id::text
    and notification.company_id = p_company_id::text
    and notification.dedupe_key = 'day-closeout:' || p_action_id::text
    and notification.is_read = false;

  insert into private.agent_day_closeout_receipts (
    confirmation_id, action_id, change_set_id, run_id, company_id,
    actor_user_id, oauth_grant_id, oauth_client_id, grant_revision,
    capability_manifest_revision, exposure_revision, commit_capability,
    preview_hash, receipt_hash, result
  ) values (
    v_confirmation_id, p_action_id, v_change.id, v_run.id, p_company_id,
    p_actor_user_id, v_change.oauth_grant_id, v_change.oauth_client_id,
    v_change.grant_revision, v_change.capability_manifest_revision,
    v_change.exposure_revision, 'commit_day_closeout', v_change.preview_hash,
    v_receipt_hash, v_result
  );

  return v_result;
end;
$function$;

create or replace function public.consume_agent_day_closeout_prepare_rate_limit_as_system(
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
     or p_grant_id is null
     or p_actor_user_id is null
     or p_company_id is null
     or p_capability_id is distinct from 'prepare_day_closeout'
     or p_policy_id is distinct from
       'mcp-day-closeout-prepare:2026-08-30.v1'
     or p_requested_units is distinct from 1
     or p_protocol_era is null
     or p_protocol_era not in ('legacy', 'modern') then
    raise exception 'agent_day_closeout_rate_limit_request_invalid'
      using errcode = '22023';
  end if;

  select client.client_id into v_client_id
  from private.mcp_oauth_grants grant_record
  join private.mcp_oauth_clients client
    on client.client_id = grant_record.client_id
   and client.disabled_at is null
   and grant_record.scopes <@ client.scope_ceiling
   and grant_record.exposure_revision = client.exposure_revision
   and grant_record.consent_catalog_revision =
     client.consent_catalog_revision
  where grant_record.id = p_grant_id
    and grant_record.user_id = p_actor_user_id
    and grant_record.company_id = p_company_id
    and grant_record.revoked_at is null
    and grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'
    and 'ops.operations.prepare' = any(grant_record.scopes);
  if not found then
    raise exception 'agent_day_closeout_rate_limit_binding_invalid'
      using errcode = '42501';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from statement_timestamp()) /
      v_window_seconds) * v_window_seconds
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
  if v_locked_count is distinct from 3 then
    raise exception 'agent_day_closeout_rate_limit_bucket_collision'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from private.agent_mcp_rate_limit_buckets bucket
    where (
      bucket.bucket_digest = v_actor_digest
      and (
        bucket.bucket_kind is distinct from 'actor'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    ) or (
      bucket.bucket_digest = v_grant_digest
      and (
        bucket.bucket_kind is distinct from 'grant'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    ) or (
      bucket.bucket_digest = v_company_digest
      and (
        bucket.bucket_kind is distinct from 'company'
        or bucket.policy_id is distinct from p_policy_id
        or bucket.window_start is distinct from v_window_start
        or bucket.expires_at is distinct from v_expiry
      )
    )
  ) then
    raise exception 'agent_day_closeout_rate_limit_bucket_collision'
      using errcode = '55000';
  end if;

  select bool_and(
      bucket.units_used + p_requested_units <= case bucket.bucket_kind
        when 'actor' then v_actor_limit
        when 'grant' then v_grant_limit
        when 'company' then v_company_limit
      end
    )
    into v_allowed
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
      end - bucket.units_used)::integer
      into v_remaining
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

revoke all on function public.inspect_agent_day_closeout_correspondence_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.inspect_agent_day_closeout_correspondence_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.resolve_agent_day_closeout_timezone_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.resolve_agent_day_closeout_timezone_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text
) to service_role;

revoke all on function public.persist_agent_day_closeout_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_agent_day_closeout_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, date, text, text,
  text, jsonb
) to service_role;

revoke all on function public.commit_agent_day_closeout_as_actor(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.commit_agent_day_closeout_as_actor(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

revoke all on function public.consume_agent_day_closeout_prepare_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.consume_agent_day_closeout_prepare_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) to service_role;

comment on function public.commit_agent_day_closeout_as_actor(
  uuid, uuid, uuid, uuid, text, text
) is 'Exact Firebase-authenticated approval boundary. Files one prepared closeout inside OPS only; sends no messages and moves no money.';
