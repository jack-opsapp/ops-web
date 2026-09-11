-- Disposable fixture: captured live columns/checks and real digest/prune/label functions. Unrelated triggers/FKs omitted.
create schema private;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create role anon;create role authenticated;create role service_role;create function auth.role() returns text language sql stable as $$select current_setting('request.role',true)$$;grant usage on schema auth,public to service_role,anon,authenticated;
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
$function$
;
create table private.mcp_oauth_clients("client_id" uuid default gen_random_uuid() not null,"client_name" text not null,"redirect_uris" text[] not null,"token_endpoint_auth_method" text not null,"grant_types" text[] not null,"response_types" text[] not null,"scope" text not null,"registration_source" text not null,"software_id" text,"software_version" text,"created_at" timestamp with time zone default statement_timestamp() not null,"disabled_at" timestamp with time zone,"scope_ceiling" text[] not null,"consent_catalog_revision" text not null,"exposure_revision" text not null);
create table private.mcp_oauth_grants("id" uuid default gen_random_uuid() not null,"user_id" uuid not null,"company_id" uuid not null,"client_id" uuid not null,"scopes" text[] not null,"revision" text not null,"created_at" timestamp with time zone default statement_timestamp() not null,"last_used_at" timestamp with time zone,"revoked_at" timestamp with time zone,"accepted_labels" text[] not null,"consent_catalog_revision" text not null,"exposure_revision" text not null);
create table public.companies("id" uuid default gen_random_uuid() not null,"bubble_id" text,"name" text not null,"external_id" text,"description" text,"website" text,"phone" text,"email" text,"address" text,"latitude" double precision,"longitude" double precision,"open_hour" text,"close_hour" text,"logo_url" text,"default_project_color" text default '#9CA3AF'::text,"industries" text[] default '{}'::text[],"company_size" text,"company_age" text,"referral_method" text,"account_holder_id" text,"admin_ids" text[] default '{}'::text[],"seated_employee_ids" text[] default '{}'::text[],"max_seats" integer default 10,"subscription_status" text,"subscription_plan" text,"subscription_end" timestamp with time zone,"subscription_period" text,"trial_start_date" timestamp with time zone,"trial_end_date" timestamp with time zone,"seat_grace_start_date" timestamp with time zone,"has_priority_support" boolean default false,"data_setup_purchased" boolean default false,"data_setup_completed" boolean default false,"data_setup_scheduled" timestamp with time zone,"stripe_customer_id" text,"subscription_ids_json" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"deleted_at" timestamp with time zone,"company_code" text,"precise_scheduling_enabled" boolean default false,"skip_weekends_in_auto_schedule" boolean default true,"weather_dependent" boolean,"industry" text default 'trades'::text,"client_comms_settings" jsonb default '{"invoice_cover": {"enabled": true, "autonomy": "draft_to_queue", "threshold": 0, "send_delay_minutes": 15}, "status_update": {"cadence": "off", "autonomy": "draft_to_queue", "weekly_day": 1, "send_delay_minutes": 15}, "payment_reminder": {"preset": "standard", "enabled": true, "autonomy": "draft_to_queue", "custom_days": [7, 14, 30, 45], "max_reminders": 4, "send_delay_minutes": 15}, "reschedule_request": {"enabled": true, "autonomy": "draft_to_queue", "behavior": "detect_and_draft", "min_confidence": 0.6, "send_delay_minutes": 15}, "reschedule_requests": {"enabled": true, "min_confidence": 0.6}, "appointment_reminder": {"enabled": true, "autonomy": "draft_to_queue", "lead_days": 1, "include_weather": true, "send_hour_local": 14, "send_delay_minutes": 15}, "comms_wizard_version": 0, "day_before_reminders": {"enabled": true, "send_hour_utc": 14, "include_weather": true}, "appointment_confirmation": {"level": "draft_on_confirm", "confirm_mode": "explicit", "send_delay_minutes": 15, "reschedule_behavior": "draft", "auto_confirm_after_hours": 4}, "appointment_confirmations": {"enabled": true, "delay_hours": 0}, "comms_wizard_completed_at": null, "subcontractor_coordination": {"enabled": false, "trigger": "manual"}}'::jsonb,"timezone" text default 'America/Vancouver'::text not null,"locale" text default 'en'::text not null,"ai_enabled" boolean default true not null,"physical_address" text,"default_work_start" time without time zone default '08:00:00'::time without time zone not null,"default_work_end" time without time zone default '17:00:00'::time without time zone not null,"priority_support_period" text,"currency_code" text default 'CAD'::text not null,"source_app" text default 'ops'::text not null,"lifecycle_settings" jsonb,"schedule_settings" jsonb default '{"enabled": true, "climate_zone": "auto", "cascade_detection": true, "weather_awareness": true, "conflict_detection": true, "travel_optimization": true, "outdoor_task_type_ids": [], "optimization_window_days": 2}'::jsonb not null,"invoice_settings" jsonb default '{"default_tax_rate": 0, "include_cover_email": true, "high_value_threshold": 5000, "default_payment_terms": "NET-30", "financial_intelligence": {"enabled": true, "aging_min_count": 3, "aging_days_threshold": 60, "overdue_pct_threshold": 30, "min_estimates_for_analysis": 5, "concentration_pct_threshold": 40, "win_rate_decrease_threshold": 40, "win_rate_increase_threshold": 80}, "auto_suggest_from_estimate": true, "auto_suggest_on_completion": true}'::jsonb not null,"task_groups_conversion_enabled" boolean default false not null,"public_handle" text not null);
create table public.users("id" uuid default gen_random_uuid() not null,"bubble_id" text,"company_id" uuid,"first_name" text not null,"last_name" text not null,"email" text,"phone" text,"home_address" text,"profile_image_url" text,"user_color" text,"role" text default 'unassigned'::text,"user_type" text,"is_company_admin" boolean default false,"has_completed_tutorial" boolean default false,"dev_permission" boolean default false,"latitude" double precision,"longitude" double precision,"location_name" text,"client_id" text,"is_active" boolean default true,"stripe_customer_id" text,"device_token" text,"auth_id" text,"created_at" timestamp with time zone default now(),"updated_at" timestamp with time zone default now(),"deleted_at" timestamp with time zone,"firebase_uid" text,"special_permissions" text[] default '{}'::text[],"email_domain_valid" boolean,"removed_from_email_list" boolean default false,"removed_from_email_list_at" timestamp with time zone,"fab_actions" text[],"setup_progress" jsonb default '{}'::jsonb,"emergency_contact_name" text,"emergency_contact_phone" text,"emergency_contact_relationship" text,"onboarding_completed" jsonb default '{}'::jsonb,"onesignal_player_id" text,"preferences" jsonb default '{}'::jsonb not null);
create table private.agent_mcp_rate_limit_buckets(bucket_digest bytea not null,bucket_kind text not null,policy_id text not null,window_start timestamptz not null,units_used integer not null,expires_at timestamptz not null);
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_digest_shape CHECK ((octet_length(bucket_digest) = 32));
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_expiry_ordered CHECK ((expires_at > window_start));
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_kind_closed CHECK ((bucket_kind = ANY (ARRAY['actor'::text, 'grant'::text, 'company'::text])));
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_policy_closed CHECK (((policy_id = ANY (ARRAY['mcp-lightweight-read:2026-08-23.v1'::text, 'mcp-evidence-search:2026-08-23.v1'::text, 'mcp-day-closeout-prepare:2026-08-30.v1'::text, 'mcp-collections-prepare:2026-08-31.v1'::text, 'mcp-dispatch-confirmation-prepare:2026-09-03.v1'::text, 'mcp-customer-update-prepare:2026-09-04.v1'::text])) OR (policy_id = 'mcp-schedule-change-prepare:2026-09-06.v1'::text) OR (policy_id = 'mcp-financial-document-prepare:2026-09-07.v1'::text) OR (policy_id = 'mcp-catalog-prepare:2026-09-08.v1'::text)));
alter table private.agent_mcp_rate_limit_buckets add constraint agent_mcp_rate_limit_buckets_units_bounded CHECK (((units_used >= 0) AND (units_used <= 600)));
-- Canonical limiter functions verified against live definitions on 2026-09-07.
create table private.agent_mcp_rate_limit_keys(key_id text primary key,key_material bytea not null);
insert into private.agent_mcp_rate_limit_keys values('mcp-rate-limit-hmac:2026-08-23.v1',decode(repeat('12',32),'hex'));
alter table private.agent_mcp_rate_limit_buckets add primary key(bucket_digest);
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


