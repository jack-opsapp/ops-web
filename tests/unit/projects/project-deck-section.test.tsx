/**
 * `// DECK DESIGN` in the project workspace (report `acc0d021`).
 *
 * The deck a crew drew on the site visit carries `project_id` from the moment
 * the lead converts — but nothing on the project ever showed it, so the drawing
 * the whole job is built from was stranded on a closed lead.
 *
 * Contract: state-aware (nothing at all when the project has no deck, so the
 * overwhelming majority of jobs pay no footprint for it), one row per design,
 * and the row opens the SAME fullscreen viewer the lead uses.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

const useProjectDeckDesignsMock = vi.fn();
vi.mock("@/lib/hooks/use-deck-design-drawing", () => ({
  useProjectDeckDesigns: (id: unknown) => useProjectDeckDesignsMock(id),
  useDeckDesignDrawing: () => ({
    data: {
      id: "deck-1",
      title: "Back deck — cedar",
      thumbnailUrl: null,
      version: 2,
      projectId: "proj-1",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-13T12:00:00.000Z"),
      drawingData: {
        scaleFactor: 2,
        vertices: [
          { id: "v1", position: [0, 0] },
          { id: "v2", position: [288, 0] },
          { id: "v3", position: [288, 240] },
          { id: "v4", position: [0, 240] },
        ],
        edges: [
          { id: "e1", startVertexId: "v1", endVertexId: "v2" },
          { id: "e2", startVertexId: "v2", endVertexId: "v3" },
          { id: "e3", startVertexId: "v3", endVertexId: "v4" },
          { id: "e4", startVertexId: "v4", endVertexId: "v1" },
        ],
      },
    },
    isLoading: false,
    isError: false,
  }),
}));

import { ProjectDeckSection } from "@/components/ops/projects/workspace/viewing/project-deck-section";
import type { OpportunityDeckDesign } from "@/lib/api/services/deck-design-service";

function makeDesign(
  overrides: Partial<OpportunityDeckDesign> = {},
): OpportunityDeckDesign {
  return {
    id: "deck-1",
    title: "Back deck — cedar",
    thumbnailUrl: null,
    version: 2,
    projectId: "proj-1",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-13T12:00:00.000Z"),
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
    ...overrides,
  };
}

beforeEach(() => {
  useProjectDeckDesignsMock.mockReset();
});

describe("ProjectDeckSection", () => {
  it("renders nothing for a project with no deck design", () => {
    useProjectDeckDesignsMock.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(<ProjectDeckSection projectId="proj-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the read is still in flight", () => {
    useProjectDeckDesignsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { container } = render(<ProjectDeckSection projectId="proj-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the project's deck with its version stamp", () => {
    useProjectDeckDesignsMock.mockReturnValue({
      data: [makeDesign()],
      isLoading: false,
    });
    render(<ProjectDeckSection projectId="proj-1" />);
    expect(screen.getByTestId("project-deck-design")).toBeInTheDocument();
    expect(screen.getByText("Back deck — cedar")).toBeInTheDocument();
    expect(screen.getByText(/V2\s*·\s*Jul 13/)).toBeInTheDocument();
  });

  it("lists every deck attached to the job", () => {
    useProjectDeckDesignsMock.mockReturnValue({
      data: [
        makeDesign(),
        makeDesign({ id: "deck-2", title: "Front porch", version: 1 }),
      ],
      isLoading: false,
    });
    render(<ProjectDeckSection projectId="proj-1" />);
    expect(screen.getByText("Back deck — cedar")).toBeInTheDocument();
    expect(screen.getByText("Front porch")).toBeInTheDocument();
  });

  it("opens the same fullscreen viewer the lead uses, and closes again", () => {
    useProjectDeckDesignsMock.mockReturnValue({
      data: [makeDesign()],
      isLoading: false,
    });
    render(<ProjectDeckSection projectId="proj-1" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /View deck design — Back deck — cedar/,
      }),
    );
    expect(screen.getByTestId("deck-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("deck-plan-svg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("deck-viewer")).not.toBeInTheDocument();
  });

  it("asks only for this project's decks", () => {
    useProjectDeckDesignsMock.mockReturnValue({ data: [], isLoading: false });
    render(<ProjectDeckSection projectId="proj-42" />);
    expect(useProjectDeckDesignsMock).toHaveBeenCalledWith("proj-42");
  });
});
