import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types/pipeline";

const { useProductConfigurationMock } = vi.hoisted(() => ({
  useProductConfigurationMock: vi.fn(),
}));

vi.mock("@/lib/hooks/use-product-configuration", () => ({
  useProductConfiguration: useProductConfigurationMock,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : _key,
  }),
}));

import { ProductConfigurationFields } from "../product-configuration-fields";

const product: Product = {
  id: "vinyl-68",
  companyId: "canpro",
  name: "Vinyl membrane installation",
  description: null,
  defaultPrice: 11.73,
  unitCost: 2,
  unit: "sqft",
  unitId: "sqft-unit",
  category: "Vinyl",
  type: "LABOR",
  taskTypeId: null,
  taskTypeRef: "a53dd13d-dc0c-4df0-88d6-118404b161ce",
  isTaxable: true,
  isActive: true,
  pricingUnit: "sqft",
  minimumCharge: 1500,
  showInStorefront: true,
  createdAt: null,
  updatedAt: null,
  deletedAt: null,
};

beforeEach(() => {
  useProductConfigurationMock.mockReturnValue({
    data: {
      options: [
        {
          id: "color",
          name: "Color",
          kind: "select",
          required: true,
          defaultValue: null,
          sortOrder: 0,
        },
      ],
      values: [
        {
          id: "cobblestone",
          optionId: "color",
          value: "Cobblestone",
          sortOrder: 0,
        },
        {
          id: "dove-grey",
          optionId: "color",
          value: "Dove Grey",
          sortOrder: 1,
        },
      ],
      modifiers: [],
    },
    isLoading: false,
    isError: false,
  });
});

describe("ProductConfigurationFields", () => {
  it("asks for Color and resolves the signed selection", async () => {
    const onResolved = vi.fn();
    render(
      <ProductConfigurationFields
        product={product}
        configuredOptions={{}}
        quantity={100}
        discountPercent={0}
        onResolved={onResolved}
      />,
    );

    expect(screen.getByLabelText("Color")).toBeInTheDocument();
    expect(screen.queryByText(/thickness/i)).toBeNull();

    await userEvent.selectOptions(
      screen.getByLabelText("Color"),
      "dove-grey",
    );

    const resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.configuredOptions).toEqual({ color: "dove-grey" });
    expect(resolved.resolvedOptionsLabel).toBe("Color: Dove Grey");
    expect(resolved.unitPrice).toBe(11.73);
    expect(resolved.lineTotalBeforeTax).toBe(1500);
    expect(resolved.missingRequiredOptions).toEqual([]);
  });

  it("reports a required color until one is selected", () => {
    const onResolved = vi.fn();
    render(
      <ProductConfigurationFields
        product={product}
        configuredOptions={{}}
        quantity={100}
        discountPercent={0}
        onResolved={onResolved}
      />,
    );

    const resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.missingRequiredOptions).toEqual(["color"]);
  });
});
