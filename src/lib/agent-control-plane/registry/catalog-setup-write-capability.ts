import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CATALOG_SETUP_WRITE_SCHEMA_REVISION,
  CommitCatalogSetupWriteInputSchema,
  PrepareCreateCatalogVariantInputSchema,
  PrepareSetCatalogPricingInputSchema,
  PrepareSetSupplierCostInputSchema,
  PrepareSetVariantThresholdsInputSchema,
} from "@/lib/agent-control-plane/contracts/catalog-setup-write";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "./capability-types";

/**
 * Catalogue-setup writes are one family with one approval surface. Adding a
 * later kind means adding its own prepare definition here with the same
 * AUTHORIZATION object and appending it to CATALOG_SETUP_WRITE_DEFINITIONS —
 * the commit capability, the manifest revision and the approval queue are
 * already shared.
 */
function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

/**
 * Opening stock is a stock event, so a request that carries one needs the
 * operator's stock-adjust permission on top of catalogue editing. The database
 * compile function makes the same check; this keeps the tool's declared
 * authority honest at discovery time rather than only at call time.
 */
export function catalogSetupWriteHasEffect(
  input: Readonly<Record<string, unknown>>,
  effect: "opening_stock" | "supplier_cost"
): boolean {
  if (effect === "opening_stock") {
    const opening = input.opening_quantity;
    return typeof opening === "object" && opening !== null;
  }
  return Object.prototype.hasOwnProperty.call(input, "supplier_cost");
}

function effectSelector(
  effect: "opening_stock" | "supplier_cost"
): CapabilityAuthorizationSelector {
  return Object.freeze({
    kind: "catalog_setup_write_effect" as const,
    effect,
  });
}

const BASE_PERMISSIONS = Object.freeze([
  Object.freeze([
    permission("agent.review"),
    permission("catalog.manage"),
    permission("catalog.products.view"),
    permission("catalog.view"),
  ]),
]);

const AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "catalog_setup_write_base",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.catalog.read",
        "ops.catalog.prepare",
      ]),
      permissionRequirementGroups: BASE_PERMISSIONS,
    }),
    Object.freeze({
      key: "catalog_setup_write_opening_stock",
      selector: effectSelector("opening_stock"),
      requiredOAuthScopes: Object.freeze(["ops.catalog.prepare"]),
      permissionRequirementGroups: Object.freeze([
        Object.freeze([permission("catalog.stock.adjust")]),
      ]),
    }),
  ]),
});

/**
 * `catalog_items.default_price` and `catalog_supplier_cost_profiles` are written
 * nowhere in OPS except the catalogue setup wizard, whose route is gated on
 * `catalog.run_setup`, and the supplier-cost table's own row policy names that
 * same key. A SECURITY DEFINER writer reached through MCP must not become a way
 * around the policy that guards the table it writes, so the two money kinds ask
 * for setup authority on top of the shared catalogue base. The first two kinds
 * go through `catalog_setup_save` against tables whose policies ask for no such
 * key, which is why the spine did not need this and these two do.
 */
const SETUP_AUTHORITY_VARIANT = Object.freeze({
  key: "catalog_setup_write_setup_authority",
  selector: Object.freeze({ kind: "always" as const }),
  requiredOAuthScopes: Object.freeze(["ops.catalog.prepare"]),
  permissionRequirementGroups: Object.freeze([
    Object.freeze([permission("catalog.run_setup")]),
  ]),
});

const PRICING_AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "catalog_setup_write_base",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.catalog.read",
        "ops.catalog.prepare",
      ]),
      permissionRequirementGroups: BASE_PERMISSIONS,
    }),
    SETUP_AUTHORITY_VARIANT,
  ]),
});

export const PREPARE_SET_CATALOG_PRICING_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_set_catalog_pricing",
  schemaRevision: CATALOG_SETUP_WRITE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "catalog_setup_write",
  description:
    "Prepare the selling price of one catalogue family or one catalogue variant for exact operator approval inside OPS. Sale price resolves as the variant override when set, otherwise the family default, so aim a family ref at the number every variant should inherit and a variant ref at the one that should differ. An explicit null clears the price at the level the ref names: clearing a family default leaves every variant carrying no override of its own with no price at all, and the preview lists each one. The amount is a decimal string of at most four fraction digits and the currency must equal the company's own currency. A request that resolves to the price already on file is refused rather than staged. This tool never writes cost. Costs are recorded as supplier cost profiles with prepare_set_supplier_cost. No stock moves, no message is sent and no accounting sync is enqueued.",
  inputSchema: PrepareSetCatalogPricingInputSchema,
  authorization: PRICING_AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 48_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 3,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_prepare",
  rateLimitBucket: "prepare",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "change_set_preview",
    exactPreviewRequired: true,
    expires: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.prepare_set_catalog_pricing",
} as const satisfies ImplementationOnlyCapabilityDefinition);

