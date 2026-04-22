/**
 * Unit tests for ProspectSheet (Task 21).
 *
 * Mocks global.fetch. The sheet is rendered directly with a fixed
 * prospectId and we drive its lifecycle by controlling fetch responses.
 *
 * Verifies:
 *  - Loading skeleton during the initial fetch
 *  - Render of prospect fields + source Tag with correct variant
 *  - Tier A vs base SaaS branching for fee/deposit inputs
 *  - PATCH on stage change, with reconciliation from the response row
 *  - Fetch failure renders the dedicated error UI
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ProspectSheet } from "@/components/pmf/prospect-sheet";
import type { Prospect, Deal } from "@/lib/pmf/types";

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "p-1",
    name: "Jane Foreman",
    company: "Acme Roofing",
    email: "jane@acme.test",
    phone: "+1 555 0100",
    source: "referral",
    referred_by_company_id: null,
    deal_type: "tier_a",
    first_contact_at: "2026-04-01T17:30:00.000Z",
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
    stage_entered_at: "2026-04-01T17:30:00.000Z",
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
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProspectSheet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading skeleton initially", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<ProspectSheet prospectId="p-1" />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders prospect fields + source Tag (referral → olive variant)", async () => {
    const prospect = makeProspect({ source: "referral" });
    const deal = makeDeal();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...prospect, pmf_deals: [deal] } }),
      }),
    );

    render(<ProspectSheet prospectId="p-1" />);

    await waitFor(() => {
      // "Acme Roofing" appears twice — once as the page heading and once
      // in the COMPANY row. Both are correct; assert at least one renders.
      expect(screen.getAllByText("Acme Roofing").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Jane Foreman")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.test")).toBeInTheDocument();
    expect(screen.getByText("+1 555 0100")).toBeInTheDocument();

    // Source tag uses olive variant for referral.
    const tag = screen.getByText("REFERRAL");
    expect(tag.className).toContain("text-[color:var(--olive)]");

    // first_contact_at formatted via fmtDateTime (yyyy-MM-dd · HH:mm,
    // America/Vancouver). 2026-04-01T17:30:00Z = 10:30 PDT. Same value
    // is reused on the deal's stage_entered_at footer; assert both render.
    expect(
      screen.getAllByText(/2026-04-01 · 10:30/).length,
    ).toBeGreaterThan(0);

    // deal_type renders TIER A
    expect(screen.getByText("TIER A")).toBeInTheDocument();
  });

  it("renders DEAL section with the deal stage uppercased", async () => {
    const deal = makeDeal({ stage: "qualified" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { ...makeProspect(), pmf_deals: [deal] },
        }),
      }),
    );
    render(<ProspectSheet prospectId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText("DEAL")).toBeInTheDocument();
    });
    // The stage chip shows the current stage uppercased. There are
    // multiple matches (the chip + the corresponding <option>) — assert
    // both are present.
    expect(screen.getAllByText("QUALIFIED").length).toBeGreaterThanOrEqual(2);
  });

  it("Tier A deal shows IMPLEMENTATION FEE and DEPOSIT inputs", async () => {
    const deal = makeDeal({
      deal_type: "tier_a",
      implementation_fee_cents: 500_000,
      deposit_amount_cents: 100_000,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { ...makeProspect({ deal_type: "tier_a" }), pmf_deals: [deal] },
        }),
      }),
    );
    render(<ProspectSheet prospectId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText("IMPLEMENTATION FEE")).toBeInTheDocument();
    });
    expect(screen.getByText("DEPOSIT")).toBeInTheDocument();

    // Initial values reflect cents → dollars conversion
    expect(screen.getByDisplayValue("5000")).toBeInTheDocument(); // $5,000.00
    expect(screen.getByDisplayValue("1000")).toBeInTheDocument(); // $1,000.00
  });

  it("Base SaaS deal does NOT show fee/deposit inputs", async () => {
    const deal = makeDeal({ deal_type: "base_saas" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            ...makeProspect({ deal_type: "base_saas" }),
            pmf_deals: [deal],
          },
        }),
      }),
    );
    render(<ProspectSheet prospectId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText("DEAL")).toBeInTheDocument();
    });
    expect(screen.queryByText("IMPLEMENTATION FEE")).toBeNull();
    expect(screen.queryByText("DEPOSIT")).toBeNull();
  });

  it("stage change PATCHes with the new stage and reconciles state from the response", async () => {
    const initialDeal = makeDeal({
      stage: "contacted",
      stage_entered_at: "2026-04-01T00:00:00.000Z",
    });
    const reconciledDeal: Deal = {
      ...initialDeal,
      stage: "qualified",
      // Server trigger updated stage_entered_at; sheet must reflect this.
      stage_entered_at: "2026-04-15T12:00:00.000Z",
    };

    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { ...makeProspect(), pmf_deals: [initialDeal] },
        }),
      })
      // PATCH response
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: reconciledDeal }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProspectSheet prospectId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText("DEAL")).toBeInTheDocument();
    });

    // The stage <select> currently shows CONTACTED — change it.
    const stageSelect = screen.getByDisplayValue(/CONTACTED/);
    fireEvent.change(stageSelect, { target: { value: "qualified" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/pmf/deals/d-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body.stage).toBe("qualified");

    // Reconciliation: the new stage_entered_at from the server should
    // surface in the "STAGE ENTERED · ..." footer. fmtDateTime renders
    // 2026-04-15T12:00:00Z in America/Vancouver as 2026-04-15 · 05:00.
    await waitFor(() => {
      expect(screen.getByText(/2026-04-15 · 05:00/)).toBeInTheDocument();
    });
  });

  it("renders the dedicated error UI when fetch fails (no prospect chrome)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Not found" }),
      }),
    );
    render(<ProspectSheet prospectId="missing" />);

    await waitFor(() => {
      expect(screen.getByText(/FAILED TO LOAD/)).toBeInTheDocument();
    });
    expect(screen.getByText(/fetch failed: 404/)).toBeInTheDocument();
    // Critical: the prospect detail chrome must NOT render alongside
    // the error (no fields, no DEAL section).
    expect(screen.queryByText("Acme Roofing")).toBeNull();
    expect(screen.queryByText("DEAL")).toBeNull();
  });
});
