import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { useWidgetEntityOpen } from "@/components/dashboard/widgets/shared/use-widget-entity-open";
import { OpportunityStage } from "@/lib/types/pipeline";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMocks.push,
  }),
}));

describe("useWidgetEntityOpen", () => {
  beforeEach(() => {
    navigationMocks.push.mockClear();
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

  it("opens opportunity detail state and routes to /pipeline even when a stale entity URL is supplied", () => {
    const { result } = renderHook(() => useWidgetEntityOpen());

    act(() => {
      result.current({
        entityType: "opportunity",
        entityId: "opp-1",
        title: "Deck rebuild",
        fallbackPath: "/pipeline/opp-1",
      });
    });

    expect(usePipelineModeStore.getState().detailPanelOpportunityId).toBe(
      "opp-1"
    );
    expect(navigationMocks.push).toHaveBeenCalledWith("/pipeline");
  });
});
