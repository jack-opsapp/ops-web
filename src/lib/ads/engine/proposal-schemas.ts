/**
 * Google Ads engine — the shape of every proposal the routine may file.
 *
 * Strict Zod per kind. A shape failure is `SCHEMA_INVALID` with the offending
 * path; everything semantic (does the entity exist, is the change within the
 * caps) lives in validate-proposal.ts.
 */
import { z } from "zod";
import { PROPOSAL_KINDS } from "./types";

const resource = (collection: string) =>
  z
    .string()
    .regex(
      new RegExp(`^customers/\\d+/${collection}/\\d+(?:~\\d+)?$`),
      `must be a Google resource name under ${collection}`
    );

const matchType = z.enum(["BROAD", "PHRASE", "EXACT"]);
const keywordTerm = z
  .object({
    text: z.string().trim().min(1).max(80),
    matchType: matchType.default("PHRASE"),
  })
  .strict();

const rsaAsset = z
  .object({
    text: z.string().min(1).max(90),
    pinnedField: z
      .enum(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3", "DESCRIPTION_1", "DESCRIPTION_2"])
      .optional(),
  })
  .strict();

const rsaFields = {
  headlines: z.array(rsaAsset).min(1).max(15),
  descriptions: z.array(rsaAsset).min(1).max(6),
  path1: z.string().max(30).optional(),
  path2: z.string().max(30).optional(),
  final_url: z.string().url().max(500),
};

export const rsaSchema = z.object(rsaFields).strict();
export type RsaPayload = z.infer<typeof rsaSchema>;

export const payloadSchemas = {
  add_negatives: z
    .object({
      list: z.string().trim().min(1).max(120),
      classification: z.enum([
        "job_seeker",
        "homeowner",
        "student",
        "wrong_segment",
        "irrelevant",
      ]),
      terms: z.array(keywordTerm).min(1).max(50),
    })
    .strict(),
  pause_keyword: z.object({ criterion: resource("adGroupCriteria") }).strict(),
  add_keywords: z
    .object({
      ad_group: resource("adGroups"),
      terms: z.array(keywordTerm).min(1).max(20),
    })
    .strict(),
  create_rsa_challenger: z
    .object({
      ad_group: resource("adGroups"),
      hypothesis: z.string().trim().min(1).max(300),
      ...rsaFields,
    })
    .strict(),
  promote_challenger: z.object({ test_id: z.string().uuid() }).strict(),
  pause_ad: z
    .object({
      ad: resource("adGroupAds"),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  adjust_budget: z
    .object({
      campaign: resource("campaigns"),
      new_daily_amount: z.number().positive().max(10_000),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  adjust_cpc_cap: z
    .object({
      campaign: resource("campaigns"),
      new_cpc_cap: z.number().positive().max(200),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  set_bidding_strategy: z
    .object({
      campaign: resource("campaigns"),
      strategy: z.enum(["MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA"]),
      target_cpa: z.number().positive().max(5_000).optional(),
    })
    .strict(),
  add_ad_group: z
    .object({
      campaign: resource("campaigns"),
      name: z.string().trim().min(2).max(80),
      theme: z.string().trim().min(2).max(80),
      final_url: z.string().url().max(500),
      keywords: z.array(keywordTerm).min(3).max(20),
      ads: z.array(rsaSchema).min(1).max(2),
    })
    .strict(),
  observation: z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
} as const;

export type PayloadFor<K extends keyof typeof payloadSchemas> = z.infer<
  (typeof payloadSchemas)[K]
>;

const evidenceValue = z.union([
  z.string().max(400),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const envelopeSchema = z
  .object({
    kind: z.enum(PROPOSAL_KINDS),
    rationale: z.string().max(1200).default(""),
    evidence: z.array(z.record(evidenceValue)).max(60).default([]),
    payload: z.unknown(),
  })
  .strict();

export type ProposalEnvelope = z.infer<typeof envelopeSchema>;

export function issuesOf(error: z.ZodError, prefix = ""): Array<{
  code: string;
  field: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    code: "SCHEMA_INVALID",
    field: [prefix, issue.path.join(".")].filter(Boolean).join("."),
    message: issue.message,
  }));
}
