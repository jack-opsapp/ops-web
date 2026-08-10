/**
 * The anti-drift guard for the company-data manifest (bug 241830b2).
 *
 * The account-deletion and export routes were frozen at a schema that no
 * longer exists — they addressed `estimate_line_items`, `invoice_line_items`
 * and `tasks`, none of which are real tables, and swallowed every error so the
 * lie was invisible. Both routes are now driven by one manifest. These tests
 * are what stop the manifest going stale again:
 *
 *  1. Every table the checked-in generated types say has a `company_id` MUST
 *     be classified in the manifest.
 *  2. Every manifest entry MUST exist in the generated types, except a named,
 *     documented allowlist of backend tables the types have not caught up to.
 *
 * Tests cannot reach production, so the diff is taken against
 * `src/lib/types/database.types.ts` — regenerating that file is precisely what
 * forces a newly added table to be consciously classified here.
 */

import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  COMPANY_DATA_MANIFEST,
  COMPANY_SCOPED_DATA,
  DEFINER_PURGED_TABLES,
  FK_CYCLE_BREAKERS,
  MANIFEST_VERSION,
  OUT_OF_SCOPE_TABLES,
  PARENT_SCOPED_DATA,
  TENANT_TABLE,
  UNTYPED_TABLE_ALLOWLIST,
  deletionPlan,
  exportPlan,
  manifestByTable,
  type CompanyScopedEntry,
} from "@/lib/data/company-data-manifest";
import {
  AUTH_IDENTITY_SNAPSHOT,
  IN_SCOPE_SNAPSHOT,
  STAGED_IN_SCOPE_MIGRATION_TABLES,
} from "@/lib/data/company-data-scope-snapshot";
import {
  SERVICE_ROLE_BLOCKED_TABLES,
  STAGED_SERVICE_ROLE_BLOCKED_TABLES,
  blockedPrivilegesByTable,
} from "@/lib/data/company-data-privilege-snapshot";

const ROOT = path.resolve(__dirname, "../..");
const STAGED_IN_SCOPE = new Set(STAGED_IN_SCOPE_MIGRATION_TABLES);
const STAGED_BLOCKED = new Set(STAGED_SERVICE_ROLE_BLOCKED_TABLES);

/** Table names the routes used to address that have never existed. */
const PHANTOM_TABLES = ["estimate_line_items", "invoice_line_items"];

