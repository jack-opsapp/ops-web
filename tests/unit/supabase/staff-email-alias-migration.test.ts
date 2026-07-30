import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260728161000_authoritative_staff_email_aliases.sql"
  ),
  "utf8"
).replace(/\s+/g, " ");
const sql = source.toLowerCase();

describe("authoritative staff email aliases migration", () => {
  it("creates an exact, company-unique, fully reviewed identity model", () => {
    expect(sql).toContain("create table public.user_email_aliases");
    expect(sql).toContain("unique (company_id, email)");
    expect(sql).toContain("pending");
    expect(sql).toContain("verified");
    expect(sql).toContain("rejected");
    expect(sql).toContain("verified_at");
    expect(sql).toContain("verified_by");
    expect(sql).toContain("reviewed_at");
    expect(sql).toContain("reviewed_by");
    expect(sql).toContain("evidence jsonb");
    expect(sql).toContain("foreign key (company_id, user_id)");
    expect(sql).toContain("references public.users (company_id, id)");
  });

  it("limits alias evidence reads to company administrators and removes direct writes", () => {
    expect(sql).toContain(
      "alter table public.user_email_aliases enable row level security"
    );
    expect(sql).toContain("user_email_aliases_admin_read");
    expect(sql).toContain("private.get_user_company_id()");
    expect(sql).toContain("private.permission_user_is_admin");
    expect(sql).toContain(
      "grant select on table public.user_email_aliases to authenticated, service_role"
    );
    expect(sql).not.toMatch(
      /grant (?:insert|update|delete|insert, update, delete) on table public\.user_email_aliases/
    );
  });

  it("records pending evidence through a service-only guarded RPC", () => {
    expect(sql).toContain(
      "create or replace function public.record_staff_email_alias_candidate_as_system"
    );
    expect(sql).toContain("auth.jwt()");
    expect(sql).toContain("service_role");
    expect(sql).toContain("signature_corroborated");
    expect(sql).toContain("provider_message_id");
    expect(sql).toContain(
      "staff alias candidate evidence does not match roster"
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_staff_email_alias_candidate_as_system\([\s\S]*?\) to service_role/
    );
    expect(sql).toContain("set search_path = ''");
  });

  it("requires an authenticated company admin for one-way review", () => {
    expect(sql).toContain(
      "create or replace function public.review_user_email_alias"
    );
    expect(sql).toContain("private.permission_user_is_admin");
    expect(sql).toContain("staff alias review is already final");
    expect(sql).toMatch(
      /grant execute on function public\.review_user_email_alias\(uuid, text\) to authenticated/
    );
  });

  it("keeps tenant ownership and email identity immutable", () => {
    expect(sql).toContain(
      "create or replace function private.guard_user_email_alias_identity"
    );
    expect(sql).toContain("staff alias identity is immutable");
    expect(sql).toContain("staff alias review is immutable");
    expect(sql).toContain("staff alias belongs to another registered user");
  });

  it("records rejected reviews without falsely attributing verification", () => {
    expect(sql).toMatch(
      /reviewed_at = v_reviewed_at[\s\S]*?reviewed_by = v_actor_user_id/
    );
    expect(sql).toMatch(
      /verified_by = case[\s\S]*?when p_status = 'verified' then v_actor_user_id[\s\S]*?else null/
    );
  });
});
