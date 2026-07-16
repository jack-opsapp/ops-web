import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715161600_lead_assignment_delivery_worker.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8").toLowerCase();
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe("lead-assignment delivery worker migration", () => {
  it("adds lease, retry, notification, and terminal observability state", () => {
    const source = sql();

    expect(source).toMatch(/add column if not exists lease_token uuid/);
    expect(source).toMatch(
      /add column if not exists lease_expires_at timestamptz/
    );
    expect(source).toMatch(/add column if not exists max_attempts integer/);
    expect(source).toMatch(/add column if not exists notification_id uuid/);
    expect(source).toMatch(/add column if not exists disposition text/);
    expect(source).toMatch(/add column if not exists push_state text/);
    expect(source).toMatch(/add column if not exists terminal_at timestamptz/);
    expect(source).toMatch(
      /create unique index[\s\S]*?notifications[^;]+dedupe_key[^;]+lead-assignment-delivery:/
    );
  });

  it("claims atomically, recovers stale leases, and consumes silent or obsolete rows", () => {
    const claim = functionBody(
      sql(),
      "claim_opportunity_assignment_deliveries"
    );

    expect(claim).toContain("auth.role()");
    expect(claim).toContain("service_role");
    expect(claim).toMatch(/for update of d, o skip locked/);
    expect(claim).toContain("lease_expires_at <= now()");
    expect(claim).toMatch(/attempts\s*<\s*(?:d\.)?max_attempts/);
    expect(claim).toContain("notify = false");
    expect(claim).toContain("assignment_version");
    expect(claim).toContain("new_assignee_id");
    expect(claim).toContain("private.user_can_view_opportunity");
    expect(claim).toMatch(/(?:v_)?disposition\s*:?=\s*'silent'/);
    expect(claim).toMatch(/(?:v_)?disposition\s*:?=\s*'stale'/);
    expect(claim).toMatch(/(?:v_)?disposition\s*:?=\s*'inaccessible'/);
    expect(claim).toMatch(/return query values[\s\S]*terminal_failure/);
    expect(claim).toMatch(
      /return query values \(\s*v_row\.id,\s*null::uuid,\s*v_row\.assignment_event_id,\s*v_row\.company_id,\s*v_row\.opportunity_id,\s*v_row\.recipient_user_id,\s*v_row\.notification_id,[\s\S]*?v_disposition\s*\)/
    );
    expect(claim).toMatch(
      /v_disposition in \('stale', 'inaccessible'\)[\s\S]*update public\.notifications[\s\S]*is_read = true[\s\S]*resolved_at = now\(\)/
    );
  });

  it("materializes one standard actionable rail notification before returning a push claim", () => {
    const claim = functionBody(
      sql(),
      "claim_opportunity_assignment_deliveries"
    );

    expect(claim).toContain("insert into public.notifications");
    expect(claim).toContain("'lead_assigned'");
    expect(claim).toContain("'lead assigned'");
    expect(claim).toContain("'/pipeline?opportunityid='");
    expect(claim).toContain("'open lead'");
    expect(claim).toContain("'lead'");
    expect(claim).toContain("false");
    expect(claim).toContain("lead-assignment-delivery:");
    expect(claim).toContain("on conflict do nothing");
    expect(claim).toContain("notification_id");
  });

  it("keeps the rail independent while defaulting lead-assignment push on", () => {
    const source = sql();
    const claim = functionBody(
      source,
      "claim_opportunity_assignment_deliveries"
    );

    expect(source).toContain("lead_assignments");
    expect(source).toMatch(/lead_assignments[^\n]+push[^\n]+true/);
    expect(claim).toContain("push_enabled");
    expect(claim).toContain("channel_preferences");
    expect(claim).toContain("lead_assignments");
    expect(claim).not.toMatch(
      /insert into public\.notifications[\s\S]+where[^;]+push_enabled/
    );
  });

  it("only completes the active lease after proving its notification exists", () => {
    const complete = functionBody(
      sql(),
      "complete_opportunity_assignment_delivery"
    );

    expect(complete).toContain("auth.role()");
    expect(complete).toContain("for update");
    expect(complete).toContain("lease_token");
    expect(complete).toContain("state <> 'processing'");
    expect(complete).toContain("public.notifications");
    expect(complete).toContain("notification_id");
    expect(complete).toContain("lead-assignment-delivery:");
    expect(complete).toContain("assignment_version");
    expect(complete).toContain("assigned_to");
    expect(complete).toContain("private.user_can_view_opportunity");
    expect(complete).toMatch(
      /if v_stale then[\s\S]*update public\.notifications[\s\S]*resolved_at = now\(\)/
    );
    expect(complete.indexOf("public.notifications")).toBeLessThan(
      complete.indexOf("state = 'delivered'")
    );
  });

  it("fails only the active lease with bounded exponential backoff", () => {
    const fail = functionBody(sql(), "fail_opportunity_assignment_delivery");

    expect(fail).toContain("auth.role()");
    expect(fail).toContain("for update");
    expect(fail).toContain("lease_token");
    expect(fail).toContain("p_retryable");
    expect(fail).toContain("max_attempts");
    expect(fail).toContain("available_at");
    expect(fail).toContain("make_interval");
    expect(fail).toContain("power(");
    expect(fail).toContain("terminal_at");
  });

  it("exposes all worker mutations to service role only", () => {
    const source = sql();

    for (const signature of [
      "claim_opportunity_assignment_deliveries(uuid, integer, integer)",
      "complete_opportunity_assignment_delivery(uuid, uuid, text)",
      "fail_opportunity_assignment_delivery(uuid, uuid, text, boolean)",
    ]) {
      expect(source).toContain(`revoke all on function public.${signature}`);
      expect(source).toContain(`grant execute on function public.${signature}`);
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+to service_role`
        )
      );
    }
  });
});
