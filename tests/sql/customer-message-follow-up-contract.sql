\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema if not exists private;
create schema if not exists auth;
create role anon;
create role authenticated;
create role service_role;

create function extensions.gen_random_uuid() returns uuid
language sql volatile as $$ select public.gen_random_uuid() $$;
create function extensions.digest(bytea,text) returns bytea
language sql immutable as $$ select public.digest($1,$2) $$;
create function auth.role() returns text language sql stable as $$ select 'service_role' $$;

create table public.companies(id uuid primary key, deleted_at timestamptz);
create table public.users(
  id uuid primary key,company_id uuid,is_active boolean,deleted_at timestamptz,
  first_name text,last_name text,email text
);
create table private.mcp_oauth_clients(
  client_id uuid primary key,disabled_at timestamptz,exposure_revision text,
  consent_catalog_revision text,scope_ceiling text[],scope text
);
create table private.mcp_oauth_grants(
  id uuid primary key,user_id uuid,company_id uuid,client_id uuid,revision text,
  scopes text[],revoked_at timestamptz,exposure_revision text,
  consent_catalog_revision text,accepted_labels text[]
);
create table public.roles(id uuid);
create table public.user_roles(id uuid);
create table public.role_permissions(id uuid);
create table public.user_permission_overrides(id uuid);
create table public.clients(
  id uuid primary key,company_id uuid,deleted_at timestamptz,
  merged_into_client_id uuid,name text
);
create table public.opportunities(
  id uuid primary key,company_id uuid,deleted_at timestamptz,
  merged_into_opportunity_id uuid,archived_at timestamptz,client_ref uuid,
  client_id uuid,title text,updated_at timestamptz,assignment_version bigint
);
create table public.activities(
  id uuid primary key,company_id uuid,opportunity_id uuid,client_id uuid,
  type text,direction text,email_connection_id uuid,email_message_id text,
  email_thread_id text,from_email text,match_needs_review boolean,
  has_attachments boolean,attachment_count integer,attachment_ids uuid[]
);
create table public.email_connections(
  id uuid primary key,company_id text,status text,type text,user_id text,email text,
  agent_can_send_from boolean
);
create table public.email_threads(
  id uuid primary key,company_id uuid,connection_id uuid,provider_thread_id text,
  opportunity_id uuid,client_id uuid
);
create table public.opportunity_email_threads(
  opportunity_id uuid,connection_id uuid,thread_id text
);
create table private.agent_provider_delivery_sources(
  id uuid primary key,company_id uuid,connection_id uuid,provider text,
  provider_message_id text,provider_thread_id text,direction text,
  delivered_at timestamptz,subject text,normalized_subject text,
  normalized_plain_text text,normalization_revision text,
  normalization_status text,sender_identity text,recipient_identities text[],
  cc_recipient_identities text[],content_media_type text,content_value text,
  content_charset text,content_source_kind text,content_selection_revision text,
  provider_part_id text,provider_body_attachment_id text,
  attachment_enumeration_complete boolean,attachment_descriptors jsonb,
  attachment_evidence_ids uuid[],source_sha256 text,captured_at timestamptz
);
create table public.agent_actions(
  id uuid primary key,company_id uuid,user_id uuid,action_type text,
  action_data jsonb,context_summary text,context_source text,source_id text,
  confidence double precision,priority text,status text,reviewed_by uuid,
  reviewed_at timestamptz,review_notes text,executed_at timestamptz,
  execution_result jsonb,error text,expires_at timestamptz,created_at timestamptz,
  updated_at timestamptz,auto_execute_at timestamptz
);
alter table public.agent_actions enable row level security;
create table public.notifications(
  id uuid default gen_random_uuid(),user_id text,company_id text,type text,
  title text,body text,is_read boolean,persistent boolean,action_url text,
  action_label text,dedupe_key text
);
create table public.approved_action_email_intents(
  id uuid primary key default gen_random_uuid(),action_id uuid,company_id uuid,
  actor_user_id uuid,execution_mode text,idempotency_key text,action_type text,
  action_data_snapshot jsonb,connection_id uuid,opportunity_id uuid,
  assignment_version bigint,assignment_event_id uuid,client_id uuid,
  project_id uuid,invoice_id uuid,source_activity_id uuid,
  source_email_thread_id uuid,reply_provider_thread_id text,in_reply_to text,
  to_emails text[],cc_emails text[],subject text,authored_body text,
  rendered_body text,content_type text,source_draft_history_id uuid,
  draft_history_id uuid,profile_type_snapshot text,learning_authority text,
  actor_name_snapshot text,actor_email_snapshot text,
  client_from_address_snapshot text,signature_id uuid,
  signature_content_hash text,rendered_body_hash text,status text,
  provider_message_id text,accepted_provider_thread_id text,
  provider_accepted_at timestamptz,reconciliation_attempts integer,
  reconciliation_lease_token uuid,reconciliation_lease_expires_at timestamptz,
  reconciled_activity_id uuid,reconciled_at timestamptz,last_error text,
  created_at timestamptz,updated_at timestamptz,max_reconciliation_attempts integer,
  reconciliation_exhausted_at timestamptz
);

