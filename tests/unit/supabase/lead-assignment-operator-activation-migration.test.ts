import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260715181000_lead_assignment_operator_activation.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

describe("lead assignment Operator activation migration", () => {
  it("activates the exact reviewed lead and inbox scopes", () => {
    const source = sql();

    expect(source).toContain("00000000-0000-0000-0000-000000000004");
    expect(source).toContain("'pipeline.create', 'all'");
    for (const permission of [
      "pipeline.view",
      "pipeline.edit",
      "pipeline.assign",
      "pipeline.convert",
      "inbox.view",
      "inbox.send",
    ]) {
      expect(source).toContain(`'${permission}', 'assigned'`);
    }
  });

  it("explicitly removes company-wide inbox compatibility from the preset", () => {
    const source = sql();

    expect(source).toMatch(
      /delete from public\.role_permissions[\s\S]*permission = 'inbox\.view_company'/
    );
    expect(source).toContain("operator_company_inbox_compatibility_remains");
    expect(source).toContain("operator_pipeline_manage_compatibility_remains");
    expect(source).toContain("intentional_narrowing");
  });

  it("locks the preset and affected members, validates dependencies, and records a before-after audit", () => {
    const source = sql();

    expect(source).toContain("for update");
    expect(source).toContain("private.assert_permission_role_valid");
    expect(source).toContain("private.assert_permission_users_valid");
    expect(source).toContain("lead_assignment_operator_activation_audit");
    expect(source).toContain("before_permissions");
    expect(source).toContain("after_permissions");
    expect(source).toContain("affected_user_count");
  });

  it("takes every member company lock before role or user rows and revalidates membership", () => {
    const source = sql();
    const companySnapshot = source.indexOf("v_locked_company_ids");
    const companyLock = source.indexOf(
      "private.lock_lead_assignment_company",
      companySnapshot
    );
    const roleRowLock = source.indexOf("from public.roles r", companyLock);

    expect(companySnapshot).toBeGreaterThan(-1);
    expect(companyLock).toBeGreaterThan(companySnapshot);
    expect(companyLock).toBeLessThan(roleRowLock);
    expect(source).toMatch(
      /unnest\(v_locked_company_ids\)[\s\S]*?order by[\s\S]*?private\.lock_lead_assignment_company/
    );
    expect(source).toContain("operator_membership_company_set_changed");
    expect(source).toMatch(
      /operator_membership_company_set_changed[\s\S]*?errcode = '40001'/
    );
  });

  it("rechecks locked member-user state and company membership before mutating the preset", () => {
    const source = sql();
    const userRowLock = source.indexOf("for update of u");
    const lockedUserStateCheck = source.indexOf(
      "operator_membership_user_state_changed",
      userRowLock
    );
    const lockedCompanySetCheck = source.indexOf(
      "operator_membership_company_set_changed_after_user_lock",
      userRowLock
    );
    const firstPermissionWrite = source.indexOf(
      "delete from public.role_permissions",
      userRowLock
    );

    expect(userRowLock).toBeGreaterThan(-1);
    expect(lockedUserStateCheck).toBeGreaterThan(userRowLock);
    expect(lockedCompanySetCheck).toBeGreaterThan(lockedUserStateCheck);
    expect(firstPermissionWrite).toBeGreaterThan(lockedCompanySetCheck);

    const lockedRevalidation = source.slice(userRowLock, firstPermissionWrite);
    expect(lockedRevalidation).toContain("u.company_id is null");
    expect(lockedRevalidation).toContain("u.deleted_at is not null");
    expect(lockedRevalidation).toContain("coalesce(u.is_active, false)");
    expect(lockedRevalidation).toMatch(
      /operator_membership_user_state_changed[\s\S]*?errcode = '40001'/
    );
    expect(lockedRevalidation).toMatch(
      /operator_membership_company_set_changed_after_user_lock[\s\S]*?errcode = '40001'/
    );
  });

  it("fails closed unless every assignment, inbox, email, and notification prerequisite exists", () => {
    const source = sql();

    for (const prerequisite of [
      "change_opportunity_assignment",
      "private.user_can_view_opportunity",
      "opportunity_assignment_events",
      "opportunity_assignment_deliveries",
      "user_permission_change_deliveries",
      "claim_opportunity_assignment_deliveries",
      "private.user_can_view_opportunity_inbox",
      "private.user_can_send_opportunity_inbox",
      "private.current_user_can_view_email_thread_correction",
      "private.current_user_can_edit_email_thread_correction",
      "private.email_outbound_learning_guard",
      "create_notification_if_new_with_status",
      "sync_email_signature_notification_as_system",
      "process_email_signature_notification_lifecycle",
      "email_signature_notification_lifecycle_outbox",
      "request_lockout_admin_notification",
    ]) {
      expect(source).toContain(prerequisite);
    }
  });

  it("requires both canonical internal SPEC guards before activation", () => {
    const source = sql();

    expect(source).toContain(
      "private.is_canonical_internal_permission_override(text,uuid,text,boolean)"
    );
    expect(source).toContain(
      "private.is_canonical_internal_role_permission(uuid,text,text)"
    );
  });
});
