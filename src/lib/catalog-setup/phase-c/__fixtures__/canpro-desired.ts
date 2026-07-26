import type { DesiredCatalogStructure } from "../reconcile";
import {
  DEKSMART_MEMBRANES,
  DEKSMART_SYSTEM_MATERIALS,
} from "./canpro-deksmart-reference";

interface BuildDeksmartVinylDesiredStructureInput {
  standardPricePerSqft: number;
  smoothbackPricePerSqft: number;
  standardLaborCostPerSqft: number;
  smoothbackLaborCostPerSqft: number;
  minimumCharge: number;
  taxRate: number;
  taskTypeDisplay: string;
}

function token(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function costProfiles(
  standard: number,
  condo: number | null,
) {
  return [
    {
      profileKey: "standard",
      label: "Standard",
      unitCost: standard,
      isDefault: true,
      activationRule: {},
    },
    ...(condo == null
      ? []
      : [
          {
            profileKey: "condo",
            label: "CONDO",
            unitCost: condo,
            isDefault: false,
            activationRule: { orderTag: "CONDO" },
          },
        ]),
  ];
}

function edgeRule(source: "exposed_edge_lf" | "wall_edge_lf", length: number) {
  return {
    calculationKind: "edge_length" as const,
    measureSource: source,
    requiredInputs: [source],
    wasteFactor: 1,
    purchaseRounding: "whole_length" as const,
    roundingIncrement: length,
    packageQuantity: length,
    fallbackRule: { mode: "manual_linear_feet" },
    config: { bankLeftovers: false },
  };
}

function contactRule(
  coverageSqft: number,
  selection: "summer" | "winter" | "required",
) {
  return {
    calculationKind: "coverage" as const,
    measureSource: "finished_area_sqft",
    requiredInputs: ["finished_area_sqft"],
    coverageQuantity: coverageSqft,
    wasteFactor: 1,
    purchaseRounding: "whole_package" as const,
    packageQuantity: 1,
    fallbackRule: { mode: "manual_area" },
    config: {
      inventoryFractions: [0.25, 0.5, 0.75, 1],
      remainderRounding: "down",
      conservative: true,
      ...(selection === "required"
        ? {}
        : {
            selectionGroup: "contact_adhesive",
            staffOnly: true,
            selection,
          }),
    },
  };
}

function membraneFamily(
  clientId: string,
  name: string,
  colors: readonly string[],
  standardCost: number,
  condoCost: number,
  legacyFamilyName?: string,
  legacyType?: string,
) {
  return {
    clientId,
    name,
    aliases: legacyFamilyName ? [legacyFamilyName] : undefined,
    optionName: "Color",
    variants: colors.map((color) => ({
      clientId: `${clientId}-${token(color)}`,
      label: color,
      supplierSku: null,
      unitCost: standardCost,
      costProfiles: costProfiles(standardCost, condoCost),
      ...(legacyFamilyName && legacyType
        ? {
            legacyMatch: {
              familyName: legacyFamilyName,
              optionValues: { Color: color, Type: legacyType },
            },
          }
        : {}),
    })),
  };
}

function colorOption(
  productClientId: string,
  familyClientId: string,
  colors: readonly string[],
) {
  return {
    clientId: `${productClientId}:color`,
    name: "Color",
    required: true,
    affectsRecipe: true,
    catalogOptionRef: `${familyClientId}:color`,
    values: colors.map((color) => ({
      clientId: `${productClientId}:color:${token(color)}`,
      label: color,
      catalogValueRef: `${familyClientId}:color:${token(color)}`,
    })),
  };
}

function membraneMaterial(productClientId: string, familyClientId: string) {
  return {
    clientId: `${productClientId}:membrane`,
    catalogItemRef: familyClientId,
    // RecipeResolver matches selector keys to catalog option names and
    // `$option.<name>` expressions to the product option selected on the
    // estimate line. Both sides are name-based at runtime, not client-id based.
    variantSelector: { color: "$option.color" },
    quantityPerUnit: 1,
    notes: "Exact cuts come from each deck's dimensions.",
    quantityRule: {
      calculationKind: "cut_plan" as const,
      measureSource: "deck_geometry/v1",
      requiredInputs: ["finished_area_sqft", "deck_dimensions"],
      wasteFactor: 1,
      purchaseRounding: "none" as const,
      fallbackRule: { mode: "manual_dimensions" },
      config: {
        rollWidthInches: 72,
        rollLengthFeet: 75,
        rollCoverageSqft: 450,
        supplierPrecuts: true,
      },
    },
  };
}

export function buildDeksmartVinylDesiredStructure(
  input: BuildDeksmartVinylDesiredStructureInput,
): DesiredCatalogStructure {
  const materialVariants = [
    DEKSMART_SYSTEM_MATERIALS.summerContact,
    DEKSMART_SYSTEM_MATERIALS.winterContact,
    DEKSMART_SYSTEM_MATERIALS.latex,
    DEKSMART_SYSTEM_MATERIALS.galvanizedDrip,
    DEKSMART_SYSTEM_MATERIALS.pvcDripGrey,
    DEKSMART_SYSTEM_MATERIALS.angle,
    DEKSMART_SYSTEM_MATERIALS.vinylClipGrey,
  ].map((material) => ({
    clientId: `material-${material.key}`,
    label: material.name,
    supplierSku: material.supplierSku,
    unitCost: material.cost.standard,
    costProfiles: costProfiles(material.cost.standard, material.cost.condo),
  }));

  const standardProductId = "vinyl-install-68";
  const smoothbackProductId = "vinyl-install-60";
  const standardFamilyId = DEKSMART_MEMBRANES.ultra68.key;
  const smoothbackFamilyId = DEKSMART_MEMBRANES.smoothback60.key;

  return {
    taxRates: [
      {
        clientId: "gst",
        name: "GST",
        rate: input.taxRate,
        isDefault: true,
        isActive: true,
      },
    ],
    taskTypes: [
      {
        clientId: "vinyl-install",
        display: input.taskTypeDisplay,
      },
    ],
    families: [
      membraneFamily(
        standardFamilyId,
        DEKSMART_MEMBRANES.ultra68.name,
        DEKSMART_MEMBRANES.ultra68.colors,
        DEKSMART_MEMBRANES.ultra68.cost.standard,
        DEKSMART_MEMBRANES.ultra68.cost.condo,
        "Vinyl",
        "68mil Fuzzy",
      ),
      membraneFamily(
        smoothbackFamilyId,
        DEKSMART_MEMBRANES.smoothback60.name,
        DEKSMART_MEMBRANES.smoothback60.colors,
        DEKSMART_MEMBRANES.smoothback60.cost.standard,
        DEKSMART_MEMBRANES.smoothback60.cost.condo,
        "Vinyl",
        "60mil Smooth",
      ),
      {
        clientId: "deksmart-system-materials",
        name: "DekSmart system materials",
        optionName: "Product",
        variants: materialVariants,
      },
    ],
    products: [
      {
        clientId: standardProductId,
        name: "Vinyl membrane installation",
        description:
          "Supply and install DekSmart Ultra 68mil vinyl membrane.",
        basePrice: input.standardPricePerSqft,
        unitCost: input.standardLaborCostPerSqft,
        pricingUnit: "sqft",
        minimumCharge: input.minimumCharge,
        isTaxable: true,
        showInStorefront: true,
        taskTypeClientId: "vinyl-install",
        linkedFamilyRef: standardFamilyId,
        options: [
          colorOption(
            standardProductId,
            standardFamilyId,
            DEKSMART_MEMBRANES.ultra68.colors,
          ),
        ],
        materials: [
          membraneMaterial(standardProductId, standardFamilyId),
          {
            clientId: `${standardProductId}:summer-contact`,
            catalogVariantRef: "material-vg2510",
            quantityPerUnit: 1,
            quantityRule: contactRule(400, "summer"),
          },
          {
            clientId: `${standardProductId}:winter-contact`,
            catalogVariantRef: "material-vg15023",
            quantityPerUnit: 1,
            quantityRule: contactRule(400, "winter"),
          },
          {
            clientId: `${standardProductId}:drip`,
            catalogVariantRef: "material-vdf15",
            quantityPerUnit: 1,
            quantityRule: edgeRule("exposed_edge_lf", 8),
          },
          {
            clientId: `${standardProductId}:angle`,
            catalogVariantRef: "material-vdf05",
            quantityPerUnit: 1,
            quantityRule: edgeRule("wall_edge_lf", 8),
          },
          {
            clientId: `${standardProductId}:clip`,
            catalogVariantRef: "material-vinyl-clip-grey",
            quantityPerUnit: 1,
            quantityRule: edgeRule("exposed_edge_lf", 10),
          },
        ],
        capability: {
          capabilityKey: "deck_geometry/v1",
          requiredInputs: [
            "finished_area_sqft",
            "deck_dimensions",
            "exposed_edge_lf",
            "wall_edge_lf",
          ],
          fallbackBehavior: { mode: "manual_dimensions" },
        },
      },
      {
        clientId: smoothbackProductId,
        name: "Vinyl membrane installation — 60mil",
        description:
          "Supply and install DekSmart Smoothback 60mil vinyl membrane.",
        basePrice: input.smoothbackPricePerSqft,
        unitCost: input.smoothbackLaborCostPerSqft,
        pricingUnit: "sqft",
        minimumCharge: input.minimumCharge,
        isTaxable: true,
        showInStorefront: false,
        taskTypeClientId: "vinyl-install",
        linkedFamilyRef: smoothbackFamilyId,
        options: [
          colorOption(
            smoothbackProductId,
            smoothbackFamilyId,
            DEKSMART_MEMBRANES.smoothback60.colors,
          ),
        ],
        materials: [
          membraneMaterial(smoothbackProductId, smoothbackFamilyId),
          {
            clientId: `${smoothbackProductId}:latex`,
            catalogVariantRef: "material-vg4500",
            quantityPerUnit: 1,
            quantityRule: contactRule(450, "required"),
          },
          {
            clientId: `${smoothbackProductId}:drip`,
            catalogVariantRef: "material-vdfg",
            quantityPerUnit: 1,
            quantityRule: edgeRule("exposed_edge_lf", 8),
          },
          {
            clientId: `${smoothbackProductId}:angle`,
            catalogVariantRef: "material-vdf05",
            quantityPerUnit: 1,
            quantityRule: edgeRule("wall_edge_lf", 8),
          },
        ],
        capability: {
          capabilityKey: "deck_geometry/v1",
          requiredInputs: [
            "finished_area_sqft",
            "deck_dimensions",
            "exposed_edge_lf",
            "wall_edge_lf",
          ],
          fallbackBehavior: { mode: "manual_dimensions" },
        },
      },
    ],
  };
}
