/**
 * Shared SPEC operator constants.
 *
 * SERVER ONLY. These are uuids that anchor SPEC's "ops-internal scope" — every
 * SPEC operator audit row, notification fan-out target, and permission override
 * uses the same OPS_OPERATIONS_COMPANY_ID so the operator company's RLS
 * isolation continues to round-trip cleanly through `public.audit_log`,
 * `public.notifications`, and `public.user_permission_overrides`.
 *
 * The values are defined by Stage A migration
 * `2026-05-25-spec-phase1-02-internal-company.sql`. Do not improvise — every
 * SPEC operator-side writer must reuse these.
 */

/**
 * Operator company anchor. Every operator-side audit/notification row carries
 * this as `company_id` so existing per-company RLS still works for the
 * operator's view (the operator user_row's company_id is also set to this).
 */
export const OPS_OPERATIONS_COMPANY_ID =
  "00000000-0000-0000-0000-00000000000a" as const;

/**
 * `spec_capacity` has a text primary key (`tier`), but `public.audit_log.record_id`
 * is `uuid NOT NULL`. We map each tier to a stable, hand-issued uuid here so
 * the audit table can reference rows without a schema change.
 *
 * These uuids are arbitrary but stable — they never collide with real
 * `spec_projects.id` values (those are `gen_random_uuid()`-issued, vanishingly
 * unlikely to land in the namespace `00000000-0000-0000-cafe-...`). When you
 * SELECT against `audit_log` filtered by `table_name='spec_capacity'`, you can
 * read the actual tier from `new_data->>'tier'` or use the lookup constants
 * here. Do not change these values — old audit rows would lose their anchor.
 */
export const SPEC_CAPACITY_RECORD_IDS = {
  setup: "00000000-0000-0000-cafe-000000000001",
  build: "00000000-0000-0000-cafe-000000000002",
  enterprise: "00000000-0000-0000-cafe-000000000003",
} as const satisfies Record<"setup" | "build" | "enterprise", string>;
