import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemEditor } from "@/components/catalog-setup/ItemEditor";
import { PREVIEW_CARDS_BY_STATE } from "@/lib/catalog-setup/__mocks__/preview-cards";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

// A SELL card under edit (has price + taxable + type), pulled from the preview
// seed so the editor exercises the real StagingCard shape.
const sellCard = PREVIEW_CARDS_BY_STATE.proposed as StagingCard;

function renderEditor(overrides: Partial<Parameters<typeof ItemEditor>[0]> = {}) {
  const onBack = vi.fn();
  const onDone = vi.fn();
  const onEditField = vi.fn();
  render(
    <ItemEditor
      card={sellCard}
      onBack={onBack}
      onDone={onDone}
      onEditField={onEditField}
      {...overrides}
    />,
  );
  return { onBack, onDone, onEditField };
}

describe("ItemEditor", () => {
  it("renders without crashing and shows the EDIT header + item name", () => {
    renderEditor();
    expect(screen.getByTestId("item-editor")).toBeInTheDocument();
    expect(screen.getByText("EDIT")).toBeInTheDocument();
    if (sellCard.module === "sell") {
      expect(screen.getByText(sellCard.fields.name)).toBeInTheDocument();
    }
  });

  it("renders all four hierarchy sections: IDENTITY, PRICING, RECIPE, footer", () => {
    renderEditor();
    expect(screen.getByTestId("editor-section-identity")).toBeInTheDocument();
    expect(screen.getByTestId("editor-section-pricing")).toBeInTheDocument();
    expect(screen.getByTestId("editor-section-recipe")).toBeInTheDocument();
    // footer carries the Taxable toggle + DONE button
    expect(screen.getByTestId("editor-taxable-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("editor-done")).toBeInTheDocument();
  });

  it("IDENTITY shows the unit chip and a task-type chip with an olive type dot", () => {
    renderEditor();
    const typeChip = screen.getByTestId("editor-type-chip");
    expect(typeChip).toBeInTheDocument();
    // the dot uses the olive (positive/type) token
    expect(typeChip.querySelector(".bg-olive")).not.toBeNull();
  });

  it("FLAT is the default mode — the tier ladder is hidden", () => {
    renderEditor();
    expect(screen.getByTestId("pricing-toggle-flat")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("pricing-tier-ladder")).not.toBeInTheDocument();
  });

  it("toggling BY OPTION reveals the tier ladder, BASE marker, and agent affordance", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId("pricing-toggle-byoption"));
    await waitFor(() => {
      expect(screen.getByTestId("pricing-tier-ladder")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pricing-add-tier")).toBeInTheDocument();
    expect(screen.getByTestId("pricing-agent-set")).toBeInTheDocument();
    expect(screen.getByText("BASE")).toBeInTheDocument();
  });

  it("toggling back to FLAT hides the tier ladder again", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId("pricing-toggle-byoption"));
    await waitFor(() =>
      expect(screen.getByTestId("pricing-tier-ladder")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("pricing-toggle-flat"));
    await waitFor(() =>
      expect(screen.queryByTestId("pricing-tier-ladder")).not.toBeInTheDocument(),
    );
  });

  it("RECIPE shows the draws-down-stock title, a material row, and add-material", () => {
    renderEditor();
    expect(screen.getByText(/draws down stock/i)).toBeInTheDocument();
    expect(screen.getByTestId("recipe-material-row")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-add-material")).toBeInTheDocument();
  });

  it("[ + add tier ] appends a tier row", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId("pricing-toggle-byoption"));
    await waitFor(() =>
      expect(screen.getByTestId("pricing-tier-ladder")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("pricing-tier-row")).toHaveLength(1);
    await user.click(screen.getByTestId("pricing-add-tier"));
    expect(screen.getAllByTestId("pricing-tier-row")).toHaveLength(2);
  });

  it("[ + add material ] appends a material row", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getAllByTestId("recipe-material-row")).toHaveLength(1);
    await user.click(screen.getByTestId("recipe-add-material"));
    expect(screen.getAllByTestId("recipe-material-row")).toHaveLength(2);
  });

  it("editing the name field dispatches EDIT_CARD fields via onEditField", async () => {
    const user = userEvent.setup();
    const { onEditField } = renderEditor();
    const nameInput = screen.getByLabelText("name");
    await user.type(nameInput, "X");
    expect(onEditField).toHaveBeenCalled();
    // last call carries a partial `name` field (SELL identifies by name)
    const lastCall = onEditField.mock.calls.at(-1)?.[0];
    expect(lastCall).toHaveProperty("name");
  });

  it("toggling Taxable dispatches the inverted isTaxable through onEditField", async () => {
    const user = userEvent.setup();
    const { onEditField } = renderEditor();
    await user.click(screen.getByTestId("editor-taxable-toggle"));
    expect(onEditField).toHaveBeenCalledWith(
      expect.objectContaining({ isTaxable: !(sellCard.module === "sell" && sellCard.fields.isTaxable) }),
    );
  });

  it("back + done affordances fire their handlers", async () => {
    const user = userEvent.setup();
    const { onBack, onDone } = renderEditor();
    await user.click(screen.getByTestId("editor-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("editor-done"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
