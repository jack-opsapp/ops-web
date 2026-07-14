/**
 * Tests for the map-backed lead summary band (`lead-map-band.tsx`).
 *
 * `LeadMapBand` sits at the top of the lead-detail window. It paints a
 * non-interactive ProjectMap (or a tactical-grid fallback when the lead has no
 * coordinates) under a bottom-weighted scrim, then anchors the estimated-value
 * hero + the inline-editable facts row along the bottom.
 *
 * The band owns ONE `useOpportunityFieldEdit` instance and threads it into every
 * editor — but the hook hits TanStack Query + the live mutation engine, so here
 * we let the band create the real hook and instead stub the network boundary it
 * sits on (`useUpdateOpportunity`). That keeps the component honest about wiring
 * `edit` through while never touching Supabase.
 *
 * Contract under test (mirrors the Phase 3 plan + §6 of the design spec):
 *  - coords present  → the (mocked) ProjectMap backdrop renders,
 *  - no coords       → a tactical-grid fallback renders AND there is no
 *                      "Open in Maps" link when there's also no address,
 *  - "Open in Maps"  → href is the google maps search URL for `lat,lng`,
 *  - value           → shows the `—` sentinel when `estimatedValue` is null,
 *  - read-only       → when `canManage` is false the facts render as pure
 *                      read-outs (no edit trigger buttons).
 */

import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

// The global setup registers jest-dom via setupFiles, but when this file is run
// through a name filter (`vitest run lead-map-band`) the matcher extension is
// not reliably applied to the worker — so register it explicitly here. This is
// idempotent and harmless when the global registration also runs.
expect.extend(jestDomMatchers);

import {
  OpportunityPriority,
  OpportunitySource,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  formatCurrency,
  type Opportunity,
} from "@/lib/types/pipeline";

// Echo-key dictionary so labels are deterministic; `t(key, fallback)` returns
// the English fallback when present, so forward it.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

// ProjectMap is Mapbox-backed (no WebGL in jsdom) — render a marker we can find.
vi.mock("@/components/ops/projects/workspace/map/project-map", () => ({
  ProjectMap: ({ pinColor }: { pinColor: string }) => (
    <div data-testid="project-map-mock" data-pin-color={pinColor} />
  ),
}));

// OwnerField loads the team via this hook; give it two active members.
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({
    data: {
      users: [
        { id: "user-ada", firstName: "Ada", lastName: "Lovelace", isActive: true, profileImageURL: null },
        { id: "user-grace", firstName: "Grace", lastName: "Hopper", isActive: true, profileImageURL: null },
      ],
    },
    isLoading: false,
  }),
}));

// AddressField (only reachable in editable mode) is geocode-backed — stub it.
vi.mock(
  "@/components/ops/projects/workspace/inputs/address-autocomplete",
  () => ({
    AddressAutocomplete: ({ value }: { value: string }) => (
      <input aria-label="address-autocomplete-stub" defaultValue={value} />
    ),
  }),
);

// The band owns a real `useOpportunityFieldEdit`, which sits on
// `useUpdateOpportunity`. Stub only that network boundary so the hook works
// without TanStack Query / Supabase.
const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/hooks/use-opportunities", () => ({
  useUpdateOpportunity: () => ({ mutateAsync }),
}));

import { LeadMapBand } from "@/app/(dashboard)/pipeline/_components/lead-map-band";

