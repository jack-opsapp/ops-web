import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260615210000_qbo_acceptance_actor_firebase_subject_crit3_fix.sql"
  ),
  "utf8"
);

describe("qbo acceptance actor firebase subject crit3 fix migration", () => {
  it("is sentinel-guarded", () => {
    expect(sql).toContain("qbo_acceptance_actor_subject_sentinel");
  });

  it("adds a SECURITY DEFINER helper to resolve the actor auth.users id", () => {
    expect(sql).toContain(
      "create or replace function private.current_actor_auth_user_id()"
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("join auth.users actor_auth");
    expect(sql).toContain("where actor_user.id = private.get_current_user_id()");
    // callable by the roles that reach it; not world-executable
    expect(sql).toContain(
      "revoke all on function private.current_actor_auth_user_id() from public"
    );
    expect(sql).toContain("to anon, authenticated, service_role");
  });

  it("removes the auth.uid() cast from the shared sync and uses the helper", () => {
    // the replacement (new) sync fragment must not cast auth.uid() nor read auth.users
    const parts = sql.split("$new$");
    expect(parts.length).toBeGreaterThan(1);
    const syncNewFragment = parts[1];
    expect(syncNewFragment).not.toContain("auth.uid()");
    expect(syncNewFragment).not.toContain("auth.users");
    expect(syncNewFragment).toContain(
      "v_actor_auth_id := private.current_actor_auth_user_id();"
    );
    // post-apply sentinels enforce the live definition is auth.uid()-free and
    // does not read auth.users directly
    expect(sql).toContain(
      "qbo_acceptance_actor_subject_sentinel: sync still calls auth.uid() after migration"
    );
    expect(sql).toContain(
      "qbo_acceptance_actor_subject_sentinel: sync must not read auth.users directly (use the definer helper)"
    );
    // idempotent: only rewrites sync while it still calls auth.uid()
    expect(sql).toContain("if v_functiondef ~ 'auth\\.uid\\(\\)' then");
  });

  it("resolves the bridge actor subject from the Firebase identity", () => {
    expect(sql).toContain("v_actor_subject");
    expect(sql).toContain("coalesce(u.auth_id, u.firebase_uid)");
    expect(sql).toContain(
      "into v_actor_id, v_actor_auth_id, v_actor_email, v_actor_subject"
    );
  });

  it("sets the request.jwt sub from the Firebase subject, never the auth.users uuid", () => {
    expect(sql).toContain(
      "set_config('request.jwt.claim.sub', v_actor_subject, true)"
    );
    expect(sql).toContain(
      "jsonb_build_object('sub', v_actor_subject, 'role', 'authenticated')"
    );
    expect(sql).toContain(
      "qbo_acceptance_actor_subject_sentinel: bridge still sets jwt sub from the auth.users uuid"
    );
  });

  it("drops the vestigial email claim to honor crit3 subject-only resolution", () => {
    // the new claims object carries sub + role only (no email key)
    expect(sql).not.toContain(
      "jsonb_build_object('sub', v_actor_subject, 'email'"
    );
    // and a post-condition rejects any reintroduction of the email claim
    expect(sql).toContain(
      "qbo_acceptance_actor_subject_sentinel: bridge still sets the email claim after migration"
    );
  });

  it("keeps the bridge service-role only", () => {
    expect(sql).toContain(
      "revoke all on function public.accept_estimate_to_job_from_quickbooks"
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain(
      "grant execute on function public.accept_estimate_to_job_from_quickbooks"
    );
    expect(sql).toContain("to service_role");
  });

  it("is idempotent (re-applying is guarded to a no-op)", () => {
    expect(sql).toContain("if v_functiondef not like '%v_actor_subject%' then");
  });
});
