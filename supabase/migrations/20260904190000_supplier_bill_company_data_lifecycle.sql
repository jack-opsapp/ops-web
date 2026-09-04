begin;

-- Site visits retain the accepted appointment handoff as optional provenance.
-- Account closure hard-purges the handoff ledger before tombstoning visits, so
-- the reference must clear rather than block the company-data transaction.
alter table public.site_visits
  drop constraint site_visits_appointment_handoff_id_fkey;

alter table public.site_visits
  add constraint site_visits_appointment_handoff_id_fkey
  foreign key (appointment_handoff_id)
  references public.phase_c_bilateral_event_handoffs (id)
  on delete set null;

-- Supplier-bill document/event ledgers intentionally withhold DELETE from
-- service_role. Extend the exact-company account-closure helper instead of
-- widening their ordinary write surface. Private prepared-write intents are
-- erased with their corresponding public event ledger in the same transaction.
create or replace function public.purge_company_rows(
  p_table text,
  p_company_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
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
    'supplier_bill_intake_events'
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
$function$;

revoke all on function public.purge_company_rows(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_company_rows(text, uuid)
  to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one of forty-two allowlisted company-data tables. Supplier-bill event calls also erase the matching private prepared-write intents in the same transaction.';

commit;
