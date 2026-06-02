import { describe, expect, it } from "vitest";
import { OpportunityStage } from "@/lib/types/pipeline";
import { resolvePipelineDragEnd } from "@/app/(dashboard)/pipeline/_components/pipeline-dnd-resolution";

describe("resolvePipelineDragEnd", () => {
  it("cancels focused drops outside a focused stage target", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "focused",
        draggedId: "opp-1",
        selectedCardIds: new Set(["opp-1"]),
        dropData: null,
      })
    ).toEqual({ type: "cancel" });
  });

  it("resolves focused stage drops only when the focused target owns the drop", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "focused",
        draggedId: "opp-1",
        selectedCardIds: new Set(),
        dropData: {
          mode: "focused",
          stage: OpportunityStage.FollowUp,
          focusedDropIntent: "stage-target",
        },
      })
    ).toEqual({
      type: "focused-stage",
      opportunityId: "opp-1",
      stage: OpportunityStage.FollowUp,
      isTerminal: false,
    });
  });

  it("resolves focused archive and discard action drops", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "focused",
        draggedId: "opp-1",
        selectedCardIds: new Set(),
        dropData: {
          mode: "focused",
          focusedDropIntent: "archive-target",
        },
      })
    ).toEqual({
      type: "focused-action",
      opportunityId: "opp-1",
      action: "archive",
    });

    expect(
      resolvePipelineDragEnd({
        mode: "focused",
        draggedId: "opp-2",
        selectedCardIds: new Set(),
        dropData: {
          mode: "focused",
          focusedDropIntent: "discard-target",
        },
      })
    ).toEqual({
      type: "focused-action",
      opportunityId: "opp-2",
      action: "discard",
    });
  });

  it("cancels focused stage-looking drops without explicit drop intent", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "focused",
        draggedId: "opp-1",
        selectedCardIds: new Set(),
        dropData: {
          mode: "focused",
          stage: OpportunityStage.FollowUp,
        },
      })
    ).toEqual({ type: "cancel" });
  });
});
