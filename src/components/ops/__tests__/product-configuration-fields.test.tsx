import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
import type {
  ConfiguredOptions,
  ResolvedProductConfiguration,
} from "@/lib/products/product-configuration-resolver";

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

const railingConfiguration = {
  options: [
    { id: "opt-color", name: "Color", kind: "select", required: true, defaultValue: "Black", sortOrder: 0 },
    { id: "opt-left", name: "Left ends", kind: "integer", required: true, defaultValue: "1", sortOrder: 1 },
    { id: "opt-lights", name: "Post lights", kind: "boolean", required: false, defaultValue: "false", sortOrder: 2 },
  ],
  values: [
    { id: "val-black", optionId: "opt-color", value: "Black", sortOrder: 0 },
    { id: "val-white", optionId: "opt-color", value: "White", sortOrder: 1 },
  ],
  modifiers: [],
};

/** Feeds each resolution back in, the way the line-item editor does. */
function FieldsHarness({
  onResolved,
}: {
  onResolved: (resolved: ResolvedProductConfiguration) => void;
}) {
  const [configured, setConfigured] = useState<ConfiguredOptions>({});
  return (
    <ProductConfigurationFields
      product={product}
      configuredOptions={configured}
      quantity={20}
      discountPercent={0}
      onResolved={(resolved) => {
        setConfigured(resolved.configuredOptions);
        onResolved(resolved);
      }}
    />
  );
}

describe("ProductConfigurationFields — integer and boolean options", () => {
  beforeEach(() => {
    useProductConfigurationMock.mockReturnValue({
      data: railingConfiguration,
      isLoading: false,
      isError: false,
    });
  });

  it("fills select and boolean defaults and leaves a count blank for the estimator", async () => {
    const onResolved = vi.fn();
    render(<FieldsHarness onResolved={onResolved} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Color")).toHaveValue("val-black"),
    );
    expect(screen.getByLabelText("Post lights")).toHaveValue("false");
    // The catalogue says 1; a count is job geometry, so the field stays empty.
    expect(screen.getByLabelText("Left ends")).toHaveValue(null);
    const resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.configuredOptions).toStrictEqual({
      "opt-color": "val-black",
      "opt-lights": false,
    });
    expect(resolved.missingRequiredOptions).toEqual(["opt-left"]);
  });

  it("writes a typed count as a JSON number, 0 included, even through a cleared field", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(<FieldsHarness onResolved={onResolved} />);
    const field = await screen.findByLabelText("Left ends");
    expect(field).toHaveValue(null);

    await user.type(field, "3");
    expect(field).toHaveValue(3);
    let resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.configuredOptions["opt-left"]).toBe(3);
    expect(resolved.resolvedOptionsLabel).toContain("Left ends: 3");
    expect(resolved.missingRequiredOptions).toEqual([]);

    await user.clear(field);
    // A cleared field is a draft, not an instruction to fall back to anything.
    expect(field).toHaveValue(null);
    await user.type(field, "0");

    expect(field).toHaveValue(0);
    resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.configuredOptions["opt-left"]).toBe(0);
    expect(resolved.resolvedOptionsLabel).toContain("Left ends: 0");
    expect(resolved.missingRequiredOptions).toEqual([]);

    await user.tab();
    expect(field).toHaveValue(0);
  });

  it("restores the committed count when the field is left empty", async () => {
    const user = userEvent.setup();
    render(<FieldsHarness onResolved={vi.fn()} />);
    const field = await screen.findByLabelText("Left ends");
    await user.type(field, "3");
    await user.tab();
    expect(field).toHaveValue(3);

    await user.clear(field);
    await user.tab();
    expect(field).toHaveValue(3);
  });

  it("keeps a count that was never entered blank after the field is touched", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(<FieldsHarness onResolved={onResolved} />);
    const field = await screen.findByLabelText("Left ends");

    await user.click(field);
    await user.tab();
    expect(field).toHaveValue(null);
    expect(onResolved.mock.calls.at(-1)?.[0].missingRequiredOptions).toEqual([
      "opt-left",
    ]);
  });

  it("writes a boolean choice as a JSON boolean", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    render(<FieldsHarness onResolved={onResolved} />);
    const field = await screen.findByLabelText("Post lights");

    await user.selectOptions(field, "true");

    const resolved = onResolved.mock.calls.at(-1)?.[0];
    expect(resolved.configuredOptions["opt-lights"]).toBe(true);
    expect(resolved.resolvedOptionsLabel).toContain("Post lights: Yes");
    expect(field).toHaveValue("true");
  });
});
