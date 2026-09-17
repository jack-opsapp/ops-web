/**
 * An integer count option has no default. A count is the job's geometry (end
 * posts, corners): the estimate editors never fill one from the catalogue and
 * acceptance refuses a blank one, so the option form must not offer a default
 * that nothing honours — and saving a count option clears any default it still
 * carries. Select and boolean options keep theirs.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductOption } from "@/lib/types/product-options";

const { createMutate, updateMutate } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useCreateProductOption: () => ({ mutate: createMutate, isPending: false }),
  useUpdateProductOption: () => ({ mutate: updateMutate, isPending: false }),
  useCreateProductOptionValue: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProductOptionValue: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProductOptionValue: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderProductOptionValues: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProductOptionFormDialog } from "../product-option-form-dialog";

function option(overrides: Partial<ProductOption>): ProductOption {
  return {
    id: "opt-left",
    productId: "canpro-railing",
    name: "Left ends",
    kind: "integer",
    affectsPrice: false,
    affectsRecipe: true,
    required: true,
    defaultValue: "1",
    optionDefaultSource: null,
    sortOrder: 50,
    ...overrides,
  };
}

function renderDialog(props: {
  mode: "create" | "edit";
  option?: ProductOption;
}) {
  return render(
    <ProductOptionFormDialog
      open
      mode={props.mode}
      productId="canpro-railing"
      option={props.option}
      allOptions={props.option ? [props.option] : []}
      allValues={[]}
      onClose={vi.fn()}
    />
  );
}

beforeEach(() => {
  createMutate.mockClear();
  updateMutate.mockClear();
});

describe("ProductOptionFormDialog — count defaults", () => {
  it("offers no default for an integer count and clears a stored one on save", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "edit", option: option({}) });

    expect(screen.queryByText("DEFAULT VALUE")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      id: "opt-left",
      data: { kind: "integer", defaultValue: null },
    });
  });

  it("drops a default typed for another kind when the new option becomes a count", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    await user.type(screen.getByPlaceholderText(/e\.g\. Color/), "Corners");
    await user.click(screen.getByRole("button", { name: "BOOLEAN" }));
    await user.selectOptions(screen.getByDisplayValue("— none —"), "true");
    await user.click(screen.getByRole("button", { name: "INTEGER" }));

    expect(screen.queryByText("DEFAULT VALUE")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      name: "Corners",
      kind: "integer",
      defaultValue: null,
    });
  });

  it("keeps the default for select and boolean options", async () => {
    const user = userEvent.setup();
    renderDialog({
      mode: "edit",
      option: option({
        kind: "boolean",
        name: "Post lights",
        defaultValue: "true",
      }),
    });

    expect(screen.getByText("DEFAULT VALUE")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      data: { kind: "boolean", defaultValue: "true" },
    });
  });
});
