import {
  OPS_CAPABILITY_REGISTRY_REVISION,
  opsCapabilityDefinition,
  opsToolRegistryForAgent,
  type OpsCapabilityDefinition,
  type OpsPhaseCAccess,
} from "@/lib/ops-capabilities/registry";
import { catalogActionPayloadContractsForModel } from "./action-payload-contracts";

export const CATALOG_CAPABILITY_MANIFEST_REVISION =
  `phase-c-capabilities/2026-08-06.1+${OPS_CAPABILITY_REGISTRY_REVISION}` as const;

export const GUIDED_CAPABILITY_REFS = [
  "catalog-core/v1",
  "static-product-materials/v1",
  "tax-rate-configuration/v1",
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
  phaseCAccess: OpsPhaseCAccess;
  runtimeConsumer: string | null;
  knownAbilities: readonly string[];
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
  "tax_treatment",
  "storefront_visibility",
  "task_type",
  "clarify_contradiction",
] as const satisfies readonly GuidedQuestionIntent[];

function registeredCapability(
  ref: GuidedCapabilityRef,
): OpsCapabilityDefinition {
  const capability = opsCapabilityDefinition(ref);
  if (!capability) {
    throw new Error(`Missing OPS capability registry entry: ${ref}`);
  }
  return capability;
}

const CORE_CAPABILITY = registeredCapability("catalog-core/v1");
const STATIC_MATERIALS_CAPABILITY = registeredCapability(
  "static-product-materials/v1",
);
const TAX_RATE_CAPABILITY = registeredCapability(
  "tax-rate-configuration/v1",
);
const SUPPLIER_COST_CAPABILITY = registeredCapability(
  "supplier-cost-automation/v1",
);
const DYNAMIC_QUANTITY_CAPABILITY = registeredCapability(
  "dynamic-material-quantity/v1",
);
const DECK_GEOMETRY_CAPABILITY = registeredCapability("deck-geometry/v1");
const ROLL_INVENTORY_CAPABILITY = registeredCapability("roll-inventory/v1");

const CAPABILITIES: Record<GuidedCapabilityRef, GuidedCatalogCapability> = {
  "catalog-core/v1": {
    ref: "catalog-core/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: CORE_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: CORE_CAPABILITY.phaseCAccess,
    runtimeConsumer: CORE_CAPABILITY.runtimeConsumer,
    knownAbilities: CORE_CAPABILITY.knownAbilities,
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
      "move_catalog_variant",
      "archive_catalog_variant",
      "archive_catalog_option",
      "create_verification_item",
    ],
  },
  "static-product-materials/v1": {
    ref: "static-product-materials/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: STATIC_MATERIALS_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: STATIC_MATERIALS_CAPABILITY.phaseCAccess,
    runtimeConsumer: STATIC_MATERIALS_CAPABILITY.runtimeConsumer,
    knownAbilities: STATIC_MATERIALS_CAPABILITY.knownAbilities,
    questionIntents: [
      "material_tracking_scope",
      "static_material_quantity",
    ],
    actionTypes: ["upsert_product_material"],
  },
  "tax-rate-configuration/v1": {
    ref: "tax-rate-configuration/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: TAX_RATE_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: TAX_RATE_CAPABILITY.phaseCAccess,
    runtimeConsumer: TAX_RATE_CAPABILITY.runtimeConsumer,
    knownAbilities: TAX_RATE_CAPABILITY.knownAbilities,
    questionIntents: [],
    actionTypes: ["upsert_tax_rate"],
    unavailableReason: TAX_RATE_CAPABILITY.unavailableReason,
  },
  "supplier-cost-automation/v1": {
    ref: "supplier-cost-automation/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: SUPPLIER_COST_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: SUPPLIER_COST_CAPABILITY.phaseCAccess,
    runtimeConsumer: SUPPLIER_COST_CAPABILITY.runtimeConsumer,
    knownAbilities: SUPPLIER_COST_CAPABILITY.knownAbilities,
    questionIntents: [],
    actionTypes: ["upsert_supplier_cost_profile"],
    unavailableReason: SUPPLIER_COST_CAPABILITY.unavailableReason,
  },
  "dynamic-material-quantity/v1": {
    ref: "dynamic-material-quantity/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: DYNAMIC_QUANTITY_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: DYNAMIC_QUANTITY_CAPABILITY.phaseCAccess,
    runtimeConsumer: DYNAMIC_QUANTITY_CAPABILITY.runtimeConsumer,
    knownAbilities: DYNAMIC_QUANTITY_CAPABILITY.knownAbilities,
    questionIntents: [],
    actionTypes: ["upsert_material_quantity_rule"],
    unavailableReason: DYNAMIC_QUANTITY_CAPABILITY.unavailableReason,
  },
  "deck-geometry/v1": {
    ref: "deck-geometry/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: DECK_GEOMETRY_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: DECK_GEOMETRY_CAPABILITY.phaseCAccess,
    runtimeConsumer: DECK_GEOMETRY_CAPABILITY.runtimeConsumer,
    knownAbilities: DECK_GEOMETRY_CAPABILITY.knownAbilities,
    questionIntents: [],
    actionTypes: ["upsert_capability_binding"],
    unavailableReason: DECK_GEOMETRY_CAPABILITY.unavailableReason,
  },
  "roll-inventory/v1": {
    ref: "roll-inventory/v1",
    revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    available: ROLL_INVENTORY_CAPABILITY.phaseCAccess === "configure",
    phaseCAccess: ROLL_INVENTORY_CAPABILITY.phaseCAccess,
    runtimeConsumer: ROLL_INVENTORY_CAPABILITY.runtimeConsumer,
    knownAbilities: ROLL_INVENTORY_CAPABILITY.knownAbilities,
    questionIntents: [],
    actionTypes: [],
    unavailableReason: ROLL_INVENTORY_CAPABILITY.unavailableReason,
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
    registryRevision: OPS_CAPABILITY_REGISTRY_REVISION,
    available: Object.values(CAPABILITIES)
      .filter((capability) => capability.available)
      .map((capability) => ({
        ref: capability.ref,
        questionIntents: capability.questionIntents,
        actionTypes: capability.actionTypes,
      })),
    knownTools: opsToolRegistryForAgent(),
    actionPayloads: catalogActionPayloadContractsForModel(),
  };
}
