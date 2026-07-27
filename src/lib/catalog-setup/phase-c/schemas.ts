import { z } from "zod";
import {
  GUIDED_CAPABILITY_REFS,
  GUIDED_QUESTION_INTENTS,
} from "./catalog-capability-manifest";

export const CatalogFactClassificationSchema = z.enum([
  "customer_product",
  "customer_option",
  "staff_only_choice",
  "quote_disclosure",
  "pricing_rule",
  "material_compatibility",
  "purchasing_rule",
  "inventory_rule",
  "labor_cost",
  "task_type_behavior",
  "specialized_tool_input",
]);

export const CatalogFactSourceKindSchema = z.enum([
  "live_ops",
  "operator",
  "upload",
  "verified_supplier",
  "company_knowledge",
  "calculation",
]);

export const CatalogFactSchema = z
  .object({
    id: z.string().min(1),
    classification: CatalogFactClassificationSchema,
    key: z.string().min(1),
    value: z.unknown(),
    source: z
      .object({
        kind: CatalogFactSourceKindSchema,
        reference: z.string().min(1).optional(),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
    status: z.enum(["confirmed", "unresolved", "contradicted"]),
    contradicts: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((fact, ctx) => {
    if (
      fact.source.kind === "company_knowledge" &&
      fact.status !== "unresolved"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Company knowledge facts must remain unresolved",
      });
    }
  });

export const GuidedQuestionSchema = z
  .object({
    id: z.string().min(1),
    intent: z.enum(GUIDED_QUESTION_INTENTS).optional(),
    capabilityRef: z.enum(GUIDED_CAPABILITY_REFS).optional(),
    prompt: z.string().min(1),
    answerKind: z.enum([
      "text",
      "number",
      "boolean",
      "single_choice",
      "multi_choice",
    ]),
    factKeys: z.array(z.string().min(1)).min(1),
    options: z.array(z.string().min(1)).min(1).optional(),
    help: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((question, ctx) => {
    const needsOptions =
      question.answerKind === "single_choice" ||
      question.answerKind === "multi_choice";
    if (needsOptions && !question.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Choice questions require options",
      });
    }
  });

export const GuidedConversationMessageSchema = z
  .object({
    id: z.string().min(1).max(240),
    role: z.enum(["assistant", "operator"]),
    kind: z.enum(["text", "source_document"]),
    content: z.string().min(1).max(8_000),
    version: z.number().int().nonnegative(),
    filename: z.string().min(1).max(255).optional(),
  })
  .strict();

export const GuidedConversationSchema = z
  .array(GuidedConversationMessageSchema)
  .max(200);

export const CatalogActionGroupSchema = z.enum([
  "CREATE",
  "REUSE",
  "UPDATE",
  "MERGE",
  "ARCHIVE",
  "NEEDS_INPUT",
]);

export const CatalogActionTypeSchema = z.enum([
  "upsert_product",
  "upsert_product_option",
  "upsert_product_option_value",
  "upsert_catalog_family",
  "upsert_catalog_option",
  "upsert_catalog_option_value",
  "upsert_catalog_variant",
  "replace_variant_option_values",
  "map_product_catalog_option",
  "upsert_product_material",
  "upsert_material_quantity_rule",
  "upsert_supplier_cost_profile",
  "upsert_capability_binding",
  "reuse_task_type",
  "create_task_type",
  "upsert_tax_rate",
  "move_catalog_variant",
  "archive_catalog_variant",
  "archive_catalog_option",
  "create_verification_item",
]);

export const CatalogActionSchema = z
  .object({
    actionKey: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9:_-]*$/),
    group: CatalogActionGroupSchema,
    actionType: CatalogActionTypeSchema,
    targetKind: z.string().min(1),
    existingId: z.string().uuid().optional(),
    clientId: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9:_-]*$/)
      .optional(),
    sourceFingerprint: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).default([]),
    payload: z.record(z.unknown()),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (!action.existingId && !action.clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientId"],
        message: "An action requires an existing UUID or a declared client ID",
      });
    }
  });

export const CatalogSetupIssueSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["blocker", "warning", "verification"]),
    actionKey: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .strict();

export const CatalogBlueprintSchema = z
  .object({
    version: z.literal(1),
    capabilityRevision: z.string().min(1).optional(),
    summary: z.string().min(1),
    ready: z.boolean(),
    actions: z.array(CatalogActionSchema),
    issues: z.array(CatalogSetupIssueSchema),
  })
  .strict()
  .superRefine((blueprint, ctx) => {
    const blocking = blueprint.issues.some(
      (issue) => issue.severity === "blocker"
    );
    if (blueprint.ready && blocking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ready"],
        message: "A blueprint with blockers cannot be ready",
      });
    }
  });

const QuestionTurnSchema = z
  .object({
    kind: z.literal("question"),
    facts: z.array(CatalogFactSchema),
    question: GuidedQuestionSchema,
  })
  .strict();

const ReviewTurnSchema = z
  .object({
    kind: z.literal("review"),
    facts: z.array(CatalogFactSchema),
    blueprint: CatalogBlueprintSchema,
  })
  .strict();

export const CatalogAgentTurnSchema = z.discriminatedUnion("kind", [
  QuestionTurnSchema,
  ReviewTurnSchema,
]);

export const GuidedSetupStatusSchema = z.enum([
  "interviewing",
  "review",
  "approved",
  "committing",
  "attention",
  "complete",
  "abandoned",
]);

export const GuidedSetupSessionDocumentSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    operatorId: z.string().uuid(),
    mode: z.literal("guided"),
    status: GuidedSetupStatusSchema,
    version: z.number().int().nonnegative(),
    facts: z.array(CatalogFactSchema),
    sources: z.array(z.record(z.unknown())),
    conversation: GuidedConversationSchema.default([]),
    unresolvedQuestions: z.array(GuidedQuestionSchema),
    contradictions: z.array(z.record(z.unknown())),
    liveSnapshot: z.record(z.unknown()),
    liveSnapshotHash: z.string().min(1),
    proposedPlan: CatalogBlueprintSchema.nullable(),
    proposedPlanHash: z.string().min(1).nullable(),
    validationIssues: z.array(CatalogSetupIssueSchema),
    approvalHash: z.string().min(1).nullable(),
    commitJournal: z.array(z.record(z.unknown())),
    readback: z.record(z.unknown()).nullable(),
  })
  .strict();
