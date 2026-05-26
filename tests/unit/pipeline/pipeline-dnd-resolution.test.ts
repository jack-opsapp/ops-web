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

  it("cancels spatial drops on empty canvas", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "spatial",
        draggedId: "opp-1",
        selectedCardIds: new Set(["opp-1", "opp-2"]),
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

  it("resolves selected spatial batch drops against the stage target", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "spatial",
        draggedId: "opp-1",
        selectedCardIds: new Set(["opp-1", "opp-2"]),
        dropData: {
          stage: OpportunityStage.Won,
          isTerminal: true,
        },
      })
    ).toEqual({
      type: "spatial-stage",
      opportunityIds: ["opp-1", "opp-2"],
      stage: OpportunityStage.Won,
      isTerminal: true,
    });
  });

  it("resolves single-card spatial drops when the dragged card is not selected", () => {
    expect(
      resolvePipelineDragEnd({
        mode: "spatial",
        draggedId: "opp-3",
        selectedCardIds: new Set(["opp-1", "opp-2"]),
        dropData: {
          stage: OpportunityStage.Quoted,
        },
      })
    ).toEqual({
      type: "spatial-stage",
      opportunityIds: ["opp-3"],
      stage: OpportunityStage.Quoted,
      isTerminal: false,
    });
  });
});
