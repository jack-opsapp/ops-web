/**
 * Engine readiness ledger — the seven checks shown on /admin/google-ads while
 * the account is dark. The fetch is stubbed; the component is judged on what
 * the operator reads: row titles in order, state labels, blocked reasons,
 * `—` where nothing is known yet, and a skeleton while the request is pending.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReadinessLedger, READINESS_ROW_TITLES } from "../_components/readiness-ledger";

function stubReadiness(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    }))
  );
}

const BLOCKED_FIXTURE = {
  probedAt: "2026-09-09T01:19:21.347Z",
  allReady: false,
  checks: [
    { key: "service_account_role", state: "blocked", reason: "Role is Read only on the manager account" },
    { key: "customer_data_terms", state: "blocked", reason: "Customer data terms not accepted" },
    { key: "enhanced_conversions_for_leads", state: "blocked", reason: "Enhanced conversions for leads is off" },
    { key: "data_manager_api", state: "blocked", reason: "Data Manager API is not enabled on the Cloud project" },
    { key: "conversion_actions", state: "pending", reason: "Setup has not run" },
    { key: "click_id_capture", state: "pending", reason: "No Google click ids in the last 30 days" },
    { key: "first_event_sent", state: "pending", reason: "No events queued yet" },
  ],
  counts: { conversionActions: 0, clickIdCompanies30d: 0, eventStates: {} },
};

const READY_FIXTURE = {
  probedAt: "2026-09-09T04:21:48.193Z",
  allReady: false,
  checks: [
    { key: "service_account_role", state: "ready", reason: "Role is Standard on the manager account" },
    { key: "customer_data_terms", state: "ready", reason: "Customer data terms accepted" },
    { key: "enhanced_conversions_for_leads", state: "ready", reason: "Enhanced conversions for leads is on" },
    { key: "data_manager_api", state: "ready", reason: "Data Manager API accepted a validation request" },
    { key: "conversion_actions", state: "ready", reason: "3 of 3 conversion actions recorded" },
    { key: "click_id_capture", state: "ready", reason: "1 company with a Google click id in the last 30 days" },
    { key: "first_event_sent", state: "pending", reason: "1 event queued, none sent yet" },
  ],
  counts: { conversionActions: 3, clickIdCompanies30d: 1, eventStates: { queued: 1 } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReadinessLedger", () => {
  it("shows a skeleton while the request is pending, never an empty ledger", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ReadinessLedger />);
    expect(screen.getByTestId("readiness-skeleton")).toBeTruthy();
    expect(screen.queryByText("Service account can write")).toBeNull();
  });

  it("renders the seven rows in order with their state and reason", async () => {
    stubReadiness(BLOCKED_FIXTURE);
    render(<ReadinessLedger />);
    await waitFor(() => expect(screen.getByText("Service account can write")).toBeTruthy());

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("[data-row-title]")?.textContent)).toEqual([...READINESS_ROW_TITLES]);
    expect(READINESS_ROW_TITLES).toEqual([
      "Service account can write",
      "Customer data terms accepted",
      "Enhanced conversions for leads",
      "Data Manager API reachable",
      "Conversion actions in place",
      "Click ids arriving",
      "First event delivered",
    ]);
    expect(screen.getAllByText("BLOCKED")).toHaveLength(4);
    expect(screen.getAllByText("PENDING")).toHaveLength(3);
    expect(screen.queryByText("READY")).toBeNull();
    expect(screen.getByText("Role is Read only on the manager account")).toBeTruthy();
    expect(screen.getByText("Data Manager API is not enabled on the Cloud project")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "// ENGINE READINESS" })).toBeTruthy();
    expect(screen.getByText("PROBED 2026-09-09 01:19 UTC")).toBeTruthy();
    expect(rows[0].getAttribute("data-state")).toBe("blocked");
    expect(rows[4].getAttribute("data-state")).toBe("pending");
  });

  it("shows READY rows and the probe time once the account is green", async () => {
    stubReadiness(READY_FIXTURE);
    render(<ReadinessLedger />);
    await waitFor(() => expect(screen.getAllByText("READY")).toHaveLength(6));
    expect(screen.getByText("PENDING")).toBeTruthy();
    expect(screen.getByText("1 event queued, none sent yet")).toBeTruthy();
    expect(screen.getByText("PROBED 2026-09-09 04:21 UTC")).toBeTruthy();
  });

  it("shows — for the probe time when nothing has been probed and a reasonless pending row", async () => {
    stubReadiness({
      ...BLOCKED_FIXTURE,
      probedAt: null,
      checks: BLOCKED_FIXTURE.checks.map((c) => (c.key === "first_event_sent" ? { ...c, reason: "" } : c)),
    });
    render(<ReadinessLedger />);
    await waitFor(() => expect(screen.getByText("Service account can write")).toBeTruthy());
    expect(screen.getByText("PROBED —")).toBeTruthy();
    const last = screen.getAllByRole("listitem")[6];
    expect(last.querySelector("[data-row-reason]")?.textContent).toBe("—");
  });

  it("reports a failed request in one line instead of an empty ledger", async () => {
    stubReadiness({ error: "boom" }, false);
    render(<ReadinessLedger />);
    await waitFor(() => expect(screen.getByText("Readiness unavailable")).toBeTruthy());
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
