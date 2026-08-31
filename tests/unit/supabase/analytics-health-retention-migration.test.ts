import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831060000_analytics_health_and_retention.sql"
  ),
  "utf8"
).toLowerCase();
const repairSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260831063000_fix_analytics_health_trial_cohort.sql"
  ),
  "utf8"
).toLowerCase();

function healthSnapshotDefinition(input: string): string {
  const start = input.indexOf(
    "create or replace function public.get_growth_analytics_health_snapshot()"
  );
  const end = input.indexOf("$function$;", start);
  return input.slice(start, end + "$function$;".length);
}

describe("analytics health and retention migration", () => {
  it("keeps source transitions durable and notification changes atomic", () => {
    expect(sql).toContain("create table if not exists public.analytics_health_states");
    expect(sql).toContain("create or replace function public.apply_analytics_health_source");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("previous.state = 'healthy'");
    expect(sql).toContain("p_state = 'failed'");
    expect(sql).toContain("type = 'analytics_source_failed'");
    expect(sql).toContain("resolved_at = clock_timestamp()");
    expect(sql).toContain("resolution_reason = 'analytics_source_recovered'");
    expect(sql).toContain("p_state = 'expected_latency'");
  });

  it("exposes health snapshots only to the service role", () => {
    expect(sql).toContain(
      "create or replace function public.get_growth_analytics_health_snapshot"
    );
    expect(sql).toContain("service role required");
    expect(sql).toMatch(
      /revoke all on function public\.get_growth_analytics_health_snapshot\(\)[\s\S]*from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_growth_analytics_health_snapshot\(\)[\s\S]*to service_role/
    );
  });

  it("reconciles activation against the seven-day business milestone", () => {
    expect(sql).toContain("sum(activated_companies)");
    expect(sql).toContain("where activated_at is not null");
  });

  it("reconciles attribution against the same active trial cohort", () => {
    expect(sql).toContain("eligible_attributions as (");
    expect(sql).toMatch(
      /join public\.companies as company\s+on company\.id = attribution\.company_id/
    );
    expect(sql).toContain("company.deleted_at is null");
    expect(sql).toContain("company.trial_start_date is not null");
    expect(sql).toContain("select count(*) from eligible_attributions");
    expect(repairSql).toContain("eligible_attributions as (");
    expect(healthSnapshotDefinition(repairSql)).toBe(
      healthSnapshotDefinition(sql)
    );
  });

  it("aggregates raw events before the 12-month deletion boundary", () => {
    expect(sql).toContain("create table if not exists public.analytics_events_daily");
    expect(sql).toContain("create or replace function public.enforce_analytics_retention");
    expect(sql).toContain("insert into public.analytics_events_daily");
    expect(sql).toContain("interval '12 months'");
    expect(sql).toMatch(
      /insert into public\.analytics_events_daily[\s\S]*delete from public\.analytics_events/
    );
  });

  it("deletes expired raw touchpoints while retaining classified attribution", () => {
    expect(sql).toContain("delete from public.touchpoints");
    expect(sql).toContain("touchpoint_rows_deleted");
    expect(sql).toContain("set gclid = null");
    expect(sql).toContain("fbclid = null");
    expect(sql).not.toMatch(/set\s+attributed_channel\s*=\s*null/);
  });

  it("prevents browser roles from reading or mutating operations tables", () => {
    expect(sql).toContain("alter table public.analytics_health_states enable row level security");
    expect(sql).toContain("alter table public.analytics_events_daily enable row level security");
    expect(sql).toMatch(
      /revoke all on table public\.analytics_health_states\s+from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /revoke all on table public\.analytics_events_daily\s+from public, anon, authenticated/
    );
  });
});
