import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260731202250_notification_company_id_integrity.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("notification company identity integrity migration", () => {
  it("blocks future malformed tenant keys without rewriting the historical row", () => {
    expect(sql).toContain("notifications_company_id_canonical");
    expect(sql).toContain("company_id ~*");
    expect(sql).toContain("not valid");
    expect(sql).not.toMatch(/update\s+public\.notifications/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.notifications/i);
  });
});
