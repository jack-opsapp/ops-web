import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260715161500_lead_assignment_realtime_fanout.sql"
  ),
  "utf8"
).toLowerCase();

describe("lead assignment realtime fan-out migration", () => {
  it("idempotently publishes events and addressed revocation deliveries", () => {
    expect(migration).toContain("pg_catalog.pg_publication_tables");
    expect(migration).toContain("tablename = 'opportunity_assignment_events'");
    expect(migration).toContain(
      "alter publication supabase_realtime add table public.opportunity_assignment_events"
    );
    expect(migration).toContain(
      "tablename = 'opportunity_assignment_deliveries'"
    );
    expect(migration).toContain(
      "alter publication supabase_realtime add table public.opportunity_assignment_deliveries"
    );
  });

  it("creates an RLS-protected durable permission-change stream per user", () => {
    expect(migration).toContain(
      "create table if not exists public.user_permission_change_deliveries"
    );
    expect(migration).toMatch(/unique\s*\(transaction_id, recipient_user_id\)/);
    expect(migration).toContain(
      "alter table public.user_permission_change_deliveries enable row level security"
    );
    expect(migration).toMatch(
      /create policy user_permission_change_deliveries_recipient_select[\s\S]*recipient_user_id\s*=\s*private\.get_current_user_id\(\)/
    );
    expect(migration).toMatch(
      /grant select on table public\.user_permission_change_deliveries\s+to authenticated/
    );
    expect(migration).toMatch(
      /revoke insert, update, delete on table public\.user_permission_change_deliveries[\s\S]*authenticated, service_role/
    );
  });

  it("fans every canonical permission authority change into the durable stream", () => {
    for (const table of [
      "role_permissions",
      "user_roles",
      "user_permission_overrides",
      "users",
      "companies",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create trigger [\\s\\S]*?on public\\.${table}[\\s\\S]*?enqueue`,
          "i"
        )
      );
    }
    expect(migration).toContain("txid_current()");
    expect(migration).toContain(
      "alter publication supabase_realtime add table public.user_permission_change_deliveries"
    );
  });
});
