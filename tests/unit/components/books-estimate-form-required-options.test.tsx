/**
 * Books → Estimates modal (`estimate-form-modal.tsx`) must refuse to save a
 * product line whose required options are still unanswered.
 *
 * Why this matters beyond the form: `line_items.configured_options` is the only
 * input the recipe engine has for count-scaled recipe lines (one end post per
 * "Left ends"). A line saved with no option snapshot books zero of every scaled
 * material and raises `scaled_option_value_missing` on acceptance. The pipeline
 * create-estimate surface already blocked this; Books did not.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    dict: {},
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useDefaultTaxRate: () => ({ data: { id: "tax-1", rate: 0 } }),
}));

const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { error: (message: string) => toastError(message) },
}));

// The real editor resolves product options over the network. Stub it with a
// button that hands back one product line with an unanswered required option —
// exactly what the editor emits while a required Color/Height is unset.
vi.mock("@/components/ops/line-item-editor", () => ({
  LineItemEditor: ({
    items,
    onChange,
  }: {
    items: Array<Record<string, unknown>>;
    onChange: (items: Array<Record<string, unknown>>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            ...items[0],
            name: "Picket Rail — Level",
            productId: "prod-rail",
            quantity: 20,
            unitPrice: 70,
            type: "LABOR",
            isTaxable: false,
            isOptional: false,
            isSelected: true,
            discountPercent: 0,
            configuredOptions: {},
            missingRequiredOptions: ["opt-color"],
          },
        ])
      }
    >
      stub: add unanswered line
    </button>
  ),
  createEmptyLineItem: () => ({
    id: "li-1",
    name: "",
    quantity: 1,
    unitPrice: 0,
    isTaxable: false,
    discountPercent: 0,
    productId: null,
    unit: "each",
    isOptional: false,
    isSelected: true,
    type: "OTHER",
    taskTypeId: null,
    taskTypeRef: null,
    unitId: null,
    resolvedUnitPrice: null,
    minimumChargeSnapshot: null,
    unitCost: null,
    estimatedHours: null,
    configuredOptions: {},
    resolvedOptionsLabel: null,
    missingRequiredOptions: [],
    category: null,
    taxRateId: null,
  }),
  createLineItemRowFromLineItem: (lineItem: Record<string, unknown>) => lineItem,
}));

import { EstimateFormModal } from "@/components/books/modals/estimate-form-modal";

const baseProps = {
  open: true,
  onClose: () => {},
  estimate: null,
  clients: [{ id: "client-1", name: "Test Client" }],
  projects: [],
  products: [],
  companyId: "co-1",
};

describe("Books estimate modal — required product options", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("refuses to create an estimate while a line has unanswered required options", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <EstimateFormModal {...baseProps} onCreate={onCreate} onUpdate={vi.fn()} />,
    );

    await user.click(screen.getByText("stub: add unanswered line"));
    await user.click(
      screen.getByRole("button", { name: /create|save/i }),
    );

    expect(onCreate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Complete the required product options.",
    );
  });
});
