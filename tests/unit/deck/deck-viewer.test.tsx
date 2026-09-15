/**
 * The fullscreen deck viewer.
 *
 * What is under test is the OPERATOR'S EXPERIENCE, not the pixels: the drawing
 * owns the screen, the rail turns things on and off, measuring reports a real
 * number, and Escape always gets you out. The geometry, placement, viewport and
 * measure maths are proven in their own suites — here we only prove the viewer
 * wires them to controls a human can actually reach.
 */

import * as React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

/**
 * jsdom ships no `PointerEvent`, so testing-library falls back to a bare
 * `Event` and every `clientX` arrives null — which would let a broken drag
 * pass. This is the minimum real thing: a MouseEvent that carries pointer
 * identity, so coordinates reach the component exactly as a browser sends
 * them. Kept local to this suite rather than in the shared setup.
 */
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).PointerEvent = TestPointerEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = TestPointerEvent;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

const mockUseDeckDesignDrawing = vi.fn();
vi.mock("@/lib/hooks/use-deck-design-drawing", () => ({
  useDeckDesignDrawing: (id: string | undefined) => mockUseDeckDesignDrawing(id),
}));

import { DeckViewer } from "@/components/ops/deck/deck-viewer";

/** A 12ft × 10ft deck: one closed surface, one dimensioned house edge. */
const SINGLE_LEVEL = {
  scaleFactor: 2,
  vertices: [
    { id: "v1", position: [0, 0] },
    { id: "v2", position: [288, 0] },
    { id: "v3", position: [288, 240] },
    { id: "v4", position: [0, 240] },
  ],
  edges: [
    {
      id: "e1",
      startVertexId: "v1",
      endVertexId: "v2",
      edgeType: "house_edge",
      dimension: 144,
    },
    { id: "e2", startVertexId: "v2", endVertexId: "v3", dimension: 120 },
    { id: "e3", startVertexId: "v3", endVertexId: "v4" },
    { id: "e4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

/** Two levels, so the LEVELS control has something to cycle through. */
const TWO_LEVEL = {
  scaleFactor: 2,
  levels: [
    {
      id: "L1",
      name: "Main",
      sortOrder: 0,
      displayColor: "blue",
      ...SINGLE_LEVEL,
    },
    {
      id: "L2",
      name: "Upper",
      sortOrder: 1,
      displayColor: "green",
      scaleFactor: 2,
      vertices: [
        { id: "w1", position: [320, 0] },
        { id: "w2", position: [480, 0] },
        { id: "w3", position: [480, 160] },
        { id: "w4", position: [320, 160] },
      ],
      edges: [
        { id: "f1", startVertexId: "w1", endVertexId: "w2" },
        { id: "f2", startVertexId: "w2", endVertexId: "w3" },
        { id: "f3", startVertexId: "w3", endVertexId: "w4" },
        { id: "f4", startVertexId: "w4", endVertexId: "w1" },
      ],
    },
  ],
};

function mockDrawing(drawingData: unknown, extra: Record<string, unknown> = {}) {
  mockUseDeckDesignDrawing.mockReturnValue({
    data: {
      id: "d1",
      title: "Back deck",
      thumbnailUrl: null,
      version: 3,
      projectId: null,
      createdAt: new Date("2026-07-13T00:00:00Z"),
      updatedAt: new Date("2026-07-13T00:00:00Z"),
      drawingData,
    },
    isLoading: false,
    isError: false,
    ...extra,
  });
}

function open(props: Partial<React.ComponentProps<typeof DeckViewer>> = {}) {
  const onClose = vi.fn();
  render(
    <DeckViewer
      designId="d1"
      title="Back deck"
      version={3}
      stamp={new Date("2026-07-13T12:00:00Z")}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  mockUseDeckDesignDrawing.mockReset();
  mockDrawing(SINGLE_LEVEL);
});

describe("DeckViewer — the drawing owns the screen", () => {
  it("opens fullscreen with the design's name and version stamp", () => {
    open();
    const viewer = screen.getByTestId("deck-viewer");
    expect(viewer).toBeInTheDocument();
    expect(within(viewer).getByText("Back deck")).toBeInTheDocument();
    // The stamp reads the way iOS stamps it: version, then the day it moved.
    expect(within(viewer).getByTestId("deck-viewer-stamp")).toHaveTextContent(
      /V3\s*·\s*Jul 13/,
    );
  });

  it("draws the live geometry — surface, edges and vertices", () => {
    open();
    expect(screen.getByTestId("deck-plan-svg")).toBeInTheDocument();
    expect(screen.getAllByTestId("deck-surface")).toHaveLength(1);
    expect(screen.getAllByTestId("deck-edge")).toHaveLength(4);
    expect(screen.getAllByTestId("deck-vertex")).toHaveLength(4);
  });

  it("marks the house edge so it is drawn as a wall, not a rail", () => {
    open();
    const house = screen
      .getAllByTestId("deck-edge")
      .filter((edge) => edge.getAttribute("data-edge-role") === "house");
    expect(house).toHaveLength(1);
  });

  it("labels dimensioned edges with real feet and inches", () => {
    open();
    const dimensions = screen.getAllByTestId("deck-dimension");
    expect(dimensions).toHaveLength(2);
    expect(screen.getByText("12'")).toBeInTheDocument();
    expect(screen.getByText("10'")).toBeInTheDocument();
  });
});

describe("DeckViewer — the tool rail", () => {
  it("hides every label when LABELS is switched off, and brings them back", () => {
    open();
    const labels = screen.getByRole("button", { name: /labels/i });
    expect(labels).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(labels);
    expect(labels).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryAllByTestId("deck-dimension")).toHaveLength(0);
    expect(screen.queryAllByTestId("deck-surface-label")).toHaveLength(0);
    // The drawing itself never disappears with its labels.
    expect(screen.getAllByTestId("deck-edge")).toHaveLength(4);

    fireEvent.click(labels);
    expect(screen.getAllByTestId("deck-dimension")).toHaveLength(2);
  });

  it("offers no LEVELS control for a single-level deck", () => {
    open();
    expect(screen.queryByRole("button", { name: /level/i })).toBeNull();
  });

  it("cycles level isolation and comes back to all levels", () => {
    mockDrawing(TWO_LEVEL);
    open();
    const groups = () => screen.getAllByTestId("deck-level-group");
    expect(groups()).toHaveLength(2);
    expect(groups().every((g) => g.dataset.dimmed === "false")).toBe(true);

    const levels = screen.getByRole("button", { name: /level/i });
    fireEvent.click(levels);
    expect(groups().map((g) => g.dataset.dimmed)).toEqual(["false", "true"]);

    fireEvent.click(levels);
    expect(groups().map((g) => g.dataset.dimmed)).toEqual(["true", "false"]);

    fireEvent.click(levels);
    expect(groups().every((g) => g.dataset.dimmed === "false")).toBe(true);
  });

  it("names the isolated level so the operator knows what they are looking at", () => {
    mockDrawing(TWO_LEVEL);
    open();
    fireEvent.click(screen.getByRole("button", { name: /level/i }));
    expect(screen.getByTestId("deck-viewer-levels")).toHaveTextContent("Main");
  });
});

describe("DeckViewer — measuring", () => {
  it("reports a running length once two points are placed", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /measure/i }));
    expect(screen.getByTestId("deck-measure-readout")).toBeInTheDocument();

    const surface = screen.getByTestId("deck-viewer-surface");
    // Two taps on the plan. The surface reports a 1024×768 box in jsdom, and
    // the drawing is fit into it, so taps land in canvas space via the viewport.
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerDown(surface, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 500, clientY: 300, pointerId: 1 });

    const readout = screen.getByTestId("deck-measure-readout");
    expect(readout).toHaveTextContent(/LENGTH/i);
    // Two real points, so a real dimension — never NaN and never a bare dash.
    expect(readout.textContent).toMatch(/\d/);
    expect(readout.textContent).not.toMatch(/NaN|Infinity|undefined/);
    expect(readout).toHaveTextContent(/SEGMENTS\s*1/i);
    expect(screen.getByTestId("deck-measure")).toBeInTheDocument();
  });

  it("clears the run and leaves measure mode when measure is switched off", () => {
    open();
    const measure = screen.getByRole("button", { name: /measure/i });
    fireEvent.click(measure);
    const surface = screen.getByTestId("deck-viewer-surface");
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(screen.getByTestId("deck-measure")).toBeInTheDocument();

    fireEvent.click(measure);
    expect(screen.queryByTestId("deck-measure-readout")).toBeNull();
    expect(screen.queryByTestId("deck-measure")).toBeNull();
  });

  it("does not pan the drawing while a measurement is being taken", () => {
    open();
    const surface = screen.getByTestId("deck-viewer-surface");
    const before = screen.getByTestId("deck-plan-transform").getAttribute("transform");

    fireEvent.click(screen.getByRole("button", { name: /measure/i }));
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 420, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 420, clientY: 360, pointerId: 1 });

    expect(
      screen.getByTestId("deck-plan-transform").getAttribute("transform"),
    ).toBe(before);
  });
});

