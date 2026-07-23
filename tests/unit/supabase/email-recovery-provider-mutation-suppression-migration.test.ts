import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722122000_email_recovery_provider_mutation_suppression.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

describe("email recovery provider-mutation suppression migration", () => {
  it("durably marks recovery activities and suppresses provider drafts from either recovery boundary", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain(
      "alter table public.activities add column if not exists provider_mutations_disabled boolean not null default false"
    );
    expect(compact).toContain(
      "create or replace function private.suppress_email_recovery_provider_draft_queue"
    );
    expect(compact).toContain("assignment_event.metadata");
    expect(compact).toContain("provider_mutations_disabled");
    expect(compact).toContain(
      "where activity.id = new.source_activity_id"
    );
    expect(compact).toMatch(
      /coalesce\(activity\.provider_mutations_disabled, false\)[\s\S]*?return null;/
    );
    expect(compact).toContain(
      "if v_assignment_provider_mutations_disabled or v_activity_provider_mutations_disabled then"
    );
    expect(compact).toContain("return null;");
    expect(compact).toContain(
      "before insert on public.email_assignment_contact_form_draft_queue"
    );
    expect(compact).toContain(
      "revoke all on function private.suppress_email_recovery_provider_draft_queue() from public, anon, authenticated, service_role"
    );
  });
});
