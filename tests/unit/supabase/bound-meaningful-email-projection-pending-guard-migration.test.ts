import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationFile =
  "20260722150000_bound_meaningful_email_projection_pending_guard.sql";
const unboundedGuardFile =
  "20260721143000_email_commercial_outcome_guards.sql";

const source = readFileSync(join(migrationsDir, migrationFile), "utf8");

// The exact definition applied live to production during the 2026-07-22
// outage (verified byte-identical via pg_get_functiondef). Any drift between
// this text and the migration means a future deploy could revert the hotfix.
const productionDefinition = `CREATE OR REPLACE FUNCTION private.opportunity_has_pending_meaningful_email(p_company_id uuid, p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.opportunity_correspondence_events event
    where event.company_id = p_company_id
      and event.opportunity_id = p_opportunity_id
      and event.is_meaningful is true
      and event.opportunity_projection_applied is false
      and event.created_at > now() - interval '60 seconds'
  );
$function$;`;

describe("bound meaningful-email projection-pending guard migration", () => {
  it("contains the production hotfix definition byte-for-byte", () => {
    expect(source).toContain(productionDefinition);
  });

  it("bounds pending projection to unprojected events younger than 60 seconds", () => {
    expect(source).toContain(
      "event.created_at > now() - interval '60 seconds'"
    );
    expect(source).toContain("event.is_meaningful is true");
    expect(source).toContain("event.opportunity_projection_applied is false");
    expect(source).toContain("event.company_id = p_company_id");
    expect(source).toContain("event.opportunity_id = p_opportunity_id");
  });

  it("keeps the definer posture, pinned search_path, and private ACL", () => {
    expect(source).toContain("STABLE SECURITY DEFINER");
    expect(source).toContain(
      "SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'"
    );
    expect(source).toMatch(
      /revoke all on function private\.opportunity_has_pending_meaningful_email\([\s\S]*?from public, anon, authenticated, service_role/i
    );
  });

  it("replaces only the guard function and nothing else", () => {
    const definitionStatements = source.match(
      /create(?: or replace)? (?:function|trigger|table|view|policy|index)/gi
    );
    expect(definitionStatements).toHaveLength(1);
    expect(source).not.toMatch(/\b(?:drop|alter)\s+(?:function|table|trigger)/i);
  });

  it("orders after the unbounded definition so replays land bounded", () => {
    const migrations = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const unboundedIndex = migrations.indexOf(unboundedGuardFile);
    const boundedIndex = migrations.indexOf(migrationFile);
    expect(unboundedIndex).toBeGreaterThan(-1);
    expect(boundedIndex).toBeGreaterThan(unboundedIndex);

    const unboundedSource = readFileSync(
      join(migrationsDir, unboundedGuardFile),
      "utf8"
    );
    // The historical migration keeps its original unbounded body; only this
    // later migration narrows it. Rewriting history would desync environments
    // that already applied 20260721143000.
    expect(unboundedSource).not.toContain("interval '60 seconds'");
  });
});
