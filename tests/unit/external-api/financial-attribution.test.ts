import { describe, expect, it } from "vitest";

import {
  resolveFinancialAttribution,
  resolveFinancialAttributionCandidates,
} from "@/lib/external-api/analytics/financial-attribution";

describe("financial attribution", () => {
  it("prefers the direct invoice opportunity and counts it once", () => {
    expect(
      resolveFinancialAttribution({
        directOpportunityId: "opp-direct",
        projectOpportunityId: "opp-project",
      })
    ).toEqual({ outcome: "attributed", opportunityId: "opp-direct" });
  });

  it("falls back to the canonical project opportunity", () => {
    expect(
      resolveFinancialAttribution({
        directOpportunityId: null,
        projectOpportunityId: "opp-project",
      })
    ).toEqual({ outcome: "attributed", opportunityId: "opp-project" });
  });

  it("discloses missing and ambiguous attribution", () => {
    expect(
      resolveFinancialAttribution({
        directOpportunityId: null,
        projectOpportunityId: null,
      })
    ).toEqual({ outcome: "unattributed", opportunityId: null });
    expect(
      resolveFinancialAttributionCandidates([
        { directOpportunityId: "opp-a", projectOpportunityId: null },
        { directOpportunityId: null, projectOpportunityId: "opp-b" },
      ])
    ).toEqual({ outcome: "ambiguous", opportunityId: null });
  });
});
