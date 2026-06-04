import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunityStage } from "@/lib/types/pipeline";

// `CellStageAction` Phase 3.3 — a won, UNCONVERTED row gets a `// CONVERT`
// option in the stage menu that opens the Won dialog (the table can't re-select
// the same stage, so convert needs its own entry). Converted/active rows don't.

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    dict: {},
  }),
}));

const { CellStageAction } = await import(
  "@/app/(dashboard)/pipeline/_components/table/cells/cell-stage-action"
);

describe("<CellStageAction> — convert an already-won row", () => {
  it("shows a CONVERT entry for a won+unconverted row and calls onConvert", async () => {
    const onConvert = vi.fn();
    const onSelectStage = vi.fn();
    render(
      <CellStageAction
        stage={OpportunityStage.Won}
        canManage
        wonUnconverted
        onConvert={onConvert}
        onSelectStage={onSelectStage}
      />,
    );

    await userEvent.click(screen.getByTestId("cell-stage-trigger"));
    const convert = screen.getByTestId("cell-stage-convert");
    await userEvent.click(convert);

    expect(onConvert).toHaveBeenCalledTimes(1);
    expect(onSelectStage).not.toHaveBeenCalled();
  });

  it("omits the CONVERT entry when the won row is already converted", async () => {
    render(
      <CellStageAction
        stage={OpportunityStage.Won}
        canManage
        wonUnconverted={false}
        onConvert={vi.fn()}
        onSelectStage={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("cell-stage-trigger"));
    expect(screen.queryByTestId("cell-stage-convert")).not.toBeInTheDocument();
  });

  it("omits the CONVERT entry for an active stage", async () => {
    render(
      <CellStageAction
        stage={OpportunityStage.Negotiation}
        canManage
        wonUnconverted={false}
        onConvert={vi.fn()}
        onSelectStage={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("cell-stage-trigger"));
    expect(screen.queryByTestId("cell-stage-convert")).not.toBeInTheDocument();
  });

  it("renders a read-only chip without manage permission", () => {
    render(
      <CellStageAction
        stage={OpportunityStage.Won}
        canManage={false}
        wonUnconverted
        onConvert={vi.fn()}
        onSelectStage={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("cell-stage-trigger")).not.toBeInTheDocument();
  });
});
