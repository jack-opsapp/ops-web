\set ON_ERROR_STOP on
-- Proves the permission-override harness template matches production's save
-- path, as read from project ijeekuhbatykdomumfjx (read-only) by
-- scripts/capture-permission-overrides-fixture.py: every function by
-- md5(pg_get_functiondef), the save at its pre-repair definition; every
-- trigger that can fire during a save, and no other; the save's grants; the
-- PostgREST identities; the collation the save's canonical-order checks sort
-- by; and the reference data. Run on the template BEFORE the migration under
-- test. Any drift fails the harness instead of weakening the proof.

do $permission_overrides_fidelity$
declare
  v_mismatch text;
begin
  select expected.signature into v_mismatch
  from (values
    ('auth.jwt()', '20054548ba2003f61a6bcb472175700b'),
    ('auth.role()', '8a3e05459e07e0633d43c6fba2a2cdf4'),
    ('private.advance_agent_operational_read_revision(p_company_id uuid)', '098136525b1ea2ff29cba471cdd7c2e4'),
    ('private.advance_agent_read_domain_revisions(p_company_ids uuid[], p_domain text)', '6a0365b0a7d424995fd3c1dad6f9f276'),
    ('private.agent_discovery_opportunity_source_is_invalid(p_client_ref uuid, p_client_id uuid, p_project_ref uuid, p_project_id uuid, p_title text, p_address text, p_stage text, p_created_at timestamp with time zone, p_updated_at timestamp with time zone, p_archived_at timestamp with time zone)', '644c8cbbe10e373699a76379eff08cda'),
    ('private.agent_discovery_project_source_is_invalid(p_opportunity_id text, p_opportunity_ref uuid, p_title text, p_address text, p_status text, p_created_at timestamp with time zone, p_updated_at timestamp with time zone, p_start_date timestamp with time zone, p_end_date timestamp with time zone)', '8c90f67cda71dc0af28da900e35836c9'),
    ('private.agent_discovery_unicode15_text_is_supported(p_value text)', '5a55d5e7c9ddb6792127b2a1a3c64552'),
    ('private.agent_normalize_discovery_email(p_value text)', '742e86207064c47a59d96dc3d96a6349'),
    ('private.agent_normalize_discovery_phone(p_value text)', '8e55a47792259c45bde9d45f46a6ce89'),
    ('private.agent_normalize_discovery_text(p_value text)', 'd757723f5e5346b55ea7899a94e564a7'),
    ('private.agent_p2_optional_canonical_text(p_value text, p_maximum_scalars integer, p_maximum_utf8_bytes integer, p_allow_text_whitespace boolean)', 'bbafcaf0a714e29b5ef926dfd07ebb95'),
    ('private.agent_prompt_text_is_safe(p_value text, p_allow_text_whitespace boolean)', 'a320748e065e05bbce046fe053d24860'),
    ('private.agent_read_domain_uuid_from_text(p_value text)', '4440abc3fe983d58e66c6b7d32fb4a58'),
    ('private.agent_trim_discovery_display_text(p_value text)', 'b56a73b121eb92fc39816fbf7bf8d3a8'),
    ('private.agent_uuid_from_legacy_text(p_value text)', '180f52e73bc0d603d1ef1573dcdbee16'),
    ('private.assert_canonical_override_payload(p_payload jsonb, p_require_registered boolean)', 'd3e420bbde6e8579894ac8735f92af97'),
    ('private.assert_direct_permission_user(p_user_id uuid)', '0beeef735cefc0823a718d0afcbce5d8'),
    ('private.assert_permission_users_valid(p_user_ids uuid[])', '43ab57c126f43dda0f5d430ac20598e8'),
    ('private.bump_agent_operational_read_revision()', '13068da4ffa66d2836c8aa92832c0e8a'),
    ('private.bump_agent_read_domain_revision()', '5a32a1da0b91d3e8e0b5c55a9ca3d52d'),
    ('private.bump_agent_site_visit_workflow_revision()', 'b07428ea21f8964db0df9161fa565171'),
    ('private.bump_agent_work_queue_source_revision()', 'bbc3028fd435b8f734a8ea4c83dbe060'),
    ('private.canonical_user_override_snapshot(p_user_id uuid)', 'c36c4a8250157c0d77eaf09fd004c7e9'),
    ('private.canonicalize_address_text(p_address text)', 'f700967f856963374263b3091a7d0c07'),
    ('private.change_assignment_system_company_serialized_internal(p_opportunity_id uuid, p_expected_assignment_version bigint, p_expected_assigned_to uuid, p_new_assigned_to uuid, p_system_source text, p_actor_user_id uuid, p_suggestion_id uuid, p_metadata jsonb)', 'fa504f0bb96f46b81ff6184b6e585d33'),
    ('private.change_opportunity_assignment_core(p_opportunity_id uuid, p_expected_assignment_version bigint, p_expected_assigned_to uuid, p_new_assigned_to uuid, p_source text, p_actor_user_id uuid, p_actor_company_id uuid, p_is_system boolean, p_suggestion_id uuid, p_metadata jsonb)', '45f02c7614cb399b9780226396289af6'),
    ('private.current_user_scope_for(p_permission text)', '2ac60f997a0ac6de618bef5ff7aa5592'),
    ('private.effective_inbox_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', 'ef4b6edfb77decd265c5602957f26f5a'),
    ('private.effective_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', '71379de17663ca1354d7f18f8a2e61cb'),
    ('private.effective_pipeline_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', 'b34bb5069f71ddd8d1501416907f399a'),
    ('private.email_assignment_contact_form_draft_canonical_recipient(p_company_id uuid, p_opportunity_id uuid, p_source_activity_id uuid, p_connection_id uuid, p_provider_message_id text, p_provider_thread_id text)', 'b0d101a0e6e6c8e2568798338c825a58'),
    ('private.email_assignment_contact_form_draft_has_reply(p_company_id uuid, p_opportunity_id uuid, p_connection_id uuid, p_source_occurred_at timestamp with time zone, p_customer_email text)', 'c36d8de2966cfcd84974bca1ba6891e5'),
    ('private.email_contact_form_source_markers_present(p_subject text, p_body text)', '89c0ba8bcefb9b4f762309710681695a'),
    ('private.enforce_permission_assignment_resolutions(p_actor_user_id uuid, p_company_id uuid, p_affected_user_ids uuid[], p_assignment_resolutions jsonb, p_mutation_kind text, p_subject_id uuid)', 'e0107d116b5aabbed2c577ccc0399f8c'),
    ('private.enqueue_email_assignment_contact_form_draft(p_assignment_event_id uuid, p_source_activity_id uuid)', '05ee63a1eec10b18dd67115d53d0eeb7'),
    ('private.enqueue_user_override_change()', '36170bcf980cce183deb5c1899b58bac'),
    ('private.enqueue_user_permission_change(p_user_id uuid, p_company_id uuid, p_change_kind text)', 'a1fe383944f63b026b86c7927c43c57c'),
    ('private.get_current_user_id()', '127ffd06387933500d95f96aba24b605'),
    ('private.get_user_company_id()', '3de642ffe4b81ee8827c1cc6507f85c4'),
    ('private.guard_opportunity_assignment_mutation()', '88b4cd53412dbd9d34bab8ba02fe4526'),
    ('private.guard_user_overrides_final_state()', '8c375002811aa32870f5244ea89efcff'),
    ('private.is_canonical_internal_permission_override(p_permission text, p_company_id uuid, p_scope text, p_granted boolean)', '56a687c466cfd3fb9ded35b8387bae87'),
    ('private.least_permissive_pipeline_scope(p_left_scope text, p_right_scope text)', '884db1b21e6903c916436df7befbfa16'),
    ('private.lock_lead_assignment_company(p_company_id uuid)', '66a84a1311ffb22c79458cafbcca76bf'),
    ('private.normalize_address(p text)', '064c23779001fb85a0d08a408a2d785d'),
    ('private.normalize_property_address(p_address text, p_include_unit boolean)', 'ef1f73d414c5c840005071c88965c3ed'),
    ('private.notify_email_assignment_contact_form_draft_reconciliation()', 'bb7f10a774a413afe76ad7347dd89aa3'),
    ('private.permission_scope_rank(p_scope text)', '69e9a119a41bfd0acf668ed11f26507f'),
    ('private.permission_try_parse_uuid(p_value text)', 'f3ff92b3a19af25824b7fdc8ce2eec35'),
    ('private.permission_user_is_admin(p_user_id uuid, p_company_id uuid)', 'ca0496eddd2b4a00940885430c1760da'),
    ('private.pipeline_dependency_issues(p_create_scope text, p_view_scope text, p_edit_scope text, p_assign_scope text, p_convert_scope text)', 'cbb1e63ff68115ca50d95e4b4827ec92'),
    ('private.pipeline_dependency_issues_for_user(p_user_id uuid, p_company_id uuid)', 'fe0ce66163b7237b0e93cce16a6d4a1e'),
    ('private.preserve_exact_recovery_opportunity_updated_at()', 'a87373073852e6c5bf4db605fb910ca9'),
    ('private.queue_email_assignment_contact_form_draft_from_assignment()', '007ae5f6265405d77d23bb5ad7660f5c'),
    ('private.raw_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', '95f8357783737b3e9f6d73dd42dfa96a'),
    ('private.raw_pipeline_scope_for_user(p_user_id uuid, p_company_id uuid, p_permission text)', '47dfd7661439f5f5d0da5eb0664eda1c'),
    ('private.resolve_email_assignment_contact_form_draft_mailbox_wait_notifi()', 'f86e54870e46c94135a6bc198bfcf68d'),
    ('private.resolve_unassigned_lead_assignment_deliveries()', '2149b71f848857ffd2d0c7441203d0dd'),
    ('private.rotate_site_visit_stage_revision()', '0665bd93c8e41b9d27243563c7cf349c'),
    ('private.should_use_inbox_view_company_compat(p_actor_user_id uuid, p_actor_company_id uuid)', '16b6ba8438b64efffd6fb333dd2caedb'),
    ('private.should_use_pipeline_manage_compat(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)', 'c43b343bce323f9082f6d75d64bd32b9'),
    ('private.stranded_permission_assignments(p_company_id uuid, p_user_ids uuid[])', '927d9bba89152cdfe980f22d8f2d8a77'),
    ('private.suppress_email_recovery_provider_draft_queue()', 'b40ad662876f27f85dbd129e308ad6ff'),
    ('private.try_parse_uuid(p_value text)', '7f387218fe0eed3c0d379f19db96b25f'),
    ('private.user_assignment_snapshot(p_user_id uuid)', '3a864219c22ee91ade6d9d8da68fcb79'),
    ('private.user_is_company_admin(p_actor_user_id uuid, p_actor_company_id uuid)', 'fdd51485e950e4540c5777845e98c6a1'),
    ('private.user_is_guarded_assignment_target_eligible(p_user_id uuid, p_company_id uuid)', '8162029d53b62cc709f0a18b5661db6f'),
    ('public.apply_user_permission_overrides_as_system(p_actor_user_id uuid, p_target_user_id uuid, p_expected_overrides jsonb, p_set jsonb, p_clear text[], p_assignment_resolutions jsonb)', '74ca941e37b9813a30db902b52c91e13'),
    ('public.change_opportunity_assignment_as_system(p_opportunity_id uuid, p_expected_assignment_version bigint, p_expected_assigned_to uuid, p_new_assigned_to uuid, p_system_source text, p_actor_user_id uuid, p_suggestion_id uuid, p_metadata jsonb)', 'a7f8f39e8d834e8a0f86fbed3ee2a94e'),
    ('public.enqueue_email_signature_notification_lifecycle(p_actor_user_id uuid, p_connection_id uuid, p_reason text)', '032502820015c28034a3ec22f42f73b1'),
    ('public.enqueue_email_signature_notification_lifecycle_for_company(p_actor_user_id uuid, p_connection_id uuid, p_company_id uuid, p_reason text)', '17570bcd053bfe0a979e96a478f0c1f2'),
    ('public.has_permission(p_user_id uuid, p_permission text, p_required_scope text)', '2a04ca2eb341948215285025249f48f9'),
    ('public.queue_email_signature_assignment_reconciliation()', '348ac4552b8e3d9c8489b4866f1fbf6a'),
    ('public.queue_email_signature_notification_history_for_actor(p_actor_user_id uuid, p_reason text)', '4c7eb26f8320d1c5aa52c154a2e85565'),
    ('public.queue_email_signature_user_permission_reconciliation()', 'aafabdc442f5fdd6a22d521f1124c23c'),
    ('public.update_timestamp()', '93ab639fada1299eae91e1456a216b6d')
  ) as expected(signature, production_md5)
  left join lateral (
    select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = expected.signature
  ) live on true
  where live.oid is null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(live.oid)) <> expected.production_md5
  limit 1;
  if v_mismatch is not null then
    raise exception 'permission override fidelity: function differs from production: %', v_mismatch;
  end if;

  if (select count(*)
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private', 'auth')
         and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')) <> 76 then
    raise exception 'permission override fidelity: the template defines functions production''s save path does not reach';
  end if;

  select coalesce(pg_catalog.string_agg(difference, E'\n'), '') into v_mismatch from (
    (select definition as difference from (values
      ('CREATE TRIGGER email_assignment_contact_form_draft_mailbox_wait_notification_r AFTER UPDATE OF status, mailbox_busy_since ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.resolve_email_assignment_contact_form_draft_mailbox_wait_notifi()'),
      ('CREATE TRIGGER email_assignment_contact_form_draft_reconciliation_notification AFTER UPDATE OF status ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.notify_email_assignment_contact_form_draft_reconciliation()'),
      ('CREATE TRIGGER suppress_email_recovery_provider_draft_queue BEFORE INSERT ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.suppress_email_recovery_provider_draft_queue()'),
      ('CREATE TRIGGER bump_site_visit_workflow_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_site_visit_workflow_revision()'),
      ('CREATE TRIGGER opportunities_agent_sales_truth_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''sales_truth'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''artifacts'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_operational_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_operational_read_revision()'),
      ('CREATE TRIGGER opportunities_bump_agent_site_visit_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''site_visits'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_work_queue_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_work_queue_source_revision()'),
      ('CREATE TRIGGER site_visit_stage_revision AFTER INSERT OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.rotate_site_visit_stage_revision()'),
      ('CREATE TRIGGER trg_opp_timestamp BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION update_timestamp()'),
      ('CREATE TRIGGER trg_opportunities_guard_assignment_mutation BEFORE INSERT OR UPDATE OF assigned_to, assignment_version ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.guard_opportunity_assignment_mutation()'),
      ('CREATE TRIGGER zz_exact_recovery_preserve_opportunity_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.preserve_exact_recovery_opportunity_updated_at()'),
      ('CREATE TRIGGER opportunity_assignment_contact_form_draft_queue AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION private.queue_email_assignment_contact_form_draft_from_assignment()'),
      ('CREATE TRIGGER opportunity_assignment_events_resolve_unassigned_prompts AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION private.resolve_unassigned_lead_assignment_deliveries()'),
      ('CREATE TRIGGER opportunity_assignment_signature_notification_queue AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION queue_email_signature_assignment_reconciliation()'),
      ('CREATE TRIGGER email_signature_user_permission_notification_queue AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides FOR EACH ROW EXECUTE FUNCTION queue_email_signature_user_permission_reconciliation()'),
      ('CREATE TRIGGER trg_enqueue_user_override_change AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides FOR EACH ROW EXECUTE FUNCTION private.enqueue_user_override_change()'),
      ('CREATE CONSTRAINT TRIGGER trg_user_permission_overrides_final_state AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.guard_user_overrides_final_state()')
    ) as production(definition)
    except
    select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t where not t.tgisinternal)
    union all
    (select pg_catalog.pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t where not t.tgisinternal
    except
    select definition from (values
      ('CREATE TRIGGER email_assignment_contact_form_draft_mailbox_wait_notification_r AFTER UPDATE OF status, mailbox_busy_since ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.resolve_email_assignment_contact_form_draft_mailbox_wait_notifi()'),
      ('CREATE TRIGGER email_assignment_contact_form_draft_reconciliation_notification AFTER UPDATE OF status ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.notify_email_assignment_contact_form_draft_reconciliation()'),
      ('CREATE TRIGGER suppress_email_recovery_provider_draft_queue BEFORE INSERT ON public.email_assignment_contact_form_draft_queue FOR EACH ROW EXECUTE FUNCTION private.suppress_email_recovery_provider_draft_queue()'),
      ('CREATE TRIGGER bump_site_visit_workflow_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_site_visit_workflow_revision()'),
      ('CREATE TRIGGER opportunities_agent_sales_truth_source_revision_v1 AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''sales_truth'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_artifact_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''artifacts'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_operational_read_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_operational_read_revision()'),
      ('CREATE TRIGGER opportunities_bump_agent_site_visit_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision(''site_visits'', ''company_id'')'),
      ('CREATE TRIGGER opportunities_bump_agent_work_queue_revision AFTER INSERT OR DELETE OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.bump_agent_work_queue_source_revision()'),
      ('CREATE TRIGGER site_visit_stage_revision AFTER INSERT OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.rotate_site_visit_stage_revision()'),
      ('CREATE TRIGGER trg_opp_timestamp BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION update_timestamp()'),
      ('CREATE TRIGGER trg_opportunities_guard_assignment_mutation BEFORE INSERT OR UPDATE OF assigned_to, assignment_version ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.guard_opportunity_assignment_mutation()'),
      ('CREATE TRIGGER zz_exact_recovery_preserve_opportunity_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.preserve_exact_recovery_opportunity_updated_at()'),
      ('CREATE TRIGGER opportunity_assignment_contact_form_draft_queue AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION private.queue_email_assignment_contact_form_draft_from_assignment()'),
      ('CREATE TRIGGER opportunity_assignment_events_resolve_unassigned_prompts AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION private.resolve_unassigned_lead_assignment_deliveries()'),
      ('CREATE TRIGGER opportunity_assignment_signature_notification_queue AFTER INSERT ON public.opportunity_assignment_events FOR EACH ROW EXECUTE FUNCTION queue_email_signature_assignment_reconciliation()'),
      ('CREATE TRIGGER email_signature_user_permission_notification_queue AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides FOR EACH ROW EXECUTE FUNCTION queue_email_signature_user_permission_reconciliation()'),
      ('CREATE TRIGGER trg_enqueue_user_override_change AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides FOR EACH ROW EXECUTE FUNCTION private.enqueue_user_override_change()'),
      ('CREATE CONSTRAINT TRIGGER trg_user_permission_overrides_final_state AFTER INSERT OR DELETE OR UPDATE ON public.user_permission_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.guard_user_overrides_final_state()')
    ) as production(definition))
  ) differences;
  if v_mismatch <> '' then
    raise exception 'permission override fidelity: triggers differ from production:%', E'\n' || v_mismatch;
  end if;

  if (select p.proacl::text from pg_catalog.pg_proc p where p.oid = 'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)'::regprocedure)
       is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
    raise exception 'permission override fidelity: the save''s grants differ from production';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator' and rolcanlogin and not rolinherit)
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls and not rolcanlogin)
     or (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.roleid
          where m.member = 'authenticator'::regrole and r.rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'permission override fidelity: PostgREST identities differ from production';
  end if;

  if (select datlocprovider::text || ' ' || datlocale from pg_catalog.pg_database where datname = pg_catalog.current_database())
       is distinct from 'i en-US' then
    raise exception 'permission override fidelity: the database must sort like production (ICU en-US)';
  end if;

  if (select count(*) || ' ' || md5(string_agg(permission || '=' || array_to_string(scopes, ','), ';' order by permission collate "C")) from private.lead_permission_editor_registry)
       is distinct from '104 9a205eed9930c935364fe5eb642a051e'
     or (select count(*) || ' ' || md5(string_agg(id::text || '|' || name || '|' || hierarchy || '|' || is_preset, ';' order by id)) from public.roles where company_id is null)
       is distinct from '7 6c9c5573f29044c4536b5fce67a5941a'
     or (select count(*) || ' ' || md5(string_agg(rp.role_id::text || '|' || rp.permission || '|' || rp.scope, ';' order by rp.role_id, rp.permission collate "C", rp.scope collate "C")) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.company_id is null)
       is distinct from '349 cafbb42aa97e06b8d89b57291ce5a6ab'
     or (select count(*) || ' ' || md5(string_agg(domain, ';' order by domain collate "C")) from private.agent_read_domains)
       is distinct from '17 1b245a038cbfe37e1d041cc6d4b1c8f5' then
    raise exception 'permission override fidelity: reference data differs from production';
  end if;
end
$permission_overrides_fidelity$;

select 'save path fidelity: 76 functions and 19 triggers match production';
