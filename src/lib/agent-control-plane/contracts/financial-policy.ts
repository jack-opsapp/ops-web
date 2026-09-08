import { z } from "zod-v4";
import { PostgresUuidSchema } from "./postgres-uuid";

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s === s.trim());
const unique = (items: string[]) => new Set(items).size === items.length;
export const FinancialPolicyInputSchema = z.strictObject({
  revision: boundedText(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  source_document_id: z.uuid(),
  source_sha256: hash,
  expected_policy_sha256: hash.nullable(),
  currency_code: z.enum(["CAD", "USD"]),
  terms: boundedText(8000),
  permitted_price_sources: z
    .array(z.enum(["catalog", "historical_line", "operator"]))
    .min(1)
    .max(3)
    .refine(unique),
  permitted_units: z.array(boundedText(40)).min(1).max(100).refine(unique),
});
export const FinancialPolicyDecisionSchema = z.strictObject({
  action: z.literal("enroll"),
  preview_id: z.uuid(),
  preview_sha256: hash,
});
export const FinancialPolicyRequestSchema = z.union([
  z.strictObject({
    action: z.literal("preview"),
    policy: FinancialPolicyInputSchema,
  }),
  FinancialPolicyDecisionSchema,
  z.strictObject({
    action: z.literal("revoke"),
    policy_id: z.uuid(),
    policy_sha256: hash,
  }),
]);
export type FinancialPolicyInput = z.infer<typeof FinancialPolicyInputSchema>;
export const FinancialPolicySourceSchema = z.strictObject({
  id: z.uuid(),
  project_id: z.string(),
  author_id: z.string(),
  content: z.string().max(32000),
  sha256: hash,
});
export const FinancialPolicyPreviewSchema = z.strictObject({
  preview_id: z.uuid(),
  preview_sha256: hash,
  expires_at: z.iso.datetime({ offset: true }),
  operation: z.enum(["enroll", "revoke"]),
  company_id: z.uuid(),
  actor_user_id: z.uuid(),
  company_name: z.string(),
  operator_name: z.string(),
  policy: FinancialPolicyInputSchema,
  source: FinancialPolicySourceSchema,
  tax: z.strictObject({
    id: PostgresUuidSchema,
    name: z.string(),
    rate: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/),
  }),
  preparation_only: z.literal(true),
});
export const FinancialPolicyReceiptSchema = z.strictObject({
  operation: z.enum(["enroll", "revoke"]),
  preview_id: z.uuid(),
  policy_id: z.uuid(),
  policy_sha256: hash,
  revision: z.string(),
  source_sha256: hash,
  actor_user_id: z.uuid(),
  company_id: z.uuid(),
  preparation_only: z.literal(true),
  financial_documents_created: z.literal(0),
  completed_at: z.iso.datetime({ offset: true }),
  replayed: z.boolean(),
});
export const FinancialPolicyReadinessSchema = z.strictObject({
  company_id: z.uuid(),
  company_name: z.string(),
  actor_user_id: z.uuid(),
  operator_name: z.string(),
  currency_code: z.string().nullable(),
  policy: z
    .strictObject({
      id: z.uuid(),
      revision: z.string(),
      sha256: hash,
      status: z.enum(["active", "conflicting"]),
      source_document_id: z.uuid(),
    })
    .nullable(),
  source: FinancialPolicySourceSchema.nullable(),
  blockers: z.array(
    z.enum([
      "POLICY_MISSING",
      "POLICY_CONFLICTING",
      "SOURCE_STALE",
      "TAX_UNAVAILABLE",
      "CURRENCY_UNSUPPORTED",
      "EFFECT_REVIEW_REQUIRED",
    ])
  ),
  preparation_only: z.literal(true),
});
