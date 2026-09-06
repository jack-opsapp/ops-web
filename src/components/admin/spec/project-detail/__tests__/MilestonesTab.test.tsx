import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SpecMilestoneRow, SpecMilestonesTab } from "@/lib/admin/spec-types";

vi.mock("@/app/admin/spec/[id]/_actions/fire-milestone", () => ({
  fireMilestone: vi.fn(),
}));

import { MilestonesTab } from "../MilestonesTab";

const row = (
  label: string,
  milestone: SpecMilestoneRow["milestone"],
  amountCents: number | null,
  overrides: Partial<SpecMilestoneRow> = {},
): SpecMilestoneRow => ({
  id: null,
  milestone,
  label,
  status: "not_yet_fired",
  amountCents,
  invoicedAt: null,
  paidAt: null,
  dueDate: null,
  stripeInvoiceId: null,
  fireable: false,
  fireBlockedReason: null,
  ...overrides,
});

const projectId = "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";

describe("MilestonesTab — SPEC-01", () => {
  const data: SpecMilestonesTab = {
    tier: "spec01",
    totalCents: 200_000,
    totalIsFloor: false,
    totalLocked: true,
    rows: [
      row("P1", "deposit", 100_000, { id: "pay-p1", status: "paid" }),
      row("P4", "delivery", 100_000, { fireBlockedReason: "Walkthrough not yet stamped" }),
    ],
  };

  it("renders only the two checkpoints that carry a payment", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
    expect(screen.getByText("P1")).toBeTruthy();
    expect(screen.getByText("P4")).toBeTruthy();
    expect(screen.queryByText("P2")).toBeNull();
  });

  it("sums the tier total and what has been paid", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getByText(/TIER TOTAL · \$2,000 · PAID \$1,000/)).toBeTruthy();
  });

  it("explains the 50/50 shape in the footer", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getByText(/P4 FIRES MANUALLY ONCE DELIVERY IS ACCEPTED/)).toBeTruthy();
  });
});

describe("MilestonesTab — SPEC-03 before the total is locked", () => {
  const data: SpecMilestonesTab = {
    tier: "spec03",
    totalCents: 2_500_000,
    totalIsFloor: true,
    totalLocked: false,
    rows: [
      row("P1", "deposit", 625_000, { id: "pay-p1", status: "paid" }),
      row("P2", "scope_signoff", null, { fireBlockedReason: "Total not locked — lock it on the scope doc" }),
      row("P3", "midpoint", null, { fireBlockedReason: "Total not locked — lock it on the scope doc" }),
      row("P4", "delivery", null, { fireBlockedReason: "Total not locked — lock it on the scope doc" }),
    ],
  };

  it("labels the total as the floor and shows unknown amounts as an em dash", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getByText(/FLOOR · FROM \$25,000 · PAID \$6,250/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("TOTAL NOT LOCKED — LOCK IT ON THE SCOPE DOC")).toHaveLength(3);
  });

  it("tells the operator what unlocks P2–P4", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getByText(/P2\/P3\/P4 UNLOCK WHEN THE TOTAL IS LOCKED ON THE SCOPE DOC/)).toBeTruthy();
  });

  it("links straight to the locked-total control on the scope doc tab", () => {
    render(<MilestonesTab data={data} projectId={projectId} />);
    const link = screen.getByRole("link", { name: /LOCK TOTAL ON SCOPE DOC/ });
    expect(link.getAttribute("href")).toBe(`/admin/spec/${projectId}?tab=scope`);
  });
});

describe("MilestonesTab — SPEC-03 once locked", () => {
  it("labels the locked total", () => {
    const data: SpecMilestonesTab = {
      tier: "spec03",
      totalCents: 3_100_000,
      totalIsFloor: false,
      totalLocked: true,
      rows: [row("P1", "deposit", 625_000, { id: "pay-p1", status: "paid" })],
    };
    render(<MilestonesTab data={data} projectId={projectId} />);
    expect(screen.getByText(/LOCKED TOTAL · \$31,000 · PAID \$6,250/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /LOCK TOTAL ON SCOPE DOC/ })).toBeNull();
  });
});
