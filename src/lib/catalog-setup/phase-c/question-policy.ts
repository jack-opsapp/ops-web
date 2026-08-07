import {
  guidedCapability,
  type GuidedCapabilityRef,
  type GuidedQuestionIntent,
} from "./catalog-capability-manifest";
import {
  GuidedQuestionDecisionSchema,
  GuidedQuestionContextSchema,
} from "./schemas";
import type { GuidedQuestion } from "./types";
import type { z } from "zod";

type GuidedQuestionContext = z.infer<
  typeof GuidedQuestionContextSchema
>;

type GuidedQuestionDecision = z.input<
  typeof GuidedQuestionDecisionSchema
>;

interface QuestionTemplate {
  capabilityRef: GuidedCapabilityRef;
  answerKind: GuidedQuestion["answerKind"];
  prompt(
    context: GuidedQuestionContext,
    factKeys: readonly string[],
  ): string;
  help?(context: GuidedQuestionContext): string;
  options?: readonly string[];
}

function label(
  value: string | undefined,
  fallback: string,
): string {
  const clean = value?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return clean || fallback;
}

function pricingPrompt(
  context: GuidedQuestionContext,
  factKeys: readonly string[],
): string {
  const product = label(context.productLabel, "this product");
  const missing = new Set(
    factKeys.map((factKey) =>
      factKey
        .normalize("NFKC")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLocaleLowerCase("en-CA"),
    ),
  );
  const needsBasePrice = [...missing].some((key) =>
    key.includes("base_price"),
  );
  const needsPricingUnit = [...missing].some((key) =>
    key.includes("pricing_unit"),
  );
  const needsMinimumCharge = [...missing].some((key) =>
    key.includes("minimum_charge"),
  );
  const missingCount = [
    needsBasePrice,
    needsPricingUnit,
    needsMinimumCharge,
  ].filter(Boolean).length;

  if (missingCount === 1 && needsBasePrice) {
    return `What base price should OPS use for ${product}?`;
  }
  if (missingCount === 1 && needsPricingUnit) {
    return `How should OPS price ${product}: each, hourly, by area, by length, or a flat price?`;
  }
  if (missingCount === 1 && needsMinimumCharge) {
    return `What minimum charge should OPS use for ${product}?`;
  }
  return `What base price, unit, and minimum charge should OPS use for ${product}?`;
}

const TEMPLATES: Record<GuidedQuestionIntent, QuestionTemplate> = {
  service_selection: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: () => "What service do you want to set up first?",
  },
  supplier_identity: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: (context) =>
      `Which manufacturer, supplier, or product line do you use for ${label(
        context.serviceLabel,
        "this service",
      )}?`,
    help: () =>
      "Use the name your staff recognizes. OPS will not assume supplier products or pricing.",
  },
  product_identity: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: (context) =>
      `What should customers see on quotes for ${label(
        context.serviceLabel,
        "this service",
      )}?`,
    help: () =>
      "Give the product or service name your customers will recognize.",
  },
  option_audience: {
    capabilityRef: "catalog-core/v1",
    answerKind: "single_choice",
    prompt: (context) =>
      `Who should choose ${label(
        context.optionLabel,
        "this option",
      )}?`,
    options: [
      "Customers choose it",
      "Staff choose it",
      "Customers choose, staff confirms",
    ],
  },
  option_values: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: (context) =>
      `Which fixed ${label(
        context.optionLabel,
        "option values",
      )} should be available for ${label(
        context.productLabel,
        "this product",
      )}?`,
    help: () =>
      "List only confirmed choices. Staff can keep unconfirmed details as notes.",
  },
  pricing: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: pricingPrompt,
    help: () =>
      "If the final price varies by job, give the normal starting price and what staff adjusts.",
  },
  quote_display: {
    capabilityRef: "catalog-core/v1",
    answerKind: "boolean",
    prompt: (context) =>
      `Should quotes show the pricing unit for ${label(
        context.productLabel,
        "this product",
      )}?`,
  },
  tax_treatment: {
    capabilityRef: "catalog-core/v1",
    answerKind: "boolean",
    prompt: (context) =>
      `Should tax apply to ${label(
        context.productLabel,
        "this product",
      )}?`,
    help: () => "OPS will use the company's default tax rate.",
  },
  storefront_visibility: {
    capabilityRef: "catalog-core/v1",
    answerKind: "boolean",
    prompt: (context) =>
      `Should ${label(
        context.productLabel,
        "this product",
      )} appear in the storefront?`,
  },
  task_type: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: (context) =>
      `Which task type should OPS use when ${label(
        context.productLabel,
        "this product",
      )} is sold?`,
  },
  material_tracking_scope: {
    capabilityRef: "static-product-materials/v1",
    answerKind: "single_choice",
    prompt: (context) =>
      `OPS does not track roll or sheet inventory yet. How should ${label(
        context.productLabel,
        "this product",
      )} be handled for now?`,
    help: () =>
      "Fixed quantities are supported. Roll tracking, offcuts, coverage calculations, and purchasing automation are not connected yet.",
    options: [
      "Keep purchasing and inventory staff-managed",
      "Add a fixed material quantity per product unit",
    ],
  },
  static_material_quantity: {
    capabilityRef: "static-product-materials/v1",
    answerKind: "text",
    prompt: (context) =>
      `For each unit of ${label(
        context.productLabel,
        "this product",
      )} sold, which fixed materials and quantities should OPS add?`,
    help: () =>
      "OPS can use fixed quantities here. Job geometry, waste calculations, and purchasing remain staff decisions.",
  },
  clarify_contradiction: {
    capabilityRef: "catalog-core/v1",
    answerKind: "text",
    prompt: (context) =>
      `Which answer should OPS use for ${label(
        context.productLabel,
        "this catalog item",
      )}?`,
    help: () =>
      "The earlier answers conflict. Confirm the current rule.",
  },
  review_readiness: {
    capabilityRef: "catalog-core/v1",
    answerKind: "boolean",
    prompt: () =>
      "Is this catalog setup ready for you to review?",
  },
};

export function resolveGuidedQuestion(
  input: GuidedQuestionDecision,
): GuidedQuestion | null {
  const parsed = GuidedQuestionDecisionSchema.safeParse(input);
  if (!parsed.success) return null;
  const decision = parsed.data;
  const template = TEMPLATES[decision.intent];
  const capability = guidedCapability(decision.capabilityRef);
  if (
    !template ||
    !capability?.available ||
    template.capabilityRef !== decision.capabilityRef ||
    !capability.questionIntents.includes(decision.intent)
  ) {
    return null;
  }

  const context = decision.context;
  const help = template.help?.(context);
  return {
    id: decision.id,
    intent: decision.intent,
    capabilityRef: decision.capabilityRef,
    ...(Object.keys(context).length > 0 ? { context } : {}),
    prompt: template.prompt(context, decision.factKeys),
    answerKind: template.answerKind,
    factKeys: decision.factKeys,
    ...(template.options
      ? { options: [...template.options] }
      : {}),
    ...(help ? { help } : {}),
  };
}
