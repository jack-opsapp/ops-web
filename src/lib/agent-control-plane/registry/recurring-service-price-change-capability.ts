import type { CapabilityPermissionRequirement } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  PrepareRecurringServicePriceChangeInputSchema,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_ACCOUNTS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS,
  RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS,
  RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/recurring-service-price-change";
import type { ImplementationOnlyCapabilityDefinition } from "./capability-types";

function permission(
  name: CapabilityPermissionRequirement["permission"]
): CapabilityPermissionRequirement {
  return Object.freeze({
    permission: name,
    allowedScopes: Object.freeze(["all"] as const),
  });
}

export const PREPARE_RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_DEFINITION =
  Object.freeze({
    name: "prepare_recurring_service_price_change",
    schemaRevision: RECURRING_SERVICE_PRICE_CHANGE_SCHEMA_REVISION,
    operation: "prepare",
    writeFamily: "recurring_service_price_change",
    description:
      "Prepare an exact recurring-service price-change package for one service, percentage, and effective month. Returns account inclusions, exclusions, current and proposed prices, notice drafts, and evidence-backed churn risk. Sends nothing, persists no preview or business content, and changes no price, contract, invoice, or service. Ordinary transport audit and rate-limit metadata is still recorded.",
    inputSchema: PrepareRecurringServicePriceChangeInputSchema,
    authorization: {
      variants: [
        {
          key: "owner_recurring_service_price_change",
          selector: { kind: "always" },
          requiredOAuthScopes: [
            "ops.catalog.read",
            "ops.company.read",
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.financial_documents.read",
            "ops.operations.prepare",
            "ops.schedule.read",
          ],
          permissionRequirementGroups: [
            [
              permission("calendar.view"),
              permission("catalog.products.view"),
              permission("catalog.view"),
              permission("clients.view"),
              permission("email.view"),
              permission("estimates.view"),
              permission("invoices.view"),
              permission("settings.company"),
            ],
          ],
        },
      ],
    },
    riskTier: "high",
    bounds: {
      maxInputBytes: 1_024,
      maxOutputCharacters: RECURRING_SERVICE_PRICE_CHANGE_MAX_OUTPUT_CHARACTERS,
      maxResultItems: RECURRING_SERVICE_PRICE_CHANGE_MAX_ACCOUNTS,
      maxBatchItems: RECURRING_SERVICE_PRICE_CHANGE_MAX_ACCOUNTS,
    },
    evidencePolicy: {
      input: "not_required",
      output: "required",
      maxEvidenceRefs: RECURRING_SERVICE_PRICE_CHANGE_MAX_EVIDENCE_REFS,
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
    idempotencyPolicy: { kind: "inherent" },
    availability: { implementation: "available" },
    rolloutFlag:
      "agent_control_plane.capability.prepare_recurring_service_price_change",
  } as const satisfies ImplementationOnlyCapabilityDefinition);
