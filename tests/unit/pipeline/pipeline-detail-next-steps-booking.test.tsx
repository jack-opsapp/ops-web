/**
 * PipelineDetailNextSteps — booking entry point (one state-aware slot).
 *
 * The strip's trailing slot is the ONLY web entry into visit booking:
 *   - no open booking + canManage  → quiet BOOK VISIT affordance
 *   - open booking                 → BOOKED — THU 10:00 chip (tan), which
 *                                    opens the manage modal for canManage
 *   - never both, never a second stacked booking offer
 *
 * The open booking is read via useOpenBooking (booked_at discriminator) —
 * NOT from the assigned-context rows, which carry no booked_at and would
 * surface legacy junk scheduled_at values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { format } from "date-fns";

import {
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  SiteVisitStatus,
  type Opportunity,
  type SiteVisit,
} from "@/lib/types/pipeline";

const completeFollowUpMutate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useCompleteFollowUp: () => ({
    mutate: completeFollowUpMutate,
    isPending: false,
  }),
}));

const useOpenBookingMock = vi.fn();
vi.mock("@/lib/hooks/use-site-visits", () => ({
  useOpenBooking: (oppId: string | undefined) => useOpenBookingMock(oppId),
}));

// The modal is its own tested surface — stub to a marker that records props.
const modalProps = vi.fn();
vi.mock("@/components/ops/site-visit/book-site-visit-modal", () => ({
  BookSiteVisitModal: (props: {
    open: boolean;
    opportunityId: string;
    existingBooking?: SiteVisit | null;
  }) => {
    modalProps(props);
    return props.open ? <div data-testid="book-visit-modal" /> : null;
  },
}));

import { PipelineDetailNextSteps } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-next-steps";

const OPP_ID = "bbbbbbbb-2222-4222-8222-222222222222";

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPP_ID,
    stage: OpportunityStage.Quoting,
    priority: OpportunityPriority.High,
    source: OpportunitySource.Referral,
    lastOutboundAt: null,
    lastInboundAt: null,
    ...overrides,
  } as Opportunity;
}

function makeOpenBooking(overrides: Partial<SiteVisit> = {}): SiteVisit {
  const scheduledAt = new Date();
  scheduledAt.setDate(scheduledAt.getDate() + 2);
  scheduledAt.setHours(10, 0, 0, 0);
  return {
    id: "sv-open",
    companyId: "co-1",
    opportunityId: OPP_ID,
    projectId: null,
    clientId: null,
    scheduledAt,
    durationMinutes: 60,
    assigneeIds: ["user-me"],
    status: SiteVisitStatus.Scheduled,
    completedAt: null,
    notes: null,
    internalNotes: null,
    measurements: null,
    photos: [],
    activityId: null,
    calendarEventId: null,
    createdBy: "user-me",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    bookedAt: new Date(),
    reminderLeadMinutes: null,
    ...overrides,
  };
}

function renderStrip({
  canManage = true,
  booking = null,
}: {
  canManage?: boolean;
  booking?: SiteVisit | null;
} = {}) {
  useOpenBookingMock.mockReturnValue({ data: booking, isLoading: false });
  render(
    <PipelineDetailNextSteps
      opportunity={makeOpportunity()}
      followUps={[]}
      canManage={canManage}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PipelineDetailNextSteps — booking slot", () => {
  it("offers BOOK VISIT when the slot is free and the operator can manage", () => {
    renderStrip();

    const book = screen.getByRole("button", { name: "BOOK VISIT" });
    fireEvent.click(book);

    expect(screen.getByTestId("book-visit-modal")).toBeInTheDocument();
    const props = modalProps.mock.calls.at(-1)?.[0];
    expect(props.opportunityId).toBe(OPP_ID);
    expect(props.existingBooking ?? null).toBeNull();
  });

  it("renders the open booking as BOOKED — <slot> and opens the manage modal", () => {
    const booking = makeOpenBooking();
    renderStrip({ booking });

    const label = `BOOKED — ${format(booking.scheduledAt, "EEE HH:mm").toUpperCase()}`;
    const chip = screen.getByRole("button", { name: label });

    // One entry point: no separate BOOK affordance while a booking is open.
    expect(
      screen.queryByRole("button", { name: "BOOK VISIT" })
    ).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(screen.getByTestId("book-visit-modal")).toBeInTheDocument();
    expect(modalProps.mock.calls.at(-1)?.[0].existingBooking).toBe(booking);
  });

  it("shows the booked state read-only without manage rights", () => {
    const booking = makeOpenBooking();
    renderStrip({ canManage: false, booking });

    const label = `BOOKED — ${format(booking.scheduledAt, "EEE HH:mm").toUpperCase()}`;
    // Visible as state, not offered as an action.
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: label })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "BOOK VISIT" })
    ).not.toBeInTheDocument();
  });

  it("offers nothing on a free slot without manage rights", () => {
    renderStrip({ canManage: false });

    expect(
      screen.queryByRole("button", { name: "BOOK VISIT" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/BOOKED —/)).not.toBeInTheDocument();
  });

  it("shows a distant booking as BOOKED — <MMM d HH:mm>", () => {
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 30);
    scheduledAt.setHours(9, 30, 0, 0);
    const booking = makeOpenBooking({ scheduledAt });
    renderStrip({ booking });

    const label = `BOOKED — ${format(scheduledAt, "MMM d HH:mm").toUpperCase()}`;
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });
});