create function private.lock_lead_assignment_company(uuid) returns void
language sql as $$ select $$;
create function public.has_permission(uuid,text,text) returns boolean
language sql stable as $$ select true $$;
create function private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)
returns boolean language sql stable as $$ select true $$;
create function private.agent_prompt_text_is_safe(text,boolean)
returns boolean language sql immutable as $$ select true $$;
create function private.user_can_send_opportunity_inbox(uuid,uuid,uuid)
returns boolean language sql stable as $$ select true $$;
create function private.get_current_user_id() returns uuid
language sql stable as $$ select null::uuid $$;
create function private.mcp_oauth_labels_for_scopes(text[],text)
returns text[] language sql immutable as $$ select $1 $$;
create function private.resolve_agent_actor_authority(uuid,uuid,text[])
returns table(permission_snapshot_revision text,effective_permissions jsonb)
language sql stable as $$
  select 'permission-revision',jsonb_build_array(
    jsonb_build_object('permission','agent.review','scope','all'),
    jsonb_build_object('permission','clients.view','scope','all'),
    jsonb_build_object('permission','inbox.send','scope','all'),
    jsonb_build_object('permission','inbox.view','scope','all'),
    jsonb_build_object('permission','pipeline.view','scope','all')
  )
$$;

create function private.approved_action_email_intent_is_authorized(uuid,boolean default true)
returns boolean language sql stable as $$ select true $$;
create function public.claim_approved_action_email_delivery(uuid)
returns public.approved_action_email_intents language sql as $$
  select null::public.approved_action_email_intents
$$;
create function public.prepare_approved_action_email_intent_pre_schedule_guard(
  p_action_id uuid,p_execution_mode text,p_signature_id uuid default null,
  p_signature_content_hash text default null,p_expected_authored_body_hash text default null,
  p_rendered_body text default null,p_rendered_body_hash text default null
) returns public.approved_action_email_intents language plpgsql as $$
declare v_action public.agent_actions%rowtype;
begin
  if v_action.action_type not in (
    'process_reschedule_request'
  ) then
    raise exception 'APPROVED_ACTION_EMAIL_ACTION_TYPE_INVALID';
  end if;
  return null;
end
$$;
create function public.prepare_approved_action_email_intent(
  p_action_id uuid,p_execution_mode text,p_signature_id uuid default null,
  p_signature_content_hash text default null,p_expected_authored_body_hash text default null,
  p_rendered_body text default null,p_rendered_body_hash text default null
) returns public.approved_action_email_intents language sql as $$
  select public.prepare_approved_action_email_intent_pre_schedule_guard(
    $1,$2,$3,$4,$5,$6,$7
  )
$$;

\ir ../../supabase/migrations/20260906050000_agent_customer_message_follow_up.sql

