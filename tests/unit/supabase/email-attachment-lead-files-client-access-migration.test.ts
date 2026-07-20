import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260719230000_email_attachment_lead_files_client_access.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = sql.replace(/\s+/g, " ");
const behavioralContract = readFileSync(
  resolve(process.cwd(), "tests/sql/lead-assignment-contract.sql"),
  "utf8"
).toLowerCase();

describe("email attachment lead-files client access migration", () => {
  it("keeps the canonical attachment table server-only", () => {
    expect(compact).toContain(
      "drop policy if exists email_attachments_company_scope on public.email_attachments"
    );
    expect(compact).toContain(
      "drop policy if exists email_attachments_lead_files_select on public.email_attachments"
    );
    expect(compact).toContain(
      "revoke all on public.email_attachments from public, anon, authenticated"
    );
    expect(compact).not.toMatch(
      /grant select[^;]+on public\.email_attachments to (?:public|anon|authenticated)/
    );
  });

  it("exposes only safe lead-file descriptors through a locked definer RPC", () => {
    expect(compact).toContain(
      "create or replace function private.get_opportunity_lead_files( p_opportunity_id uuid )"
    );
    expect(compact).toContain(
      "create or replace function public.get_opportunity_lead_files( p_opportunity_id uuid )"
    );
    expect(compact).toContain("returns table (");
    expect(compact).toContain("security definer");
    expect(compact).toContain("security invoker");
    expect(compact).toContain("set search_path = pg_catalog, pg_temp");
    expect(compact).toContain(
      "revoke all on function public.get_opportunity_lead_files(uuid) from public, anon, authenticated, service_role"
    );
    expect(compact).toContain(
      "grant execute on function public.get_opportunity_lead_files(uuid) to anon, authenticated"
    );
    expect(compact).not.toContain("storage_path");
    expect(compact).not.toContain("provider_thread_id");
    expect(compact).not.toContain("message_id");
    expect(compact).not.toContain("attachment_id");
    expect(compact).not.toContain("content_sha256");
    expect(compact).not.toContain("last_error");
  });

  it("enforces company, actionable-state, and canonical lead-inbox authority in SQL", () => {
    expect(compact).not.toContain("private.get_user_company_id()");
    expect(compact).toContain("attachment.attribution_status = 'attributed'");
    expect(compact).toContain(
      "attachment.ingest_status in ('stored', 'external')"
    );
    expect(compact).toContain(
      "case when attachment.ingest_status = 'external' then attachment.source_url else null end"
    );
    expect(compact).toContain(
      "create or replace function private.is_safe_https_attachment_url( p_url text )"
    );
    expect(compact).toContain("p_url ~ '[[:space:][:cntrl:]]'");
    expect(compact).toContain("position('@' in v_authority) > 0");
    expect(compact).toContain("v_label !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'");
    expect(compact).toContain("family(v_host::inet) <> 6");
    expect(compact).toContain("v_port::integer < 1 or v_port::integer > 65535");
    expect(compact).toContain(
      "private.is_safe_https_attachment_url(attachment.source_url)"
    );
    expect(compact).toContain(
      "private.current_user_can_view_opportunity_inbox( p_opportunity_id, attachment.connection_id )"
    );
  });

  it("is atomic", () => {
    expect(compact).toContain(
      "revoke all on public.email_attachments from public, anon, authenticated"
    );
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("has a rollback-only role and JWT behavioral contract", () => {
    for (const check of [
      "lead_file_rpc_returns_only_authorized_actionable_descriptors",
      "lead_file_clients_cannot_read_canonical_attachment_table",
      "lead_file_rpc_bare_anon_is_empty",
      "lead_file_service_role_keeps_canonical_table_access",
    ]) {
      expect(behavioralContract).toContain(check);
    }
    expect(behavioralContract.trim().startsWith("-- lead assignment")).toBe(
      true
    );
    expect(behavioralContract.trim().endsWith("rollback;")).toBe(true);
    expect(behavioralContract).toContain("https://?missing-host");
    expect(behavioralContract).toContain(
      "https://example.invalid/contains space.jpg"
    );
    for (const malformed of [
      "https://:443/port-only.jpg",
      "https://./dot-only.jpg",
      "https://-bad.example/hyphen.jpg",
      "https://[gg::1]/malformed-ipv6.jpg",
      "https://example.invalid:70000/bad-port.jpg",
    ]) {
      expect(behavioralContract).toContain(malformed);
    }
  });
});