// ─── Fixture ────────────────────────────────────────────────────────────────

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  const now = new Date("2026-06-01T12:00:00.000Z");
  return {
    id: "opp-1",
    companyId: "co-1",
    clientId: null,
    title: "Greenway re-roof",
    description: null,
    contactName: "Dana Scully",
    contactEmail: null,
    contactPhone: null,
    stage: OpportunityStage.Quoting,
    source: OpportunitySource.Referral,
    assignedTo: "user-ada",
    priority: OpportunityPriority.High,
    estimatedValue: 14200,
    actualValue: null,
    winProbability: 40,
    expectedCloseDate: new Date("2026-07-15T12:00:00.000Z"),
    actualCloseDate: null,
    stageEnteredAt: now,
    projectId: null,
    lostReason: null,
    lostNotes: null,
    quoteDeliveryMethod: null,
    address: "1180 Howe St, Vancouver, BC",
    latitude: 49.2785,
    longitude: -123.1278,
    sourceEmailId: null,
    correspondenceCount: 0,
    outboundCount: 0,
    inboundCount: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    aiSummary: null,
    aiStageConfidence: null,
    aiStageSignals: null,
    detectedValue: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    tags: [],
    images: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Backdrop ───────────────────────────────────────────────────────────────

describe("LeadMapBand — backdrop", () => {
  it("renders the ProjectMap backdrop (stage-colored pin) when coordinates exist", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);

    const map = screen.getByTestId("project-map-mock");
    expect(map).toBeInTheDocument();
    expect(map).toHaveAttribute(
      "data-pin-color",
      OPPORTUNITY_STAGE_COLORS[OpportunityStage.Quoting],
    );
    // The grid fallback must NOT render when there's a map.
    expect(screen.queryByTestId("lead-map-grid-fallback")).toBeNull();
  });

  it("renders the tactical-grid fallback (no ProjectMap) when coordinates are missing", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ latitude: null, longitude: null })}
        canManage
      />,
    );

    expect(screen.queryByTestId("project-map-mock")).toBeNull();
    expect(screen.getByTestId("lead-map-grid-fallback")).toBeInTheDocument();
  });
});

// ─── Open in Maps ─────────────────────────────────────────────────────────────

describe("LeadMapBand — Open in Maps link", () => {
  it("links to the google maps coordinate search when lat/lng exist", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);

    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=49.2785,-123.1278",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("falls back to the encoded-address search when there are no coordinates", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({
          latitude: null,
          longitude: null,
          address: "1180 Howe St, Vancouver, BC",
        })}
        canManage
      />,
    );

    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        "1180 Howe St, Vancouver, BC",
      )}`,
    );
  });

  it("renders NO Open-in-Maps link when there are neither coordinates nor an address", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({
          latitude: null,
          longitude: null,
          address: null,
        })}
        canManage
      />,
    );

    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
    // And the grid fallback still paints — never a naked/empty map.
    expect(screen.getByTestId("lead-map-grid-fallback")).toBeInTheDocument();
  });
});

// ─── Value hero ───────────────────────────────────────────────────────────────

describe("LeadMapBand — estimated value hero", () => {
  it("shows the formatted currency value", () => {
    render(<LeadMapBand opportunity={makeOpportunity({ estimatedValue: 14200 })} canManage />);
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
  });

  it("shows the em-dash sentinel when the value is null", () => {
    render(<LeadMapBand opportunity={makeOpportunity({ estimatedValue: null })} canManage />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ─── Win probability (read-only) ──────────────────────────────────────────────

describe("LeadMapBand — win probability", () => {
  it("renders the read-only win percentage (never an edit trigger)", () => {
    render(<LeadMapBand opportunity={makeOpportunity({ winProbability: 40 })} canManage />);
    // The win readout is informational text, not a button.
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });
});

// ─── Read-only mode ───────────────────────────────────────────────────────────

describe("LeadMapBand — read-only (!canManage)", () => {
  it("renders the facts as pure read-outs with no edit triggers", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage={false} />);

    // No inline-edit trigger buttons anywhere in the band when read-only.
    expect(screen.queryByRole("button")).toBeNull();
    // The value is still legible …
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
    // … and editing never reaches the mutation engine.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("still renders the Open-in-Maps link in read-only mode", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage={false} />);
    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toBeInTheDocument();
  });

  it("shows the client/contact name read-only", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ client: null, contactName: "Dana Scully" })}
        canManage={false}
      />,
    );
    expect(screen.getByText("Dana Scully")).toBeInTheDocument();
  });
});

// ─── Address line ─────────────────────────────────────────────────────────────

describe("LeadMapBand — band-top address", () => {
  it("renders the address in the band-top region", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);
    const band = screen.getByTestId("lead-map-band");
    expect(within(band).getByText(/1180 Howe St/)).toBeInTheDocument();
  });
});
