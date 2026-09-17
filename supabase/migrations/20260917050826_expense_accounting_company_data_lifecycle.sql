-- Account closure: expense accounting ledgers.
--
-- expense_accounting_events and expense_accounting_postings are append-only:
-- service_role holds SELECT and nothing else, so the manifest-driven closure
-- cannot delete them directly. Extend the exact-company closure helper rather
-- than widening their ordinary write surface.
--
-- expense_accounting_postings reference accounting_connections and
-- accounting_sync_queue without a delete action, so the closure plan erases
-- them before those parents.
--
-- expense_accounting_events are erased after expenses are tombstoned, because
-- tombstoning an approved expense appends reversal or review events. The same
-- call first runs any deferred allocation captures still queued in the
-- transaction (they would otherwise re-create private accounting state at
-- commit), then erases private.expense_accounting_state, which references the
-- ledger, then the ledger itself.
--
-- The five connection-bound expense accounting mapping and settings tables are
-- fully available to service_role and need no detour.

begin;

do $expense_accounting_closure_baseline$
declare
  v_helper_md5 text;
begin
  if current_user <> 'postgres' then
    raise exception 'Expense accounting closure requires the postgres migration owner';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) into v_helper_md5
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.purge_company_rows(text,uuid)')
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef;
  if v_helper_md5 is null
     or v_helper_md5 not in ('b549970fec8be3a60c85f3a5987cac72', 'f3e452f5b8139b2bd0df33b0aab27b17') then
    raise exception 'public.purge_company_rows changed after 2026-09-17; review this migration before applying';
  end if;

  if pg_catalog.to_regprocedure('public.purge_company_data(uuid,jsonb)') is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.purge_company_data(uuid,jsonb)'::regprocedure))
        <> 'e355caad23bdb8038b18d60146cb9274' then
    raise exception 'public.purge_company_data changed after 2026-09-17; review this migration before applying';
  end if;

  if exists (
    select 1
    from (values ('public.expense_accounting_events'), ('public.expense_accounting_postings')) as ledger(table_name)
    where pg_catalog.to_regclass(ledger.table_name) is null
       or not exists (
         select 1 from pg_catalog.pg_attribute a
         where a.attrelid = pg_catalog.to_regclass(ledger.table_name)
           and a.attname = 'company_id' and a.atttypid = 'uuid'::regtype
           and a.attnotnull and not a.attisdropped)
       or not pg_catalog.has_table_privilege('service_role', ledger.table_name, 'SELECT')
       or pg_catalog.has_table_privilege('service_role', ledger.table_name, 'DELETE')
  ) then
    raise exception 'Expense accounting ledgers changed after 2026-09-17; review this migration before applying';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('private.expense_accounting_state')
      and a.attname = 'company_id' and a.atttypid = 'uuid'::regtype
      and a.attnotnull and not a.attisdropped
  ) then
    raise exception 'private.expense_accounting_state changed after 2026-09-17; review this migration before applying';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint capture
    join pg_catalog.pg_trigger t on t.tgconstraint = capture.oid
    where capture.contype = 't'
      and capture.conname = 'zz_capture_expense_accounting_allocation'
      and capture.conrelid = pg_catalog.to_regclass('public.expense_project_allocations')
      and capture.condeferrable and capture.condeferred
      and t.tgfoid = pg_catalog.to_regprocedure('private.capture_expense_accounting_allocation()')
  ) then
    raise exception 'Deferred expense allocation capture changed after 2026-09-17; review this migration before applying';
  end if;
end;
$expense_accounting_closure_baseline$;

CREATE OR REPLACE FUNCTION public.purge_company_rows(p_table text, p_company_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    'approved_action_email_intents',
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
    'user_email_aliases',
    'agent_control_plane_tenant_roots',
    'job_memory_version_evidence',
    'job_memory_versions',
    'job_conversation_redaction_events',
    'job_conversation_turns',
    'job_conversation_anchors',
    'job_conversations',
    'supplier_bill_documents',
    'supplier_bill_events',
    'supplier_bill_intake_documents',
    'supplier_bill_intake_events',
    'expense_accounting_postings',
    'expense_accounting_events'
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
    raise exception
      'purge_company_rows: % is not purgeable through this function',
      p_table
      using errcode = '42501';
  end if;

  select case
           when attribute.atttypid = 'uuid'::regtype then 'uuid'
           when attribute.atttypid in (
             'text'::regtype,
             'varchar'::regtype
           ) then 'text'
         end
  into v_column_type
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation
    on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = p_table
    and attribute.attname = 'company_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_column_type is null then
    raise exception
      'purge_company_rows: %.company_id is missing or unsupported',
      p_table
      using errcode = '42703';
  end if;

  begin
    perform pg_catalog.set_config(
      'ops.company_data_purge_company_id',
      p_company_id::text,
      true
    );

    if p_table = 'supplier_bill_events' then
      delete from private.supplier_bill_write_intents
      where company_id = p_company_id;
    elsif p_table = 'supplier_bill_intake_events' then
      delete from private.supplier_bill_intake_write_intents
      where company_id = p_company_id;
    elsif p_table = 'expense_accounting_events' then
      -- Deleting expense allocations earlier in this closure queued deferred
      -- accounting captures. Run them now, while this ledger still exists, so
      -- none re-creates private state or a review event after the purge.
      if exists (
        select 1
        from pg_catalog.pg_constraint capture
        where capture.contype = 't'
          and capture.conname = 'zz_capture_expense_accounting_allocation'
          and capture.conrelid = pg_catalog.to_regclass('public.expense_project_allocations')
      ) then
        set constraints public.zz_capture_expense_accounting_allocation immediate;
      end if;

      delete from private.expense_accounting_state
      where company_id = p_company_id;
    end if;

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
$function$
;

revoke all on function public.purge_company_rows(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_company_rows(text, uuid)
  to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one of forty-four allowlisted company-data tables. Supplier-bill event calls also erase the matching private prepared-write intents in the same transaction. Expense accounting event calls first run deferred allocation captures, then erase the company''s private expense accounting state, in the same transaction.';

do $expense_accounting_closure_postcondition$
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef('public.purge_company_rows(text,uuid)'::regprocedure))
       <> 'f3e452f5b8139b2bd0df33b0aab27b17'
     or not pg_catalog.has_function_privilege('service_role', 'public.purge_company_rows(text,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.purge_company_rows(text,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.purge_company_rows(text,uuid)', 'EXECUTE') then
    raise exception 'Expense accounting closure helper did not install exactly';
  end if;
end;
$expense_accounting_closure_postcondition$;

commit;
