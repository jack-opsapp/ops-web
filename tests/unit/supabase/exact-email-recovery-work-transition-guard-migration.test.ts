import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722124000_harden_exact_email_recovery_work_transitions.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("exact email recovery work transition guard migration", () => {
  it("is transactional and installs a private service-role transition proof trigger", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "create or replace function private.prove_exact_message_recovery_work_transition()"
    );
    expect(compact).toContain(
      "if (select auth.role()) is distinct from 'service_role'"
    );
    expect(compact).toContain(
      "before update on private.email_exact_message_recovery_work"
    );
    expect(compact).toContain(
      "revoke all on function private.prove_exact_message_recovery_work_transition() from public, anon, authenticated, service_role"
    );
  });

  it("re-authorizes the current actor, mailbox, and action at every live step", () => {
    expect(compact).toContain("from public.users actor");
    expect(compact).toContain("coalesce(actor.is_active, false)");
    expect(compact).toContain("connection.status = 'active'");
    expect(compact).toMatch(
      /public\.authorize_email_inbox_action_as_system\( old\.actor_user_id, old\.connection_id, null, 'view' \)/
    );
    expect(compact).toContain(
      "public.authorize_email_exact_message_ingest_as_system( old.actor_user_id, old.company_id, old.connection_id )"
    );
    expect(compact).toContain(
      "private.user_can_edit_opportunity( old.actor_user_id, v_application.source_opportunity_id )"
    );
    expect(compact).toContain(
      "private.user_can_edit_opportunity( old.actor_user_id, v_application.target_opportunity_id )"
    );
  });

  it("derives mutation identity only from exact canonical activity, event, and application proof", () => {
    for (const identity of [
      "activity.email_connection_id = old.connection_id",
      "activity.email_thread_id = old.provider_thread_id",
      "activity.email_message_id = old.provider_message_id",
      "event.connection_id = old.connection_id",
      "event.provider_thread_id = old.provider_thread_id",
      "event.provider_message_id = old.provider_message_id",
      "event.direction = 'inbound'",
      "event.party_role = 'customer'",
      "event.is_meaningful is true",
      "event.opportunity_projection_applied is true",
      "application.manifest_sha256 = old.manifest_sha256",
      "application.entry_sha256 = old.entry_sha256",
      "application.actor_user_id = old.actor_user_id",
    ]) {
      expect(compact).toContain(identity);
    }
    expect(compact).toContain("new.activity_id := v_activity.id");
    expect(compact).toContain(
      "new.opportunity_id := v_activity.opportunity_id"
    );
    expect(compact).toContain("new.correspondence_event_id := v_event.id");
    expect(compact).toContain(
      "new.attachment_scan_generation := v_application.attachment_scan_generation"
    );
  });

  it("binds attachment completion to the exact scan generation and final sorted attachment set", () => {
    expect(compact).toContain(
      "private.exact_message_recovery_attachment_state( old.company_id, old.connection_id, old.provider_thread_id, old.provider_message_id, v_application.activity_id, v_application.target_opportunity_id, v_application.attachment_scan_generation ) <> 'complete'"
    );
    expect(compact).toContain(
      "array_agg(attachment.id order by attachment.id)"
    );
    expect(compact).toContain(
      "v_attachment_ids is distinct from v_application.attachment_ids"
    );
    expect(compact).toContain("new.attachment_ids := v_attachment_ids");
  });

  it("requires canonical summary and exact unanswered projection output before completion", () => {
    expect(compact).toContain(
      "opportunity.ai_summary_updated_at >= v_summary_floor"
    );
    expect(compact).toContain(
      "from public.unanswered_lead_message_projections projection"
    );
    for (const proof of [
      "projection.source_event_id = v_event.id",
      "projection.source_activity_id = v_activity.id",
      "projection.connection_id = old.connection_id",
      "projection.provider_thread_id = old.provider_thread_id",
      "projection.provider_message_id = old.provider_message_id",
      "projection.manifest_sha256 = old.manifest_sha256",
      "projection.entry_sha256 = old.entry_sha256",
      "projection.projected_by = old.actor_user_id",
    ]) {
      expect(compact).toContain(proof);
    }
  });

  it("parenthesizes CASE expressions inside PL/pgSQL IF conditions", () => {
    expect(compact).not.toMatch(/is distinct from case when/);
    expect(compact.match(/is distinct from \( case/g)).toHaveLength(2);
  });

  it("allows only audited never-started abandonment and keeps it terminal", () => {
    expect(compact).toContain("if old.state = 'abandoned'");
    expect(compact).toContain("exact_recovery_abandoned_work_is_terminal");
    expect(compact).toContain("if new.state = 'abandoned'");
    expect(compact).toContain("exact_recovery_work_cannot_be_abandoned");
    expect(compact).toContain(
      "from private.email_exact_message_recovery_applications application"
    );
    expect(compact).toContain("new.superseded_by_manifest_sha256");
    expect(compact).toContain("new.superseded_by_entry_sha256");
  });
});
