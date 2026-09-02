import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727103400_external_lead_metrics_v1.sql"
  ),
  "utf8"
).toLowerCase();

describe("external lead metrics v1 migration", () => {
  it("revalidates tenant, epoch, analytics class, and additive financial scope", () => {
    expect(source).toContain("require_external_analytics_credential");
    expect(source).toContain("principal.authorization_epoch");
    expect(source).toContain("analytics.leads.read");
    expect(source).toContain("analytics.financial.read");
    expect(source).toContain("authorize_external_lead_metrics_as_system");
    expect(source).toContain("read_external_lead_metrics_v1_as_system");
  });

  it("uses an immutable projection high-water and half-open received cohorts", () => {
    expect(source).toContain(
      "version.change_sequence <= p_high_water_sequence"
    );
    expect(source).toContain("inquiry_received_at >= p_from");
    expect(source).toContain("inquiry_received_at < p_to");
    expect(source).toContain("operation <> 'merge'");
    expect(source).toContain("archived_unresolved");
  });

  it("implements explicit outcome precedence, evidence funnels, and suppression", () => {
    for (const outcome of [
      "deleted",
      "won",
      "lost",
      "disqualified",
      "discarded",
      "converted_without_decision",
      "archived_unresolved",
      "active",
    ]) {
      expect(source).toContain(`'${outcome}'`);
    }
    expect(source).toContain("stage_reached_funnel");
    expect(source).toContain("suppress_below_cohort");
    expect(source).toContain("percentile_cont(0.5)");
  });

  it("dates financial events exactly and attributes each event once", () => {
    expect(source).toContain("invoice.issue_date >= p_from_local_date");
    expect(source).toContain("invoice.issue_date < p_to_local_date");
    expect(source).toContain("payment.payment_date >= p_from_local_date");
    expect(source).toContain("payment.payment_date < p_to_local_date");
    expect(source).toContain("invoice.status not in ('draft', 'void')");
    expect(source).toContain("invoice.status <> 'void'");
    expect(source).toContain(
      "coalesce(invoice.project_ref, invoice.project_id)"
    );
    expect(source).toContain("project.opportunity_ref");
    expect(source).toContain("direct_opportunity_id");
    expect(source).toContain("missing_evidence_count");
  });

  it("keeps every privileged function off app roles with a fixed search path", () => {
    expect(source).toContain(
      "set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'"
    );
    expect(source).toContain("from public, anon, authenticated");
    expect(source).toContain("to service_role");
  });
});
