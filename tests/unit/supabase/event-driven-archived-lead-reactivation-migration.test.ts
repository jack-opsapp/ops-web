import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260731210000_event_driven_archived_lead_reactivation.sql"
  ),
  "utf8"
);

describe("event-driven archived lead reactivation migration", () => {
  it("derives high-confidence relationship authority only from the exact mailbox thread owner", () => {
    expect(sql).toMatch(
      /opportunity_email_threads[\s\S]*?opportunity_id\s*=\s*new\.opportunity_id[\s\S]*?connection_id\s*=\s*new\.connection_id[\s\S]*?thread_id\s*=\s*new\.provider_thread_id/i
    );
    expect(sql).toContain("high_confidence_related_contact");
    expect(sql).not.toMatch(/city|locality|municip|neighbou?rhood|region/i);
  });

  it("reactivates only a new meaningful customer inbound on an archived active lead", () => {
    expect(sql).toMatch(/new\.direction\s*=\s*'inbound'/i);
    expect(sql).toMatch(/new\.party_role\s*=\s*'customer'/i);
    expect(sql).toMatch(/new\.is_meaningful\s+is\s+true/i);
    expect(sql).toMatch(
      /new\.occurred_at\s*<=\s*opportunity\.archived_at[\s\S]*?return new/i
    );
    expect(sql).toMatch(
      /opportunity\.stage\s+not\s+in\s*\(\s*'new_lead',[\s\S]*?'negotiation'\s*\)[\s\S]*?return new/i
    );
    expect(sql).toMatch(/opportunity\.project_id\s+is\s+not\s+null/i);
    expect(sql).toMatch(/opportunity\.project_ref\s+is\s+not\s+null/i);
    expect(sql).toMatch(
      /opportunity\.merged_into_opportunity_id\s+is\s+not\s+null/i
    );
  });

  it("preserves an eligible assignee, otherwise uses the eligible mailbox owner", () => {
    expect(sql).toMatch(
      /opportunity\.assigned_to\s+is\s+not\s+null[\s\S]*?company_mailbox_intake_owner_is_eligible/i
    );
    expect(sql).toMatch(
      /current_connection\.default_intake_owner_id[\s\S]*?company_mailbox_intake_owner_is_eligible/i
    );
    expect(sql).toMatch(
      /change_assignment_system_company_serialized_internal[\s\S]*?'company_mailbox_default'/i
    );
  });

  it("queues a version-fenced assignment review when no eligible owner exists", () => {
    expect(sql).toMatch(
      /drop constraint if exists\s+unassigned_lead_assignment_deliveries_assignment_version_check/i
    );
    expect(sql).toMatch(/check \(assignment_version >= 0\)/i);
    expect(sql).toMatch(
      /unique \(opportunity_id, recipient_user_id, assignment_version\)/i
    );
    expect(sql).toMatch(
      /enqueue_unassigned_lead_assignment_deliveries_at_version\([\s\S]*?p_assignment_version bigint/i
    );
    expect(sql).toMatch(
      /opportunity\.assignment_version\s*<>\s*delivery\.assignment_version/i
    );
  });

  it("blocks active-stage evaluation until the opportunity is unarchived", () => {
    const transition = sql.match(
      /create or replace function public\.apply_email_opportunity_stage_transition[\s\S]*?\$function\$;/i
    )?.[0];
    expect(transition).toBeTruthy();
    expect(transition).toMatch(/v_archived_at timestamptz/i);
    expect(transition).toMatch(
      /if v_archived_at is not null[\s\S]*?'archived_opportunity'/i
    );
  });

  it("keeps all public entry points service-role only", () => {
    for (const name of [
      "record_opportunity_correspondence_event",
      "apply_email_opportunity_stage_transition",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}[\\s\\S]*?from public, anon, authenticated, service_role[\\s\\S]*?grant execute on function public\\.${name}[\\s\\S]*?to service_role`,
          "i"
        )
      );
    }
  });
});
