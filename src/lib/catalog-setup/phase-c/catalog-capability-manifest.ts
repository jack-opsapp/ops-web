export const CATALOG_CAPABILITY_MANIFEST_REVISION =
  "phase-c-capabilities/2026-07-27.1" as const;

export const GUIDED_CAPABILITY_REFS = [
  "catalog-core/v1",
  "static-product-materials/v1",
  "supplier-cost-automation/v1",
  "dynamic-material-quantity/v1",
  "deck-geometry/v1",
  "roll-inventory/v1",
] as const;

export type GuidedCapabilityRef =
  (typeof GUIDED_CAPABILITY_REFS)[number];

export const GUIDED_QUESTION_INTENTS = [
  "service_selection",
  "supplier_identity",
  "product_identity",
  "option_audience",
  "option_values",
  "pricing",
  "quote_display",
  "tax_treatment",
  "storefront_visibility",
  "task_type",
  "material_tracking_scope",
  "static_material_quantity",
  "clarify_contradiction",
  "review_readiness",
] as const;

export type GuidedQuestionIntent =
  (typeof GUIDED_QUESTION_INTENTS)[number];

export interface GuidedCatalogCapability {
  ref: GuidedCapabilityRef;
  revision: typeof CATALOG_CAPABILITY_MANIFEST_REVISION;
  available: boolean;
  runtimeConsumer: string | null;
  questionIntents: readonly GuidedQuestionIntent[];
  actionTypes: readonly string[];
  unavailableReason?: string;
}

const CORE_QUESTION_INTENTS = [
  "service_selection",
  "supplier_identity",
  "product_identity",
  "option_audience",
  "option_values",
  "pricing",
  "quote_display",
  "tax_treatment",
  "storefront_visibility",
  "task_type",
  "clarify_contradiction",
] as const satisfies readonly GuidedQuestionIntent[];

const CAPABILITIES: Record<GuidedCapabilityRef, GuidedCatalogCapability> = {
  "catalog-core/v1": {
    ref: "catalog-core/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: true,
    runtimeConsumer: "OPS catalog, quoting, and storefront services",
    questionIntents: CORE_QUESTION_INTENTS,
    actionTypes: [
      "upsert_product",
      "upsert_product_option",
      "upsert_product_option_value",
      "upsert_catalog_family",
      "upsert_catalog_option",
      "upsert_catalog_option_value",
      "upsert_catalog_variant",
      "replace_variant_option_values",
      "map_product_catalog_option",
      "reuse_task_type",
      "create_task_type",
      "upsert_tax_rate",
      "move_catalog_variant",
      "archive_catalog_variant",
      "archive_catalog_option",
      "create_verification_item",
    ],
  },
  "static-product-materials/v1": {
    ref: "static-product-materials/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: true,
    runtimeConsumer:
      "src/lib/api/services/task-materials-service.ts",
    questionIntents: [
      "material_tracking_scope",
      "static_material_quantity",
    ],
    actionTypes: ["upsert_product_material"],
  },
  "supplier-cost-automation/v1": {
    ref: "supplier-cost-automation/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: false,
    runtimeConsumer: null,
    questionIntents: [],
    actionTypes: ["upsert_supplier_cost_profile"],
    unavailableReason:
      "Supplier cost profiles have no released quoting or purchasing consumer.",
  },
  "dynamic-material-quantity/v1": {
    ref: "dynamic-material-quantity/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: false,
    runtimeConsumer: null,
    questionIntents: [],
    actionTypes: ["upsert_material_quantity_rule"],
    unavailableReason:
      "Dynamic material quantity rules are stored but not executed by a released OPS client.",
  },
  "deck-geometry/v1": {
    ref: "deck-geometry/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: false,
    runtimeConsumer: null,
    questionIntents: [],
    actionTypes: ["upsert_capability_binding"],
    unavailableReason:
      "Deck Designer does not consume Phase C capability bindings.",
  },
  "roll-inventory/v1": {
    ref: "roll-inventory/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: false,
    runtimeConsumer: null,
    questionIntents: [],
    actionTypes: [],
    unavailableReason:
      "Physical roll and offcut inventory is not connected to Guided Catalog Setup.",
  },
};

const ACTION_CAPABILITIES = new Map(
  Object.values(CAPABILITIES).flatMap((capability) =>
    capability.actionTypes.map(
      (actionType) => [actionType, capability] as const,
    ),
  ),
);

export function guidedCapability(
  ref: string,
): GuidedCatalogCapability | null {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, ref)
    ? CAPABILITIES[ref as GuidedCapabilityRef]
    : null;
}

export function isGuidedCapabilityAvailable(ref: string): boolean {
  return guidedCapability(ref)?.available === true;
}

export function guidedCapabilityForAction(
  actionType: string,
): GuidedCatalogCapability | null {
  return ACTION_CAPABILITIES.get(actionType) ?? null;
}

export function guidedCapabilityManifestForModel() {
  return {
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: Object.values(CAPABILITIES)
      .filter((capability) => capability.available)
      .map((capability) => ({
        ref: capability.ref,
        questionIntents: capability.questionIntents,
        actionTypes: capability.actionTypes,
      })),
  };
}
