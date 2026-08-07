import { describe, expect, it } from "vitest";
import type { LiveCatalogSnapshot } from "../live-catalog-context";
import {
  verifyCatalogBlueprintReadback,
} from "../readback-verifier";
import type { CatalogAction, CatalogBlueprint } from "../types";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function action(
  actionType: CatalogAction["actionType"],
  clientId: string,
  existingId: string | undefined,
  payload: Record<string, unknown>,
): CatalogAction {
  return {
    actionKey: `test:${actionType}:${clientId}`,
    group: existingId ? "UPDATE" : "CREATE",
    actionType,
    targetKind: actionType,
    clientId,
    ...(existingId ? { existingId } : {}),
    dependsOn: [],
    payload,
  };
}

function snapshot(): LiveCatalogSnapshot {
  return {
    companyId: id(99),
    hash: "sha256:test",
    products: [],
    productOptions: [],
    productOptionValues: [],
    pricingModifiers: [],
    productMaterials: [],
    materialQuantityRules: [],
    families: [],
    catalogOptions: [],
    catalogOptionValues: [],
    variants: [],
    variantOptionValues: [],
    productOptionMappings: [],
    stockUnits: [],
    supplierCostProfiles: [],
    capabilityBindings: [],
    units: [],
    categories: [],
    taskTypes: [],
    taxRates: [],
    verificationItems: [],
  };
}

