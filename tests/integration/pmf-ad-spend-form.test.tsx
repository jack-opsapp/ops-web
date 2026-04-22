/**
 * Integration tests for AdSpendForm (Task 22).
 *
 * Mocks global.fetch and renders the form directly. Asserts:
 *   - the channel dropdown surfaces the 3 manual-entry channels
 *     (meta_ads, apple_search_ads, other) and DOES NOT include
 *     google_ads (which is auto-synced by Task 14's daily cron).
 *   - the POST body shape matches what the route expects, with
 *     spend_usd → spend_cents conversion via Math.round(N * 100) so
 *     "100.50" becomes 10050 cleanly.
 *   - the SAVE button is disabled while in flight to prevent
 *     double-submits.
 *   - "SYS :: SAVED" surfaces on success and "// ERROR" on failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AdSpendForm } from "@/components/pmf/ad-spend-form";

describe("AdSpendForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the 3 manual-entry channels and excludes google_ads", () => {
    render(<AdSpendForm />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    expect(options).toEqual(["meta_ads", "apple_search_ads", "other"]);
    expect(options).not.toContain("google_ads");

    // Display labels are uppercase per the design system.
    expect(screen.getByRole("option", { name: "META ADS" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "APPLE SEARCH ADS" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OTHER" })).toBeInTheDocument();
  });

  it("POSTs the correct body shape with spend_usd '100.50' → spend_cents 10050", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, days: 30 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<AdSpendForm />);

    // Channel: switch to apple_search_ads to prove the value is read
    // from the form, not assumed from the default.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "apple_search_ads" },
    });

    // Month + spend inputs use native types (`month`, `number`) which
    // jsdom doesn't expose by accessible label here, so reach through
    // the form by name.
    const monthInput = container.querySelector(
      'input[name="month"]',
    ) as HTMLInputElement;
    const spendInput = container.querySelector(
      'input[name="spend_usd"]',
    ) as HTMLInputElement;

    fireEvent.change(monthInput, { target: { value: "2026-04" } });
    fireEvent.change(spendInput, { target: { value: "100.50" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/pmf/ad-spend");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      channel: "apple_search_ads",
      month: "2026-04",
      spend_cents: 10050, // 100.50 * 100, rounded
    });
  });

  it("disables the SAVE button while the request is in flight", async () => {
    // Hold the fetch promise open so we can observe the saving state.
    let resolveFetch: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<AdSpendForm />);

    fireEvent.change(
      container.querySelector('input[name="month"]') as HTMLInputElement,
      { target: { value: "2026-04" } },
    );
    fireEvent.change(
      container.querySelector('input[name="spend_usd"]') as HTMLInputElement,
      { target: { value: "50" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // While the request is pending, the button label flips to SAVING
    // and the button is disabled.
    await waitFor(() => {
      const button = screen.getByRole("button", {
        name: /saving/i,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    // Resolve the fetch to clean up the pending state.
    resolveFetch!({ ok: true, json: async () => ({ ok: true, days: 30 }) });

    await waitFor(() => {
      expect(screen.getByText("SYS :: SAVED")).toBeInTheDocument();
    });
  });

  it("shows 'SYS :: SAVED' on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, days: 30 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<AdSpendForm />);

    fireEvent.change(
      container.querySelector('input[name="month"]') as HTMLInputElement,
      { target: { value: "2026-04" } },
    );
    fireEvent.change(
      container.querySelector('input[name="spend_usd"]') as HTMLInputElement,
      { target: { value: "100" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("SYS :: SAVED")).toBeInTheDocument();
    });
    // No error banner.
    expect(screen.queryByText(/\/\/ ERROR/)).not.toBeInTheDocument();
  });

  it("shows '// ERROR' when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<AdSpendForm />);

    fireEvent.change(
      container.querySelector('input[name="month"]') as HTMLInputElement,
      { target: { value: "2026-04" } },
    );
    fireEvent.change(
      container.querySelector('input[name="spend_usd"]') as HTMLInputElement,
      { target: { value: "100" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("// ERROR")).toBeInTheDocument();
    });
    expect(screen.queryByText("SYS :: SAVED")).not.toBeInTheDocument();
  });
});
