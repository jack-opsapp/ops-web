/**
 * The lead's one visit entry point, now three-state (PUBLIC API P2-4,
 * design §8, invariant I14).
 *
 * A public booking request IS the lead's visit state until somebody decides:
 * nothing is on a calendar, so the strip must not read BOOKED, and the entry
 * point must open the decision rather than the booking modal. No second verb
 * is added to the strip — the one slot carries whichever state is true.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/dictionaries/en/pipeline.json";

const state = {
  openBooking: null as { id: string; scheduledAt: Date } | null,
  request: null as { requestId: string; slotStartAt: string } | null,
};

vi.mock("@/lib/hooks/use-site-visits", () => ({
  useOpenBooking: () => ({ data: state.openBooking }),
}));
vi.mock("@/lib/hooks/use-booking-request", () => ({
  useBookingRequest: () => ({ data: state.request }),
}));
vi.mock("@/lib/hooks", () => ({
  useCompleteFollowUp: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ops/site-visit/book-site-visit-modal", () => ({
  BookSiteVisitModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="book-modal" /> : null,
}));
vi.mock("@/components/ops/site-visit/booking-request-decision", () => ({
  BookingRequestDecision: ({ open }: { open: boolean }) =>
    open ? <div data-testid="decision" /> : null,
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: string | Record<string, unknown>) => {
      const value = (en as Record<string, string>)[key];
      if (typeof value !== "string") return typeof params === "string" ? params : key;
      return value;
    },
  }),
}));

import { PipelineDetailNextSteps } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps";
import { OpportunityStage } from "@/lib/types/pipeline";

const OPPORTUNITY = {
  id: "11111111-1111-4111-8111-111111111111",
  stage: OpportunityStage.NewLead,
  lastOutboundAt: null,
  lastInboundAt: null,
} as never;

const SOON = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

function renderStrip(canManage = true) {
  return render(
    <PipelineDetailNextSteps
      opportunity={OPPORTUNITY}
      followUps={[]}
      canManage={canManage}
    />
  );
}

beforeEach(() => {
  state.openBooking = null;
  state.request = null;
});

describe("the lead's visit slot", () => {
  it("offers the booking when nothing is booked and nothing is pending", () => {
    renderStrip();
    expect(screen.getByRole("button", { name: /BOOK VISIT/ })).toBeTruthy();
    expect(screen.queryByText(/REQUESTED/)).toBeNull();
  });

  it("reads BOOKED for a visit that is really on the calendar", () => {
    state.openBooking = { id: "visit", scheduledAt: SOON };
    renderStrip();
    expect(screen.getByText(/^BOOKED —/)).toBeTruthy();
  });

  it("reads REQUESTED — never BOOKED — while a request is waiting", () => {
    // Nothing is on any calendar yet (I14); saying BOOKED would be a lie.
    state.request = { requestId: "req", slotStartAt: SOON.toISOString() };
    renderStrip();
    expect(screen.getByText(/^REQUESTED —/)).toBeTruthy();
    expect(screen.queryByText(/^BOOKED —/)).toBeNull();
  });

  it("opens the decision, not the booking modal, from a waiting request", () => {
    state.request = { requestId: "req", slotStartAt: SOON.toISOString() };
    renderStrip();
    fireEvent.click(screen.getByRole("button", { name: /REQUESTED —/ }));
    expect(screen.getByTestId("decision")).toBeTruthy();
    expect(screen.queryByTestId("book-modal")).toBeNull();
  });

  it("shows a waiting request read-only to an operator who cannot manage the lead", () => {
    state.request = { requestId: "req", slotStartAt: SOON.toISOString() };
    renderStrip(false);
    expect(screen.getByText(/^REQUESTED —/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /REQUESTED —/ })).toBeNull();
  });

  it("lets a real booking win over a request left behind", () => {
    // Defensive: `request` mode creates no visit, so both should never be
    // true at once — if they are, what is on the calendar is the truth.
    state.openBooking = { id: "visit", scheduledAt: SOON };
    state.request = { requestId: "req", slotStartAt: SOON.toISOString() };
    renderStrip();
    expect(screen.getByText(/^BOOKED —/)).toBeTruthy();
    expect(screen.queryByText(/^REQUESTED —/)).toBeNull();
  });

  it("adds no second verb to the strip", () => {
    state.request = { requestId: "req", slotStartAt: SOON.toISOString() };
    renderStrip();
    expect(screen.queryByRole("button", { name: /ACCEPT|DECLINE/ })).toBeNull();
  });
});