create table private.mcp_request_audit (id bigint generated always as identity not null,request_id text not null,occurred_at timestamp with time zone default statement_timestamp() not null,grant_id uuid,client_id uuid,actor_user_id uuid,company_id uuid,tool text,protocol_era text,outcome text not null,error_code text,input_sha256 text,result_bytes integer,latency_ms integer);

create function private.agent_catalog_labels(scopes text[],revision text) returns text[] language sql immutable strict set search_path='' as $$
 select case when revision='2026-09-08.mcp-consent-catalog.v14' and count(*) filter(where label is null)=0 then array_agg(label order by ordinal) end from (
 select ordinal,case scope
 when 'ops.catalog.prepare' then 'Inspect source rows and prepare exact catalog changes for named operator approval in OPS'
 when 'ops.catalog_prices.write' then 'Prepare catalog price changes for exact approval in OPS; never change stock'
 when 'ops.catalog_costs.write' then 'Prepare catalog cost changes for exact approval in OPS'
 when 'ops.inventory.adjust' then 'Prepare separate stock count adjustments for exact approval in OPS; never record purchases'
 else (private.mcp_oauth_labels_for_scopes(array[scope],'2026-09-07.mcp-consent-catalog.v12'))[1] end label
 from unnest(scopes) with ordinality x(scope,ordinal)) labels
$$;
create function private.agent_site_visit_workflow_labels(scopes text[],revision text) returns text[]
language sql immutable strict set search_path='' as $$
 select case when revision='2026-09-10.mcp-consent-catalog.v17' and count(*) filter(where label is null)=0 then array_agg(label order by ordinal) end from (
 select ordinal,case scope
 when 'ops.site_visit_templates.read' then 'See reusable company site visit checklists and their fields'
 when 'ops.site_visit_templates.prepare' then 'Prepare reusable site visit checklist and default changes for exact approval in OPS'
 when 'ops.site_visits.prepare' then 'Prepare site visit bookings, reschedules, cancellations and field answers for exact approval in OPS'
 else (private.agent_catalog_labels(array[scope],'2026-09-08.mcp-consent-catalog.v14'))[1] end label
 from unnest(scopes) with ordinality x(scope,ordinal)) labels
$$;