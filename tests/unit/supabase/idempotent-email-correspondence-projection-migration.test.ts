import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260713201000_idempotent_email_correspondence_projection.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("idempotent email correspondence projection migration", () => {
  it("assumes legacy/backfill events were already projected and requires provider ingestion to opt in", () => {
    expect(sql()).toMatch(
      /add column if not exists opportunity_projection_applied boolean not null\s+default true/i
    );
  });

  it("orders email direction against email timestamps rather than unrelated activity", () => {
    expect(sql()).toMatch(
      /last_message_direction\s*=\s*case[\s\S]*?greatest\(\s*opportunity\.last_inbound_at,\s*opportunity\.last_outbound_at\s*\)[\s\S]*?'-infinity'::timestamptz/i
    );
  });

  it("locks one provider event and increments only while its projection is pending", () => {
    const source = sql();

    expect(source).toMatch(
      /where event\.company_id = p_company_id[\s\S]*?event\.connection_id = p_connection_id[\s\S]*?event\.provider_message_id = p_provider_message_id[\s\S]*?for update/i
    );
    expect(source).toMatch(
      /if not v_projection_applied then[\s\S]*?correspondence_count = coalesce\(opportunity\.correspondence_count, 0\) \+ 1[\s\S]*?set opportunity_projection_applied = true/i
    );
  });

  it("rejects cross-opportunity replay and keeps activity chronology monotonic", () => {
    const source = sql();

    expect(source).toMatch(
      /v_event_opportunity_id is distinct from p_opportunity_id/i
    );
    expect(source).toMatch(
      /v_occurred_at > opportunity\.last_activity_at[\s\S]*?else opportunity\.last_activity_at/i
    );
  });

  it("is service-role only", () => {
    const source = sql();

    expect(source).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(source).toMatch(
      /revoke all on function public\.apply_opportunity_correspondence_event[\s\S]*?from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.apply_opportunity_correspondence_event[\s\S]*?to service_role/i
    );
  });
});
