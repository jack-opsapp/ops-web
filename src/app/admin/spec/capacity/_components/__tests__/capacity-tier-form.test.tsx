import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CapacityEditRow } from "@/lib/admin/spec-types";

vi.mock("../../_actions/save-capacity", () => ({
  saveCapacityAction: vi.fn(),
}));

import { CapacityTierForm } from "../capacity-tier-form";

const row = (tier: CapacityEditRow["tier"]): CapacityEditRow => ({
  tier,
  slotCeiling: 6,
  discoveryDaysMin: 2,
  discoveryDaysMax: 4,
  buildDaysMin: 3,
  buildDaysMax: 7,
  supportWindowDays: 30,
  subscriptionMultiplierEstimate: 0,
  retainerMonthlyCents: 0,
  polishHoursBudget: 2,
  isAcceptingBookings: true,
  manualNextStartOverride: null,
  publicNote: null,
  adminNotes: null,
  updatedAt: null,
});

describe("CapacityTierForm heading", () => {
  it("titles the SPEC-01 form with its lockup and the 50/50 price hint", () => {
    render(<CapacityTierForm row={row("spec01")} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("SPEC-01 · WORKFLOWS");
    expect(screen.getByText(/\$2,000 FIXED · PAID 50\/50/)).toBeTruthy();
  });

  it("titles the SPEC-02 form with its lockup and the quarters price hint", () => {
    render(<CapacityTierForm row={row("spec02")} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("SPEC-02 · SYSTEMS");
    expect(screen.getByText(/\$7,500 FIXED · PAID IN QUARTERS/)).toBeTruthy();
  });

  it("titles the SPEC-03 form with its lockup and the floor price hint", () => {
    render(<CapacityTierForm row={row("spec03")} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("SPEC-03 · PROPRIETARY");
    expect(
      screen.getByText(/FROM \$25,000 · P1 \$6,250 FIXED · TOTAL LOCKED AT SCOPE SIGN-OFF/),
    ).toBeTruthy();
  });
});
