import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715174000_email_analysis_requester_fence.sql"
  ),
  "utf8"
).toLowerCase();

describe("email analysis requester fence migration", () => {
  it("persists immutable requester and connection-owner snapshots", () => {
    expect(sql).toContain("requested_by_user_id");
    expect(sql).toContain("connection_owner_user_id");
    expect(sql).toContain(
      "before update of company_id, connection_id, requested_by_user_id"
    );
    expect(sql).toContain("new.company_id is distinct from old.company_id");
    expect(sql).toContain(
      "new.connection_id is distinct from old.connection_id"
    );
    expect(sql).toContain("is distinct from old.requested_by_user_id");
    expect(sql).toContain("is distinct from old.connection_owner_user_id");
    expect(sql).toContain("before insert on public.gmail_scan_jobs");
    expect(sql).toContain("private.resolve_email_connection_identity");
    expect(sql).toContain("identity.owner_user_id");
    expect(sql).toContain("new.connection_owner_user_id := v_owner_user_id");
  });

  it("never treats a company mailbox connector user as its owner", () => {
    expect(sql).toContain("connection.type::text = 'individual'");
    expect(sql).toContain("then owner.id");
    expect(sql).toContain("else null::uuid");
    expect(sql).toContain("owner.id::text = connection.user_id");
    expect(sql).toContain("owner.company_id = company.id");
    expect(sql).toContain("owner.deleted_at is null");
    expect(sql).toContain("coalesce(owner.is_active, false)");
    expect(sql).toContain(
      "set connection_owner_user_id = identity.owner_user_id"
    );
    expect(sql).not.toContain(
      "set connection_owner_user_id = connection.user_id"
    );
  });

  it("does not expose scan jobs or the definer guard to application roles", () => {
    expect(sql).toContain(
      "revoke all on function private.guard_email_analysis_requester_snapshot"
    );
    expect(sql).toContain(
      "revoke all on function private.set_email_analysis_owner_snapshot"
    );
    expect(sql).not.toMatch(
      /grant\s+(insert|update|delete).*gmail_scan_jobs.*authenticated/
    );
  });

  it("rejects service-written requester snapshots that lack current mailbox authority", () => {
    expect(sql).toContain("new.requested_by_user_id");
    expect(sql).toContain("actor.company_id::text = new.company_id");
    expect(sql).toContain("actor.deleted_at is null");
    expect(sql).toContain("coalesce(actor.is_active, false)");
    expect(sql).not.toContain("actor.is_active is distinct from false");
    expect(sql).toContain(
      "new.requested_by_user_id is distinct from v_owner_user_id"
    );
    expect(sql).toMatch(
      /public\.has_permission\(\s*new\.requested_by_user_id,\s*'settings\.integrations',\s*'all'/
    );
  });

  it("publishes Phase B results atomically under current requester authority", () => {
    expect(sql).toContain(
      "public.complete_email_analysis_job_as_system"
    );
    expect(sql).toContain("private.lock_lead_assignment_company");
    expect(sql).toContain("for update");
    expect(sql).toContain("for share");
    expect(sql).toContain("job.requested_by_user_id is distinct from p_actor_user_id");
    expect(sql).toContain("connection.sync_enabled");
    expect(sql).toContain("connection.status not in ('active', 'setup_incomplete')");
    expect(sql).toContain("identity.connection_type = 'individual'");
    expect(sql).toMatch(
      /public\.has_permission\(\s*p_actor_user_id,\s*'settings\.integrations',\s*'all'/
    );
    expect(sql).toContain("update public.gmail_scan_jobs");
    expect(sql).toContain("update public.email_connections");
    expect(sql).toContain("grant execute on function public.complete_email_analysis_job_as_system");
    expect(sql).not.toMatch(
      /grant execute on function public\.complete_email_analysis_job_as_system[\s\S]{0,100}to authenticated/
    );
  });
});