function exactFixture() {
  const ids = {
    task: id(1),
    family: id(2),
    catalogOption: id(3),
    catalogValue: id(4),
    variant: id(5),
    product: id(6),
    productOption: id(7),
    productValue: id(8),
    mapping: id(9),
    material: id(10),
    rule: id(11),
    supplier: id(12),
    capability: id(13),
    tax: id(14),
  };
  const resolvedIds = {
    task: ids.task,
    family: ids.family,
    "family:color": ids.catalogOption,
    "family:color:grey": ids.catalogValue,
    variant: ids.variant,
    product: ids.product,
    "product:color": ids.productOption,
    "product:color:grey": ids.productValue,
    mapping: ids.mapping,
    material: ids.material,
    rule: ids.rule,
    supplier: ids.supplier,
    capability: ids.capability,
    tax: ids.tax,
  };
  const actions: CatalogAction[] = [
    action("reuse_task_type", "task", ids.task, {
      display: "Vinyl Install",
    }),
    action("upsert_catalog_family", "family", ids.family, {
      name: "DekSmart Ultra 68mil membrane",
    }),
    action(
      "upsert_catalog_option",
      "family:color",
      ids.catalogOption,
      {
        familyRef: "family",
        name: "Color",
        sortOrder: 0,
      },
    ),
    action(
      "upsert_catalog_option_value",
      "family:color:grey",
      ids.catalogValue,
      {
        optionRef: "family:color",
        value: "Dove Grey",
        sortOrder: 0,
      },
    ),
    action("upsert_catalog_variant", "variant", ids.variant, {
      familyRef: "family",
      supplierSku: null,
      unitCost: 2.82,
    }),
    action(
      "replace_variant_option_values",
      "variant:values",
      undefined,
      {
        variantRef: "variant",
        optionValueRefs: ["family:color:grey"],
      },
    ),
    action("upsert_product", "product", ids.product, {
      name: "Vinyl membrane installation",
      description: "Supply and install DekSmart Ultra 68mil vinyl membrane.",
      basePrice: 11.73,
      defaultPrice: 11.73,
      unitCost: 2,
      minimumCharge: 1500,
      pricingUnit: "sqft",
      kind: "service",
      type: "LABOR",
      isTaxable: true,
      showInStorefront: true,
      taskTypeClientId: "task",
      linkedFamilyRef: "family",
    }),
    action(
      "upsert_product_option",
      "product:color",
      ids.productOption,
      {
        productRef: "product",
        name: "Color",
        kind: "select",
        affectsPrice: false,
        affectsRecipe: true,
        required: true,
        sortOrder: 0,
      },
    ),
    action(
      "upsert_product_option_value",
      "product:color:grey",
      ids.productValue,
      {
        optionRef: "product:color",
        value: "Dove Grey",
        sortOrder: 0,
      },
    ),
    action("map_product_catalog_option", "mapping", ids.mapping, {
      productRef: "product",
      catalogItemRef: "family",
      catalogOptionRef: "family:color",
      productOptionRef: "product:color",
      catalogOptionValueRef: "family:color:grey",
      productOptionValueRef: "product:color:grey",
      mappingKind: "value",
    }),
    action("upsert_product_material", "material", ids.material, {
      productRef: "product",
      catalogItemRef: "family",
      variantSelector: { color: "$option.color" },
      quantityPerUnit: 1,
      notes: "Exact cuts come from each deck's dimensions.",
    }),
    action("upsert_material_quantity_rule", "rule", ids.rule, {
      productMaterialRef: "material",
      calculationKind: "cut_plan",
      measureSource: "deck_geometry/v1",
      requiredInputs: ["finished_area_sqft", "deck_dimensions"],
      wasteFactor: 1,
      purchaseRounding: "none",
      fallbackRule: { mode: "manual_dimensions" },
      config: { rollWidthInches: 72 },
    }),
    action("upsert_supplier_cost_profile", "supplier", ids.supplier, {
      variantRef: "variant",
      profileKey: "standard",
      label: "Standard",
      unitCost: 2.82,
      currencyCode: "CAD",
      isDefault: true,
      activationRule: {},
    }),
    action("upsert_capability_binding", "capability", ids.capability, {
      productRef: "product",
      capabilityKey: "deck_geometry/v1",
      requiredInputs: ["finished_area_sqft", "deck_dimensions"],
      fallbackBehavior: { mode: "manual_dimensions" },
      enabled: true,
    }),
    action("upsert_tax_rate", "tax", ids.tax, {
      name: "GST",
      rate: 0.05,
      isDefault: true,
      isActive: true,
    }),
  ];
  const blueprint: CatalogBlueprint = {
    version: 1,
    summary: "Exact readback fixture",
    ready: true,
    actions,
    issues: [],
  };
  const live = snapshot();
  live.taskTypes.push({
    id: ids.task,
    display: "Vinyl Install",
    deleted_at: null,
  });
  live.families.push({
    id: ids.family,
    name: "DekSmart Ultra 68mil membrane",
    deleted_at: null,
  });
  live.catalogOptions.push({
    id: ids.catalogOption,
    catalog_item_id: ids.family,
    name: "Color",
    sort_order: 0,
    deleted_at: null,
  });
  live.catalogOptionValues.push({
    id: ids.catalogValue,
    option_id: ids.catalogOption,
    value: "Dove Grey",
    sort_order: 0,
    deleted_at: null,
  });
  live.variants.push({
    id: ids.variant,
    catalog_item_id: ids.family,
    sku: null,
    unit_cost_override: 2.82,
    is_active: true,
    deleted_at: null,
  });
  live.variantOptionValues.push({
    id: id(15),
    variant_id: ids.variant,
    option_value_id: ids.catalogValue,
    deleted_at: null,
  });
  live.products.push({
    id: ids.product,
    name: "Vinyl membrane installation",
    description: "Supply and install DekSmart Ultra 68mil vinyl membrane.",
    base_price: 11.73,
    default_price: 11.73,
    unit_cost: 2,
    minimum_charge: 1500,
    pricing_unit: "sqft",
    kind: "service",
    type: "LABOR",
    is_taxable: true,
    show_in_storefront: true,
    is_active: true,
    task_type_ref: ids.task,
    linked_catalog_item_id: ids.family,
    deleted_at: null,
  });
  live.productOptions.push({
    id: ids.productOption,
    product_id: ids.product,
    name: "Color",
    kind: "select",
    affects_price: false,
    affects_recipe: true,
    required: true,
    sort_order: 0,
    deleted_at: null,
  });
  live.productOptionValues.push({
    id: ids.productValue,
    option_id: ids.productOption,
    value: "Dove Grey",
    sort_order: 0,
    deleted_at: null,
  });
  live.productOptionMappings.push({
    id: ids.mapping,
    product_id: ids.product,
    catalog_item_id: ids.family,
    catalog_option_id: ids.catalogOption,
    product_option_id: ids.productOption,
    catalog_option_value_id: ids.catalogValue,
    product_option_value_id: ids.productValue,
    mapping_kind: "value",
    deleted_at: null,
  });
  live.productMaterials.push({
    id: ids.material,
    product_id: ids.product,
    catalog_variant_id: null,
    catalog_item_id: ids.family,
    variant_selector: { color: "$option.color" },
    quantity_per_unit: 1,
    notes: "Exact cuts come from each deck's dimensions.",
    deleted_at: null,
  });
  live.materialQuantityRules.push({
    id: ids.rule,
    product_material_id: ids.material,
    calculation_kind: "cut_plan",
    measure_source: "deck_geometry/v1",
    required_inputs: ["finished_area_sqft", "deck_dimensions"],
    coverage_quantity: null,
    waste_factor: 1,
    purchase_rounding: "none",
    rounding_increment: null,
    package_quantity: null,
    fallback_rule: { mode: "manual_dimensions" },
    config: { rollWidthInches: 72 },
    deleted_at: null,
  });
  live.supplierCostProfiles.push({
    id: ids.supplier,
    catalog_variant_id: ids.variant,
    profile_key: "standard",
    label: "Standard",
    unit_cost: 2.82,
    currency_code: "CAD",
    is_default: true,
    activation_rule: {},
    deleted_at: null,
  });
  live.capabilityBindings.push({
    id: ids.capability,
    product_id: ids.product,
    capability_key: "deck_geometry/v1",
    required_inputs: ["finished_area_sqft", "deck_dimensions"],
    fallback_behavior: { mode: "manual_dimensions" },
    enabled: true,
    deleted_at: null,
  });
  live.taxRates.push({
    id: ids.tax,
    name: "GST",
    rate: 0.05,
    is_default: true,
    is_active: true,
    deleted_at: null,
  });
  return { blueprint, live, resolvedIds };
}

