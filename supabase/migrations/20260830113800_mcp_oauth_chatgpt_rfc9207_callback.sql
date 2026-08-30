-- Add ChatGPT's exact RFC 9207 stable callback without weakening redirect
-- binding for Claude or native Codex clients. The application advertises
-- issuer identification only when it returns the exact issuer on every
-- trusted success and error authorization response.

create or replace function public.register_mcp_oauth_client_as_system(
  p_client_name text,
  p_redirect_uris text[],
  p_scope text,
  p_scope_ceiling text[],
  p_consent_catalog_revision text,
  p_exposure_revision text,
  p_software_id text,
  p_software_version text
) returns table (
  client_id uuid,
  client_name text,
  redirect_uris text[],
  token_endpoint_auth_method text,
  grant_types text[],
  response_types text[],
  scope text,
  scope_ceiling text[],
  consent_catalog_revision text,
  exposure_revision text,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_uri text;
  v_claude_redirect_count integer := 0;
  v_chatgpt_redirect_count integer := 0;
  v_codex_redirect_count integer := 0;
  v_callback_family_count integer;
  v_codex_port integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_client_name is null or btrim(p_client_name) = ''
     or length(p_client_name) > 256 then
    raise exception 'mcp_oauth_client_name_invalid' using errcode = '22023';
  end if;
  if p_redirect_uris is null
     or cardinality(p_redirect_uris) not between 1 and 8
     or array_position(p_redirect_uris, null) is not null
     or cardinality(array(
       select distinct redirect_uri
       from unnest(p_redirect_uris) as redirect_uri
     )) <> cardinality(p_redirect_uris) then
    raise exception 'mcp_oauth_redirect_uris_invalid' using errcode = '22023';
  end if;

  foreach v_uri in array p_redirect_uris loop
    if v_uri = any (array[
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback'
    ]::text[]) then
      v_claude_redirect_count := v_claude_redirect_count + 1;
      continue;
    end if;

    if v_uri = 'https://chatgpt.com/connector_platform_oauth_redirect' then
      v_chatgpt_redirect_count := v_chatgpt_redirect_count + 1;
      continue;
    end if;

    if length(v_uri) > 2048
       or (v_uri collate "C") !~ '^http://127[.]0[.]0[.]1:([123456789][0123456789]{0,4})/callback/[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-]{8,128}$' then
      raise exception 'mcp_oauth_redirect_uri_invalid' using errcode = '22023';
    end if;
    v_codex_port := substring(
      (v_uri collate "C")
      from '^http://127[.]0[.]0[.]1:([123456789][0123456789]{0,4})/'
    )::integer;
    if v_codex_port not between 1 and 65535 then
      raise exception 'mcp_oauth_redirect_uri_invalid' using errcode = '22023';
    end if;
    v_codex_redirect_count := v_codex_redirect_count + 1;
  end loop;

  v_callback_family_count :=
    case when v_claude_redirect_count > 0 then 1 else 0 end
    + case when v_chatgpt_redirect_count > 0 then 1 else 0 end
    + case when v_codex_redirect_count > 0 then 1 else 0 end;
  if v_callback_family_count is distinct from 1
     or v_chatgpt_redirect_count > 1
     or v_codex_redirect_count > 1 then
    raise exception 'mcp_oauth_redirect_uri_invalid' using errcode = '22023';
  end if;

  if p_scope is null or btrim(p_scope) = '' or length(p_scope) > 1024
     or not private.mcp_oauth_scope_array_is_valid(p_scope_ceiling)
     or p_scope is distinct from array_to_string(p_scope_ceiling, ' ')
     or private.mcp_oauth_labels_for_scopes(
       p_scope_ceiling,
       p_consent_catalog_revision
     ) is null
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$' then
    raise exception 'mcp_oauth_scope_invalid' using errcode = '22023';
  end if;

  return query
  insert into private.mcp_oauth_clients (
    client_name,
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    scope,
    scope_ceiling,
    consent_catalog_revision,
    exposure_revision,
    registration_source,
    software_id,
    software_version
  ) values (
    btrim(p_client_name),
    p_redirect_uris,
    'none',
    array['authorization_code', 'refresh_token'],
    array['code'],
    p_scope,
    p_scope_ceiling,
    p_consent_catalog_revision,
    p_exposure_revision,
    'dynamic',
    nullif(btrim(coalesce(p_software_id, '')), ''),
    nullif(btrim(coalesce(p_software_version, '')), '')
  )
  returning
    mcp_oauth_clients.client_id,
    mcp_oauth_clients.client_name,
    mcp_oauth_clients.redirect_uris,
    mcp_oauth_clients.token_endpoint_auth_method,
    mcp_oauth_clients.grant_types,
    mcp_oauth_clients.response_types,
    mcp_oauth_clients.scope,
    mcp_oauth_clients.scope_ceiling,
    mcp_oauth_clients.consent_catalog_revision,
    mcp_oauth_clients.exposure_revision,
    mcp_oauth_clients.created_at;
end;
$function$;

revoke all on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text[], text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.register_mcp_oauth_client_as_system(
  text, text[], text, text[], text, text, text, text
) to service_role;
