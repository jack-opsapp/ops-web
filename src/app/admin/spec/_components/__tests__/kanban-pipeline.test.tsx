import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanPipeline } from "../kanban-pipeline";
import type { KanbanColumn, KanbanSideCounters } from "@/lib/admin/spec-types";

const counters: KanbanSideCounters = { stalled: 0, stalledOnHold: 0, cancelled: 0, refunded: 0 };

const columns: KanbanColumn[] = [
  {
    status: "building",
    cards: [
      {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        customerLabel: "Cascade Deck & Rail",
        tier: "spec03",
        status: "building",
        holdType: null,
        daysInStatus: 4,
        totalCommittedCents: 625_000,
        nextActionLabel: null,
        isTest: false,
      },
    ],
  },
];

describe("KanbanPipeline card tier chip", () => {
  it("renders the SPEC-0N designation, never the raw slug", () => {
    render(<KanbanPipeline columns={columns} counters={counters} />);
    expect(screen.getByText("SPEC-03")).toBeTruthy();
    expect(screen.queryByText("SPEC03")).toBeNull();
  });
});