describe("Phase C readback verifier", () => {
  it("verifies every persisted relationship and business rule in the approved plan", () => {
    const { blueprint, live, resolvedIds } = exactFixture();

    expect(
      verifyCatalogBlueprintReadback({
        blueprint,
        snapshot: live,
        resolvedIds,
      }),
    ).toEqual([]);
  });

  it("returns attention issues when pricing or a purchasing rule drifted", () => {
    const { blueprint, live, resolvedIds } = exactFixture();
    live.products[0].base_price = 9.99;
    live.materialQuantityRules[0].config = { rollWidthInches: 60 };

    expect(
      verifyCatalogBlueprintReadback({
        blueprint,
        snapshot: live,
        resolvedIds,
      }).map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        "product_readback_mismatch",
        "material_rule_readback_mismatch",
      ]),
    );
  });

  it("does not report a cleared minimum charge as verified while a value remains", () => {
    const { blueprint, live, resolvedIds } = exactFixture();
    const productAction = blueprint.actions.find(
      (entry) => entry.actionType === "upsert_product",
    );
    if (!productAction) throw new Error("Missing product fixture");
    productAction.payload.minimumCharge = null;

    expect(
      verifyCatalogBlueprintReadback({
        blueprint,
        snapshot: live,
        resolvedIds,
      }),
    ).toEqual([
      expect.objectContaining({ code: "product_readback_mismatch" }),
    ]);
  });
});
