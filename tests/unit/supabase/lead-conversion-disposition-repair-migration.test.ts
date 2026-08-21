import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260820210000_lead_conversion_photo_selection_and_disposition_repair.sql"
  ),
  "utf8"
);

const permissionHardeningSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260820224500_lead_conversion_rpc_permission_hardening.sql"
  ),
  "utf8"
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("lead conversion photo selection and disposition repair migration", () => {
  it("returns total project-ranking booleans", () => {
    const body = functionBody("public.get_manual_project_link_candidates");
    expect(body).toMatch(
      /coalesce\([\s\S]*normalize_address\(project\.address\)[\s\S]*false[\s\S]*\)/i
    );
    expect(body).toMatch(
      /coalesce\([\s\S]*project\.client_id = v_client_id[\s\S]*false[\s\S]*\)/i
    );
  });

  it("exposes only settled, authorized conversion photo candidates", () => {
    const body = functionBody(
      "public.get_opportunity_conversion_photo_candidates"
    );
    expect(body).toContain("private.user_can_convert_opportunity");
    expect(body).toContain("v_opportunity.images");
    expect(body).toContain(
      "private.email_conversion_photo_source_is_eligible(attachment.id)"
    );
    expect(sql).toMatch(
      /revoke all on function public\.get_opportunity_conversion_photo_candidates\(uuid\)[\s\S]*grant execute[\s\S]*to authenticated/i
    );
  });

  it("keeps both conversion candidate RPCs signed-in only", () => {
    for (const functionName of [
      "get_manual_project_link_candidates",
      "get_opportunity_conversion_photo_candidates",
    ]) {
      expect(permissionHardeningSql).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\(uuid\\)\\s+from public, anon;`,
          "i"
        )
      );
      expect(permissionHardeningSql).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\(uuid\\)\\s+to authenticated;`,
          "i"
        )
      );
    }
  });

  it("validates the exact selection in the conversion transaction", () => {
    const prepare = functionBody(
      "private.prepare_conversion_photo_selection_event"
    );
    expect(prepare).toContain("for update");
    expect(prepare).toContain("conversion_photo_selection_invalid");
    expect(prepare).toContain("conversion_photo_selection_stale");
    expect(prepare).toContain("selected_lead_photo_urls");
    expect(prepare).toContain("selected_email_attachment_ids");
    expect(sql).toMatch(
      /create trigger conversion_events_prepare_photo_selection[\s\S]*before insert on public\.opportunity_conversion_events/i
    );
  });

  it("copies only selected photos without deleting pre-existing project media", () => {
    const enqueue = functionBody(
      "private.enqueue_conversion_event_email_photos"
    );
    expect(enqueue).toContain("photo.created_at = transaction_timestamp()");
    expect(enqueue).toContain(
      "new.payload -> 'selected_lead_photo_urls'"
    );
    expect(enqueue).toContain(
      "new.payload -> 'selected_email_attachment_ids'"
    );
    expect(sql).toContain("conversion photo event filter patch did not match once");
    expect(sql).toContain("conversion photo revoke patch did not match once");
  });

  it("makes every discard reason authoritative and lifecycle-changing", () => {
    expect(sql).toContain("'created_by_error'::text");
    expect(sql).toMatch(
      /'duplicate',[\s\S]*'not_a_fit',[\s\S]*'created_by_error',[\s\S]*'other',[\s\S]*'legacy_unspecified'[\s\S]*then 'discarded'/i
    );
    expect(sql).toContain("lead feedback outcome patch did not match once");
    expect(sql).toContain("lead feedback learning patch did not match once");
  });

  it("archives guarded budget deferrals as not now without a lost transition", () => {
    expect(sql).toContain("disposition.disposition = 'archived'");
    expect(sql).toContain("disposition.reason_code = 'not_now'");
    expect(sql).toContain("set archived_at = coalesce(archived_at, now())");
    expect(sql).toContain("Customer asked to revisit the work later.");
    expect(sql).toContain("'archived'::text");
    expect(sql).toContain("not-now lifecycle projection patch did not match once");
  });
});
