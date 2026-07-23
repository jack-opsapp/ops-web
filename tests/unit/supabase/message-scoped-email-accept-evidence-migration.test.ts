import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260722123000_message_scoped_email_accept_evidence.sql"
);

function compact(value: string) {
  return value.replace(/\s+/g, " ").toLowerCase();
}

function helperBody() {
  const sql = readFileSync(migrationPath, "utf8");
  const marker =
    "create or replace function private.valid_actorless_opportunity_conversion_evidence";
  const start = sql.toLowerCase().indexOf(marker);
  const end = sql.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error("guard helper is missing");
  return compact(sql.slice(start, end + "$function$;".length));
}

describe("message-scoped email acceptance evidence migration", () => {
  it("preserves the exact CRM-thread evidence contract", () => {
    const body = helperBody();

    expect(body).toContain("email_thread_id");
    expect(body).toContain("public.email_threads thread");
    expect(body).toContain(
      "thread.provider_thread_id = p_evidence ->> 'provider_thread_id'"
    );
    expect(body).toContain("thread.opportunity_id = p_opportunity_id");
  });

  it("accepts only an exact message-scoped decisive event and matching activity", () => {
    const body = helperBody();

    expect(body).toContain("conversation_scope");
    expect(body).toContain("source_activity_id");
    expect(body).toContain("p_evidence ->> 'conversation_scope' = 'message'");
    expect(body).toMatch(
      /event\.activity_id = v_source_activity_id[\s\S]*?activity\.id = event\.activity_id/
    );
    expect(body).toContain("activity.company_id = p_company_id");
    expect(body).toContain("activity.opportunity_id = p_opportunity_id");
    expect(body).toContain("activity.email_connection_id = connection.id");
    expect(body).toContain(
      "activity.email_message_id = event.provider_message_id"
    );
    expect(body).toContain(
      "activity.email_thread_id = event.provider_thread_id"
    );
    expect(body).toContain("activity.direction = event.direction");
    expect(body).toContain("activity.type = 'email'");
  });

  it("retains customer, signal, signed-attachment, and high-water guards for both evidence shapes", () => {
    const body = helperBody();

    expect(body).toContain("opportunity_sender_is_persisted_customer");
    expect(body).toContain("event.from_email");
    expect(body).toContain("event.opportunity_projection_applied is true");
    expect(body).toContain("evaluated_through_event_id");
    expect(body).toContain("v_has_newer_event");
    expect(body).toContain("event.direction = 'outbound'");
    expect(body).toContain("event.party_role = 'ops'");
    expect(body).toContain("'signed_estimate'");
    expect(body).toContain("public.email_attachments attachment");
    expect(body).toContain("public.attachment_inspections inspection");
    expect(body).toContain("attachment.activity_id = event.activity_id");
    expect(body).toContain("attachment.attribution_status = 'attributed'");
    expect(body).toContain("inspection.is_signed_estimate is true");
  });

  it("keeps the helper private from every database role", () => {
    const sql = compact(readFileSync(migrationPath, "utf8"));
    expect(sql).toMatch(
      /revoke all on function private\.valid_actorless_opportunity_conversion_evidence\( uuid, uuid, text, jsonb \) from public, anon, authenticated, service_role/
    );
  });
});
