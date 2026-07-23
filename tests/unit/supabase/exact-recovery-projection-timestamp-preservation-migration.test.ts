import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723094000_exact_recovery_projection_timestamp_preservation.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = source.replace(/\s+/g, " ").trim();

describe("exact recovery projection timestamp preservation", () => {
  it("uses an inaccessible transaction- and backend-scoped capability", () => {
    expect(compact).toContain(
      "create table private.exact_recovery_opportunity_timestamp_tokens"
    );
    expect(compact).toMatch(
      /primary key \( transaction_id, backend_pid, company_id, opportunity_id \)/
    );
    expect(compact).toContain(
      "revoke all on table private.exact_recovery_opportunity_timestamp_tokens from public, anon, authenticated, service_role"
    );
    expect(compact).not.toContain(
      "grant insert on table private.exact_recovery_opportunity_timestamp_tokens"
    );
  });

  it("restores updated_at only for the exact projection-only update", () => {
    expect(compact).toContain(
      "create or replace function private.preserve_exact_recovery_opportunity_updated_at()"
    );
    expect(compact).toContain("security definer");
    expect(compact).toContain(
      "set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'"
    );
    expect(compact).toContain(
      "to_jsonb(new) - array[ 'correspondence_count', 'inbound_count', 'outbound_count', 'last_inbound_at', 'last_outbound_at', 'last_message_direction', 'last_activity_at', 'updated_at' ] is distinct from to_jsonb(old) - array[ 'correspondence_count', 'inbound_count', 'outbound_count', 'last_inbound_at', 'last_outbound_at', 'last_message_direction', 'last_activity_at', 'updated_at' ]"
    );
    expect(compact).toContain(
      "token.transaction_id = pg_catalog.txid_current()"
    );
    expect(compact).toContain(
      "token.backend_pid = pg_catalog.pg_backend_pid()"
    );
    expect(compact).toContain(
      "token.company_id = old.company_id"
    );
    expect(compact).toContain(
      "token.opportunity_id = old.id"
    );
    expect(compact).toContain(
      "token.expected_updated_at is not distinct from old.updated_at"
    );
    expect(compact).toContain("new.updated_at := old.updated_at");
    expect(compact).toContain(
      "create trigger zz_exact_recovery_preserve_opportunity_updated_at before update on public.opportunities"
    );
  });

  it("mints and consumes the capability inside the private projection helper", () => {
    expect(compact).toContain(
      "create or replace function private.recompute_exact_message_opportunity_projection("
    );
    expect(compact).toContain(
      "insert into private.exact_recovery_opportunity_timestamp_tokens"
    );
    expect(compact).toContain(
      "pg_catalog.txid_current(), pg_catalog.pg_backend_pid(), p_company_id, p_opportunity_id, v_updated_at"
    );
    expect(compact).toContain(
      "raise exception 'exact_recovery_projection_timestamp_token_not_consumed'"
    );
    expect(compact).toContain(
      "revoke all on function private.recompute_exact_message_opportunity_projection( uuid, uuid, text, integer ) from public, anon, authenticated, service_role"
    );
  });

  it("keeps the repair transactional without weakening protected fields", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).not.toContain("set assigned_to =");
    expect(compact).not.toContain("set stage =");
    expect(compact).not.toContain("set stage_manually_set =");
    expect(compact).not.toContain("set project_id =");
    expect(compact).not.toContain("set project_ref =");
  });
});
