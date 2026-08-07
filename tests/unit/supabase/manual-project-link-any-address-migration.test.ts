import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260807123000_manual_project_link_any_address.sql"
  ),
  "utf8"
);

describe("manual project link candidates migration", () => {
  it("returns every authorized, non-deleted, unclaimed project", () => {
    expect(source).toContain(
      "create or replace function public.get_manual_project_link_candidates"
    );
    expect(source).toMatch(/project\.company_id = v_company_id/i);
    expect(source).toMatch(/project\.deleted_at is null/i);
    expect(source).toContain("private.user_can_view_project");
    expect(source).toContain("private.user_can_link_opportunity_to_project");
    expect(source).toMatch(/project\.opportunity_ref is null[\s\S]*p_opportunity_id/i);
    const candidateWhere = source.match(
      /from public\.projects project\s+where([\s\S]*?)\s+order by/i
    )?.[1];
    expect(candidateWhere).toBeDefined();
    expect(candidateWhere).not.toContain(
      "private.normalize_address(project.address)"
    );
  });

  it("uses address and client only to rank suggestions", () => {
    expect(source).toContain("same_address boolean");
    expect(source).toContain("same_client boolean");
    expect(source).toMatch(/order by[\s\S]*v_normalized_address[\s\S]*project\.client_id/i);
  });

  it("keeps automatic create guards and removes address checks only for an explicit human target", () => {
    expect(source).toContain("and v_link_to_project_id is null");
    expect(source).toContain("not private.user_can_view_project");
    expect(source).toContain("not private.user_can_link_opportunity_to_project");
    expect(source).toContain("manual-link precheck patch did not match exactly once");
    expect(source).toContain("manual-link final guard patch did not match exactly once");
  });

  it("is callable only through the authenticated conversion boundary", () => {
    expect(source).toMatch(
      /revoke all on function public\.get_manual_project_link_candidates\(uuid\)[\s\S]*from public/i
    );
    expect(source).toMatch(
      /grant execute on function public\.get_manual_project_link_candidates\(uuid\)[\s\S]*to authenticated/i
    );
    expect(source).not.toMatch(/to authenticated, service_role/i);
  });
});
