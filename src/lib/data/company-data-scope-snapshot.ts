/**
 * OPS Web — Live In-Scope Table Snapshot
 *
 * The two arrays below are GENERATED from the live schema by the queries in
 * this header. Never hand-add or hand-remove a name — re-run the query and
 * replace the array wholesale, so the file can only ever say what prod says.
 *
 * A checked-in picture of which tables the LIVE database considers part of a
 * company's data. `company-data-manifest.ts` must account for every name here,
 * either by classifying it or by declaring it out of scope.
 *
 * ── Why a snapshot and not just the generated types ────────────────────────
 * The manifest's other guard diffs against `database.types.ts`, which cannot
 * see backend tables the types have not caught up to — the manifest's
 * `UNTYPED_TABLE_ALLOWLIST` enumerates the in-scope tables missing from it. A
 * table absent from the types could therefore drop out of the manifest
 * silently, which is the exact bug class W1-6 exists to kill. This snapshot is
 * the primary guard; the types diff is the secondary.
 *
 * ── Regenerating ───────────────────────────────────────────────────────────
 * Run both queries against prod via the Supabase MCP
 * (`project_id: "ijeekuhbatykdomumfjx"`) and replace the arrays below verbatim.
 * Never hand-add a name: if a table belongs here the query says so.
 *
 * IN_SCOPE_SNAPSHOT — tables with `company_id`, plus every base table that
 * reaches one through a declared foreign key, to fixpoint:
 *
 *   WITH RECURSIVE base AS (
 *     SELECT DISTINCT c.table_name::text AS table_name
 *     FROM information_schema.columns c
 *     JOIN information_schema.tables t
 *       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
 *      AND t.table_type = 'BASE TABLE'
 *     WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
 *   ),
 *   fk AS (
 *     SELECT DISTINCT con.conrelid::regclass::text AS child,
 *                     con.confrelid::regclass::text AS parent
 *     FROM pg_constraint con
 *     JOIN pg_namespace n ON n.oid = con.connamespace
 *     JOIN pg_class cc ON cc.oid = con.conrelid AND cc.relkind = 'r'
 *     WHERE con.contype = 'f' AND n.nspname = 'public'
 *       AND con.conrelid <> con.confrelid
 *   ),
 *   scope AS (
 *     SELECT table_name FROM base
 *     UNION
 *     SELECT f.child FROM fk f JOIN scope s ON s.table_name = f.parent
 *   )
 *   SELECT string_agg(table_name, E'\n' ORDER BY table_name) FROM scope;
 *
 * AUTH_IDENTITY_SNAPSHOT — the boundary case. These reference **auth.users**
 * (Supabase Auth) rather than `public.users`, so the closure above cannot
 * reach them, yet they look user-owned at a glance. Enumerating them means
 * each one has to be explicitly declared out of scope rather than quietly
 * missed:
 *
 *   SELECT DISTINCT con.conrelid::regclass::text
 *   FROM pg_constraint con
 *   JOIN pg_namespace n ON n.oid = con.connamespace
 *   WHERE con.contype = 'f' AND n.nspname = 'public'
 *     AND con.confrelid::regclass::text = 'auth.users'
 *   -- minus anything already in IN_SCOPE_SNAPSHOT
 *
 * Verified against prod 2026-08-06: 223 in scope and
 * 5 auth-identity tables. The live snapshot includes the normalized
 * site-visit packet tables and the company-owned site_visit_types settings table.
 * The tenant row `companies` is deliberately absent — it carries no
 * `company_id` and no foreign key into scope, so no query can derive it; the
 * manifest adds it explicitly as the root.
 *
 * STAGED_IN_SCOPE_MIGRATION_TABLES is deliberately separate from that live
 * readback. It closes the account-export/purge gap for tables introduced by an
 * unapplied migration in this branch without pretending those tables already
 * exist in production. Every staged name must be created by a checked-in
 * migration, classified in the manifest, and absent from the generated types.
 * After the migration is applied to the authoritative database, regenerate
 * both snapshots/types and empty this list in the same release proof.
 */

