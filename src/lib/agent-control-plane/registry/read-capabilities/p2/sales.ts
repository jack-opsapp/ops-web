import "server-only";

import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  GetSalesDocumentInputSchema,
  ListSalesDocumentsInputSchema,
  SALES_DOCUMENT_MAX_PAGE_ITEMS,
  SALES_DOCUMENT_SCHEMA_REVISION,
  type GetSalesDocumentInput,
  type ListSalesDocumentsInput,
  type SalesDocumentKind,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import type {
  CapabilityAuthorizationSelector,
  ImplementationOnlyCapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";
import { mintP2CandidateCapability } from "./candidate-policy";

export const SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS = Object.freeze([
  "estimate",
  "invoice",
] as const);
export type SalesDocumentAuthorizationVariantKey =
  (typeof SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS)[number];

function permission(
  permissionName: CapabilityPermissionRequirement["permission"],
  allowedScopes: readonly ("all" | "assigned" | "own")[]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: permissionName,
    allowedScopes: Object.freeze([...allowedScopes]),
  });
}

function pendingSelector(value: Readonly<Record<string, unknown>>) {
  return value as unknown as CapabilityAuthorizationSelector;
}

function documentPermissions(
  permissionName: "estimates.view" | "invoices.view"
) {
  return Object.freeze([
    Object.freeze([
      permission(permissionName, ["all", "assigned"]),
      permission("pipeline.view", ["all", "assigned"]),
    ]),
    Object.freeze([
      permission(permissionName, ["all", "assigned"]),
      permission("projects.view", ["all", "assigned"]),
      permission("projects.view_financials", ["all"]),
    ]),
    Object.freeze([permission(permissionName, ["all"])]),
  ]);
}

function variants(selector: "detail" | "list") {
  return [
    {
      key: "estimate",
      selector: pendingSelector(
        selector === "list"
          ? {
              kind: "input_array_contains",
              field: "document_kinds",
              value: "estimate",
            }
          : {
              kind: "input_object_discriminator",
              field: "document_ref",
              discriminator: "kind",
              value: "estimate",
            }
      ),
      requiredOAuthScopes: ["ops.financial_documents.read"],
      permissionRequirementGroups: documentPermissions("estimates.view"),
    },
    {
      key: "invoice",
      selector: pendingSelector(
        selector === "list"
          ? {
              kind: "input_array_contains",
              field: "document_kinds",
              value: "invoice",
            }
          : {
              kind: "input_object_discriminator",
              field: "document_ref",
              discriminator: "kind",
              value: "invoice",
            }
      ),
      requiredOAuthScopes: ["ops.financial_documents.read"],
      permissionRequirementGroups: documentPermissions("invoices.view"),
    },
  ] as const;
}

const LIST_DEFINITION = {
  name: "list_sales_documents",
  schemaRevision: SALES_DOCUMENT_SCHEMA_REVISION,
  operation: "read",
  description:
    "List bounded visible estimate and invoice headers with canonical money and exact job authority.",
  inputSchema: ListSalesDocumentsInputSchema,
  authorization: { variants: variants("list") },
  riskTier: "high",
  bounds: {
    maxInputBytes: 8_192,
    maxOutputCharacters: 60_000,
    maxResultItems: SALES_DOCUMENT_MAX_PAGE_ITEMS,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: SALES_DOCUMENT_MAX_PAGE_ITEMS,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
  rateLimitBucket: "evidence_search",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.list_sales_documents",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

const DETAIL_DEFINITION = {
  name: "get_sales_document",
  schemaRevision: SALES_DOCUMENT_SCHEMA_REVISION,
  operation: "read",
  description:
    "Return one visible estimate or invoice with safe ordered lines, client-facing text, and estimate milestones.",
  inputSchema: GetSalesDocumentInputSchema,
  authorization: { variants: variants("detail") },
  riskTier: "high",
  bounds: {
    maxInputBytes: 4_096,
    maxOutputCharacters: 60_000,
    maxResultItems: 1,
  },
  evidencePolicy: {
    input: "not_required",
    output: "required",
    maxEvidenceRefs: 1,
    promptSafeOutput: true,
    untrustedExternalContent: "structured_and_marked",
  },
  auditClass: "sensitive_read",
  rateLimitBucket: "lightweight_read",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  confirmationPolicy: { kind: "not_required" },
  idempotencyPolicy: { kind: "inherent" },
  availability: { implementation: "available" },
  rolloutFlag: "agent_control_plane.capability.get_sales_document",
} as const as unknown as ImplementationOnlyCapabilityDefinition;

export const LIST_SALES_DOCUMENTS_CANDIDATE =
  mintP2CandidateCapability(LIST_DEFINITION);
export const GET_SALES_DOCUMENT_CANDIDATE =
  mintP2CandidateCapability(DETAIL_DEFINITION);

function canonicalKinds(
  values: readonly SalesDocumentKind[]
): readonly SalesDocumentAuthorizationVariantKey[] {
  return Object.freeze(
    SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS.filter((kind) =>
      values.includes(kind)
    )
  );
}

export function selectedListSalesDocumentsVariantKeys(
  input: ListSalesDocumentsInput | unknown
): readonly SalesDocumentAuthorizationVariantKey[] {
  const parsed = ListSalesDocumentsInputSchema.parse(input);
  return canonicalKinds(parsed.document_kinds);
}

export function selectedGetSalesDocumentVariantKeys(
  input: GetSalesDocumentInput | unknown
): readonly SalesDocumentAuthorizationVariantKey[] {
  const parsed = GetSalesDocumentInputSchema.parse(input);
  return canonicalKinds([parsed.document_ref.kind]);
}