describe("DeckViewer — moving the drawing", () => {
  it("pans with a drag", () => {
    open();
    const surface = screen.getByTestId("deck-viewer-surface");
    const before = screen.getByTestId("deck-plan-transform").getAttribute("transform");

    fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 260, clientY: 240, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 260, clientY: 240, pointerId: 1 });

    expect(
      screen.getByTestId("deck-plan-transform").getAttribute("transform"),
    ).not.toBe(before);
  });

  it("zooms on the wheel and fits again on double click", () => {
    open();
    const surface = screen.getByTestId("deck-viewer-surface");
    const fitted = screen.getByTestId("deck-plan-transform").getAttribute("transform");

    fireEvent.wheel(surface, { deltaY: -240, clientX: 400, clientY: 300 });
    const zoomed = screen.getByTestId("deck-plan-transform").getAttribute("transform");
    expect(zoomed).not.toBe(fitted);

    fireEvent.doubleClick(surface);
    expect(
      screen.getByTestId("deck-plan-transform").getAttribute("transform"),
    ).toBe(fitted);
  });

  it("restores the fit from the rail after the drawing has been moved", () => {
    open();
    const surface = screen.getByTestId("deck-viewer-surface");
    const fitted = screen.getByTestId("deck-plan-transform").getAttribute("transform");

    fireEvent.wheel(surface, { deltaY: -240, clientX: 400, clientY: 300 });
    fireEvent.click(screen.getByRole("button", { name: /fit/i }));

    expect(
      screen.getByTestId("deck-plan-transform").getAttribute("transform"),
    ).toBe(fitted);
  });
});

describe("DeckViewer — 2D / 3D", () => {
  it("starts in 2D and switches to the massing on demand", () => {
    open();
    const two = screen.getByRole("radio", { name: "2D" });
    const three = screen.getByRole("radio", { name: "3D" });
    expect(two).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("deck-plan-svg")).toBeInTheDocument();

    fireEvent.click(three);
    expect(three).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("deck-plan-svg")).toBeNull();
    expect(screen.getByTestId("deck-scene-3d-slot")).toBeInTheDocument();
  });
});

describe("DeckViewer — getting out and honest empty states", () => {
  it("closes on Escape", () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the rail", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says plainly when there is no drawing to show", () => {
    mockDrawing({ scaleFactor: 2, vertices: [], edges: [] });
    open();
    expect(screen.getByTestId("deck-viewer-empty")).toHaveTextContent(
      "[ no closed outline ]",
    );
    expect(screen.queryByTestId("deck-plan-svg")).toBeNull();
    // Even with nothing to draw, the way out is still there.
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("shows the drawing is still loading rather than an empty plan", () => {
    mockUseDeckDesignDrawing.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    open();
    expect(screen.getByTestId("deck-viewer-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("deck-viewer-empty")).toBeNull();
  });
});
