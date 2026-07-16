import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715170000_email_autonomy_milestones.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("email autonomy milestones migration", () => {
  it("creates durable state keyed by company, connection, and OPS user UUID", () => {
    expect(sql).toContain("create table public.email_autonomy_milestones");
    expect(sql).toContain(
      "company_id uuid not null references public.companies(id)"
    );
    expect(sql).toContain(
      "connection_id uuid not null references public.email_connections(id)"
    );
    expect(sql).toContain("user_id uuid not null references public.users(id)");
    expect(sql).toContain("unique (company_id, connection_id, user_id)");
  });

  it("keeps the table server-only with RLS as defense in depth", () => {
    expect(sql).toContain(
      "alter table public.email_autonomy_milestones enable row level security"
    );
    expect(sql).toContain(
      "revoke all on table public.email_autonomy_milestones from public"
    );
    expect(sql).toContain(
      "revoke all on table public.email_autonomy_milestones from anon, authenticated"
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.email_autonomy_milestones to service_role"
    );
  });

  it("records the milestone and actor notification atomically through a service-only RPC", () => {
    expect(sql).toContain(
      "create or replace function public.record_email_autonomy_milestone"
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, pg_temp");
    expect(sql).toContain("update public.email_autonomy_milestones");
    expect(sql).toContain("insert into public.notifications");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("email-autonomy-milestone:");
    expect(sql).toContain(
      "revoke all on function public.record_email_autonomy_milestone"
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain(
      "grant execute on function public.record_email_autonomy_milestone"
    );
    expect(sql).toContain("to service_role");
  });

  it("validates tenant identity by UUID and never matches mailbox or login email", () => {
    expect(sql).toContain("actor.id = p_user_id");
    expect(sql).toContain("actor.company_id = p_company_id");
    expect(sql).toContain("connection.id = p_connection_id");
    expect(sql).toContain("connection.company_id = p_company_id::text");
    expect(sql).toContain(
      "create or replace function private.enforce_email_autonomy_milestone_tenant_integrity"
    );
    expect(sql).toContain("connection.company_id = new.company_id::text");
    expect(sql).not.toContain("actor.email");
    expect(sql).not.toContain("connection.email");
    expect(sql).not.toContain("assigned_to");
  });

  it("backfills only deterministically owned personal mailboxes and preserves connection settings", () => {
    expect(sql).toContain("connection.type::text = 'individual'");
    expect(sql).toContain("connection.user_id = actor.id::text");
    expect(sql).toContain("connection.company_id = actor.company_id::text");
    expect(sql).not.toContain("update public.email_connections");
  });
});
