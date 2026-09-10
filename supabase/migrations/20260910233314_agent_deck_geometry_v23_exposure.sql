-- V23 is exactly the V14 tool/scope authority with deck geometry result v2.
-- Captured production definitions/ACLs checked read-only on 2026-09-10.
-- No client, grant, token, consent, business row or immutable trigger is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE r record; v_proc record; v_applied boolean; v_wrapper oid; v_effect_before text; v_policy_before jsonb;
BEGIN
 select private.agent_customer_update_effect_revision() into v_effect_before;
 select jsonb_agg(to_jsonb(policy) order by policy.revision) into v_policy_before from private.agent_customer_update_policy policy;
 if current_user <> 'postgres' then raise exception 'DECK_V23_MIGRATION_OWNER_INVALID'; end if;
 select md5(pg_get_functiondef(to_regprocedure('public.resolve_mcp_oauth_access_token_as_system(text,text)')))='4410e5660a3e619b356006a401e18795' into v_applied;
 v_applied:=coalesce(v_applied,false);
 for r in select * from (values
('private.enforce_mcp_oauth_consent_immutability()','aef4c6c52e82481b5089e1c806f71112','aef4c6c52e82481b5089e1c806f71112',true,'{postgres=X/postgres}','["search_path=pg_catalog, private, pg_temp"]'::jsonb),
('private.mcp_oauth_labels_for_scopes(text[], text)','d9c102fabb599ff3e04c4caf61006207','d9c102fabb599ff3e04c4caf61006207',false,'{postgres=X/postgres}','["search_path=\"\""]'::jsonb),
('private.mcp_oauth_scope_array_is_valid(text[])','eb4815de58d200ed9ee5917e3a06593f','eb4815de58d200ed9ee5917e3a06593f',false,'{postgres=X/postgres}','["search_path=pg_catalog, pg_temp"]'::jsonb),
('public.resolve_mcp_oauth_access_token_as_system(text)','54cfa8935b6faef2ceefecbb1e8147b3','54cfa8935b6faef2ceefecbb1e8147b3',true,'{postgres=X/postgres,service_role=X/postgres}','["search_path=pg_catalog, public, private, pg_temp"]'::jsonb),
('public.resolve_mcp_oauth_access_token_as_system(text, text)','2c3728cc3bdf413c78bdf9da13baa74e','4410e5660a3e619b356006a401e18795',true,'{postgres=X/postgres,service_role=X/postgres}','["search_path=\"\""]'::jsonb),
('public.rotate_mcp_oauth_refresh_token_as_system(text, uuid, text[], text, text, timestamp with time zone, timestamp with time zone)','05198075d40718d61cef9070ef763951','05198075d40718d61cef9070ef763951',true,'{postgres=X/postgres,service_role=X/postgres}','["search_path=pg_catalog, public, private, pg_temp"]'::jsonb),
('public.rotate_mcp_oauth_refresh_token_without_v3_canary(text, uuid, text[], text, text, timestamp with time zone, timestamp with time zone)','5fce37df94ff6a755c9c56e540fa244b','5fce37df94ff6a755c9c56e540fa244b',true,'{postgres=X/postgres}','["search_path=pg_catalog, public, private, pg_temp"]'::jsonb),
('private.agent_customer_update_reauthorize(private.agent_customer_updates)','4b5395c8b774d1c1a448cbe45b254cfe','9026756829ccbc97cff433551d6f07c3',true,'{postgres=X/postgres}','["search_path=\"\""]'::jsonb),
('private.assert_agent_customer_update_authority(uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text)','852bdb66015ff700499b3c9027a481fc','9c3018d4a129c70db0ea1edac8c6dc21',true,'{postgres=X/postgres}','["search_path=\"\""]'::jsonb),
('public.consume_agent_customer_update_prepare_rate_limit_as_system(text, uuid, uuid, uuid, text, text, integer, text)','2629ff74f044a6e00d824a68ddab3643','7c6a7840a52ccec06e05fa717cca8f51',true,'{postgres=X/postgres,service_role=X/postgres}','["search_path=\"\""]'::jsonb),
('public.prepare_agent_customer_update_as_system(uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text, text, jsonb, timestamp with time zone)','b0929ffca87e74056ce779362fd6aedc','b0929ffca87e74056ce779362fd6aedc',true,'{postgres=X/postgres,service_role=X/postgres}','["search_path=\"\""]'::jsonb),
('private.agent_customer_update_effect_revision()','e8e1a68792169851c24893f8e30d8ceb','e8e1a68792169851c24893f8e30d8ceb',true,'{postgres=X/postgres}','["search_path=\"\""]'::jsonb)) expected(signature,before_md5,after_md5,security_definer,acl,config)
 loop
   select proc.*,pg_get_userbyid(proc.proowner) owner_name into v_proc from pg_proc proc where proc.oid=to_regprocedure(r.signature);
   if not found or v_proc.owner_name <> 'postgres' or v_proc.prosecdef is distinct from r.security_definer
      or v_proc.proacl::text is distinct from r.acl or to_jsonb(v_proc.proconfig) is distinct from r.config
      or md5(pg_get_functiondef(v_proc.oid)) is distinct from (case when v_applied then r.after_md5 else r.before_md5 end) then
     raise exception 'DECK_V23_BASELINE_OR_ACL_MISMATCH: %',r.signature;
   end if;
 end loop;
 -- Exact immutable snapshot triggers must remain enabled and attached to the
 -- captured function. Fail closed rather than weakening custody to repin rows.
 for r in select * from (values
 ('private.mcp_oauth_clients','mcp_oauth_clients_immutable_ceiling'),
 ('private.mcp_oauth_grants','mcp_oauth_grants_immutable_consent'),
 ('private.mcp_oauth_authorization_codes','mcp_oauth_codes_immutable_consent'),
 ('private.mcp_oauth_consent_previews','mcp_oauth_consent_previews_immutable')
 ) expected(relation_name,trigger_name)
 loop
   if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(r.relation_name) and t.tgname=r.trigger_name and t.tgenabled='O' and t.tgtype=19 and t.tgnargs=0 and t.tgattr::text='' and octet_length(t.tgargs)=0 and t.tgqual is null and not t.tgisinternal and t.tgfoid='private.enforce_mcp_oauth_consent_immutability()'::regprocedure) then
     raise exception 'DECK_V23_IMMUTABLE_TRIGGER_MISMATCH: %',r.trigger_name;
   end if;
 end loop;
 v_wrapper:=to_regprocedure('public.prepare_agent_customer_update_for_grant_as_system(uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text, jsonb, timestamp with time zone)');
 if v_applied then
   if v_wrapper is null or not exists(select 1 from pg_proc p where p.oid=v_wrapper and md5(pg_get_functiondef(p.oid))='9e35b36183981e0f0b4de9a7d60d8403' and p.prosecdef and p.proconfig=array['search_path=""'] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and pg_get_userbyid(p.proowner)='postgres') then
      raise exception 'DECK_V23_WRAPPER_MISMATCH';
   end if;
   return;
 end if;
 if v_wrapper is not null then raise exception 'DECK_V23_WRAPPER_ALREADY_EXISTS'; end if;
 -- Both trial effect seals include all public/private functions. Do not stale a
 -- running trial or silently reseal it. SHARE locks block binding insert/update
 -- until commit; expired/disabled rows and all existing policy seals stay intact.
 LOCK TABLE private.agent_catalog_trial_bindings, private.mcp_oauth_canary_bindings IN SHARE MODE;
 if exists(select 1 from private.agent_catalog_trial_bindings where disabled_at is null and expires_at>clock_timestamp())
    or exists(select 1 from private.mcp_oauth_canary_bindings where exposure_revision='2026-09-07.mcp-exposure.v17' and disabled_at is null and expires_at>clock_timestamp()) then
   raise exception 'DECK_V23_ACTIVE_TRIAL_REQUIRES_SEPARATE_ROLLOUT';
 end if;
 EXECUTE $definition0$
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
       '2026-08-29.mcp-exposure.v2', '2026-09-04.mcp-exposure.v14', '2026-09-10.mcp-exposure.v23') then
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
        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision='2026-09-08.mcp-exposure.v19' and grant_record.consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
            and client_record.scope_ceiling=private.agent_catalog_trial_scopes())
        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision='2026-09-07.mcp-exposure.v17' and grant_record.consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12'
            and client_record.scope_ceiling=array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read']::text[])
        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.consent_catalog_revision = '2026-09-04.mcp-consent-catalog.v9'
            and cardinality(client_record.scope_ceiling)>0
            and client_record.scope_ceiling <@ array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read']::text[])
      )
      and (
        grant_record.exposure_revision not in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19')
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
$definition0$;
 EXECUTE $definition1$
CREATE OR REPLACE FUNCTION private.agent_customer_update_reauthorize(p_update private.agent_customer_updates)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_exposure_revision text;
begin
 select grant_record.exposure_revision into v_exposure_revision
 from private.mcp_oauth_grants grant_record
 where grant_record.id=p_update.oauth_grant_id
   and grant_record.user_id=p_update.actor_user_id
   and grant_record.company_id=p_update.company_id
   and grant_record.client_id=p_update.oauth_client_id
   and grant_record.revision=p_update.authority->>'grant_revision';
 perform private.assert_agent_customer_update_authority(p_update.actor_user_id,p_update.company_id,p_update.oauth_grant_id,p_update.oauth_client_id,
 p_update.authority->>'grant_revision',array(select jsonb_array_elements_text(p_update.authority->'scopes')),
 p_update.authority->>'permission_revision',array(select jsonb_array_elements_text(p_update.authority->'permission_keys')),
 '2026-09-04.capability-manifest.v20',v_exposure_revision,'prepare_customer_update','prepare_customer_update:2026-09-04.v1');
 if not private.agent_user_can_access_entity(p_update.actor_user_id,p_update.company_id,'opportunity',(p_update.request->>'opportunity_id')::uuid,'view')
 or not private.agent_user_can_access_entity(p_update.actor_user_id,p_update.company_id,'opportunity',(p_update.request->>'opportunity_id')::uuid,'edit') then
 raise exception 'AGENT_CUSTOMER_UPDATE_AUTHORITY_DENIED' using errcode='42501'; end if;
 if p_update.request ? 'customer' and (not public.has_permission(p_update.actor_user_id,'clients.view','all') or not public.has_permission(p_update.actor_user_id,'clients.edit','all') or not private.agent_user_can_access_entity(p_update.actor_user_id,p_update.company_id,'client',(p_update.request#>>'{customer,id}')::uuid,'view')
 or not private.agent_user_can_access_entity(p_update.actor_user_id,p_update.company_id,'client',(p_update.request#>>'{customer,id}')::uuid,'edit')) then
 raise exception 'AGENT_CUSTOMER_UPDATE_AUTHORITY_DENIED' using errcode='42501'; end if;
 if p_update.request->'changes' ? 'assigned_to' and not public.has_permission(p_update.actor_user_id,'pipeline.assign','all') then
 raise exception 'AGENT_CUSTOMER_UPDATE_AUTHORITY_DENIED' using errcode='42501'; end if;
end $function$;
$definition1$;
 EXECUTE $definition2$
CREATE OR REPLACE FUNCTION private.assert_agent_customer_update_authority(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_manifest_revision text, p_exposure_revision text, p_capability_id text, p_capability_revision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
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
     or p_exposure_revision is null or p_exposure_revision not in
       ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
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
     and client_record.exposure_revision = p_exposure_revision
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
      and grant_record.exposure_revision = p_exposure_revision
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
$definition2$;
 EXECUTE $definition3$
CREATE OR REPLACE FUNCTION public.consume_agent_customer_update_prepare_rate_limit_as_system(p_request_id text, p_grant_id uuid, p_actor_user_id uuid, p_company_id uuid, p_capability_id text, p_policy_id text, p_requested_units integer, p_protocol_era text)
 RETURNS TABLE(allowed boolean, remaining_units integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or p_grant_id is null or p_actor_user_id is null or p_company_id is null
     or p_capability_id is distinct from
       'prepare_customer_update'
     or p_policy_id is distinct from
       'mcp-customer-update-prepare:2026-09-04.v1'
     or p_requested_units is distinct from 1
     or p_protocol_era not in ('legacy','modern') then
    raise exception 'AGENT_CUSTOMER_UPDATE_RATE_LIMIT_REQUEST_INVALID'
      using errcode = '22023';
  end if;
  select client.client_id into v_client_id
  from private.mcp_oauth_grants grant_record
  join private.mcp_oauth_clients client
    on client.client_id=grant_record.client_id
   and client.disabled_at is null
   and grant_record.scopes <@ client.scope_ceiling
   and grant_record.exposure_revision=client.exposure_revision
   and grant_record.consent_catalog_revision=client.consent_catalog_revision
  where grant_record.id=p_grant_id
    and grant_record.user_id=p_actor_user_id
    and grant_record.company_id=p_company_id
    and grant_record.revoked_at is null
    and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
    and 'ops.customers.prepare'=any(grant_record.scopes);
  if not found then
    raise exception 'AGENT_CUSTOMER_UPDATE_RATE_LIMIT_BINDING_INVALID'
      using errcode = '42501';
  end if;
  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.statement_timestamp()) /
      v_window_seconds) * v_window_seconds
  );
  v_reset_at := v_window_start + pg_catalog.make_interval(
    secs => v_window_seconds
  );
  v_expiry := v_reset_at + interval '5 minutes';
  perform private.prune_agent_mcp_rate_limit_buckets(64);
  v_actor_digest := private.agent_mcp_rate_limit_bucket_digest(
    'actor',p_company_id,p_actor_user_id,null,p_capability_id,p_policy_id,
    v_window_start
  );
  v_grant_digest := private.agent_mcp_rate_limit_bucket_digest(
    'grant',p_company_id,p_actor_user_id,p_grant_id,p_capability_id,p_policy_id,
    v_window_start
  );
  v_company_digest := private.agent_mcp_rate_limit_bucket_digest(
    'company',p_company_id,null,null,p_capability_id,p_policy_id,v_window_start
  );
  insert into private.agent_mcp_rate_limit_buckets (
    bucket_digest,bucket_kind,policy_id,window_start,units_used,expires_at
  ) values
    (v_actor_digest,'actor',p_policy_id,v_window_start,0,v_expiry),
    (v_grant_digest,'grant',p_policy_id,v_window_start,0,v_expiry),
    (v_company_digest,'company',p_policy_id,v_window_start,0,v_expiry)
  on conflict (bucket_digest) do nothing;
  perform 1 from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,v_grant_digest,v_company_digest
  ) order by bucket.bucket_digest for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count is distinct from 3 or exists (
    select 1 from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    ) and (
      bucket.policy_id is distinct from p_policy_id
      or bucket.window_start is distinct from v_window_start
      or bucket.expires_at is distinct from v_expiry
    )
  ) then
    raise exception 'AGENT_CUSTOMER_UPDATE_RATE_LIMIT_BUCKET_COLLISION'
      using errcode = '55000';
  end if;
  select pg_catalog.bool_and(
    bucket.units_used + p_requested_units <= case bucket.bucket_kind
      when 'actor' then v_actor_limit when 'grant' then v_grant_limit
      when 'company' then v_company_limit end
  ) into v_allowed
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    v_actor_digest,v_grant_digest,v_company_digest
  );
  if v_allowed then
    update private.agent_mcp_rate_limit_buckets bucket
    set units_used=bucket.units_used+p_requested_units
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    );
    select pg_catalog.min(case bucket.bucket_kind
      when 'actor' then v_actor_limit when 'grant' then v_grant_limit
      when 'company' then v_company_limit end - bucket.units_used)::integer
    into v_remaining
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest in (
      v_actor_digest,v_grant_digest,v_company_digest
    );
  else
    v_remaining := 0;
    insert into private.mcp_request_audit (
      request_id,grant_id,client_id,actor_user_id,company_id,tool,
      protocol_era,outcome,error_code,input_sha256,result_bytes,latency_ms
    ) values (
      p_request_id,p_grant_id,v_client_id,p_actor_user_id,p_company_id,
      p_capability_id,p_protocol_era,'rate_limited','RATE_LIMITED',
      null,null,null
    );
  end if;
  return query select v_allowed,v_remaining,v_reset_at;
end;
$function$;
$definition3$;
 EXECUTE $definition_wrapper$
CREATE FUNCTION public.prepare_agent_customer_update_for_grant_as_system(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_manifest_revision text, p_capability_id text, p_capability_revision text, p_request_id text, p_request jsonb, p_observed_at timestamp with time zone) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $wrapper$
declare v_exposure_revision text;
begin
 if auth.role() is distinct from 'service_role' then
   raise exception 'access_denied' using errcode='42501';
 end if;
 -- Read the immutable exposure without an early lock. The original prepare
 -- revalidates current grant/client state under the canonical company lock order.
 select grant_record.exposure_revision into v_exposure_revision
 from private.mcp_oauth_grants grant_record
 join private.mcp_oauth_clients client_record
   on client_record.client_id=grant_record.client_id
 where grant_record.id=p_oauth_grant_id
   and grant_record.user_id=p_actor_user_id
   and grant_record.company_id=p_company_id
   and grant_record.client_id=p_oauth_client_id
   and grant_record.revision=p_grant_revision
   and grant_record.scopes=p_granted_scope_ceiling
   and grant_record.exposure_revision=client_record.exposure_revision
   and grant_record.consent_catalog_revision=client_record.consent_catalog_revision
   and grant_record.revoked_at is null and client_record.disabled_at is null
   and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23');
 if not found then
   raise exception 'AGENT_CUSTOMER_UPDATE_GRANT_STALE_OR_DENIED' using errcode='42501';
 end if;
 -- Existing authority, policy, evidence, no-change, idempotency and preview
 -- checks run unchanged, now against the actual grant exposure.
 return public.prepare_agent_customer_update_as_system(
   p_actor_user_id,p_company_id,p_oauth_grant_id,p_oauth_client_id,
   p_grant_revision,p_granted_scope_ceiling,p_permission_snapshot_revision,
   p_registered_permission_keys,p_capability_manifest_revision,v_exposure_revision,
   p_capability_id,p_capability_revision,p_request_id,p_request,p_observed_at);
end
$wrapper$;
$definition_wrapper$;
 EXECUTE 'REVOKE ALL ON FUNCTION public.prepare_agent_customer_update_for_grant_as_system(uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text, jsonb, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.prepare_agent_customer_update_for_grant_as_system(uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text, jsonb, timestamp with time zone) TO service_role';
 if private.agent_customer_update_effect_revision() is distinct from v_effect_before or (select jsonb_agg(to_jsonb(policy) order by policy.revision) from private.agent_customer_update_policy policy) is distinct from v_policy_before then raise exception 'DECK_V23_BUSINESS_EFFECT_POLICY_CHANGED'; end if;
END
$migration$;
COMMIT;
