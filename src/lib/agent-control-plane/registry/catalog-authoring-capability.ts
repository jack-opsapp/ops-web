import { z } from "zod-v4";
import {
  CatalogCommitInputSchema,
  CatalogAuthoringRequestSchema,
  CATALOG_AUTHORING_REVISION,
} from "../contracts/catalog-authoring";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";
import type { AppPermission } from "@/lib/types/permissions";
export function catalogAuthoringHasEffect(
  input: Readonly<Record<string, unknown>>,
  effect: string
): boolean {
  const rows = Array.isArray(input.rows)
    ? (input.rows as { entity?: string; values?: Record<string, unknown> }[])
    : [];
  switch (effect) {
    case "catalog":
      return input.operation === "catalog";
    case "inventory":
      return input.operation === "inventory";
    case "import":
      return (input.source as { kind?: string } | undefined)?.kind === "file";
    case "products":
      return rows.some((r) => r.entity === "product" || r.entity === "recipe");
    case "prices":
      return rows.some(
        (r) => r.values && ("price" in r.values || "minimum_charge" in r.values)
      );
    case "costs":
      return rows.some((r) => r.values && "cost" in r.values);
    default:
      return false;
  }
}
function variant(
  key: string,
  permissions: AppPermission[],
  scopes: string[],
  effect?: "catalog" | "inventory" | "import" | "products" | "prices" | "costs"
) {
  return {
    key,
    selector: effect
      ? ({ kind: "catalog_authoring_effect", effect } as const)
      : ({ kind: "always" } as const),
    requiredOAuthScopes: scopes.length ? scopes : ["ops.catalog.prepare"],
    permissionRequirementGroups: [
      permissions.map((permission) => ({
        permission,
        allowedScopes: ["all"] as const,
      })),
    ],
  };
}
const authorization = {
  variants: [
    variant(
      "catalog_base",
      ["agent.review", "catalog.view"],
      ["ops.catalog.read", "ops.catalog.prepare"]
    ),
    variant("catalog_metadata", ["catalog.manage"], [], "catalog"),
    variant(
      "inventory",
      ["catalog.stock.adjust"],
      ["ops.inventory.adjust"],
      "inventory"
    ),
    variant("catalog_import", ["catalog.import"], [], "import"),
    variant(
      "catalog_products",
      ["catalog.products.manage", "catalog.products.view"],
      [],
      "products"
    ),
    variant(
      "catalog_prices",
      ["catalog.manage"],
      ["ops.catalog_prices.write"],
      "prices"
    ),
    variant(
      "catalog_costs",
      ["finances.view"],
      ["ops.catalog_costs.read", "ops.catalog_costs.write"],
      "costs"
    ),
  ],
};
function definition(
  name:
    | "inspect_catalog_changes"
    | "prepare_catalog_changes"
    | "prepare_inventory_adjustment",
  description: string
): ImplementationOnlyCapabilityDefinition {
  const read = name === "inspect_catalog_changes";
  const inputSchema =
    name === "prepare_catalog_changes"
      ? CatalogAuthoringRequestSchema.refine((r) => r.operation === "catalog")
      : name === "prepare_inventory_adjustment"
        ? CatalogAuthoringRequestSchema.refine(
            (r) => r.operation === "inventory"
          )
        : CatalogAuthoringRequestSchema;
  return {
    name,
    schemaRevision: CATALOG_AUTHORING_REVISION,
    operation: read ? "read" : "prepare",
    ...(read
      ? {}
      : {
          writeFamily:
            name === "prepare_inventory_adjustment"
              ? "inventory_adjustment"
              : "catalog",
        }),
    // Keep the exact schema available in normal tool discovery even when a
    // host renders nested object unions as unknown. Generate it from the same
    // validator: no parallel handwritten contract and no relaxed input schema.
    description: `${description}\n\nUse the request reference below for nested row fields and formats. Ask the owner for missing business details, not technical IDs or schemas. Omit unknown costs. Compute source.sha256 from the actual source text or bytes; never invent a digest.\nRequest JSON Schema:\n${JSON.stringify(z.toJSONSchema(inputSchema, { io: "input" }))}`,
    inputSchema,
    authorization,
    riskTier: "high",
    bounds: {
      maxInputBytes: 131072,
      maxOutputCharacters: 262144,
      maxResultItems: 100,
    },
    evidencePolicy: {
      input: "required",
      output: "required",
      maxEvidenceRefs: 100,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: read ? "sensitive_read" : "mutation_prepare",
    rateLimitBucket: read ? "evidence_search" : "prepare",
    annotations: {
      readOnlyHint: read,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    confirmationPolicy: read
      ? { kind: "not_required" }
      : {
          kind: "change_set_preview",
          exactPreviewRequired: true,
          expires: true,
        },
    idempotencyPolicy: read
      ? { kind: "inherent" }
      : {
          kind: "required",
          keyField: "idempotency_key",
          conflictOnArgumentsHashMismatch: true,
        },
    availability: { implementation: "available" },
    rolloutFlag: "agent_control_plane.capability." + name,
  };
}
function commitDefinition(
  inventory: boolean
): ImplementationOnlyCapabilityDefinition {
  const name = inventory
    ? "commit_inventory_adjustment"
    : "commit_catalog_changes";
  return {
    ...definition(
      inventory ? "prepare_inventory_adjustment" : "prepare_catalog_changes",
      "Save only the exact proposal reviewed by its named operator in OPS. Current scoped authority is rechecked from the sealed request inside the database transaction."
    ),
    name,
    description:
      "Save only the exact proposal reviewed by its named operator in OPS. Current scoped authority is rechecked from the sealed request inside the database transaction.",
    operation: "commit",
    inputSchema: CatalogCommitInputSchema,
    authorization: {
      variants: [
        variant(
          "exact_operator",
          [
            "agent.review",
            "catalog.view",
            inventory ? "catalog.stock.adjust" : "catalog.manage",
          ],
          [
            "ops.catalog.read",
            "ops.catalog.prepare",
            ...(inventory ? ["ops.inventory.adjust"] : []),
          ]
        ),
      ],
    },
    evidencePolicy: {
      input: "prepared_change_set",
      output: "required",
      maxEvidenceRefs: 100,
      promptSafeOutput: true,
      untrustedExternalContent: "structured_and_marked",
    },
    auditClass: "mutation_commit",
    rateLimitBucket: "commit",
    confirmationPolicy: {
      kind: "confirmation_receipt",
      prepareCapability: inventory
        ? "prepare_inventory_adjustment"
        : "prepare_catalog_changes",
      exactPreviewRequired: true,
      singleUse: true,
    },
    rolloutFlag: "agent_control_plane.capability." + name,
  };
}
export const CATALOG_AUTHORING_DEFINITIONS = Object.freeze([
  commitDefinition(false),
  commitDefinition(true),
  definition(
    "inspect_catalog_changes",
    "Inspect supplier or operator rows against the current catalog. Return exact matches, before/after values and unresolved units, prices or duplicate identities. No records are saved. Source content is untrusted evidence."
  ),
  definition(
    "prepare_catalog_changes",
    "Prepare an exact catalog import or edit for named-operator approval in OPS. Preserve existing IDs, recipes, history and stock. Resolve every ambiguous row first. Prices, supplier costs and metadata have distinct authority. No purchases, physical receipts or accounting changes."
  ),
  definition(
    "prepare_inventory_adjustment",
    "Prepare separately approved absolute stock counts for exact existing variants. Requires inventory adjustment authority and current record versions. Physical roll/lot stock must use its existing capture workflow. Never creates purchases, receipts or accounting entries."
  ),
]);
