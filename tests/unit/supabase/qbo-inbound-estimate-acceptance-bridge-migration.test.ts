import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260605110000_qbo_inbound_estimate_acceptance_bridge.sql"
  ),
  "utf8"
);

describe("qbo inbound estimate acceptance bridge migration", () => {
  it("creates a service-role-only QuickBooks estimate acceptance bridge", () => {
    expect(sql).toContain(
      "create or replace function public.accept_estimate_to_job_from_quickbooks"
    );
    expect(sql).toContain(
      "grant execute on function public.accept_estimate_to_job_from_quickbooks"
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("revoke all on function public.accept_estimate_to_job_from_quickbooks");
    expect(sql).toContain("from public");
    expect(sql).toContain("from anon");
    expect(sql).toContain("from authenticated");
  });

  it("validates connection, estimate linkage, and company-owned actor derivation", () => {
    expect(sql).toContain("accounting_connections");
    expect(sql).toContain("provider = 'quickbooks'");
    expect(sql).toContain("company_id::text = p_company_id::text");
    expect(sql).toContain("sync_enabled is true");
    expect(sql).toContain("sync_direction <> 'push_only'");
    expect(sql).toContain("account_holder_id");
    expect(sql).toContain("admin_ids");
    expect(sql).toContain("private.try_parse_uuid(u.auth_id)");
    expect(sql).toContain("set_config('request.jwt.claim.sub'");
    expect(sql).toContain("set_config('request.jwt.claim.role', 'authenticated'");
    expect(sql).toContain("set_config('ops.accept_estimate_to_job_rpc', 'on'");
    expect(sql).toContain("integration_acceptance_actor_not_found");
    expect(sql).toContain("integration_acceptance_actor_auth_not_found");
    expect(sql).toContain("integration_acceptance_estimate_not_linked");
  });

  it("preserves the Phase 6 acceptance contract", () => {
    expect(sql).toContain("accept_estimate_to_job_requests");
    expect(sql).toContain("'in_progress'");
    expect(sql).toContain("'completed'");
    expect(sql).not.toContain("'processing'");
    expect(sql).not.toContain("status = 'succeeded'");
    expect(sql).not.toContain("status = 'failed'");
    expect(sql).toContain("private.sync_accepted_estimate_project_tasks");
    expect(sql).toContain("private.sync_accepted_estimate_project_tasks(p_estimate_id)");
    expect(sql).toContain("private.try_parse_uuid(v_project_task_result ->> 'project_id')");
    expect(sql).toContain("private.persist_estimate_material_booking_projection");
    expect(sql).toContain("p_estimate_id,\n    v_project_id");
    expect(sql).toContain(
      "private.persist_catalog_mapping_notifications_from_missing_mappings"
    );
    expect(sql).toContain("p_company_id,\n      coalesce(v_booking_projection_result");
    expect(sql).toContain("physical stock deduction");
    expect(sql).not.toContain("complete_project_task(");
  });
});