/**
 * Cost is separately authorised data on every OPS surface that shows it, so the
 * tool that writes it asks for the read authority as well: the OAuth scope the
 * catalogue cost read asks for, and the permission the database's own
 * `agent_catalog_setup_write_can_read` gate names for this kind. Unconditional,
 * not behind an input selector — every request to this tool reads and writes
 * cost, so making the authority depend on a field the caller could omit would
 * be a way to ask for less than the tool does.
 */
const COST_AUTHORITY_VARIANT = Object.freeze({
  key: "catalog_setup_write_cost_authority",
  selector: Object.freeze({ kind: "always" as const }),
  requiredOAuthScopes: Object.freeze(["ops.catalog_costs.read"]),
  permissionRequirementGroups: Object.freeze([
    Object.freeze([permission("finances.view")]),
  ]),
});

const SUPPLIER_COST_AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "catalog_setup_write_base",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.catalog.read",
        "ops.catalog.prepare",
      ]),
      permissionRequirementGroups: BASE_PERMISSIONS,
    }),
    SETUP_AUTHORITY_VARIANT,
    COST_AUTHORITY_VARIANT,
  ]),
});

export const PREPARE_SET_SUPPLIER_COST_CAPABILITY_DEFINITION = Object.freeze({
  name: "prepare_set_supplier_cost",
  schemaRevision: CATALOG_SETUP_WRITE_SCHEMA_REVISION,
  operation: "prepare",
  writeFamily: "catalog_setup_write",
  description:
    "Prepare one supplier cost profile on one catalogue variant for exact operator approval inside OPS. Profiles are keyed by profile_key, not by a supplier record, so a variant can carry several rate cards at once — a standard rate and a negotiated one, say — and a variant that carries any profile carries exactly one default. Setting is_default demotes the current default in the same write; a request that would leave the variant with profiles and no default is refused. Writing a key whose profile was previously removed brings that row back, reported as revived rather than created. The cost is a decimal string of at most four fraction digits and the currency must equal the company's own currency. OPS keeps two cost models and this tool keeps them together: whenever the profile that ends up as the variant's default changes, or that default's cost changes, the variant's own cost field is set to the same number in the same write, and the preview reports that mirror on both sides. activation_rule and source are small objects OPS stores verbatim; OPS adds its own provenance under the reserved ops key. The preview lists every profile the variant has, on both sides, so the default flip is visible rather than inferred. No price moves, no stock moves, no message is sent and no accounting sync is enqueued.",
  inputSchema: PrepareSetSupplierCostInputSchema,
  authorization: SUPPLIER_COST_AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 48_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "required",
    output: "required",
    maxEvidenceRefs: 3,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_prepare",
  rateLimitBucket: "prepare",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "change_set_preview",
    exactPreviewRequired: true,
    expires: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.prepare_set_supplier_cost",
} as const satisfies ImplementationOnlyCapabilityDefinition);

export const PREPARE_SET_VARIANT_THRESHOLDS_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_set_variant_thresholds",
    schemaRevision: CATALOG_SETUP_WRITE_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "catalog_setup_write",
    description:
      "Prepare the low-stock warning and critical levels on one existing catalogue variant for exact operator approval inside OPS. Thresholds are whole units, in and out, as OPS stores and shows them. Name at least one of the two: a whole number sets the variant's own level, and an explicit null clears it so the variant falls back to the family default, then the category default, then nothing tracked at all. The preview reports the resulting effective level with the origin it comes from — variant, family, category or none. Where both levels resolve, the critical level must be at or below the warning level. A request that resolves to the levels already in force is refused rather than staged. Nothing else on the variant moves: no stock event, no price, no message and no accounting sync.",
    inputSchema: PrepareSetVariantThresholdsInputSchema,
    authorization: AUTHORIZATION,
    riskTier: "high",
    bounds: {
      maxInputBytes: 32_768,
      maxOutputCharacters: 48_000,
      maxResultItems: 1,
    },
    evidencePolicy: {
      input: "required",
      output: "required",
      maxEvidenceRefs: 3,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "mutation_prepare",
    rateLimitBucket: "prepare",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: {
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    },
    idempotencyPolicy: {
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    },
    availability: { implementation: "available" },
    rolloutFlag:
      "agent_control_plane.capability.prepare_set_variant_thresholds",
  } as const satisfies ImplementationOnlyCapabilityDefinition);

