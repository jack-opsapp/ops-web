import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607171000_qbo_acceptance_bridge_auth_user_actor.sql"),
  "utf8"
);

describe("qbo acceptance bridge auth user actor migration", () => {
  it("derives the synthetic auth.uid actor from auth.users by company actor email", () => {
    expect(sql).toContain("qbo_acceptance_bridge_auth_user_actor_sentinel");
    expect(sql).toContain("left join auth.users au");
    expect(sql).toContain("on lower(au.email) = lower(u.email)");
    expect(sql).toContain("select u.id, au.id, u.email");
  });

  it("keeps the email claim patch required for private.get_current_user_id", () => {
    expect(sql).toContain("request.jwt.claim.email");
  });

  it("keeps the bridge service-role only", () => {
    expect(sql).toContain("revoke all on function public.accept_estimate_to_job_from_quickbooks");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.accept_estimate_to_job_from_quickbooks");
    expect(sql).toContain("to service_role");
  });
});
