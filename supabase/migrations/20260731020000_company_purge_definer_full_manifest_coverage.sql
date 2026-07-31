-- Extend public.purge_company_rows to every manifest table service_role cannot
-- purge — not only the fifteen that deny it outright.
--
-- The predecessor migration (20260731014758_company_purge_definer_for_owner_only_tables)
-- allowlisted the fifteen tables granted to `postgres` alone, because those are
-- the ones a live rehearsal hit first: the cascade cannot even COUNT them, so it
-- died at acting-step 23 of 198 with a 500.
--
-- Re-reading pg catalogs afterwards showed the allowlist was half the problem.
-- Fourteen further tables grant service_role SELECT and withhold DELETE. Those
-- steps count cleanly and are refused one call later, so fixing only the first
-- fifteen would have moved the failure, not removed it — the next deletion
-- attempt would have died at email_send_intents instead.
--
-- Twenty-nine tables total, matching DEFINER_PURGED_TABLES in
-- src/lib/data/company-data-manifest.ts. The set is asserted against the live
-- privilege snapshot, in both directions, by
-- tests/integration/company-data-manifest.test.ts.
--
-- Deliberately NOT a GRANT. DELETE on append-only event logs (stage_transitions,
-- opportunity_assignment_events, opportunity_conversion_events,
-- project_note_mention_events, task_mutation_events) would be handed to every
-- service-role code path in the product, permanently. This function lends a
-- far narrower privilege — delete one company's rows from one allowlisted
-- table — and every use of it is legible at the call site.

begin;

create or replace function public.purge_company_rows(
  p_table text,
  p_company_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
DECLARE
  -- Exactly the manifest tables service_role cannot purge directly.
  -- Nothing else is purgeable here.
  v_allowed constant text[] := ARRAY[
    -- No privileges at all: SELECT, UPDATE and DELETE all denied.
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
    -- Readable but not deletable: SELECT granted, DELETE withheld.
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
    'project_note_mention_events',
    'stage_transitions',
    'user_email_aliases'
  ];
  v_col_type text;
  v_deleted  bigint;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'purge_company_rows: p_company_id is required'
      USING ERRCODE = '22004';
  END IF;

  IF NOT (p_table = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'purge_company_rows: % is not purgeable through this function', p_table
      USING ERRCODE = '42501';
  END IF;

  SELECT c.data_type INTO v_col_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name  = p_table
     AND c.column_name = 'company_id';

  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'purge_company_rows: %.company_id not found', p_table
      USING ERRCODE = '42703';
  END IF;

  -- Cast the PARAMETER to the column's type; never cast the column (that would
  -- defeat the company_id index on these tables).
  EXECUTE format(
    'DELETE FROM public.%I WHERE company_id = $1::%s',
    p_table,
    CASE WHEN v_col_type = 'uuid' THEN 'uuid' ELSE 'text' END
  ) USING p_company_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Re-asserted rather than assumed: CREATE OR REPLACE keeps the existing ACL,
-- but this migration must leave the same posture whether or not the predecessor
-- ran — account deletion is the only caller.
revoke all on function public.purge_company_rows(text, uuid) from public;
revoke all on function public.purge_company_rows(text, uuid) from anon;
revoke all on function public.purge_company_rows(text, uuid) from authenticated;
grant execute on function public.purge_company_rows(text, uuid) to service_role;

comment on function public.purge_company_rows(text, uuid) is
  'Deletes one company''s rows from one allowlisted table. Exists because 29 tables in the company-data manifest are granted to postgres alone, so service_role cannot purge them during account deletion. Allowlist mirrors DEFINER_PURGED_TABLES in src/lib/data/company-data-manifest.ts.';

commit;
