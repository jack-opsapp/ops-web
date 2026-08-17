/**
 * BookSiteVisitModal — the single booking surface on web (pipeline lead
 * detail + calendar visit popover both open it).
 *
 * Modes:
 *   - book       (no existingBooking): date/time/duration/WHO'S GOING/
 *                HEADS-UP, CTA BOOK VISIT → book_site_visit RPC input
 *   - reschedule (existingBooking set): prefilled, CTA RESCHEDULE →
 *                reschedule_site_visit input (scheduledAt always sent;
 *                DEFAULT heads-up sends -1 only when clearing a stored
 *                override), plus an armed two-click CANCEL VISIT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format } from "date-fns";

import { SiteVisitStatus, type SiteVisit } from "@/lib/types/pipeline";
import { SiteVisitBookingError } from "@/lib/api/services/site-visit-service";

// ─── Hook + service mocks ───────────────────────────────────────────────────

const bookMutate = vi.fn();
const rescheduleMutate = vi.fn();
const cancelMutate = vi.fn();

vi.mock("@/lib/hooks/use-site-visits", () => ({
  useBookSiteVisit: () => ({ mutate: bookMutate, isPending: false }),
  useRescheduleSiteVisit: () => ({
    mutate: rescheduleMutate,
    isPending: false,
  }),
  useCancelSiteVisitBooking: () => ({ mutate: cancelMutate, isPending: false }),
}));

vi.mock("@/lib/hooks", () => ({
  useTeamMembers: () => ({
    data: {
      users: [
        {
          id: "user-me",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          role: "admin",
          userColor: "#59779F",
          isActive: true,
        },
        {
          id: "user-2",
          firstName: "Grace",
          lastName: "Hopper",
          email: "grace@example.com",
          role: "field_crew",
          userColor: "#9DB582",
          isActive: true,
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      currentUser: { id: "user-me", firstName: "Ada", lastName: "Lovelace" },
      company: { id: "co-1" },
    };
    return selector ? selector(state) : state;
  },
}));

// User default heads-up lead — the DEFAULT option label reads from this.
const getPreferencesMock = vi.fn();
vi.mock("@/lib/api/services/notification-preferences-service", () => ({
  NotificationPreferencesService: {
    getPreferences: (...args: unknown[]) => getPreferencesMock(...args),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { BookSiteVisitModal } from "@/components/ops/site-visit/book-site-visit-modal";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const OPP_ID = "bbbbbbbb-2222-4222-8222-222222222222";

function futureDate(daysAhead: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function makeBooking(overrides: Partial<SiteVisit> = {}): SiteVisit {
  return {
    id: "sv-open",
    companyId: "co-1",
    opportunityId: OPP_ID,
    projectId: null,
    clientId: null,
    scheduledAt: futureDate(2, 10),
    durationMinutes: 90,
    assigneeIds: ["user-2"],
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

function renderModal(
  props: Partial<React.ComponentProps<typeof BookSiteVisitModal>> = {}
) {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <BookSiteVisitModal
        opportunityId={OPP_ID}
        open
        onOpenChange={onOpenChange}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onOpenChange };
}

function setDateAndTime(date: Date) {
  const dateInput = screen.getByLabelText("Date");
  const timeInput = screen.getByLabelText("Time");
  fireEvent.change(dateInput, {
    target: { value: format(date, "yyyy-MM-dd") },
  });
  fireEvent.change(timeInput, { target: { value: format(date, "HH:mm") } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPreferencesMock.mockResolvedValue({ siteVisitReminderLeadMinutes: null });
});

// ─── Book mode ──────────────────────────────────────────────────────────────

describe("BookSiteVisitModal — book mode", () => {
  it("books with the composed local datetime, explicit duration + crew, and no reminder key on DEFAULT", () => {
    renderModal();

    const target = futureDate(2, 14, 30);
    setDateAndTime(target);

    fireEvent.click(screen.getByRole("button", { name: "BOOK VISIT" }));

    expect(bookMutate).toHaveBeenCalledTimes(1);
    const input = bookMutate.mock.calls[0][0];
    expect(input.opportunityId).toBe(OPP_ID);
    expect(input.scheduledAt).toEqual(target);
    expect(input.durationMinutes).toBe(60); // default preset
    expect(input.assigneeIds).toEqual(["user-me"]); // booker preselected
    expect("reminderLeadMinutes" in input).toBe(false); // DEFAULT → omit
  });

  it("sends the picked heads-up override", () => {
    renderModal();
    setDateAndTime(futureDate(2, 14));

    const headsUp = screen.getByRole("radiogroup", { name: "Heads-up" });
    fireEvent.click(within(headsUp).getByRole("radio", { name: "1 HR" }));
    fireEvent.click(screen.getByRole("button", { name: "BOOK VISIT" }));

    expect(bookMutate.mock.calls[0][0].reminderLeadMinutes).toBe(60);
  });

  it("lets the operator change duration and crew", () => {
    renderModal();
    setDateAndTime(futureDate(2, 14));

    const duration = screen.getByRole("radiogroup", { name: "Duration" });
    fireEvent.click(within(duration).getByRole("radio", { name: "2 HR" }));
    // Add Grace to WHO'S GOING (Ada stays selected).
    fireEvent.click(screen.getByRole("button", { name: /Grace Hopper/ }));
    fireEvent.click(screen.getByRole("button", { name: "BOOK VISIT" }));

    const input = bookMutate.mock.calls[0][0];
    expect(input.durationMinutes).toBe(120);
    expect(input.assigneeIds).toEqual(["user-me", "user-2"]);
  });

  it("blocks a past time client-side with terse copy", () => {
    renderModal();
    setDateAndTime(futureDate(-1, 9));

    expect(screen.getByText("// PICK A FUTURE TIME")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BOOK VISIT" })).toBeDisabled();
    expect(bookMutate).not.toHaveBeenCalled();
  });

  it("requires at least one crew member", () => {
    renderModal();
    setDateAndTime(futureDate(2, 14));

    // Deselect the preselected booker.
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));

    expect(screen.getByRole("button", { name: "BOOK VISIT" })).toBeDisabled();
  });

  it("closes and confirms tersely on success", () => {
    const { onOpenChange } = renderModal();
    const target = futureDate(2, 10);
    setDateAndTime(target);

    fireEvent.click(screen.getByRole("button", { name: "BOOK VISIT" }));
    bookMutate.mock.calls[0][1].onSuccess();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith(
      `BOOKED — ${format(target, "EEE HH:mm").toUpperCase()}`
    );
  });

  it("maps a conflict error to the reschedule-or-cancel toast", () => {
    renderModal();
    setDateAndTime(futureDate(2, 10));

    fireEvent.click(screen.getByRole("button", { name: "BOOK VISIT" }));
    bookMutate.mock.calls[0][1].onError(
      new SiteVisitBookingError("conflict", "site_visit_already_booked")
    );

    expect(toastError).toHaveBeenCalledWith(
      "// VISIT ALREADY BOOKED — RESCHEDULE OR CANCEL IT FIRST"
    );
  });
});

// ─── Reschedule mode ────────────────────────────────────────────────────────

describe("BookSiteVisitModal — reschedule mode", () => {
  it("prefills the open booking and reschedules with scheduledAt always present", () => {
    const booking = makeBooking();
    renderModal({ existingBooking: booking });

    expect(screen.getByLabelText("Date")).toHaveValue(
      format(booking.scheduledAt, "yyyy-MM-dd")
    );
    expect(screen.getByLabelText("Time")).toHaveValue(
      format(booking.scheduledAt, "HH:mm")
    );

    const newTime = futureDate(3, 15);
    setDateAndTime(newTime);
    fireEvent.click(screen.getByRole("button", { name: "RESCHEDULE" }));

    expect(rescheduleMutate).toHaveBeenCalledTimes(1);
    const input = rescheduleMutate.mock.calls[0][0];
    expect(input.siteVisitId).toBe(booking.id);
    expect(input.scheduledAt).toEqual(newTime);
    expect(input.durationMinutes).toBe(90); // prefilled, passed explicitly
    expect(input.assigneeIds).toEqual(["user-2"]);
    // No stored override, DEFAULT untouched → nothing to clear.
    expect("reminderLeadMinutes" in input).toBe(false);
  });

  it("clears a stored override with -1 when the operator picks DEFAULT", () => {
    const booking = makeBooking({ reminderLeadMinutes: 120 });
    renderModal({ existingBooking: booking });

    const headsUp = screen.getByRole("radiogroup", { name: "Heads-up" });
    fireEvent.click(within(headsUp).getByRole("radio", { name: /DEFAULT/ }));
    fireEvent.click(screen.getByRole("button", { name: "RESCHEDULE" }));

    expect(rescheduleMutate.mock.calls[0][0].reminderLeadMinutes).toBe(-1);
  });

  it("cancels only after arming — first click arms, second commits", () => {
    const booking = makeBooking();
    const { onOpenChange } = renderModal({ existingBooking: booking });

    fireEvent.click(screen.getByRole("button", { name: "CANCEL VISIT" }));
    expect(cancelMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM CANCEL" }));
    expect(cancelMutate).toHaveBeenCalledTimes(1);
    expect(cancelMutate.mock.calls[0][0]).toBe(booking.id);

    cancelMutate.mock.calls[0][1].onSuccess();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith("VISIT CANCELLED");
  });

  it("labels the DEFAULT option from the user's stored lead preference", async () => {
    getPreferencesMock.mockResolvedValue({ siteVisitReminderLeadMinutes: 45 });
    renderModal({ existingBooking: makeBooking() });

    expect(
      await screen.findByRole("radio", { name: "DEFAULT — 45 MIN" })
    ).toBeInTheDocument();
  });

  it("falls back to the product default (30 min) label when no preference is stored", async () => {
    renderModal({ existingBooking: makeBooking() });

    expect(
      await screen.findByRole("radio", { name: "DEFAULT — 30 MIN" })
    ).toBeInTheDocument();
  });
});

// ─── Shared field chrome ────────────────────────────────────────────────────

describe("BookSiteVisitModal — field chrome", () => {
  it("shows an off-preset stored duration as its own selected option", () => {
    renderModal({
      existingBooking: makeBooking({ durationMinutes: 45 }),
    });

    const duration = screen.getByRole("radiogroup", { name: "Duration" });
    const custom = within(duration).getByRole("radio", { name: "45 MIN" });
    expect(custom).toBeInTheDocument();
    expect(custom).toBeChecked();
  });

  it("renders the crew picker with every active company member", () => {
    renderModal();
    const crew = screen.getByTestId("book-visit-crew");
    expect(within(crew).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(crew).getByText("Grace Hopper")).toBeInTheDocument();
  });
});
