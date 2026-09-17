\set ON_ERROR_STOP on
-- Proves the closure harness template matches production on the account-closure
-- path, as read from project ijeekuhbatykdomumfjx on 2026-09-17 (read-only):
-- function definitions by md5(pg_get_functiondef), enabled trigger definitions,
-- foreign keys with their delete actions, service_role table privileges, and
-- the PostgREST identities. Run on the template BEFORE the migrations under
-- test. Any drift fails the harness instead of weakening the proof.

do $closure_fidelity$
declare
  v_mismatch text;
begin
  select expected.signature into v_mismatch
  from (values
    ('private.append_expense_accounting_event(p_expense expenses, p_kind text, p_snapshot jsonb, p_original_event_id uuid)', '011014f5ca4dfee6450d35f02245b571'),
    ('private.bump_agent_artifact_expense_allocation_revision()', '7c0c5e8739ebeba5f6648bc0554f2e64'),
    ('private.bump_agent_expense_source_revision()', 'f92b48861a589cfd079e400cf96f1114'),
    ('private.bump_agent_read_domain_revision()', '5a32a1da0b91d3e8e0b5c55a9ca3d52d'),
    ('private.cancel_unwritten_expense_reversals(p_event_id uuid)', '1f2fbabdf95961b6df12142a72f55f2a'),
    ('private.capture_expense_accounting_allocation()', '5ed749169f7f81aa10473d35fed068b9'),
    ('private.capture_expense_accounting_change()', 'b7e4f3f8a2a67258abe2eb4606999375'),
    ('private.capture_expense_accounting_state(p_expense expenses, p_prior_eligible boolean)', 'c0cf20daade53103529209e06711c37f'),
    ('private.current_user_is_admin()', '71fedd6dc3d8226af0b506dcfce72dd8'),
    ('private.derive_expense_reimbursement_amount()', '180660f4de5d22c7fd9cc6bde788fc78'),
    ('private.enforce_expense_accounting_authority()', '15919972aa7bced567a0ae3dfff5a807'),
    ('private.enforce_expense_accounting_related_authority()', '2385c486b3afbadff7144d40b7c670f5'),
    ('private.enforce_expense_edit_authority()', '1955996bf8bcff1b568ab1ea3776b47c'),
    ('private.enforce_expense_recurring_line_authority()', '770938427ea5240134ea97e82968dae6'),
    ('private.expense_correction_content(p_expense expenses)', '47b7ac2e436aedbd4d601bfc7f48688e'),
    ('private.expense_queue_cancelled_before_write(p_queue_id uuid)', '4aeb0c8dfb934efd11e73d052f37df8a'),
    ('private.get_current_user_id()', '127ffd06387933500d95f96aba24b605'),
    ('private.guard_financial_document_distribution()', '2055ba36169a4a4878fb404e6e32e6eb'),
    ('private.invalidate_expense_accounting_connection_binding()', '54e7e34822d35ac40c862891f6247934'),
    ('private.notify_expense_accounting_review()', '977b4ffddc8340b1a03baf56975893d6'),
    ('private.queue_expense_accounting_event(p_event_id uuid)', 'fef07cb071a5e2145ff60bd92101adaf'),
    ('private.refresh_expense_reimbursement_amount()', '4c5a847d6a59abf5507eeb5e64d0513d'),
    ('private.set_expense_updated_at()', '24546a8c51b36ec977e1624355fc6869'),
    ('private.touch_expense_from_allocation()', 'f4f2109685a5184bf9c1dcfe34d59b9f'),
    ('public.finalize_expense_accounting_sync(p_queue_id uuid, p_worker_id text, p_external_id text, p_sync_token text, p_provider_updated_at timestamp with time zone)', 'ebbf1a0df1ae4f8da46f51afc60dc7e9'),
    ('public.has_permission(p_user_id uuid, p_permission text, p_required_scope text)', '2a04ca2eb341948215285025249f48f9'),
    ('public.place_expense(p_expense_id uuid)', '5d3a1254421fc4378f9b9a32d4cc3bd5'),
    ('public.prepare_expense_accounting_write(p_queue_id uuid, p_worker_id text, p_payload jsonb, p_posting jsonb)', 'ec2bbe4be04db14f42fd148222a7b98b'),
    ('public.purge_company_data(p_company_id uuid, p_plan jsonb)', 'e355caad23bdb8038b18d60146cb9274'),
    ('public.purge_company_rows(p_table text, p_company_id uuid)', 'b549970fec8be3a60c85f3a5987cac72'),
    ('public.recalculate_expense_batch_total(p_batch_id uuid)', '8781e28a7a0485dc02b1d06eefcc8a22'),
    ('public.save_expense_accounting_settings(p_actor_user_id uuid, p_connection_id uuid, p_configuration jsonb, p_category_mappings jsonb, p_payee_mappings jsonb, p_tax_mappings jsonb, p_expected_provider text, p_expected_environment text, p_expected_identity text, p_project_mappings jsonb)', '5ad4953643e27a9dd96f798e8fba3128'),
    ('public.tg_place_expense()', '258dc02efee98372f6205e731ac0251f'),
    ('public.update_accounting_connections_updated_at()', '1d4ad6152c0d008751ec038ac408c9eb')
  ) as expected(signature, production_md5)
  left join lateral (
    select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = expected.signature
  ) live on true
  where live.oid is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(live.oid)) <> expected.production_md5
  limit 1;
  if v_mismatch is not null then
    raise exception 'closure fidelity: function differs from production: %', v_mismatch;
  end if;

  select coalesce(pg_catalog.string_agg(difference, E'\n'), '') into v_mismatch from (
    (select definition as difference from (values
      ('CREATE CONSTRAINT TRIGGER zz_capture_expense_accounting_allocation AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.capture_expense_accounting_allocation()'),
      ('CREATE TRIGGER accounting_connections_bump_agent_integrations_revision AFTER INSERT OR DELETE OR UPDATE OF company_id, provider, provider_environment, is_connected, sync_enabled, last_sync_at ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''integrations'', ''company_id'')'),
      ('CREATE TRIGGER accounting_sync_queue_private_drafts BEFORE INSERT OR UPDATE ON public.accounting_sync_queue FOR EACH ROW EXECUTE FUNCTION private.guard_financial_document_distribution()'),
      ('CREATE TRIGGER derive_expense_reimbursement_amount BEFORE INSERT OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.derive_expense_reimbursement_amount()'),
      ('CREATE TRIGGER enforce_expense_accounting_authority BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_authority()'),
      ('CREATE TRIGGER enforce_expense_accounting_delete_authority BEFORE DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_allocation_accounting_authority BEFORE INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_batch_payment_authority BEFORE INSERT OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_recurring_line_authority BEFORE INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_recurring_line_authority()'),
      ('CREATE TRIGGER expense_batches_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expense_batches_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_categories_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_project_allocations_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.bump_agent_artifact_expense_allocation_revision()'),
      ('CREATE TRIGGER expense_project_allocations_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_settings_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expense_settings FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expenses_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expenses_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''artifacts'', ''company_id'')'),
      ('CREATE TRIGGER expenses_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER invalidate_expense_accounting_connection_binding AFTER UPDATE OF company_id, provider, provider_environment, realm_id_lookup, sage_business_id_lookup ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION private.invalidate_expense_accounting_connection_binding()'),
      ('CREATE TRIGGER notify_expense_accounting_review AFTER INSERT OR UPDATE OF status ON public.accounting_sync_queue FOR EACH ROW EXECUTE FUNCTION private.notify_expense_accounting_review()'),
      ('CREATE TRIGGER set_accounting_connections_updated_at BEFORE UPDATE ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION update_accounting_connections_updated_at()'),
      ('CREATE TRIGGER trg_enforce_expense_edit_authority BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_edit_authority()'),
      ('CREATE TRIGGER trg_place_expense AFTER INSERT OR UPDATE OF status, expense_date, batch_id ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_place_expense()'),
      ('CREATE TRIGGER trg_set_expense_updated_at BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.set_expense_updated_at()'),
      ('CREATE TRIGGER trg_touch_expense_from_allocation AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.touch_expense_from_allocation()'),
      ('CREATE TRIGGER zz_capture_expense_accounting AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.capture_expense_accounting_change()'),
      ('CREATE TRIGGER zz_refresh_expense_reimbursement_amount AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.refresh_expense_reimbursement_amount()')
    ) as production(definition)
     except
     select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t
     where not t.tgisinternal and t.tgenabled = 'O'
       and t.tgrelid in ('public.expenses'::regclass, 'public.expense_project_allocations'::regclass,
         'public.expense_batches'::regclass, 'public.accounting_connections'::regclass,
         'public.accounting_sync_queue'::regclass, 'public.expense_categories'::regclass,
         'public.expense_settings'::regclass, 'public.expense_recurring_reimbursements'::regclass,
         'public.notifications'::regclass, 'public.accounting_sync_events'::regclass))
    union all
    (select 'unexpected: ' || pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t
     where not t.tgisinternal and t.tgenabled = 'O'
       and t.tgrelid in ('public.expenses'::regclass, 'public.expense_project_allocations'::regclass,
         'public.expense_batches'::regclass, 'public.accounting_connections'::regclass,
         'public.accounting_sync_queue'::regclass, 'public.expense_categories'::regclass,
         'public.expense_settings'::regclass, 'public.expense_recurring_reimbursements'::regclass,
         'public.notifications'::regclass, 'public.accounting_sync_events'::regclass)
       and pg_catalog.pg_get_triggerdef(t.oid) not in (select definition from (values
      ('CREATE CONSTRAINT TRIGGER zz_capture_expense_accounting_allocation AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.capture_expense_accounting_allocation()'),
      ('CREATE TRIGGER accounting_connections_bump_agent_integrations_revision AFTER INSERT OR DELETE OR UPDATE OF company_id, provider, provider_environment, is_connected, sync_enabled, last_sync_at ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''integrations'', ''company_id'')'),
      ('CREATE TRIGGER accounting_sync_queue_private_drafts BEFORE INSERT OR UPDATE ON public.accounting_sync_queue FOR EACH ROW EXECUTE FUNCTION private.guard_financial_document_distribution()'),
      ('CREATE TRIGGER derive_expense_reimbursement_amount BEFORE INSERT OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.derive_expense_reimbursement_amount()'),
      ('CREATE TRIGGER enforce_expense_accounting_authority BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_authority()'),
      ('CREATE TRIGGER enforce_expense_accounting_delete_authority BEFORE DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_allocation_accounting_authority BEFORE INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_batch_payment_authority BEFORE INSERT OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_accounting_related_authority()'),
      ('CREATE TRIGGER enforce_expense_recurring_line_authority BEFORE INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_recurring_line_authority()'),
      ('CREATE TRIGGER expense_batches_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expense_batches_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_batches FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_categories_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_project_allocations_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.bump_agent_artifact_expense_allocation_revision()'),
      ('CREATE TRIGGER expense_project_allocations_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER expense_settings_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expense_settings FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expenses_agent_payroll_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''payroll_readiness'', ''company_id'')'),
      ('CREATE TRIGGER expenses_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''artifacts'', ''company_id'')'),
      ('CREATE TRIGGER expenses_bump_agent_expense_revision AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.bump_agent_expense_source_revision()'),
      ('CREATE TRIGGER invalidate_expense_accounting_connection_binding AFTER UPDATE OF company_id, provider, provider_environment, realm_id_lookup, sage_business_id_lookup ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION private.invalidate_expense_accounting_connection_binding()'),
      ('CREATE TRIGGER notify_expense_accounting_review AFTER INSERT OR UPDATE OF status ON public.accounting_sync_queue FOR EACH ROW EXECUTE FUNCTION private.notify_expense_accounting_review()'),
      ('CREATE TRIGGER set_accounting_connections_updated_at BEFORE UPDATE ON public.accounting_connections FOR EACH ROW EXECUTE FUNCTION update_accounting_connections_updated_at()'),
      ('CREATE TRIGGER trg_enforce_expense_edit_authority BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.enforce_expense_edit_authority()'),
      ('CREATE TRIGGER trg_place_expense AFTER INSERT OR UPDATE OF status, expense_date, batch_id ON public.expenses FOR EACH ROW EXECUTE FUNCTION tg_place_expense()'),
      ('CREATE TRIGGER trg_set_expense_updated_at BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.set_expense_updated_at()'),
      ('CREATE TRIGGER trg_touch_expense_from_allocation AFTER INSERT OR DELETE OR UPDATE ON public.expense_project_allocations FOR EACH ROW EXECUTE FUNCTION private.touch_expense_from_allocation()'),
      ('CREATE TRIGGER zz_capture_expense_accounting AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.capture_expense_accounting_change()'),
      ('CREATE TRIGGER zz_refresh_expense_reimbursement_amount AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.refresh_expense_reimbursement_amount()')
       ) as production(definition)))
  ) differences;
  if v_mismatch <> '' then
    raise exception 'closure fidelity: triggers differ from production:%', E'\n' || v_mismatch;
  end if;

  select expected.table_name || '.' || expected.constraint_name into v_mismatch
  from (values
    ('accounting_sync_events', 'accounting_sync_events_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE SET NULL'),
    ('accounting_sync_events', 'accounting_sync_events_queue_id_fkey', 'FOREIGN KEY (queue_id) REFERENCES accounting_sync_queue(id) ON DELETE SET NULL'),
    ('accounting_sync_queue', 'accounting_sync_queue_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_accounting_category_mappings', 'expense_accounting_category_mappings_category_id_fkey', 'FOREIGN KEY (category_id) REFERENCES expense_categories(id)'),
    ('expense_accounting_category_mappings', 'expense_accounting_category_mappings_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_category_mappings', 'expense_accounting_category_mappings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_accounting_events', 'expense_accounting_events_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_events', 'expense_accounting_events_original_event_id_fkey', 'FOREIGN KEY (original_event_id) REFERENCES expense_accounting_events(id)'),
    ('expense_accounting_payee_mappings', 'expense_accounting_payee_mappings_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_payee_mappings', 'expense_accounting_payee_mappings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_accounting_payee_mappings', 'expense_accounting_payee_mappings_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES users(id)'),
    ('expense_accounting_postings', 'expense_accounting_postings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id)'),
    ('expense_accounting_postings', 'expense_accounting_postings_event_id_company_id_expense_id_fkey', 'FOREIGN KEY (event_id, company_id, expense_id) REFERENCES expense_accounting_events(id, company_id, expense_id)'),
    ('expense_accounting_postings', 'expense_accounting_postings_queue_id_fkey', 'FOREIGN KEY (queue_id) REFERENCES accounting_sync_queue(id)'),
    ('expense_accounting_project_mappings', 'expense_accounting_project_mappings_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_project_mappings', 'expense_accounting_project_mappings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_accounting_project_mappings', 'expense_accounting_project_mappings_project_id_fkey', 'FOREIGN KEY (project_id) REFERENCES projects(id)'),
    ('expense_accounting_settings', 'expense_accounting_settings_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_settings', 'expense_accounting_settings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_accounting_tax_mappings', 'expense_accounting_tax_mappings_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id)'),
    ('expense_accounting_tax_mappings', 'expense_accounting_tax_mappings_connection_id_fkey', 'FOREIGN KEY (connection_id) REFERENCES accounting_connections(id) ON DELETE CASCADE'),
    ('expense_batches', 'expense_batches_parent_batch_id_fkey', 'FOREIGN KEY (parent_batch_id) REFERENCES expense_batches(id)'),
    ('expense_project_allocations', 'expense_project_allocations_expense_id_fkey', 'FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE'),
    ('expense_recurring_reimbursements', 'expense_recurring_reimbursements_category_id_fkey', 'FOREIGN KEY (category_id) REFERENCES expense_categories(id)'),
    ('expenses', 'expenses_batch_id_fkey', 'FOREIGN KEY (batch_id) REFERENCES expense_batches(id)'),
    ('expenses', 'expenses_category_id_fkey', 'FOREIGN KEY (category_id) REFERENCES expense_categories(id)'),
    ('expenses', 'expenses_flagged_by_fkey', 'FOREIGN KEY (flagged_by) REFERENCES users(id)'),
    ('expenses', 'expenses_recurring_reimbursement_id_fkey', 'FOREIGN KEY (recurring_reimbursement_id) REFERENCES expense_recurring_reimbursements(id)'),
    ('notifications', 'notifications_resolved_by_fkey', 'FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL'),
    ('private.expense_accounting_state', 'expense_accounting_state_active_accrual_id_fkey', 'FOREIGN KEY (active_accrual_id) REFERENCES expense_accounting_events(id)'),
    ('private.expense_accounting_state', 'expense_accounting_state_active_payment_id_fkey', 'FOREIGN KEY (active_payment_id) REFERENCES expense_accounting_events(id)'),
    ('projects', 'projects_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'),
    ('tryops_health_notifications', 'tryops_health_notifications_notification_id_fkey', 'FOREIGN KEY (notification_id) REFERENCES notifications(id)'),
    ('users', 'users_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL')
  ) as expected(table_name, constraint_name, definition)
  where not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = pg_catalog.to_regclass(expected.table_name)
      and c.conname = expected.constraint_name
      and pg_catalog.pg_get_constraintdef(c.oid) = expected.definition)
  limit 1;
  if v_mismatch is not null then
    raise exception 'closure fidelity: foreign key differs from production: %', v_mismatch;
  end if;

  select expected.table_name into v_mismatch
  from (values
    ('accounting_connections', 'SIUD'),
    ('accounting_sync_events', 'SIUD'),
    ('accounting_sync_queue', 'SIUD'),
    ('companies', 'SIUD'),
    ('expense_batches', 'SIUD'),
    ('expense_categories', 'SIUD'),
    ('expense_project_allocations', 'SIUD'),
    ('expense_recurring_reimbursements', 'SIUD'),
    ('expense_settings', 'SIUD'),
    ('expenses', 'SIUD'),
    ('notifications', 'SIUD'),
    ('projects', 'SIUD'),
    ('tryops_health_notifications', 'SIUD'),
    ('users', 'SIUD'),
    ('expense_accounting_settings', 'SIUD'),
    ('expense_accounting_payee_mappings', 'SIUD'),
    ('expense_accounting_category_mappings', 'SIUD'),
    ('expense_accounting_project_mappings', 'SIUD'),
    ('expense_accounting_tax_mappings', 'SIUD'),
    ('expense_accounting_events', 'S---'),
    ('expense_accounting_postings', 'S---')
  ) as expected(table_name, privileges)
  where (case when pg_catalog.has_table_privilege('service_role', 'public.' || expected.table_name, 'SELECT') then 'S' else '-' end)
     || (case when pg_catalog.has_table_privilege('service_role', 'public.' || expected.table_name, 'INSERT') then 'I' else '-' end)
     || (case when pg_catalog.has_table_privilege('service_role', 'public.' || expected.table_name, 'UPDATE') then 'U' else '-' end)
     || (case when pg_catalog.has_table_privilege('service_role', 'public.' || expected.table_name, 'DELETE') then 'D' else '-' end)
     <> expected.privileges
  limit 1;
  if v_mismatch is not null then
    raise exception 'closure fidelity: service_role privileges differ from production on %', v_mismatch;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator' and rolcanlogin and not rolinherit and not rolsuper)
     or not pg_catalog.pg_has_role('authenticator', 'service_role', 'MEMBER')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls and not rolcanlogin) then
    raise exception 'closure fidelity: PostgREST identities differ from production';
  end if;
end;
$closure_fidelity$;

select '34 functions, 27 triggers, 34 foreign keys and 21 privilege sets match production' as result;
