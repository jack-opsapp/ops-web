import type { CatalogAgentTurn, CatalogSetupIssue } from "./types";
import { CatalogAgentTurnSchema } from "./schemas";
import {
  unresolvedCatalogActionReferences,
  validateCatalogActionPayload,
} from "./action-payload-contracts";
import {
  CATALOG_CAPABILITY_MANIFEST_REVISION,
  guidedCapability,
  guidedCapabilityForAction,
} from "./catalog-capability-manifest";

export interface CatalogTurnValidationResult {
  success: boolean;
  turn: CatalogAgentTurn | null;
  issues: CatalogSetupIssue[];
}

const REQUIRED_PRODUCT_FIELDS = [
  "name",
  "basePrice",
  "pricingUnit",
  "minimumCharge",
  "isTaxable",
  "showInStorefront",
  "type",
  "kind",
  "taskTypeClientId",
  "linkedFamilyRef",
] as const;

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-CA");
}

function schemaFailure(message: string): CatalogTurnValidationResult {
  return {
    success: false,
    turn: null,
    issues: [
      {
        code: "invalid_agent_turn",
        severity: "blocker",
        message,
      },
    ],
  };
}

export function validateCatalogAgentTurn(
  input: unknown
): CatalogTurnValidationResult {
  const parsed = CatalogAgentTurnSchema.safeParse(input);
  if (!parsed.success) {
    return schemaFailure(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" · ")
    );
  }

  const turn = parsed.data;
  const issues: CatalogSetupIssue[] = [];
  if (turn.kind === "question") {
    const capability = turn.question.capabilityRef
      ? guidedCapability(turn.question.capabilityRef)
      : null;
    if (!turn.question.intent || !turn.question.capabilityRef) {
      issues.push({
        code: "capability_contract_missing",
        severity: "blocker",
        message:
          "Phase C questions require a released capability contract.",
      });
    } else if (
      !capability?.available ||
      !capability.questionIntents.includes(turn.question.intent)
    ) {
      issues.push({
        code: "capability_unavailable",
        severity: "blocker",
        message:
          "Phase C cannot ask about behavior OPS does not execute.",
      });
    }
  }
  if (turn.kind === "review") {
    if (
      turn.blueprint.capabilityRevision !==
      CATALOG_CAPABILITY_MANIFEST_REVISION
    ) {
      issues.push({
        code: "capability_manifest_changed",
        severity: "blocker",
        message:
          "OPS capabilities changed. Generate a new review before building the catalog.",
      });
    }
    for (const action of turn.blueprint.actions) {
      const capability = guidedCapabilityForAction(action.actionType);
      if (!capability?.available) {
        issues.push({
          code: "capability_unavailable",
          severity: "blocker",
          actionKey: action.actionKey,
          message:
            "This action describes behavior no released OPS client executes.",
        });
        continue;
      }
      const payloadValidation = validateCatalogActionPayload(
        action.actionType,
        action.payload,
      );
      if (!payloadValidation.success) {
        issues.push({
          code: "unsupported_action_payload",
          severity: "blocker",
          actionKey: action.actionKey,
          message: `This action includes settings OPS cannot apply: ${payloadValidation.unsupportedFields.join(", ")}.`,
        });
      }
    }
    for (const referenceIssue of unresolvedCatalogActionReferences(
      turn.blueprint.actions,
    )) {
      issues.push({
        code: "unresolved_action_reference",
        severity: "blocker",
        actionKey: referenceIssue.actionKey,
        message: `This action references ${referenceIssue.field}=${referenceIssue.reference}, which the plan does not define.`,
      });
    }
    const unconfirmedCompanyKnowledge = turn.facts.filter(
      (fact) =>
        fact.source.kind === "company_knowledge" && fact.status === "unresolved"
    );
    if (unconfirmedCompanyKnowledge.length > 0) {
      issues.push({
        code: "company_knowledge_unconfirmed",
        severity: "blocker",
        message: "Confirm company knowledge before review.",
      });
    }

    const staffOnlyThickness = turn.facts.some(
      (fact) =>
        fact.status === "confirmed" &&
        fact.classification === "staff_only_choice" &&
        normalized(fact.key).includes("thickness") &&
        fact.value !== false
    );
    if (staffOnlyThickness) {
      for (const action of turn.blueprint.actions) {
        if (
          action.actionType === "upsert_product_option" &&
          normalized(action.payload.name) === "thickness"
        ) {
          issues.push({
            code: "staff_choice_exposed",
            severity: "blocker",
            actionKey: action.actionKey,
            message:
              "Thickness is staff-only and cannot be emitted as a customer product option.",
          });
        }
      }
    }

    for (const action of turn.blueprint.actions) {
      if (action.actionType !== "upsert_product") continue;
      const missing: string[] = REQUIRED_PRODUCT_FIELDS.filter(
        (field) => !Object.prototype.hasOwnProperty.call(action.payload, field)
      );
      if (missing.length > 0) {
        issues.push({
          code: "incomplete_product_plan",
          severity: "blocker",
          actionKey: action.actionKey,
          message: `Product plan is missing: ${missing.join(", ")}.`,
        });
      }
    }

    const contradictedKeys = new Set(
      turn.facts
        .filter((fact) => fact.status === "contradicted")
        .map((fact) => fact.key)
    );
    if (contradictedKeys.size > 0) {
      for (const action of turn.blueprint.actions) {
        const serialized = normalized(
          JSON.stringify({
            actionKey: action.actionKey,
            payload: action.payload,
          })
        );
        const affected = [...contradictedKeys].filter((key) =>
          serialized.includes(normalized(key))
        );
        if (affected.length > 0) {
          issues.push({
            code: "contradicted_fact",
            severity: "blocker",
            actionKey: action.actionKey,
            message: `Resolve the conflicting fact before this action: ${affected.join(", ")}.`,
          });
        }
      }
    }
  }

  return {
    success: issues.length === 0,
    turn,
    issues,
  };
}
