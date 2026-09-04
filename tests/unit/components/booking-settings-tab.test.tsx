/**
 * `BookingSettingsTab` — Settings › Comms › Booking (PUBLIC API P2-4,
 * design §8, decision D9).
 *
 * Whether customers can book is the business's choice, expressed as ONE
 * control with three states. Everything below it — hours, notice, horizon,
 * visit length, per-day cap, who bookings go to — is meaningless while the
 * mode is `off`, so none of it is rendered until a mode is chosen.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/dictionaries/en/settings.json";

const { authedFetch, toastSuccess, toastError } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/utils/authed-fetch", () => ({ authedFetch }));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const TEAM = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", firstName: "Rae", lastName: "Okafor", email: "rae@example.com", isActive: true },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", firstName: "Sam", lastName: "Ortiz", email: "sam@example.com", isActive: false },
];
vi.mock("@/lib/hooks", () => ({ useTeamMembers: () => ({ data: { users: TEAM } }) }));

// Real English copy so the assertions pin the shipped strings, not keys.
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

import { BookingSettingsTab } from "@/components/settings/booking-settings-tab";

const TZ = "America/Vancouver";
const RAE = TEAM[0].id;

const OFF_POLICY = {
  mode: "off",
  windows: [],
  timezone: TZ,
  minNoticeHours: 48,
  horizonDays: 21,
  visitDurationMinutes: 60,
  maxBookingsPerDay: null,
  defaultOwnerId: null,
};

const LIVE_POLICY = {
  ...OFF_POLICY,
  mode: "request",
  windows: [{ weekday: 1, start: "08:00", end: "16:00" }],
  maxBookingsPerDay: 3,
  defaultOwnerId: RAE,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function seed(policy: unknown) {
  authedFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return jsonResponse(200, { available: true, publicIntegration: true, policy });
    }
    const sent = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse(200, { policy: sent.policy });
  });
}

function putBodies() {
  return authedFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).policy);
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The one control — named so the duration segment's own radiogroup never
 *  stands in for it. */
function modeGroup(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Website booking" });
}

async function renderTab() {
  renderWithClient(<BookingSettingsTab />);
  // The first render in a file pays the module-compile cost; the default
  // one-second budget is a flake, not a signal.
  await waitFor(() => expect(modeGroup()).toBeTruthy(), { timeout: 10_000 });
}

function modeOption(label: string): HTMLInputElement {
  return screen.getByRole("radio", { name: new RegExp(`^${label}`) }) as HTMLInputElement;
}

function dayRow(day: string): HTMLElement {
  return screen.getByTestId(`booking-day-${day}`);
}

beforeEach(() => {
  authedFetch.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  seed(LIVE_POLICY);
});

describe("the one control", () => {
  it("offers exactly three states, never two toggles", async () => {
    await renderTab();
    expect(within(modeGroup()).getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says what each state means before it is chosen", async () => {
    await renderTab();
    expect(
      screen.getByText("Nobody books from your site. Your contact form still sends leads.")
    ).toBeTruthy();
    expect(
      screen.getByText("They pick a time. Nothing is booked until you accept it.")
    ).toBeTruthy();
    expect(screen.getByText("They pick a time. It lands on your calendar.")).toBeTruthy();
  });

  it("shows the stored state as the chosen one", async () => {
    await renderTab();
    expect(modeOption("REQUEST").checked).toBe(true);
    expect(modeOption("OFF").checked).toBe(false);
  });
});

describe("dead configuration", () => {
  it("renders no terms at all while booking is off", async () => {
    seed(OFF_POLICY);
    await renderTab();
    expect(screen.queryByTestId("booking-hours")).toBeNull();
    expect(screen.queryByTestId("booking-limits")).toBeNull();
    expect(screen.queryByTestId("booking-assignment")).toBeNull();
  });

  it("reveals the terms once a mode is chosen", async () => {
    seed(OFF_POLICY);
    await renderTab();
    fireEvent.click(modeOption("INSTANT"));
    expect(screen.getByTestId("booking-hours")).toBeTruthy();
    expect(screen.getByTestId("booking-limits")).toBeTruthy();
    expect(screen.getByTestId("booking-assignment")).toBeTruthy();
  });

  it("hides them again when booking is switched back off", async () => {
    await renderTab();
    fireEvent.click(modeOption("OFF"));
    expect(screen.queryByTestId("booking-hours")).toBeNull();
  });
});

describe("the weekly grid", () => {
  it("is one row per weekday, working week first", async () => {
    await renderTab();
    const labels = screen
      .getAllByTestId(/^booking-day-/)
      .map((row) => row.getAttribute("data-day"));
    expect(labels).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
  });

  it("shows a day's hours as one start and one end, not free text", async () => {
    await renderTab();
    const monday = dayRow("1");
    expect(within(monday).getByLabelText(/Start/).getAttribute("value")).toBe("08:00");
    expect(within(monday).getByLabelText(/End/).getAttribute("value")).toBe("16:00");
    expect(within(monday).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("shows a closed day as the empty glyph, never a zeroed time", async () => {
    await renderTab();
    expect(within(dayRow("2")).getByText("—")).toBeTruthy();
  });

  it("opens a closed day with the trade's own hours", async () => {
    await renderTab();
    fireEvent.click(within(dayRow("2")).getByRole("button", { name: /Add hours/ }));
    expect(within(dayRow("2")).getByLabelText(/Start/).getAttribute("value")).toBe("08:00");
    expect(within(dayRow("2")).getByLabelText(/End/).getAttribute("value")).toBe("16:00");
  });

  it("closes a day again from the row that owns it", async () => {
    await renderTab();
    fireEvent.click(within(dayRow("1")).getByRole("button", { name: /Remove/ }));
    expect(within(dayRow("1")).getByText("—")).toBeTruthy();
  });

  it("copies the first working day across the week in one move", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: "APPLY MON TO WEEKDAYS" }));
    for (const day of ["2", "3", "4", "5"]) {
      expect(within(dayRow(day)).getByLabelText(/Start/).getAttribute("value")).toBe("08:00");
    }
    // The weekend is the operator's own call, never assumed.
    expect(within(dayRow("6")).getByText("—")).toBeTruthy();
    expect(within(dayRow("0")).getByText("—")).toBeTruthy();
  });

  it("does not offer the copy when Monday is closed", async () => {
    seed({ ...LIVE_POLICY, windows: [{ weekday: 3, start: "08:00", end: "16:00" }] });
    await renderTab();
    expect(screen.queryByRole("button", { name: "APPLY MON TO WEEKDAYS" })).toBeNull();
  });

  it("stops at the fourteen windows the store accepts", async () => {
    const windows = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, start: "08:00", end: "12:00" },
      { weekday, start: "13:00", end: "17:00" },
    ]);
    seed({ ...LIVE_POLICY, windows });
    await renderTab();
    for (const button of screen.getAllByRole("button", { name: /Add hours/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText("[14 windows max]")).toBeTruthy();
  });

  it("names the clock the hours are kept on", async () => {
    await renderTab();
    expect(screen.getByText(`[times are ${TZ}]`)).toBeTruthy();
  });
});

