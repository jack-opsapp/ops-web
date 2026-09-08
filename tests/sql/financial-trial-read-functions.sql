CREATE OR REPLACE FUNCTION public.get_mcp_oauth_client_as_system(p_client_id uuid)
 RETURNS TABLE(client_id uuid, client_name text, redirect_uris text[], token_endpoint_auth_method text, scope text, scope_ceiling text[], consent_catalog_revision text, exposure_revision text, disabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return query
  select
    client.client_id,
    client.client_name,
    client.redirect_uris,
    client.token_endpoint_auth_method,
    client.scope,
    client.scope_ceiling,
    client.consent_catalog_revision,
    client.exposure_revision,
    client.disabled_at is not null
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_agent_actor_authority_as_system(p_actor_user_id uuid, p_company_id uuid, p_registered_permission_keys text[])
 RETURNS TABLE(actor_user_id uuid, company_id uuid, is_active boolean, is_admin boolean, role_ids uuid[], configured_permissions text[], effective_permissions jsonb, permission_snapshot_revision text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select authority.actor_user_id,
         authority.company_id,
         authority.is_active,
         authority.is_admin,
         authority.role_ids,
         authority.configured_permissions,
         authority.effective_permissions,
         authority.permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority;
end;
$function$
;
