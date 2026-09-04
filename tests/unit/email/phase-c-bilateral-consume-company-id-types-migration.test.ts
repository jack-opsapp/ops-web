import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260903210000_phase_c_bilateral_consume_company_id_types.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("phase c bilateral consume company id type repair", () => {
  it("casts the uuid side when joining the text-keyed email_connections table", () => {
    expect(migration()).toMatch(
      /join public\.email_connections connection\s+on connection\.id = event\.connection_id\s+and connection\.company_id = event\.company_id::text/i
    );
  });

  it("casts the uuid side for the text-keyed calendar_user_events conflict probe", () => {
    expect(migration()).toMatch(
      /from public\.calendar_user_events event\s+where event\.company_id = v_handoff\.company_id::text/i
    );
  });

  it("leaves no uncast text = uuid comparison behind", () => {
    const sql = migration();
    expect(sql).not.toMatch(
      /connection\.company_id = event\.company_id(?!::text)/
    );
    expect(sql).not.toMatch(
      /from public\.calendar_user_events event\s+where event\.company_id = v_handoff\.company_id(?!::text)/i
    );
  });

  it("keeps the uuid = uuid correspondence-event filter uncast", () => {
    expect(migration()).toMatch(
      /where event\.id = v_handoff\.proposal_event_id\s+and event\.company_id = v_handoff\.company_id;/i
    );
  });

  it("keeps the site_visits text cast that was already correct", () => {
    expect(migration()).toMatch(
      /from public\.site_visits visit\s+where visit\.company_id = v_handoff\.company_id::text/i
    );
  });

  it("preserves the service-role boundary and the review-over-ambiguity contract", () => {
    const sql = migration();
    expect(sql).toMatch(/language plpgsql\s+security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(
      /if coalesce\(auth\.role\(\), ''\) <> 'service_role' then\s+raise exception 'access_denied' using errcode = '42501';/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.consume_phase_c_bilateral_event_handoff\(uuid, text\)\s+from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.consume_phase_c_bilateral_event_handoff\(uuid, text\)\s+to service_role;/i
    );
    expect(sql).toMatch(/v_review_reason := 'event_time_unresolved';/i);
    expect(sql).toMatch(
      /on conflict \(appointment_handoff_id\) where appointment_handoff_id is not null/i
    );
  });
});
