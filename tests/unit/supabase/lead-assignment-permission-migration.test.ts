import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715161000_lead_assignment_permission_migration.sql"
);

const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

function body(name: string): string {
  const marker = `create or replace function ${name}`;
  const lower = source.toLowerCase();
  const start = lower.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("lead assignment permission migration", () => {
  it("uses the locked migration slot without activating Operator lead access", () => {
    expect(migrationPath).toMatch(
      /20260715161000_lead_assignment_permission_migration\.sql$/
    );
    expect(source).toMatch(/migration_key[^\n]*20260715161000/i);
    expect(source).not.toMatch(
      /insert\s+into\s+public\.role_permissions[\s\S]{0,500}operator[\s\S]{0,500}pipeline\.(create|view|edit|assign|convert)/i
    );
    expect(source).toMatch(/deferred_operator_activation/i);
    expect(source).toMatch(/operator[^;]*inbox[^;]*unchanged/i);
  });

  it("captures deterministic before and after snapshots of every role and override", () => {
    expect(source).toMatch(
      /create table private\.lead_assignment_permission_migration_snapshots/i
    );
    expect(source).toMatch(
      /create table private\.lead_assignment_permission_migration_diffs/i
    );
    expect(source).toMatch(/phase[^\n]*(before|after)/i);
    expect(source).toMatch(/subject_kind[^\n]*(role|user_override)/i);
    expect(source).toMatch(/jsonb_agg\([\s\S]*?order by[\s\S]*?permission/i);
    expect(source).toMatch(/snapshot_hash/i);
    expect(source).toMatch(/pg_catalog\.md5|md5\(/i);
    expect(source).toMatch(
      /revoke all on table private\.lead_assignment_permission_migration_snapshots\s+from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke all on table private\.lead_assignment_permission_migration_diffs\s+from public, anon, authenticated/i
    );
  });

  it("maps only reviewed compatibility rows and retains every legacy row", () => {
    for (const permission of [
      "pipeline.create",
      "pipeline.edit",
      "pipeline.assign",
      "pipeline.convert",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `pipeline\\.manage[\\s\\S]*?${permission.replace(".", "\\.")}`,
          "i"
        )
      );
    }
    expect(source).toMatch(
      /pipeline\.manage[\s\S]*?granted[\s\S]*?false[\s\S]*?pipeline\.(create|edit|assign|convert)/i
    );
    expect(source).toMatch(/inbox\.view_company[\s\S]*?inbox\.view/i);
    expect(source).toMatch(/expected legacy rows remain|legacy rows remain/i);
    expect(source).toMatch(/equivalent_compatibility_expansion/i);
  });

  it("aborts every unreviewed or access-widening legacy shape", () => {
    expect(source).toMatch(/ambiguous_legacy_permission_shape/i);
    expect(source).toMatch(/custom_role_configuration_not_reviewed/i);
    expect(source).toMatch(/pipeline\.view[\s\S]*?assigned/i);
    expect(source).toMatch(/standalone_inbox_view_not_reviewed/i);
    expect(source).toMatch(/ambiguous_inbox_company_revoke/i);
    expect(source).toMatch(/granted[\s\S]*?scope is null[\s\S]*?inert/i);
  });

  it("pins the complete editable registry while excluding hidden compatibility keys", () => {
    expect(source).toMatch(
      /create table private\.lead_permission_editor_registry/i
    );
    for (const permission of [
      "projects.view",
      "pipeline.create",
      "pipeline.view",
      "pipeline.edit",
      "pipeline.assign",
      "pipeline.convert",
      "inbox.view",
      "inbox.send",
      "team.assign_roles",
    ]) {
      expect(source).toContain(`'${permission}'`);
    }
    const registry = source.match(
      /insert into private\.lead_permission_editor_registry[\s\S]*?;/i
    )?.[0];
    expect(registry).toBeDefined();
    expect(registry).not.toContain("'pipeline.manage'");
    expect(registry).not.toContain("'inbox.view_company'");
    expect(registry).not.toContain("'spec.admin'");
  });

  it("defines the three exact service-only atomic RPC contracts", () => {
    const signatures = [
      {
        name: "public.replace_role_permissions_as_system",
        args: "uuid, uuid, jsonb, jsonb, jsonb",
      },
      {
        name: "public.apply_user_permission_overrides_as_system",
        args: "uuid, uuid, jsonb, jsonb, text[], jsonb",
      },
      {
        name: "public.replace_user_role_as_system",
        args: "uuid, uuid, uuid, uuid, jsonb",
      },
    ];

    for (const { name, args } of signatures) {
      const fn = body(name);
      expect(fn).toMatch(/returns jsonb/i);
      expect(fn).toMatch(/security definer/i);
      expect(fn).toMatch(
        /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
      );
      expect(fn).toMatch(/auth\.role\(\)[\s\S]*?service_role/i);
      const escaped = name.replaceAll(".", "\\.");
      const signature = args
        .split(",")
        .map((arg) => arg.trim().replaceAll("[", "\\[").replaceAll("]", "\\]"))
        .join("\\s*,\\s*");
      expect(source).toMatch(
        new RegExp(
          `revoke all on function ${escaped}\\(\\s*${signature}\\s*\\)\\s+from public, anon, authenticated, service_role[\\s\\S]*?grant execute on function ${escaped}\\(\\s*${signature}\\s*\\)\\s+to service_role`,
          "i"
        )
      );
    }
  });

  it("derives actor company and authority server-side under one company lock", () => {
    for (const name of [
      "public.replace_role_permissions_as_system",
      "public.apply_user_permission_overrides_as_system",
      "public.replace_user_role_as_system",
    ]) {
      const fn = body(name);
      expect(fn).toMatch(
        /from public\.users[\s\S]*?company_id[\s\S]*?deleted_at is null[\s\S]*?is_active/i
      );
      expect(fn).toMatch(/team\.assign_roles[\s\S]*?'all'/i);
      expect(fn).toMatch(
        /private\.lock_lead_assignment_company\(v_actor_company_id\)/i
      );
      expect(fn).not.toMatch(/p_company_id/i);
      expect(fn).not.toMatch(/email\s*=/i);
    }
  });

  it("serializes guarded assignment, guarded create, and permission changes at one company boundary", () => {
    const lock = body("private.lock_lead_assignment_company");
    expect(lock).toMatch(/pg_advisory_xact_lock/i);
    expect(lock).toMatch(/hashtextextended/i);
    expect(lock).toMatch(/p_company_id/i);

    for (const name of [
      "public.change_opportunity_assignment",
      "public.change_opportunity_assignment_as_system",
      "public.create_opportunity_guarded",
      "public.replace_role_permissions_as_system",
      "public.apply_user_permission_overrides_as_system",
      "public.replace_user_role_as_system",
    ]) {
      const fn = body(name);
      const lockPosition = fn.indexOf("lock_lead_assignment_company");
      expect(
        lockPosition,
        `${name} does not take the company lock`
      ).toBeGreaterThan(-1);

      const delegatedCallPosition = fn.indexOf("_company_serialized_internal");
      if (delegatedCallPosition >= 0) {
        expect(
          lockPosition,
          `${name} delegates before taking the company lock`
        ).toBeLessThan(delegatedCallPosition);
      }
    }

    expect(body("private.assert_direct_permission_user")).toMatch(
      /private\.lock_lead_assignment_company\(v_company_id\)/i
    );

    for (const internalName of [
      "private.change_assignment_company_serialized_internal",
      "private.change_assignment_system_company_serialized_internal",
      "private.create_opportunity_company_serialized_internal",
    ]) {
      expect(source.toLowerCase()).toContain(internalName);
      expect(source).toMatch(
        new RegExp(
          `revoke all on function ${internalName.replaceAll(".", "\\.")}`,
          "i"
        )
      );
    }
  });

  it("uses the guarded facade's revoke-safe target eligibility everywhere", () => {
    const eligibility = body(
      "private.user_is_guarded_assignment_target_eligible"
    );
    expect(eligibility).toMatch(
      /public\.has_permission\([\s\S]*?'pipeline\.view'[\s\S]*?'assigned'/i
    );
    expect(eligibility).not.toMatch(
      /raw_pipeline_scope_for_user|effective_pipeline_scope_for_user|should_use_pipeline_manage_compat/i
    );

    const resolutions = body(
      "private.enforce_permission_assignment_resolutions"
    );
    expect(
      resolutions.match(/private\.user_is_guarded_assignment_target_eligible/g)
        ?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
  });

  it("enforces canonical snapshots, payload shape, scopes, and dependencies", () => {
    expect(source).toMatch(/permission_snapshot_mismatch/i);
    expect(source).toMatch(/invalid_permission_dependencies/i);
    expect(source).toMatch(/duplicate_permission/i);
    expect(source).toMatch(/unsupported_scope/i);
    expect(source).toMatch(/create_requires_view/i);
    expect(source).toMatch(/edit_exceeds_view/i);
    expect(source).toMatch(/assign_exceeds_edit/i);
    expect(source).toMatch(/convert_exceeds_edit/i);
    expect(source).toMatch(/scope_rank/i);
    expect(source).toMatch(/jsonb_typeof/i);
    expect(source).toMatch(/expected_permissions/i);
    expect(source).toMatch(/expected_overrides/i);
    expect(source).toMatch(/is not distinct from p_expected_role_id/i);
  });

  it("guards preset, admin, inactive, and cross-company mutations", () => {
    const role = body("public.replace_role_permissions_as_system");
    expect(role).toMatch(
      /is_preset[\s\S]*?(preset_role_immutable|access_denied)/i
    );
    expect(role).toMatch(/company_id[\s\S]*?access_denied/i);

    for (const name of [
      "public.apply_user_permission_overrides_as_system",
      "public.replace_user_role_as_system",
    ]) {
      const fn = body(name);
      expect(fn).toMatch(/target_is_admin/i);
      expect(fn).toMatch(/company_id[\s\S]*?access_denied/i);
    }
  });

  it("detects only active responsibility assignments in stable order", () => {
    expect(source).toMatch(
      /deleted_at is null[\s\S]*?archived_at is null[\s\S]*?stage not in \('won', 'lost', 'discarded'\)/i
    );
    expect(source).toMatch(/order by o\.id[\s\S]*?for update/i);
    expect(source).toMatch(/assignment_resolution_required/i);
    expect(source).toMatch(/terminal assignments remain|terminal/i);
  });

  it("requires an exact optimistic transfer plan and safe actor-gated details", () => {
    expect(source).toMatch(/expected_assigned_to/i);
    expect(source).toMatch(/expected_assignment_version/i);
    expect(source).toMatch(/new_assigned_to/i);
    expect(source).toMatch(/missing_resolution/i);
    expect(source).toMatch(/extra_resolution/i);
    expect(source).toMatch(/duplicate_resolution/i);
    expect(source).toMatch(/no_op_resolution/i);
    expect(source).toMatch(/assignment_resolution_conflict/i);
    expect(source).toMatch(
      /pipeline\.assign[\s\S]*?'all'[\s\S]*?eligible_assignees/i
    );
    expect(source).toMatch(/pipeline\.view[\s\S]*?'all'/i);
  });

  it("moves assignments only through the guarded permission_change facade", () => {
    expect(source).toMatch(
      /public\.change_opportunity_assignment_as_system\([\s\S]*?'permission_change'/i
    );
    expect(source).toMatch(/mutation_kind/i);
    expect(source).toMatch(/disposition/i);
    expect(source).not.toMatch(
      /update\s+public\.opportunities[\s\S]*?set[\s\S]*?assigned_to/i
    );
    expect(source).not.toMatch(/set_config\([^)]*(permission|mutation)/i);
  });

  it("guards direct legacy table writes with deferred final-state checks", () => {
    for (const table of [
      "role_permissions",
      "user_permission_overrides",
      "user_roles",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `create constraint trigger[^;]*${table}[\\s\\S]*?deferrable initially deferred`,
          "i"
        )
      );
    }
    expect(source).toMatch(/direct_permission_write_invalid/i);
    expect(source).toMatch(/permission_change_would_strand_assignments/i);
  });

  it("updates user_roles and the legacy users.role mirror in the same RPC", () => {
    const fn = body("public.replace_user_role_as_system");
    expect(fn).toMatch(/delete from public\.user_roles/i);
    expect(fn).toMatch(/insert into public\.user_roles/i);
    expect(fn).toMatch(/update public\.users[\s\S]*?role =/i);
    expect(fn).toMatch(/is_preset[\s\S]*?company_id/i);
    expect(fn).toMatch(/unassigned/i);
  });

  it("keeps the runtime SQL contract exhaustive and rollback-only", () => {
    const contractPath = path.join(
      process.cwd(),
      "tests/sql/lead-assignment-permission-contract.sql"
    );
    const contract = existsSync(contractPath)
      ? readFileSync(contractPath, "utf8")
      : "";

    expect(contract).toMatch(/^begin;/im);
    expect(contract).toMatch(/rollback;\s*$/i);
    for (const marker of [
      "service_only_execution",
      "preset_role_rejected",
      "target_is_admin",
      "permission_snapshot_mismatch",
      "invalid_permission_dependencies",
      "assignment_resolution_required",
      "terminal_assignment_retained",
      "exact_unassign_succeeds",
      "exact_transfer_succeeds",
      "duplicate_resolution_rejected",
      "assignment_aba_conflict",
      "cross_company_transfer_rejected",
      "legacy_compat_target_excluded",
      "role_delete_cannot_strand",
      "direct_write_cannot_strand",
      "operator_not_activated",
    ]) {
      expect(contract).toContain(marker);
    }

    const concurrencyPath = path.join(
      process.cwd(),
      "tests/sql/lead-assignment-permission-concurrency-contract.sql"
    );
    const concurrency = existsSync(concurrencyPath)
      ? readFileSync(concurrencyPath, "utf8")
      : "";
    expect(concurrency).toContain("SESSION A :: PERMISSION REDUCTION");
    expect(concurrency).toContain("SESSION B :: CONCURRENT ASSIGNMENT");
    expect(concurrency).toContain("assignment_target_ineligible");
    expect(concurrency).toMatch(/assigned_to\s+is\s+null/i);
    expect(concurrency).toMatch(/assignment_version\s*=\s*0/i);
  });
});