do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='agent_customer_message_source'
  ) then raise exception 'source function missing'; end if;
  select pg_get_functiondef(
    'public.prepare_approved_action_email_intent_pre_schedule_guard(uuid,text,uuid,text,text,text,text)'::regprocedure
  ) into v_definition;
  if position('send_customer_follow_up' in v_definition)=0 then
    raise exception 'transport allowlist was not extended';
  end if;
  if has_function_privilege('anon',
    'public.prepare_agent_customer_message_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,jsonb,timestamptz)',
    'execute') then raise exception 'anon can prepare customer messages'; end if;
  if not has_function_privilege('service_role',
    'public.prepare_agent_customer_message_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,jsonb,timestamptz)',
    'execute') then raise exception 'service role cannot prepare customer messages'; end if;
end
$$;

begin;
insert into public.companies values
  ('10000000-0000-4000-8000-000000000001',null);
insert into public.users values
  ('10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001',true,null,'Alex','Stone','alex@example.com');
insert into private.mcp_oauth_clients values (
  '10000000-0000-4000-8000-000000000003',null,
  '2026-09-06.mcp-exposure.v15','2026-09-06.mcp-consent-catalog.v10',
  array['ops.communications.prepare','ops.correspondence.read','ops.customers.read','ops.jobs.read'],
  'ops.communications.prepare ops.correspondence.read ops.customers.read ops.jobs.read'
);
insert into private.mcp_oauth_grants values (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','grant-revision',
  array['ops.communications.prepare','ops.correspondence.read','ops.customers.read','ops.jobs.read'],
  null,'2026-09-06.mcp-exposure.v15','2026-09-06.mcp-consent-catalog.v10',
  array['ops.communications.prepare','ops.correspondence.read','ops.customers.read','ops.jobs.read']
);
insert into public.clients values (
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',null,null,'Pat Customer'
);
insert into public.opportunities values (
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000001',null,null,null,
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000005','Patio expansion',
  '2026-09-06 17:00:00+00',7
);
insert into public.email_connections values (
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000001','active','individual',
  '10000000-0000-4000-8000-000000000002','alex@example.com',true
);
insert into public.email_threads values (
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000007','provider-thread-1',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000005'
);
insert into public.opportunity_email_threads values (
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007','provider-thread-1'
);
insert into public.activities values (
  '10000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000005','email','inbound',
  '10000000-0000-4000-8000-000000000007','provider-message-1',
  'provider-thread-1','pat@example.com',false,false,0,'{}'
);
insert into private.agent_provider_delivery_sources values (
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000007','gmail','provider-message-1',
  'provider-thread-1','inbound','2026-09-06 16:55:00+00','Patio expansion',
  'patio expansion','Tuesday morning works for us.','normalization-v1',
  'normalized','pat@example.com',array['alex@example.com'],'{}','text/plain',
  'Tuesday morning works for us.','UTF-8','provider_body','selection-v1',
  null,null,true,'[]','{}','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '2026-09-06 16:56:00+00'
);

do $$
declare
  v_request jsonb := jsonb_build_object(
    'opportunity_id','10000000-0000-4000-8000-000000000006',
    'expected_opportunity_updated_at','2026-09-06T17:00:00Z',
    'source_activity_id','10000000-0000-4000-8000-000000000009',
    'expected_source_sha256','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'subject','Re: Patio expansion',
    'body','Thanks for the update. Tuesday morning works.',
    'idempotency_key','message:test:0001'
  );
  v_first jsonb;
  v_replay jsonb;
  v_approval jsonb;
  v_action_id uuid;
  v_change_set_id uuid;
  v_intent_id uuid := '10000000-0000-4000-8000-000000000011';
  v_receipt jsonb;
