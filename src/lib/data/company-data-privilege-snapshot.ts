/**
 * OPS Web — Live `service_role` Table-Privilege Snapshot
 *
 * The array below is GENERATED from the live schema by the query in this
 * header. Never hand-add or hand-remove a name — re-run the query and replace
 * the array wholesale, so the file can only ever say what prod says.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `/api/data/delete-account` runs as `service_role`. Classifying a table in the
 * manifest says nothing about whether that role may actually touch it: a table
 * created by a migration that never issued a GRANT is reachable by `postgres`
 * alone. Thirty of them are in exactly that state — fifteen with no privileges
 * whatsoever, fifteen more that `service_role` can read but not DELETE.
 *
 * The cascade found this the expensive way. A rehearsal against a disposable
 * tenant died at acting-step 23 of 198 (`count rows to purge in
 * email_outbound_edit_promotions`, 500, empty error message), and every real
 * account deletion would have died at the same place. The fourteen
 * SELECT-but-not-DELETE tables would have killed the next fourteen attempts,
 * one per fix, because a count that succeeds hides the DELETE that cannot.
 *
 * `tests/integration/company-data-manifest.test.ts` now asserts, against this
 * snapshot, that every manifest table is either fully mutable by `service_role`
 * or declared in `DEFINER_PURGED_TABLES` — the set routed through the
 * `public.purge_company_rows` SECURITY DEFINER function instead. That is the
 * check that would have caught the bug before the rehearsal did.
 *
 * ── Regenerating ───────────────────────────────────────────────────────────
 * Run against prod via the Supabase MCP (`project_id: "ijeekuhbatykdomumfjx"`)
 * and replace `SERVICE_ROLE_BLOCKED_TABLES` verbatim. `has_table_privilege`
 * resolves role membership, so it answers the real question — what the role can
 * do — rather than what was granted to it directly:
 *
 *   SELECT t.table_name,
 *          has_table_privilege('service_role',
 *            format('public.%I', t.table_name), 'SELECT') AS "select",
 *          has_table_privilege('service_role',
 *            format('public.%I', t.table_name), 'UPDATE') AS "update",
 *          has_table_privilege('service_role',
 *            format('public.%I', t.table_name), 'DELETE') AS "delete"
 *   FROM information_schema.tables t
 *   WHERE t.table_schema = 'public'
 *     AND t.table_type = 'BASE TABLE'
 *     AND NOT (has_table_privilege('service_role',
 *                format('public.%I', t.table_name), 'SELECT')
 *          AND has_table_privilege('service_role',
 *                format('public.%I', t.table_name), 'DELETE'))
 *   ORDER BY t.table_name;
 *
 * The complement — every table the role CAN read and delete — is deliberately
 * not stored: it is 287 names that carry no information the guard uses, and a
 * transcription slip in it would fail the suite for a table that is perfectly
 * healthy. Blocked is the exceptional, load-bearing state, so blocked is what
 * is checked in.
 *
 * Verified against prod 2026-08-14: 324 base tables in `public` —
 * 294 fully available to `service_role` and 30 blocked (listed below).
 * `calendar_feed_tokens`, `google_calendar_sync_queue`, `meeting_proposals`,
 * and `site_visit_types` are fully available for account export and closure.
 * RLS is not part of this picture: `service_role` carries BYPASSRLS, so table
 * privileges are the only gate.
 */

/** What `service_role` may actually do to one table, per the live catalog. */
export interface ServiceRolePrivileges {
  readonly table: string;
  readonly select: boolean;
  readonly update: boolean;
  readonly delete: boolean;
}

/**
 * Every `public` base table `service_role` cannot both read and DELETE.
 *
 * Two failure shapes live here, and the difference is why the rehearsal only
 * exposed half the problem:
 *
 *   select: false — the cascade cannot even count the rows. It fails loudly on
 *                   the first such table, which is what happened at step 23.
 *   select: true  — the count succeeds and the DELETE is refused one call
 *   delete: false   later. Silent until the step actually runs.
 */
export const SERVICE_ROLE_BLOCKED_TABLES: readonly ServiceRolePrivileges[] = [
  { table: "email_assignment_contact_form_draft_queue", select: false, update: false, delete: false },
  { table: "email_conversion_photo_jobs", select: true, update: false, delete: false },
  { table: "email_conversion_photo_objects", select: true, update: false, delete: false },
  { table: "email_import_provider_operations", select: false, update: false, delete: false },
  { table: "email_ingestion_recovery_queue", select: true, update: true, delete: false },
  { table: "email_outbound_edit_evidence", select: false, update: false, delete: false },
  { table: "email_outbound_edit_promotions", select: false, update: false, delete: false },
  { table: "email_outbound_learning_queue", select: false, update: false, delete: false },
  { table: "email_outbound_memory_evidence", select: false, update: false, delete: false },
  { table: "email_outbound_writing_samples", select: false, update: false, delete: false },
  { table: "email_provider_mutation_attempts", select: false, update: false, delete: false },
  { table: "email_send_intents", select: true, update: true, delete: false },
  { table: "email_signature_notification_lifecycle_outbox", select: true, update: false, delete: false },
  { table: "email_signatures", select: true, update: false, delete: false },
  { table: "lead_intake_correction_runs", select: true, update: false, delete: false },
  { table: "opportunity_assignment_deliveries", select: true, update: false, delete: false },
  { table: "opportunity_assignment_events", select: true, update: false, delete: false },
  { table: "opportunity_assignment_suggestions", select: true, update: true, delete: false },
  { table: "opportunity_conversion_events", select: true, update: false, delete: false },
  { table: "opportunity_conversion_notification_deliveries", select: false, update: false, delete: false },
  { table: "opportunity_manual_outbound_cycle_receipts", select: true, update: false, delete: false },
  { table: "phase_c_category_auto_send_acceptances", select: false, update: false, delete: false },
  { table: "project_note_mention_events", select: true, update: false, delete: false },
  { table: "project_status_lifecycle_outbox", select: false, update: false, delete: false },
  { table: "stage_transitions", select: true, update: false, delete: false },
  { table: "task_mutation_events", select: false, update: false, delete: false },
  { table: "task_schedule_automation_outbox", select: false, update: false, delete: false },
  { table: "unassigned_lead_assignment_deliveries", select: false, update: false, delete: false },
  { table: "user_email_aliases", select: true, update: false, delete: false },
  { table: "user_permission_change_deliveries", select: false, update: false, delete: false },
];

/** Table name → the privileges `service_role` holds on it. */
export function blockedPrivilegesByTable(): Map<string, ServiceRolePrivileges> {
  return new Map(SERVICE_ROLE_BLOCKED_TABLES.map((p) => [p.table, p]));
}
