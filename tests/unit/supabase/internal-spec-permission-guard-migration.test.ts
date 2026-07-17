import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260715180900_internal_spec_permission_guard.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex, `${start} marker missing`).toBeGreaterThan(-1);
  expect(endIndex, `${end} marker missing`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("internal SPEC permission guard migration", () => {
  it("locks both protected permission stores before replacing their deferred guards", () => {
    const source = sql();
    const prerequisitesEnd =
      source.indexOf("$prerequisites$;") + "$prerequisites$;".length;
    const tableLock = source.indexOf(
      "lock table public.role_permissions, public.user_permission_overrides, public.user_roles in share mode"
    );
    const firstGuardReplacement = source.indexOf(
      "create or replace function private.is_canonical_internal_permission_override"
    );

    expect(prerequisitesEnd).toBeGreaterThan("$prerequisites$;".length - 1);
    expect(tableLock).toBeGreaterThan(prerequisitesEnd);
    expect(tableLock).toBeLessThan(firstGuardReplacement);
  });

  it("requires all three enabled deferred guard triggers before taking the install lock", () => {
    const source = sql();
    const prerequisites = section(
      source,
      "do $prerequisites$",
      "$prerequisites$;"
    );

    for (const trigger of [
      "trg_role_permissions_final_state",
      "trg_user_permission_overrides_final_state",
      "trg_user_roles_final_state",
    ]) {
      expect(prerequisites).toContain(trigger);
    }
    expect(prerequisites).toContain("t.tgdeferrable");
    expect(prerequisites).toContain("t.tginitdeferred");
    expect(prerequisites).toContain("t.tgenabled in ('o', 'a')");
  });

  it("accepts only the exact protected SPEC override tuple", () => {
    const source = sql();
    const helper = section(
      source,
      "create or replace function private.is_canonical_internal_permission_override",
      "create or replace function private.assert_direct_permission_user"
    );

    expect(helper).toContain("p_permission = 'spec.admin'");
    expect(helper).toContain("00000000-0000-0000-0000-00000000000a");
    expect(helper).toMatch(/p_scope\s*=\s*'all'/);
    expect(helper).toMatch(/p_granted\s+is\s+true/);
    expect(helper).toMatch(/select coalesce\([\s\S]*false[\s\S]*\)/);
  });

  it("accepts only the dedicated SPEC Operator role grant tuple", () => {
    const source = sql();
    const helper = section(
      source,
      "create or replace function private.is_canonical_internal_role_permission",
      "create or replace function private.assert_direct_permission_user"
    );

    expect(helper).toContain("00000000-0000-0000-0000-0000000000a1");
    expect(helper).toContain("p_permission = 'spec.admin'");
    expect(helper).toMatch(/p_scope\s*=\s*'all'/);
  });

  it("keeps malformed protected rows and ordinary cross-company rows fail-closed", () => {
    const source = sql();
    const directGuard = section(
      source,
      "create or replace function private.assert_direct_permission_user",
      "create or replace function public.apply_user_permission_overrides_as_system"
    );
    const overrideRpc = section(
      source,
      "create or replace function public.apply_user_permission_overrides_as_system",
      "revoke all on function private.is_canonical_internal_permission_override"
    );

    for (const body of [directGuard, overrideRpc]) {
      expect(body).toContain("upo.permission = 'spec.admin'");
      expect(body).toContain(
        "private.is_canonical_internal_permission_override"
      );
      expect(body).toContain("protected_permission_override_invalid");
      expect(body).toContain("upo.company_id is distinct from");
      expect(body).toContain("stale_company_override");
    }

    expect(directGuard).toContain("errcode = '23514'");
    expect(overrideRpc).toContain("errcode = '22023'");
  });

  it("validates the live protected permission set before allowing the migration to commit", () => {
    const source = sql();
    const existingRows = section(source, "do $existing_rows$", "commit;");

    expect(existingRows).toContain("upo.permission = 'spec.admin'");
    expect(existingRows).toContain("rp.permission = 'spec.admin'");
    expect(existingRows).toContain("ur.role_id =");
    expect(existingRows).toContain("unexpected_internal_spec_role_membership");
    expect(existingRows).toContain(
      "left join public.users u on u.id = upo.user_id"
    );
    expect(existingRows).toContain("u.deleted_at is not null");
    expect(existingRows).toContain("not coalesce(u.is_active, false)");
    expect(existingRows).toMatch(
      /select count\(\*\)[\s\S]*is_canonical_internal_permission_override[\s\S]*<> 1/
    );
    expect(existingRows).toContain(
      "upo.company_id is distinct from u.company_id"
    );
    expect(existingRows).toContain(
      "private.is_canonical_internal_permission_override"
    );
    expect(existingRows).toContain("errcode = '55000'");
  });

  it("makes protected SPEC overrides immutable to generic direct table writes", () => {
    const source = sql();
    const directWriteTrigger = section(
      source,
      "create or replace function private.guard_user_overrides_final_state",
      "revoke all on function private.is_canonical_internal_permission_override"
    );

    expect(directWriteTrigger).toMatch(
      /tg_op in \('update', 'delete'\)[\s\S]*old\.permission = 'spec\.admin'/
    );
    expect(directWriteTrigger).toMatch(
      /tg_op in \('insert', 'update'\)[\s\S]*new\.permission = 'spec\.admin'/
    );
    expect(directWriteTrigger).toContain(
      "direct_permission_write_invalid: protected_permission_override"
    );
    expect(directWriteTrigger).toContain("errcode = '23514'");
    expect(source).toMatch(
      /revoke all on function private\.guard_user_overrides_final_state\(\)[\s\S]*?from public, anon, authenticated, service_role/
    );
  });

  it("makes the protected SPEC role grant immutable to generic direct table writes", () => {
    const source = sql();
    const directWriteTrigger = section(
      source,
      "create or replace function private.guard_role_permissions_final_state",
      "create or replace function private.guard_user_overrides_final_state"
    );

    expect(directWriteTrigger).toMatch(
      /tg_op in \('update', 'delete'\)[\s\S]*old\.permission = 'spec\.admin'/
    );
    expect(directWriteTrigger).toMatch(
      /tg_op in \('insert', 'update'\)[\s\S]*new\.permission = 'spec\.admin'/
    );
    expect(directWriteTrigger).toContain(
      "direct_permission_write_invalid: protected_role_permission"
    );
    expect(directWriteTrigger).toContain("errcode = '23514'");
    expect(source).toMatch(
      /revoke all on function private\.guard_role_permissions_final_state\(\)[\s\S]*?from public, anon, authenticated, service_role/
    );
  });

  it("makes SPEC Operator membership immutable to generic role-assignment writes", () => {
    const source = sql();
    const directWriteTrigger = section(
      source,
      "create or replace function private.guard_user_roles_final_state",
      "revoke all on function private.is_canonical_internal_permission_override"
    );

    expect(directWriteTrigger).toMatch(
      /tg_op in \('update', 'delete'\)[\s\S]*old\.role_id = '00000000-0000-0000-0000-0000000000a1'/
    );
    expect(directWriteTrigger).toMatch(
      /tg_op in \('insert', 'update'\)[\s\S]*new\.role_id = '00000000-0000-0000-0000-0000000000a1'/
    );
    expect(directWriteTrigger).toContain(
      "direct_permission_write_invalid: protected_role_membership"
    );
    expect(directWriteTrigger).toContain("errcode = '23514'");
    expect(source).toMatch(
      /revoke all on function private\.guard_user_roles_final_state\(\)[\s\S]*?from public, anon, authenticated, service_role/
    );
  });

  it("requires the OPS Operations anchor and preserves the RPC privilege boundary", () => {
    const source = sql();

    expect(source).toContain("from public.companies c");
    expect(source).toContain("c.deleted_at is null");
    expect(source).toMatch(
      /revoke all on function private\.is_canonical_internal_permission_override\([\s\S]*?from public, anon, authenticated, service_role/
    );
    expect(source).toMatch(
      /revoke all on function public\.apply_user_permission_overrides_as_system\([\s\S]*?grant execute on function public\.apply_user_permission_overrides_as_system\([\s\S]*?to service_role/
    );
    expect(source).toMatch(
      /revoke truncate on table[\s\S]*public\.role_permissions,[\s\S]*public\.user_permission_overrides,[\s\S]*public\.user_roles[\s\S]*from public, anon, authenticated, service_role/
    );
  });
});
