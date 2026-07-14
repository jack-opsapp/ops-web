/**
 * `// DECK DESIGN` section — the lead-attached deck card + view-only viewer.
 *
 * Contract under test:
 *   - State-aware: NOTHING renders when the lead has no deck rows.
 *   - A row shows the title, the mono `V{n} · {date}` stamp, and prefers the
 *     wireframe glyph (SVG) when geometry is valid; falls back to the raster
 *     thumbnail, then the icon.
 *   - Clicking a row opens the view-only viewer dialog; close returns.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

const useDeckDesignsMock = vi.fn();
vi.mock("@/lib/hooks/use-opportunity-deck-designs", () => ({
  useOpportunityDeckDesigns: (id: unknown) => useDeckDesignsMock(id),
}));

import { PipelineDetailDeckSection } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-deck-section";
import type { OpportunityDeckDesign } from "@/lib/api/services/deck-design-service";

const RECT_GEOMETRY = {
  vertices: [
    { id: "v1", position: [0, 0] },
    { id: "v2", position: [200, 0] },
    { id: "v3", position: [200, 100] },
    { id: "v4", position: [0, 100] },
  ],
  edges: [
    { id: "e1", startVertexId: "v1", endVertexId: "v2" },
    { id: "e2", startVertexId: "v2", endVertexId: "v3" },
    { id: "e3", startVertexId: "v3", endVertexId: "v4" },
    { id: "e4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

function makeDesign(
  overrides: Partial<OpportunityDeckDesign> = {},
): OpportunityDeckDesign {
  return {
    id: "deck-1",
    title: "Back deck — cedar",
    thumbnailUrl: null,
    version: 3,
    projectId: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-13T12:00:00.000Z"),
    vertices: RECT_GEOMETRY.vertices,
    edges: RECT_GEOMETRY.edges,
    ...overrides,
  };
}

beforeEach(() => {
  useDeckDesignsMock.mockReset();
});

describe("PipelineDetailDeckSection", () => {
  it("renders nothing when the lead has no deck designs", () => {
    useDeckDesignsMock.mockReturnValue({ data: [] });
    const { container } = render(
      <PipelineDetailDeckSection opportunityId="opp-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the query has no data yet", () => {
    useDeckDesignsMock.mockReturnValue({ data: undefined });
    const { container } = render(
      <PipelineDetailDeckSection opportunityId="opp-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the section header, title, and mono version·date stamp", () => {
    useDeckDesignsMock.mockReturnValue({ data: [makeDesign()] });
    render(<PipelineDetailDeckSection opportunityId="opp-1" />);

    expect(screen.getByTestId("overview-deck-design")).toBeInTheDocument();
    expect(screen.getByText("Deck design")).toBeInTheDocument();
    expect(screen.getByText("Back deck — cedar")).toBeInTheDocument();
    expect(screen.getByText("V3 · Jul 13")).toBeInTheDocument();
  });

  it("prefers the wireframe glyph when geometry is valid", () => {
    useDeckDesignsMock.mockReturnValue({ data: [makeDesign()] });
    render(<PipelineDetailDeckSection opportunityId="opp-1" />);
    expect(screen.getByTestId("deck-wireframe")).toBeInTheDocument();
  });

  it("falls back to the thumbnail image when geometry is unusable", () => {
    useDeckDesignsMock.mockReturnValue({
      data: [
        makeDesign({
          vertices: [],
          edges: [],
          thumbnailUrl: "https://example.com/thumb.png",
        }),
      ],
    });
    const { container } = render(
      <PipelineDetailDeckSection opportunityId="opp-1" />,
    );
    expect(screen.queryByTestId("deck-wireframe")).not.toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://example.com/thumb.png"]'),
    ).toBeInTheDocument();
  });

  it("opens the view-only viewer on row click and closes it again", () => {
    useDeckDesignsMock.mockReturnValue({ data: [makeDesign()] });
    render(<PipelineDetailDeckSection opportunityId="opp-1" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /View deck design — Back deck — cedar/,
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders one row per attached deck", () => {
    useDeckDesignsMock.mockReturnValue({
      data: [
        makeDesign(),
        makeDesign({ id: "deck-2", title: "Front porch", version: 1 }),
      ],
    });
    render(<PipelineDetailDeckSection opportunityId="opp-1" />);
    expect(screen.getByText("Back deck — cedar")).toBeInTheDocument();
    expect(screen.getByText("Front porch")).toBeInTheDocument();
  });
});
