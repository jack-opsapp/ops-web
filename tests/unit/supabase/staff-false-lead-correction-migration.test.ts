import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260728163000_guarded_staff_false_lead_correction.sql"
)
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : ""
const compact = source.replace(/\s+/g, " ")

function functionBody(name: string): string {
  const start = compact.indexOf(`create or replace function ${name}`)
  const end = compact.indexOf(
    `revoke all on function ${name}`,
    Math.max(start, 0)
  )
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return compact.slice(start, end)
}

describe("guarded staff-authored false-lead correction migration", () => {
  it("is transactional and stores immutable, content-addressed repair receipts", () => {
    expect(source.trim().startsWith("begin;")).toBe(true)
    expect(source.trim().endsWith("commit;")).toBe(true)
    expect(compact).toContain("create table public.lead_intake_correction_runs")
    expect(compact).toContain("manifest_sha256 text not null")
    expect(compact).toContain("entry_a_sha256 text not null")
    expect(compact).toContain("entry_b_sha256 text not null")
    expect(compact).toContain("input_spec jsonb not null")
    expect(compact).toContain("result jsonb not null")
    expect(compact).toContain("unique (company_id, correction_key)")
    expect(compact).toContain(
      "alter table public.lead_intake_correction_runs enable row level security"
    )
    expect(compact).toContain(
      "revoke all on table public.lead_intake_correction_runs from public, anon, authenticated, service_role"
    )
    expect(compact).toContain(
      "grant select on table public.lead_intake_correction_runs to service_role"
    )
  })

  it("exposes one service-only, empty-search-path repair boundary", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("coalesce(auth.role(), '') <> 'service_role'")
    expect(body).toContain("set search_path = ''")
    expect(body).toContain("p_actor_user_id uuid")
    expect(body).toContain("p_company_id uuid")
    expect(body).toContain("p_correction_key text")
    expect(body).toContain("p_manifest_sha256 text")
    expect(body).toContain("p_entry_a_sha256 text")
    expect(body).toContain("p_entry_b_sha256 text")
    expect(body).toContain("p_spec jsonb")
    expect(compact).toMatch(
      /revoke all on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) from public, anon, authenticated, service_role/
    )
    expect(compact).toMatch(
      /grant execute on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) to service_role/
    )
  })

  it("fails closed on an altered manifest, actor, mailbox, roster, or source snapshot", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    for (const proof of [
      "private.lock_lead_assignment_company(p_company_id)",
      "private.permission_user_is_admin(",
      "connection.status = 'active'",
      "connection.sync_enabled is true",
      "staff.is_active is true",
      "source_opportunity_snapshot_changed",
      "protected_target_snapshot_changed",
      "staff_false_lead_activity_set_changed",
      "staff_false_lead_event_set_changed",
      "staff_false_lead_thread_set_changed",
      "staff_false_lead_attachment_changed",
      "staff_false_lead_lifecycle_changed",
      "staff_false_lead_notification_set_changed",
      "staff_false_lead_has_unreviewed_children",
    ]) {
      expect(body).toContain(proof)
    }
    expect(body).toContain("for update")
    expect(body).toContain("repair_manifest_conflict")
    expect(body).toContain("repair_applied_state_changed")
  })

  it("verifies the staff alias authoritatively and never relies on fuzzy identity", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("from public.user_email_aliases alias")
    expect(body).toContain("alias.email = v_staff_alias")
    expect(body).toContain("alias.user_id = v_staff_user_id")
    expect(body).toContain("status = 'verified'")
    expect(body).toContain("source = 'operator_verified'")
    expect(body).toContain("reviewed_by = p_actor_user_id")
    expect(body).toContain("verified_by = p_actor_user_id")
    expect(body).toContain("registered staff email")
    expect(body).toContain("staff_alias_conflict")
  })

  it("creates the real property lead and assigns it through the canonical system RPC", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("insert into public.clients")
    expect(body).toContain("insert into public.opportunities")
    expect(body).toContain("address")
    expect(body).toContain("source_thread_key")
    expect(body).toContain("message:")
    expect(body).toContain("public.change_opportunity_assignment_as_system(")
    expect(body).not.toMatch(
      /update public\.opportunities[\s\S]*?set[\s\S]*?assigned_to\s*=/
    )
  })

  it("reclassifies exact staff-authored messages as outbound and moves every canonical projection", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain(
      "insert into private.opportunity_child_reparent_tokens"
    )
    expect(body).toContain("update public.activities")
    expect(body).toContain("direction = 'outbound'")
    expect(body).toContain("update public.opportunity_correspondence_events")
    expect(body).toContain("party_role = 'ops'")
    expect(body).toContain("update public.email_threads")
    expect(body).toContain("update public.opportunity_email_threads")
    expect(body).toContain(
      "'ops.email_thread_reassignment_mode', 'data_review', true"
    )
    expect(body).toContain("private.recompute_staff_false_lead_projection(")
    expect(body).toContain(
      "private.recompute_exact_message_lifecycle_projection("
    )
  })

  it("preserves protected target truth while rebuilding only correspondence projections", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )
    const helper = functionBody("private.recompute_staff_false_lead_projection")

    for (const field of [
      "stage",
      "stage_manually_set",
      "assigned_to",
      "assignment_version",
      "project_id",
      "project_ref",
      "updated_at",
    ]) {
      expect(body).toContain(`v_target_after.${field}`)
    }
    expect(helper).toContain(
      "private.exact_recovery_opportunity_timestamp_tokens"
    )
    expect(helper).toContain("count(*) filter")
    expect(helper).toContain("last_message_direction")
    expect(helper).toContain("last_activity_at")
    expect(helper).toContain("projection_timestamp_changed")
  })

  it("queues attachment re-attribution and proves the exact generation advance", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("from public.email_attachment_scans scan")
    expect(body).toContain("v_prior_scan_generation")
    expect(body).toContain("v_attachment_scan_generation")
    expect(body).toContain("v_prior_scan_generation_a + 1")
    expect(body).toContain("attribution_status <> 'pending'")
    expect(body).toContain("attachment_requeue_failed")
  })

  it("resolves false notifications, discards the false draft and lead, and preserves audit history", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("update public.notifications")
    expect(body).toContain("resolution_reason = 'lead_intake_data_correction'")
    expect(body).toContain("update public.ai_draft_history")
    expect(body).toContain("status = 'discarded'")
    expect(body).toContain("insert into public.opportunity_dispositions")
    expect(body).toContain("'operator_manual'")
    expect(body).toContain("insert into public.stage_transitions")
    expect(body).toContain("delete from public.opportunity_lifecycle_state")
    expect(body).toContain("stage = 'discarded'")
    expect(body).toContain("deleted_at = v_now")
    expect(body).toContain("archived_at = v_now")
  })

  it("deletes the false customer only after a schema-wide reference scan reaches zero", () => {
    const body = functionBody(
      "public.apply_staff_authored_false_lead_correction_guarded"
    )

    expect(body).toContain("from information_schema.columns")
    expect(body).toContain("column_name in ('client_id', 'client_ref')")
    expect(body).toContain("pg_catalog.format(")
    expect(body).toContain("client_reference_remains")
    expect(body).toContain("update public.clients")
    expect(body).toContain("deleted_at = v_now")
  })
})
