import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith("_phase_c_handoff_opportunity_fk_index.sql")
);
const migrationPath = join(migrationsDir, migrationName ?? "missing.sql");
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("Phase C handoff opportunity foreign-key index migration", () => {
  it("covers the standalone opportunity relationship additively", () => {
    expect(source).toContain("create index if not exists");
    expect(source).toContain(
      "on public.phase_c_bilateral_event_handoffs (opportunity_id)"
    );
    expect(source).not.toMatch(/\b(drop|delete|update|insert|alter table)\b/i);
  });
});
