import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727103350_external_lead_feed.sql"
  ),
  "utf8"
).toLowerCase();

describe("external lead feed migration", () => {
  it("revalidates analytics class, epoch, tenant and additive financial scope", () => {
    expect(source).toContain("require_external_analytics_credential");
    expect(source).toContain("principal.credential_class = 'analytics'");
    expect(source).toContain("principal.authorization_epoch");
    expect(source).toContain("analytics.leads.read");
    expect(source).toContain("analytics.financial.read");
  });

  it("implements immutable high-water full and incremental reads", () => {
    expect(source).toContain("authorize_external_lead_feed_as_system");
    expect(source).toContain("read_external_lead_feed_page_as_system");
    expect(source).toContain("distinct on (version.handle_id)");
    expect(source).toContain(
      "version.change_sequence <= p_high_water_sequence"
    );
    expect(source).toContain("version.change_sequence > p_after_sequence");
    expect(source).toContain("order by version.change_sequence");
  });

  it("uses a fixed filter allowlist and strips financial data by default", () => {
    for (const key of [
      "inquiryreceivedfrom",
      "updatedfrom",
      "sourceid",
      "campaignhandle",
      "formid",
      "recordstate",
    ]) {
      expect(source).toContain(`'${key}'`);
    }
    expect(source).toContain("else latest.public_projection - 'financial'");
    expect(source).toContain("else version.public_projection - 'financial'");
  });

  it("tracks the contiguous 30-day incremental retention floor", () => {
    expect(source).toContain("retained_from_sequence");
    expect(source).toContain("interval '30 days'");
    expect(source).toContain("external_lead_feed_checkpoint_expired");
  });
});
