/**
 * `BookingRequestDecision` — staff accept/decline on the lead
 * (PUBLIC API P2-4, design §8, invariant I14).
 *
 * A `request`-mode submission is a proposal: nothing is on any calendar
 * until a staff member accepts. Accepting is the call that books the visit,
 * optionally at a time the operator moved it to. Declining books nothing and
 * sends the customer nothing — the lead stays in the pipeline.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/dictionaries/en/pipeline.json";

const { authedFetch, toastSuccess, toastError } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({ authedFetch }));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: string | Record<string, unknown>) => {
      const value = (en as Record<string, string>)[key];
      if (typeof value !== "string") return typeof params === "string" ? params : key;
      if (params && typeof params === "object") {
        return value.replace(/\{(\w+)\}/g, (m, token) =>
          token in params ? String(params[token]) : m
        );
      }
      return value;
    },
  }),
}));

import { BookingRequestDecision } from "@/components/ops/site-visit/booking-request-decision";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

/** A fixed clock so "THU 10:00" is stable wherever this runs. */
const NOW = new Date("2026-10-05T12:00:00.000Z");
const SLOT_LOCAL = new Date(2026, 9, 8, 10, 0, 0);
const MOVED_LOCAL = new Date(2026, 9, 8, 13, 30, 0);

const PENDING = {
  requestId: REQUEST_ID,
  slotStartAt: SLOT_LOCAL.toISOString(),
  durationMinutes: 60,
  contactName: "Dana Whitlock",
  requestedAt: new Date(2026, 9, 5, 9, 0, 0).toISOString(),
  answers: [
    { label: "What needs doing", value: "Back deck rebuild" },
    { label: "Storeys", value: "2" },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function seed(request: unknown, decision?: (status: number) => Response) {
  authedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return jsonResponse(200, { request });
    if (decision) return decision(200);
    return jsonResponse(200, { scheduledAt: SLOT_LOCAL.toISOString(), ok: true });
  });
}

function postCalls(suffix: string) {
  return authedFetch.mock.calls.filter(
    ([input, init]) =>
      (init as RequestInit | undefined)?.method === "POST" && String(input).endsWith(suffix)
  );
}

function postBody(suffix: string): Record<string, unknown> {
  const [, init] = postCalls(suffix)[0];
  return JSON.parse(String((init as RequestInit).body));
}

function renderDecision(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingRequestDecision
        opportunityId={OPPORTUNITY_ID}
        request={PENDING}
        open={open}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>
  );
}

async function openDecision() {
  renderDecision();
  await waitFor(() => expect(screen.getByText("BOOKING REQUEST")).toBeTruthy(), {
    timeout: 10_000,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  authedFetch.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  seed(PENDING);
});

describe("what the operator is deciding", () => {
  it("leads with the time the customer asked for", async () => {
    await openDecision();
    expect(screen.getByTestId("request-slot").textContent).toContain("THU 08 OCT");
    expect(screen.getByTestId("request-slot").textContent).toContain("10:00");
  });

  it("names who asked and when", async () => {
    await openDecision();
    expect(screen.getByText("Dana Whitlock")).toBeTruthy();
    expect(screen.getByTestId("request-asked")).toBeTruthy();
  });

  it("shows what the customer told the website", async () => {
    await openDecision();
    const answers = screen.getByTestId("request-answers");
    expect(within(answers).getByText("What needs doing")).toBeTruthy();
    expect(within(answers).getByText("Back deck rebuild")).toBeTruthy();
  });

  it("shows no contact channel — the store holds none", async () => {
    // The intent keeps a keyed digest and broker ciphertext only (I1); staff
    // reach the person through the client the acceptance resolves.
    await openDecision();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("says what accepting will book, in the booking modal's own grammar", async () => {
    await openDecision();
    expect(screen.getByTestId("request-books").textContent).toContain("1 HR");
    expect(screen.getByTestId("request-books").textContent).toContain("THU 08 OCT");
  });
});

describe("accepting", () => {
  it("books the time as asked without sending a moved time", async () => {
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT" }));
    await waitFor(() => expect(postCalls("/accept")).toHaveLength(1));
    expect(postBody("/accept")).toEqual({ requestId: REQUEST_ID });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("books the operator's own time when they move it", async () => {
    await openDecision();
    fireEvent.change(screen.getByLabelText(/Time/), { target: { value: "13:30" } });
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT" }));
    await waitFor(() => expect(postCalls("/accept")).toHaveLength(1));
    const body = postBody("/accept");
    expect(body.requestId).toBe(REQUEST_ID);
    expect(new Date(String(body.scheduledAt)).getTime()).toBe(MOVED_LOCAL.getTime());
  });

  it("says the time was moved, so nobody accepts a change by accident", async () => {
    await openDecision();
    fireEvent.change(screen.getByLabelText(/Time/), { target: { value: "13:30" } });
    expect(screen.getByTestId("request-moved")).toBeTruthy();
    expect(screen.getByTestId("request-books").textContent).toContain("13:30");
  });

  it("refuses to book a time that has already passed", async () => {
    await openDecision();
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: "2026-10-01" } });
    expect(screen.getByText("// PICK A FUTURE TIME")).toBeTruthy();
    expect((screen.getByRole("button", { name: "ACCEPT" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("says plainly when someone else already decided it", async () => {
    seed(PENDING, () => jsonResponse(409, { error: "Conflict" }));
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("// ALREADY DECIDED — REOPEN THE LEAD")
    );
  });

  it("says plainly when this operator may not decide it", async () => {
    seed(PENDING, () => jsonResponse(403, { error: "Forbidden" }));
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("// NO PERMISSION TO DECIDE THIS REQUEST")
    );
  });
});

describe("declining", () => {
  it("takes two moves, never one stray click", async () => {
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    expect(postCalls("/decline")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM DECLINE" }));
    await waitFor(() => expect(postCalls("/decline")).toHaveLength(1));
    expect(postBody("/decline")).toEqual({ requestId: REQUEST_ID });
  });

  it("says what declining does and does not do", async () => {
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    expect(screen.getByText("books nothing, sends nothing")).toBeTruthy();
  });

  it("books nothing", async () => {
    await openDecision();
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM DECLINE" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("REQUEST DECLINED"));
    expect(postCalls("/accept")).toHaveLength(0);
  });
});
