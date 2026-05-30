import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const conversionMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260529180000_lead_lifecycle_p6_project_conversion.sql"
);

function sql(): string {
  return readFileSync(conversionMigrationPath, "utf8");
}

// Scope coverage assertions to a single plpgsql function body.
function functionBody(source: string, fnName: string): string {
  const start = source.indexOf(`create or replace function ${fnName}`);
  expect(start, `function ${fnName} not found`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("create or replace function ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

// SQL stripped of line comments — executable DDL only (a constraint named in a
// comment must not trip the iOS-safety guards).
function executable(): string {
  return sql()
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("P6 conversion migration — additive / iOS-safe DDL", () => {
  it("is ordered AFTER the P5 disposition migration (20260529170000)", () => {
    const file = path.basename(conversionMigrationPath);
    expect(file > "20260529170000_lead_lifecycle_p5_merge_disposition.sql").toBe(
      true
    );
    expect(
      file > "20260529170100_lead_lifecycle_p5_lifecycle_disposition_extension.sql"
    ).toBe(true);
  });

  it("adds the three conversion-payload columns on projects (nullable, no CHECK)", () => {
    const s = sql();
    expect(s).toMatch(
      /alter table public\.projects\s+add column if not exists estimated_value numeric/i
    );
    expect(s).toMatch(
      /alter table public\.projects\s+add column if not exists source text/i
    );
    expect(s).toMatch(
      /alter table public\.projects\s+add column if not exists platform_metadata jsonb/i
    );
    // Scope the no-CHECK / no-NOT-NULL assertions to the individual ADD COLUMN
    // statements (executable, comment-stripped) — a CHECK elsewhere in the RPC
    // body must not be misattributed to these columns.
    const ex = executable();
    const addCols = (ex.match(/add column if not exists [^;]+;/gi) ?? []).map(
      (c) => c.toLowerCase()
    );
    const payloadCols = addCols.filter(
      (c) =>
        c.includes("estimated_value") ||
        /add column if not exists source /.test(c) ||
        c.includes("platform_metadata")
    );
    expect(payloadCols).toHaveLength(3);
    for (const col of payloadCols) {
      expect(col, `column must be nullable / no CHECK: ${col}`).not.toMatch(
        /\bnot null\b|\bcheck\b/
      );
    }
  });

  it("adds the normalized opportunity_ref uuid FK alongside the legacy text opportunity_id", () => {
    const s = sql();
    expect(s).toMatch(
      /alter table public\.projects\s+add column if not exists opportunity_ref uuid\s+references public\.opportunities\(id\) on delete set null/i
    );
    expect(s).toContain("projects_opportunity_ref_idx");
  });

  it("NEVER converts projects.opportunity_id text->uuid or adds an FK to it (iOS-unsafe, rejected)", () => {
    const ex = executable();
    // no in-place type change / FK on the legacy text column.
    expect(ex).not.toMatch(/alter\s+column\s+opportunity_id/i);
    expect(ex).not.toMatch(/projects_opportunity_id_fkey/i);
    // no FK constraint added that references opportunities FROM opportunity_id.
    expect(ex).not.toMatch(
      /opportunity_id[^;]*references public\.opportunities/i
    );
  });

  it("touches NO existing synced column (no alter column / drop column / not null / stage CHECK)", () => {
    const ex = executable();
    expect(ex).not.toMatch(/\balter\s+column\b/i);
    expect(ex).not.toMatch(/\bdrop\s+column\b/i);
    expect(ex).not.toMatch(/opportunities_stage_check/i);
    expect(ex).not.toMatch(/projects_status_check/i);
    // Every ALTER TABLE of an existing table is ADD COLUMN IF NOT EXISTS only.
    const alters = ex.match(/alter table[\s\S]*?;/gi) ?? [];
    for (const stmt of alters) {
      expect(stmt.toLowerCase(), `unexpected ALTER: ${stmt}`).toMatch(
        /add column if not exists/
      );
    }
  });

  it("does NOT add 'converted_to_project' to the opportunities stage enum", () => {
    // Converted-ness lives in the disposition row + link, never the stage CHECK.
    // The string 'converted_to_project' is LEGITIMATELY present in the
    // disposition INSERT — assert only that it never appears in a stage
    // CHECK / stage-enum mutation.
    const ex = executable();
    expect(ex).not.toMatch(/opportunities_stage_check/i);
    expect(ex).not.toMatch(
      /check\s*\(\s*stage[\s\S]*?'converted_to_project'/i
    );
    // The only 'converted_to_project' occurrence is the disposition INSERT.
    const occurrences = (ex.match(/'converted_to_project'/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(ex).toMatch(
      /insert into public\.opportunity_dispositions[\s\S]*?'converted_to_project'/i
    );
  });
});

describe("P6 conversion RPC — transactional + guarded shape", () => {
  const FN = "public.execute_opportunity_project_conversion_guarded";

  it("is SECURITY DEFINER plpgsql with search_path '' returning jsonb", () => {
    const body = functionBody(sql(), FN);
    expect(body).toContain("language plpgsql");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("returns jsonb");
  });

  it("enforces auth/company scope (42501) and locks the opportunity FOR UPDATE", () => {
    const body = functionBody(sql(), FN);
    expect(body).toContain("errcode = '42501'");
    expect(body).toMatch(/private\.get_user_company_id\(\)/);
    expect(body).toMatch(
      /select \* into v_opportunity[\s\S]*?from public\.opportunities[\s\S]*?for update/i
    );
  });

  it("short-circuits idempotently when project_ref is already set (no second project)", () => {
    const body = functionBody(sql(), FN);
    // the idempotency guard precedes any write.
    const guardIdx = body.indexOf("already_converted");
    const firstUpdateIdx = body.search(/update public\./i);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(body).toMatch(
      /if v_opportunity\.project_ref is not null then[\s\S]*?'guard_reason', 'already_converted'/i
    );
    expect(
      guardIdx,
      "idempotency guard must precede the first UPDATE"
    ).toBeLessThan(firstUpdateIdx);
  });

  it("snapshot-guards on stage + deleted_at before writing", () => {
    const body = functionBody(sql(), FN);
    expect(body).toMatch(/v_opportunity\.deleted_at is not null/i);
    expect(body).toMatch(
      /p_expected_stage is not null[\s\S]*?stage is distinct from p_expected_stage[\s\S]*?'snapshot_mismatch'/i
    );
  });

  it("writes the FULL four-column link contract atomically", () => {
    const body = functionBody(sql(), FN);
    // (1) projects.opportunity_ref + (2) projects.opportunity_id text mirror.
    expect(body).toMatch(
      /update public\.projects\s+set opportunity_ref = p_opportunity_id,\s*opportunity_id\s*=\s*p_opportunity_id::text/i
    );
    // (3) opportunities.project_ref + (4) opportunities.project_id uuid mirror,
    // guarded on project_ref IS NULL (defence-in-depth against double-link).
    expect(body).toMatch(
      /update public\.opportunities\s+set project_ref = p_project_id,\s*project_id\s*=\s*p_project_id/i
    );
    expect(body).toMatch(/and project_ref is null/i);
  });

  it("re-links estimates via the FK-backed project_ref only (never the dead text project_id)", () => {
    const body = functionBody(sql(), FN);
    expect(body).toMatch(
      /update public\.estimates\s+set project_ref = p_project_id\s+where opportunity_id = p_opportunity_id/i
    );
    // must NOT write the dead legacy estimates.project_id text column.
    expect(body).not.toMatch(/update public\.estimates\s+set project_id/i);
  });

  it("supersedes prior active disposition then inserts converted_to_project / project_conversion", () => {
    const body = functionBody(sql(), FN);
    expect(body).toMatch(
      /update public\.opportunity_dispositions\s+set superseded_at = now\(\)[\s\S]*?superseded_at is null/i
    );
    expect(body).toMatch(
      /insert into public\.opportunity_dispositions[\s\S]*?'converted_to_project', null, 'project_conversion'/i
    );
    // carries the new project ref.
    expect(body).toMatch(/converted_project_ref/i);
    expect(body).toMatch(/p_project_id\)\s*returning id into v_disposition_id/i);
  });

  it("RAISES (rolls back) when any link UPDATE matches zero rows — no half-conversion", () => {
    const body = functionBody(sql(), FN);
    expect(body).toMatch(/raise exception 'project link update matched zero rows'/i);
    expect(body).toMatch(
      /raise exception 'opportunity link update matched zero rows[\s\S]*?P0002/i
    );
  });

  it("keeps the conversion RPC service-role only", () => {
    const s = sql();
    const fnEsc = "public\\.execute_opportunity_project_conversion_guarded";
    expect(s).toMatch(new RegExp(`revoke execute on function ${fnEsc}[\\s\\S]*?from public`, "i"));
    expect(s).toMatch(new RegExp(`revoke execute on function ${fnEsc}[\\s\\S]*?from anon`, "i"));
    expect(s).toMatch(new RegExp(`revoke execute on function ${fnEsc}[\\s\\S]*?from authenticated`, "i"));
    expect(s).toMatch(new RegExp(`grant execute on function ${fnEsc}[\\s\\S]*?to service_role`, "i"));
    expect(s).not.toMatch(new RegExp(`grant execute on function ${fnEsc}[\\s\\S]*?to authenticated`, "i"));
  });

  it("places the disposition write inside the same transaction (before the return)", () => {
    const body = functionBody(sql(), FN);
    const dispIdx = body.indexOf("insert into public.opportunity_dispositions");
    const returnIdx = body.indexOf("'converted', true");
    expect(dispIdx).toBeGreaterThanOrEqual(0);
    expect(returnIdx).toBeGreaterThanOrEqual(0);
    expect(dispIdx).toBeLessThan(returnIdx);
  });
});
