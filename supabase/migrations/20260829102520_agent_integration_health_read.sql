begin;

do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.users'),
      ('table', 'public.email_connections'),
      ('table', 'public.accounting_connections')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_integration_health_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop function if exists public.read_agent_integration_health_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,jsonb,integer
);
drop function if exists private.agent_p2_integration_health_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer
);

create or replace function private.agent_p2_integration_health_summary_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_settings_integrations_scope text,
  p_accounting_scope text,
  p_email_scope text,
  p_selections jsonb,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_read_at timestamp with time zone;
  v_has_accounting boolean;
  v_has_mailbox boolean;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_required_oauth_scopes is distinct from
       array['ops.integrations.read']::text[]
     or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true
     or p_settings_integrations_scope is distinct from 'all'
     or p_selections is null
     or pg_catalog.jsonb_typeof(p_selections) <> 'array'
     or pg_catalog.jsonb_array_length(p_selections) not between 1 and 4
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_integration_health_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
    where scope.value is null
       or scope.value is distinct from pg_catalog.btrim(scope.value)
       or pg_catalog.octet_length(scope.value) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct scope.value)
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
  or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(scope.value order by scope.value)
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  )
  or exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
    where key.value is null
       or key.value is distinct from pg_catalog.btrim(key.value)
       or pg_catalog.octet_length(key.value) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct key.value)
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from (
    select pg_catalog.array_agg(key.value order by key.value)
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  )
  or not ('settings.integrations' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_integration_health_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selections) selection(value)
    where pg_catalog.jsonb_typeof(selection.value) <> 'object'
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_object_keys(selection.value) key(value)
       ) <> 2
       or not (selection.value ? 'integration_type')
       or not (selection.value ? 'provider')
       or pg_catalog.jsonb_typeof(selection.value -> 'integration_type') <>
         'string'
       or pg_catalog.jsonb_typeof(selection.value -> 'provider') <> 'string'
       or not (
         selection.value ->> 'integration_type' = 'accounting'
         and selection.value ->> 'provider' in ('quickbooks', 'sage')
         or selection.value ->> 'integration_type' = 'mailbox'
         and selection.value ->> 'provider' in ('gmail', 'microsoft365')
       )
  ) or exists (
    with ordered as (
      select selection.ordinality,
             (selection.value ->> 'integration_type') || E'\\000' ||
               (selection.value ->> 'provider') as ordering_key,
             pg_catalog.lag(
               (selection.value ->> 'integration_type') || E'\\000' ||
                 (selection.value ->> 'provider')
             ) over (order by selection.ordinality) as previous_key
      from pg_catalog.jsonb_array_elements(p_selections)
        with ordinality selection(value, ordinality)
    )
    select 1
    from ordered
    where ordered.previous_key collate "C" >= ordered.ordering_key collate "C"
  ) then
    raise exception 'invalid_agent_integration_health_request'
      using errcode = '22023';
  end if;

  select pg_catalog.bool_or(
           selection.value ->> 'integration_type' = 'accounting'
         ),
         pg_catalog.bool_or(
           selection.value ->> 'integration_type' = 'mailbox'
         )
    into v_has_accounting, v_has_mailbox
  from pg_catalog.jsonb_array_elements(p_selections) selection(value);

  if (v_has_accounting and p_accounting_scope is distinct from 'all')
     or (not v_has_accounting and p_accounting_scope is not null)
     or (v_has_mailbox and p_email_scope not in ('all', 'own'))
     or (not v_has_mailbox and p_email_scope is not null)
     or (v_has_accounting and
       not ('accounting.view' = any(p_registered_permission_keys)))
     or (v_has_mailbox and
       not ('email.view' = any(p_registered_permission_keys))) then
    raise exception 'invalid_agent_integration_health_request'
      using errcode = '22023';
  end if;

  v_read_at := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.statement_timestamp()
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' =
               'settings.integrations'
           ) as settings_integrations_scope,
           case when v_has_accounting then
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'accounting.view'
             )
           else null::text end as accounting_scope,
           case when v_has_mailbox then
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'email.view'
             )
           else null::text end as email_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select company_revision.source_revision as company_revision,
           integration_revision.source_revision as integration_revision,
           v_read_at as read_at
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.scopes = p_granted_scope_ceiling
     and grant_row.revoked_at is null
     and p_required_oauth_scopes <@ grant_row.scopes
     and grant_row.accepted_labels =
       private.mcp_oauth_labels_for_scopes(
         grant_row.scopes,
         grant_row.consent_catalog_revision
       )
    join private.mcp_oauth_clients oauth_client
      on oauth_client.client_id = grant_row.client_id
     and oauth_client.disabled_at is null
     and grant_row.scopes <@ oauth_client.scope_ceiling
     and grant_row.consent_catalog_revision =
       oauth_client.consent_catalog_revision
     and grant_row.exposure_revision = oauth_client.exposure_revision
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join public.users actor
      on actor.id = p_actor_user_id
     and actor.company_id = p_company_id
     and actor.deleted_at is null
     and actor.is_active is true
    join private.agent_read_domain_revisions company_revision
      on company_revision.company_id = p_company_id
     and company_revision.domain = 'company'
     and company_revision.source_revision between 0 and 9007199254740991
    join private.agent_read_domain_revisions integration_revision
      on integration_revision.company_id = p_company_id
     and integration_revision.domain = 'integrations'
     and integration_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.settings_integrations_scope =
            p_settings_integrations_scope
      and authority.accounting_scope is not distinct from p_accounting_scope
      and authority.email_scope is not distinct from p_email_scope
  ), selections as materialized (
    select selection.ordinality::integer as ordinal,
           selection.value ->> 'integration_type' as integration_type,
           selection.value ->> 'provider' as provider,
           selection.value as selection
    from read_context context
    cross join lateral pg_catalog.jsonb_array_elements(p_selections)
      with ordinality selection(value, ordinality)
  ), mailbox_source_gate as materialized (
    select connection.id,
           connection.type::text as mailbox_type,
           connection.user_id,
           connection.provider,
           connection.status,
           connection.sync_enabled,
           connection.webhook_subscription_id,
           connection.webhook_expires_at,
           connection.last_synced_at,
           connection.provider_snapshot_at,
           connection.granted_scopes,
           connection.created_at
    from read_context context
    join public.email_connections connection
      on connection.company_id = p_company_id::text
     and exists (
       select 1
       from selections selection
       where selection.integration_type = 'mailbox'
         and selection.provider = connection.provider
     )
     and (
       p_email_scope = 'all'
       or (
         connection.type::text = 'individual'
         and connection.user_id = p_actor_user_id::text
       )
     )
    order by connection.provider collate "C", connection.id
    limit p_source_limit
  ), mailbox_source_state as materialized (
    select pg_catalog.count(*)::integer as inspected,
           pg_catalog.count(*) >= p_source_limit as exceeded,
           coalesce(pg_catalog.bool_or(
             source.provider not in ('gmail', 'microsoft365')
             or source.provider is distinct from pg_catalog.btrim(source.provider)
             or source.mailbox_type not in ('company', 'individual')
             or source.status not in (
               'active',
               'paused',
               'error',
               'setup_incomplete',
               'needs_reconnect',
               'disconnected'
             )
             or source.status is distinct from pg_catalog.btrim(source.status)
             or source.mailbox_type = 'individual' and (
               source.user_id is null
               or source.user_id !~
                 '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             )
             or source.webhook_subscription_id is not null and (
               source.webhook_subscription_id is distinct from
                 pg_catalog.btrim(source.webhook_subscription_id)
               or pg_catalog.octet_length(source.webhook_subscription_id)
                 not between 1 and 2048
             )
             or source.webhook_expires_at is not null and
               not pg_catalog.isfinite(source.webhook_expires_at)
             or source.last_synced_at is not null and
               not pg_catalog.isfinite(source.last_synced_at)
             or source.provider_snapshot_at is not null and
               not pg_catalog.isfinite(source.provider_snapshot_at)
             or coalesce(
               source.provider_snapshot_at,
               source.last_synced_at
             ) > context.read_at
             or source.status = 'active' and source.sync_enabled and
               source.created_at is null
             or source.created_at is not null and
               not pg_catalog.isfinite(source.created_at)
             or pg_catalog.cardinality(source.granted_scopes) > 64
             or exists (
               select 1
               from pg_catalog.unnest(source.granted_scopes) scope(value)
               where scope.value is null
                  or scope.value is distinct from pg_catalog.btrim(scope.value)
                  or pg_catalog.octet_length(scope.value) not between 1 and 512
             )
           ), false) as source_invalid
    from mailbox_source_gate source
    cross join read_context context
  ), accounting_source_gate as materialized (
    select connection.id,
           connection.provider,
           connection.is_connected,
           connection.sync_enabled,
           connection.last_sync_at
    from read_context context
    join public.accounting_connections connection
      on connection.company_id = p_company_id::text
     and connection.provider_environment = 'production'
     and exists (
       select 1
       from selections selection
       where selection.integration_type = 'accounting'
         and selection.provider = connection.provider
     )
    order by connection.provider collate "C", connection.id
    limit p_source_limit
  ), accounting_source_state as materialized (
    select pg_catalog.count(*)::integer as inspected,
           pg_catalog.count(*) >= p_source_limit as exceeded,
           coalesce(pg_catalog.bool_or(
             source.provider not in ('quickbooks', 'sage')
             or source.provider is distinct from pg_catalog.btrim(source.provider)
             or source.last_sync_at is not null and (
               not pg_catalog.isfinite(source.last_sync_at)
               or source.last_sync_at > context.read_at
             )
           ), false)
           or exists (
             select 1
             from accounting_source_gate duplicate
             group by duplicate.provider
             having pg_catalog.count(*) > 1
           ) as source_invalid
    from accounting_source_gate source
    cross join read_context context
  ), mailbox_classification as materialized (
    select source.id,
           source.provider,
           case
             when source.status = 'needs_reconnect' then 'needs_reconnect'
             when source.status = 'error' then 'provider_error'
             when source.status = 'setup_incomplete' then 'setup_incomplete'
             when source.status = 'active'
              and source.sync_enabled
              and source.webhook_subscription_id is null
              and context.read_at - source.created_at > interval '24 hours'
               then 'webhook_setup_failed'
             when source.status = 'active'
              and source.sync_enabled
              and source.webhook_expires_at < context.read_at
               then 'webhook_expired'
             when source.status = 'active'
              and source.sync_enabled
              and coalesce(
                source.provider_snapshot_at,
                source.last_synced_at
              ) is not null
              and context.read_at - coalesce(
                source.provider_snapshot_at,
                source.last_synced_at
              ) > interval '13 hours'
               then 'sync_stale'
             when source.status = 'paused' then 'operator_paused'
             when source.status = 'disconnected' then 'disconnected'
             when source.status = 'active' and not source.sync_enabled
               then 'sync_disabled'
             when source.status = 'active' and coalesce(
               source.provider_snapshot_at,
               source.last_synced_at
             ) is null then 'first_sync_pending'
             else 'connected'
           end as reason_code,
           coalesce(
             source.provider_snapshot_at,
             source.last_synced_at
           ) as progress_at,
           case when source.provider = 'gmail' then coalesce(
             source.granted_scopes @> array[
               'https://www.googleapis.com/auth/calendar.events'
             ]::text[]
             or source.granted_scopes @> array[
               'https://www.googleapis.com/auth/calendar'
             ]::text[],
             false
           ) else false end as calendar_consent_granted
    from mailbox_source_gate source
    cross join read_context context
    cross join mailbox_source_state state
    where not state.exceeded and not state.source_invalid
  ), mailbox_ranked as materialized (
    select classified.*,
           case classified.reason_code
             when 'needs_reconnect' then 100
             when 'provider_error' then 95
             when 'webhook_expired' then 90
             when 'webhook_setup_failed' then 85
             when 'setup_incomplete' then 80
             when 'sync_stale' then 70
             when 'operator_paused' then 60
             when 'disconnected' then 50
             when 'sync_disabled' then 40
             when 'first_sync_pending' then 30
             else 10
           end as severity
    from mailbox_classification classified
  ), item_projection as materialized (
    select selection.ordinal,
           selection.selection,
           -- Accounting last_sync_at can lag successful runs and has no
           -- authoritative stale threshold. Never infer mailbox's 13h rule.
           case when selection.integration_type = 'accounting' then
             pg_catalog.jsonb_build_object(
               'integration_type', 'accounting',
               'provider', selection.provider,
               'connection_state', case
                 when accounting.id is null then 'not_configured'
                 when accounting.is_connected then 'active'
                 else 'disabled'
               end,
               'sync_state', case
                 when accounting.id is null or not accounting.is_connected
                   then 'not_available'
                 when not accounting.sync_enabled then 'disabled'
                 when accounting.last_sync_at is null then 'pending'
                 else 'healthy'
               end,
               'reason_code', case
                 when accounting.id is null then 'not_configured'
                 when not accounting.is_connected then 'disconnected'
                 when not accounting.sync_enabled then 'sync_disabled'
                 when accounting.last_sync_at is null then 'first_sync_pending'
                 else 'connected'
               end,
               'last_healthy_progress_at', case
                 when accounting.last_sync_at is null then null
                 else private.agent_rfc3339_utc(accounting.last_sync_at)
               end
             )
           else pg_catalog.jsonb_build_object(
             'integration_type', 'mailbox',
             'provider', selection.provider,
             'connection_state', case coalesce(mailbox.reason_code, 'not_configured')
               when 'not_configured' then 'not_configured'
               when 'connected' then 'active'
               when 'first_sync_pending' then 'active'
               when 'sync_disabled' then 'active'
               when 'needs_reconnect' then 'reconnect_required'
               when 'webhook_expired' then 'reconnect_required'
               when 'operator_paused' then 'disabled'
               when 'disconnected' then 'disabled'
               else 'attention_required'
             end,
             'sync_state', case coalesce(mailbox.reason_code, 'not_configured')
               when 'connected' then 'healthy'
               when 'first_sync_pending' then 'pending'
               when 'sync_disabled' then 'disabled'
               when 'sync_stale' then 'stale'
               else 'not_available'
             end,
             'reason_code', coalesce(mailbox.reason_code, 'not_configured'),
             'last_healthy_progress_at', case
               when mailbox.progress_at is null then null
               else private.agent_rfc3339_utc(mailbox.progress_at)
             end,
             'calendar_consent_granted', coalesce(
               mailbox_aggregate.calendar_consent_granted,
               false
             )
           ) end as item
    from selections selection
    left join lateral (
      select source.*
      from accounting_source_gate source
      cross join accounting_source_state state
      where selection.integration_type = 'accounting'
        and source.provider = selection.provider
        and not state.exceeded
        and not state.source_invalid
      order by source.id
      limit 1
    ) accounting on true
    left join lateral (
      select source.reason_code,
             source.progress_at
      from mailbox_ranked source
      where selection.integration_type = 'mailbox'
        and source.provider = selection.provider
      order by source.severity desc,
               source.progress_at asc nulls first,
               source.id
      limit 1
    ) mailbox on true
    left join lateral (
      select pg_catalog.bool_and(
               source.calendar_consent_granted
             ) as calendar_consent_granted
      from mailbox_ranked source
      where selection.integration_type = 'mailbox'
        and source.provider = selection.provider
    ) mailbox_aggregate on true
  ), proof_context as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_id', 'get_integration_health',
             'capability_revision',
               'get_integration_health:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'settings_integrations_scope',
               p_settings_integrations_scope,
             'accounting_scope', p_accounting_scope,
             'email_scope', p_email_scope,
             'selections', p_selections,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'domain', 'company',
                 'source_revision', context.company_revision
               ),
               pg_catalog.jsonb_build_object(
                 'domain', 'integrations',
                 'source_revision', context.integration_revision
               )
             ),
             'source_inspected', pg_catalog.jsonb_build_object(
               'accounting', accounting_state.inspected,
               'mailbox', mailbox_state.inspected
             )
           ) as value
    from read_context context
    cross join accounting_source_state accounting_state
    cross join mailbox_source_state mailbox_state
  ), packaged_rows as materialized (
    select item.ordinal,
           item.selection,
           item.item,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'integration_health_entity',
                     'item', item.item
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as proof_ref,
           'ops_evidence:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'integration_health_evidence',
                     'selection', item.selection
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_ref
    from item_projection item
    cross join proof_context context
  ), aggregate_rows as materialized (
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'item', row.item,
               'proof_ref', row.proof_ref,
               'evidence_ref', row.evidence_ref
             ) order by row.ordinal
           ) as rows,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'selection', row.selection,
               'proof_ref', row.proof_ref,
               'evidence_ref', row.evidence_ref
             ) order by row.ordinal
           ) as children,
           pg_catalog.count(*)::integer as returned_count
    from packaged_rows row
  ), final_projection as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'rows', aggregate.rows,
             'collection_proof_ref',
               'ops_proof:v1:' || pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     private.canonical_agent_projection_json(
                       context.value || pg_catalog.jsonb_build_object(
                         'proof_kind', 'integration_health_collection',
                         'returned_count', aggregate.returned_count,
                         'has_more', false,
                         'children', aggregate.children
                       )
                     ),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               ),
             '_source_bound',
               accounting_state.exceeded or mailbox_state.exceeded,
             '_source_invalid',
               accounting_state.source_invalid or mailbox_state.source_invalid
           ) as projection
    from proof_context context
    cross join aggregate_rows aggregate
    cross join accounting_source_state accounting_state
    cross join mailbox_source_state mailbox_state
  )
  select projection
    into v_result
  from final_projection;

  if v_result is null then
    raise exception 'agent_integration_health_not_authorized'
      using errcode = '42501';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_integration_health_source_query_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_integration_health_source_data_invalid'
      using errcode = '22000';
  end if;

  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_integration_health_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_integration_health_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_settings_integrations_scope text,
  p_accounting_scope text,
  p_email_scope text,
  p_selections jsonb,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_capability_id is distinct from 'get_integration_health'
     or p_capability_revision is distinct from
       'get_integration_health:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_integration_health_request'
      using errcode = '22023';
  end if;

  return private.agent_p2_integration_health_summary_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_required_oauth_scopes,
    p_settings_integrations_scope,
    p_accounting_scope,
    p_email_scope,
    p_selections,
    p_source_limit
  );
