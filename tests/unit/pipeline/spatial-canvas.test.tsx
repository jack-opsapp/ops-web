import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialCanvas } from "@/app/(dashboard)/pipeline/_components/spatial-canvas";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { useSpatialCanvasStore } from "@/app/(dashboard)/pipeline/_components/spatial-canvas-store";
import { OpportunityStage } from "@/lib/types/pipeline";

const mockDndState = vi.hoisted(() => ({ isDragging: false }));

vi.mock(
  "@/app/(dashboard)/pipeline/_components/pipeline-dnd-provider",
  () => ({
    usePipelineDndState: () => ({ isDragging: mockDndState.isDragging }),
  })
);

function renderSpatialCanvas() {
  return render(
    <SpatialCanvas canvasWidth={1200} canvasHeight={800}>
      <div>canvas content</div>
    </SpatialCanvas>
  );
}

describe("<SpatialCanvas>", () => {
  beforeEach(() => {
    localStorage.clear();
    mockDndState.isDragging = false;
    usePipelineModeStore.setState({
      mode: "spatial",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
    useSpatialCanvasStore.setState({
      viewportX: 0,
      viewportY: 0,
      zoom: 0.95,
      canvasWidth: 1200,
      canvasHeight: 800,
    });
  });

  it("switches back to focused mode when pinch-in crosses zoom 1.0", () => {
    renderSpatialCanvas();

    fireEvent.wheel(screen.getByText("canvas content").parentElement!, {
      ctrlKey: true,
      deltaY: -20,
      clientX: 100,
      clientY: 100,
    });

    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("keeps spatial mode during pinch-in while dragging", () => {
    mockDndState.isDragging = true;
    renderSpatialCanvas();

    fireEvent.wheel(screen.getByText("canvas content").parentElement!, {
      ctrlKey: true,
      deltaY: -20,
      clientX: 100,
      clientY: 100,
    });

    expect(usePipelineModeStore.getState().mode).toBe("spatial");
  });
});