/** Parse the `Tables:` block of the generated types (Views deliberately excluded). */
function readGeneratedTypes(): {
  tables: Set<string>;
  withCompanyId: Set<string>;
} {
  const source = readFileSync(
    path.join(ROOT, "src/lib/types/database.types.ts"),
    "utf8"
  ).split("\n");

  const start = source.indexOf("    Tables: {");
  const end = source.indexOf("    Views: {");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const tables = new Set<string>();
  const withCompanyId = new Set<string>();

  let current: string | null = null;
  let inRow = false;

  for (const line of source.slice(start, end)) {
    const opened = line.match(/^ {6}([A-Za-z0-9_]+): \{$/);
    if (opened && !current) {
      current = opened[1];
      tables.add(current);
      inRow = false;
      continue;
    }
    if (!current) continue;
    if (line === "        Row: {") {
      inRow = true;
      continue;
    }
    if (inRow && line === "        }") {
      inRow = false;
      continue;
    }
    if (inRow && /^ {10}company_id\??:/.test(line)) withCompanyId.add(current);
    if (line === "      }") {
      current = null;
      inRow = false;
    }
  }

  return { tables, withCompanyId };
}

/**
 * Route source with comments stripped. The routes document the historical bug
 * by name, which is worth keeping — the guard is about executable code.
 */
function readRouteSource(route: "delete-account" | "export"): string {
  return readFileSync(
    path.join(ROOT, `src/app/api/data/${route}/route.ts`),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Final checked-in definition after replaying the ordered migration ledger. */
function readFinalMigrationFunction(name: string): string {
  const directory = path.join(ROOT, "supabase/migrations");
  let latest = "";

  for (const file of readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    const source = readFileSync(path.join(directory, file), "utf8");
    const start = source
      .toLowerCase()
      .lastIndexOf(`create or replace function ${name.toLowerCase()}(`);
    if (start >= 0) latest = source.slice(start);
  }

  return latest;
}

describe("company data manifest — PRIMARY guard: the live in-scope snapshot", () => {
  const manifestTables = new Set(COMPANY_DATA_MANIFEST.map((e) => e.table));
  const outOfScope = new Set(OUT_OF_SCOPE_TABLES.map((e) => e.table));
  const accountedFor = new Set([...manifestTables, ...outOfScope]);

  it("accounts for every table the live schema puts inside a company", () => {
    const unaccounted = IN_SCOPE_SNAPSHOT.filter(
      (table) => !accountedFor.has(table)
    ).sort();

    expect(
      unaccounted,
      `In scope per the live schema but neither classified in the manifest nor declared in ` +
        `OUT_OF_SCOPE_TABLES. Absence is not an exclusion — give each one a strategy and an ` +
        `export decision, or an explicit reason for being out of scope: ${unaccounted.join(", ")}`
    ).toEqual([]);
  });

  it("never classifies a table that is not actually in scope", () => {
    const phantom = [...manifestTables]
      .filter(
        (table) =>
          !IN_SCOPE_SNAPSHOT.includes(table) &&
          !STAGED_IN_SCOPE.has(table) &&
          table !== TENANT_TABLE
      )
      .sort();

    expect(
      phantom,
      `Manifest classifies tables the live snapshot does not place in a company's scope. ` +
        `Either they were renamed/dropped, or the snapshot needs regenerating: ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("tracks unapplied migration tables without rewriting the live snapshot", () => {
    const migrationSql = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((entry) => entry.endsWith(".sql"))
      .sort()
      .map((entry) =>
        readFileSync(path.join(ROOT, "supabase/migrations", entry), "utf8")
      )
      .join("\n")
      .toLowerCase();

    expect(new Set(STAGED_IN_SCOPE_MIGRATION_TABLES).size).toBe(
      STAGED_IN_SCOPE_MIGRATION_TABLES.length
    );
    for (const table of STAGED_IN_SCOPE_MIGRATION_TABLES) {
      expect(IN_SCOPE_SNAPSHOT, `${table} is not live yet`).not.toContain(
        table
      );
      expect(
        manifestTables,
        `${table} must be classified before apply`
      ).toContain(table);
      expect(
        UNTYPED_TABLE_ALLOWLIST,
        `${table} must remain explicitly untyped until types are regenerated`
      ).toContain(table);
      expect(migrationSql).toContain(`create table public.${table}`);
    }
  });

  it("adds only the tenant row on top of the derived scope", () => {
    expect(manifestTables.has(TENANT_TABLE)).toBe(true);
    expect(IN_SCOPE_SNAPSHOT).not.toContain(TENANT_TABLE);
  });

  it("forces a decision on every auth-identity table the closure cannot reach", () => {
    const undeclared = AUTH_IDENTITY_SNAPSHOT.filter(
      (table) => !outOfScope.has(table)
    ).sort();

    expect(
      undeclared,
      `These hang off auth.users rather than public.users, so the company_id closure cannot ` +
        `see them — they must be explicitly declared in OUT_OF_SCOPE_TABLES: ${undeclared.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the snapshot itself plausible", () => {
    expect(IN_SCOPE_SNAPSHOT.length).toBeGreaterThan(200);
    expect(new Set(IN_SCOPE_SNAPSHOT).size).toBe(IN_SCOPE_SNAPSHOT.length);
    expect(new Set(AUTH_IDENTITY_SNAPSHOT).size).toBe(
      AUTH_IDENTITY_SNAPSHOT.length
    );
    for (const table of AUTH_IDENTITY_SNAPSHOT) {
      expect(IN_SCOPE_SNAPSHOT, `${table} cannot be both`).not.toContain(table);
    }
  });
});

/**
 * The guard that would have caught the 2026-07-30 rehearsal failure before the
 * rehearsal did.
 *
 * Classifying a table says what it IS. It says nothing about whether the role
 * the routes run as may touch it. Thirty `public` base tables withhold from
 * `service_role` at least one privilege the cascade needs — fifteen were
 * created by migrations that granted it nothing at all, and the cascade
 * returned 500 at acting-step 23 of 198 on the first of those. The other
 * fifteen are worse: they grant SELECT and withhold DELETE, so the count
 * succeeds and nothing looks wrong until that step runs. All thirty are
 * classified in this manifest.
 *
 * Every one must be routed through `public.purge_company_rows`. This asserts it
 * in both directions against the live privilege snapshot.
 */
describe("company data manifest — PRIVILEGE guard: what service_role may actually do", () => {
  const blocked = blockedPrivilegesByTable();
  const manifestTables = new Set(COMPANY_DATA_MANIFEST.map((e) => e.table));
  const outOfScope = new Set(OUT_OF_SCOPE_TABLES.map((e) => e.table));
  const definerPurged = new Set(DEFINER_PURGED_TABLES.map((e) => e.table));
  const byTable = manifestByTable();

  it("routes every table service_role cannot purge through the definer function", () => {
    const unroutable = [...manifestTables]
      .filter((table) => blocked.has(table) && !definerPurged.has(table))
      .sort();

    expect(
      unroutable,
      `service_role cannot both SELECT and DELETE these, so the cascade cannot purge them at all. ` +
        `Declare each in DEFINER_PURGED_TABLES and add it to the allowlist inside ` +
        `public.purge_company_rows, or grant the privilege: ${unroutable.join(", ")}`
    ).toEqual([]);
  });

  it("never sends a table down the definer detour it does not need", () => {
    const needless = [...definerPurged]
      .filter(
        (table) =>
          !blocked.has(table) &&
          !STAGED_IN_SCOPE.has(table) &&
          !STAGED_BLOCKED.has(table)
      )
      .sort();

    expect(
      needless,
      `service_role can SELECT and DELETE these directly, so the detour through ` +
        `purge_company_rows is dead weight hiding a normal step. Remove them from ` +
        `DEFINER_PURGED_TABLES (and from the function's allowlist): ${needless.join(", ")}`
    ).toEqual([]);
  });

  it("declares only tables the manifest classifies", () => {
    const unknown = [...definerPurged]
      .filter((table) => !manifestTables.has(table))
      .sort();

    expect(
      unknown,
      `DEFINER_PURGED_TABLES names tables the manifest does not classify — the cascade ` +
        `would never call them: ${unknown.join(", ")}`
    ).toEqual([]);
  });

  it("keeps every detour inside what purge_company_rows can actually do", () => {
    // The function purges by `company_id` and hard-deletes. A soft-deletable
    // entry sent down this path would be destroyed instead of tombstoned, and a
    // parent-scoped one would be purged by a column it does not filter on.
    for (const { table } of DEFINER_PURGED_TABLES) {
      const entry = byTable.get(table);
      expect(entry, `${table} is not classified`).toBeDefined();
      expect(entry!.scope, `${table} must be company-scoped`).toBe("company");
      expect(
        (entry as CompanyScopedEntry).companyColumn,
        `${table} must be scoped by company_id`
      ).toBe("company_id");
      expect(
        entry!.deleteStrategy,
        `${table} would be hard-deleted by the function regardless of this strategy`
      ).toBe("hard");
    }
  });

  it("gives every detour a substantive reason and names it once", () => {
    for (const entry of DEFINER_PURGED_TABLES) {
      expect(entry.reason?.trim().length, `${entry.table}`).toBeGreaterThan(40);
    }
    const names = DEFINER_PURGED_TABLES.map((e) => e.table);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every exported table readable", () => {
    const unreadable = exportPlan()
      .map((e) => e.table)
      .filter((table) => blocked.get(table)?.select === false)
      .sort();

    expect(
      unreadable,
      `The export route reads these and service_role has no SELECT — the download would ` +
        `500 instead of producing a file: ${unreadable.join(", ")}`
    ).toEqual([]);
  });

  it("keeps every soft-deleted table updatable", () => {
    const untombstonable = deletionPlan()
      .filter(
        (e) =>
          e.deleteStrategy === "soft" && blocked.get(e.table)?.update === false
      )
      .map((e) => e.table)
      .sort();

    expect(
      untombstonable,
      `These are tombstoned with an UPDATE that service_role may not perform, and the ` +
        `definer function hard-deletes rather than tombstones, so it is not the remedy: ` +
        `${untombstonable.join(", ")}`
    ).toEqual([]);
  });

  it("keeps both cycle breakers writable", () => {
    // The breakers null a column with a direct UPDATE before either side of the
    // cycle is purged — the definer function cannot stand in for that.
    for (const breaker of FK_CYCLE_BREAKERS) {
      const privileges = blocked.get(breaker.table);
      expect(
        !privileges || (privileges.select && privileges.update),
        `${breaker.table} cannot be updated by service_role, so its foreign-key cycle ` +
          `can never be broken and no delete order can satisfy it`
      ).toBe(true);
    }
  });

  it("keeps every parent chain readable", () => {
    // Parent-scoped children are found by SELECTing their parents' ids first.
    for (const entry of PARENT_SCOPED_DATA) {
      for (const table of [entry.table, entry.parentTable]) {
        expect(
          blocked.get(table)?.select === false,
          `${entry.table} is resolved through ${table}, which service_role cannot read`
        ).toBe(false);
      }
    }
  });

  it("leaves no blocked company-data table unclassified", () => {
    const unclassified = SERVICE_ROLE_BLOCKED_TABLES.map((p) => p.table)
      .filter((table) => !manifestTables.has(table) && !outOfScope.has(table))
      .sort();

    expect(
      unclassified,
      `Blocked tables that are neither classified nor declared out of scope: ${unclassified.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the function's SQL allowlist and the TypeScript set identical", () => {
    // The original defect in miniature: the deployed function allowlisted
    // fifteen tables while the route needed thirty, and nothing said so.
    // Either side drifting silently reintroduces it — a table declared here but
    // absent from the allowlist is refused at runtime with 42501, and one in the
    // allowlist but not here is simply never called.
    const sql = readFinalMigrationFunction("public.purge_company_rows");

    const array = sql.match(
      /v_allowed constant text\[\] := array\[([\s\S]*?)\];/i
    );
    expect(
      array,
      "could not find the allowlist in the migration"
    ).not.toBeNull();

    const allowlisted = [...array![1].matchAll(/'([a-z0-9_]+)'/g)]
      .map((m) => m[1])
      .sort();

    expect(
      allowlisted,
      `public.purge_company_rows' allowlist and DEFINER_PURGED_TABLES must name the same tables`
    ).toEqual([...definerPurged].sort());
  });

  it("tracks staged privilege revocations until the live snapshot is regenerated", () => {
    const migrationSql = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((entry) => entry.endsWith(".sql"))
      .sort()
      .map((entry) =>
        readFileSync(path.join(ROOT, "supabase/migrations", entry), "utf8")
      )
      .join("\n")
      .toLowerCase();

    expect(STAGED_SERVICE_ROLE_BLOCKED_TABLES).toEqual([
      "agent_control_plane_tenant_roots",
    ]);
    expect(DEFINER_PURGED_TABLES.map((entry) => entry.table)).toContain(
      "agent_control_plane_tenant_roots"
    );
    expect(migrationSql.replace(/\s+/g, " ")).toContain(
      "revoke all on table public.agent_control_plane_tenant_roots from public, anon, authenticated, service_role"
    );
  });

  it("keeps the privilege snapshot itself plausible", () => {
    const names = SERVICE_ROLE_BLOCKED_TABLES.map((p) => p.table);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    for (const privileges of SERVICE_ROLE_BLOCKED_TABLES) {
      expect(
        privileges.select && privileges.delete,
        `${privileges.table} is fully available — it does not belong in the blocked snapshot`
      ).toBe(false);
    }
  });
});

describe("company data purge — immutable event ledger exception", () => {
  const migrationPath = path.join(
    ROOT,
    "supabase/migrations/20260731170226_account_purge_immutable_event_exception.sql"
  );

  it("permits only the exact tenant's DELETE through the narrow purge helper", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).toMatch(
      /set_config\(\s*'ops\.company_data_purge_company_id',\s*p_company_id::text,\s*true\s*\)/
    );
    expect(sql).toContain(
      "current_setting('ops.company_data_purge_company_id', true)"
    );
    expect(sql).toContain("old.company_id::text");
    expect(sql).toContain("current_setting('request.jwt.claims', true)");
    expect(sql).toContain("tg_op = 'delete'");
    expect(sql).toContain("return old");

    for (const functionName of [
      "private.reject_task_mutation_event_change",
      "private.project_note_mention_events_are_immutable",
      "private.guard_opportunity_conversion_notification_delivery",
    ]) {
      expect(sql, functionName).toContain(
        `create or replace function ${functionName}()`
      );
    }
  });

  it("does not disable triggers or relax immutable UPDATE protection", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();

    expect(sql).not.toContain("session_replication_role");
    expect(sql).not.toMatch(/disable\s+trigger/);
    expect(sql).toContain(
      "raise exception 'task_mutation_events_are_immutable'"
    );
    expect(sql).toContain(
      "raise exception 'project note mention events are immutable'"
    );
    expect(sql).toContain(
      "raise exception 'conversion notification deliveries are immutable'"
    );
  });
});

describe("company data purge — side-effect delivery ordering", () => {
  it("purges permission deliveries after every authority mutation can enqueue them", () => {
    const tables = deletionPlan().map((entry) => entry.table);
    const deliveryIndex = tables.indexOf("user_permission_change_deliveries");

    expect(deliveryIndex).toBeGreaterThan(
      tables.indexOf("user_permission_overrides")
    );
    expect(deliveryIndex).toBeGreaterThan(tables.indexOf("users"));
  });
});

describe("company data manifest — out-of-scope registry", () => {
  const generated = readGeneratedTypes();
  const manifestTables = new Set(COMPANY_DATA_MANIFEST.map((e) => e.table));

  it("gives every exclusion a substantive reason", () => {
    for (const entry of OUT_OF_SCOPE_TABLES) {
      expect(entry.reason?.trim().length, `${entry.table}`).toBeGreaterThan(40);
    }
  });

  it("never excludes and classifies the same table", () => {
    const both = OUT_OF_SCOPE_TABLES.filter((e) =>
      manifestTables.has(e.table)
    ).map((e) => e.table);
    expect(
      both,
      `declared out of scope AND classified: ${both.join(", ")}`
    ).toEqual([]);
  });

  it("names only real tables, so a typo cannot be parked here", () => {
    const unknown = OUT_OF_SCOPE_TABLES.filter(
      (e) => !generated.tables.has(e.table)
    ).map((e) => e.table);
    expect(
      unknown,
      `out-of-scope entries absent from database.types.ts: ${unknown.join(", ")}`
    ).toEqual([]);
  });

  it("has no duplicate entries", () => {
    const names = OUT_OF_SCOPE_TABLES.map((e) => e.table);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("company data manifest — SECONDARY guard: the generated types", () => {
  const generated = readGeneratedTypes();
  const manifestTables = new Set(COMPANY_DATA_MANIFEST.map((e) => e.table));

  it("classifies every generated table that carries a company_id", () => {
    const missing = [...generated.withCompanyId]
      .filter((table) => !manifestTables.has(table))
      .sort();

    expect(
      missing,
      `Tables carry company_id in database.types.ts but are unclassified in the manifest. ` +
        `Add an entry (table, companyColumn, deleteStrategy, export) for each: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("only names tables the generated schema knows, or an explicitly allowlisted one", () => {
    const unknown = [...manifestTables]
      .filter(
        (table) =>
          !generated.tables.has(table) &&
          !UNTYPED_TABLE_ALLOWLIST.includes(table)
      )
      .sort();

    expect(
      unknown,
      `Manifest names tables absent from database.types.ts. Either the table was renamed/dropped, ` +
        `or the types need regenerating, or the table belongs on UNTYPED_TABLE_ALLOWLIST: ${unknown.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the untyped allowlist honest — no stale entries", () => {
    const stale = UNTYPED_TABLE_ALLOWLIST.filter(
      (table) => generated.tables.has(table) || !manifestTables.has(table)
    ).sort();

    expect(
      stale,
      `Allowlisted tables are now present in database.types.ts (or gone from the manifest) — remove them ` +
        `from UNTYPED_TABLE_ALLOWLIST: ${stale.join(", ")}`
    ).toEqual([]);
  });

  it("declares a manifest version and the tenant table", () => {
    expect(MANIFEST_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TENANT_TABLE).toBe("companies");
  });
});

describe("company data manifest — regression guard on the frozen schema", () => {
  it("never names a table that does not exist", () => {
    for (const phantom of [...PHANTOM_TABLES, "tasks"]) {
      expect(
        COMPANY_DATA_MANIFEST.some((e) => e.table === phantom),
        `${phantom} is not a real table`
      ).toBe(false);
    }
  });

  it("keeps the phantom table names out of both route sources", () => {
    for (const route of ["delete-account", "export"] as const) {
      const source = readRouteSource(route);
      for (const phantom of PHANTOM_TABLES) {
        expect(source, `${route} still references ${phantom}`).not.toContain(
          phantom
        );
      }
      // A bare `tasks` table reference — the real table is project_tasks.
      expect(source, `${route} still addresses a bare tasks table`).not.toMatch(
        /from\(\s*["'`]tasks["'`]\s*\)/
      );
    }
  });

  it("routes address tables only through the manifest", () => {
    for (const route of ["delete-account", "export"] as const) {
      const source = readRouteSource(route);
      const literals = [
        ...source.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]/g),
      ]
        .map((m) => m[1])
        .filter((table) => table !== "companies" && table !== "users");
      expect(
        literals,
        `${route} hardcodes table names instead of iterating the manifest: ${literals.join(", ")}`
      ).toEqual([]);
    }
  });

  it("uses the real names for the tables the old routes got wrong", () => {
    const byTable = manifestByTable();
    expect(byTable.get("project_tasks")?.deleteStrategy).toBe("soft");
    expect(byTable.get("line_items")?.deleteStrategy).toBe("hard");
    expect(byTable.get("project_tasks")?.export).toBe(true);
    expect(byTable.get("line_items")?.export).toBe(true);
  });
});

describe("company data manifest — coverage of the tables the old cascade missed", () => {
  const byTable = manifestByTable();

  const expected: Array<[string, "soft" | "hard" | "retain", boolean]> = [
    ["job_conversations", "hard", true],
    ["job_conversation_anchors", "hard", true],
    ["job_conversation_turns", "hard", true],
    ["job_memory_versions", "hard", true],
    ["job_memory_version_evidence", "hard", true],
    ["job_conversation_redaction_events", "hard", true],
    ["expenses", "soft", true],
    ["project_photos", "soft", true],
    ["project_notes", "soft", true],
    ["site_visits", "soft", true],
    ["site_visit_artifacts", "soft", true],
    ["site_visit_checklist_answers", "soft", true],
    ["site_visit_identity_drafts", "soft", true],
    ["site_visit_types", "soft", true],
    ["sub_clients", "soft", true],
    ["follow_ups", "hard", true],
    ["activities", "hard", true],
    ["calendar_user_events", "soft", true],
    ["deck_designs", "soft", true],
    ["project_tasks", "soft", true],
    ["line_items", "hard", true],
  ];

  it.each(expected)(
    "%s is classified (%s, exported=%s)",
    (table, strategy, exported) => {
      const entry = byTable.get(table);
      expect(entry, `${table} is missing from the manifest`).toBeDefined();
      expect(entry!.deleteStrategy).toBe(strategy);
      expect(entry!.export).toBe(exported);
    }
  );

  it("keeps the previously-missed tables in the export plan", () => {
    const exported = new Set(exportPlan().map((e) => e.table));
    for (const [table, , wanted] of expected) {
      if (wanted)
        expect(exported.has(table), `${table} not exported`).toBe(true);
    }
  });

  it("excludes internal machinery from the export plan", () => {
    const exported = new Set(exportPlan().map((e) => e.table));
    for (const machinery of [
      "email_oauth_states",
      "email_connections",
      "portal_tokens",
      "accounting_sync_queue",
      "analytics_events",
      "opportunity_views",
      "qbo_staging_invoices",
      "payment_reminder_generation_claims",
    ]) {
      expect(exported.has(machinery), `${machinery} must not be exported`).toBe(
        false
      );
    }
  });

  it("purges normalized visit children before their parent", () => {
    const tables = deletionPlan().map((entry) => entry.table);
    const parentIndex = tables.indexOf("site_visits");
    expect(parentIndex).toBeGreaterThan(-1);

    for (const child of [
      "site_visit_artifacts",
      "site_visit_checklist_answers",
      "site_visit_identity_drafts",
    ]) {
      const entry = byTable.get(child);
      expect(entry).toMatchObject({
        scope: "company",
        companyColumn: "company_id",
        companyColumnType: "text",
        softDeletable: true,
        deleteStrategy: "soft",
        export: true,
      });
      const childIndex = tables.indexOf(child);
      expect(childIndex, `${child} must be in the purge plan`).toBeGreaterThan(
        -1
      );
      expect(childIndex, `${child} must precede site_visits`).toBeLessThan(
        parentIndex
      );
    }
  });
});

describe("company data manifest — strategy integrity", () => {
  const byTable = manifestByTable();

  it("has one entry per table", () => {
    expect(manifestByTable().size).toBe(COMPANY_DATA_MANIFEST.length);
  });

  it("splits cleanly into company-scoped and parent-scoped entries", () => {
    expect(COMPANY_DATA_MANIFEST.length).toBe(
      COMPANY_SCOPED_DATA.length + PARENT_SCOPED_DATA.length
    );
    expect(COMPANY_SCOPED_DATA.every((e) => e.scope === "company")).toBe(true);
    expect(PARENT_SCOPED_DATA.every((e) => e.scope === "parent")).toBe(true);
  });

  it("never applies a deleted_at filter to a table without the column", () => {
    // Tables verified against prod (2026-07-29) as having NO deleted_at column.
    // A "soft" strategy on any of them is the latent bug this guards.
    for (const table of [
      "line_items",
      "payments",
      "follow_ups",
      "activities",
      "notifications",
      "tax_rates",
      "roles",
      "email_threads",
      "stage_transitions",
      "payment_milestones",
      "role_permissions",
      "user_roles",
    ]) {
      const entry = byTable.get(table);
      expect(entry, `${table} missing`).toBeDefined();
      expect(
        entry!.deleteStrategy,
        `${table} has no deleted_at column — it cannot be soft-deleted`
      ).not.toBe("soft");
      expect(entry!.softDeletable, `${table} has no deleted_at column`).toBe(
        false
      );
    }
  });

  it("marks every soft-delete entry as soft-deletable", () => {
    for (const entry of COMPANY_DATA_MANIFEST) {
      if (entry.deleteStrategy === "soft") {
        expect(entry.softDeletable, `${entry.table}`).toBe(true);
      }
    }
  });

  it("requires a reason for every retained or non-exported table", () => {
    const unexplained = COMPANY_DATA_MANIFEST.filter(
      (e) =>
        (e.deleteStrategy === "retain" || !e.export) &&
        (!e.reason || e.reason.trim().length < 10)
    ).map((e) => e.table);

    expect(
      unexplained,
      `retain / export:false entries must carry a reason: ${unexplained.join(", ")}`
    ).toEqual([]);
  });

  it("retains exactly the deliberated set, and nothing else", () => {
    // Pinned rather than capped: adding a retained table means a customer's
    // data survives account closure, which must be a reviewed decision, not a
    // number that happens to fit under a limit.
    const retained = COMPANY_DATA_MANIFEST.filter(
      (e) => e.deleteStrategy === "retain"
    );

    expect(retained.map((e) => e.table).sort()).toEqual(
      [
        // Referential integrity — surviving tombstones still point at these.
        "expense_batches",
        "expense_categories",
        // Financial and audit obligations that outlive the account.
        "audit_log",
        "billing_events",
        // OPS's own SPEC sales ledger, enumerated in full.
        "spec_acceptance_events",
        "spec_blocked_buyers",
        "spec_change_orders",
        "spec_communications",
        "spec_email_outbox",
        "spec_feature_acceptance",
        "spec_internal_notes",
        "spec_module_entitlements",
        "spec_owner_approval_requests",
        "spec_payments",
        "spec_projects",
        "spec_referrals",
        "spec_refund_requests",
        "spec_retainers",
        "spec_satisfaction_ratings",
        "spec_scope_documents",
        "spec_support_tickets",
      ].sort()
    );

    for (const entry of retained) {
      expect(entry.reason, `${entry.table}`).toBeTruthy();
    }
  });

  it("enumerates the whole SPEC family rather than implying its children", () => {
    // The family used to stop at the nine tables that FK `users` directly, with
    // the deeper ones only mentioned in prose — exactly the absence-as-exclusion
    // pattern this file exists to prevent.
    const byTable = manifestByTable();
    for (const table of [
      "spec_change_orders",
      "spec_payments",
      "spec_referrals",
      "spec_retainers",
      "spec_satisfaction_ratings",
      "spec_scope_documents",
      "spec_support_tickets",
    ]) {
      const entry = byTable.get(table);
      expect(entry, `${table} must be declared, not implied`).toBeDefined();
      expect(entry!.deleteStrategy).toBe("retain");
      expect(entry!.export).toBe(false);
    }
  });

  it("scopes every company entry by a real tenant column", () => {
    for (const entry of COMPANY_SCOPED_DATA) {
      expect(entry.companyColumn, entry.table).toBeTruthy();
      expect(["uuid", "text"]).toContain(entry.companyColumnType);
      if (entry.table !== TENANT_TABLE) {
        expect(entry.companyColumn, entry.table).toBe("company_id");
      }
    }
    const tenant = COMPANY_SCOPED_DATA.find((e) => e.table === TENANT_TABLE);
    expect(tenant?.companyColumn).toBe("id");
  });

  it("points every parent-scoped entry at a table that is itself in the manifest", () => {
    const known = new Set(COMPANY_DATA_MANIFEST.map((e) => e.table));
    for (const entry of PARENT_SCOPED_DATA) {
      expect(entry.parentColumn, entry.table).toBeTruthy();
      expect(
        known.has(entry.parentTable),
        `${entry.table} hangs off ${entry.parentTable}, which is not classified`
      ).toBe(true);
    }
  });
});

describe("company data manifest — deletion ordering", () => {
  const order = new Map(
    COMPANY_SCOPED_DATA.map((entry, index) => [entry.table, index])
  );

  function before(child: string, parent: string) {
    expect(order.has(child), `${child} missing`).toBe(true);
    expect(order.has(parent), `${parent} missing`).toBe(true);
    expect(
      order.get(child)!,
      `${child} must be deleted before ${parent} (FK restrict)`
    ).toBeLessThan(order.get(parent)!);
  }

  it("deletes FK children before their parents", () => {
    // Verified against prod pg_constraint (2026-07-29): blocking (NO ACTION /
    // RESTRICT) foreign keys between hard-deleted, company-scoped tables.
    before("email_outbound_edit_promotions", "email_outbound_learning_queue");
    before("email_outbound_learning_queue", "email_send_intents");
    before("email_send_intents", "pending_auto_sends");
    before("email_send_intents", "email_connections");
    before("approved_action_email_intents", "activities");
    before("approved_action_email_intents", "agent_actions");
    before(
      "opportunity_assignment_deliveries",
      "opportunity_assignment_events"
    );
    before(
      "opportunity_assignment_events",
      "opportunity_assignment_suggestions"
    );
    before("email_conversion_photo_objects", "email_conversion_photo_jobs");
    before("email_conversion_photo_jobs", "email_attachments");
    before("email_conversion_photo_jobs", "opportunity_conversion_events");
    before("email_attachments", "email_connections");
    before("activities", "email_connections");
    before("agent_knowledge_graph", "graph_entities");
    before("agent_memories", "graph_entities");
    before("line_items", "tax_rates");
    before("portal_sessions", "portal_tokens");
    before("task_schedule_automation_outbox", "task_mutation_events");
    before("email_import_provider_operations", "gmail_scan_jobs");
    before("job_memory_version_evidence", "job_memory_versions");
    before("job_memory_versions", "job_conversation_turns");
    before("job_conversation_redaction_events", "job_conversation_turns");
    before("job_conversation_turns", "job_conversations");
    before("job_conversation_anchors", "job_conversations");
    before("job_conversation_turns", "activities");
    before("job_conversation_turns", "opportunity_correspondence_events");
    before("job_conversation_turns", "email_connections");
  });

  it("tombstones the company row last", () => {
    expect(COMPANY_SCOPED_DATA[COMPANY_SCOPED_DATA.length - 1].table).toBe(
      TENANT_TABLE
    );
  });

  it("breaks the two mutual foreign-key cycles before deleting either side", () => {
    expect(FK_CYCLE_BREAKERS).toEqual([
      {
        table: "pending_auto_sends",
        column: "send_intent_id",
        companyColumn: "company_id",
      },
      {
        table: "opportunity_assignment_suggestions",
        column: "resolution_event_id",
        companyColumn: "company_id",
      },
    ]);
  });
});
