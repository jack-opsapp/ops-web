import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapacityPanel } from "../capacity-panel";
import type { CapacityRow } from "@/lib/admin/spec-types";

const row = (tier: CapacityRow["tier"], slotCeiling: number): CapacityRow => ({
  tier,
  slotCeiling,
  active: 0,
  queued: 0,
  holdCustomerRequested: 0,
  holdOpsBlocked: 0,
  isAcceptingBookings: true,
  manualNextStartOverride: null,
  publicNote: null,
  snapshotRefreshedAt: null,
});

describe("CapacityPanel card titles", () => {
  it("titles each card with the full tier lockup", () => {
    render(
      <CapacityPanel rows={[row("spec01", 6), row("spec02", 3), row("spec03", 1)]} />,
    );
    expect(screen.getByText("SPEC-01 · WORKFLOWS")).toBeTruthy();
    expect(screen.getByText("SPEC-02 · SYSTEMS")).toBeTruthy();
    expect(screen.getByText("SPEC-03 · PROPRIETARY")).toBeTruthy();
    expect(screen.queryByText("spec01")).toBeNull();
  });
});
