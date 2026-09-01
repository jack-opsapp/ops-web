import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260831003857_growth_analytics_foundation.sql"
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();

const warehouseTables = [
  "search_console_daily",
  "ga4_daily_acquisition",
  "channel_map",
  "channel_metrics",
  "touchpoints",
  "analytics_sync_runs",
] as const;

const adminViews = [
  "growth_funnel_daily",
  "growth_channel_performance",
  "growth_attribution_coverage",
  "growth_data_health",
] as const;

describe("growth analytics foundation migration", () => {
  it("extends first-party attribution and product-event envelopes", () => {
    for (const column of [
      "referrer",
      "first_touch_at",
      "self_reported_source",
      "attribution_basis",
      "attribution_confidence",
      "classification_reason",
      "capture_version",
    ]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }
    for (const column of ["schema_version", "environment", "received_at"]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }
    expect(sql).toContain("received_at = coalesce(received_at, created_at, now())");
  });

  it("preserves each aggregate source at its native grain", () => {
    expect(sql).toMatch(
      /unique\s*\(site_url,\s*reporting_date,\s*query,\s*page,\s*country,\s*device\)/
    );
    expect(sql).toMatch(
      /unique\s*\(\s*property_key,\s*reporting_date,\s*default_channel_group,\s*source,\s*medium,\s*campaign,\s*landing_path\s*\)/
    );
    expect(sql).toContain("source_grain text not null");
    expect(sql).toContain("source_key text not null");
    expect(sql).toContain("unique (source_system, source_key, metric_type, metric_date)");
  });

  it("keeps deterministic touchpoints company-scoped and retention-ready", () => {
    expect(sql).toContain(
      "company_id uuid references public.companies(id) on delete cascade"
    );
    expect(sql).toContain("dedupe_key text not null unique");
    expect(sql).toContain("expires_at timestamptz");
    expect(sql).toContain("check (company_id is not null or anonymous_id is not null)");
  });

  it("enables RLS and removes browser-role access from every warehouse table", () => {
    for (const table of warehouseTables) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`
      );
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated`
      );
      expect(sql).toContain(
        `grant all on table public.${table} to service_role`
      );
    }
  });

  it("creates security-invoker founder views with service-only grants", () => {
    for (const view of adminViews) {
      expect(sql).toMatch(
        new RegExp(
          `create or replace view public\\.${view}\\s+with \\(security_invoker = true\\)`
        )
      );
      expect(sql).toContain(
        `revoke all on table public.${view} from public, anon, authenticated`
      );
      expect(sql).toContain(
        `grant select on table public.${view} to service_role`
      );
    }
  });

  it("derives milestones from records and labels the cohort grain", () => {
    expect(sql).toContain("from public.projects");
    expect(sql).toContain("from public.billing_events");
    expect(sql).toContain("'trial_start_cohort'::text as grain");
    expect(sql).not.toMatch(/from public\.analytics_events[\s\S]*growth_funnel_daily/);
  });
});
