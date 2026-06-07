import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607170000_qbo_acceptance_bridge_firebase_actor.sql"),
  "utf8"
);

describe("qbo acceptance bridge Firebase actor migration", () => {
  it("patches the bridge to impersonate the company actor by OPS user id and email claim", () => {
    expect(sql).toContain("qbo_acceptance_bridge_firebase_actor_sentinel");
    expect(sql).toContain("request.jwt.claim.email");
    expect(sql).toContain("select u.id, u.id, u.email");
    expect(sql).toContain("jsonb_build_object(''sub'', v_actor_auth_id::text, ''email'', v_actor_email");
  });

  it("removes the impossible UUID parse requirement for Firebase auth_id values", () => {
    expect(sql).toContain("bridge still requires uuid auth_id");
    expect(sql).toContain("private.try_parse_uuid(u.auth_id)");
  });

  it("keeps the bridge service-role only", () => {
    expect(sql).toContain("revoke all on function public.accept_estimate_to_job_from_quickbooks");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.accept_estimate_to_job_from_quickbooks");
    expect(sql).toContain("to service_role");
  });
});
