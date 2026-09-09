-- Exact, temporary catalog trial. No clients, bindings, grants, effect seals or business seeds.
create table private.agent_catalog_trial_bindings (
  id uuid primary key default gen_random_uuid(),
  oauth_client_id uuid not null unique references private.mcp_oauth_clients(client_id),
  actor_user_id uuid not null references public.users(id),
  company_id uuid not null references public.companies(id),
  effect_sha256 text not null check (effect_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  disabled_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);
alter table private.agent_catalog_trial_bindings enable row level security;
alter table private.agent_catalog_trial_bindings force row level security;
revoke all on private.agent_catalog_trial_bindings from public, anon, authenticated, service_role;

create function private.agent_catalog_trial_scopes() returns text[]
language sql immutable set search_path='' as $$
 select array['ops.catalog.prepare','ops.catalog.read','ops.catalog_costs.read','ops.catalog_costs.write','ops.catalog_prices.write','ops.company.read','ops.inventory.adjust']::text[]
$$;

create function private.agent_catalog_trial_current(p_client uuid,p_actor uuid,p_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
   select 1 from private.agent_catalog_trial_bindings b
   join private.mcp_oauth_clients c on c.client_id=b.oauth_client_id
   join private.agent_catalog_effect_policy e on e.revision='2026-09-08.v1' and e.effect_sha256=b.effect_sha256
   cross join lateral private.resolve_agent_actor_authority(p_actor,p_company,
     array['agent.review','catalog.import','catalog.manage','catalog.products.manage','catalog.products.view','catalog.stock.adjust','catalog.view','finances.view']::text[]) a
   where b.oauth_client_id=p_client and b.actor_user_id=p_actor and b.company_id=p_company
     and b.disabled_at is null and b.expires_at > statement_timestamp()
     and c.disabled_at is null and c.exposure_revision='2026-09-08.mcp-exposure.v19'
     and c.consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
     and c.scope_ceiling=private.agent_catalog_trial_scopes()
     and c.scope=array_to_string(private.agent_catalog_trial_scopes(),' ')
     and private.user_is_active_company_member(p_actor,p_company)
     and a.effective_permissions @> '[{"permission":"agent.review","scope":"all"},{"permission":"catalog.import","scope":"all"},{"permission":"catalog.manage","scope":"all"},{"permission":"catalog.products.manage","scope":"all"},{"permission":"catalog.products.view","scope":"all"},{"permission":"catalog.stock.adjust","scope":"all"},{"permission":"catalog.view","scope":"all"},{"permission":"finances.view","scope":"all"}]'::jsonb
     and b.effect_sha256=private.agent_catalog_effect_revision()
 )
$$;

create function private.guard_catalog_trial_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'CATALOG_TRIAL_BINDING_IMMUTABLE' using errcode='22023'; end if;
  perform private.lock_mcp_v3_canary_client(new.oauth_client_id);
  if tg_op='UPDATE' and (
    (to_jsonb(new)-'disabled_at') is distinct from (to_jsonb(old)-'disabled_at')
    or (old.disabled_at is not null and new.disabled_at is distinct from old.disabled_at)
    or (new.disabled_at is not null and new.disabled_at < new.created_at)
  ) then raise exception 'CATALOG_TRIAL_BINDING_IMMUTABLE' using errcode='22023'; end if;
  return new;
end $$;
create trigger agent_catalog_trial_binding_immutable before insert or update or delete
on private.agent_catalog_trial_bindings for each row execute function private.guard_catalog_trial_binding();

create function public.provision_catalog_oauth_trial_as_system(
  p_oauth_client_id uuid,p_actor_user_id uuid,p_company_id uuid,p_expires_at timestamptz,p_reviewed_effect_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'access_denied' using errcode='42501'; end if;
  perform private.lock_mcp_v3_canary_client(p_oauth_client_id);
  perform 1 from private.mcp_oauth_clients c where c.client_id=p_oauth_client_id
    and c.disabled_at is null and c.exposure_revision='2026-09-08.mcp-exposure.v19'
    and c.consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
    and c.scope_ceiling=private.agent_catalog_trial_scopes()
    and c.scope=array_to_string(private.agent_catalog_trial_scopes(),' ') for share nowait;
  if not found or p_expires_at is null or p_expires_at <= clock_timestamp()
    or p_expires_at > statement_timestamp()+interval '2 hours'
    or p_reviewed_effect_sha256 is distinct from private.agent_catalog_effect_revision()
    or exists(select 1 from private.mcp_oauth_grants where client_id=p_oauth_client_id)
    or exists(select 1 from private.mcp_oauth_canary_bindings where oauth_client_id=p_oauth_client_id)
  then raise exception 'CATALOG_TRIAL_PROVISION_DENIED' using errcode='42501'; end if;
  insert into private.agent_catalog_trial_bindings(oauth_client_id,actor_user_id,company_id,effect_sha256,expires_at)
  values(p_oauth_client_id,p_actor_user_id,p_company_id,p_reviewed_effect_sha256,p_expires_at) returning id into result;
  if not private.agent_catalog_trial_current(p_oauth_client_id,p_actor_user_id,p_company_id)
  then raise exception 'CATALOG_TRIAL_PROVISION_DENIED' using errcode='42501'; end if;
  return result;
end $$;

-- Domain actions, including exact OPS approval, use the sealed original MCP identity.
-- The temporary rollout has no internal/ops_api escape hatch or global activation.
create function private.agent_catalog_trial_authorize(ctx jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if ctx->>'channel' is distinct from 'mcp' then raise exception 'CATALOG_TRIAL_REQUIRED' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('ops-mcp-v3-canary:'||(ctx->>'client'),0))
  then raise exception 'CATALOG_TRIAL_BUSY' using errcode='55P03'; end if;
  perform 1 from private.agent_catalog_trial_bindings where oauth_client_id=(ctx->>'client')::uuid for share nowait;
  if not found or not private.agent_catalog_trial_current((ctx->>'client')::uuid,(ctx->>'actor')::uuid,(ctx->>'company')::uuid)
  then raise exception 'CATALOG_TRIAL_UNAVAILABLE' using errcode='42501'; end if;
end $$;

revoke all on function private.agent_catalog_trial_scopes(),private.agent_catalog_trial_current(uuid,uuid,uuid),private.guard_catalog_trial_binding(),private.agent_catalog_trial_authorize(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.provision_catalog_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.provision_catalog_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text) to service_role;

-- Refuse to overwrite concurrent changes to the reviewed live OAuth contract.
do $guard$
begin
  if md5(pg_get_functiondef('private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure)) is distinct from 'a8f62edd920822b4dcb40913aa85116c' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: private.mcp_oauth_labels_for_scopes'; end if;
  if md5(pg_get_functiondef('private.mcp_oauth_canary_is_current(uuid,uuid,uuid,text,text)'::regprocedure)) is distinct from 'fbf02c9f90d8c555301e44da5e9609a7' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: private.mcp_oauth_canary_is_current'; end if;
  if md5(pg_get_functiondef('public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)'::regprocedure)) is distinct from '6dd60b10f5e0f379e15ab2a6cf92ae75' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: public.resolve_mcp_oauth_canary_as_system'; end if;
  if md5(pg_get_functiondef('private.enforce_mcp_v3_canary_write()'::regprocedure)) is distinct from '128f451295bae441211e8c4f578e6f82' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: private.enforce_mcp_v3_canary_write'; end if;
  if md5(pg_get_functiondef('public.resolve_mcp_oauth_access_token_as_system(text,text)'::regprocedure)) is distinct from '34e9dc72a835bb0367ff61514c67969b' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: public.resolve_mcp_oauth_access_token_as_system'; end if;
  if md5(pg_get_functiondef('public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)'::regprocedure)) is distinct from '086e9481de49bfa1ffacbaaa342e5876' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: public.rotate_mcp_oauth_refresh_token_as_system'; end if;
  if md5(pg_get_functiondef('public.disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)'::regprocedure)) is distinct from 'f54bae6c700e88eb25531b87a0daf818' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: public.disable_mcp_oauth_canary_as_system'; end if;
  if md5(pg_get_functiondef('private.agent_catalog_authorize(jsonb,jsonb)'::regprocedure)) is distinct from '0cc6e726e764941990c1635d5a784991' then raise exception 'CATALOG_TRIAL_BASELINE_DRIFT: private.agent_catalog_authorize'; end if;
end $guard$;

CREATE OR REPLACE FUNCTION private.mcp_oauth_labels_for_scopes(p_scopes text[], p_consent_catalog_revision text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  with labelled as materialized (
    select requested.ordinal,
           case requested.scope
             when 'ops.catalog.prepare' then case when p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14' then 'Inspect source rows and prepare exact catalog changes for named operator approval in OPS' end
             when 'ops.catalog_prices.write' then case when p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14' then 'Prepare catalog price changes for exact approval in OPS; never change stock' end
             when 'ops.catalog_costs.write' then case when p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14' then 'Prepare catalog cost changes for exact approval in OPS' end
             when 'ops.inventory.adjust' then case when p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14' then 'Prepare separate stock count adjustments for exact approval in OPS; never record purchases' end
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
           '2026-09-08.mcp-consent-catalog.v14',
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

CREATE OR REPLACE FUNCTION private.mcp_oauth_canary_is_current(p_oauth_client_id uuid, p_user_id uuid, p_company_id uuid, p_exposure_revision text, p_consent_catalog_revision text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
  select (p_exposure_revision='2026-09-08.mcp-exposure.v19' and p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
    and private.agent_catalog_trial_current(p_oauth_client_id,p_user_id,p_company_id)) or exists (
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
    )
  union all
  select '2026-09-08.mcp-exposure.v19','2026-09-08.mcp-consent-catalog.v14',binding.expires_at
  from private.agent_catalog_trial_bindings binding
  where auth.role() is not distinct from 'service_role'
    and binding.oauth_client_id=p_oauth_client_id and binding.actor_user_id=p_user_id and binding.company_id=p_company_id
    and p_exposure_revision='2026-09-08.mcp-exposure.v19' and p_consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
    and private.agent_catalog_trial_current(p_oauth_client_id,p_user_id,p_company_id);
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
  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
    if v_consent_catalog_revision is distinct from '2026-09-08.mcp-consent-catalog.v14' or not private.agent_catalog_trial_current(v_client_id,v_user_id,v_company_id) then
      raise exception 'CATALOG_TRIAL_UNAVAILABLE' using errcode='42501';
    end if;
  end if;
  return new;
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
            and grant_record.exposure_revision='2026-09-08.mcp-exposure.v19' and grant_record.consent_catalog_revision='2026-09-08.mcp-consent-catalog.v14'
            and client_record.scope_ceiling=private.agent_catalog_trial_scopes())
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
      and client.exposure_revision in ('2026-08-30.mcp-exposure.v3','2026-09-07.mcp-exposure.v17','2026-09-08.mcp-exposure.v19')
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
  if v_exposure_revision='2026-09-08.mcp-exposure.v19' then
    if v_consent_catalog_revision is distinct from '2026-09-08.mcp-consent-catalog.v14' or not private.agent_catalog_trial_current(p_client_id,v_user_id,v_company_id) then
      update private.mcp_oauth_tokens t set revoked_at=coalesce(t.revoked_at,statement_timestamp()) where t.family_id=v_family_id;
      update private.mcp_oauth_grants g set revoked_at=coalesce(g.revoked_at,statement_timestamp()) where g.id=v_grant_id;
      return;
    end if;
    v_effective_grantable_scopes:=private.agent_catalog_trial_scopes();
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

  if exists(select 1 from private.agent_catalog_trial_bindings where oauth_client_id=p_oauth_client_id) then
    update private.agent_catalog_trial_bindings b set disabled_at=coalesce(b.disabled_at,statement_timestamp())
    where b.oauth_client_id=p_oauth_client_id and b.actor_user_id=p_user_id and b.company_id=p_company_id;
    v_found:=found;
    if not v_found then return false; end if;
    update private.mcp_oauth_clients c set disabled_at=coalesce(c.disabled_at,statement_timestamp()) where c.client_id=p_oauth_client_id and c.exposure_revision='2026-09-08.mcp-exposure.v19';
    update private.mcp_oauth_grants g set revoked_at=coalesce(g.revoked_at,statement_timestamp()) where g.client_id=p_oauth_client_id and g.user_id=p_user_id and g.company_id=p_company_id and g.exposure_revision='2026-09-08.mcp-exposure.v19';
    update private.mcp_oauth_tokens t set revoked_at=coalesce(t.revoked_at,statement_timestamp()) from private.mcp_oauth_grants g where t.grant_id=g.id and g.client_id=p_oauth_client_id and g.user_id=p_user_id and g.company_id=p_company_id and g.exposure_revision='2026-09-08.mcp-exposure.v19';
    return true;
  end if;
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

CREATE OR REPLACE FUNCTION private.agent_catalog_authorize(ctx jsonb, req jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 declare perms text[]:=array['agent.review','catalog.view'];scopes text[]:=array['ops.catalog.read','ops.catalog.prepare'];r jsonb;actual record;required jsonb;g private.mcp_oauth_grants%rowtype;c private.mcp_oauth_clients%rowtype;keys text[];
 begin
 if auth.role() is distinct from 'service_role' then raise exception 'access_denied' using errcode='42501';end if;
 if ctx->>'manifest' is distinct from '2026-09-08.capability-manifest.v24' or ctx->>'channel' not in ('mcp','internal','ops_api') then raise exception 'CATALOG_AUTHORITY_INVALID' using errcode='42501';end if;
 if req->>'operation'='inventory' then perms:=perms||array['catalog.stock.adjust'];scopes:=scopes||array['ops.inventory.adjust'];
 else perms:=perms||array['catalog.manage'];end if;
 if req->'source'->>'kind'='file' then perms:=perms||array['catalog.import'];end if;
 for r in select value from jsonb_array_elements(req->'rows') loop
 if r->>'entity' in ('product','recipe') then perms:=perms||array['catalog.products.manage','catalog.products.view'];end if;
 if (r->'values') ?| array['price','minimum_charge'] then scopes:=scopes||array['ops.catalog_prices.write'];end if;
 if (r->'values') ? 'cost' then perms:=perms||array['finances.view'];scopes:=scopes||array['ops.catalog_costs.read','ops.catalog_costs.write'];end if;
 end loop;
 keys:=array(select jsonb_array_elements_text(ctx->'permission_keys'));
 if keys is null or cardinality(keys) not between 1 and 256 or not perms <@ keys or keys is distinct from (select array_agg(distinct k collate "C" order by k collate "C") from unnest(keys) k) then raise exception 'CATALOG_PERMISSION_KEYS_INVALID' using errcode='42501';end if;
 perform private.agent_catalog_deadline();
 lock table public.roles,public.user_roles,public.role_permissions,public.user_permission_overrides in share mode nowait;
 perform 1 from public.users where id=(ctx->>'actor')::uuid for share nowait;
 select * into actual from private.resolve_agent_actor_authority((ctx->>'actor')::uuid,(ctx->>'company')::uuid,keys);
 select jsonb_agg(jsonb_build_object('permission',p,'scope','all')) into required from (select distinct unnest(perms) p) q;
 if actual.permission_snapshot_revision is null or actual.permission_snapshot_revision is distinct from ctx->>'permission_revision' or not actual.effective_permissions @> required then raise exception 'CATALOG_AUTHORITY_STALE_OR_DENIED' using errcode='42501';end if;
 perform private.agent_catalog_trial_authorize(ctx);
 if ctx->>'channel'='mcp' then
 select * into g from private.mcp_oauth_grants where id=(ctx->>'grant')::uuid for share nowait;
 select * into c from private.mcp_oauth_clients where client_id=(ctx->>'client')::uuid for share nowait;
 if g.id is null or c.client_id is null or g.user_id is distinct from (ctx->>'actor')::uuid or g.company_id is distinct from (ctx->>'company')::uuid or g.client_id is distinct from c.client_id or g.revoked_at is not null or c.disabled_at is not null
 or g.revision is distinct from ctx->>'grant_revision' or g.scopes is distinct from array(select jsonb_array_elements_text(ctx->'scopes')) or not scopes <@ g.scopes or not g.scopes <@ c.scope_ceiling
 or c.scope is distinct from array_to_string(c.scope_ceiling,' ') or g.exposure_revision is distinct from '2026-09-08.mcp-exposure.v19' or c.exposure_revision is distinct from g.exposure_revision
 or g.consent_catalog_revision is distinct from '2026-09-08.mcp-consent-catalog.v14' or c.consent_catalog_revision is distinct from g.consent_catalog_revision
 or g.accepted_labels is distinct from private.agent_catalog_labels(g.scopes,g.consent_catalog_revision) then raise exception 'CATALOG_GRANT_STALE_OR_DENIED' using errcode='42501';end if;
 else
 if ctx->>'grant' is not null or ctx->>'client' is not null then raise exception 'CATALOG_AUTHORITY_INVALID';end if;
 end if;
 end $function$;

notify pgrst, 'reload schema';