/** The commit confirms whichever prepare produced the approved change set. */
const COMMIT_AUTHORIZATION = Object.freeze({
  variants: Object.freeze([
    Object.freeze({
      key: "catalog_setup_write_base",
      selector: Object.freeze({ kind: "always" as const }),
      requiredOAuthScopes: Object.freeze([
        "ops.catalog.read",
        "ops.catalog.prepare",
      ]),
      permissionRequirementGroups: BASE_PERMISSIONS,
    }),
  ]),
});

export const PREPARE_CREATE_CATALOG_VARIANT_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_create_catalog_variant",
    schemaRevision: CATALOG_SETUP_WRITE_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "catalog_setup_write",
    description:
      "Prepare one new variant on an existing catalogue family for exact operator approval inside OPS. Answer every non-deleted option on the family exactly once; a value set that already exists is refused. Selling price resolves as the variant price override, else the family default, so a price is required when the family has no default. Thresholds are whole units, as OPS stores them. An opening quantity is recorded as a stock unit and a receive stock event, never as a silent count. Nothing is written, no message is sent and no accounting sync is enqueued during preparation.",
    inputSchema: PrepareCreateCatalogVariantInputSchema,
    authorization: AUTHORIZATION,
    riskTier: "high",
    bounds: {
      maxInputBytes: 32_768,
      maxOutputCharacters: 48_000,
      maxResultItems: 1,
    },
    evidencePolicy: {
      input: "required",
      output: "required",
      maxEvidenceRefs: 3,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "mutation_prepare",
    rateLimitBucket: "prepare",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: {
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    },
    idempotencyPolicy: {
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    },
    availability: { implementation: "available" },
    rolloutFlag:
      "agent_control_plane.capability.prepare_create_catalog_variant",
  } as const satisfies ImplementationOnlyCapabilityDefinition);

export const COMMIT_CATALOG_SETUP_WRITE_CAPABILITY_DEFINITION = Object.freeze({
  name: "commit_catalog_setup_write",
  schemaRevision: CATALOG_SETUP_WRITE_SCHEMA_REVISION,
  operation: "commit",
  writeFamily: "catalog_setup_write",
  description:
    "Commit one catalogue setup change approved inside OPS after current authority, effect-policy and family pre-image revalidation; the write runs as the approving operator and the receipt is an independent read-back of the row that landed.",
  inputSchema: CommitCatalogSetupWriteInputSchema,
  authorization: COMMIT_AUTHORIZATION,
  riskTier: "high",
  bounds: {
    maxInputBytes: 32_768,
    maxOutputCharacters: 8_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "prepared_change_set",
    output: "required",
    maxEvidenceRefs: 3,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "mutation_commit",
  rateLimitBucket: "commit",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: {
    kind: "confirmation_receipt",
    prepareCapability: "prepare_create_catalog_variant",
    exactPreviewRequired: true,
    singleUse: true,
  },
  idempotencyPolicy: {
    kind: "required",
    keyField: "idempotency_key",
    conflictOnArgumentsHashMismatch: true,
  },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.commit_catalog_setup_write",
} as const satisfies ImplementationOnlyCapabilityDefinition);

/** Prepare definitions in exposure order; a later kind appends here. */
export const CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS = Object.freeze([
  PREPARE_CREATE_CATALOG_VARIANT_CAPABILITY_DEFINITION,
  PREPARE_SET_VARIANT_THRESHOLDS_CAPABILITY_DEFINITION,
  PREPARE_SET_CATALOG_PRICING_CAPABILITY_DEFINITION,
  PREPARE_SET_SUPPLIER_COST_CAPABILITY_DEFINITION,
]);

export const CATALOG_SETUP_WRITE_DEFINITIONS = Object.freeze([
  ...CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS,
  COMMIT_CATALOG_SETUP_WRITE_CAPABILITY_DEFINITION,
]);
