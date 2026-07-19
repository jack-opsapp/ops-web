import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpportunityStage } from "@/lib/types/pipeline";
import {
  PIPELINE_MODE_WILL_CHANGE_EVENT,
  usePipelineModeStore,
} from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";

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
      assignIntentOpportunityId: null,
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

  it("toggleMode flips focused and table", () => {
    act(() => usePipelineModeStore.getState().toggleMode());
    expect(usePipelineModeStore.getState().mode).toBe("table");

    act(() => usePipelineModeStore.getState().toggleMode());
    expect(usePipelineModeStore.getState().mode).toBe("focused");
  });

  it("dispatches the mode-change event before state updates", () => {
    const listener = vi.fn((event: Event) => {
      expect(usePipelineModeStore.getState().mode).toBe("focused");
      expect((event as CustomEvent).detail).toEqual({
        from: "focused",
        to: "table",
      });
    });
    window.addEventListener(PIPELINE_MODE_WILL_CHANGE_EVENT, listener);

    act(() => usePipelineModeStore.getState().setMode("table"));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(PIPELINE_MODE_WILL_CHANGE_EVENT, listener);
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

    const raw = localStorage.getItem("opsPipeline:v4");
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.state.detailPanelOpportunityId).toBeUndefined();
    expect(parsed.state.detailPanelActiveTab).toBeUndefined();
  });

  describe("assign intent one-shot", () => {
    it("defaults to null", () => {
      expect(
        usePipelineModeStore.getState().assignIntentOpportunityId
      ).toBeNull();
    });

    it("arms only when opened with the assignIntent option", () => {
      act(() =>
        usePipelineModeStore
          .getState()
          .openDetailPanel("opp-1", { assignIntent: true })
      );
      const state = usePipelineModeStore.getState();
      expect(state.detailPanelOpportunityId).toBe("opp-1");
      expect(state.assignIntentOpportunityId).toBe("opp-1");
    });

    it("a plain open clears any stale intent", () => {
      act(() =>
        usePipelineModeStore
          .getState()
          .openDetailPanel("opp-1", { assignIntent: true })
      );
      act(() => usePipelineModeStore.getState().openDetailPanel("opp-2"));
      const state = usePipelineModeStore.getState();
      expect(state.detailPanelOpportunityId).toBe("opp-2");
      expect(state.assignIntentOpportunityId).toBeNull();
    });

    it("consumeAssignIntent clears the flag", () => {
      act(() =>
        usePipelineModeStore
          .getState()
          .openDetailPanel("opp-1", { assignIntent: true })
      );
      act(() => usePipelineModeStore.getState().consumeAssignIntent());
      expect(
        usePipelineModeStore.getState().assignIntentOpportunityId
      ).toBeNull();
    });

    it("closeDetailPanel clears the intent", () => {
      act(() =>
        usePipelineModeStore
          .getState()
          .openDetailPanel("opp-1", { assignIntent: true })
      );
      act(() => usePipelineModeStore.getState().closeDetailPanel());
      expect(
        usePipelineModeStore.getState().assignIntentOpportunityId
      ).toBeNull();
    });

    it("does not persist the transient assign-intent flag", () => {
      act(() =>
        usePipelineModeStore
          .getState()
          .openDetailPanel("opp-1", { assignIntent: true })
      );
      const parsed = JSON.parse(localStorage.getItem("opsPipeline:v4")!);
      expect(parsed.state.assignIntentOpportunityId).toBeUndefined();
    });
  });
});
