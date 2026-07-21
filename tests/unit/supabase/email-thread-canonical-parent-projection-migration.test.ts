import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260721131000_email_thread_canonical_parent_projection.sql"
  ),
  "utf8"
).toLowerCase();

describe("email thread canonical parent projection migration", () => {
  it("exposes only a service-role guarded attachment operation", () => {
    expect(migration).toContain(
      "create or replace function public.attach_email_thread_to_opportunity_as_system"
    );
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain(
      "revoke all on function public.attach_email_thread_to_opportunity_as_system"
    );
    expect(migration).toContain(
      "grant execute on function public.attach_email_thread_to_opportunity_as_system"
    );
  });

  it("permits only null-to-parent projection with exact mailbox, link, and delivered-message proof", () => {
    expect(migration).toContain("thread.opportunity_id is not null");
    expect(migration).toContain("email_thread_parent_conflict");
    expect(migration).toMatch(
      /from public\.opportunity_email_threads link[\s\S]*where link\.connection_id = p_connection_id[\s\S]*and link\.thread_id = p_provider_thread_id[\s\S]*v_link_opportunity_id is distinct from p_opportunity_id/
    );
    expect(migration).toMatch(
      /from public\.activities activity[\s\S]*where activity\.company_id = p_company_id[\s\S]*and activity\.email_connection_id = p_connection_id[\s\S]*and activity\.email_thread_id = p_provider_thread_id[\s\S]*and activity\.opportunity_id = p_opportunity_id/
    );
    expect(migration).toContain("connection.status = 'active'");
    expect(migration).toContain("connection.sync_enabled = true");
    expect(migration).toContain("opportunity.deleted_at is null");
    expect(migration).toContain("email_thread_parent_proof_missing");
  });

  it("serializes with data review and locks the mailbox before its thread child", () => {
    const companyLock = migration.indexOf(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    const threadLock = migration.indexOf(
      "perform private.lock_email_thread_data_review("
    );
    const connectionRowLock = migration.indexOf(
      "from public.email_connections connection"
    );
    const rowLock = migration.indexOf("select thread.*");
    expect(companyLock).toBeGreaterThan(-1);
    expect(threadLock).toBeGreaterThan(companyLock);
    expect(connectionRowLock).toBeGreaterThan(threadLock);
    expect(rowLock).toBeGreaterThan(connectionRowLock);
  });

  it("revalidates canonical proof before returning an idempotent receipt", () => {
    const linkProof = migration.indexOf(
      "from public.opportunity_email_threads link"
    );
    const activityProof = migration.indexOf("and activity.opportunity_id =");
    const targetProof = migration.indexOf(
      "from public.opportunities opportunity"
    );
    const idempotentReceipt = migration.indexOf("if v_already_attached then");
    expect(linkProof).toBeGreaterThan(-1);
    expect(activityProof).toBeGreaterThan(linkProof);
    expect(targetProof).toBeGreaterThan(activityProof);
    expect(idempotentReceipt).toBeGreaterThan(targetProof);
  });

  it("mints and consumes one exact child-reparent token inside the guarded transaction", () => {
    expect(migration).toContain(
      "insert into private.opportunity_child_reparent_tokens"
    );
    expect(migration).toContain("'email_threads'");
    expect(migration).toContain("v_thread.id");
    expect(migration).toContain("null::uuid");
    expect(migration).toContain("p_opportunity_id");
    expect(migration).toMatch(
      /update public\.email_threads thread[\s\S]*set opportunity_id = p_opportunity_id[\s\S]*where id = v_thread\.id[\s\S]*and opportunity_id is null/
    );
    expect(migration).toContain(
      "delete from private.opportunity_child_reparent_tokens"
    );
  });
});
