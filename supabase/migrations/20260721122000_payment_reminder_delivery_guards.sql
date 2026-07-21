-- Payment reminder generation and delivery guards.
--
-- Reminder drafting is a paid AI operation and the resulting email is a
-- customer-facing collection message. A short-lived claim prevents duplicate
-- draft spend. The final provider lease rechecks the current invoice so paid,
-- voided, written-off, rescheduled, or partially paid debt cannot receive stale
-- reminder copy.

create table if not exists public.payment_reminder_generation_claims (
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id text not null,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  primary key (company_id, source_id),
  check (source_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:reminder:[1-4]$'),
  check (expires_at > claimed_at)
);

alter table public.payment_reminder_generation_claims enable row level security;
alter table public.payment_reminder_generation_claims force row level security;
revoke all on table public.payment_reminder_generation_claims
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.payment_reminder_generation_claims to service_role;

create or replace function public.claim_payment_reminder_generation(
  p_company_id uuid,
  p_source_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
     or nullif(btrim(p_source_id), '') is null
     or p_source_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:reminder:[1-4]$' then
    raise exception using errcode = '22023', message = 'payment_reminder_claim_invalid';
  end if;

  delete from public.payment_reminder_generation_claims claim
   where claim.company_id = p_company_id
     and claim.source_id = p_source_id
     and claim.expires_at <= now();

  -- Recheck the durable source under the claim transaction. This closes the
  -- delayed-request window after an earlier generator inserts then releases.
  if exists (
    select 1
      from public.agent_actions action
     where action.company_id = p_company_id
       and action.action_type = 'send_payment_reminder'
       and action.source_id = p_source_id
       and (
         action.status in ('pending', 'approved', 'executed', 'rejected')
         or (
           action.status = 'failed'
           and exists (
             select 1
               from public.approved_action_email_intents intent
              where intent.action_id = action.id
                and intent.status in (
                  'sending',
                  'provider_accepted',
                  'reconciling',
                  'reconciliation_failed',
                  'reconciled',
                  'delivery_unknown'
                )
           )
         )
       )
  ) then
    return jsonb_build_object(
      'acquired', false,
      'claim_token', null,
      'reason', 'existing_action'
    );
  end if;

  insert into public.payment_reminder_generation_claims (
    company_id,
    source_id
  ) values (
    p_company_id,
    p_source_id
  )
  on conflict (company_id, source_id) do nothing
  returning claim_token into v_token;

  return jsonb_build_object(
    'acquired', v_token is not null,
    'claim_token', v_token,
    'reason', case when v_token is null then 'generation_in_progress' end
  );
end;
$function$;

create or replace function public.release_payment_reminder_generation(
  p_company_id uuid,
  p_source_id text,
  p_claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_deleted_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  delete from public.payment_reminder_generation_claims claim
   where claim.company_id = p_company_id
     and claim.source_id = p_source_id
     and claim.claim_token = p_claim_token;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$function$;

revoke all on function public.claim_payment_reminder_generation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.release_payment_reminder_generation(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_payment_reminder_generation(uuid, text)
  to service_role;
grant execute on function public.release_payment_reminder_generation(uuid, text, uuid)
  to service_role;

create unique index if not exists agent_actions_payment_reminder_active_unique
  on public.agent_actions (company_id, action_type, source_id)
  where action_type = 'send_payment_reminder'
    and source_id is not null
    and status in ('pending', 'approved');

create or replace function private.payment_reminder_email_intent_is_current(
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_invoice public.invoices%rowtype;
  v_company_timezone text;
  v_company_currency_code text;
  v_company_locale text;
  v_expected_locale text;
  v_company_client_comms_settings jsonb;
  v_payment_reminder_settings jsonb;
  v_company_today date;
  v_snapshot_balance numeric;
  v_snapshot_due_date date;
  v_snapshot_updated_at timestamptz;
  v_snapshot_days_overdue integer;
  v_recipient_is_current boolean;
begin
  select intent.* into v_intent
    from public.approved_action_email_intents intent
   where intent.id = p_intent_id;
  if not found then
    return false;
  end if;
  if v_intent.action_type <> 'send_payment_reminder' then
    return true;
  end if;
  if v_intent.invoice_id is null
     or v_intent.client_id is null
     or cardinality(v_intent.to_emails) <> 1 then
    return false;
  end if;

  -- The generic delivery guard proves actor/mailbox identity. Payment Review
  -- additionally requires the exact financial authority used when the draft
  -- was created, and that authority must still exist at the provider lease.
  if not private.permission_user_is_admin(
    v_intent.actor_user_id,
    v_intent.company_id
  ) and not (
    public.has_permission(v_intent.actor_user_id, 'projects.edit', 'all')
    and public.has_permission(v_intent.actor_user_id, 'invoices.view', 'all')
    and public.has_permission(v_intent.actor_user_id, 'invoices.send', 'all')
    and public.has_permission(v_intent.actor_user_id, 'finances.view', 'all')
  ) then
    return false;
  end if;
  if v_intent.project_id is not null and not private.user_can_edit_project(
      v_intent.actor_user_id,
      v_intent.project_id
    ) then
    return false;
  end if;

  select company.timezone,
         company.currency_code,
         company.locale,
         company.client_comms_settings
    into v_company_timezone,
         v_company_currency_code,
         v_company_locale,
         v_company_client_comms_settings
    from public.companies company
   where company.id = v_intent.company_id
     and company.deleted_at is null;
  if not found or nullif(btrim(v_company_timezone), '') is null then
    return false;
  end if;
  v_expected_locale := case when v_company_locale = 'es' then 'es' else 'en' end;

  -- A company can revoke this workflow after a draft has been queued. Manual
  -- approval must not bypass the same feature/settings gates used at creation.
  if not exists (
    select 1
      from public.admin_feature_overrides feature
     where feature.company_id = v_intent.company_id::text
       and feature.feature_key = 'phase_c'
       and feature.enabled
  ) then
    return false;
  end if;
  v_payment_reminder_settings := coalesce(
    v_company_client_comms_settings -> 'payment_reminder',
    '{}'::jsonb
  );
  if jsonb_typeof(v_payment_reminder_settings) is distinct from 'object' then
    return false;
  end if;
  if v_intent.action_data_snapshot -> 'payment_reminder_settings_snapshot'
       is distinct from v_payment_reminder_settings
     or nullif(btrim(v_intent.action_data_snapshot ->> 'company_timezone'), '')
       is distinct from btrim(v_company_timezone)
     or nullif(upper(btrim(v_intent.action_data_snapshot ->> 'currency_code')), '')
       is distinct from upper(btrim(v_company_currency_code))
     or nullif(btrim(v_intent.action_data_snapshot ->> 'company_locale'), '')
       is distinct from v_expected_locale
     or upper(btrim(v_company_currency_code)) !~ '^[A-Z]{3}$' then
    return false;
  end if;
  if v_payment_reminder_settings ? 'enabled' then
    if jsonb_typeof(v_payment_reminder_settings -> 'enabled')
         is distinct from 'boolean' then
      return false;
    end if;
    if (v_payment_reminder_settings ->> 'enabled')::boolean is not true then
      return false;
    end if;
  end if;
  begin
    v_company_today := (now() at time zone v_company_timezone)::date;
  exception when invalid_parameter_value then
    return false;
  end;

  select invoice.* into v_invoice
    from public.invoices invoice
   where invoice.id = v_intent.invoice_id
     and invoice.company_id = v_intent.company_id
     and invoice.deleted_at is null
   for share;
  if not found
     or v_invoice.status not in (
       'sent', 'awaiting_payment', 'partially_paid', 'past_due'
     )
     or coalesce(v_invoice.balance_due, 0) <= 0
     or v_invoice.due_date is null
     or v_invoice.due_date >= v_company_today
     or v_invoice.client_id is distinct from v_intent.client_id then
    return false;
  end if;

  begin
    v_snapshot_balance :=
      (v_intent.action_data_snapshot ->> 'balance_due')::numeric;
    v_snapshot_due_date :=
      (v_intent.action_data_snapshot ->> 'due_date')::date;
    v_snapshot_updated_at :=
      (v_intent.action_data_snapshot ->> 'invoice_updated_at')::timestamptz;
    v_snapshot_days_overdue :=
      (v_intent.action_data_snapshot ->> 'days_overdue')::integer;
  exception
    when invalid_text_representation
      or invalid_datetime_format
      or datetime_field_overflow
      or numeric_value_out_of_range then
    return false;
  end;

  if v_snapshot_balance is distinct from v_invoice.balance_due
     or v_snapshot_due_date is distinct from v_invoice.due_date
     or v_snapshot_updated_at is distinct from v_invoice.updated_at
     or v_snapshot_days_overdue is distinct from
       (v_company_today - v_invoice.due_date) then
    return false;
  end if;

  select exists (
    select 1
      from public.clients client
     where client.id = v_intent.client_id
       and client.company_id = v_intent.company_id
       and client.deleted_at is null
       and client.merged_into_client_id is null
       and lower(btrim(coalesce(client.email, '')))
         = lower(btrim(coalesce(v_intent.to_emails[1], '')))
  ) into v_recipient_is_current;
  return v_recipient_is_current;
end;
$function$;

revoke all on function private.payment_reminder_email_intent_is_current(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the latest task-automation currentness fence while adding the
-- payment-reminder fence at the same final boundary before provider I/O.
create or replace function public.claim_approved_action_email_delivery(
  p_intent_id uuid
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent public.approved_action_email_intents;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select intent.* into v_intent
    from public.approved_action_email_intents intent
   where intent.id = p_intent_id
   for update;
  if not found or v_intent.status <> 'prepared' then
    return null;
  end if;
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
  if not private.approved_action_email_intent_is_authorized(p_intent_id, true)
     or not private.task_automation_email_intent_is_current(p_intent_id)
     or not private.payment_reminder_email_intent_is_current(p_intent_id) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  update public.approved_action_email_intents intent
     set status = 'sending',
         last_error = null
   where intent.id = p_intent_id
  returning intent.* into v_intent;
  return v_intent;
end;
$function$;

revoke all on function public.claim_approved_action_email_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_approved_action_email_delivery(uuid)
  to service_role;