/** Every table the live schema places inside a company's data. */
export const IN_SCOPE_SNAPSHOT: readonly string[] = [
  "accept_estimate_to_job_requests",
  "accounting_category_mappings",
  "accounting_connections",
  "accounting_sync_events",
  "accounting_sync_log",
  "accounting_sync_queue",
  "accounting_sync_suppressions",
  "activities",
  "activity_comments",
  "admin_feature_overrides",
  "agent_actions",
  "agent_knowledge_graph",
  "agent_memories",
  "agent_writing_profiles",
  "ai_draft_history",
  "analytics_events",
  "app_events",
  "approved_action_email_intents",
  "attachment_inspections",
  "audit_log",
  "beta_access_requests",
  "billing_events",
  "bug_reports",
  "calendar_events",
  "calendar_user_events",
  "catalog_categories",
  "catalog_guided_setup_actions",
  "catalog_guided_setup_sessions",
  "catalog_inventory_import_rows",
  "catalog_inventory_imports",
  "catalog_item_tags",
  "catalog_items",
  "catalog_option_values",
  "catalog_options",
  "catalog_order_items",
  "catalog_orders",
  "catalog_product_capability_bindings",
  "catalog_product_option_mappings",
  "catalog_setup_save_requests",
  "catalog_setup_session_locks",
  "catalog_setup_verification_items",
  "catalog_snapshot_items",
  "catalog_snapshots",
  "catalog_stock_unit_events",
  "catalog_stock_units",
  "catalog_supplier_cost_profiles",
  "catalog_tags",
  "catalog_units",
  "catalog_variant_option_values",
  "catalog_variants",
  "client_product_overrides",
  "clients",
  "company_default_products",
  "company_inventory_settings",
  "company_settings",
  "data_setup_requests",
  "deck_designs",
  "deck_subscriptions",
  "deck_zoning_parcel_records",
  "document_sequences",
  "document_templates",
  "duplicate_reviews",
  "email_assignment_contact_form_draft_queue",
  "email_attachment_inspection_jobs",
  "email_attachment_scans",
  "email_attachments",
  "email_autonomy_milestones",
  "email_connection_lifecycle_outbox",
  "email_connections",
  "email_conversion_photo_jobs",
  "email_conversion_photo_objects",
  "email_import_provider_operations",
  "email_ingest_heartbeat_log",
  "email_ingestion_recovery_queue",
  "email_log",
  "email_oauth_states",
  "email_outbound_edit_evidence",
  "email_outbound_edit_promotions",
  "email_outbound_learning_queue",
  "email_outbound_memory_evidence",
  "email_outbound_writing_samples",
  "email_provider_mutation_attempts",
  "email_send_intents",
  "email_signature_notification_lifecycle_outbox",
  "email_signatures",
  "email_templates",
  "email_thread_category_corrections",
  "email_threads",
  "estimates",
  "expense_auto_approve_rule_members",
  "expense_auto_approve_rules",
  "expense_batches",
  "expense_categories",
  "expense_project_allocations",
  "expense_settings",
  "expenses",
  "feature_requests",
  "follow_ups",
  "forecast_alerts",
  "gmail_import_jobs",
  "gmail_scan_jobs",
  "graph_entities",
  "inventory_deductions",
  "invoices",
  "lead_classification_reviews",
  "lead_disposition_feedback",
  "lead_field_provenance",
  "lead_intake_correction_runs",
  "lead_lifecycle_settings",
  "line_item_answers",
  "line_item_materials",
  "line_item_questions",
  "line_items",
  "notification_preferences",
  "notifications",
  "onboarding_email_log",
  "opportunities",
  "opportunity_assignment_deliveries",
  "opportunity_assignment_events",
  "opportunity_assignment_suggestions",
  "opportunity_conversion_events",
  "opportunity_conversion_notification_deliveries",
  "opportunity_correspondence_events",
  "opportunity_dispositions",
  "opportunity_email_threads",
  "opportunity_follow_up_drafts",
  "opportunity_lifecycle_action_audit",
  "opportunity_lifecycle_state",
  "opportunity_manual_outbound_cycle_receipts",
  "opportunity_merges",
  "opportunity_views",
  "payment_milestones",
  "payment_reminder_generation_claims",
  "payment_review_writeoff_receipts",
  "payments",
  "pending_auto_sends",
  "phase_c_category_auto_send_acceptances",
  "pipeline_stage_configs",
  "portal_branding",
  "portal_messages",
  "portal_sessions",
  "portal_tokens",
  "product_bundle_items",
  "product_material_quantity_rules",
  "product_materials",
  "product_option_values",
  "product_options",
  "product_pricing_modifiers",
  "product_tax_rates",
  "products",
  "project_material_demands",
  "project_material_snapshot_items",
  "project_material_snapshots",
  "project_note_mention_events",
  "project_notes",
  "project_photo_annotations",
  "project_photos",
  "project_status_lifecycle_outbox",
  "project_tasks",
  "project_views",
  "projects",
  "qbo_customer_matches",
  "qbo_estimate_opportunity_links",
  "qbo_import_runs",
  "qbo_item_product_mappings",
  "qbo_staging_customers",
  "qbo_staging_estimates",
  "qbo_staging_invoices",
  "qbo_staging_line_items",
  "qbo_staging_payments",
  "recurring_expenses",
  "role_permissions",
  "roles",
  "site_visit_artifacts",
  "site_visit_checklist_answers",
  "site_visit_identity_drafts",
  "site_visit_types",
  "site_visits",
  "spec_acceptance_events",
  "spec_blocked_buyers",
  "spec_change_orders",
  "spec_communications",
  "spec_email_outbox",
  "spec_feature_acceptance",
  "spec_internal_notes",
  "spec_module_entitlements",
  "spec_owner_approval_requests",
  "spec_payments",
  "spec_projects",
  "spec_referrals",
  "spec_refund_requests",
  "spec_retainers",
  "spec_satisfaction_ratings",
  "spec_scope_documents",
  "spec_support_tickets",
  "stage_transitions",
  "sub_clients",
  "task_material_allocations",
  "task_material_consumption_requests",
  "task_materials",
  "task_mutation_events",
  "task_recurrence_exceptions",
  "task_recurrences",
  "task_reminders",
  "task_schedule_automation_outbox",
  "task_templates",
  "task_type_reminders",
  "task_types",
  "tax_rates",
  "team_invitations",
  "trial_attributions",
  "trial_expiry_notifications",
  "unanswered_lead_local_draft_generation_claims",
  "unanswered_lead_message_projections",
  "unassigned_lead_assignment_deliveries",
  "user_dashboard_preferences",
  "user_email_aliases",
  "user_permission_change_deliveries",
  "user_permission_overrides",
  "user_roles",
  "users",
  "weather_forecasts",
  "wizard_analytics",
];

/** Company-scoped tables created by checked-in migrations not yet applied live. */
export const STAGED_IN_SCOPE_MIGRATION_TABLES: readonly string[] = [
  "job_conversation_anchors",
  "job_conversation_redaction_events",
  "job_conversation_turns",
  "job_conversations",
  "job_memory_version_evidence",
  "job_memory_versions",
];

/**
 * Tables hanging off Supabase Auth identities rather than `public.users`.
 * Each must appear in the manifest's `OUT_OF_SCOPE_TABLES` with a reason.
 */
export const AUTH_IDENTITY_SNAPSHOT: readonly string[] = [
  "certificates",
  "email_pause_audit_log",
  "email_pause_state",
  "email_template_versions",
  "streaks",
];
