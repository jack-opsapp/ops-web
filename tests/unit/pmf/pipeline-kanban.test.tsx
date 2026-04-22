/**
 * Unit tests for PipelineKanban + ProspectCard.
 *
 * dnd-kit hooks are mocked because:
 *   1. They require a DndContext provider for non-trivial behavior, and
 *      the parent component owns that — testing it would mean booting
 *      the entire DnD machinery in jsdom.
 *   2. Drag simulation in jsdom is brittle (PointerEvent + measurement
 *      are flaky / unsupported). We exercise the data flow (fetch →
 *      render → optimistic update path) instead, which is where bugs
 *      actually live.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  closestCorners: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
  rectSortingStrategy: undefined,
  sortableKeyboardCoordinates: () => ({ x: 0, y: 0 }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

import { ProspectCard } from "@/components/pmf/prospect-card";
import { PipelineKanban } from "@/components/pmf/pipeline-kanban";
import type { Prospect, Deal, ProspectSource } from "@/lib/pmf/types";

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "p-1",
    name: "Jane Foreman",
    company: "Acme Roofing",
    email: "jane@acme.test",
    phone: null,
    source: "referral" as ProspectSource,
    referred_by_company_id: null,
    deal_type: "tier_a",
    first_contact_at: "2026-04-01T00:00:00.000Z",
    first_contact_direction: "inbound",
    notes: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "d-1",
    prospect_id: "p-1",
    stage: "contacted",
    // fixed past date so date-fns produces deterministic output
    stage_entered_at: "2026-04-14T00:00:00.000Z",
    deal_type: "tier_a",
    sow_signed_at: null,
    sow_url: null,
    implementation_fee_cents: null,
    deposit_paid_at: null,
    deposit_amount_cents: null,
    final_paid_at: null,
    delivered_at: null,
    closed_at: null,
    closed_reason: null,
    created_at: "2026-04-14T00:00:00.000Z",
    updated_at: "2026-04-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProspectCard", () => {
  it("renders prospect.company when present", () => {
    render(<ProspectCard prospect={makeProspect({ company: "Acme Roofing" })} deal={makeDeal()} />);
    expect(screen.getByText("Acme Roofing")).toBeInTheDocument();
  });

  it("falls back to prospect.name when company is null", () => {
    render(
      <ProspectCard
        prospect={makeProspect({ company: null, name: "Solo Pro" })}
        deal={makeDeal()}
      />,
    );
    expect(screen.getByText("Solo Pro")).toBeInTheDocument();
  });

  it("uses olive variant Tag for referral source", () => {
    render(<ProspectCard prospect={makeProspect({ source: "referral" })} deal={makeDeal()} />);
    const tag = screen.getByText("REFERRAL");
    expect(tag.className).toContain("text-[color:var(--olive)]");
  });

  it("uses tan variant Tag for paid_ad source", () => {
    render(<ProspectCard prospect={makeProspect({ source: "paid_ad" })} deal={makeDeal()} />);
    const tag = screen.getByText("PAID");
    expect(tag.className).toContain("text-[color:var(--tan)]");
  });

  it("uses default variant Tag for outbound_cold source", () => {
    render(<ProspectCard prospect={makeProspect({ source: "outbound_cold" })} deal={makeDeal()} />);
    const tag = screen.getByText("COLD");
    expect(tag.className).toContain("text-[color:var(--text-2)]");
  });

  it("renders a days-in-stage label derived from stage_entered_at", () => {
    // formatDistanceToNowStrict reads from the current clock; assert
    // only that some non-empty time-distance text is rendered for the
    // fixed past date.
    render(<ProspectCard prospect={makeProspect()} deal={makeDeal()} />);
    expect(screen.getByText(/(year|month|day|hour|minute|second)s?/i)).toBeInTheDocument();
  });

  it("does NOT carry role=button (avoids Space-key drag/click collision)", () => {
    // KeyboardSensor uses Space to grab a sortable item. Browsers fire
    // click on Space for role="button" elements, which would double-fire
    // any onClick wired by Task 21 (prospect sheet). The card uses
    // role="article" instead so Space only triggers the drag.
    render(<ProspectCard prospect={makeProspect()} deal={makeDeal()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("article")).toBeInTheDocument();
  });
});

describe("PipelineKanban", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the loading skeleton initially", () => {
    // Pending fetch — do not resolve.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<PipelineKanban />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders 6 columns with em-dash placeholders when data is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      }),
    );

    render(<PipelineKanban />);
    await waitFor(() => {
      expect(screen.getByText("CONTACTED")).toBeInTheDocument();
    });
    expect(screen.getByText("QUALIFIED")).toBeInTheDocument();
    expect(screen.getByText("PROPOSAL")).toBeInTheDocument();
    expect(screen.getByText("NEGOTIATION")).toBeInTheDocument();
    expect(screen.getByText("SIGNED")).toBeInTheDocument();
    expect(screen.getByText("DELIVERED")).toBeInTheDocument();

    // Each column shows [0] and a — placeholder
    expect(screen.getAllByText("[0]")).toHaveLength(6);
    expect(screen.getAllByText("—")).toHaveLength(6);
  });

  it("renders cards in their correct columns from fetched data", async () => {
    const nestedProspects = [
      {
        ...makeProspect({ id: "p-1", company: "Acme Roofing" }),
        pmf_deals: [makeDeal({ id: "d-1", prospect_id: "p-1", stage: "qualified" })],
      },
      {
        ...makeProspect({ id: "p-2", company: "Bolt HVAC", source: "paid_ad" }),
        pmf_deals: [makeDeal({ id: "d-2", prospect_id: "p-2", stage: "proposal" })],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: nestedProspects }),
      }),
    );

    render(<PipelineKanban />);
    await waitFor(() => {
      expect(screen.getByText("Acme Roofing")).toBeInTheDocument();
    });
    expect(screen.getByText("Bolt HVAC")).toBeInTheDocument();

    // Counts: qualified=1, proposal=1, others=0
    const counts = screen.getAllByText(/^\[\d+\]$/).map((el) => el.textContent);
    expect(counts.filter((c) => c === "[1]")).toHaveLength(2);
    expect(counts.filter((c) => c === "[0]")).toHaveLength(4);
  });

  it("renders a full-replacement error state when initial fetch fails (no empty grid)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      }),
    );

    render(<PipelineKanban />);
    await waitFor(() => {
      expect(screen.getByText(/FAILED TO LOAD/)).toBeInTheDocument();
    });
    // The fetch error message is included for diagnostics.
    expect(screen.getByText(/fetch failed: 500/)).toBeInTheDocument();
    // Critically: the column grid must NOT render alongside the error
    // (previous behavior co-rendered an empty 6-column board that
    // looked like real data).
    expect(screen.queryByText("CONTACTED")).toBeNull();
    expect(screen.queryByText("QUALIFIED")).toBeNull();
    expect(screen.queryByText("PROPOSAL")).toBeNull();
    expect(screen.queryByText("NEGOTIATION")).toBeNull();
    expect(screen.queryByText("SIGNED")).toBeNull();
    expect(screen.queryByText("DELIVERED")).toBeNull();
  });

  // TEST GAP: multi-error display ("(+N more)" badge) is not unit
  // tested. Exercising it requires either simulating two failed drags
  // through the dnd-kit DragEndEvent path (the hooks are mocked here,
  // so DragEnd never fires) or extracting the error-banner JSX into a
  // separate component to test in isolation. The banner logic is small
  // and pure (Object.values(errors) + slice the last entry), and the
  // per-deal scoping is exercised by the success-path code in the
  // PATCH handler. Revisit if the banner grows more logic.
});
