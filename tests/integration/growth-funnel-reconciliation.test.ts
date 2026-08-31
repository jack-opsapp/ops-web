import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  growthMilestoneComparisonPeriods,
  summarizeGrowthMilestones,
} from "@/lib/admin/growth-milestones";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260831050000_canonical_growth_milestones.sql"
  ),
  "utf8"
).toLowerCase();

describe("canonical growth milestone reconciliation", () => {
  it("derives every company milestone from persisted business records", () => {
    expect(migration).toContain("c.trial_start_date as trial_started_at");
    expect(migration).toContain("from public.projects p");
    expect(migration).toContain("from public.task_mutation_events e");
    expect(migration).toContain("e.event_type = 'task_completed'");
    expect(migration).toContain("from public.project_status_lifecycle_outbox o");
    expect(migration).toContain(
      "o.new_status in ('accepted', 'in_progress', 'completed', 'closed')"
    );
    expect(migration).toContain("from public.billing_events b");
    expect(migration).toContain("b.event_type = 'invoice.paid'");
    expect(migration).not.toContain("from public.analytics_events");
  });

  it("locks first value to the canonical fourteen-day window", () => {
    expect(migration).toContain("candidate.trial_started_at + interval '14 days'");
    expect(migration).toContain("then 'completed_task'");
    expect(migration).toContain("then 'active_project'");
  });

  it("locks activation to a real first project inside seven days", () => {
    expect(migration).toContain("candidate.trial_started_at + interval '7 days'");
    expect(migration).toContain("end as activated_at");
    expect(migration).toContain("where milestone.activated_at is not null");
  });

  it("preserves the existing founder-view column ordinals during upgrade", () => {
    const funnelView = migration.slice(
      migration.indexOf("create or replace view public.growth_funnel_daily"),
      migration.indexOf("create or replace view public.growth_channel_performance")
    );
    expect(funnelView.indexOf("as paid_companies")).toBeLessThan(
      funnelView.indexOf("as activated_companies")
    );

    const channelView = migration.slice(
      migration.indexOf("create or replace view public.growth_channel_performance"),
      migration.indexOf("create or replace view public.growth_attribution_coverage")
    );
    expect(channelView.indexOf("as revenue_cents")).toBeLessThan(
      channelView.indexOf("as activated_companies")
    );
  });

  it("uses immediately preceding equal periods", () => {
    expect(
      growthMilestoneComparisonPeriods({
        startDate: "2026-08-01",
        endDate: "2026-08-30",
      })
    ).toEqual({
      current: { startDate: "2026-08-01", endDate: "2026-08-30", days: 30 },
      previous: { startDate: "2026-07-02", endDate: "2026-07-31", days: 30 },
    });
  });

  it("cannot change business totals when client events are duplicated or retired", () => {
    const businessRows = [
      {
        reporting_date: "2026-08-01",
        trials_started: 2,
        classified_trials: 1,
        first_project_companies: 2,
        activated_companies: 1,
        first_value_companies: 1,
        paid_companies: 1,
        revenue_cents: 4900,
      },
    ];
    const withNoClientEvents = summarizeGrowthMilestones(businessRows);
    const afterClientEventChanges = summarizeGrowthMilestones(
      businessRows.map((row) => ({
        ...row,
        analytics_event_count: 999,
      }))
    );
    expect(afterClientEventChanges).toEqual(withNoClientEvents);
    expect(afterClientEventChanges.paidCompanies).toBe(1);
    expect(afterClientEventChanges.activatedCompanies).toBe(1);
    expect(afterClientEventChanges.firstValueCompanies).toBe(1);
  });
});
