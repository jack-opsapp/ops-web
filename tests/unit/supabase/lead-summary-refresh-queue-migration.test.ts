import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260829000200_lead_summary_refresh_queue.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("lead summary refresh queue migration", () => {
  it("creates a one-row-per-lead queue that cascades with the lead", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create table public\.lead_summary_refresh_requests/i
    );
    expect(sql).toMatch(
      /opportunity_id uuid primary key\s+references public\.opportunities\(id\) on delete cascade/i
    );
    expect(sql).toMatch(/company_id uuid not null/i);
    expect(sql).toMatch(/requested_at timestamptz not null default now\(\)/i);
  });

  it("is service-role only — RLS on, no policies, grants revoked", () => {
    const sql = migration();

    expect(sql).toMatch(
      /alter table public\.lead_summary_refresh_requests enable row level security/i
    );
    expect(sql).toMatch(
      /revoke all on public\.lead_summary_refresh_requests from public, anon, authenticated/i
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("enqueues from any writer — the trigger is on the table, not the client", () => {
    const sql = migration();

    expect(sql).toMatch(
      /create trigger trg_activities_lead_summary_refresh\s+after insert on public\.activities/i
    );
    expect(sql).toMatch(
      /create trigger trg_project_notes_lead_summary_refresh\s+after insert on public\.project_notes/i
    );
    expect(sql).toMatch(
      /create or replace function public\.tg_enqueue_lead_summary_refresh_from_activity/i
    );
    expect(sql).toMatch(
      /create or replace function public\.tg_enqueue_lead_summary_refresh_from_project_note/i
    );
  });

  it("debounces in the database — a burst collapses to one row", () => {
    const sql = migration();

    expect(
      sql.match(
        /on conflict \(opportunity_id\) do update set requested_at = excluded\.requested_at/gi
      )
    ).toHaveLength(2);
  });

  it("leaves email activity to the durable email cycle", () => {
    const sql = migration();

    expect(sql).toMatch(
      /if new\.opportunity_id is null or new\.type = 'email' then/i
    );
  });

  it("pins search_path on both security-definer functions", () => {
    const sql = migration();

    expect(
      sql.match(/set search_path to 'pg_catalog','public','pg_temp'/g)
    ).toHaveLength(2);
    expect(sql.match(/security definer/gi)).toHaveLength(2);
  });

  it("resolves the legacy text/uuid project linkage in both directions", () => {
    const sql = migration();

    expect(sql).toMatch(
      /o\.project_id = p\.id or o\.project_ref = p\.id[\s\S]*p\.opportunity_ref = o\.id or p\.opportunity_id = o\.id::text/i
    );
    expect(sql).toMatch(/where p\.id::text = new\.project_id/i);
  });

  it("skips a note that arrives already soft-deleted", () => {
    const sql = migration();
    expect(sql).toMatch(/if new\.deleted_at is not null then return new; end if;/i);
  });
});
