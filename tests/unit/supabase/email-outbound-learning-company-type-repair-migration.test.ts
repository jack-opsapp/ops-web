import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260721130000_email_outbound_learning_company_type_repair.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = compact.indexOf(`create or replace function ${name}(`);
  if (start < 0) return "";
  const next = compact.indexOf("create or replace function ", start + 1);
  return compact.slice(start, next < 0 ? undefined : next);
}

describe("outbound-learning company type repair migration", () => {
  it("is a forward-only atomic migration after the live hardening chain", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql.trimStart()).toMatch(/^begin;/);
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });

  it("fails closed unless the mixed company-id schema and guarded functions exist", () => {
    expect(compact).toContain(
      "email_outbound_learning_company_type_repair_prerequisite_missing"
    );
    expect(compact).toContain(
      "email_outbound_learning_company_type_repair_schema_mismatch"
    );
    expect(compact).toContain("'public.email_outbound_learning_queue'");
    expect(compact).toContain("'public.activities'");
    expect(compact).toContain("'text'");
    expect(compact).toContain("'uuid'");
  });

  it("compares UUID activity ownership to a safely parsed queue company UUID in both proof gates", () => {
    for (const name of [
      "private.bind_email_outbound_learning_actor_proof",
      "private.email_outbound_learning_guard",
    ]) {
      const body = functionBody(name);
      expect(body).toContain(
        "outbound.company_id = private.try_parse_uuid(q.company_id)"
      );
      expect(body).not.toContain("outbound.company_id = q.company_id");
      expect(body).toContain("outbound.email_connection_id = q.connection_id");
      expect(body).toContain(
        "outbound.email_message_id = q.provider_message_id"
      );
      expect(body).toContain("outbound.email_thread_id = q.provider_thread_id");
    }
  });

  it("removes the revoked pre-assignment wrapper that retained the same unsafe comparison", () => {
    expect(compact).toContain(
      "drop function if exists public.enqueue_email_outbound_learning_pre_assignment_internal( text, uuid, text, text, text, text, text[], text, text, text, timestamptz, uuid, uuid, uuid, text, text, text )"
    );
    expect(compact).not.toContain(
      "public.enqueue_email_outbound_learning_pre_assignment_internal( p_"
    );
  });

  it("keeps both private proof functions unavailable to application roles", () => {
    expect(compact).toMatch(
      /revoke all on function private\.bind_email_outbound_learning_actor_proof\(\s*uuid, uuid, text\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toContain(
      "revoke all on function private.email_outbound_learning_guard(uuid) from public, anon, authenticated, service_role"
    );
  });
});
