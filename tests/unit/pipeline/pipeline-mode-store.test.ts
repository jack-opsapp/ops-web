import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { OpportunityStage } from "@/lib/types/pipeline";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";

describe("pipeline-mode-store", () => {
  beforeEach(() => {
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("defaults are correct", () => {
    const state = usePipelineModeStore.getState();

    expect(state.mode).toBe("focused");
    expect(state.focusedStage).toBe(OpportunityStage.NewLead);
    expect(state.sortBy).toBe("value");
    expect(state.detailPanelOpportunityId).toBeNull();
    expect(state.detailPanelActiveTab).toBe("correspondence");
  });

  it("toggleMode flips focused and spatial", () => {
    act(() => usePipelineModeStore.getState().toggleMode());
    expect(usePipelineModeStore.getState().mode).toBe("spatial");

    act(() => usePipelineModeStore.getState().toggleMode());
    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("setStageSortBy stores per-stage override", () => {
    act(() =>
      usePipelineModeStore
        .getState()
        .setStageSortBy(OpportunityStage.Quoted, "date")
    );

    expect(
      usePipelineModeStore
        .getState()
        .stageSortOverrides.get(OpportunityStage.Quoted)
    ).toBe("date");
  });

  it("resetLayout clears overrides and resets sortBy", () => {
    act(() => {
      usePipelineModeStore.getState().setSortBy("name");
      usePipelineModeStore
        .getState()
        .setStageSortBy(OpportunityStage.Quoted, "date");
    });

    act(() => usePipelineModeStore.getState().resetLayout());

    const state = usePipelineModeStore.getState();
    expect(state.sortBy).toBe("value");
    expect(state.stageSortOverrides.size).toBe(0);
  });

  it("openDetailPanel and closeDetailPanel update state", () => {
    act(() => usePipelineModeStore.getState().openDetailPanel("opp-1"));
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );

    act(() => usePipelineModeStore.getState().closeDetailPanel());
    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBeNull();
  });

  it("setDetailPanelActiveTab updates the active detail tab", () => {
    act(() => usePipelineModeStore.getState().setDetailPanelActiveTab("photos"));

    expect(usePipelineModeStore.getState().detailPanelActiveTab).toBe("photos");
  });

  it("partialize does not persist transient detail panel state", () => {
    act(() => {
      usePipelineModeStore.getState().openDetailPanel("opp-1");
      usePipelineModeStore.getState().setDetailPanelActiveTab("photos");
    });

    const raw = localStorage.getItem("opsPipeline:v3");
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.state.detailPanelOpportunityId).toBeUndefined();
    expect(parsed.state.detailPanelActiveTab).toBeUndefined();
  });
});
