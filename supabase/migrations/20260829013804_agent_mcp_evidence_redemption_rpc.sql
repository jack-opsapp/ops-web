begin;

do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)'),
      ('function', 'private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_mcp_evidence_redemptions'),
      ('table', 'private.mcp_oauth_tokens'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_request_audit')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_mcp_evidence_redemption_prerequisite_missing:%',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function public.redeem_agent_mcp_evidence_as_system(
  p_request_id text,
  p_protocol_era text,
  p_access_token_hash text,
  p_issuer text,
  p_audience text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_resolved_permission_scopes jsonb,
  p_job_kind text,
  p_job_id uuid,
  p_source_kind text,
  p_evidence_ref text,
  p_artifact_source_revision bigint,
  p_operational_source_revision bigint,
  p_nonce_digest text,
  p_source_revision_digest text,
  p_binding_digest text,
  p_issued_at timestamptz,
  p_expires_at timestamptz
) returns table (
  outcome text,
  locator_kind text,
  locator text,
  mime_type text,
  byte_size bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_expected_source_digest text;
  v_expected_binding_digest text;
  v_nonce_claimed boolean := false;
  v_bearer_current boolean := false;
  v_safe jsonb;
  v_source_count integer := 0;
  v_deliverable boolean := false;
  v_locator_kind text;
  v_locator text;
  v_mime_type text;
  v_byte_size bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
     or p_protocol_era not in ('legacy', 'modern')
     or p_access_token_hash !~ '^[0-9a-f]{64}$'
     or p_issuer is null
     or p_issuer is distinct from pg_catalog.btrim(p_issuer)
     or pg_catalog.octet_length(p_issuer) not between 1 and 2048
     or p_issuer ~ '[[:cntrl:]]'
     or p_audience is null
     or p_audience is distinct from pg_catalog.btrim(p_audience)
     or pg_catalog.octet_length(p_audience) not between 1 and 2048
     or p_audience ~ '[[:cntrl:]]'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_source_kind not in (
       'deck_design', 'email_attachment', 'expense_receipt',
       'generated_estimate', 'generated_invoice', 'project_note',
       'project_photo', 'site_visit_artifact'
     )
     or p_evidence_ref !~ '^ops_evidence:v1:[0-9a-f]{64}$'
     or p_artifact_source_revision not between 0 and 9007199254740991
     or p_operational_source_revision not between 0 and 9007199254740991
     or p_nonce_digest !~ '^[0-9a-f]{64}$'
     or p_source_revision_digest !~ '^[0-9a-f]{64}$'
     or p_binding_digest !~ '^[0-9a-f]{64}$'
     or p_issued_at is null
     or p_expires_at is null
     or not pg_catalog.isfinite(p_issued_at)
     or not pg_catalog.isfinite(p_expires_at)
     or pg_catalog.date_trunc('second', p_issued_at) <> p_issued_at
     or pg_catalog.date_trunc('second', p_expires_at) <> p_expires_at
     or p_expires_at <= p_issued_at
     or p_expires_at > p_issued_at + interval '5 minutes'
     or p_issued_at > v_now + interval '5 seconds' then
    raise exception 'agent_mcp_evidence_redemption_invalid'
      using errcode = '22023';
  end if;

  v_expected_source_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'artifacts:' || p_artifact_source_revision::text ||
        pg_catalog.chr(10) ||
        'legacy_operational:' || p_operational_source_revision::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_binding_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'ops-mcp-evidence-binding:v1' || pg_catalog.chr(10) ||
        p_audience || pg_catalog.chr(10) ||
        p_oauth_client_id::text || pg_catalog.chr(10) ||
        p_oauth_grant_id::text || pg_catalog.chr(10) ||
        p_actor_user_id::text || pg_catalog.chr(10) ||
        p_company_id::text || pg_catalog.chr(10) ||
        p_job_kind || pg_catalog.chr(10) ||
        p_job_id::text || pg_catalog.chr(10) ||
        p_source_kind || pg_catalog.chr(10) ||
        p_evidence_ref || pg_catalog.chr(10) ||
        p_artifact_source_revision::text || pg_catalog.chr(10) ||
        p_operational_source_revision::text || pg_catalog.chr(10) ||
        p_nonce_digest || pg_catalog.chr(10) ||
        extract(epoch from p_issued_at)::bigint::text || pg_catalog.chr(10) ||
        extract(epoch from p_expires_at)::bigint::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if p_source_revision_digest is distinct from v_expected_source_digest
     or p_binding_digest is distinct from v_expected_binding_digest then
    raise exception 'agent_mcp_evidence_redemption_binding_invalid'
      using errcode = '22023';
  end if;

  -- Bounded opportunistic retention. A token can live for at most five
  -- minutes, so removing rows whose expiry is over one day old cannot make a
  -- valid token reusable. The helper remains private and owner-only.
  perform private.prune_agent_mcp_evidence_redemptions(64);

  insert into private.agent_mcp_evidence_redemptions (
    nonce_digest,
    authority_binding_digest,
    source_revision_digest,
    issued_at,
    expires_at,
    redeemed_at,
    outcome_code
  ) values (
    pg_catalog.decode(p_nonce_digest, 'hex'),
    pg_catalog.decode(p_binding_digest, 'hex'),
    pg_catalog.decode(p_source_revision_digest, 'hex'),
    p_issued_at,
    p_expires_at,
    v_now,
    'pending'
  )
  on conflict (nonce_digest) do nothing
  returning true into v_nonce_claimed;

  if not coalesce(v_nonce_claimed, false) then
    insert into private.mcp_request_audit (
      request_id, grant_id, client_id, actor_user_id, company_id, tool,
      protocol_era, outcome, error_code, input_sha256, result_bytes, latency_ms
    ) values (
      p_request_id, p_oauth_grant_id, p_oauth_client_id, p_actor_user_id,
      p_company_id, 'get_job_artifact_evidence', p_protocol_era,
      'domain_error', 'EVIDENCE_TOKEN_REPLAYED', p_binding_digest, null, null
    );
    return query select 'replay'::text, null::text, null::text,
      null::text, null::bigint;
    return;
  end if;

  if p_expires_at <= v_now then
    update private.agent_mcp_evidence_redemptions ledger
       set outcome_code = 'expired'
     where ledger.nonce_digest = pg_catalog.decode(p_nonce_digest, 'hex')
       and ledger.outcome_code = 'pending';
    insert into private.mcp_request_audit (
      request_id, grant_id, client_id, actor_user_id, company_id, tool,
      protocol_era, outcome, error_code, input_sha256, result_bytes, latency_ms
    ) values (
      p_request_id, p_oauth_grant_id, p_oauth_client_id, p_actor_user_id,
      p_company_id, 'get_job_artifact_evidence', p_protocol_era,
      'domain_error', 'EVIDENCE_TOKEN_EXPIRED', p_binding_digest, null, null
    );
    return query select 'expired'::text, null::text, null::text,
      null::text, null::bigint;
    return;
  end if;

  select exists (
    select 1
    from private.mcp_oauth_tokens token_row
    join private.mcp_oauth_grants grant_row
      on grant_row.id = token_row.grant_id
     and grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.scopes = p_granted_scope_ceiling
     and grant_row.revoked_at is null
    join private.mcp_oauth_clients client_row
      on client_row.client_id = grant_row.client_id
     and client_row.disabled_at is null
     and grant_row.scopes <@ client_row.scope_ceiling
     and grant_row.consent_catalog_revision =
       client_row.consent_catalog_revision
     and grant_row.exposure_revision = client_row.exposure_revision
    where token_row.token_hash = p_access_token_hash
      and token_row.kind = 'access'
      and token_row.revoked_at is null
      and token_row.expires_at > pg_catalog.statement_timestamp()
      and token_row.issuer = p_issuer
      and token_row.audience = p_audience
  ) into v_bearer_current;

  if v_bearer_current then
    begin
      v_safe := private.agent_p2_artifact_evidence_v1(
        p_actor_user_id => p_actor_user_id,
        p_company_id => p_company_id,
        p_oauth_grant_id => p_oauth_grant_id,
        p_oauth_client_id => p_oauth_client_id,
        p_grant_revision => p_grant_revision,
        p_granted_scope_ceiling => p_granted_scope_ceiling,
        p_permission_snapshot_revision => p_permission_snapshot_revision,
        p_registered_permission_keys => p_registered_permission_keys,
        p_capability_id => 'get_job_artifact_evidence',
        p_capability_revision => 'get_job_artifact_evidence:2026-08-22.v1',
        p_capability_manifest_revision =>
          '2026-08-22.capability-manifest.v8',
        p_required_oauth_scopes => p_required_oauth_scopes,
        p_resolved_permission_scopes => p_resolved_permission_scopes,
        p_job_kind => p_job_kind,
        p_job_id => p_job_id,
        p_source_kinds => array[p_source_kind]::text[],
        p_source_kind => p_source_kind,
        p_evidence_ref => p_evidence_ref,
        p_source_limit => 501
      );
    exception
      when sqlstate '42501' or sqlstate 'P0002' or sqlstate '22000'
        or sqlstate '54000' or sqlstate '40001' then
        v_safe := null;
    end;
  end if;

  if v_safe is not null
     and v_safe #>> '{source_revisions,0,domain}' = 'artifacts'
     and v_safe #>> '{source_revisions,1,domain}' = 'legacy_operational'
     and v_safe #>> '{source_revisions,0,source_revision}' ~ '^[0-9]+$'
     and v_safe #>> '{source_revisions,1,source_revision}' ~ '^[0-9]+$'
     and (v_safe #>> '{source_revisions,0,source_revision}')::numeric =
       p_artifact_source_revision::numeric
     and (v_safe #>> '{source_revisions,1,source_revision}')::numeric =
       p_operational_source_revision::numeric
     and v_safe #>> '{content,kind}' = 'binary_resource'
     and v_safe #>> '{content,delivery_state}' =
       'ready_for_single_use_delivery' then
    begin
      select pg_catalog.count(*)::integer,
             pg_catalog.max(source.raw_locator_kind),
             pg_catalog.max(source.raw_locator),
             pg_catalog.max(pg_catalog.lower(pg_catalog.btrim(
               source.raw_mime_type
             ))),
             pg_catalog.max(source.raw_byte_size),
             pg_catalog.bool_and(
               source.source_kind = 'email_attachment'
               and source.evidence_ref = p_evidence_ref
               and source.availability = 'available'
               and source.inspection_state in ('not_required', 'passed')
               and not source.source_data_invalid
               and source.raw_locator_kind = 'storage_path'
               and source.raw_locator is not null
               and source.raw_locator = pg_catalog.btrim(source.raw_locator)
               and pg_catalog.octet_length(source.raw_locator)
                 between 1 and 2048
               and source.raw_locator !~ '[[:cntrl:]]'
               and source.raw_locator !~ '^/'
               and source.raw_locator !~ '(^|/)[.][.]?(/|$)'
               and source.raw_mime_type is not null
               and source.raw_mime_type = pg_catalog.btrim(
                 source.raw_mime_type
               )
               and pg_catalog.lower(source.raw_mime_type) in (
                 'application/pdf', 'image/avif', 'image/gif', 'image/heic',
                 'image/heif', 'image/jpeg', 'image/png', 'image/webp'
               )
               and source.raw_byte_size = source.byte_size
               and (
                 pg_catalog.lower(source.raw_mime_type) like 'image/%'
                   and source.raw_byte_size between 1 and 26214400
                 or pg_catalog.lower(source.raw_mime_type) = 'application/pdf'
                   and source.raw_byte_size between 1 and 52428800
               )
               and v_safe #>> '{artifact,evidence_ref}' =
                 source.evidence_ref
               and v_safe #>> '{artifact,mime_family}' = source.mime_family
               and v_safe #>> '{artifact,byte_size}' ~ '^[0-9]+$'
               and (v_safe #>> '{artifact,byte_size}')::numeric =
                 source.raw_byte_size::numeric
               and v_safe #>> '{content,byte_size}' ~ '^[0-9]+$'
               and (v_safe #>> '{content,byte_size}')::numeric =
                 source.raw_byte_size::numeric
             )
        into v_source_count,
             v_locator_kind,
             v_locator,
             v_mime_type,
             v_byte_size,
             v_deliverable
      from private.agent_p2_artifact_private_evidence_v1(
        p_actor_user_id,
        p_company_id,
        p_permission_snapshot_revision,
        p_registered_permission_keys,
        p_resolved_permission_scopes,
        p_job_kind,
        p_job_id,
        array[p_source_kind]::text[],
        501
      ) source
      where source.source_kind = p_source_kind
        and source.evidence_ref = p_evidence_ref;
    exception
      when sqlstate '42501' or sqlstate 'P0002' or sqlstate '22000'
        or sqlstate '54000' or sqlstate '40001' then
        v_source_count := 0;
        v_deliverable := false;
    end;
  end if;

  if v_source_count = 1 and coalesce(v_deliverable, false) then
    update private.agent_mcp_evidence_redemptions ledger
       set outcome_code = 'delivered'
     where ledger.nonce_digest = pg_catalog.decode(p_nonce_digest, 'hex')
       and ledger.outcome_code = 'pending';
    insert into private.mcp_request_audit (
      request_id, grant_id, client_id, actor_user_id, company_id, tool,
      protocol_era, outcome, error_code, input_sha256, result_bytes, latency_ms
    ) values (
      p_request_id, p_oauth_grant_id, p_oauth_client_id, p_actor_user_id,
      p_company_id, 'get_job_artifact_evidence', p_protocol_era,
      'ok', null, p_binding_digest, v_byte_size::integer, null
    );
    return query select 'delivered'::text,
      v_locator_kind::text,
      v_locator::text,
      v_mime_type::text,
      v_byte_size::bigint;
    return;
  end if;

  update private.agent_mcp_evidence_redemptions ledger
     set outcome_code = 'denied'
   where ledger.nonce_digest = pg_catalog.decode(p_nonce_digest, 'hex')
     and ledger.outcome_code = 'pending';
  insert into private.mcp_request_audit (
    request_id, grant_id, client_id, actor_user_id, company_id, tool,
    protocol_era, outcome, error_code, input_sha256, result_bytes, latency_ms
  ) values (
    p_request_id, p_oauth_grant_id, p_oauth_client_id, p_actor_user_id,
    p_company_id, 'get_job_artifact_evidence', p_protocol_era,
    'domain_error', 'EVIDENCE_NOT_AVAILABLE', p_binding_digest, null, null
  );
  return query select 'unavailable'::text, null::text, null::text,
    null::text, null::bigint;
  return;
end;
$function$;

alter function public.redeem_agent_mcp_evidence_as_system(
  text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],
  jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamptz,timestamptz
) owner to current_user;

revoke all on function public.redeem_agent_mcp_evidence_as_system(
  text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],
  jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamptz,timestamptz
) from public, anon, authenticated, service_role;

-- CREATE OR REPLACE preserves grants added after the first application.
-- Remove every non-owner ACL entry before restoring the one intended grant.
do $canonicalize_acl$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)'
  )::oid;
  v_grantee oid;
  v_role_name name;
begin
  for v_grantee in
    select distinct acl.grantee
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = v_function_oid
      and acl.grantee <> function_row.proowner
  loop
    if v_grantee = 0 then
      execute
        'revoke all privileges on function ' ||
        'public.redeem_agent_mcp_evidence_as_system(' ||
        'text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,' ||
        'text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,' ||
        'text,timestamptz,timestamptz) from public cascade';
    else
      select role_row.rolname
        into strict v_role_name
      from pg_catalog.pg_roles role_row
      where role_row.oid = v_grantee;
      execute pg_catalog.format(
        'revoke all privileges on function ' ||
        'public.redeem_agent_mcp_evidence_as_system(' ||
        'text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,' ||
        'text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,' ||
        'text,timestamptz,timestamptz) from %I cascade',
        v_role_name
      );
    end if;
  end loop;
end;
$canonicalize_acl$;

grant execute on function public.redeem_agent_mcp_evidence_as_system(
  text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],
  jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamptz,timestamptz
) to service_role;

do $postflight$
declare
  v_function_oid oid;
  v_acl_entries text[];
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)'
  )::oid;
  if v_function_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid
      and function_row.proowner = current_user::regrole
      and function_row.prokind = 'f'
      and language_row.lanname = 'plpgsql'
      and function_row.provolatile = 'v'
      and function_row.prosecdef
      and pg_catalog.cardinality(function_row.proconfig) = 1
      and pg_catalog.replace(pg_catalog.regexp_replace(
            function_row.proconfig[1], '[[:space:]]+', '', 'g'
          ), '""', '') = 'search_path='
  ) then
    raise exception 'agent_mcp_evidence_redemption_shape_failed';
  end if;

  select coalesce(pg_catalog.array_agg(
           coalesce(role_row.rolname, 'PUBLIC') || ':' ||
           acl.privilege_type || ':' || acl.is_grantable::text
           order by acl.grantee, acl.privilege_type
         ), array[]::text[])
    into v_acl_entries
  from pg_catalog.pg_proc function_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      function_row.proacl,
      pg_catalog.acldefault('f', function_row.proowner)
    )
  ) acl
  left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
  where function_row.oid = v_function_oid
    and acl.grantee <> function_row.proowner;
  if v_acl_entries is distinct from
       array['service_role:EXECUTE:false']::text[] then
    raise exception 'agent_mcp_evidence_redemption_acl_failed';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
