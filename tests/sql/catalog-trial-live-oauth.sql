-- Exact live OAuth definitions captured 2026-09-09. Schema only, no credentials or rows.
set check_function_bodies=off;
CREATE OR REPLACE FUNCTION private.agent_mcp_oauth_scope_sets_equal(p_left text[], p_right text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select pg_catalog.cardinality(p_left) = pg_catalog.cardinality(p_right)
     and p_left <@ p_right
     and p_right <@ p_left;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_mcp_oauth_consent_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
begin
  if tg_table_name = 'mcp_oauth_clients' then
    if new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name
       or new.redirect_uris is distinct from old.redirect_uris
       or new.token_endpoint_auth_method is distinct from old.token_endpoint_auth_method
       or new.grant_types is distinct from old.grant_types
       or new.response_types is distinct from old.response_types
       or new.scope is distinct from old.scope
       or new.scope_ceiling is distinct from old.scope_ceiling
       or new.registration_source is distinct from old.registration_source
       or new.software_id is distinct from old.software_id
       or new.software_version is distinct from old.software_version
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_client_authority_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_authorization_codes' then
    if new.code_hash is distinct from old.code_hash
       or new.client_id is distinct from old.client_id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.redirect_uri is distinct from old.redirect_uri
       or new.code_challenge is distinct from old.code_challenge
       or new.code_challenge_method is distinct from old.code_challenge_method
       or new.resource is distinct from old.resource
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_code_consent_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_grants' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.client_id is distinct from old.client_id
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.revision is distinct from old.revision
       or new.created_at is distinct from old.created_at then
      raise exception 'mcp_oauth_grant_consent_immutable'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'mcp_oauth_consent_previews' then
    if new.preview_hash is distinct from old.preview_hash
       or new.client_id is distinct from old.client_id
       or new.user_id is distinct from old.user_id
       or new.company_id is distinct from old.company_id
       or new.client_name is distinct from old.client_name
       or new.company_name is distinct from old.company_name
       or new.redirect_uri is distinct from old.redirect_uri
       or new.response_type is distinct from old.response_type
       or new.scopes is distinct from old.scopes
       or new.accepted_labels is distinct from old.accepted_labels
       or new.consent_catalog_revision is distinct from old.consent_catalog_revision
       or new.exposure_revision is distinct from old.exposure_revision
       or new.state is distinct from old.state
       or new.code_challenge is distinct from old.code_challenge
       or new.code_challenge_method is distinct from old.code_challenge_method
       or new.resource is distinct from old.resource
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at
       or old.consumed_at is not null
       or new.consumed_at is null then
      raise exception 'mcp_oauth_consent_preview_immutable'
        using errcode = '22023';
    end if;
  else
    raise exception 'mcp_oauth_consent_trigger_misconfigured'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_mcp_v3_canary_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_client_id uuid;
  v_user_id uuid;
  v_company_id uuid;
  v_exposure_revision text;
  v_consent_catalog_revision text;
begin
  if tg_table_name = 'mcp_oauth_tokens' then
    select
      grant_record.client_id,
      grant_record.user_id,
      grant_record.company_id,
      grant_record.exposure_revision,
      grant_record.consent_catalog_revision
    into
      v_client_id,
      v_user_id,
      v_company_id,
      v_exposure_revision,
      v_consent_catalog_revision
    from private.mcp_oauth_grants grant_record
    where grant_record.id = new.grant_id;
    if not found then
      return new;
    end if;
  else
    v_client_id := new.client_id;
    v_user_id := new.user_id;
    v_company_id := new.company_id;
    v_exposure_revision := new.exposure_revision;
    v_consent_catalog_revision := new.consent_catalog_revision;
  end if;

  if v_exposure_revision = '2026-08-30.mcp-exposure.v3' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
    if v_consent_catalog_revision is distinct from
         '2026-08-30.mcp-consent-catalog.v2'
       or not private.mcp_oauth_canary_is_current(
         v_client_id,
         v_user_id,
         v_company_id,
         '2026-08-30.mcp-exposure.v3',
         '2026-08-30.mcp-consent-catalog.v2'
       ) then
      raise exception 'mcp_oauth_canary_unavailable' using errcode = '42501';
    end if;
  end if;
  if v_exposure_revision='2026-09-07.mcp-exposure.v17' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
    if v_consent_catalog_revision is distinct from '2026-09-07.mcp-consent-catalog.v12' or not private.mcp_oauth_canary_is_current(v_client_id,v_user_id,v_company_id,v_exposure_revision,v_consent_catalog_revision) then
      raise exception 'FINANCIAL_TRIAL_UNAVAILABLE' using errcode='42501';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_financial_trial_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if old.exposure_revision='2026-09-07.mcp-exposure.v17' or new.exposure_revision='2026-09-07.mcp-exposure.v17' then
  if tg_op='DELETE' or (to_jsonb(new)-'disabled_at') is distinct from (to_jsonb(old)-'disabled_at')
   or old.disabled_at is not null and new.disabled_at is distinct from old.disabled_at
   or new.disabled_at is null then raise exception 'FINANCIAL_TRIAL_BINDING_IMMUTABLE';end if;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.lock_mcp_v3_canary_client(p_oauth_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_oauth_client_id is null then
    raise exception 'mcp_oauth_canary_client_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ops-mcp-v3-canary:' || p_oauth_client_id::text,
      0
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.mcp_oauth_canary_is_current(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_exposure_revision text, p_consent_catalog_revision text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
  select exists (
    select 1
    from private.mcp_oauth_canary_bindings binding
    join private.mcp_oauth_clients client
      on client.client_id = binding.oauth_client_id
     and client.disabled_at is null
     and client.exposure_revision = binding.exposure_revision
     and client.consent_catalog_revision = binding.consent_catalog_revision
    where binding.oauth_client_id = p_oauth_client_id
      and binding.user_id = p_user_id
      and binding.company_id = p_company_id
      and binding.exposure_revision = p_exposure_revision
      and binding.consent_catalog_revision = p_consent_catalog_revision
      and (
       binding.exposure_revision='2026-08-30.mcp-exposure.v3'
       or (binding.exposure_revision='2026-09-07.mcp-exposure.v17'
         and binding.consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12'
         and client.scope_ceiling=array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read']::text[]
         and client.scope=pg_catalog.array_to_string(client.scope_ceiling,' ')
         and exists(
          select 1 from private.financial_document_policies policy
          join public.companies company on company.id=policy.company_id and company.deleted_at is null
          join public.users owner_record on owner_record.id=policy.approved_by and owner_record.company_id=company.id and owner_record.is_active and owner_record.deleted_at is null
          join private.financial_policy_previews preview on preview.id=policy.approval_preview_id and preview.company_id=company.id and preview.actor_user_id=owner_record.id and preview.operation='enroll' and preview.consumed_at is not null
          join public.project_notes note on note.id=policy.source_document_id and note.company_id=company.id::text and note.deleted_at is null
          join public.projects job on job.id::text=note.project_id and job.company_id=company.id and job.deleted_at is null
          where policy.id=binding.financial_policy_id and policy.company_id=binding.company_id and policy.status='active'
           and lower(company.account_holder_id)=owner_record.id::text
           and policy.currency_code=company.currency_code
           and private.financial_document_hash(to_jsonb(policy))=binding.financial_policy_sha256
           and preview.receipt->>'policy_sha256'=binding.financial_policy_sha256
           and private.financial_document_hash(to_jsonb(note))=policy.source_sha256
           and (select count(*) from public.tax_rates tax where tax.company_id=company.id and tax.is_active and tax.is_default)=1
           and preview.context->'tax'=(select to_jsonb(tax) from public.tax_rates tax where tax.company_id=company.id and tax.is_active and tax.is_default)
         )
         and exists(select 1 from private.financial_document_effect_policy effect
          where effect.revision='financial-document-draft:2026-09-07.v1'
           and effect.effect_revision=binding.financial_effect_revision
           and effect.effect_revision=private.financial_document_effect_revision())
         and exists(select 1 from private.resolve_agent_actor_authority(binding.user_id,binding.company_id,
          array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view','settings.integrations']) authority
          where authority.effective_permissions @> (
           select jsonb_agg(jsonb_build_object('permission',k,'scope','all'))
           from unnest(array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view','settings.integrations']) k))
       )
      )
      and binding.disabled_at is null
      and binding.expires_at > statement_timestamp()
      and private.user_is_active_company_member(
        binding.user_id,
        binding.company_id
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.mcp_oauth_labels_for_scopes(p_scopes text[], p_consent_catalog_revision text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  with labelled as materialized (
    select requested.ordinal,
           case requested.scope
             when 'ops.financial_documents.prepare' then case when p_consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12' then 'Inspect pricing sources and prepare private estimates or change orders for exact approval in OPS; never send or issue documents' end
             when 'ops.customers.prepare' then case when p_consent_catalog_revision='2026-09-04.mcp-consent-catalog.v9' then 'Prepare customer notes and lead details, owner and follow-up date changes for exact approval inside OPS' end
             when 'ops.jobs.read' then 'See your jobs and their status'
             when 'ops.schedule.read' then
               'See your schedule and who''s assigned'
             when 'ops.customers.read' then 'See your clients and their jobs'
             when 'ops.customer_contacts.read' then
               'See who to contact on a job and how to reach them'
             when 'ops.photos.read' then 'See which jobs are missing photos'
             when 'ops.correspondence.read' then
               'See client email history on your jobs'
             when 'ops.financials.read' then
               'See estimate and invoice summaries on your jobs'
             when 'ops.tasks.read' then
               'See tasks and work that needs attention'
             when 'ops.site_visits.read' then
               'See site visits and their evidence status'
             when 'ops.files.read' then
               'See authorized job photos, files, and documents'
             when 'ops.financial_documents.read' then
               'See estimates and invoices in detail'
             when 'ops.payments.read' then
               'See payment records on authorized invoices'
             when 'ops.expenses.read' then
               'See authorized expenses and reimbursements'
             when 'ops.catalog.read' then
               'See products, stock levels, and selling prices'
             when 'ops.purchasing.read' then 'See purchase orders'
             when 'ops.catalog_costs.read' then
               'See authorized supplier cost facts'
             when 'ops.company.read' then
               'See the company operating profile'
             when 'ops.team.read' then
               'See the team directory and company availability'
             when 'ops.integrations.read' then
               'See integration health without credentials'
             when 'ops.operations.read' then
               'See authorized work queues and operational summaries'
             when 'ops.financials.prepare' then case
               when p_consent_catalog_revision in (
                 '2026-09-02.mcp-consent-catalog.v5',
                 '2026-09-03.mcp-consent-catalog.v6',
                 '2026-09-03.mcp-consent-catalog.v7'
               ) then 'Prepare exact draft estimates from authorized past jobs'
             end
             when 'ops.communications.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact client schedule-update drafts for approval'
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v7'
                 then 'Prepare exact client schedule-update and crew recovery messages for approval'
             end
             when 'ops.schedule.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact weather reschedule proposals for approval'
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v7'
                 then 'Prepare exact weather and crew recovery schedule proposals for approval'
             end
             when 'ops.operations.prepare' then case
               when p_consent_catalog_revision =
                 '2026-08-30.mcp-consent-catalog.v2'
                 then 'Prepare end-of-day closeouts and exact OPS filing previews'
               when p_consent_catalog_revision =
                 '2026-08-31.mcp-consent-catalog.v3'
                 then 'Prepare collections aging and customer drafts for approval'
               when p_consent_catalog_revision in (
                 '2026-09-01.mcp-consent-catalog.v4',
                 '2026-09-02.mcp-consent-catalog.v5',
                 '2026-09-03.mcp-consent-catalog.v6',
                 '2026-09-03.mcp-consent-catalog.v7'
               ) then 'Prepare recurring-service price-change previews and customer notice drafts'
             end
           end as label
    from pg_catalog.unnest(p_scopes) with ordinality
      as requested(scope, ordinal)
  )
  select case
    when p_consent_catalog_revision not in (
           '2026-09-07.mcp-consent-catalog.v12',
           '2026-09-04.mcp-consent-catalog.v9',
           '2026-08-22.mcp-consent-catalog.v1',
           '2026-08-30.mcp-consent-catalog.v2',
           '2026-08-31.mcp-consent-catalog.v3',
           '2026-09-01.mcp-consent-catalog.v4',
           '2026-09-02.mcp-consent-catalog.v5',
           '2026-09-03.mcp-consent-catalog.v6',
           '2026-09-03.mcp-consent-catalog.v7'
         )
      or pg_catalog.cardinality(p_scopes) not between 1 and 32
      or exists (
        select 1 from pg_catalog.unnest(p_scopes) scope(value)
        where scope.value is distinct from pg_catalog.btrim(scope.value)
           or nullif(scope.value, '') is null
           or pg_catalog.length(scope.value) > 128
      )
      or pg_catalog.cardinality(array(
           select distinct scope.value
           from pg_catalog.unnest(p_scopes) scope(value)
         )) <> pg_catalog.cardinality(p_scopes)
      or exists (select 1 from labelled where label is null)
      then null::text[]
    else array(
      select labelled.label from labelled order by labelled.ordinal
    )
  end
$function$;

CREATE OR REPLACE FUNCTION private.mcp_oauth_scope_array(p_scope text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when btrim(p_scope) = '' then null::text[]
    else regexp_split_to_array(btrim(p_scope), '[[:space:]]+')
  end
$function$;

CREATE OR REPLACE FUNCTION private.mcp_oauth_scope_array_is_valid(p_scopes text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select coalesce(
    cardinality(p_scopes) between 1 and 32
    and array_position(p_scopes, null) is null
    and not exists (
      select 1
      from unnest(p_scopes) as scope(value)
      where btrim(scope.value) = ''
         or length(scope.value) > 128
    )
    and cardinality(array(
      select distinct scope.value
      from unnest(p_scopes) as scope(value)
    )) = cardinality(p_scopes),
    false
  )
$function$;

CREATE OR REPLACE FUNCTION private.prune_expired_mcp_oauth_artifacts()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
  with pruned_codes as (
    delete from private.mcp_oauth_authorization_codes
    where expires_at < statement_timestamp() - interval '1 day'
    returning 1
  )
  delete from private.mcp_oauth_tokens
  where expires_at < statement_timestamp() - interval '30 days';
$function$;

CREATE OR REPLACE FUNCTION public.consume_mcp_oauth_authorization_code_as_system(p_code_hash text, p_client_id uuid, p_redirect_uri text)
 RETURNS TABLE(user_id uuid, company_id uuid, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, code_challenge text, resource text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_replayed_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select code.minted_grant_id
  into v_replayed_grant_id
  from private.mcp_oauth_authorization_codes code
  where code.code_hash = p_code_hash
    and code.consumed_at is not null;
  if found then
    if v_replayed_grant_id is not null then
      update private.mcp_oauth_grants grants
      set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
      where grants.id = v_replayed_grant_id;
      update private.mcp_oauth_tokens tokens
      set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
      where tokens.grant_id = v_replayed_grant_id;
    end if;
    return;
  end if;

  return query
  update private.mcp_oauth_authorization_codes code
  set consumed_at = statement_timestamp()
  where code.code_hash = p_code_hash
    and code.client_id = p_client_id
    and code.redirect_uri = p_redirect_uri
    and code.consumed_at is null
    and code.expires_at > statement_timestamp()
  returning
    code.user_id,
    code.company_id,
    code.scopes,
    code.accepted_labels,
    code.consent_catalog_revision,
    code.exposure_revision,
    code.code_challenge,
    code.resource;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_mcp_oauth_consent_preview_as_system(p_preview_hash text, p_user_id uuid, p_company_id uuid)
 RETURNS TABLE(client_id uuid, user_id uuid, company_id uuid, client_name text, company_name text, redirect_uri text, response_type text, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, state text, code_challenge text, code_challenge_method text, resource text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$'
     or p_user_id is null or p_company_id is null then
    raise exception 'mcp_oauth_consent_preview_invalid'
      using errcode = '22023';
  end if;

  return query
  update private.mcp_oauth_consent_previews preview
  set consumed_at = statement_timestamp()
  where preview.preview_hash = p_preview_hash
    and preview.user_id = p_user_id
    and preview.company_id = p_company_id
    and preview.consumed_at is null
    and preview.expires_at > statement_timestamp()
  returning
    preview.client_id,
    preview.user_id,
    preview.company_id,
    preview.client_name,
    preview.company_name,
    preview.redirect_uri,
    preview.response_type,
    preview.scopes,
    preview.accepted_labels,
    preview.consent_catalog_revision,
    preview.exposure_revision,
    preview.state,
    preview.code_challenge,
    preview.code_challenge_method,
    preview.resource,
    preview.expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_mcp_oauth_authorization_code_as_system(p_code_hash text, p_client_id uuid, p_user_id uuid, p_company_id uuid, p_scopes text[], p_accepted_labels text[], p_consent_catalog_revision text, p_exposure_revision text, p_redirect_uri text, p_code_challenge text, p_resource text, p_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_client private.mcp_oauth_clients%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select client.*
  into v_client
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id
    and client.disabled_at is null
    and p_redirect_uri = any (client.redirect_uris)
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.exposure_revision = p_exposure_revision
  for share;
  if not found then
    raise exception 'mcp_oauth_client_unavailable' using errcode = '22023';
  end if;
  if not private.mcp_oauth_scope_array_is_valid(p_scopes)
     or not (p_scopes <@ v_client.scope_ceiling)
     or cardinality(p_accepted_labels) <> cardinality(p_scopes)
     or p_accepted_labels is distinct from
       private.mcp_oauth_labels_for_scopes(
         p_scopes,
         p_consent_catalog_revision
       )
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$' then
    raise exception 'mcp_oauth_scope_invalid' using errcode = '22023';
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '10 minutes' then
    raise exception 'mcp_oauth_code_expiry_invalid' using errcode = '22023';
  end if;

  perform private.prune_expired_mcp_oauth_artifacts();

  insert into private.mcp_oauth_authorization_codes (
    code_hash,
    client_id,
    user_id,
    company_id,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    resource,
    expires_at
  ) values (
    p_code_hash,
    p_client_id,
    p_user_id,
    p_company_id,
    p_scopes,
    p_accepted_labels,
    p_consent_catalog_revision,
    p_exposure_revision,
    p_redirect_uri,
    p_code_challenge,
    'S256',
    p_resource,
    p_expires_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.disable_mcp_oauth_canary_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_found boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.lock_mcp_v3_canary_client(p_oauth_client_id);

  update private.mcp_oauth_canary_bindings binding
  set disabled_at = coalesce(binding.disabled_at, statement_timestamp())
  where binding.oauth_client_id = p_oauth_client_id
    and binding.user_id = p_user_id
    and binding.company_id = p_company_id;
  v_found := found;

  update private.mcp_oauth_clients client
  set disabled_at = coalesce(client.disabled_at, statement_timestamp())
  where client.client_id = p_oauth_client_id
    and v_found and client.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17');

  update private.mcp_oauth_grants grant_record
  set revoked_at = coalesce(grant_record.revoked_at, statement_timestamp())
  where grant_record.client_id = p_oauth_client_id
    and grant_record.user_id = p_user_id
    and grant_record.company_id = p_company_id
    and grant_record.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17');

  update private.mcp_oauth_tokens token_record
  set revoked_at = coalesce(token_record.revoked_at, statement_timestamp())
  from private.mcp_oauth_grants grant_record
  where token_record.grant_id = grant_record.id
    and grant_record.client_id = p_oauth_client_id
    and grant_record.user_id = p_user_id
    and grant_record.company_id = p_company_id
    and grant_record.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17');

  update private.agent_day_closeout_routines routine
  set enabled = false,
      claimed_at = null,
      claim_token = null,
      claim_expires_at = null,
      attempt_count = 0,
      retry_not_before = null,
      last_failure_code = 'OAUTH_CANARY_DISABLED',
      schedule_revision = case
        when routine.schedule_revision = 9007199254740991 then 0
        else routine.schedule_revision + 1
      end,
      updated_at = statement_timestamp()
  where routine.oauth_client_id = p_oauth_client_id
    and routine.company_id = p_company_id
    and routine.actor_user_id = p_user_id
    and (
      routine.enabled
      or routine.claimed_at is not null
      or routine.claim_token is not null
      or routine.claim_expires_at is not null
    );

  return v_found;
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.inspect_mcp_oauth_canary_acceptance_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_not_before timestamp with time zone, p_run_id uuid, p_action_id uuid, p_change_set_id uuid, p_preview_sha256 text)
 RETURNS TABLE(prepared_with_approval boolean, receipt_verified boolean, routine_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_not_before is null
     or p_not_before < statement_timestamp() - interval '24 hours'
     or p_not_before > statement_timestamp() + interval '1 minute'
     or p_run_id is null
     or p_action_id is null
     or p_change_set_id is null
     or p_preview_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'mcp_oauth_canary_acceptance_window_invalid'
      using errcode = '22023';
  end if;
  if not private.mcp_oauth_canary_is_current(
    p_oauth_client_id,
    p_user_id,
    p_company_id,
    '2026-08-30.mcp-exposure.v3',
    '2026-08-30.mcp-consent-catalog.v2'
  ) then
    return query select false, false, false;
    return;
  end if;

  return query
  with eligible_grants as materialized (
    select grant_record.id
    from private.mcp_oauth_grants grant_record
    where grant_record.client_id = p_oauth_client_id
      and grant_record.user_id = p_user_id
      and grant_record.company_id = p_company_id
      and grant_record.exposure_revision =
        '2026-08-30.mcp-exposure.v3'
      and grant_record.revoked_at is null
  ), prepared_runs as materialized (
    select run.id
    from private.agent_day_closeout_runs run
    join eligible_grants eligible on eligible.id = run.oauth_grant_id
    where run.id = p_run_id
      and run.oauth_client_id = p_oauth_client_id
      and run.actor_user_id = p_user_id
      and run.company_id = p_company_id
      and run.exposure_revision = '2026-08-30.mcp-exposure.v3'
      and run.prepared_at >= p_not_before
      and run.result_snapshot #>> '{filing,kind}' = 'approval_required'
      and run.result_snapshot #>> '{filing,action_id}' = p_action_id::text
      and run.result_snapshot #>> '{filing,change_set_id}' =
        p_change_set_id::text
      and run.result_snapshot #>> '{filing,preview,preview_sha256}' =
        p_preview_sha256
  )
  select
    exists (select 1 from prepared_runs),
    exists (
      select 1
      from private.agent_day_closeout_receipts receipt
      join eligible_grants eligible
        on eligible.id = receipt.oauth_grant_id
      join private.agent_day_closeout_confirmations confirmation
        on confirmation.id = receipt.confirmation_id
       and confirmation.action_id = receipt.action_id
       and confirmation.change_set_id = receipt.change_set_id
       and confirmation.company_id = receipt.company_id
       and confirmation.actor_user_id = receipt.actor_user_id
       and confirmation.oauth_grant_id = receipt.oauth_grant_id
       and confirmation.oauth_client_id = receipt.oauth_client_id
       and confirmation.exposure_revision = receipt.exposure_revision
       and confirmation.commit_capability = receipt.commit_capability
       and confirmation.preview_hash = receipt.preview_hash
       and confirmation.consumed_at is not null
      join private.agent_day_closeout_change_sets change_set
        on change_set.id = receipt.change_set_id
       and change_set.run_id = receipt.run_id
       and change_set.company_id = receipt.company_id
       and change_set.actor_user_id = receipt.actor_user_id
       and change_set.oauth_grant_id = receipt.oauth_grant_id
       and change_set.oauth_client_id = receipt.oauth_client_id
       and change_set.exposure_revision = receipt.exposure_revision
       and change_set.commit_capability = receipt.commit_capability
       and change_set.preview_hash = receipt.preview_hash
       and change_set.consumed_at is not null
      join private.agent_day_closeout_runs run
        on run.id = receipt.run_id
       and run.id = p_run_id
       and run.status = 'filed'
       and run.id in (select prepared.id from prepared_runs prepared)
      join public.agent_actions action
        on action.id = receipt.action_id
       and action.company_id = receipt.company_id
       and action.user_id = receipt.actor_user_id
       and action.action_type = 'file_day_closeout'
       and action.status = 'executed'
       and action.reviewed_by = p_user_id
       and action.execution_result = receipt.result
      where receipt.oauth_client_id = p_oauth_client_id
        and receipt.actor_user_id = p_user_id
        and receipt.company_id = p_company_id
        and receipt.run_id = p_run_id
        and receipt.action_id = p_action_id
        and receipt.change_set_id = p_change_set_id
        and receipt.preview_hash = substring(p_preview_sha256 from 8)
        and receipt.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and receipt.commit_capability = 'commit_day_closeout'
        and receipt.committed_at >= p_not_before
        and receipt.result ->> 'effect' = 'filed_inside_ops'
        and receipt.result ->> 'run_id' = p_run_id::text
        and receipt.result ->> 'action_id' = p_action_id::text
        and receipt.result ->> 'change_set_id' = p_change_set_id::text
        and receipt.result ->> 'preview_sha256' = p_preview_sha256
        and receipt.result -> 'messages_sent' = '0'::jsonb
        and receipt.result -> 'money_moved' = 'false'::jsonb
    ),
    exists (
      select 1
      from private.agent_day_closeout_routines routine
      join eligible_grants eligible on eligible.id = routine.oauth_grant_id
      where routine.oauth_client_id = p_oauth_client_id
        and routine.actor_user_id = p_user_id
        and routine.company_id = p_company_id
        and routine.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and routine.enabled
        and routine.claimed_at is null
        and routine.claim_token is null
        and routine.claim_expires_at is null
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_mcp_oauth_consent_preview_as_system(p_preview_hash text, p_client_id uuid, p_user_id uuid, p_company_id uuid, p_redirect_uri text, p_response_type text, p_scopes text[], p_accepted_labels text[], p_consent_catalog_revision text, p_exposure_revision text, p_state text, p_code_challenge text, p_code_challenge_method text, p_resource text, p_expires_at timestamp with time zone)
 RETURNS TABLE(client_name text, company_name text, expires_at timestamp with time zone, rate_limited boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_client private.mcp_oauth_clients%rowtype;
  v_company_name text;
  v_cleanup_batch integer;
  v_cleanup_deleted integer;
  v_binding_live_count integer;
  v_global_live_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$'
     or p_client_id is null
     or p_user_id is null
     or p_company_id is null
     or p_redirect_uri is null
     or length(p_redirect_uri) not between 1 and 2048
     or p_response_type is distinct from 'code'
     or not private.mcp_oauth_scope_array_is_valid(p_scopes)
     or cardinality(p_accepted_labels) <> cardinality(p_scopes)
     or p_accepted_labels is distinct from
       private.mcp_oauth_labels_for_scopes(
         p_scopes,
         p_consent_catalog_revision
       )
     or p_exposure_revision !~ '^[0-9a-z][0-9a-z._:-]{0,127}$'
     or (
       p_state is not null
       and (length(p_state) > 2048 or p_state ~ '[[:cntrl:]]')
     )
     or p_code_challenge is null
     or p_code_challenge !~ '^[A-Za-z0-9._~-]{43,128}$'
     or p_code_challenge_method is distinct from 'S256'
     or p_resource is null
     or length(p_resource) not between 1 and 2048
     or p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'mcp_oauth_consent_preview_invalid'
      using errcode = '22023';
  end if;

  select client.*
  into v_client
  from private.mcp_oauth_clients client
  where client.client_id = p_client_id
    and client.disabled_at is null
    and p_redirect_uri = any (client.redirect_uris)
    and p_scopes <@ client.scope_ceiling
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.exposure_revision = p_exposure_revision
  for share;
  if not found then
    return;
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    return;
  end if;
  select coalesce(nullif(btrim(company.name), ''), '—')
  into v_company_name
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if not found then
    return;
  end if;

  -- The database is the durable authority for both the per-actor/company
  -- issuance ceiling and the global live-row cardinality ceiling. A fixed
  -- lock serializes the global count/insert boundary; the binding lock makes
  -- the narrower policy explicit and stable for future partitioning.
  perform pg_catalog.pg_advisory_xact_lock(638416, 1);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_company_id::text,
      638416
    )
  );

  -- Cleanup is bounded per request, but can catch up by deleting eight
  -- ordered index batches. Consumed previews naturally become eligible at
  -- their five-minute expiry and never require an unindexed consumed scan.
  for v_cleanup_batch in 1..8 loop
    delete from private.mcp_oauth_consent_previews preview
    using (
      select expired.preview_hash
      from private.mcp_oauth_consent_previews expired
      where expired.expires_at <= statement_timestamp()
      order by expired.expires_at, expired.preview_hash
      limit 64
      for update skip locked
    ) expired
    where preview.preview_hash = expired.preview_hash;

    get diagnostics v_cleanup_deleted = row_count;
    exit when v_cleanup_deleted < 64;
  end loop;

  select pg_catalog.count(*)::integer
  into v_binding_live_count
  from (
    select 1
    from private.mcp_oauth_consent_previews preview
    where preview.user_id = p_user_id
      and preview.company_id = p_company_id
      and preview.expires_at > statement_timestamp()
    order by preview.expires_at, preview.preview_hash
    limit 31
  ) bounded_binding;

  select pg_catalog.count(*)::integer
  into v_global_live_count
  from (
    select 1
    from private.mcp_oauth_consent_previews preview
    where preview.expires_at > statement_timestamp()
    order by preview.expires_at, preview.preview_hash
    limit 4097
  ) bounded_global;

  if v_binding_live_count >= 30 or v_global_live_count >= 4096 then
    return query
    select v_client.client_name, v_company_name, p_expires_at, true;
    return;
  end if;

  insert into private.mcp_oauth_consent_previews (
    preview_hash,
    client_id,
    user_id,
    company_id,
    client_name,
    company_name,
    redirect_uri,
    response_type,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    state,
    code_challenge,
    code_challenge_method,
    resource,
    expires_at
  ) values (
    p_preview_hash,
    p_client_id,
    p_user_id,
    p_company_id,
    v_client.client_name,
    v_company_name,
    p_redirect_uri,
    p_response_type,
    p_scopes,
    p_accepted_labels,
    p_consent_catalog_revision,
    p_exposure_revision,
    p_state,
    p_code_challenge,
    p_code_challenge_method,
    p_resource,
    p_expires_at
  );

  return query
  select v_client.client_name, v_company_name, p_expires_at, false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_mcp_oauth_grants_for_user_as_system(p_user_id uuid, p_company_id uuid)
 RETURNS TABLE(grant_id uuid, client_name text, scopes text[], created_at timestamp with time zone, last_used_at timestamp with time zone)
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
    grants.id,
    clients.client_name,
    grants.scopes,
    grants.created_at,
    grants.last_used_at
  from private.mcp_oauth_grants grants
  join private.mcp_oauth_clients clients
    on clients.client_id = grants.client_id
  where grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.revoked_at is null
  order by grants.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mint_mcp_oauth_grant_as_system(p_code_hash text, p_client_id uuid, p_user_id uuid, p_company_id uuid, p_active_exposure_revision text, p_active_grantable_scopes text[], p_access_hash text, p_refresh_hash text, p_issuer text, p_audience text, p_access_expires_at timestamp with time zone, p_refresh_expires_at timestamp with time zone)
 RETURNS TABLE(grant_id uuid, revision text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_code record;
  v_grant_id uuid;
  v_revision text;
  v_family_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select
    code.scopes,
    code.accepted_labels,
    code.consent_catalog_revision,
    code.exposure_revision,
    code.resource
  into v_code
  from private.mcp_oauth_authorization_codes code
  where code.code_hash = p_code_hash
    and code.client_id = p_client_id
    and code.user_id = p_user_id
    and code.company_id = p_company_id
    and code.consumed_at is not null
    and code.minted_grant_id is null
    and code.expires_at > statement_timestamp()
    and code.exposure_revision = p_active_exposure_revision
    and code.scopes <@ p_active_grantable_scopes
  for update;
  if not found then
    raise exception 'mcp_oauth_code_unavailable' using errcode = '22023';
  end if;
  if p_audience is distinct from v_code.resource then
    raise exception 'mcp_oauth_audience_invalid' using errcode = '22023';
  end if;
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_actor_unavailable' using errcode = '22023';
  end if;
  if p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$'
     or p_refresh_hash is null or p_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_access_hash = p_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is null;
  update private.mcp_oauth_tokens tokens
  set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
  from private.mcp_oauth_grants grants
  where tokens.grant_id = grants.id
    and grants.user_id = p_user_id
    and grants.company_id = p_company_id
    and grants.client_id = p_client_id
    and grants.revoked_at is not null
    and tokens.revoked_at is null;

  v_revision := replace(gen_random_uuid()::text, '-', '');
  v_family_id := gen_random_uuid();
  insert into private.mcp_oauth_grants (
    user_id,
    company_id,
    client_id,
    scopes,
    accepted_labels,
    consent_catalog_revision,
    exposure_revision,
    revision
  ) values (
    p_user_id,
    p_company_id,
    p_client_id,
    v_code.scopes,
    v_code.accepted_labels,
    v_code.consent_catalog_revision,
    v_code.exposure_revision,
    v_revision
  )
  returning id into v_grant_id;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_access_hash, 'access', v_grant_id, v_family_id, p_issuer, p_audience,
     p_access_expires_at),
    (p_refresh_hash, 'refresh', v_grant_id, v_family_id, p_issuer, p_audience,
     p_refresh_expires_at);

  update private.mcp_oauth_authorization_codes code
  set minted_grant_id = v_grant_id
  where code.code_hash = p_code_hash
    and code.minted_grant_id is null;

  return query select v_grant_id, v_revision;
end;
$function$;

CREATE OR REPLACE FUNCTION public.provision_mcp_oauth_canary_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_exposure_revision text, p_consent_catalog_revision text, p_expires_at timestamp with time zone)
 RETURNS TABLE(exposure_revision text, consent_catalog_revision text, expires_at timestamp with time zone, enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_existing private.mcp_oauth_canary_bindings%rowtype;
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
    jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
    jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
  );
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_exposure_revision is distinct from '2026-08-30.mcp-exposure.v3'
     or p_consent_catalog_revision is distinct from
        '2026-08-30.mcp-consent-catalog.v2'
     or p_expires_at is null
     or not (p_expires_at > statement_timestamp())
     or not (
       p_expires_at <= statement_timestamp() + interval '24 hours'
     ) then
    raise exception 'mcp_oauth_canary_invalid' using errcode = '22023';
  end if;
  perform private.lock_mcp_v3_canary_client(p_oauth_client_id);
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_canary_subject_unavailable'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.name = 'OPS MCP SYNTHETIC CANARY'
      and company.deleted_at is null
  ) or not public.has_permission(
    p_user_id,
    'settings.integrations',
    'all'
  ) or not exists (
    select 1
    from private.resolve_agent_actor_authority(
      p_user_id,
      p_company_id,
      array[
        'calendar.view', 'email.view', 'invoices.view', 'pipeline.view',
        'projects.view', 'reports.view', 'tasks.view'
      ]
    ) authority
    where authority.effective_permissions @> v_required_permissions
  ) then
    raise exception 'mcp_oauth_canary_subject_unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from private.mcp_oauth_clients client
  where client.client_id = p_oauth_client_id
    and client.disabled_at is null
    and client.exposure_revision = p_exposure_revision
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.scope_ceiling = v_required_scopes
  for update;
  if not found then
    raise exception 'mcp_oauth_canary_client_unavailable'
      using errcode = '22023';
  end if;

  insert into private.mcp_oauth_canary_bindings (
    oauth_client_id,
    user_id,
    company_id,
    exposure_revision,
    consent_catalog_revision,
    expires_at
  ) values (
    p_oauth_client_id,
    p_user_id,
    p_company_id,
    p_exposure_revision,
    p_consent_catalog_revision,
    p_expires_at
  )
  on conflict (oauth_client_id) do nothing;

  select binding.*
  into strict v_existing
  from private.mcp_oauth_canary_bindings binding
  where binding.oauth_client_id = p_oauth_client_id
  for update;

  if v_existing.user_id is distinct from p_user_id
     or v_existing.company_id is distinct from p_company_id
     or v_existing.exposure_revision is distinct from p_exposure_revision
     or v_existing.consent_catalog_revision is distinct from
        p_consent_catalog_revision
     or v_existing.expires_at is distinct from p_expires_at
     or v_existing.disabled_at is not null then
    raise exception 'mcp_oauth_canary_conflict' using errcode = '23505';
  end if;

  return query select
    v_existing.exposure_revision,
    v_existing.consent_catalog_revision,
    v_existing.expires_at,
    true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.provision_mcp_oauth_canary_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_exposure_revision text, p_consent_catalog_revision text, p_expires_at timestamp with time zone, p_financial_policy_id uuid, p_financial_policy_sha256 text, p_financial_effect_revision text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare binding_id uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'access_denied' using errcode='42501';end if;
 if p_exposure_revision is distinct from '2026-09-07.mcp-exposure.v17' or p_consent_catalog_revision is distinct from '2026-09-07.mcp-consent-catalog.v12'
  or p_expires_at is null or p_expires_at<=statement_timestamp() or p_expires_at>statement_timestamp()+interval '2 hours'
  or p_financial_policy_id is null or p_financial_policy_sha256 is null or p_financial_effect_revision is null then
  raise exception 'FINANCIAL_TRIAL_INPUT_INVALID';end if;
 perform private.lock_mcp_v3_canary_client(p_oauth_client_id);
 perform private.financial_document_lock(p_company_id);
 insert into private.mcp_oauth_canary_bindings(oauth_client_id,user_id,company_id,exposure_revision,consent_catalog_revision,expires_at,financial_policy_id,financial_policy_sha256,financial_effect_revision)
 values(p_oauth_client_id,p_user_id,p_company_id,p_exposure_revision,p_consent_catalog_revision,p_expires_at,p_financial_policy_id,p_financial_policy_sha256,p_financial_effect_revision)
 on conflict(oauth_client_id) do nothing returning id into binding_id;
 if binding_id is null then
  select id into binding_id from private.mcp_oauth_canary_bindings b where b.oauth_client_id=p_oauth_client_id
   and b.user_id=p_user_id and b.company_id=p_company_id and b.exposure_revision=p_exposure_revision
   and b.consent_catalog_revision=p_consent_catalog_revision and b.expires_at=p_expires_at
   and b.financial_policy_id=p_financial_policy_id and b.financial_policy_sha256=p_financial_policy_sha256
   and b.financial_effect_revision=p_financial_effect_revision and b.disabled_at is null;
 end if;
 if binding_id is null or not private.mcp_oauth_canary_is_current(p_oauth_client_id,p_user_id,p_company_id,p_exposure_revision,p_consent_catalog_revision) then
  raise exception 'FINANCIAL_TRIAL_UNAVAILABLE' using errcode='42501';end if;
 return binding_id;
end $function$;

CREATE OR REPLACE FUNCTION public.register_mcp_oauth_client_as_system(p_client_name text, p_redirect_uris text[], p_scope text, p_scope_ceiling text[], p_consent_catalog_revision text, p_exposure_revision text, p_software_id text, p_software_version text)
 RETURNS TABLE(client_id uuid, client_name text, redirect_uris text[], token_endpoint_auth_method text, grant_types text[], response_types text[], scope text, scope_ceiling text[], consent_catalog_revision text, exposure_revision text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.resolve_mcp_oauth_access_token_as_system(p_token_hash text)
 RETURNS TABLE(grant_id uuid, client_id uuid, client_name text, user_id uuid, company_id uuid, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, revision text, issuer text, audience text, expires_at timestamp with time zone, token_revoked boolean, grant_revoked boolean, client_disabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select resolved.*
  from public.resolve_mcp_oauth_access_token_as_system(
    p_token_hash,
    '2026-08-29.mcp-exposure.v2'
  ) resolved
  where resolved.exposure_revision <>
    '2026-08-30.mcp-exposure.v3';
end;
$function$;

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
        or (p_active_exposure_revision='2026-09-04.mcp-exposure.v14'
            and grant_record.exposure_revision='2026-09-07.mcp-exposure.v17' and grant_record.consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12'
            and client_record.scope_ceiling=array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read']::text[])
        or (p_active_exposure_revision = '2026-09-04.mcp-exposure.v14'
            and grant_record.exposure_revision = '2026-09-04.mcp-exposure.v14'
            and grant_record.consent_catalog_revision = '2026-09-04.mcp-consent-catalog.v9'
            and cardinality(client_record.scope_ceiling)>0
            and client_record.scope_ceiling <@ array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read']::text[])
      )
      and (
        grant_record.exposure_revision not in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17')
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

CREATE OR REPLACE FUNCTION public.resolve_mcp_oauth_canary_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_exposure_revision text, p_consent_catalog_revision text)
 RETURNS TABLE(exposure_revision text, consent_catalog_revision text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select
    binding.exposure_revision,
    binding.consent_catalog_revision,
    binding.expires_at
  from private.mcp_oauth_canary_bindings binding
  join private.mcp_oauth_clients client
    on client.client_id = binding.oauth_client_id
   and client.disabled_at is null
   and client.exposure_revision = binding.exposure_revision
   and client.consent_catalog_revision = binding.consent_catalog_revision
  where auth.role() is not distinct from 'service_role'
    and binding.oauth_client_id = p_oauth_client_id
    and binding.user_id = p_user_id
    and binding.company_id = p_company_id
    and binding.exposure_revision = p_exposure_revision
    and binding.consent_catalog_revision = p_consent_catalog_revision
    and private.mcp_oauth_canary_is_current(p_oauth_client_id,p_user_id,p_company_id,p_exposure_revision,p_consent_catalog_revision)
    and binding.disabled_at is null
    and binding.expires_at > statement_timestamp()
    and private.user_is_active_company_member(
      binding.user_id,
      binding.company_id
    );
$function$;

CREATE OR REPLACE FUNCTION public.revoke_mcp_oauth_grant_as_system(p_grant_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_revoked boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.id = p_grant_id
    and grants.user_id = p_user_id
    and grants.revoked_at is null;
  v_revoked := found;

  if v_revoked then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = p_grant_id;

    update private.agent_day_closeout_routines routine
    set enabled = false,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        attempt_count = 0,
        retry_not_before = null,
        last_failure_code = 'OAUTH_GRANT_REVOKED',
        schedule_revision = case
          when routine.schedule_revision = 9007199254740991 then 0
          else routine.schedule_revision + 1
        end,
        updated_at = statement_timestamp()
    where routine.oauth_grant_id = p_grant_id
      and routine.enabled;
  end if;

  return v_revoked;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_mcp_oauth_token_as_system(p_token_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select tokens.grant_id
  into v_grant_id
  from private.mcp_oauth_tokens tokens
  where tokens.token_hash = p_token_hash;

  if v_grant_id is not null then
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_grant_id;
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = v_grant_id;

    update private.agent_day_closeout_routines routine
    set enabled = false,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        attempt_count = 0,
        retry_not_before = null,
        last_failure_code = 'OAUTH_GRANT_REVOKED',
        schedule_revision = case
          when routine.schedule_revision = 9007199254740991 then 0
          else routine.schedule_revision + 1
        end,
        updated_at = statement_timestamp()
    where routine.oauth_grant_id = v_grant_id
      and routine.enabled;
  end if;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rotate_mcp_oauth_refresh_token_as_system(p_presented_hash text, p_client_id uuid, p_active_grantable_scopes text[], p_new_access_hash text, p_new_refresh_hash text, p_access_expires_at timestamp with time zone, p_refresh_expires_at timestamp with time zone)
 RETURNS TABLE(grant_id uuid, client_id uuid, user_id uuid, company_id uuid, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, revision text, issuer text, audience text, reuse_detected boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_grant_id uuid;
  v_family_id uuid;
  v_user_id uuid;
  v_company_id uuid;
  v_exposure_revision text;
  v_consent_catalog_revision text;
  v_rotated record;
  v_effective_grantable_scopes text[] := p_active_grantable_scopes;
  v_required_v3_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.mcp_oauth_clients client
    where client.client_id = p_client_id
      and client.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17')
  ) then
    perform private.lock_mcp_v3_canary_client(p_client_id);
  end if;

  select
    grant_record.id,
    token_record.family_id,
    grant_record.user_id,
    grant_record.company_id,
    grant_record.exposure_revision,
    grant_record.consent_catalog_revision
  into
    v_grant_id,
    v_family_id,
    v_user_id,
    v_company_id,
    v_exposure_revision,
    v_consent_catalog_revision
  from private.mcp_oauth_tokens token_record
  join private.mcp_oauth_grants grant_record
    on grant_record.id = token_record.grant_id
  where token_record.token_hash = p_presented_hash
    and token_record.kind = 'refresh'
    and grant_record.client_id = p_client_id;

  if v_exposure_revision = '2026-08-30.mcp-exposure.v3' then
    if v_consent_catalog_revision is distinct from
         '2026-08-30.mcp-consent-catalog.v2'
       or not private.mcp_oauth_canary_is_current(
         p_client_id,
         v_user_id,
         v_company_id,
         v_exposure_revision,
         v_consent_catalog_revision
       ) then
      update private.mcp_oauth_tokens token_record
      set revoked_at = coalesce(token_record.revoked_at, statement_timestamp())
      where token_record.family_id = v_family_id;

      update private.mcp_oauth_grants grant_record
      set revoked_at = coalesce(grant_record.revoked_at, statement_timestamp())
      where grant_record.id = v_grant_id;

      update private.agent_day_closeout_routines routine
      set enabled = false,
          claimed_at = null,
          claim_token = null,
          claim_expires_at = null,
          attempt_count = 0,
          retry_not_before = null,
          last_failure_code = 'OAUTH_CANARY_UNAVAILABLE',
          schedule_revision = case
            when routine.schedule_revision = 9007199254740991 then 0
            else routine.schedule_revision + 1
          end,
          updated_at = statement_timestamp()
      where routine.oauth_grant_id = v_grant_id
        and (
          routine.enabled
          or routine.claimed_at is not null
          or routine.claim_token is not null
          or routine.claim_expires_at is not null
        );
      return;
    end if;

    select array_agg(scope_value order by scope_value)
    into v_effective_grantable_scopes
    from (
      select distinct unnest(
        p_active_grantable_scopes || v_required_v3_scopes
      ) as scope_value
    ) combined_scopes;
  end if;

  if v_exposure_revision='2026-09-07.mcp-exposure.v17' then
    if v_consent_catalog_revision is distinct from '2026-09-07.mcp-consent-catalog.v12' or not private.mcp_oauth_canary_is_current(p_client_id,v_user_id,v_company_id,v_exposure_revision,v_consent_catalog_revision) then
      update private.mcp_oauth_tokens t set revoked_at=coalesce(t.revoked_at,statement_timestamp()) where t.family_id=v_family_id;
      update private.mcp_oauth_grants g set revoked_at=coalesce(g.revoked_at,statement_timestamp()) where g.id=v_grant_id;
      return;
    end if;
    v_effective_grantable_scopes:=array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read']::text[];
  end if;
  select *
  into v_rotated
  from public.rotate_mcp_oauth_refresh_token_without_v3_canary(
    p_presented_hash,
    p_client_id,
    v_effective_grantable_scopes,
    p_new_access_hash,
    p_new_refresh_hash,
    p_access_expires_at,
    p_refresh_expires_at
  );
  if not found then
    return;
  end if;

  if v_rotated.reuse_detected then
    update private.agent_day_closeout_routines routine
    set enabled = false,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        attempt_count = 0,
        retry_not_before = null,
        last_failure_code = 'OAUTH_GRANT_REVOKED',
        schedule_revision = case
          when routine.schedule_revision = 9007199254740991 then 0
          else routine.schedule_revision + 1
        end,
        updated_at = statement_timestamp()
    where routine.oauth_grant_id = v_rotated.grant_id
      and (
        routine.enabled
        or routine.claimed_at is not null
        or routine.claim_token is not null
        or routine.claim_expires_at is not null
      );
  end if;

  return query select
    v_rotated.grant_id::uuid,
    v_rotated.client_id::uuid,
    v_rotated.user_id::uuid,
    v_rotated.company_id::uuid,
    v_rotated.scopes::text[],
    v_rotated.accepted_labels::text[],
    v_rotated.consent_catalog_revision::text,
    v_rotated.exposure_revision::text,
    v_rotated.revision::text,
    v_rotated.issuer::text,
    v_rotated.audience::text,
    v_rotated.reuse_detected::boolean;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rotate_mcp_oauth_refresh_token_without_v3_canary(p_presented_hash text, p_client_id uuid, p_active_grantable_scopes text[], p_new_access_hash text, p_new_refresh_hash text, p_access_expires_at timestamp with time zone, p_refresh_expires_at timestamp with time zone)
 RETURNS TABLE(grant_id uuid, client_id uuid, user_id uuid, company_id uuid, scopes text[], accepted_labels text[], consent_catalog_revision text, exposure_revision text, revision text, issuer text, audience text, reuse_detected boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_token record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select
    tokens.token_hash,
    tokens.grant_id,
    tokens.family_id,
    tokens.issuer,
    tokens.audience,
    tokens.expires_at,
    tokens.used_at,
    tokens.revoked_at,
    grants.user_id,
    grants.company_id,
    grants.client_id,
    grants.scopes,
    grants.accepted_labels,
    grants.consent_catalog_revision,
    grants.exposure_revision,
    grants.revision,
    grants.revoked_at as grant_revoked_at,
    clients.disabled_at as client_disabled_at
  into v_token
  from private.mcp_oauth_tokens tokens
  join private.mcp_oauth_grants grants on grants.id = tokens.grant_id
  join private.mcp_oauth_clients clients on clients.client_id = grants.client_id
  where tokens.token_hash = p_presented_hash
    and tokens.kind = 'refresh'
    and clients.client_id = p_client_id
    and grants.scopes <@ clients.scope_ceiling
    and grants.scopes <@ p_active_grantable_scopes
  for update of tokens, grants;

  if not found then
    return;
  end if;
  if v_token.used_at is not null or v_token.revoked_at is not null then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.family_id = v_token.family_id;
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_token.grant_id;
    return query select
      v_token.grant_id,
      v_token.client_id,
      v_token.user_id,
      v_token.company_id,
      v_token.scopes,
      v_token.accepted_labels,
      v_token.consent_catalog_revision,
      v_token.exposure_revision,
      v_token.revision,
      v_token.issuer,
      v_token.audience,
      true;
    return;
  end if;
  if v_token.expires_at <= statement_timestamp()
     or v_token.grant_revoked_at is not null
     or v_token.client_disabled_at is not null then
    return;
  end if;
  if p_new_access_hash is null or p_new_access_hash !~ '^[0-9a-f]{64}$'
     or p_new_refresh_hash is null or p_new_refresh_hash !~ '^[0-9a-f]{64}$'
     or p_new_access_hash = p_new_refresh_hash then
    raise exception 'mcp_oauth_token_hash_invalid' using errcode = '22023';
  end if;

  update private.mcp_oauth_tokens tokens
  set used_at = statement_timestamp(),
      rotated_to_hash = p_new_refresh_hash
  where tokens.token_hash = v_token.token_hash;

  insert into private.mcp_oauth_tokens (
    token_hash, kind, grant_id, family_id, issuer, audience, expires_at
  ) values
    (p_new_access_hash, 'access', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_access_expires_at),
    (p_new_refresh_hash, 'refresh', v_token.grant_id, v_token.family_id,
     v_token.issuer, v_token.audience, p_refresh_expires_at);

  update private.mcp_oauth_grants grants
  set last_used_at = statement_timestamp()
  where grants.id = v_token.grant_id;
  perform private.prune_expired_mcp_oauth_artifacts();

  return query select
    v_token.grant_id,
    v_token.client_id,
    v_token.user_id,
    v_token.company_id,
    v_token.scopes,
    v_token.accepted_labels,
    v_token.consent_catalog_revision,
    v_token.exposure_revision,
    v_token.revision,
    v_token.issuer,
    v_token.audience,
    false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_mcp_oauth_canary_cleanup_as_system(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid)
 RETURNS TABLE(binding_inactive boolean, client_disabled boolean, grants_inactive boolean, tokens_inactive boolean, routines_safe boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query select
    not exists (
      select 1
      from private.mcp_oauth_canary_bindings binding
      where binding.oauth_client_id = p_oauth_client_id
        and binding.user_id = p_user_id
        and binding.company_id = p_company_id
        and binding.disabled_at is null
        and binding.expires_at > statement_timestamp()
    ),
    exists (
      select 1
      from private.mcp_oauth_clients client
      where client.client_id = p_oauth_client_id
        and client.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and client.disabled_at is not null
    ),
    not exists (
      select 1
      from private.mcp_oauth_grants grant_record
      where grant_record.client_id = p_oauth_client_id
        and grant_record.user_id = p_user_id
        and grant_record.company_id = p_company_id
        and grant_record.revoked_at is null
    ),
    not exists (
      select 1
      from private.mcp_oauth_tokens token_record
      join private.mcp_oauth_grants grant_record
        on grant_record.id = token_record.grant_id
      where grant_record.client_id = p_oauth_client_id
        and grant_record.user_id = p_user_id
        and grant_record.company_id = p_company_id
        and token_record.revoked_at is null
    ),
    not exists (
      select 1
      from private.agent_day_closeout_routines routine
      where routine.oauth_client_id = p_oauth_client_id
        and routine.actor_user_id = p_user_id
        and routine.company_id = p_company_id
        and (
          routine.enabled
          or routine.claimed_at is not null
          or routine.claim_token is not null
          or routine.claim_expires_at is not null
        )
    );
end;
$function$;

