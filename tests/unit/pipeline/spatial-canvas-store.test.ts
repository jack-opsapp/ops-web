import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  useSpatialCanvasStore,
} from "@/app/(dashboard)/pipeline/_components/spatial-canvas-store";
import { OpportunityStage } from "@/lib/types/pipeline";

describe("spatial-canvas-store", () => {
  beforeEach(() => {
    useSpatialCanvasStore.setState({
      viewportX: 0,
      viewportY: 0,
      zoom: DEFAULT_ZOOM,
      canvasWidth: 1600,
      canvasHeight: 900,
      selectedCardIds: new Set(),
      expandedCardIds: new Set(),
      hoveredCardId: null,
      isDragging: false,
      dragCardIds: [],
      dragOrigin: null,
      isMarqueeActive: false,
      marqueeStart: null,
      marqueeEnd: null,
      contextMenu: null,
      isArchiveTrayOpen: false,
      isDiscardTrayOpen: false,
    });
  });

  it("does not expose custom card placement state", () => {
    const state = useSpatialCanvasStore.getState();

    expect("customPositions" in state).toBe(false);
    expect("setCustomPosition" in state).toBe(false);
    expect("clearCustomPositions" in state).toBe(false);
  });

  it("resetLayout resets spatial interaction state without custom positions", () => {
    useSpatialCanvasStore.setState({
      viewportX: 240,
      viewportY: -120,
      zoom: 1.2,
      selectedCardIds: new Set(["opp-1"]),
      hoveredCardId: "opp-1",
      isDragging: true,
      dragCardIds: ["opp-1"],
      dragOrigin: { x: 10, y: 20 },
      isMarqueeActive: true,
      marqueeStart: { x: 0, y: 0 },
      marqueeEnd: { x: 200, y: 200 },
      contextMenu: {
        visible: true,
        x: 100,
        y: 100,
        type: "canvas",
        targetCardId: null,
        stage: OpportunityStage.Quoted,
      },
      isArchiveTrayOpen: true,
      isDiscardTrayOpen: true,
    });
    useSpatialCanvasStore.getState().toggleCardExpanded("opp-1");

    useSpatialCanvasStore.getState().resetLayout();

    const state = useSpatialCanvasStore.getState();
    expect("customPositions" in state).toBe(false);
    expect(state.viewportX).toBe(0);
    expect(state.viewportY).toBe(0);
    expect(state.zoom).toBe(DEFAULT_ZOOM);
    expect(state.selectedCardIds.size).toBe(0);
    expect(state.hoveredCardId).toBeNull();
    expect(state.isDragging).toBe(false);
    expect(state.dragCardIds).toEqual([]);
    expect(state.dragOrigin).toBeNull();
    expect(state.isMarqueeActive).toBe(false);
    expect(state.marqueeStart).toBeNull();
    expect(state.marqueeEnd).toBeNull();
    expect(state.contextMenu).toBeNull();
    expect(state.isArchiveTrayOpen).toBe(false);
    expect(state.isDiscardTrayOpen).toBe(false);
    expect(state.expandedCardIds.has("opp-1")).toBe(true);
  });
});