describe("saving", () => {
  it("offers nothing to save until something changes", async () => {
    await renderTab();
    expect(screen.queryByRole("button", { name: "SAVE" })).toBeNull();
  });

  it("stores exactly what the screen shows", async () => {
    await renderTab();
    fireEvent.click(modeOption("INSTANT"));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0]).toEqual({ ...LIVE_POLICY, mode: "instant" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("BOOKING SAVED"));
  });

  it("puts the changes back when they are discarded", async () => {
    await renderTab();
    fireEvent.click(modeOption("OFF"));
    fireEvent.click(screen.getByRole("button", { name: "DISCARD" }));
    expect(modeOption("REQUEST").checked).toBe(true);
    expect(screen.queryByRole("button", { name: "SAVE" })).toBeNull();
  });

  it("refuses to store hours that overlap, and names the reason", async () => {
    await renderTab();
    fireEvent.click(within(dayRow("1")).getByRole("button", { name: /Add hours/ }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(screen.getByText("// TWO WINDOWS OVERLAP ON THE SAME DAY")).toBeTruthy();
    expect(putBodies()).toHaveLength(0);
  });

  it("refuses a visit longer than the longest window", async () => {
    // A 4-hour visit inside a 2-hour window offers zero bookable slots: hours
    // the customer sees and can never use.
    seed({ ...LIVE_POLICY, windows: [{ weekday: 1, start: "08:00", end: "10:00" }] });
    await renderTab();
    fireEvent.click(screen.getByRole("radio", { name: "4 HR" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(screen.getByText("// A VISIT IS LONGER THAN YOUR LONGEST WINDOW")).toBeTruthy();
    expect(putBodies()).toHaveLength(0);
  });

  it("says so plainly when the store refuses the write", async () => {
    await renderTab();
    authedFetch.mockImplementation(async (_input, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? jsonResponse(200, { available: true, publicIntegration: true, policy: LIVE_POLICY })
        : jsonResponse(503, { error: "booking_settings_unavailable" })
    );
    fireEvent.click(modeOption("INSTANT"));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("SYS :: BOOKING SAVE FAILED")
    );
  });
});

describe("limits and assignment", () => {
  it("carries a blank per-day cap as no cap at all", async () => {
    await renderTab();
    fireEvent.change(screen.getByLabelText(/Visits per day/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].maxBookingsPerDay).toBeNull();
  });

  it("sends new bookings to the unassigned queue when nobody is chosen", async () => {
    await renderTab();
    fireEvent.change(screen.getByLabelText(/New bookings go to/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].defaultOwnerId).toBeNull();
  });

  it("never offers a deactivated member as the owner", async () => {
    await renderTab();
    const owner = screen.getByLabelText(/New bookings go to/);
    const options = within(owner).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Rae Okafor");
    expect(options).not.toContain("Sam Ortiz");
  });

  it("never asks the owner to set slot spacing", async () => {
    // A column with a sane default is not a decision put to a business owner.
    await renderTab();
    expect(screen.queryByText(/spacing/i)).toBeNull();
    expect(screen.queryByText(/granularity/i)).toBeNull();
  });
});

describe("when the store cannot answer", () => {
  it("renders nothing rather than an empty policy", async () => {
    authedFetch.mockResolvedValue(jsonResponse(503, { error: "booking_settings_unavailable" }));
    const { container } = renderWithClient(<BookingSettingsTab />);
    await waitFor(() => expect(authedFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("radiogroup", { name: "Website booking" })).toBeNull()
    );
    expect(container.textContent).not.toContain("INSTANT");
  });
});
