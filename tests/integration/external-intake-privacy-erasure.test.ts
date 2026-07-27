import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727103100_external_intake_lead_file_access.sql"
  ),
  "utf8"
).toLowerCase();

describe("external intake privacy erasure boundary", () => {
  it("blocks reads before claim and completes only after worker evidence", () => {
    expect(migration).toMatch(
      /not exists \([\s\S]*?from private\.external_intake_erasure_outbox/
    );
    expect(migration).toContain("invalidation_reference");
    expect(migration).toContain("external_intake_legal_holds");
    expect(migration).toContain("personal_evidence_erased_at");
    expect(migration).toContain(
      "private.append_external_lead_projection_foundation("
    );
  });
});
