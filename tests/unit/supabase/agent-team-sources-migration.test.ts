import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_team_sources.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "MISSING"),
  "utf8"
);
const BODY = readFileSync(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/team/sql/agent_team_sources.body.sql"
  ),
  "utf8"
);
const SQL = MIGRATION.toLowerCase();
const COMPACT = SQL.replace(/\s+/g, " ").trim();

describe("P2 team source fence migration", () => {
  it("uses one generated, byte-identical, transactional migration", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(/^\d{14}_agent_team_sources\.sql$/);
    expect(MIGRATION).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $source_shape$");
    expect(SQL).toContain("do $postflight$");
  });

  it("fences only active team source changes and proves the safe column shape", () => {
    expect(COMPACT).toContain(
      "after insert or update or delete on public.users for each row execute function private.bump_agent_read_domain_revision( 'team', 'company_id' )"
    );
    for (const column of [
      "id",
      "company_id",
      "first_name",
      "last_name",
      "profile_image_url",
      "user_color",
      "role",
      "is_active",
      "deleted_at",
    ]) {
      expect(COMPACT).toContain(`('${column}',`);
    }
  });

  it("pins the bounded active-directory keyset without granting source access", () => {
    expect(COMPACT).toContain(
      "create index if not exists idx_users_agent_team_directory_v1 on public.users"
    );
    expect(COMPACT).toContain(
      "private.agent_p2_optional_canonical_text( pg_catalog.btrim(first_name) || ' ' || pg_catalog.btrim(last_name), 256, 1024, false )"
    );
    expect(COMPACT).toContain("where deleted_at is null and is_active is true");
    for (const forbidden of [
      "grant select",
      "grant all",
      "create or replace function public.",
      "pg_catalog.coalesce(",
      "pg_catalog.nullif(",
    ]) {
      expect(COMPACT).not.toContain(forbidden);
    }
  });
});
