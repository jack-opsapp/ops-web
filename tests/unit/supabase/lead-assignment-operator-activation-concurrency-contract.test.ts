import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const artifactPath = resolve(
  process.cwd(),
  "tests/sql/lead-assignment-operator-activation-concurrency-contract.sql"
);
const artifact = existsSync(artifactPath)
  ? readFileSync(artifactPath, "utf8").toLowerCase()
  : "";

function section(start: string, end?: string): string {
  const startIndex = artifact.indexOf(start.toLowerCase());
  expect(startIndex, `${start} marker missing`).toBeGreaterThanOrEqual(0);
  if (!end) return artifact.slice(startIndex);

  const endIndex = artifact.indexOf(
    end.toLowerCase(),
    startIndex + start.length
  );
  expect(endIndex, `${end} marker missing`).toBeGreaterThan(startIndex);
  return artifact.slice(startIndex, endIndex);
}

describe("lead assignment Operator activation two-session contract", () => {
  it("is an explicit pre-181000 isolated-database artifact that runs the exact migration", () => {
    expect(existsSync(artifactPath)).toBe(true);
    expect(artifact).toContain("isolated database only");
    expect(artifact).toContain("fresh pre-181000 database snapshot");
    expect(artifact).toContain("through 20260715180900 applied");
    expect(artifact).toContain(
      "20260715181000_lead_assignment_operator_activation.sql"
    );
    expect(artifact).toContain("do not run this file as one session");
  });

  it("uses bounded lock-observation barriers instead of scheduling sleeps", () => {
    expect(artifact).toContain("pg_catalog.pg_blocking_pids");
    expect(artifact).toContain("pg_catalog.pg_locks");
    expect(artifact).toContain("pg_catalog.pg_stat_activity");
    expect(artifact).toContain("clock_timestamp() >= v_deadline");
    expect(artifact).toContain("activation_concurrency_barrier_timeout");
    expect(artifact).not.toMatch(/pg_sleep\(\s*[1-9][0-9]*(?:\.0+)?\s*\)/);
  });

  it("makes guarded assignment wait on the member-company lock and then succeed", () => {
    const scenario = section(
      "scenario 1 :: guarded assignment",
      "scenario 2 :: late new-company membership"
    );
    const sessionA = section(
      "scenario 1 / session a :: activation",
      "scenario 1 / session b :: guarded assignment"
    );
    const sessionB = section(
      "scenario 1 / session b :: guarded assignment",
      "scenario 1 / verify"
    );

    expect(sessionA).toMatch(
      /lock_lead_assignment_company[\s\S]*?pg_advisory_lock\(181000, 1\)[\s\S]*?await_lead_assignment_activation_block/
    );
    expect(sessionB).toMatch(
      /await_lead_assignment_activation_signal[\s\S]*?change_opportunity_assignment_as_system/
    );
    expect(sessionB).toContain("'system_repair'");
    expect(scenario).toMatch(
      /assigned_to\s*=\s*'18000000-0000-4000-8000-000000000101'/
    );
    expect(scenario).toMatch(/assignment_version\s*=\s*1/);
    expect(scenario).toContain("assignment_concurrency_contract_passed");
  });

  it("makes a new-company role replacement win the role lock and forces a retryable activation abort", () => {
    const scenario = section(
      "scenario 2 :: late new-company membership",
      "scenario 3 :: locked member-user revalidation"
    );
    const sessionB = section(
      "scenario 2 / session b :: role replacement",
      "scenario 2 / session a :: activation"
    );
    const sessionA = section(
      "scenario 2 / session a :: activation",
      "scenario 2 / verify"
    );

    expect(sessionB).toMatch(
      /replace_user_role_as_system[\s\S]*?'00000000-0000-0000-0000-000000000004'[\s\S]*?pg_advisory_lock\(181000, 2\)/
    );
    expect(sessionB).toContain("await_lead_assignment_activation_block");
    expect(sessionA).toContain("await_lead_assignment_activation_signal");
    expect(sessionA).toContain("operator_membership_company_set_changed");
    expect(sessionA).toContain("sqlstate 40001");
    expect(scenario).toContain("late_membership_retry_contract_passed");
    expect(scenario).toMatch(
      /to_regclass\('private\.lead_assignment_operator_activation_audit'\)\s+is\s+null/
    );
  });

  it("holds a member user row through activation and rejects its late company/deletion change", () => {
    const scenario = section("scenario 3 :: locked member-user revalidation");
    const sessionB = section(
      "scenario 3 / session b :: member lifecycle write",
      "scenario 3 / session a :: activation"
    );
    const sessionA = section(
      "scenario 3 / session a :: activation",
      "scenario 3 / verify"
    );

    expect(sessionB).toMatch(
      /update public\.users[\s\S]*?company_id\s*=\s*'18000000-0000-4000-8000-000000000002'[\s\S]*?deleted_at\s*=\s*clock_timestamp\(\)/
    );
    expect(sessionB).toMatch(
      /pg_advisory_lock\(181000, 3\)[\s\S]*?await_lead_assignment_activation_block/
    );
    expect(sessionA).toContain("await_lead_assignment_activation_signal");
    expect(sessionA).toContain("operator_membership_user_state_changed");
    expect(sessionA).toContain("sqlstate 40001");
    expect(scenario).toContain("member_user_revalidation_contract_passed");
    expect(scenario).toMatch(
      /to_regclass\('private\.lead_assignment_operator_activation_audit'\)\s+is\s+null/
    );
  });

  it("keeps test coordination private and verifies both sessions are lock-bounded", () => {
    expect(artifact).toMatch(
      /revoke all on table private\.lead_assignment_operator_activation_concurrency_sessions[\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(artifact).toMatch(
      /revoke all on function private\.register_lead_assignment_activation_session/
    );
    expect(artifact).toMatch(/set local lock_timeout\s*=\s*'30s'/g);
    expect(artifact).toMatch(/set local statement_timeout\s*=\s*'45s'/g);
    expect(artifact).toContain("request.jwt.claim.role");
    expect(artifact).toContain("service_role");
  });
});
