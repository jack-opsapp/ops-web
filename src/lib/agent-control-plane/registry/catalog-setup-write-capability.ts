import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CATALOG_SETUP_WRITE_SCHEMA_REVISION,
  CommitCatalogSetupWriteInputSchema,
  PrepareCreateCatalogVariantInputSchema,
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
]);

export const CATALOG_SETUP_WRITE_DEFINITIONS = Object.freeze([
  ...CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS,
  COMMIT_CATALOG_SETUP_WRITE_CAPABILITY_DEFINITION,
]);
