begin;

-- Approval-queue email delivery has its own source-record authority. Browser
-- send payloads are never accepted: the immutable action, real reviewer (or
-- validated automation owner), mailbox, relationship context and final draft
-- are resolved again inside the database before a provider lease is granted.
create table public.approved_action_email_intents (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique
    references public.agent_actions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  execution_mode text not null check (execution_mode in ('manual', 'autonomous')),
  idempotency_key text not null unique,
  action_type text not null,
  action_data_snapshot jsonb not null,
  connection_id uuid not null references public.email_connections(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  assignment_version bigint,
  assignment_event_id uuid
    references public.opportunity_assignment_events(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  source_activity_id uuid references public.activities(id) on delete restrict,
  source_email_thread_id uuid references public.email_threads(id) on delete restrict,
  reply_provider_thread_id text,
  in_reply_to text,
  to_emails text[] not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  authored_body text not null,
  rendered_body text,
  content_type text not null default 'text' check (content_type in ('text', 'html')),
  source_draft_history_id uuid references public.ai_draft_history(id) on delete restrict,
  draft_history_id uuid references public.ai_draft_history(id) on delete restrict,
  profile_type_snapshot text not null default 'general',
  learning_authority text not null
    check (learning_authority in ('operator_approved', 'autonomous')),
  actor_name_snapshot text not null,
  actor_email_snapshot text not null,
  client_from_address_snapshot text not null,
  signature_id uuid references public.email_signatures(id) on delete restrict,
  signature_content_hash text,
  rendered_body_hash text,
  status text not null check (status in (
    'awaiting_signature',
    'prepared',
    'sending',
    'provider_accepted',
    'reconciling',
    'reconciliation_failed',
    'reconciled',
    'provider_rejected',
    'delivery_unknown'
  )),
  provider_message_id text,
  accepted_provider_thread_id text,
  provider_accepted_at timestamptz,
  reconciliation_attempts integer not null default 0,
  reconciliation_lease_token uuid,
  reconciliation_lease_expires_at timestamptz,
  reconciled_activity_id uuid references public.activities(id) on delete restrict,
  reconciled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approved_action_email_intents_actor_company_fkey
    foreign key (company_id, actor_user_id)
    references public.users(company_id, id)
    on delete restrict,
  check (idempotency_key ~ '^[0-9a-f]{64}$'),
  check (cardinality(to_emails) > 0),
  check (btrim(subject) <> '' and btrim(authored_body) <> ''),
  check (
    (
      opportunity_id is null
      and assignment_version is null
      and assignment_event_id is null
    )
    or (
      opportunity_id is not null
      and assignment_version is not null
    )
  ),
  check (
    status = 'awaiting_signature'
    or (
      signature_id is not null
      and signature_content_hash ~ '^[0-9a-f]{64}$'
      and rendered_body is not null
      and rendered_body_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  check (
    (
      execution_mode = 'manual'
      and learning_authority = 'operator_approved'
      and draft_history_id is not null
    )
    or (
      execution_mode = 'autonomous'
      and learning_authority = 'autonomous'
    )
  ),
  check (
    status not in (
      'provider_accepted',
      'reconciling',
      'reconciliation_failed',
      'reconciled'
    )
    or (
      provider_message_id is not null
      and accepted_provider_thread_id is not null
      and provider_accepted_at is not null
    )
  ),
  check (
    status <> 'reconciled'
    or (reconciled_activity_id is not null and reconciled_at is not null)
  )
);

create index approved_action_email_intents_recovery_idx
  on public.approved_action_email_intents(status, updated_at, id)
  where status in (
    'awaiting_signature',
    'prepared',
    'provider_accepted',
    'reconciling',
    'reconciliation_failed',
    'sending'
  );

alter table public.approved_action_email_intents enable row level security;
alter table public.approved_action_email_intents force row level security;
revoke all on table public.approved_action_email_intents from public;
revoke all on table public.approved_action_email_intents from anon, authenticated;
grant select, insert, update on table public.approved_action_email_intents to service_role;

create or replace function private.approved_action_email_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger approved_action_email_intents_touch_updated_at
before update on public.approved_action_email_intents
for each row execute function private.approved_action_email_touch_updated_at();

revoke all on function private.approved_action_email_touch_updated_at()
  from public, anon, authenticated, service_role;

create or replace function private.approved_action_email_autonomy_allowed(
  p_action_type text,
  p_settings jsonb
) returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_action_type
    when 'send_appointment_confirmation' then
      coalesce(p_settings -> 'appointment_confirmation' ->> 'level', '')
        in ('auto_send_on_confirm', 'full_auto')
    when 'send_appointment_reminder' then
      coalesce(p_settings -> 'appointment_reminder' ->> 'autonomy', '') = 'auto_send'
    when 'send_day_before_reminder' then
      coalesce(p_settings -> 'appointment_reminder' ->> 'autonomy', '') = 'auto_send'
    when 'send_schedule_changed' then
      coalesce(p_settings -> 'appointment_confirmation' ->> 'reschedule_behavior', '') = 'auto_send'
    when 'process_reschedule_request' then
      coalesce(p_settings -> 'reschedule_request' ->> 'autonomy', '') = 'auto_send'
    else false
  end;
$$;

revoke all on function private.approved_action_email_autonomy_allowed(text, jsonb)
  from public, anon, authenticated, service_role;

-- This helper is intentionally evaluated both after intent preparation and
-- again under the provider-delivery claim. Permission, assignment, mailbox,
-- signature or automation changes therefore fail closed at the last safe
-- boundary before external I/O.
create or replace function private.approved_action_email_intent_is_authorized(
  p_intent_id uuid,
  p_require_signature boolean default true
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_action public.agent_actions%rowtype;
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_company public.companies%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_signature public.email_signatures%rowtype;
  v_settings jsonb := '{}'::jsonb;
  v_latest_assignment_event_id uuid;
begin
  select * into v_intent
    from public.approved_action_email_intents
   where id = p_intent_id;
  if not found then return false; end if;

  select * into v_action
    from public.agent_actions
   where id = v_intent.action_id
     and company_id = v_intent.company_id;
  if not found
     or v_action.action_type is distinct from v_intent.action_type
     or v_action.action_data is distinct from v_intent.action_data_snapshot
     or v_action.status not in ('approved', 'executed') then
    return false;
  end if;

  if v_intent.execution_mode = 'manual' then
    if v_action.reviewed_by is null
       or v_action.reviewed_by is distinct from v_intent.actor_user_id then
      return false;
    end if;
  else
    if v_action.reviewed_by is not null
       or v_action.user_id is distinct from v_intent.actor_user_id
       or v_action.auto_execute_at is null
       or v_action.auto_execute_at > now() then
      return false;
    end if;
  end if;

  select * into v_actor
    from public.users
   where id = v_intent.actor_user_id
     and company_id = v_intent.company_id
     and deleted_at is null
     and coalesce(is_active, false);
  if not found then return false; end if;

  select * into v_connection
    from public.email_connections
   where id = v_intent.connection_id
     and company_id = v_intent.company_id::text
     and status = 'active';
  if not found then return false; end if;
  if v_connection.type::text = 'individual'
     and coalesce(v_connection.user_id, '') <> v_intent.actor_user_id::text then
    return false;
  end if;

  if p_require_signature then
    if v_intent.signature_id is null
       or v_intent.signature_content_hash is null
       or v_intent.rendered_body is null
       or v_intent.rendered_body_hash is null then
      return false;
    end if;
    select * into v_signature
      from public.email_signatures
     where id = v_intent.signature_id
       and company_id = v_intent.company_id
       and connection_id = v_intent.connection_id
       and active
       and content_hash = v_intent.signature_content_hash;
    if not found then return false; end if;

    if v_signature.source = 'ops'
       and v_signature.scope_user_id is not null
       and v_signature.scope_user_id <> v_intent.actor_user_id then
      return false;
    end if;

    -- OPS actor signature > mailbox OPS signature > provider signature.
    if exists (
      select 1 from public.email_signatures s
       where s.company_id = v_intent.company_id
         and s.connection_id = v_intent.connection_id
         and s.active and s.source = 'ops'
         and s.scope_user_id = v_intent.actor_user_id
         and s.id <> v_intent.signature_id
    ) then return false; end if;
    if v_signature.source <> 'ops' and exists (
      select 1 from public.email_signatures s
       where s.company_id = v_intent.company_id
         and s.connection_id = v_intent.connection_id
         and s.active and s.source = 'ops'
         and (s.scope_user_id = v_intent.actor_user_id or s.scope_user_id is null)
    ) then return false; end if;
    if v_signature.source <> 'ops'
       and lower(btrim(coalesce(v_signature.provider_identity, '')))
           <> lower(btrim(v_connection.email)) then
      return false;
    end if;
  end if;

  if v_intent.execution_mode = 'autonomous' then
    select c.*
      into v_company
      from public.companies c
     where c.id = v_intent.company_id
       and c.deleted_at is null;
    if not found
       or not private.email_company_subscription_active(
         v_company.subscription_status,
         v_company.subscription_plan,
         v_company.trial_end_date,
         now()
       ) then
      return false;
    end if;
    v_settings := coalesce(v_company.client_comms_settings, '{}'::jsonb);
    if not coalesce(v_connection.sync_enabled, false)
       or not coalesce(v_connection.agent_can_send_from, false)
       or coalesce(v_connection.auto_send_settings ->> 'enabled', 'false') <> 'true'
       or not private.approved_action_email_autonomy_allowed(
         v_intent.action_type,
         v_settings
       )
       or not exists (
         select 1 from public.admin_feature_overrides f
          where f.company_id = v_intent.company_id::text
            and f.feature_key = 'phase_c' and f.enabled
       )
       or not exists (
         select 1 from public.admin_feature_overrides f
          where f.company_id = v_intent.company_id::text
            and f.feature_key = 'ai_auto_send' and f.enabled
       )
       or not exists (
         select 1 from public.email_autonomy_milestones m
          where m.company_id = v_intent.company_id
            and m.connection_id = v_intent.connection_id
            and m.user_id = v_intent.actor_user_id
            and m.auto_send_suggested
       ) then
      return false;
    end if;
  end if;

  if v_intent.opportunity_id is not null then
    select * into v_opportunity
      from public.opportunities
     where id = v_intent.opportunity_id
       and company_id = v_intent.company_id
       and deleted_at is null
       and assignment_version = v_intent.assignment_version;
    if not found then
      return false;
    end if;
    if v_intent.execution_mode = 'autonomous'
       and v_opportunity.assigned_to is distinct from v_intent.actor_user_id then
      return false;
    end if;
    select event.id
      into v_latest_assignment_event_id
      from public.opportunity_assignment_events event
     where event.company_id = v_intent.company_id
       and event.opportunity_id = v_intent.opportunity_id
     order by event.assignment_version desc, event.id desc
     limit 1;
    if v_latest_assignment_event_id is distinct from v_intent.assignment_event_id then
      return false;
    end if;

    if not private.user_can_send_opportunity_inbox(
      v_intent.actor_user_id,
      v_intent.opportunity_id,
      v_intent.connection_id
    ) then return false; end if;
  else
    if not private.user_can_send_inbox_connection(
      v_intent.actor_user_id,
      v_intent.company_id,
      v_intent.connection_id,
      null
    ) then return false; end if;
  end if;

  if v_intent.source_email_thread_id is not null then
    if not exists (
      select 1 from public.email_threads t
       where t.id = v_intent.source_email_thread_id
         and t.company_id = v_intent.company_id
         and t.connection_id = v_intent.connection_id
         and t.provider_thread_id = v_intent.reply_provider_thread_id
         and t.opportunity_id is not distinct from v_intent.opportunity_id
    ) then return false; end if;
    if v_intent.opportunity_id is not null and not exists (
      select 1 from public.opportunity_email_threads l
       where l.opportunity_id = v_intent.opportunity_id
         and l.connection_id = v_intent.connection_id
         and l.thread_id = v_intent.reply_provider_thread_id
    ) then return false; end if;
  elsif v_intent.reply_provider_thread_id is not null
     or v_intent.in_reply_to is not null then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.approved_action_email_intent_is_authorized(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.prepare_approved_action_email_intent(
  p_action_id uuid,
  p_execution_mode text,
  p_signature_id uuid default null,
  p_signature_content_hash text default null,
  p_expected_authored_body_hash text default null,
  p_rendered_body text default null,
  p_rendered_body_hash text default null
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_action public.agent_actions%rowtype;
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_project public.projects%rowtype;
  v_invoice public.invoices%rowtype;
  v_activity public.activities%rowtype;
  v_thread public.email_threads%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_source_draft public.ai_draft_history%rowtype;
  v_existing public.approved_action_email_intents%rowtype;
  v_intent public.approved_action_email_intents%rowtype;
  v_now timestamptz := now();
  v_actor_user_id uuid;
  v_connection_id uuid;
  v_project_id uuid;
  v_invoice_project_id uuid;
  v_invoice_id uuid;
  v_client_id uuid;
  v_opportunity_id uuid;
  v_assignment_version bigint;
  v_source_assignment_version bigint;
  v_assignment_event_id uuid;
  v_source_activity_id uuid;
  v_source_thread_id uuid;
  v_provider_thread_id text;
  v_in_reply_to text;
  v_source_draft_id uuid;
  v_draft_history_id uuid;
  v_to_email text;
  v_subject text;
  v_body text;
  v_original_body text;
  v_profile_type text := 'general';
  v_status text;
  v_idempotency_key text;
  v_selected_alternative jsonb;
  v_selected_index integer;
  v_selected_team_member_id uuid;
  v_reschedule_task_id uuid;
begin
  if p_execution_mode not in ('manual', 'autonomous') then
    raise exception 'APPROVED_ACTION_EMAIL_EXECUTION_MODE_INVALID';
  end if;
  if (p_signature_id is null)
     <> (p_signature_content_hash is null)
     or (p_signature_id is null) <> (p_expected_authored_body_hash is null)
     or (p_signature_id is null) <> (p_rendered_body is null)
     or (p_signature_id is null) <> (p_rendered_body_hash is null) then
    raise exception 'APPROVED_ACTION_EMAIL_SIGNATURE_PAYLOAD_INVALID';
  end if;

  select * into v_action
    from public.agent_actions
   where id = p_action_id
   for update;
  if not found then raise exception 'APPROVED_ACTION_EMAIL_ACTION_NOT_FOUND'; end if;
  if v_action.action_type not in (
    'send_status_email',
    'send_invoice_email',
    'send_payment_reminder',
    'send_appointment_confirmation',
    'send_day_before_reminder',
    'send_appointment_reminder',
    'send_schedule_changed',
    'send_subcontractor_coordination',
    'process_reschedule_request'
  ) then raise exception 'APPROVED_ACTION_EMAIL_ACTION_TYPE_INVALID'; end if;

  select * into v_existing
    from public.approved_action_email_intents
   where action_id = p_action_id
   for update;
  if found and v_existing.execution_mode is distinct from p_execution_mode then
    raise exception 'APPROVED_ACTION_EMAIL_EXECUTION_MODE_CONFLICT';
  end if;
  if v_existing.id is not null
     and v_existing.status <> 'awaiting_signature' then
    return v_existing;
  end if;

  if p_execution_mode = 'manual' then
    if v_action.status <> 'approved' or v_action.reviewed_by is null then
      raise exception 'APPROVED_ACTION_EMAIL_MANUAL_REVIEW_REQUIRED';
    end if;
    v_actor_user_id := v_action.reviewed_by;
  else
    if v_action.reviewed_by is not null
       or v_action.user_id is null
       or v_action.auto_execute_at is null
       or v_action.auto_execute_at > v_now
       or (v_action.status = 'approved' and v_existing.id is null)
       or v_action.status not in ('pending', 'approved') then
      raise exception 'APPROVED_ACTION_EMAIL_AUTONOMY_INVALID';
    end if;
    v_actor_user_id := v_action.user_id;
  end if;

  select * into v_actor
    from public.users
   where id = v_actor_user_id
     and company_id = v_action.company_id
     and deleted_at is null
     and coalesce(is_active, false)
   for share;
  if not found then raise exception 'APPROVED_ACTION_EMAIL_ACTOR_INVALID'; end if;

  begin
    v_connection_id := nullif(v_action.action_data ->> 'connection_id', '')::uuid;
    v_project_id := nullif(v_action.action_data ->> 'project_id', '')::uuid;
    v_invoice_id := nullif(v_action.action_data ->> 'invoice_id', '')::uuid;
    v_client_id := nullif(v_action.action_data ->> 'client_id', '')::uuid;
    v_opportunity_id := nullif(v_action.action_data ->> 'opportunity_id', '')::uuid;
    v_source_activity_id := nullif(v_action.action_data ->> 'activity_id', '')::uuid;
    v_source_draft_id := nullif(v_action.action_data ->> 'draft_history_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'APPROVED_ACTION_EMAIL_SOURCE_ID_INVALID';
  end;

  v_to_email := case v_action.action_type
    when 'send_invoice_email' then v_action.action_data ->> 'to_email'
    when 'send_subcontractor_coordination' then v_action.action_data ->> 'subcontractor_email'
    else v_action.action_data ->> 'client_email'
  end;
  v_subject := nullif(btrim(v_action.action_data ->> 'subject'), '');
  v_body := nullif(btrim(case v_action.action_type
    when 'process_reschedule_request' then v_action.action_data ->> 'reply_draft_text'
    else v_action.action_data ->> 'draft_text'
  end), '');
  v_original_body := coalesce(
    nullif(btrim(case v_action.action_type
      when 'process_reschedule_request' then
        v_action.action_data ->> 'original_reply_draft_text'
      else v_action.action_data ->> 'original_draft_text'
    end), ''),
    v_body
  );
  v_profile_type := case v_action.action_type
    when 'send_payment_reminder' then 'client_followup'
    when 'send_subcontractor_coordination' then 'subtrade_coordination'
    else 'client_active_project'
  end;
  if v_connection_id is null or v_subject is null or v_body is null
     or nullif(btrim(coalesce(v_to_email, '')), '') is null
     or v_to_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'APPROVED_ACTION_EMAIL_PAYLOAD_INVALID';
  end if;

  if v_invoice_id is not null then
    select * into v_invoice from public.invoices
     where id = v_invoice_id and company_id = v_action.company_id
       and deleted_at is null for share;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_INVOICE_INVALID'; end if;
    v_invoice_project_id := coalesce(v_invoice.project_ref, v_invoice.project_id);
    if v_client_id is not null
       and v_invoice.client_id is distinct from v_client_id then
      raise exception 'APPROVED_ACTION_EMAIL_INVOICE_CLIENT_CONFLICT';
    end if;
    if v_project_id is not null and v_invoice_project_id is not null
       and v_invoice_project_id is distinct from v_project_id then
      raise exception 'APPROVED_ACTION_EMAIL_INVOICE_PROJECT_CONFLICT';
    end if;
    if v_opportunity_id is not null and v_invoice.opportunity_id is not null
       and v_invoice.opportunity_id is distinct from v_opportunity_id then
      raise exception 'APPROVED_ACTION_EMAIL_INVOICE_LEAD_CONFLICT';
    end if;
    v_client_id := v_invoice.client_id;
    v_project_id := coalesce(v_invoice_project_id, v_project_id);
    v_opportunity_id := coalesce(v_invoice.opportunity_id, v_opportunity_id);
  end if;

  if v_project_id is not null then
    select * into v_project from public.projects
     where id = v_project_id and company_id = v_action.company_id
       and deleted_at is null for share;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_PROJECT_INVALID'; end if;
    if v_project.client_id is not null and v_client_id is not null
       and v_project.client_id is distinct from v_client_id then
      raise exception 'APPROVED_ACTION_EMAIL_PROJECT_CLIENT_CONFLICT';
    end if;
    if v_project.opportunity_ref is not null and v_opportunity_id is not null
       and v_project.opportunity_ref is distinct from v_opportunity_id then
      raise exception 'APPROVED_ACTION_EMAIL_PROJECT_LEAD_CONFLICT';
    end if;
    v_client_id := coalesce(v_project.client_id, v_client_id);
    v_opportunity_id := coalesce(v_project.opportunity_ref, v_opportunity_id);
    if v_opportunity_id is null then
      select o.id into v_opportunity_id
        from public.opportunities o
       where o.company_id = v_action.company_id and o.deleted_at is null
         and (o.project_ref = v_project_id or o.project_id = v_project_id)
       order by o.created_at desc, o.id desc limit 1;
    end if;
  end if;

  if v_source_activity_id is not null then
    select * into v_activity from public.activities
     where id = v_source_activity_id and company_id = v_action.company_id
       and type = 'email' for share;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_ACTIVITY_INVALID'; end if;
    if v_activity.email_connection_id is not null then
      v_connection_id := v_activity.email_connection_id;
    end if;
    v_provider_thread_id := nullif(btrim(v_activity.email_thread_id), '');
    v_in_reply_to := nullif(btrim(v_activity.email_message_id), '');
    if v_activity.opportunity_id is not null
       and v_opportunity_id is not null
       and v_activity.opportunity_id is distinct from v_opportunity_id then
      raise exception 'APPROVED_ACTION_EMAIL_ACTIVITY_LEAD_CONFLICT';
    end if;
    if v_activity.client_id is not null
       and v_client_id is not null
       and v_activity.client_id is distinct from v_client_id then
      raise exception 'APPROVED_ACTION_EMAIL_ACTIVITY_CLIENT_CONFLICT';
    end if;
    v_opportunity_id := coalesce(v_activity.opportunity_id, v_opportunity_id);
    v_client_id := coalesce(v_activity.client_id, v_client_id);
  elsif v_action.action_type = 'process_reschedule_request' then
    raise exception 'APPROVED_ACTION_EMAIL_ACTIVITY_REQUIRED';
  end if;

  select * into v_connection from public.email_connections
   where id = v_connection_id
     and company_id = v_action.company_id::text
     and status = 'active' for share;
  if not found then raise exception 'APPROVED_ACTION_EMAIL_CONNECTION_INVALID'; end if;
  if v_connection.type::text = 'individual'
     and coalesce(v_connection.user_id, '') <> v_actor_user_id::text then
    raise exception 'APPROVED_ACTION_EMAIL_PERSONAL_MAILBOX_FORBIDDEN';
  end if;

  if v_provider_thread_id is not null then
    select * into v_thread from public.email_threads
     where company_id = v_action.company_id
       and connection_id = v_connection_id
       and provider_thread_id = v_provider_thread_id
     for share;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_THREAD_INVALID'; end if;
    v_source_thread_id := v_thread.id;
    if v_thread.opportunity_id is not null and v_opportunity_id is not null
       and v_thread.opportunity_id is distinct from v_opportunity_id then
      raise exception 'APPROVED_ACTION_EMAIL_THREAD_LEAD_CONFLICT';
    end if;
    if v_thread.client_id is not null and v_client_id is not null
       and v_thread.client_id is distinct from v_client_id then
      raise exception 'APPROVED_ACTION_EMAIL_THREAD_CLIENT_CONFLICT';
    end if;
    v_opportunity_id := coalesce(v_thread.opportunity_id, v_opportunity_id);
    v_client_id := coalesce(v_thread.client_id, v_client_id);
  end if;

  if v_opportunity_id is not null then
    select * into v_opportunity from public.opportunities
     where id = v_opportunity_id and company_id = v_action.company_id
       and deleted_at is null for update;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_OPPORTUNITY_INVALID'; end if;
    v_assignment_version := v_opportunity.assignment_version;
    select event.id into v_assignment_event_id
      from public.opportunity_assignment_events event
     where event.company_id = v_action.company_id
       and event.opportunity_id = v_opportunity_id
     order by event.assignment_version desc, event.id desc
     limit 1;
    if v_opportunity.client_id is not null and v_client_id is not null
       and v_opportunity.client_id is distinct from v_client_id then
      raise exception 'APPROVED_ACTION_EMAIL_OPPORTUNITY_CLIENT_CONFLICT';
    end if;
    v_client_id := coalesce(v_opportunity.client_id, v_client_id);
    if v_source_thread_id is not null and not exists (
      select 1 from public.opportunity_email_threads l
       where l.opportunity_id = v_opportunity_id
         and l.connection_id = v_connection_id
         and l.thread_id = v_provider_thread_id
    ) then raise exception 'APPROVED_ACTION_EMAIL_THREAD_LEAD_LINK_INVALID'; end if;
  end if;

  if v_client_id is not null and not exists (
    select 1 from public.clients c
     where c.id = v_client_id and c.company_id = v_action.company_id
  ) then raise exception 'APPROVED_ACTION_EMAIL_CLIENT_INVALID'; end if;

  if v_action.action_type = 'process_reschedule_request' then
    if v_project_id is null
       or jsonb_typeof(v_action.action_data -> 'suggested_alternatives') <> 'array'
       or jsonb_array_length(v_action.action_data -> 'suggested_alternatives') = 0 then
      raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_INVALID';
    end if;
    begin
      v_source_assignment_version := nullif(
        v_action.action_data ->> 'source_assignment_version',
        ''
      )::bigint;
      v_selected_index := coalesce(
        (v_action.action_data ->> 'selected_alternative_index')::integer,
        0
      );
      if v_selected_index < 0
         or v_selected_index >= jsonb_array_length(
           v_action.action_data -> 'suggested_alternatives'
         ) then
        raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_INVALID';
      end if;
      v_selected_alternative :=
        (v_action.action_data -> 'suggested_alternatives') -> v_selected_index;
      if nullif(v_selected_alternative ->> 'date', '') is null
         or nullif(v_action.action_data ->> 'original_start_date', '') is null then
        raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_INVALID';
      end if;
      perform (v_selected_alternative ->> 'date')::timestamptz;
      perform (v_action.action_data ->> 'original_start_date')::timestamptz;
      if nullif(v_action.action_data ->> 'original_end_date', '') is not null then
        perform (v_action.action_data ->> 'original_end_date')::timestamptz;
      end if;
      v_selected_team_member_id := nullif(
        v_selected_alternative ->> 'team_member_id',
        ''
      )::uuid;
      v_reschedule_task_id := nullif(
        v_action.action_data ->> 'affected_task_id',
        ''
      )::uuid;
    exception
      when others then
        raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_INVALID';
    end;
    if v_source_assignment_version is null
       or v_source_assignment_version < 0
       or v_source_assignment_version is distinct from v_opportunity.assignment_version then
      raise exception 'APPROVED_ACTION_EMAIL_ASSIGNMENT_SNAPSHOT_STALE';
    end if;
    if v_reschedule_task_id is null then
      raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_TASK_INVALID';
    end if;
    if not exists (
      select 1 from public.project_tasks task
       where task.id = v_reschedule_task_id
         and task.company_id = v_action.company_id
         and task.project_id = v_project_id
         and task.deleted_at is null
    ) then
      raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_TASK_INVALID';
    end if;
    if v_selected_team_member_id is not null and not exists (
      select 1 from public.users member
       where member.id = v_selected_team_member_id
         and member.company_id = v_action.company_id
         and member.deleted_at is null
         and coalesce(member.is_active, false)
    ) then
      raise exception 'APPROVED_ACTION_EMAIL_RESCHEDULE_MEMBER_INVALID';
    end if;
  end if;

  if v_source_draft_id is not null then
    select * into v_source_draft from public.ai_draft_history
     where id = v_source_draft_id
       and company_id = v_action.company_id
       and (connection_id is null or connection_id = v_connection_id)
       and (opportunity_id is null or opportunity_id = v_opportunity_id)
       and status in ('drafted', 'auto_drafted')
     for update;
    if not found then raise exception 'APPROVED_ACTION_EMAIL_DRAFT_INVALID'; end if;
    v_profile_type := coalesce(nullif(btrim(v_source_draft.profile_type), ''), v_profile_type);
    if p_execution_mode = 'manual' then
      update public.ai_draft_history
         set user_id = v_actor_user_id
       where id = v_source_draft_id;
    elsif v_source_draft.user_id is distinct from v_actor_user_id then
      raise exception 'APPROVED_ACTION_EMAIL_AUTONOMOUS_DRAFT_ACTOR_INVALID';
    end if;
    v_draft_history_id := v_source_draft_id;
  elsif p_execution_mode = 'manual' then
    insert into public.ai_draft_history (
      company_id, user_id, opportunity_id, connection_id, thread_id,
      original_draft, subject, subject_source, profile_type, status, origin
    ) values (
      v_action.company_id, v_actor_user_id, v_opportunity_id, v_connection_id,
      v_provider_thread_id, v_original_body, v_subject, 'configured', v_profile_type,
      'drafted', 'system_handoff'
    ) returning id into v_draft_history_id;
  end if;

  v_status := case when p_signature_id is null
    then 'awaiting_signature' else 'prepared' end;
  if p_signature_id is not null then
    if p_signature_content_hash !~ '^[0-9a-f]{64}$'
       or p_expected_authored_body_hash !~ '^[0-9a-f]{64}$'
       or p_rendered_body_hash !~ '^[0-9a-f]{64}$'
       or encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex')
          is distinct from p_expected_authored_body_hash
       or encode(extensions.digest(convert_to(p_rendered_body, 'UTF8'), 'sha256'), 'hex')
          is distinct from p_rendered_body_hash then
      raise exception 'APPROVED_ACTION_EMAIL_RENDERED_BODY_INVALID';
    end if;
  end if;

  v_idempotency_key := encode(
    extensions.digest(convert_to('approved-action-email:v1:' || p_action_id::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_existing.id is null then
    insert into public.approved_action_email_intents (
      action_id, company_id, actor_user_id, execution_mode, idempotency_key,
      action_type, action_data_snapshot, connection_id, opportunity_id,
      assignment_version, assignment_event_id,
      client_id, project_id, invoice_id,
      source_activity_id, source_email_thread_id, reply_provider_thread_id,
      in_reply_to, to_emails, cc_emails, subject, authored_body, rendered_body,
      content_type, source_draft_history_id, draft_history_id,
      profile_type_snapshot, learning_authority, actor_name_snapshot,
      actor_email_snapshot, client_from_address_snapshot, signature_id,
      signature_content_hash, rendered_body_hash, status, last_error
    ) values (
      p_action_id, v_action.company_id, v_actor_user_id, p_execution_mode,
      v_idempotency_key, v_action.action_type, v_action.action_data,
      v_connection_id, v_opportunity_id,
      v_assignment_version, v_assignment_event_id,
      v_client_id, v_project_id, v_invoice_id,
      v_source_activity_id, v_source_thread_id, v_provider_thread_id,
      v_in_reply_to, array[lower(btrim(v_to_email))], '{}'::text[], v_subject,
      v_body, p_rendered_body, 'text', v_source_draft_id, v_draft_history_id,
      v_profile_type,
      case when p_execution_mode = 'manual' then 'operator_approved' else 'autonomous' end,
      btrim(concat_ws(' ', v_actor.first_name, v_actor.last_name)),
      coalesce(v_actor.email, ''), lower(btrim(v_connection.email)),
      p_signature_id, p_signature_content_hash, p_rendered_body_hash, v_status,
      case when v_status = 'awaiting_signature' then 'EMAIL_SIGNATURE_REQUIRED' end
    ) returning * into v_intent;
  elsif v_existing.status = 'awaiting_signature' and p_signature_id is not null then
    update public.approved_action_email_intents
       set signature_id = p_signature_id,
           signature_content_hash = p_signature_content_hash,
           rendered_body = p_rendered_body,
           rendered_body_hash = p_rendered_body_hash,
           status = 'prepared',
           last_error = null
     where id = v_existing.id
     returning * into v_intent;
  else
    v_intent := v_existing;
  end if;

  if p_execution_mode = 'autonomous' and v_action.status = 'pending' then
    update public.agent_actions
       set status = 'approved', reviewed_by = null, reviewed_at = null,
           error = case when v_status = 'awaiting_signature'
             then 'EMAIL_SIGNATURE_REQUIRED' else null end
     where id = p_action_id;
  elsif v_status = 'awaiting_signature' then
    update public.agent_actions set error = 'EMAIL_SIGNATURE_REQUIRED'
     where id = p_action_id;
  else
    update public.agent_actions set error = null where id = p_action_id;
  end if;

  if not private.approved_action_email_intent_is_authorized(
    v_intent.id,
    v_intent.status <> 'awaiting_signature'
  ) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  return v_intent;
end;
$$;

revoke all on function public.prepare_approved_action_email_intent(
  uuid, text, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.prepare_approved_action_email_intent(
  uuid, text, uuid, text, text, text, text
) to service_role;

create or replace function public.claim_approved_action_email_delivery(
  p_intent_id uuid
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  select * into v_intent from public.approved_action_email_intents
   where id = p_intent_id for update;
  if not found or v_intent.status <> 'prepared' then return null; end if;
  if v_intent.opportunity_id is not null then
    perform 1
      from public.opportunities opportunity
     where opportunity.id = v_intent.opportunity_id
       and opportunity.company_id = v_intent.company_id
       and opportunity.deleted_at is null
     for share;
    if not found then
      raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
    end if;
  end if;
  if not private.approved_action_email_intent_is_authorized(p_intent_id, true) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  update public.approved_action_email_intents
     set status = 'sending', last_error = null
   where id = p_intent_id returning * into v_intent;
  return v_intent;
end;
$$;

create or replace function public.mark_approved_action_email_provider_accepted(
  p_intent_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_accepted_at timestamptz
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  if nullif(btrim(p_provider_message_id), '') is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    raise exception 'APPROVED_ACTION_EMAIL_PROVIDER_IDS_REQUIRED';
  end if;
  select * into v_intent from public.approved_action_email_intents
   where id = p_intent_id for update;
  if not found then raise exception 'APPROVED_ACTION_EMAIL_INTENT_NOT_FOUND'; end if;
  if v_intent.status in ('provider_accepted','reconciling','reconciliation_failed','reconciled') then
    if v_intent.provider_message_id is distinct from p_provider_message_id
       or v_intent.accepted_provider_thread_id is distinct from p_provider_thread_id then
      raise exception 'APPROVED_ACTION_EMAIL_PROVIDER_ID_CONFLICT';
    end if;
    return v_intent;
  end if;
  if v_intent.status <> 'sending' then
    raise exception 'APPROVED_ACTION_EMAIL_ACCEPTANCE_STATE_INVALID';
  end if;
  update public.approved_action_email_intents set
    status = 'provider_accepted',
    provider_message_id = btrim(p_provider_message_id),
    accepted_provider_thread_id = btrim(p_provider_thread_id),
    provider_accepted_at = coalesce(p_accepted_at, now()),
    last_error = null
  where id = p_intent_id returning * into v_intent;
  return v_intent;
end;
$$;

create or replace function public.mark_approved_action_email_provider_rejected(
  p_intent_id uuid,
  p_error text
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents set
    status = 'provider_rejected', last_error = left(coalesce(p_error, ''), 2000)
  where id = p_intent_id and status = 'sending' returning * into v_intent;
  if v_intent.id is null then raise exception 'APPROVED_ACTION_EMAIL_REJECTION_STATE_INVALID'; end if;
  update public.agent_actions set status = 'failed', error = v_intent.last_error
   where id = v_intent.action_id and status = 'approved';
  return v_intent;
end;
$$;

create or replace function public.mark_approved_action_email_delivery_unknown(
  p_intent_id uuid,
  p_error text,
  p_provider_message_id text default null,
  p_provider_thread_id text default null
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents set
    status = 'delivery_unknown',
    provider_message_id = coalesce(provider_message_id, nullif(btrim(p_provider_message_id), '')),
    accepted_provider_thread_id = coalesce(accepted_provider_thread_id, nullif(btrim(p_provider_thread_id), '')),
    last_error = left(coalesce(p_error, ''), 2000)
  where id = p_intent_id and status in ('sending','delivery_unknown')
  returning * into v_intent;
  if v_intent.id is null then raise exception 'APPROVED_ACTION_EMAIL_UNKNOWN_STATE_INVALID'; end if;
  update public.agent_actions set status = 'failed', error = v_intent.last_error
   where id = v_intent.action_id and status = 'approved';
  return v_intent;
end;
$$;

create or replace function public.claim_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_seconds integer default 300
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  select * into v_intent from public.approved_action_email_intents
   where id = p_intent_id for update;
  if not found or (
    v_intent.status not in ('provider_accepted','reconciliation_failed')
    and not (v_intent.status = 'reconciling' and v_intent.reconciliation_lease_expires_at <= now())
  ) then return null; end if;
  update public.approved_action_email_intents set
    status = 'reconciling', reconciliation_attempts = reconciliation_attempts + 1,
    reconciliation_lease_token = gen_random_uuid(),
    reconciliation_lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
    last_error = null
  where id = p_intent_id returning * into v_intent;
  return v_intent;
end;
$$;

create or replace function public.complete_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_activity_id uuid
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents set
    status = 'reconciled', reconciled_activity_id = p_activity_id,
    reconciled_at = now(), reconciliation_lease_token = null,
    reconciliation_lease_expires_at = null, last_error = null
  where id = p_intent_id and status = 'reconciling'
    and reconciliation_lease_token = p_lease_token
  returning * into v_intent;
  if v_intent.id is null then raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID'; end if;
  update public.agent_actions set
    status = 'executed', executed_at = now(), error = null,
    execution_result = jsonb_build_object(
      'intentId', v_intent.id,
      'messageId', v_intent.provider_message_id,
      'threadId', v_intent.accepted_provider_thread_id,
      'activityId', p_activity_id,
      'actorUserId', v_intent.actor_user_id,
      'connectionId', v_intent.connection_id
    )
  where id = v_intent.action_id and status = 'approved';
  return v_intent;
end;
$$;

create or replace function public.fail_approved_action_email_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_error text
) returns public.approved_action_email_intents
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_intent public.approved_action_email_intents%rowtype;
begin
  update public.approved_action_email_intents set
    status = 'reconciliation_failed',
    reconciliation_lease_token = null, reconciliation_lease_expires_at = null,
    last_error = left(coalesce(p_error, ''), 2000)
  where id = p_intent_id and status = 'reconciling'
    and reconciliation_lease_token = p_lease_token
  returning * into v_intent;
  if v_intent.id is null then raise exception 'APPROVED_ACTION_EMAIL_RECONCILIATION_LEASE_INVALID'; end if;
  update public.agent_actions set error = v_intent.last_error
   where id = v_intent.action_id and status = 'approved';
  return v_intent;
end;
$$;

create or replace function public.quarantine_stale_approved_action_email_deliveries(
  p_stale_before timestamptz default now() - interval '15 minutes'
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_count integer;
begin
  with quarantined as (
    update public.approved_action_email_intents set
      status = 'delivery_unknown',
      last_error = 'APPROVED_ACTION_EMAIL_STALE_DELIVERY_UNKNOWN'
    where status = 'sending' and updated_at <= p_stale_before
    returning action_id
  ), failed_actions as (
    update public.agent_actions a set status = 'failed',
      error = 'APPROVED_ACTION_EMAIL_STALE_DELIVERY_UNKNOWN'
    from quarantined q where a.id = q.action_id and a.status = 'approved'
    returning a.id
  ) select count(*) into v_count from quarantined;
  return v_count;
end;
$$;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.claim_approved_action_email_delivery(uuid)'::regprocedure,
    'public.mark_approved_action_email_provider_accepted(uuid,text,text,timestamptz)'::regprocedure,
    'public.mark_approved_action_email_provider_rejected(uuid,text)'::regprocedure,
    'public.mark_approved_action_email_delivery_unknown(uuid,text,text,text)'::regprocedure,
    'public.claim_approved_action_email_reconciliation(uuid,integer)'::regprocedure,
    'public.complete_approved_action_email_reconciliation(uuid,uuid,uuid)'::regprocedure,
    'public.fail_approved_action_email_reconciliation(uuid,uuid,text)'::regprocedure,
    'public.quarantine_stale_approved_action_email_deliveries(timestamptz)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;

commit;
