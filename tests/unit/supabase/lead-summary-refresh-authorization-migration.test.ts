import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260807123500_authorize_lead_summary_refresh.sql"
  ),
  "utf8"
).toLowerCase();

describe("lead summary activity refresh authorization migration", () => {
  it("derives the actor and company while requiring opportunity edit access", () => {
    expect(source).toContain("v_actor_user_id uuid := private.get_current_user_id()");
    expect(source).toContain("private.user_can_edit_opportunity");
    expect(source).toContain("select opportunity.company_id");
    expect(source).not.toContain("p_actor_user_id");
    expect(source).not.toContain("p_company_id");
  });

  it("exposes only the guarded authenticated rpc", () => {
    expect(source).toContain("security definer");
    expect(source).toContain("revoke all on function public.authorize_lead_summary_refresh(uuid) from public");
    expect(source).toContain("grant execute on function public.authorize_lead_summary_refresh(uuid) to authenticated");
  });
});
