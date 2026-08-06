import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724221531_fix_deckset_company_provisioning.sql"
  ),
  "utf8"
).toLowerCase();

describe("Deckset company provisioning migration", () => {
  it("seeds the Owner role before promoting the user to company admin", () => {
    const immediate = migration.indexOf(
      "set constraints trg_user_roles_final_state immediate"
    );
    const roleSeed = migration.indexOf("insert into public.user_roles");
    const deferred = migration.indexOf(
      "set constraints trg_user_roles_final_state deferred"
    );
    const promotion = migration.indexOf(
      "set company_id = v_company_id,\n         role = 'owner',\n         is_company_admin = true"
    );

    expect(immediate).toBeGreaterThan(-1);
    expect(roleSeed).toBeGreaterThan(immediate);
    expect(deferred).toBeGreaterThan(roleSeed);
    expect(promotion).toBeGreaterThan(deferred);
  });

  it("keeps the permission guard intact", () => {
    expect(migration).not.toContain(
      "create or replace function private.guard_user_roles_final_state"
    );
    expect(migration).not.toContain("disable trigger");
  });
});
