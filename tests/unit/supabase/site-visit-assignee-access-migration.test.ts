import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PERMISSION_EDITOR_REGISTRY } from "@/lib/types/permissions";

const migrations = resolve(process.cwd(), "supabase/migrations");
const partA = "20260918054412_site_visit_assignee_access.sql";
const partB = "20260918060000_site_visits_capture_permission.sql";

function read(name: string): string {
  return readFileSync(resolve(migrations, name), "utf8").toLowerCase();
}

describe("site-visit assignee access (part A)", () => {
  it("replaces every function only from its reviewed live definition", () => {
    const source = read(partA);
    for (const signature of [
      "private.current_user_can_access_site_visit_child(uuid,text,boolean)",
      "public.save_site_visit_capture(jsonb,uuid)",
      "private.apply_site_visit_rows(uuid,text,text,jsonb)",
      "private.apply_site_visit_rows_v2(uuid,text,text,jsonb)",
      "private.site_visit_review_rows(uuid,text,jsonb)",
      "private.site_visit_review_rows_v2(uuid,text,jsonb)",
      "private.complete_site_visit_guarded(uuid,jsonb)",
    ]) {
      expect(source).toContain(`('${signature}','`);
    }
    expect(source.indexOf("do $guard$")).toBeLessThan(
      source.indexOf("create or replace function")
    );
  });

  it("never widens lead visibility", () => {
    const source = read(partA);
    expect(source).not.toMatch(/on public\.opportunities/);
    expect(source).toContain("alter policy assigned_lead_scope_select on public.site_visits");
  });

  it("freezes every link column and deleted_at for assignee-only saves", () => {
    const source = read(partA);
    for (const column of [
      "proposed.opportunity_id is not distinct from current_visit.opportunity_id",
      "lower(proposed.project_id) is not distinct from lower(current_visit.project_id)",
      "proposed.project_ref is not distinct from current_visit.project_ref",
      "lower(proposed.client_id) is not distinct from lower(current_visit.client_id)",
      "proposed.client_ref is not distinct from current_visit.client_ref",
      "proposed.deleted_at is not distinct from current_visit.deleted_at",
    ]) {
      expect(source).toContain(column);
    }
  });

  it("keeps assignee helpers off the app roles except the RLS wrapper", () => {
    const source = read(partA);
    expect(source).toContain(
      "revoke all on function private.actor_is_site_visit_assignee(uuid, text, text[])\n  from public, anon, authenticated;"
    );
    expect(source).toContain(
      "revoke all on function public.read_site_visit_briefs(uuid[]) from public, anon;"
    );
    expect(source).toContain(
      "grant execute on function public.read_site_visit_briefs(uuid[]) to authenticated;"
    );
  });
});

describe("site_visits.capture permission (part B)", () => {
  it("requires part A first", () => {
    expect(read(partB)).toContain(
      "to_regprocedure('private.actor_is_site_visit_assignee(uuid,text,text[])') is null"
    );
  });

  it("registers exactly the scopes the web editor offers", () => {
    const web = PERMISSION_EDITOR_REGISTRY.find(
      (entry) => entry.id === "site_visits.capture"
    );
    expect(web?.scopes).toEqual(["all"]);
    expect(read(partB)).toContain(
      "values ('site_visits.capture', array['all'])"
    );
  });

  it("grants the five working presets and gates on the pipeline flag", () => {
    const source = read(partB);
    for (const presetSuffix of ["0001", "0002", "0003", "0004", "0005"]) {
      expect(source).toContain(
        `('00000000-0000-0000-0000-00000000${presetSuffix}'::uuid)`
      );
    }
    expect(source).not.toContain("00000000-0000-0000-0000-000000000006");
    expect(source).not.toContain("00000000-0000-0000-0000-0000000000a1");
    expect(source).toContain("where slug = 'pipeline'");
  });
});