end;
$function$;

revoke all on function public.read_agent_integration_health_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,jsonb,integer
) from public, anon, authenticated, service_role;

alter function private.agent_p2_integration_health_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer
) owner to current_user;
alter function public.read_agent_integration_health_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,jsonb,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
    'public.read_agent_integration_health_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,jsonb,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_integration_health_acl_function_missing:%',
        v_signature;
    end if;

    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> function_row.proowner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_integration_health_acl_role_missing:%',
          v_signature;
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_integration_health_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,jsonb,integer
) to service_role;

do $postflight$
declare
  v_expected record;
  v_function_oid oid;
  v_actual_result text;
  v_function_acl aclitem[];
  v_function_owner oid;
  v_acl_entries text[];
  v_expected_acl text[];
  v_actual_signatures text[];
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ',
               ','
             ) || ')'
             order by namespace.nspname, function_row.proname,
               function_row.oid
           ),
           array[]::text[]
         )
    into v_actual_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where (
    namespace.nspname = 'private'
    and function_row.proname = 'agent_p2_integration_health_summary_v1'
  ) or (
    namespace.nspname = 'public'
    and function_row.proname = 'read_agent_integration_health_as_system'
  );

  if v_actual_signatures is distinct from array[
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
    'public.read_agent_integration_health_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,jsonb,integer)'
  ]::text[] then
    raise exception 'agent_integration_health_function_signature_set_failed';
  end if;

  for v_expected in
    select * from (values
      (
        'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
        false,
        false
      ),
      (
        'public.read_agent_integration_health_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,jsonb,integer)',
        true,
        true
      )
    ) shape(signature, security_definer, service_execute)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
    select pg_catalog.regexp_replace(
             pg_catalog.pg_get_function_result(function_row.oid),
             '[[:space:]]+',
             ' ',
             'g'
           ),
           function_row.proacl,
           function_row.proowner
      into v_actual_result, v_function_acl, v_function_owner
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid
      and function_row.proowner = current_user::regrole
      and language_row.lanname = 'plpgsql'
      and function_row.prokind = 'f'::"char"
      and not function_row.proisstrict
      and function_row.proparallel = 'u'::"char"
      and function_row.prosecdef = v_expected.security_definer
      and function_row.provolatile = 's'::"char"
      and pg_catalog.cardinality(function_row.proconfig) = 1
      and pg_catalog.replace(
        pg_catalog.regexp_replace(
          function_row.proconfig[1],
          '[[:space:]]+',
          '',
          'g'
        ),
        '""',
        ''
      ) = 'search_path=';

    if not found or v_actual_result is distinct from 'jsonb' then
      raise exception 'agent_integration_health_function_shape_failed:%',
        v_expected.signature;
    end if;

    select coalesce(
             pg_catalog.array_agg(entry.value order by entry.value),
             array[]::text[]
           )
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
        acl.is_grantable::text as value
      from pg_catalog.aclexplode(
        coalesce(
          v_function_acl,
          pg_catalog.acldefault('f', v_function_owner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) entry;

    v_expected_acl := case when v_expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_integration_health_function_acl_failed:%',
        v_expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
