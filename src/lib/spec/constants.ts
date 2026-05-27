/**
 * OPS Web — SPEC constants
 *
 * Locked operator-side constants used across SPEC routes. Source: bible
 * ops-software-bible/SPEC/02_DATA_MODEL.md § Operator gate and Phase 1
 * migration spec_phase1_internal_company.sql (applied 2026-05-25).
 */

/**
 * The internal "OPS Operations" company seeded by the Phase 1 migration.
 * Every operator-facing notification row writes this as its company_id.
 * Every spec.admin override row in user_permission_overrides carries this
 * company_id by convention (the column is NOT NULL on the live table).
 */
export const OPS_OPERATIONS_COMPANY_ID =
  "00000000-0000-0000-0000-00000000000a";

/**
 * The 30-day Guarantee Refund window. Measured from
 * spec_projects.walkthrough_completed_at — the canonical anchor.
 * Bible: 01_BUSINESS_MODEL.md § 3, 06A_SPEC_TOS_PROSE.md § 8.
 */
export const GUARANTEE_REFUND_WINDOW_DAYS = 30;
