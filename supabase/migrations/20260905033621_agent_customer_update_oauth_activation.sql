-- Approved Phase 12 activation. Preserve pinned read grants; add only exact v14/v9.
-- This changes no clients, grants, consent, business records or canary bindings.
begin;

CREATE OR REPLACE FUNCTION public.resolve_mcp_oauth_access_token_as_system(p_token_hash text, p_active_exposure_revision text)
 RETURNS TABLE(grant_id uuid, client_id uuid, client_name text, user_id uuid, company_id uuid, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, revision text, issuer text, audience text, expires_at timestamp with time zone, token_revoked boolean, grant_revoked boolean, client_disabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_active_exposure_revision is null or p_active_exposure_revision not in (
       '2026-08-29.mcp-exposure.v2', '2026-09-04.mcp-exposure.v14') then
    return;
  end if;

  return query
  with resolved as (
    select
      grant_record.id as grant_id,
      grant_record.client_id,
      client_record.client_name,
      grant_record.user_id,
      grant_record.company_id,
      grant_record.scopes,
      grant_record.accepted_labels,
      grant_record.consent_catalog_revision,
      grant_record.exposure_revision,
      grant_record.revision,
      token_record.issuer,
      token_record.audience,
      token_record.expires_at,
      token_record.revoked_at is not null as token_revoked,
      grant_record.revoked_at is not null as grant_revoked,
      client_record.disabled_at is not null as client_disabled,
      (
        token_record.revoked_at is null
        and grant_record.revoked_at is null
        and client_record.disabled_at is null
        and token_record.expires_at > statement_timestamp()
      ) as usable
    from private.mcp_oauth_tokens token_record
    join private.mcp_oauth_grants grant_record
      on grant_record.id = token_record.grant_id
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
    where token_record.token_hash = p_token_hash
      and token_record.kind = 'access'
      and grant_record.scopes <@ client_record.scope_ceiling
      and grant_record.exposure_revision = client_record.exposure_revision
      and grant_record.consent_catalog_revision = client_record.consent_catalog_revision
      and grant_record.accepted_labels = private.mcp_oauth_labels_for_scopes(
        grant_record.scopes, grant_record.consent_catalog_revision)
      and (
        (grant_record.exposure_revision in (
           '2026-08-22.mcp-exposure.v1', '2026-08-29.mcp-exposure.v2')
         and grant_record.consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v1')
        or (grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'
            and grant_record.consent_catalog_revision = '2026-08-30.mcp-consent-catalog.v2')
        or (p_active_exposure_revision = '2026-09-04.mcp-exposure.v14'
            and grant_record.exposure_revision = '2026-09-04.mcp-exposure.v14'
            and grant_record.consent_catalog_revision = '2026-09-04.mcp-consent-catalog.v9'
            and cardinality(client_record.scope_ceiling)>0
            and client_record.scope_ceiling <@ array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read']::text[])
      )
      and (
        grant_record.exposure_revision <>
          '2026-08-30.mcp-exposure.v3'
        or private.mcp_oauth_canary_is_current(
          grant_record.client_id,
          grant_record.user_id,
          grant_record.company_id,
          grant_record.exposure_revision,
          grant_record.consent_catalog_revision
        )
      )
  ),
  touched as (
    update private.mcp_oauth_grants grant_record
    set last_used_at = statement_timestamp()
    from resolved
    where grant_record.id = resolved.grant_id
      and resolved.usable
    returning grant_record.id
  )
  select
    resolved.grant_id,
    resolved.client_id,
    resolved.client_name,
    resolved.user_id,
    resolved.company_id,
    resolved.scopes,
    resolved.accepted_labels,
    resolved.consent_catalog_revision,
    resolved.exposure_revision,
    resolved.revision,
    resolved.issuer,
    resolved.audience,
    resolved.expires_at,
    resolved.token_revoked,
    resolved.grant_revoked,
    resolved.client_disabled
  from resolved;
end;
$function$;

revoke all on function public.resolve_mcp_oauth_access_token_as_system(text,text) from public,anon,authenticated;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text,text) to service_role;

-- A client may register a strict scope subset; required update scopes stay mandatory.
CREATE OR REPLACE FUNCTION private.assert_agent_customer_update_authority(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_manifest_revision text, p_exposure_revision text, p_capability_id text, p_capability_revision text)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_permission_revision text;
  v_required_permissions constant text[] := array['agent.review','pipeline.view','pipeline.edit','team.view'];
  v_required_scopes constant text[] := array['ops.jobs.read','ops.customers.read','ops.customers.prepare','ops.correspondence.read','ops.team.read'];
  v_exposure_scopes constant text[] := array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read'];
  v_required_permission_json jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_company_id is null
     or p_oauth_grant_id is null or p_oauth_client_id is null
     or nullif(pg_catalog.btrim(p_grant_revision),'') is null
     or p_granted_scope_ceiling is null
     or nullif(pg_catalog.btrim(p_permission_snapshot_revision),'') is null
     or p_registered_permission_keys is null
     or pg_catalog.cardinality(p_registered_permission_keys)
       not between 1 and 256
     or not v_required_permissions <@ p_registered_permission_keys
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(
         registry_key.value order by registry_key.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) registry_key
     )
     or exists (
       select 1
       from pg_catalog.unnest(
         p_registered_permission_keys
       ) registry_key(value)
       where registry_key.value is distinct from
               pg_catalog.btrim(registry_key.value)
          or pg_catalog.length(registry_key.value) > 128
          or registry_key.value !~
               '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
     )
     or p_capability_manifest_revision is distinct from
       '2026-09-04.capability-manifest.v20'
     or p_exposure_revision is distinct from
       '2026-09-04.mcp-exposure.v14'
     or p_capability_id is distinct from
       'prepare_customer_update'
     or p_capability_revision is distinct from
       'prepare_customer_update:2026-09-04.v1'
     or not v_required_scopes <@ p_granted_scope_ceiling then
    raise exception 'AGENT_CUSTOMER_UPDATE_AUTHORITY_REVISION_INVALID'
      using errcode = '42501';
  end if;

  -- Canonical company lock precedes authority/record locks. Tables fence role insertion phantoms.
  perform private.lock_lead_assignment_company(p_company_id);
  lock table public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides in share mode;
  perform 1 from public.companies where id=p_company_id for share;
  perform 1 from public.users where id=p_actor_user_id for share;
  perform 1 from private.mcp_oauth_clients where client_id=p_oauth_client_id for share;
  perform 1 from private.mcp_oauth_grants where id=p_oauth_grant_id for share;
  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'permission',required.permission,'scope','all'
             ) order by required.permission
           ),
           '[]'::jsonb
         )
    into v_required_permission_json
  from pg_catalog.unnest(v_required_permissions) required(permission);

  select authority.permission_snapshot_revision into v_permission_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,p_company_id,p_registered_permission_keys
  ) authority
  where authority.effective_permissions @> v_required_permission_json;
  if v_permission_revision is null
     or v_permission_revision is distinct from p_permission_snapshot_revision then
    raise exception 'AGENT_CUSTOMER_UPDATE_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and cardinality(client_record.scope_ceiling)>0
     and client_record.scope_ceiling <@ v_exposure_scopes
     and client_record.scope =
       pg_catalog.array_to_string(client_record.scope_ceiling,' ')
     and client_record.consent_catalog_revision =
       '2026-09-04.mcp-consent-catalog.v9'
     and client_record.exposure_revision =
       '2026-09-04.mcp-exposure.v14'
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
      and grant_record.consent_catalog_revision =
        '2026-09-04.mcp-consent-catalog.v9'
      and grant_record.exposure_revision = '2026-09-04.mcp-exposure.v14'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes,grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_CUSTOMER_UPDATE_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;
  return v_permission_revision;
end;
$function$;

commit;