begin
  v_first := public.prepare_agent_customer_message_as_system(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003','grant-revision',
    array['ops.communications.prepare','ops.correspondence.read','ops.customers.read','ops.jobs.read'],
    'permission-revision',
    array['agent.review','clients.view','inbox.send','inbox.view','pipeline.view'],
    '2026-09-06.capability-manifest.v21','2026-09-06.mcp-exposure.v15',
    'prepare_customer_message','prepare_customer_message:2026-09-06.v1',
    'request-1',v_request,clock_timestamp()
  );
  v_replay := public.prepare_agent_customer_message_as_system(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003','grant-revision',
    array['ops.communications.prepare','ops.correspondence.read','ops.customers.read','ops.jobs.read'],
    'permission-revision',
    array['agent.review','clients.view','inbox.send','inbox.view','pipeline.view'],
    '2026-09-06.capability-manifest.v21','2026-09-06.mcp-exposure.v15',
    'prepare_customer_message','prepare_customer_message:2026-09-06.v1',
    'request-2',v_request,clock_timestamp()
  );
  if v_first->>'action_id' is distinct from v_replay->>'action_id'
     or v_replay->>'replayed' <> 'true'
     or v_first#>>'{proposal,recipients,to,0}' <> 'pat@example.com'
     or v_first#>>'{proposal,sender,address}' <> 'alex@example.com'
     or jsonb_array_length(v_first#>'{proposal,recipients,cc}') <> 0
     or jsonb_array_length(v_first#>'{proposal,recipients,bcc}') <> 0
     or jsonb_array_length(v_first#>'{proposal,message,attachment_ids}') <> 0 then
    raise exception 'prepare or replay contract failed';
  end if;
  v_action_id := (v_first->>'action_id')::uuid;
  v_change_set_id := (v_first->>'change_set_id')::uuid;
  begin
    perform public.approve_agent_customer_message_as_actor(
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',v_action_id,v_change_set_id,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'approve-customer-message:wrong'
    );
    raise exception 'wrong seal was accepted';
  exception when unique_violation then null;
  end;
  v_approval := public.approve_agent_customer_message_as_actor(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',v_action_id,v_change_set_id,
    v_first->>'preview_sha256','approve-customer-message:test-1'
  );
  if v_approval->>'state' <> 'approved_queued'
     or v_approval->>'delivered_at' is not null then
    raise exception 'approval receipt overstated the send';
  end if;
  insert into public.approved_action_email_intents(
    id,action_id,company_id,actor_user_id,execution_mode,idempotency_key,
    action_type,action_data_snapshot,connection_id,opportunity_id,client_id,
    source_activity_id,source_email_thread_id,reply_provider_thread_id,in_reply_to,
    to_emails,cc_emails,subject,authored_body,status,provider_message_id,
    accepted_provider_thread_id,provider_accepted_at,reconciled_activity_id,reconciled_at
  ) select
    v_intent_id,action.id,action.company_id,action.reviewed_by,'manual','intent-key',
    action.action_type,action.action_data,
    (action.action_data->>'connection_id')::uuid,
    (action.action_data->>'opportunity_id')::uuid,
    (action.action_data->>'client_id')::uuid,
    (action.action_data->>'activity_id')::uuid,
    '10000000-0000-4000-8000-000000000008',
    action.action_data#>>'{proposal,thread,provider_thread_id}',
    action.action_data#>>'{proposal,thread,in_reply_to}',
    array[action.action_data->>'client_email'],'{}',
    action.action_data->>'subject',action.action_data->>'draft_text',
    'provider_accepted','sent-message-1','provider-thread-1',clock_timestamp(),
    null,null
  from public.agent_actions action where action.id=v_action_id;
  select execution_result into v_receipt from public.agent_actions where id=v_action_id;
  if v_receipt->>'state' <> 'provider_accepted'
     or v_receipt->>'delivered_at' is not null then
    raise exception 'provider acceptance was mislabeled';
  end if;
  update public.approved_action_email_intents
  set status='reconciled',reconciled_activity_id='10000000-0000-4000-8000-000000000009',
      reconciled_at=clock_timestamp()
  where id=v_intent_id;
  select execution_result into v_receipt from public.agent_actions where id=v_action_id;
  if v_receipt->>'state' <> 'reconciled_sent'
     or v_receipt->>'activity_id' is null
     or v_receipt->>'delivered_at' is not null then
    raise exception 'reconciled receipt failed';
  end if;
end
$$;

rollback;
