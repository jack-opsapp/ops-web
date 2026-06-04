import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunityStage } from "@/lib/types/pipeline";

// `PipelineCardActions` Phase 3.3 — a won card whose deal was never converted
// (estimate-approval win) gets a `// Convert` entry in the more-menu that opens
// the Won dialog. The parent only passes `onConvert` for won+unconverted cards.

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
}));

const { PipelineCardActions } = await import(
  "@/app/(dashboard)/pipeline/_components/pipeline-card-actions"
);

const noop = () => {};
const baseProps = {
  opportunityId: "opp-1",
  canManage: true,
  onLogCall: noop,
  onLogText: noop,
  onAddNote: noop,
  onArchive: noop,
  onMarkWon: noop,
  onMarkLost: noop,
  onDiscard: noop,
  onAssign: noop,
  onScheduleFollowUp: noop,
  onOpenDetail: noop,
};

describe("<PipelineCardActions> — convert an already-won card", () => {
  it("shows a Convert entry on a won card with onConvert and calls it", async () => {
    const onConvert = vi.fn();
    render(
      <PipelineCardActions
        {...baseProps}
        stage={OpportunityStage.Won}
        onConvert={onConvert}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByTestId("card-action-convert"));
    expect(onConvert).toHaveBeenCalledTimes(1);
  });

  it("omits Convert when no onConvert is provided (already converted)", async () => {
    render(
      <PipelineCardActions {...baseProps} stage={OpportunityStage.Won} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByTestId("card-action-convert")).not.toBeInTheDocument();
  });

  it("omits Convert on an active stage even if onConvert is passed", async () => {
    render(
      <PipelineCardActions
        {...baseProps}
        stage={OpportunityStage.Negotiation}
        onConvert={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByTestId("card-action-convert")).not.toBeInTheDocument();
  });
});
