import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260713200000_project_opportunity_link_invariant.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const start = source.toLowerCase().indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = source
    .toLowerCase()
    .indexOf("create or replace function ", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("project↔opportunity link invariant migration", () => {
  it("normalizes either project-side field without casting arbitrary legacy text", () => {
    const body = functionBody(
      sql(),
      "public.normalize_project_opportunity_link"
    );

    expect(body).toMatch(/new\.opportunity_ref is not null/i);
    expect(body).toMatch(/btrim\(new\.opportunity_id\)\s*~\*/i);
    expect(body).toMatch(
      /then[\s\S]*?v_opportunity_id\s*:=\s*new\.opportunity_id::uuid/i
    );
    expect(body).toMatch(
      /new\.opportunity_ref\s*:=\s*v_opportunity_id[\s\S]*?new\.opportunity_id\s*:=\s*v_opportunity_id::text/i
    );
  });

  it("installs before/after project triggers that maintain both directions", () => {
    const source = sql();
    expect(source).toMatch(
      /create trigger projects_normalize_opportunity_link[\s\S]*?before insert or update[\s\S]*?on public\.projects/i
    );
    expect(source).toMatch(
      /create trigger projects_enforce_opportunity_link[\s\S]*?after insert or delete or update[\s\S]*?on public\.projects/i
    );

    const body = functionBody(
      source,
      "public.enforce_project_opportunity_link"
    );
    expect(body).toMatch(
      /set project_ref\s*=\s*new\.id,\s*project_id\s*=\s*new\.id/i
    );
    expect(body).toMatch(/stage\s*=\s*'won'/i);
    expect(body).toMatch(
      /if v_from_stage is distinct from 'won' then[\s\S]*?insert into public\.stage_transitions/i
    );
    expect(body).toMatch(
      /auth\.role\(\)[\s\S]*?private\.current_user_has_permission\('pipeline\.manage',\s*'all'\)[\s\S]*?access_denied/i
    );
    expect(body).toMatch(
      /project_ref\s*=\s*new\.id\s+or\s+project_id\s*=\s*new\.id/i
    );
    expect(body).toMatch(
      /coalesce\(\s*v_existing_project_ref,\s*v_existing_project_legacy\s*\)/i
    );
  });

  it("wins a previously linked opportunity when its project becomes active", () => {
    const source = sql();
    expect(source).toMatch(
      /create trigger projects_enforce_opportunity_link[\s\S]*?update of[\s\S]*?status[\s\S]*?on public\.projects/i
    );

    const body = functionBody(
      source,
      "public.enforce_project_opportunity_link"
    );
    expect(body).toMatch(
      /new\.status\s+in\s*\(\s*'accepted',\s*'in_progress',\s*'completed',\s*'closed'\s*\)/i
    );
  });

  it("releases both opportunity mirrors on project soft or hard deletion", () => {
    const source = sql();
    expect(source).toMatch(
      /create trigger projects_enforce_opportunity_link[\s\S]*?after insert or delete or update of[\s\S]*?deleted_at[\s\S]*?on public\.projects/i
    );

    const body = functionBody(
      source,
      "public.enforce_project_opportunity_link"
    );
    expect(body).toMatch(
      /if tg_op = 'DELETE' then[\s\S]*?set project_ref\s*=\s*null,\s*project_id\s*=\s*null[\s\S]*?project_ref\s*=\s*old\.id\s+or\s+project_id\s*=\s*old\.id/i
    );
    expect(body).toMatch(
      /if new\.deleted_at is not null then[\s\S]*?set project_ref\s*=\s*null,\s*project_id\s*=\s*null[\s\S]*?project_ref\s*=\s*new\.id\s+or\s+project_id\s*=\s*new\.id/i
    );
  });

  it("repairs all four mirrors in the RPC already-linked branch before returning", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    const branchStart = body.search(
      /if coalesce\(v_opp\.project_ref, v_opp\.project_id\) is not null then/i
    );
    const branchEnd = body.indexOf("-- end already-linked repair", branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = body.slice(branchStart, branchEnd);

    expect(branch).toMatch(
      /update public\.projects[\s\S]*?opportunity_ref\s*=\s*p_opportunity_id[\s\S]*?opportunity_id\s*=\s*p_opportunity_id::text/i
    );
    expect(branch).toMatch(
      /select p\.opportunity_ref, p\.opportunity_id[\s\S]*?linked project belongs to another opportunity[\s\S]*?linked project legacy mirror belongs to another opportunity/i
    );
    expect(branch).toMatch(
      /update public\.opportunities[\s\S]*?project_ref\s*=\s*v_project_id[\s\S]*?project_id\s*=\s*v_project_id/i
    );
    expect(branch).toMatch(/if p_win_opportunity/i);
    expect(branch).toMatch(/insert into public\.stage_transitions/i);
    expect(branch).toMatch(/'already_converted', true/i);
  });

  it("rejects disagreeing legacy mirrors and gates both mirror values in conversion", () => {
    const body = functionBody(sql(), "public.convert_opportunity_to_project");
    expect(body).toMatch(
      /v_opp\.project_ref is distinct from v_opp\.project_id[\s\S]*?opportunity project mirrors disagree/i
    );
    expect(body).toMatch(
      /project_ref is null or project_ref = v_project_id[\s\S]*?project_id is null or project_id = v_project_id/i
    );
  });

  it("suppresses trigger side effects only while the RPC performs its own transactional link", () => {
    const source = sql();
    expect(source).toContain("ops.skip_project_opportunity_invariant");
    expect(source).toMatch(
      /set_config\('ops\.skip_project_opportunity_invariant',\s*'on',\s*true\)/i
    );
    expect(source).toMatch(
      /set_config\('ops\.skip_project_opportunity_invariant',\s*'off',\s*true\)/i
    );
  });
});
