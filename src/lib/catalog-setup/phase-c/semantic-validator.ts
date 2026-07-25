import type { CatalogAgentTurn, CatalogSetupIssue } from "./types";
import { CatalogAgentTurnSchema } from "./schemas";

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
  input: unknown,
): CatalogTurnValidationResult {
  const parsed = CatalogAgentTurnSchema.safeParse(input);
  if (!parsed.success) {
    return schemaFailure(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" · "),
    );
  }

  const turn = parsed.data;
  const issues: CatalogSetupIssue[] = [];
  if (turn.kind === "review") {
    const staffOnlyThickness = turn.facts.some(
      (fact) =>
        fact.status === "confirmed" &&
        fact.classification === "staff_only_choice" &&
        normalized(fact.key).includes("thickness") &&
        fact.value !== false,
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
        (field) => !Object.prototype.hasOwnProperty.call(action.payload, field),
      );
      const hasTaskType =
        Object.prototype.hasOwnProperty.call(action.payload, "taskTypeRef") ||
        Object.prototype.hasOwnProperty.call(action.payload, "taskTypeId") ||
        Object.prototype.hasOwnProperty.call(
          action.payload,
          "taskTypeClientId",
        );
      if (!hasTaskType) missing.push("taskTypeRef");
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
        .map((fact) => fact.key),
    );
    if (contradictedKeys.size > 0) {
      for (const action of turn.blueprint.actions) {
        const serialized = normalized(
          JSON.stringify({
            actionKey: action.actionKey,
            payload: action.payload,
          }),
        );
        const affected = [...contradictedKeys].filter((key) =>
          serialized.includes(normalized(key)),
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
