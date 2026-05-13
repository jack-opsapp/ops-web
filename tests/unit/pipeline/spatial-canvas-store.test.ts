import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  useSpatialCanvasStore,
} from "@/app/(dashboard)/pipeline/_components/spatial-canvas-store";

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

  it("resetLayout preserves canonical layout-only state", () => {
    useSpatialCanvasStore.getState().selectCards(["opp-1"]);
    useSpatialCanvasStore.getState().toggleCardExpanded("opp-1");

    useSpatialCanvasStore.getState().resetLayout();

    const state = useSpatialCanvasStore.getState();
    expect("customPositions" in state).toBe(false);
    expect(state.selectedCardIds.has("opp-1")).toBe(true);
    expect(state.expandedCardIds.has("opp-1")).toBe(true);
  });
});
