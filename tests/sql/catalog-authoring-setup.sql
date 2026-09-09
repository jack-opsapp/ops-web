\set ON_ERROR_STOP on
\ir agent-customer-update-setup.sql
\ir catalog-authoring-live-schema.sql
\ir catalog-authoring-identity-helpers.sql
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
create table private.agent_mcp_rate_limit_keys(key_id text primary key,key_material bytea not null);
insert into private.agent_mcp_rate_limit_keys values('mcp-rate-limit-hmac:2026-08-23.v1',decode(repeat('ab',32),'hex'));
alter table private.agent_mcp_rate_limit_buckets add primary key(bucket_digest);
alter table private.agent_mcp_rate_limit_buckets drop constraint agent_mcp_rate_limit_buckets_policy_closed;
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_policy_closed check(policy_id in ('mcp-lightweight-read:2026-08-23.v1','mcp-evidence-search:2026-08-23.v1','mcp-day-closeout-prepare:2026-08-30.v1','mcp-collections-prepare:2026-08-31.v1','mcp-dispatch-confirmation-prepare:2026-09-03.v1','mcp-customer-update-prepare:2026-09-04.v1','mcp-schedule-change-prepare:2026-09-06.v1','mcp-financial-document-prepare:2026-09-07.v1'));
create or replace function private.agent_mcp_rate_limit_bucket_digest(
  p_bucket_kind text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_grant_id uuid,
  p_capability_id text,
  p_policy_id text,
  p_window_start timestamptz
) returns bytea
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_key bytea;
  v_canonical text;
begin
  if p_bucket_kind is null
     or p_bucket_kind not in ('actor', 'grant', 'company')
     or p_company_id is null
     or p_capability_id is null
     or p_policy_id is null
     or p_window_start is null
     or (p_bucket_kind = 'actor' and (
       p_actor_user_id is null or p_grant_id is not null
     ))
     or (p_bucket_kind = 'grant' and (
       p_actor_user_id is null or p_grant_id is null
     ))
     or (p_bucket_kind = 'company' and (
       p_actor_user_id is not null or p_grant_id is not null
     )) then
    raise exception 'agent_mcp_rate_limit_digest_input_invalid'
      using errcode = '22023';
  end if;

  select key_row.key_material
    into strict v_key
  from private.agent_mcp_rate_limit_keys key_row
  where key_row.key_id = 'mcp-rate-limit-hmac:2026-08-23.v1';

  v_canonical := pg_catalog.jsonb_build_array(
    'agent-mcp-rate-limit-bucket:2026-08-23.v1',
    p_bucket_kind,
    p_company_id::text,
    coalesce(p_actor_user_id::text, ''),
    coalesce(p_grant_id::text, ''),
    p_capability_id,
    p_policy_id,
    floor(extract(epoch from p_window_start))::bigint
  )::text;

  return extensions.hmac(
    pg_catalog.convert_to(v_canonical, 'UTF8'),
    v_key,
    'sha256'
  );
end;
$function$;

revoke all on function private.agent_mcp_rate_limit_bucket_digest(
  text, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.prune_agent_mcp_rate_limit_buckets(
  p_limit integer
) returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_deleted integer;
begin
  if p_limit is null or not (p_limit between 1 and 64) then
    raise exception 'agent_mcp_rate_limit_cleanup_bound_invalid'
      using errcode = '22023';
  end if;

  with expired as materialized (
    select bucket.bucket_digest
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.expires_at <= statement_timestamp()
    order by bucket.expires_at, bucket.bucket_digest
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from private.agent_mcp_rate_limit_buckets bucket
    using expired
    where bucket.bucket_digest = expired.bucket_digest
    returning 1
  )
  select count(*)::integer
    into v_deleted
  from deleted;

  return v_deleted;
end;
$function$;

revoke all on function private.prune_agent_mcp_rate_limit_buckets(integer)
  from public, anon, authenticated, service_role;


-- Audit column/identity metadata verified live 2026-09-08.
create table private.mcp_request_audit(id bigint generated always as identity not null,request_id text not null,occurred_at timestamptz default statement_timestamp() not null,grant_id uuid,client_id uuid,actor_user_id uuid,company_id uuid,tool text,protocol_era text,outcome text not null,error_code text,input_sha256 text,result_bytes integer,latency_ms integer);
\ir ../../supabase/migrations/20260908221635_agent_catalog_authoring.sql
