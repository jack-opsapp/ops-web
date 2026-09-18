import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const fixName = "20260918022722_permission_overrides_clear_alias.sql";
const functionName =
  "create or replace function public.apply_user_permission_overrides_as_system";

// `unnest(x) permission` names BOTH the relation and its column "permission";
// any join to a table that also has a "permission" column then makes a bare
// `permission` reference ambiguous (42702) and the whole statement fails
// before it reads a row. That shipped on 2026-07-15 and broke every
// individual permission save until 2026-09-18.
const bareAlias = /unnest\([a-z_]+\)\s+permission\b/;

function read(name: string): string {
  return readFileSync(resolve(migrationsDir, name), "utf8").toLowerCase();
}

describe("permission override clear-list alias fix", () => {
  it("replaces the function only from the reviewed live definition", () => {
    const source = read(fixName);
    const guard = source.indexOf("do $guard$");
    const replacement = source.indexOf(functionName);

    expect(guard).toBeGreaterThan(-1);
    expect(source).toContain("74ca941e37b9813a30db902b52c91e13");
    expect(replacement).toBeGreaterThan(guard);
  });

  it("qualifies every clear-list reference", () => {
    const source = read(fixName);

    expect(source).not.toMatch(bareAlias);
    expect(source).toContain(
      "on registry.permission = cleared.permission"
    );
    expect(source).toContain("where cleared.permission is null");
    expect(source).toContain("count(distinct cleared.permission)");
  });

  it("keeps execution limited to the service role", () => {
    const source = read(fixName);

    expect(source).toContain("from public, anon, authenticated;");
    expect(source).toMatch(/grant execute on function[^;]+to service_role;/);
  });

  it("is the latest migration to define the function", () => {
    const definers = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => read(name).includes(functionName));

    expect(definers.at(-1)).toBe(fixName);
  });
});
