-- Let the account-closure purge remove one tenant's immutable event ledgers
-- without weakening their append-only contract for any ordinary write.
--
-- Three tables on purge_company_rows' privilege allowlist also reject every
-- DELETE in a trigger. The helper now marks only its own transaction with the
-- exact company id immediately around the allowlisted DELETE. Each immutable
-- trigger accepts that marker only for DELETE, only when it matches OLD's
-- company, and only after purge_company_data has cleared request claims for
-- this internal maintenance transaction. UPDATE remains unconditionally
-- immutable. No trigger or foreign-key enforcement is disabled.

begin;

create or replace function public.purge_company_rows(
  p_table text,
  p_company_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_allowed constant text[] := array[
    'email_assignment_contact_form_draft_queue',
    'email_import_provider_operations',
    'email_outbound_edit_evidence',
    'email_outbound_edit_promotions',
    'email_outbound_learning_queue',
    'email_outbound_memory_evidence',
    'email_outbound_writing_samples',
    'email_provider_mutation_attempts',
    'opportunity_conversion_notification_deliveries',
    'phase_c_category_auto_send_acceptances',
    'project_status_lifecycle_outbox',
    'task_mutation_events',
    'task_schedule_automation_outbox',
    'unassigned_lead_assignment_deliveries',
    'user_permission_change_deliveries',
    'email_conversion_photo_jobs',
    'email_conversion_photo_objects',
    'email_ingestion_recovery_queue',
    'email_send_intents',
    'email_signature_notification_lifecycle_outbox',
    'email_signatures',
    'lead_intake_correction_runs',
    'opportunity_assignment_deliveries',
    'opportunity_assignment_events',
    'opportunity_assignment_suggestions',
    'opportunity_conversion_events',
    'opportunity_manual_outbound_cycle_receipts',
    'project_note_mention_events',
    'stage_transitions',
    'user_email_aliases'
  ];
  v_column_type text;
  v_deleted bigint;
  v_previous_purge_company_id text :=
    pg_catalog.current_setting('ops.company_data_purge_company_id', true);
begin
  if p_company_id is null then
    raise exception 'purge_company_rows: p_company_id is required'
      using errcode = '22004';
  end if;

  if not (p_table = any (v_allowed)) then
    raise exception 'purge_company_rows: % is not purgeable through this function', p_table
      using errcode = '42501';
  end if;

  select case
           when a.atttypid = 'uuid'::regtype then 'uuid'
           when a.atttypid in ('text'::regtype, 'varchar'::regtype) then 'text'
         end
    into v_column_type
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = p_table
     and a.attname = 'company_id'
     and a.attnum > 0
     and not a.attisdropped;

  if v_column_type is null then
    raise exception 'purge_company_rows: %.company_id is missing or unsupported', p_table
      using errcode = '42703';
  end if;

  begin
    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      p_company_id::text,
      true
    );

    execute pg_catalog.format(
      'delete from public.%I where company_id = $1::%s',
      p_table,
      v_column_type
    ) using p_company_id;

    get diagnostics v_deleted = row_count;

    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      coalesce(v_previous_purge_company_id, ''),
      true
    );
  exception when others then
    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      coalesce(v_previous_purge_company_id, ''),
      true
    );
    raise;
  end;

  return v_deleted;
end;
$$;

revoke all on function public.purge_company_rows(text, uuid) from public;
revoke all on function public.purge_company_rows(text, uuid) from anon;
revoke all on function public.purge_company_rows(text, uuid) from authenticated;
grant execute on function public.purge_company_rows(text, uuid) to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one of thirty allowlisted company-data tables. Marks only the exact internal account-closure DELETE so three immutable event triggers can preserve UPDATE protection while permitting tenant erasure.';

create or replace function private.reject_task_mutation_event_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE'
     and pg_catalog.current_setting(
       'ops.company_data_purge_company_id',
       true
     ) = old.company_id::text
     and coalesce(
       pg_catalog.current_setting('request.jwt.claims', true),
       ''
     ) = '' then
    return old;
  end if;

  raise exception 'task_mutation_events_are_immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.reject_task_mutation_event_change()
  from public, anon, authenticated, service_role;

create or replace function private.project_note_mention_events_are_immutable()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE'
     and pg_catalog.current_setting(
       'ops.company_data_purge_company_id',
       true
     ) = old.company_id::text
     and coalesce(
       pg_catalog.current_setting('request.jwt.claims', true),
       ''
     ) = '' then
    return old;
  end if;

  raise exception 'project note mention events are immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.project_note_mention_events_are_immutable()
  from public, anon, authenticated, service_role;

create or replace function private.guard_opportunity_conversion_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting(
         'ops.company_data_purge_company_id',
         true
       ) = old.company_id::text
       and coalesce(
         pg_catalog.current_setting('request.jwt.claims', true),
         ''
       ) = '' then
      return old;
    end if;

    raise exception 'conversion notification deliveries are immutable'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.conversion_event_id is distinct from old.conversion_event_id
     or new.company_id is distinct from old.company_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.project_id is distinct from old.project_id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.assignment_version is distinct from old.assignment_version
     or new.event_created_at is distinct from old.event_created_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'conversion notification deliveries are immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_opportunity_conversion_notification_delivery()
  from public, anon, authenticated, service_role;

commit;
