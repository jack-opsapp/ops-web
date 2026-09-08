import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewTab } from "../OverviewTab";
import type { SpecOverviewTab, SpecProjectHeader } from "@/lib/admin/spec-types";

const header: SpecProjectHeader = {
  id: "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4",
  tier: "spec03",
  originalTier: "spec02",
  status: "building",
  isTest: false,
  customerLabel: "Cascade Deck & Rail",
};

const data: SpecOverviewTab = {
  customer: { name: "Ray Cascade", email: "ray@cascadedeck.ca", phone: null, gstNumber: null },
  buyer: null,
  accountHolder: null,
  buyerIsAccountHolder: true,
  company: null,
  lastStatusChangeAt: null,
  keyDates: {
    depositPaidAt: null,
    scopeDocSignedAt: null,
    buildStartedAt: null,
    walkthroughCompletedAt: null,
    supportWindowEndsAt: null,
  },
  holdState: null,
  financial: {
    totalCommittedCents: 0,
    totalPaidCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    refundedCents: 0,
    polishHoursUsed: 0,
    polishHoursBudget: 8,
    perMilestone: [],
  },
  estimatedCompletionDate: null,
  attribution: {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    gclid: null,
    fbclid: null,
    landingUrl: null,
    firstTouchAt: null,
  },
};

describe("OverviewTab tier row", () => {
  it("renders the tier and the upgraded-from tier as designations", () => {
    render(<OverviewTab data={data} header={header} />);
    expect(screen.getByText("SPEC-03")).toBeTruthy();
    expect(screen.getByText(/WAS SPEC-02/)).toBeTruthy();
    expect(screen.queryByText(/SPEC03/)).toBeNull();
  });
});
