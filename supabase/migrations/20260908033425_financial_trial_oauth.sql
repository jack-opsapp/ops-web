-- Phase16 restricted financial OAuth trial. Installs no clients, bindings, grants,
-- enrollment or effect approval. Ordinary registration remains v14/v9.
begin;
set local lock_timeout='3s';
set local statement_timeout='120s';
-- Refuse an unreviewed baseline; all original functions were read from production.
do $$ begin
 if md5(pg_get_functiondef('private.assert_financial_document_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)'::regprocedure))<>'827d31ce25428a91edae5520c27be566' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: private.assert_financial_document_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)';end if;
 if md5(pg_get_functiondef('disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)'::regprocedure))<>'92f3419aabba817d318090584fd725ca' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)';end if;
 if md5(pg_get_functiondef('private.enforce_mcp_v3_canary_write()'::regprocedure))<>'9963ea713caf1e5b84dd2fbb7ebb787a' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: private.enforce_mcp_v3_canary_write()';end if;
 if md5(pg_get_functiondef('private.mcp_oauth_canary_is_current(uuid,uuid,uuid,text,text)'::regprocedure))<>'4c3e73f9435b52d177fbe2c492701846' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: private.mcp_oauth_canary_is_current(uuid,uuid,uuid,text,text)';end if;
 if md5(pg_get_functiondef('private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure))<>'9cf5d0bbde57d083133abd1d14a5b8ad' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: private.mcp_oauth_labels_for_scopes(text[],text)';end if;
 if md5(pg_get_functiondef('resolve_mcp_oauth_access_token_as_system(text,text)'::regprocedure))<>'e11c6ea61cd748aa465c4dd103964dd3' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: resolve_mcp_oauth_access_token_as_system(text,text)';end if;
 if md5(pg_get_functiondef('rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)'::regprocedure))<>'b69ca68f6b3c2b6c0c0c39a04d96509f' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)';end if;
 if md5(pg_get_functiondef('public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)'::regprocedure))<>'b52694d45d53580fc3fdbaf071ff14aa' then raise exception 'FINANCIAL_TRIAL_DEFINITION_DRIFT: public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)';end if;
end $$;
alter table private.mcp_oauth_canary_bindings
 drop constraint mcp_oauth_canary_bindings_exposure_exact,
 drop constraint mcp_oauth_canary_bindings_consent_exact,
 add column financial_policy_id uuid references private.financial_document_policies(id),
 add column financial_policy_sha256 text,
 add column financial_effect_revision text,
 add constraint mcp_oauth_canary_binding_revision_pair check (
 (exposure_revision='2026-08-30.mcp-exposure.v3' and consent_catalog_revision='2026-08-30.mcp-consent-catalog.v2'
 and financial_policy_id is null and financial_policy_sha256 is null and financial_effect_revision is null)
 or (exposure_revision='2026-09-07.mcp-exposure.v17' and consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12'
 and financial_policy_id is not null and financial_policy_sha256 is not null and financial_policy_sha256 ~ '^sha256:[0-9a-f]{64}$'
 and financial_effect_revision is not null and financial_effect_revision ~ '^sha256:[0-9a-f]{64}$'
 and expires_at<=created_at+interval '2 hours'));
alter table private.mcp_oauth_canary_bindings force row level security;
revoke all on private.mcp_oauth_canary_bindings from public,anon,authenticated,service_role;

-- Financial binding identity and reviewed facts cannot be edited or extended.
create function private.guard_financial_trial_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.exposure_revision='2026-09-07.mcp-exposure.v17' or new.exposure_revision='2026-09-07.mcp-exposure.v17' then
  if tg_op='DELETE' or (to_jsonb(new)-'disabled_at') is distinct from (to_jsonb(old)-'disabled_at')
   or old.disabled_at is not null and new.disabled_at is distinct from old.disabled_at
   or new.disabled_at is null then raise exception 'FINANCIAL_TRIAL_BINDING_IMMUTABLE';end if;
 end if;
 return new;
end $$;
create trigger financial_trial_binding_immutable before update or delete on private.mcp_oauth_canary_bindings for each row execute function private.guard_financial_trial_binding();

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
$function$
;
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
$function$
;
-- Service-only, explicit exact-subject enrollment. There is no automatic caller.
create function public.provision_mcp_oauth_canary_as_system(
 p_oauth_client_id uuid,p_user_id uuid,p_company_id uuid,p_exposure_revision text,
 p_consent_catalog_revision text,p_expires_at timestamptz,
 p_financial_policy_id uuid,p_financial_policy_sha256 text,p_financial_effect_revision text)
returns uuid language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.provision_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text,timestamptz,uuid,text,text) from public,anon,authenticated;
grant execute on function public.provision_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text,timestamptz,uuid,text,text) to service_role;
revoke all on function private.guard_financial_trial_binding() from public,anon,authenticated,service_role;
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION private.assert_financial_document_authority(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_manifest_revision text, p_exposure_revision text, p_capability_id text, p_capability_revision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_permission_revision text;
  v_required_permissions constant text[] := array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view'];
  v_required_scopes constant text[] := array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read'];
  v_exposure_scopes constant text[] := array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.financial_documents.prepare','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read'];
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
       '2026-09-07.capability-manifest.v23'
     or p_exposure_revision is distinct from
       '2026-09-07.mcp-exposure.v17'
     or p_capability_id is distinct from
       'prepare_financial_document'
     or p_capability_revision is distinct from
       'prepare_financial_document:2026-09-07.v1'
     or not v_required_scopes <@ p_granted_scope_ceiling then
    raise exception 'FINANCIAL_DOCUMENT_AUTHORITY_REVISION_INVALID'
      using errcode = '42501';
  end if;

  -- The same client fence orders financial actions against trial revocation.
  -- Use NOWAIT semantics because approval may already hold the company lock.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ops-mcp-v3-canary:'||p_oauth_client_id::text,0)) then
    raise exception 'FINANCIAL_DOCUMENT_BUSY' using errcode='55P03';
  end if;
  if not private.mcp_oauth_canary_is_current(p_oauth_client_id,p_actor_user_id,p_company_id,p_exposure_revision,'2026-09-07.mcp-consent-catalog.v12') then
    raise exception 'FINANCIAL_TRIAL_UNAVAILABLE' using errcode='42501';
  end if;
  -- Canonical company lock precedes authority/record locks. Tables fence role insertion phantoms.
  perform private.financial_document_lock(p_company_id);
  lock table public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides in share mode nowait;
  perform 1 from public.companies where id=p_company_id for share nowait;
  perform 1 from public.users where id=p_actor_user_id for share nowait;
  perform 1 from private.mcp_oauth_clients where client_id=p_oauth_client_id for share nowait;
  perform 1 from private.mcp_oauth_grants where id=p_oauth_grant_id for share nowait;
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
    raise exception 'FINANCIAL_DOCUMENT_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and cardinality(client_record.scope_ceiling)>0
     and client_record.scope_ceiling = v_required_scopes
     and client_record.scope =
       pg_catalog.array_to_string(client_record.scope_ceiling,' ')
     and client_record.consent_catalog_revision =
       '2026-09-07.mcp-consent-catalog.v12'
     and client_record.exposure_revision =
       '2026-09-07.mcp-exposure.v17'
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
        '2026-09-07.mcp-consent-catalog.v12'
      and grant_record.exposure_revision = '2026-09-07.mcp-exposure.v17'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes,grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'FINANCIAL_DOCUMENT_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;
  return v_permission_revision;
end;
$function$
;
-- Effect approval intentionally remains stale after installing this code.
commit;
