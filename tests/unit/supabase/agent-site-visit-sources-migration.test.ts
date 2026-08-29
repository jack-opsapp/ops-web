import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260828211556_agent_site_visit_sources.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/site-visits/sql/agent_site_visit_sources.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const ARTIFACT_SOURCE_MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260827233630_agent_artifact_sources.sql"
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

function statement(sql: string, marker: string) {
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  const end = sql.indexOf(";", start);
  return end < 0 ? "" : sql.slice(start, end + 1);
}

const BODY_EXACT = read(BODY_PATH);
const MIGRATION_EXACT = read(MIGRATION_PATH);
const ARTIFACT_SOURCE_MIGRATION_EXACT = read(ARTIFACT_SOURCE_MIGRATION_PATH);
const SQL = BODY_EXACT.toLowerCase();
const COMPACT = compact(BODY_EXACT);
const RESERVED_MIGRATIONS = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith("_agent_site_visit_sources.sql"));

describe("P2 site-visit source-fence SQL body", () => {
  it("is the single official generated reservation and byte-matches its guarded sidecar", () => {
    expect(RESERVED_MIGRATIONS).toEqual([MIGRATION_NAME]);
    expect(BODY_EXACT).not.toBe("");
    expect(MIGRATION_EXACT).toBe(BODY_EXACT);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 12 canonical site-visit source body");
    expect(COMPACT).toContain("set local timezone = 'utc'");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("requires only the checked-in site-visit revision kernel and exact source graph", () => {
    for (const prerequisite of [
      "private.agent_read_domain_revisions",
      "private.bump_agent_read_domain_revision()",
      "public.site_visits",
      "public.site_visit_checklist_answers",
      "public.site_visit_artifacts",
      "public.opportunities",
      "public.clients",
      "public.projects",
      "public.project_tasks",
    ]) {
      expect(SQL).toContain(prerequisite);
    }
  });

  it("advances site_visits for visit data and every linked authority dependency", () => {
    for (const table of [
      "site_visits",
      "site_visit_checklist_answers",
      "site_visit_artifacts",
      "opportunities",
      "clients",
      "projects",
      "project_tasks",
    ]) {
      expect(COMPACT).toContain(
        `create trigger ${table}_bump_agent_site_visit_revision after insert or update or delete on public.${table}`
      );
      expect(COMPACT).toMatch(
        new RegExp(
          `on public\\.${table} for each row execute function private\\.bump_agent_read_domain_revision\\(\\s*'site_visits',\\s*'company_id'\\s*\\)`
        )
      );
    }
    expect(
      COMPACT.match(
        /execute function private\.bump_agent_read_domain_revision\(\s*'site_visits',\s*'company_id'\s*\)/g
      )
    ).toHaveLength(7);
    expect(COMPACT).not.toContain("on public.site_visit_identity_drafts");
  });

  it("creates the four exact active keyset and child-source indexes", () => {
    expect(COMPACT).toContain(
      "pg_catalog.date_bin( interval '1 millisecond', booked_at, timestamptz '2000-01-01 00:00:00+00' )"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_site_visits_agent_booked_order_v1 on public.site_visits ( company_id, pg_catalog.date_bin( interval '1 millisecond', booked_at, timestamptz '2000-01-01 00:00:00+00' ), id ) where deleted_at is null and booked_at is not null"
    );
    expect(COMPACT).toContain(
      "create index if not exists idx_site_visits_agent_history_order_v1 on public.site_visits ( company_id, pg_catalog.date_bin( interval '1 millisecond', created_at, timestamptz '2000-01-01 00:00:00+00' ) desc, id desc ) where deleted_at is null and created_at is not null"
    );
    expect(COMPACT).toMatch(
      /create index if not exists idx_site_visit_checklist_answers_agent_context_v1 on public\.site_visit_checklist_answers \(\s*company_id, site_visit_id, sort_order, id\s*\) where deleted_at is null/
    );
    expect(COMPACT).toMatch(
      /create index if not exists idx_site_visit_artifacts_agent_context_v1 on public\.site_visit_artifacts \(\s*pg_catalog\.lower\(company_id\), site_visit_id, captured_at, id\s*\) where deleted_at is null/
    );
    expect(COMPACT.match(/create (?:unique )?index /g)).toHaveLength(4);
  });

  it("replays Task 10's shared artifact index byte-for-byte", () => {
    const marker =
      "create index if not exists idx_site_visit_artifacts_agent_context_v1";
    const task10Definition = statement(ARTIFACT_SOURCE_MIGRATION_EXACT, marker);
    const task12Definition = statement(BODY_EXACT, marker);

    expect(task10Definition).not.toBe("");
    expect(task12Definition).toBe(task10Definition);
  });

  it("catalog-audits every trigger and index without widening private execution", () => {
    expect(COMPACT).toContain("pg_catalog.pg_trigger");
    expect(COMPACT).toContain("pg_catalog.pg_index");
    expect(COMPACT).toContain("pg_catalog.pg_get_indexdef(");
    expect(COMPACT).toContain(
      "index_row.indoption::text = v_expected.index_options"
    );
    expect(COMPACT).toContain("'0 0 0'");
    expect(COMPACT).toContain("'0 3 3'");
    expect(COMPACT).toContain("'0 0 0 0'");
    expect(COMPACT).toContain("pg_catalog.encode(trigger_row.tgargs");
    expect(COMPACT).toContain("agent_site_visit_source_trigger_invalid");
    expect(COMPACT).toContain("agent_site_visit_index_shape_failed");
    expect(COMPACT).not.toContain("agent_p2_site_visit_canonical_timestamp");
    expect(COMPACT).not.toContain("grant execute");
    expect(COMPACT).not.toContain("grant select");
    expect(COMPACT).not.toContain("grant all");
  });

  it("does not mutate the frozen v6/v7 revision or capability surfaces", () => {
    for (const frozenSurface of [
      "agent_operational_read_revisions",
      "agent_job_history_revisions",
      "capability_manifest",
      "mcp_exposure_catalog",
      "create or replace function public.",
    ]) {
      expect(COMPACT).not.toContain(frozenSurface);
    }
  });
});
