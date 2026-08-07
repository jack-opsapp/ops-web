export const OPS_CAPABILITY_REGISTRY_REVISION =
  "ops-capabilities/2026-08-06.1" as const;

export type OpsPhaseCAccess = "configure" | "discover_only" | "unavailable";

export interface OpsToolDefinition {
  ref: string;
  name: string;
  revision: typeof OPS_CAPABILITY_REGISTRY_REVISION;
  lifecycle: "released";
  phaseCAccess: OpsPhaseCAccess;
  canConfigure: boolean;
  canExecute: boolean;
  runtimeConsumers: readonly string[];
  abilities: readonly string[];
  evidence: readonly string[];
}

export interface OpsCapabilityDefinition {
  ref: string;
  phaseCAccess: OpsPhaseCAccess;
  runtimeConsumer: string | null;
  knownAbilities: readonly string[];
  toolRef?: string;
  unavailableReason?: string;
}

const TOOLS = {
  "deck-designer/v1": {
    ref: "deck-designer/v1",
    name: "Deck Designer",
    revision: OPS_CAPABILITY_REGISTRY_REVISION,
    lifecycle: "released",
    phaseCAccess: "discover_only",
    canConfigure: false,
    canExecute: false,
    runtimeConsumers: ["OPS Decks", "DeckKit"],
    abilities: [
      "calculate deck material quantities",
      "generate vinyl cut plans",
      "calculate ordered area and cut waste",
      "reuse compatible vinyl offcuts",
      "produce vinyl order notes",
    ],
    evidence: [
      "ops-decks-ios/Packages/DeckKit/Sources/DeckKit/Engine/EstimateGeneratorService.swift",
      "ops-decks-ios/Packages/DeckKit/Sources/DeckKit/Engine/VinylCutListEngine.swift",
    ],
  },
} as const satisfies Record<string, OpsToolDefinition>;

const CAPABILITIES = {
  "catalog-core/v1": {
    ref: "catalog-core/v1",
    phaseCAccess: "configure",
    runtimeConsumer: "OPS catalog, quoting, and storefront services",
    knownAbilities: [
      "configure catalog products and options",
      "configure product pricing and minimum charges",
      "configure storefront visibility",
      "configure whether a product is taxable",
    ],
  },
  "static-product-materials/v1": {
    ref: "static-product-materials/v1",
    phaseCAccess: "configure",
    runtimeConsumer: "OPS product material services",
    knownAbilities: ["configure a fixed material quantity per product unit"],
  },
  "tax-rate-configuration/v1": {
    ref: "tax-rate-configuration/v1",
    phaseCAccess: "unavailable",
    runtimeConsumer: null,
    knownAbilities: [],
    unavailableReason:
      "Guided Catalog Setup uses the company's existing default tax rate and does not create or change tax rates.",
  },
  "supplier-cost-automation/v1": {
    ref: "supplier-cost-automation/v1",
    phaseCAccess: "unavailable",
    runtimeConsumer: null,
    knownAbilities: [],
    unavailableReason:
      "Supplier cost profiles have no released quoting or purchasing consumer.",
  },
  "dynamic-material-quantity/v1": {
    ref: "dynamic-material-quantity/v1",
    phaseCAccess: "unavailable",
    runtimeConsumer: null,
    knownAbilities: [],
    unavailableReason:
      "Dynamic material quantity rules are stored but not executed by a released OPS client.",
  },
  "deck-geometry/v1": {
    ref: "deck-geometry/v1",
    phaseCAccess: "discover_only",
    runtimeConsumer: "OPS Decks / DeckKit",
    knownAbilities: TOOLS["deck-designer/v1"].abilities,
    toolRef: "deck-designer/v1",
    unavailableReason:
      "Deck Designer is released, but Phase C cannot configure or execute its catalog bindings yet.",
  },
  "roll-inventory/v1": {
    ref: "roll-inventory/v1",
    phaseCAccess: "unavailable",
    runtimeConsumer: null,
    knownAbilities: [],
    unavailableReason:
      "Physical roll and offcut inventory is not connected to Guided Catalog Setup.",
  },
} as const satisfies Record<string, OpsCapabilityDefinition>;

export function opsToolDefinition(ref: string): OpsToolDefinition | null {
  return Object.prototype.hasOwnProperty.call(TOOLS, ref)
    ? TOOLS[ref as keyof typeof TOOLS]
    : null;
}

export function opsCapabilityDefinition(
  ref: string,
): OpsCapabilityDefinition | null {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, ref)
    ? CAPABILITIES[ref as keyof typeof CAPABILITIES]
    : null;
}

export function opsToolRegistryForAgent() {
  return Object.values(TOOLS).map((tool) => ({
    ref: tool.ref,
    name: tool.name,
    lifecycle: tool.lifecycle,
    phaseCAccess: tool.phaseCAccess,
    canConfigure: tool.canConfigure,
    canExecute: tool.canExecute,
    runtimeConsumers: tool.runtimeConsumers,
    abilities: tool.abilities,
  }));
}
