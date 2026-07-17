import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { type Opportunity, OpportunityStage } from "@/lib/types/pipeline";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";
import { PipelineDetailActionMenu } from "@/app/(dashboard)/pipeline/_components/pipeline-detail-panel";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      ({
        "detail.stageActions": "Stage actions",
        "detail.advance": "Advance",
        "detail.won": "Won",
        "detail.lost": "Lost",
        "actions.discard": "Discard",
        "actions.archive": "Archive",
        "actions.delete": "Delete",
        "detail.deleteTitle": "DELETE LEAD",
        "detail.deleteBody":
          "This removes {name} from the pipeline. DESTRUCTIVE. NO UNDO.",
        "detail.deleteConfirm": "DELETE",
        "detail.deleteCancel": "KEEP",
        "detail.deleteName": "this lead",
      })[key] ??
      fallback ??
      key,
  }),
}));

const FULL_ACCESS: LeadAccess = {
  canView: true,
  canEdit: true,
  canAssign: true,
  canUnassign: true,
  canConvert: true,
};

function makeOpportunity(): Opportunity {
  return {
    id: "opp-9",
    title: "Cedar deck rebuild",
    stage: OpportunityStage.Quoted,
    contactName: "Jordan Lee",
  } as Opportunity;
}

function renderMenu(onDelete = vi.fn()) {
  render(
    <PipelineDetailActionMenu
      opportunity={makeOpportunity()}
      leadAccess={FULL_ACCESS}
      onAdvanceStage={vi.fn()}
      onMarkWon={vi.fn()}
      onMarkLost={vi.fn()}
      onArchive={vi.fn()}
      onDiscard={vi.fn()}
      onDelete={onDelete}
    />
  );
  return { onDelete };
}

describe("PipelineDetailActionMenu — delete guard", () => {
  it("interposes a destructive confirm before deleting", () => {
    const { onDelete } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Stage actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // The menu's Delete only opens the confirm — nothing is deleted yet.
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("DELETE LEAD")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This removes Cedar deck rebuild from the pipeline. DESTRUCTIVE. NO UNDO."
      )
    ).toBeInTheDocument();
  });

  it("deletes only after the DELETE confirmation", () => {
    const { onDelete } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Stage actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));

    expect(onDelete).toHaveBeenCalledWith("opp-9");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the lead when the confirm is dismissed", () => {
    const { onDelete } = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Stage actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "KEEP" }));

    expect(onDelete).not.toHaveBeenCalled();
  });
});
