/**
 * Tests for the collapsible lead summary strip (`lead-map-band.tsx`).
 *
 * Redesign (lead-detail audit, Direction A, 2026-07-09): the band no longer
 * paints a fixed 158px map slab. By default it is a slim ~44px ADDRESS STRIP
 * (address + a map glyph + an expand chevron). Tapping the strip reveals the
 * full deal band — a non-interactive ProjectMap backdrop (ONLY when the lead
 * has coordinates; a lead with no coordinates reveals its facts on the plain
 * canvas — never a decorative grid), a bottom-weighted scrim, the
 * estimated-value hero, and the inline-editable facts row. Tapping again
 * collapses it.
 *
 * The band owns ONE `useOpportunityFieldEdit` instance and threads it into every
 * editor — but the hook hits TanStack Query + the live mutation engine, so here
 * we let the band create the real hook and instead stub the network boundary it
 * sits on (`useUpdateOpportunity`). That keeps the component honest about wiring
 * `edit` through while never touching Supabase.
 *
 * Contract under test:
 *  - collapsed default → only the strip: address is shown; the map, the
 *    value hero, the facts, and the Open-in-Maps link are NOT rendered,
 *  - the strip toggle advertises "Show map" (has coords) / "Show details"
 *    (no coords) and carries `aria-expanded`,
 *  - no coordinates → NO map and NO decorative grid, ever (collapsed OR
 *    expanded); the facts still reveal on the plain canvas,
 *  - expand → the ProjectMap backdrop, value hero, facts, and the Open-in-Maps
 *    link appear; the retired win-probability metric stays absent,
 *  - read-only (!canManage) → once expanded the facts are pure read-outs; the
 *    strip toggle is the only button and no edit ever reaches the mutation.
 */

import * as React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
        {
          id: "user-ada",
          firstName: "Ada",
          lastName: "Lovelace",
          isActive: true,
          profileImageURL: null,
        },
        {
          id: "user-grace",
          firstName: "Grace",
          lastName: "Hopper",
          isActive: true,
          profileImageURL: null,
        },
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
  })
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

/** Open the reveal by clicking the persistent strip toggle. */
function expandBand() {
  fireEvent.click(screen.getByTestId("lead-map-strip"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Collapsed default (strip only) ───────────────────────────────────────────

describe("LeadMapBand — collapsed default", () => {
  it("shows only the address strip — the map, hero, facts, and Open-in-Maps are not rendered", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);

    const band = screen.getByTestId("lead-map-band");
    // The address rides in the persistent strip.
    expect(within(band).getByText(/1180 Howe St/)).toBeInTheDocument();
    // Collapsed: none of the reveal content is mounted.
    expect(screen.queryByTestId("project-map-mock")).toBeNull();
    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
    expect(screen.queryByText(formatCurrency(14200))).toBeNull();

    const strip = screen.getByTestId("lead-map-strip");
    expect(strip).toHaveAttribute("aria-expanded", "false");
  });

  it("advertises 'Show map' when the lead has coordinates", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);
    expect(
      screen.getByRole("button", { name: /show map/i }),
    ).toBeInTheDocument();
  });

  it("advertises 'Show details' (not a map) when the lead has NO coordinates", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ latitude: null, longitude: null })}
        canManage
      />,
    );
    expect(
      screen.getByRole("button", { name: /show details/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show map/i })).toBeNull();
  });

  it("shows the em-dash sentinel in the strip when there is no address", () => {
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
    const band = screen.getByTestId("lead-map-band");
    expect(within(band).getByText("—")).toBeInTheDocument();
  });
});

// ─── No decorative grid, ever ─────────────────────────────────────────────────

describe("LeadMapBand — no coordinates never paints a grid", () => {
  it("collapsed: no map and no grid fallback", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ latitude: null, longitude: null })}
        canManage
      />,
    );
    expect(screen.queryByTestId("project-map-mock")).toBeNull();
    // The retired tactical-grid fallback must never render again.
    expect(screen.queryByTestId("lead-map-grid-fallback")).toBeNull();
  });

  it("expanded: the facts reveal on the plain canvas — still no map, still no grid", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ latitude: null, longitude: null })}
        canManage
      />,
    );
    expandBand();
    expect(screen.queryByTestId("project-map-mock")).toBeNull();
    expect(screen.queryByTestId("lead-map-grid-fallback")).toBeNull();
    // The value hero (an editor with nowhere else to live) still reveals.
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
  });
});

// ─── Expand → reveal ──────────────────────────────────────────────────────────

describe("LeadMapBand — expand reveals the deal band", () => {
  it("reveals the ProjectMap backdrop (stage-colored pin) when coordinates exist", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);
    expandBand();

    const map = screen.getByTestId("project-map-mock");
    expect(map).toBeInTheDocument();
    expect(map).toHaveAttribute(
      "data-pin-color",
      OPPORTUNITY_STAGE_COLORS[OpportunityStage.Quoting]
    );
    expect(screen.getByTestId("lead-map-strip")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("reveals the estimated-value hero without the retired win-probability metric", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({ estimatedValue: 14200, winProbability: 40 })}
        canManage
      />,
    );
    expandBand();
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
    expect(screen.queryByText(/40%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bwin\b/i)).not.toBeInTheDocument();
  });

  it("shows the em-dash sentinel for a null value once expanded", () => {
    render(<LeadMapBand opportunity={makeOpportunity({ estimatedValue: null })} canManage />);
    expandBand();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ─── Open in Maps (inside the reveal) ─────────────────────────────────────────

describe("LeadMapBand — Open in Maps link", () => {
  it("links to the coordinate search when lat/lng exist", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);
    expandBand();

    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=49.2785,-123.1278"
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
      />
    );
    expandBand();

    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        "1180 Howe St, Vancouver, BC"
      )}`
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
      />
    );
    expandBand();
    expect(screen.queryByRole("link", { name: /open in maps/i })).toBeNull();
  });
});

// ─── Read-only mode ───────────────────────────────────────────────────────────

describe("LeadMapBand — read-only (!canManage)", () => {
  it("reveals the facts as pure read-outs — the strip toggle is the only button", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage={false} />);
    expandBand();

    // The only interactive button is the strip toggle itself — every fact
    // editor degrades to a read-out, so there are no edit-trigger buttons.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe(screen.getByTestId("lead-map-strip"));
    // The value is still legible …
    expect(screen.getByText(formatCurrency(14200))).toBeInTheDocument();
    // … and editing never reaches the mutation engine.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("still exposes the Open-in-Maps link on expand in read-only mode", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage={false} />);
    expandBand();
    expect(
      screen.getByRole("link", { name: /open in maps/i }),
    ).toBeInTheDocument();
  });

  it("shows the client/contact name read-only once expanded", () => {
    render(
      <LeadMapBand
        opportunity={makeOpportunity({
          client: null,
          contactName: "Dana Scully",
        })}
        canManage={false}
      />
    );
    expandBand();
    expect(screen.getByText("Dana Scully")).toBeInTheDocument();
  });
});

// ─── Address strip (persistent) ───────────────────────────────────────────────

describe("LeadMapBand — persistent address strip", () => {
  it("renders the address inside the always-visible strip toggle", () => {
    render(<LeadMapBand opportunity={makeOpportunity()} canManage />);
    const strip = screen.getByTestId("lead-map-strip");
    expect(within(strip).getByText(/1180 Howe St/)).toBeInTheDocument();
  });
});
