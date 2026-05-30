import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mergeMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260529170000_lead_lifecycle_p5_merge_disposition.sql"
);
const lifecycleExtPath = path.join(
  process.cwd(),
  "supabase/migrations/20260529170100_lead_lifecycle_p5_lifecycle_disposition_extension.sql"
);

function mergeSql(): string {
  return readFileSync(mergeMigrationPath, "utf8");
}
function lifecycleSql(): string {
  return readFileSync(lifecycleExtPath, "utf8");
}

// Slice the SQL of a single plpgsql function body so coverage assertions are
// scoped to the correct RPC (the opportunity RPC must not satisfy a client FK
// just because the string appears elsewhere in the file).
function functionBody(sql: string, fnName: string): string {
  const start = sql.indexOf(`create or replace function ${fnName}`);
  expect(start, `function ${fnName} not found`).toBeGreaterThanOrEqual(0);
  // End at the next `create or replace function` after the start, or EOF.
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

// ─────────────────────────────────────────────────────────────────────────────
// The AUTHORITATIVE foreign-key graph (design §1, verified live 2026-05-29).
// A merge that aims for zero orphans MUST re-point (or de-dupe-then-re-point,
// or revoke for auth tables) every entry below. These tables drive the
// no-orphan coverage test: if a new FK to opportunities/clients is added and
// the RPC does not handle it, the table-driven test fails.
// ─────────────────────────────────────────────────────────────────────────────

// kind: "repoint" — a plain `update <table> set <fk> = winner` must exist.
//       "dedupe"  — a delete-dupes + re-point pair must exist.
//       "revoke"  — auth artifact; must be revoked/deleted, not re-pointed.
// kind: "repoint"   — plain re-point.
//       "dedupe"    — delete-dupes + re-point.
//       "supersede" — supersede-then-re-point (no delete; e.g. open template draft).
//       "revoke"    — auth artifact; revoke/delete, not re-point.
type Coverage = {
  table: string;
  column: string;
  kind: "repoint" | "dedupe" | "supersede" | "revoke";
};

const OPPORTUNITY_FK_GRAPH: Coverage[] = [
  { table: "activities", column: "opportunity_id", kind: "repoint" },
  { table: "follow_ups", column: "opportunity_id", kind: "repoint" },
  { table: "stage_transitions", column: "opportunity_id", kind: "repoint" },
  { table: "estimates", column: "opportunity_id", kind: "repoint" },
  { table: "opportunity_email_threads", column: "opportunity_id", kind: "dedupe" },
  { table: "email_threads", column: "opportunity_id", kind: "repoint" },
  { table: "ai_draft_history", column: "opportunity_id", kind: "repoint" },
  { table: "opportunity_correspondence_events", column: "opportunity_id", kind: "repoint" },
  { table: "opportunity_lifecycle_state", column: "opportunity_id", kind: "dedupe" },
  { table: "opportunity_lifecycle_action_audit", column: "opportunity_id", kind: "repoint" },
  { table: "opportunity_follow_up_drafts", column: "opportunity_id", kind: "supersede" },
  { table: "pending_auto_sends", column: "opportunity_id", kind: "repoint" },
  { table: "site_visits", column: "opportunity_id", kind: "repoint" },
  { table: "invoices", column: "opportunity_id", kind: "repoint" },
  // Reverse back-link (TEXT, no FK) — must still re-point.
  { table: "projects", column: "opportunity_id", kind: "repoint" },
];

const CLIENT_FK_GRAPH: Coverage[] = [
  // enforced *_ref FKs + legacy *_id mirrors (BOTH must be re-pointed)
  { table: "opportunities", column: "client_ref", kind: "repoint" },
  { table: "opportunities", column: "client_id", kind: "repoint" },
  { table: "estimates", column: "client_ref", kind: "repoint" },
  { table: "estimates", column: "client_id", kind: "repoint" },
  { table: "invoices", column: "client_ref", kind: "repoint" },
  { table: "invoices", column: "client_id", kind: "repoint" },
  { table: "site_visits", column: "client_ref", kind: "repoint" },
  { table: "site_visits", column: "client_id", kind: "repoint" },
  { table: "projects", column: "client_id", kind: "repoint" },
  { table: "email_threads", column: "client_id", kind: "repoint" },
  { table: "task_recurrences", column: "client_id", kind: "repoint" },
  { table: "client_product_overrides", column: "client_id", kind: "repoint" },
  { table: "follow_ups", column: "client_id", kind: "repoint" },
  { table: "activities", column: "client_id", kind: "repoint" },
  { table: "activities", column: "suggested_client_id", kind: "repoint" },
  { table: "payments", column: "client_id", kind: "repoint" },
  { table: "project_table_rows", column: "client_id", kind: "repoint" },
  { table: "sub_clients", column: "client_id", kind: "dedupe" },
  // Portal: re-point history, revoke auth (Q6).
  { table: "portal_messages", column: "client_id", kind: "repoint" },
  { table: "portal_tokens", column: "client_id", kind: "revoke" },
  { table: "portal_sessions", column: "client_id", kind: "revoke" },
];

function assertRepoint(body: string, table: string, column: string, winnerExpr: string) {
  // `update public.<table> set <column> = <winner>` (whitespace-insensitive).
  const re = new RegExp(
    `update\\s+public\\.${table}\\s+set\\s+${column}\\s*=\\s*${winnerExpr}`,
    "i"
  );
  expect(
    re.test(body),
    `missing re-point of ${table}.${column} to the winner`
  ).toBe(true);
}

function assertDedupe(body: string, table: string) {
  const del = new RegExp(`delete\\s+from\\s+public\\.${table}`, "i");
  const upd = new RegExp(`update\\s+public\\.${table}\\s+set`, "i");
  expect(del.test(body), `missing de-dupe delete on ${table}`).toBe(true);
  expect(upd.test(body), `missing re-point update on ${table}`).toBe(true);
}

function assertSupersede(body: string, table: string) {
  // supersede-then-re-point: a status='superseded' update + a re-point update.
  expect(
    new RegExp(`update\\s+public\\.${table}[\\s\\S]*?status = 'superseded'`, "i").test(body),
    `missing supersede on ${table}`
  ).toBe(true);
  expect(
    new RegExp(`update\\s+public\\.${table}\\s+set opportunity_id = p_winner_id`, "i").test(body),
    `missing re-point on ${table}`
  ).toBe(true);
}

describe("P5 merge migration — DDL shape", () => {
  it("adds nullable self-ref merge pointers on opportunities and clients", () => {
    const sql = mergeSql();
    expect(sql).toMatch(
      /alter table public\.opportunities[\s\S]*?add column if not exists merged_into_opportunity_id uuid[\s\S]*?references public\.opportunities\(id\) on delete set null/i
    );
    expect(sql).toMatch(
      /alter table public\.clients[\s\S]*?add column if not exists merged_into_client_id uuid[\s\S]*?references public\.clients\(id\) on delete set null/i
    );
  });

  it("does NOT touch the opportunities_stage_check or any existing column type (iOS-safe)", () => {
    // Strip SQL line comments so a mention of the constraint in documentation
    // doesn't trip the guard — we only care about executable DDL.
    const sql = (mergeSql() + "\n" + lifecycleSql())
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // No statement may alter/drop the stage CHECK constraint.
    expect(sql).not.toMatch(/drop\s+constraint\s+[^;]*opportunities_stage_check/i);
    expect(sql).not.toMatch(/add\s+constraint\s+[^;]*opportunities_stage_check/i);
    // No column type / nullability changes, no column drops.
    expect(sql).not.toMatch(/\balter\s+column\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);
    // The only ALTERs of existing tables are ADD COLUMN IF NOT EXISTS (additive).
    const alterStmts = sql.match(/alter table[\s\S]*?;/gi) ?? [];
    for (const stmt of alterStmts) {
      expect(stmt.toLowerCase(), `unexpected ALTER: ${stmt}`).toMatch(
        /add column if not exists|add constraint opportunity_dispositions_company_opp_fk|enable row level security/
      );
    }
  });

  it("creates the opportunity_merges audit table with applied|skipped|failed + idempotency index", () => {
    const sql = mergeSql();
    expect(sql).toContain("create table if not exists public.opportunity_merges");
    expect(sql).toMatch(/status\s+text\s+not null\s+check\s*\(status\s+in\s*\('applied',\s*'skipped',\s*'failed'\)\)/i);
    expect(sql).toMatch(/manifest\s+jsonb not null default '\{\}'::jsonb/i);
    expect(sql).toContain("opportunity_merges_key_loser_applied_uidx");
    expect(sql).toContain("where status = 'applied'");
    expect(sql).toContain("opportunity_merges_winner_ne_loser check (winner_id <> loser_id)");
  });

  it("creates opportunity_dispositions with CHECK'd disposition, NO-CHECK reason_code, append-history active uidx", () => {
    const sql = mergeSql();
    expect(sql).toContain("create table if not exists public.opportunity_dispositions");
    expect(sql).toMatch(
      /disposition\s+text\s+not null\s+check\s*\(disposition\s+in[\s\S]*?'won',\s*'lost',\s*'disqualified',\s*'discarded',\s*'merged',\s*'converted_to_project'\)/i
    );
    // reason_code is permissive text — no CHECK constraint on it (Q7).
    expect(sql).toMatch(/reason_code\s+text,/i);
    expect(sql).not.toMatch(/reason_code\s+text[^,]*check/i);
    // append-history: superseded_at + partial unique on the active row (Q3).
    expect(sql).toContain("superseded_at   timestamptz");
    expect(sql).toContain("opportunity_dispositions_one_active_uidx");
    expect(sql).toMatch(/opportunity_dispositions_one_active_uidx[\s\S]*?where superseded_at is null/i);
    // composite tenant FK
    expect(sql).toContain("opportunity_dispositions_company_opp_fk");
    expect(sql).toMatch(/references public\.opportunities\(company_id, id\)/i);
  });

  it("adds duplicate_reviews.migration_manifest (additive jsonb)", () => {
    const sql = mergeSql();
    expect(sql).toMatch(
      /alter table public\.duplicate_reviews[\s\S]*?add column if not exists migration_manifest jsonb not null default '\{\}'::jsonb/i
    );
  });

  it("enables RLS + company-scoped select policies, no broad authenticated writes", () => {
    const sql = mergeSql();
    expect(sql).toContain("alter table public.opportunity_merges enable row level security");
    expect(sql).toContain("alter table public.opportunity_dispositions enable row level security");
    expect(sql).toContain("create policy opportunity_merges_company_select");
    expect(sql).toContain("create policy opportunity_dispositions_company_select");
    expect(sql).toMatch(/company_id = \(select private\.get_user_company_id\(\)\)/i);
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
  });
});

describe("P5 merge RPCs — transactional + guarded shape", () => {
  it("defines both guarded merge RPCs as SECURITY DEFINER plpgsql with search_path ''", () => {
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      expect(body).toContain("language plpgsql");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body).toContain("returns jsonb");
    }
  });

  it("locks BOTH rows FOR UPDATE ordered by id, checks auth/scope, idempotency, snapshot", () => {
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      // company scope (42501)
      expect(body).toContain("errcode = '42501'");
      expect(body).toMatch(/private\.get_user_company_id\(\)/);
      // FOR UPDATE both rows ordered by id
      expect(body).toMatch(/in \(v_first_id, v_second_id\)\s*[\s\S]*?order by id\s*[\s\S]*?for update/i);
      // idempotency on merge_key + loser + applied
      expect(body).toMatch(/merge_key = p_merge_key[\s\S]*?loser_id = p_loser_id[\s\S]*?status = 'applied'/i);
      expect(body).toContain("duplicate_applied_merge");
      // snapshot guard short-circuit
      expect(body).toContain("snapshot_mismatch");
    }
  });

  it("soft-deletes the loser, writes merged_into pointer, and RAISES if it matches zero rows", () => {
    const sql = mergeSql();
    const opp = functionBody(sql, "public.execute_opportunity_merge_guarded");
    expect(opp).toMatch(/update public\.opportunities[\s\S]*?set deleted_at = now\(\)[\s\S]*?merged_into_opportunity_id = p_winner_id/i);
    expect(opp).toMatch(/raise exception 'loser soft-delete matched zero rows'/i);

    const cli = functionBody(sql, "public.execute_client_merge_guarded");
    expect(cli).toMatch(/update public\.clients[\s\S]*?set deleted_at = now\(\)[\s\S]*?merged_into_client_id = p_winner_id/i);
    expect(cli).toMatch(/raise exception 'loser client soft-delete matched zero rows'/i);
  });

  it("never silently overwrites a non-blank winner field — conflicts are surfaced, overrides gated", () => {
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      // fill-blank only when winner blank
      expect(body).toContain("v_fill_applied");
      // conflict bucket collected when both non-blank and differ
      expect(body).toContain("v_conflicts");
      expect(body).toMatch(/v_winner_val is distinct from v_loser_val/i);
      // overrides applied ONLY when the operator confirmed the field
      expect(body).toContain("v_override_applied");
      expect(body).toMatch(/p_confirmed_overrides \? v_key/i);
      // conflicts preserved in the manifest
      expect(body).toContain("'field_conflicts', v_conflicts");
    }
  });

  it("writes a disposition('merged') row for the loser and supersedes any prior active one", () => {
    const opp = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
    expect(opp).toMatch(/update public\.opportunity_dispositions\s+set superseded_at = now\(\)[\s\S]*?superseded_at is null/i);
    expect(opp).toMatch(/insert into public\.opportunity_dispositions[\s\S]*?'merged'[\s\S]*?'duplicate_merge'/i);
  });

  it("writes the opportunity_merges audit row + updates duplicate_reviews + cascades pending in-transaction", () => {
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      expect(body).toMatch(/insert into public\.opportunity_merges[\s\S]*?'applied'/i);
      expect(body).toMatch(/update public\.duplicate_reviews[\s\S]*?status = 'merged'[\s\S]*?migration_manifest = v_manifest/i);
      // cascade: collapse self-refs (delete) + re-point remaining pending pairs
      expect(body).toMatch(/delete from public\.duplicate_reviews[\s\S]*?status = 'pending'/i);
      expect(body).toMatch(/update public\.duplicate_reviews\s+set entity_a_id = least\(/i);
    }
  });

  it("pre-dedupes pending reviews so the cascade re-point cannot hit the unique pair index", () => {
    // duplicate_reviews has a NON-partial unique on
    // (company_id, entity_type, entity_a_id, entity_b_id). A loser-paired review
    // re-pointed onto a pair the winner already holds would raise a unique
    // violation and abort a LEGITIMATE merge. Both RPCs must DELETE such
    // would-collide loser rows BEFORE the cascade UPDATE.
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      // a pre-dedupe delete keyed on an EXISTS over the re-pointed ordered pair
      const preDedupeIdx = body.search(
        /delete from public\.duplicate_reviews lo[\s\S]*?exists \(\s*select 1 from public\.duplicate_reviews ex[\s\S]*?ex\.entity_a_id = least\(p_winner_id/i
      );
      const cascadeUpdateIdx = body.search(
        /update public\.duplicate_reviews\s+set entity_a_id = least\(p_winner_id/i
      );
      expect(preDedupeIdx, `${fn}: missing pre-dedupe of colliding pending reviews`).toBeGreaterThanOrEqual(0);
      expect(cascadeUpdateIdx, `${fn}: missing cascade re-point`).toBeGreaterThanOrEqual(0);
      expect(
        preDedupeIdx,
        `${fn}: pre-dedupe DELETE must run BEFORE the cascade UPDATE`
      ).toBeLessThan(cascadeUpdateIdx);
    }
  });

  it("opportunity_email_threads dedupe matches the DB's NULL-distinct semantics (no over-delete)", () => {
    // The DB unique on (thread_id, connection_id) is a STANDARD btree: NULL is
    // distinct, so loser rows with a NULL connection_id must be RE-POINTED, not
    // deleted. The delete must guard on connection_id IS NOT NULL + plain
    // equality, never `is not distinct from` over connection_id.
    const body = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
    const del = body.match(/delete from public\.opportunity_email_threads loser[\s\S]*?get diagnostics v_deleted_dupes/i)?.[0] ?? "";
    expect(del).toMatch(/loser\.connection_id is not null/i);
    expect(del).toMatch(/win\.connection_id = loser\.connection_id/i);
    expect(del).not.toMatch(/connection_id is not distinct from/i);
  });

  it("idempotency short-circuit precedes the soft-deleted guards (documented retry contract)", () => {
    // A same-key retry of an applied merge must return duplicate_applied_merge,
    // NOT loser_deleted — so the idempotency lookup must come BEFORE the
    // winner/loser deleted_at guards.
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      const body = functionBody(sql, fn);
      const idemIdx = body.indexOf("duplicate_applied_merge");
      const loserDeletedIdx = body.indexOf("'loser_deleted'");
      expect(idemIdx).toBeGreaterThanOrEqual(0);
      expect(loserDeletedIdx).toBeGreaterThanOrEqual(0);
      expect(idemIdx, `${fn}: idempotency must precede loser_deleted guard`).toBeLessThan(loserDeletedIdx);
    }
  });

  it("keeps both merge RPCs service-role only", () => {
    const sql = mergeSql();
    for (const fn of [
      "public.execute_opportunity_merge_guarded",
      "public.execute_client_merge_guarded",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke execute on function ${fn.replace(".", "\\.")}[\\s\\S]*?from authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`revoke execute on function ${fn.replace(".", "\\.")}[\\s\\S]*?from public`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function ${fn.replace(".", "\\.")}[\\s\\S]*?to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant execute on function ${fn.replace(".", "\\.")}[\\s\\S]*?to authenticated`, "i"));
    }
  });
});

describe("P5 merge RPCs — COMPLETE FK / no-orphan coverage (table-driven regression lock)", () => {
  it.each(OPPORTUNITY_FK_GRAPH)(
    "opportunity merge re-points %s",
    ({ table, column, kind }) => {
      const body = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
      const winner = table === "projects" ? "p_winner_id::text" : "p_winner_id";
      if (kind === "repoint") {
        assertRepoint(body, table, column, winner);
      } else if (kind === "dedupe") {
        assertDedupe(body, table);
      } else if (kind === "supersede") {
        assertSupersede(body, table);
      }
    }
  );

  it.each(CLIENT_FK_GRAPH)(
    "client merge handles %s.%s",
    ({ table, column, kind }) => {
      const body = functionBody(mergeSql(), "public.execute_client_merge_guarded");
      if (kind === "repoint") {
        // site_visits.client_id + portal_messages.client_id are TEXT mirrors.
        const winner =
          (table === "site_visits" && column === "client_id") ||
          table === "portal_messages"
            ? "v_winner_text"
            : "p_winner_id";
        assertRepoint(body, table, column, winner);
      } else if (kind === "dedupe") {
        assertDedupe(body, table);
      } else if (kind === "revoke") {
        if (table === "portal_tokens") {
          expect(body).toMatch(/update public\.portal_tokens\s+set revoked_at = now\(\)/i);
        } else if (table === "portal_sessions") {
          expect(body).toMatch(/delete from public\.portal_sessions where client_id = v_loser_text/i);
        }
      }
    }
  );

  it("opportunity_email_threads de-dupes on (thread_id, connection_id) before re-pointing", () => {
    const body = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
    // thread_id collision uses NULL-equal semantics; connection_id mirrors the
    // DB's STANDARD-btree NULL-distinct semantics (guarded non-null + equality).
    expect(body).toMatch(/delete from public\.opportunity_email_threads[\s\S]*?thread_id is not distinct from[\s\S]*?connection_id = loser\.connection_id/i);
    expect(body).toMatch(/jsonb_build_object\('repointed', v_repointed, 'deleted_dupes', v_deleted_dupes\)/i);
  });

  it("opportunity_lifecycle_state conservatively merges counters then deletes the loser row (Q4)", () => {
    const body = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
    expect(body).toMatch(/last_meaningful_at = \(\s*select max\(t\)/i);
    expect(body).toMatch(/unanswered_follow_up_count = greatest\(/i);
    expect(body).toMatch(/protected_until = \(\s*select max\(t\)/i);
    expect(body).toMatch(/delete from public\.opportunity_lifecycle_state\s+where opportunity_id = p_loser_id/i);
  });

  it("opportunity_follow_up_drafts supersedes the loser open template draft before re-pointing", () => {
    const body = functionBody(mergeSql(), "public.execute_opportunity_merge_guarded");
    expect(body).toMatch(/origin = 'template_follow_up' and status = 'drafted'/i);
    expect(body).toMatch(/set status = 'superseded', superseded_at = now\(\)/i);
    expect(body).toMatch(/jsonb_build_object\('repointed', v_repointed, 'superseded', v_superseded\)/i);
  });

  it("client merge re-points BOTH the enforced *_ref FK AND the legacy *_id mirror for estimates/invoices/opportunities", () => {
    const body = functionBody(mergeSql(), "public.execute_client_merge_guarded");
    for (const table of ["opportunities", "estimates", "invoices"]) {
      assertRepoint(body, table, "client_ref", "p_winner_id");
      assertRepoint(body, table, "client_id", "p_winner_id");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORITATIVE FK-graph regression lock (design §5.1).
//
// The it.each suites above lock against REMOVING coverage of a listed table.
// This suite is the other half: it pins the AUTHORITATIVE reference graph
// (enforced FKs to opportunities/clients + the curated unenforced mirror
// columns whose live values actually match the target id, verified read-only
// against ijeekuhbatykdomumfjx on 2026-05-29) and FAILS if the coverage graph
// (CLIENT_FK_GRAPH / OPPORTUNITY_FK_GRAPH, which the RPC body is checked
// against) is missing any authoritative reference. A child FK added to the DB
// without RPC coverage therefore breaks CI the moment its column is added to
// the authoritative set, which is co-located with this lock and with the
// operator-runnable live SQL contract at
// `tests/sql/lead-lifecycle-p5-fk-coverage-contract.sql` (which re-derives the
// same set from pg_constraint live, for the apply gate).
// ─────────────────────────────────────────────────────────────────────────────

// Enforced FKs (pg_constraint, contype='f') referencing opportunities(id) or
// opportunities(company_id,id), verified live 2026-05-29.
const AUTHORITATIVE_OPPORTUNITY_REFS = new Set<string>([
  "activities.opportunity_id",
  "ai_draft_history.opportunity_id",
  "email_threads.opportunity_id",
  "estimates.opportunity_id",
  "follow_ups.opportunity_id",
  "invoices.opportunity_id",
  "opportunity_correspondence_events.opportunity_id",
  "opportunity_email_threads.opportunity_id",
  "opportunity_follow_up_drafts.opportunity_id",
  "opportunity_lifecycle_action_audit.opportunity_id",
  "opportunity_lifecycle_state.opportunity_id",
  "pending_auto_sends.opportunity_id",
  "site_visits.opportunity_id",
  "stage_transitions.opportunity_id",
  // Unenforced TEXT back-link (no FK) — verified live to hold opportunities.id.
  "projects.opportunity_id",
]);

// Enforced FKs to clients(id) + curated unenforced mirror columns whose live
// values match clients.id (verified 2026-05-29). Portal auth columns are
// referenced but REVOKE-only, listed separately.
const AUTHORITATIVE_CLIENT_REFS = new Set<string>([
  // enforced *_ref FKs
  "estimates.client_ref",
  "invoices.client_ref",
  "opportunities.client_ref",
  "site_visits.client_ref",
  // enforced *_id FKs
  "client_product_overrides.client_id",
  "email_threads.client_id",
  "projects.client_id",
  "sub_clients.client_id",
  "task_recurrences.client_id",
  // unenforced uuid/text mirrors that hold clients.id
  "opportunities.client_id",
  "estimates.client_id",
  "invoices.client_id",
  "activities.client_id",
  "activities.suggested_client_id",
  "payments.client_id",
  "project_table_rows.client_id",
  "follow_ups.client_id",
  "site_visits.client_id", // TEXT mirror
  "portal_messages.client_id", // TEXT — re-pointed (history), Q6
]);
// Auth artifacts: referenced but REVOKED, never re-pointed (Q6).
const AUTHORITATIVE_CLIENT_REVOKE_REFS = new Set<string>([
  "portal_tokens.client_id",
  "portal_sessions.client_id",
]);
// Named like a client ref but verified live to NOT hold clients.id values
// (portal/answer correlation ids / auth). Asserted out-of-scope EXPLICITLY so
// the lock can never silently ignore a client_id-named column.
const OUT_OF_SCOPE_CLIENT_NAMED = new Set<string>([
  "line_item_answers.client_id",
  "users.client_id",
]);

describe("P5 merge RPCs — authoritative FK-graph coverage (no silent omission)", () => {
  it("OPPORTUNITY_FK_GRAPH covers every authoritative opportunity reference", () => {
    const covered = new Set(
      OPPORTUNITY_FK_GRAPH.map((c) => `${c.table}.${c.column}`)
    );
    const missing = [...AUTHORITATIVE_OPPORTUNITY_REFS].filter(
      (ref) => !covered.has(ref)
    );
    expect(
      missing,
      `opportunity references with NO RPC coverage: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("CLIENT_FK_GRAPH covers every authoritative client reference (repoint + revoke)", () => {
    const covered = new Set(
      CLIENT_FK_GRAPH.map((c) => `${c.table}.${c.column}`)
    );
    const expected = new Set<string>([
      ...AUTHORITATIVE_CLIENT_REFS,
      ...AUTHORITATIVE_CLIENT_REVOKE_REFS,
    ]);
    const missing = [...expected].filter((ref) => !covered.has(ref));
    expect(
      missing,
      `client references with NO RPC coverage: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("revoke-only client refs are classified revoke, never re-point", () => {
    for (const ref of AUTHORITATIVE_CLIENT_REVOKE_REFS) {
      const entry = CLIENT_FK_GRAPH.find((c) => `${c.table}.${c.column}` === ref);
      expect(entry, `${ref} missing from CLIENT_FK_GRAPH`).toBeDefined();
      expect(entry!.kind, `${ref} must be revoke, not re-point`).toBe("revoke");
    }
  });

  it("out-of-scope client_id-named columns are explicitly excluded (not silently ignored)", () => {
    const covered = new Set(
      CLIENT_FK_GRAPH.map((c) => `${c.table}.${c.column}`)
    );
    for (const ref of OUT_OF_SCOPE_CLIENT_NAMED) {
      // These hold no clients.id values (verified live); they must NOT be
      // re-pointed by the client merge, and the exclusion is asserted here so a
      // reviewer sees the intentional classification.
      expect(
        covered.has(ref),
        `${ref} is out-of-scope (non-client values) and must not be in the graph`
      ).toBe(false);
    }
  });

  it("the coverage graph contains NO reference outside the authoritative set (no phantom coverage)", () => {
    const authoritative = new Set<string>([
      ...AUTHORITATIVE_CLIENT_REFS,
      ...AUTHORITATIVE_CLIENT_REVOKE_REFS,
    ]);
    const extra = CLIENT_FK_GRAPH.map((c) => `${c.table}.${c.column}`).filter(
      (ref) => !authoritative.has(ref)
    );
    expect(extra, `coverage graph lists non-authoritative refs: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("P5 lifecycle RPC extension — lost branch writes a disposition in-transaction", () => {
  it("re-creates the function preserving signature + every guard, adding the lost disposition write", () => {
    const sql = lifecycleSql();
    expect(sql).toContain("create or replace function public.execute_opportunity_lifecycle_guarded_action");
    // every prior guard reason is preserved
    for (const guard of [
      "missing_opportunity_snapshot",
      "duplicate_applied_action",
      "snapshot_mismatch",
      "terminal_or_protected_stage",
      "lost_stage_not_allowed",
    ]) {
      expect(sql).toContain(guard);
    }
    // the new disposition write, gated to the lost branch, supersede-then-insert
    expect(sql).toMatch(/if p_action = 'move_to_lost_operator_no_response' then[\s\S]*?update public\.opportunity_dispositions\s+set superseded_at = now\(\)/i);
    expect(sql).toMatch(/insert into public\.opportunity_dispositions[\s\S]*?'lost', 'operator_no_response'[\s\S]*?'guarded_lifecycle'/i);
    // service-role only
    expect(sql).toMatch(/grant execute on function public\.execute_opportunity_lifecycle_guarded_action[\s\S]*?to service_role/i);
  });

  it("places the disposition write BEFORE the final applied audit insert (same transaction, all-or-nothing)", () => {
    const sql = lifecycleSql();
    const dispositionIdx = sql.indexOf("insert into public.opportunity_dispositions");
    const appliedAuditIdx = sql.lastIndexOf("'applied', null, v_before_values, v_after_values");
    expect(dispositionIdx).toBeGreaterThanOrEqual(0);
    expect(appliedAuditIdx).toBeGreaterThanOrEqual(0);
    expect(dispositionIdx).toBeLessThan(appliedAuditIdx);
  });
});
