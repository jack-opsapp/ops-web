import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829011311_agent_deck_design_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/deck-design/sql/agent_deck_design_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-deck-design-geometry-runtime.sql"
);
const REPLAY_RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-deck-design-geometry-replay-runtime.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

const BODY_EXACT = read(BODY_PATH);
const MIGRATION_EXACT = read(MIGRATION_PATH);
const SQL = BODY_EXACT.toLowerCase();
const COMPACT = compact(BODY_EXACT);
const REVISION_FUNCTION = compact(
  definition(SQL, "private.bump_agent_deck_design_source_revisions")
);
const INTEGRITY_FUNCTION = compact(
  definition(SQL, "private.enforce_agent_deck_bridge_company_integrity")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY_RUNTIME = compact(read(REPLAY_RUNTIME_PATH));
const RESERVED_MIGRATIONS = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_deck_design_sources.sql"));

describe("P2 deck-design source-fence SQL body", () => {
  it("is the single CLI-generated reservation and byte-matches its guarded sidecar", () => {
    expect(RESERVED_MIGRATIONS).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    expect(MIGRATION_EXACT).toBe(BODY_EXACT);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 13 canonical deck-design source body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("installs one exact active bridge lookup index and audits its physical shape", () => {
    expect(COMPACT).toContain(
      "create index if not exists idx_site_visit_artifacts_agent_deck_bridge_v1 on public.site_visit_artifacts ( pg_catalog.lower(company_id), site_visit_id, deck_design_id, id ) where deleted_at is null and kind = 'deck_design' and source = 'deck_builder' and deck_design_id is not null"
    );
    expect(COMPACT.match(/create (?:unique )?index /g)).toHaveLength(1);
    expect(COMPACT).toContain("pg_catalog.pg_index");
    expect(COMPACT).toContain("pg_catalog.pg_get_indexdef(");
    expect(COMPACT).toContain("agent_deck_design_index_shape_failed");
  });

  it("rejects every cross-company deck bridge on both write paths but permits converted provenance", () => {
    expect(INTEGRITY_FUNCTION).not.toBe("");
    expect(INTEGRITY_FUNCTION).toContain("security definer");
    expect(INTEGRITY_FUNCTION).toContain("set search_path = ''");
    expect(INTEGRITY_FUNCTION).toContain("public.site_visit_artifacts");
    expect(INTEGRITY_FUNCTION).toContain("public.deck_designs");
    expect(INTEGRITY_FUNCTION).toContain(
      "agent_deck_bridge_company_integrity_violation"
    );
    expect(COMPACT).toContain(
      "create constraint trigger site_visit_artifacts_enforce_agent_deck_bridge_company"
    );
    expect(COMPACT).toContain(
      "create constraint trigger deck_designs_enforce_agent_deck_bridge_company"
    );
    expect(INTEGRITY_FUNCTION).not.toContain("opportunity_id =");
    expect(INTEGRITY_FUNCTION).not.toContain("project_id =");
  });

  it("advances the literal deck, bridge, and visit field matrix for distinct old and new tenants", () => {
    expect(REVISION_FUNCTION).not.toBe("");
    expect(REVISION_FUNCTION).toContain("security definer");
    expect(REVISION_FUNCTION).toContain("set search_path = ''");
    expect(REVISION_FUNCTION).toContain(
      "private.advance_agent_read_domain_revisions("
    );
    for (const domain of ["'artifacts'", "'deck_designs'", "'site_visits'"]) {
      expect(REVISION_FUNCTION).toContain(domain);
    }
    for (const field of [
      "company_id",
      "project_id",
      "opportunity_id",
      "title",
      "drawing_data",
      "version",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) {
      expect(REVISION_FUNCTION).toContain(`'${field}'`);
    }
    for (const field of [
      "site_visit_id",
      "deck_design_id",
      "kind",
      "source",
      "captured_at",
      "included_in_project_review",
    ]) {
      expect(REVISION_FUNCTION).toContain(`'${field}'`);
    }
    expect(COMPACT).toContain(
      "create trigger deck_designs_bump_agent_deck_design_revisions"
    );
    expect(COMPACT).toContain(
      "create trigger site_visit_artifacts_bump_agent_deck_design_revisions"
    );
    expect(COMPACT).toContain(
      "create trigger site_visits_bump_agent_deck_design_revisions"
    );
    expect(COMPACT).toContain("pg_catalog.pg_trigger");
    expect(COMPACT).toContain("agent_deck_design_source_trigger_invalid");
    expect(COMPACT).toContain("do $canonical_acl$");
    expect(COMPACT).toContain("pg_catalog.aclexplode(");
    expect(REVISION_FUNCTION).toContain(
      "into v_deck_changed from pg_catalog.unnest(array[ 'company_id', 'project_id', 'opportunity_id', 'title', 'drawing_data', 'version', 'created_at', 'updated_at', 'deleted_at' ]::text[])"
    );
    expect(REVISION_FUNCTION).toContain(
      "into v_deck_changed from pg_catalog.unnest(array[ 'company_id', 'site_visit_id', 'deck_design_id', 'opportunity_id', 'kind', 'source', 'captured_at', 'included_in_project_review', 'updated_at', 'deleted_at' ]::text[])"
    );
    expect(REVISION_FUNCTION).toContain(
      "into v_artifact_changed from pg_catalog.unnest(array[ 'company_id', 'id', 'opportunity_id', 'project_id', 'project_ref', 'client_id', 'client_ref', 'created_by', 'assignee_ids', 'deleted_at' ]::text[])"
    );
  });

  it("leaves frozen v6/v7 revision and capability surfaces untouched", () => {
    for (const frozenSurface of [
      "update private.agent_operational_read_revisions",
      "insert into private.agent_operational_read_revisions",
      "agent_job_history_revisions",
      "capability_manifest",
      "mcp_exposure_catalog",
      "create or replace function public.",
    ]) {
      expect(COMPACT).not.toContain(frozenSurface);
    }
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
  });

  it("ships executable rollback-only PG17 coverage for integrity, fan-out, ordinary writers, and hostile plans", () => {
    expect(RUNTIME.startsWith("begin;")).toBe(true);
    expect(RUNTIME.endsWith("rollback;")).toBe(true);
    for (const proof of [
      "cross-company artifact link accepted",
      "cross-company design retenant accepted",
      "converted provenance rejected",
      "deck field matrix incomplete",
      "bridge field matrix incomplete",
      "site visit field matrix incomplete",
      "irrelevant column advanced revision",
      "legacy cursor revision changed",
      "ordinary writer dml failed",
      "deck bridge lookup plan did not use index",
      "deck bridge lookup plan exceeded 501 rows",
    ]) {
      expect(RUNTIME).toContain(proof);
    }
    expect(REPLAY_RUNTIME.startsWith("begin;")).toBe(true);
    expect(REPLAY_RUNTIME.endsWith("rollback;")).toBe(true);
    expect(REPLAY_RUNTIME).toContain("pg_monitor with grant option");
    expect(REPLAY_RUNTIME).toContain("migration replay acl mismatch");
  });
});
