/**
 * Google Ads account blueprint — the declarative source of truth (spec §4.1).
 *
 * `config/ads/blueprint.json` describes the whole account: budgets, campaigns,
 * their targeting, the shared negative lists, every ad group, every keyword and
 * every responsive search ad. The planner (`blueprint-planner.ts`) diffs this
 * against the entity snapshot and emits mutate operations; nothing else is
 * allowed to change account structure. Editing Google by hand puts the account
 * out of sync with the file, and the next apply will not put it back — it only
 * ever adds and updates, never removes.
 *
 * Field names follow the v25 proto (`google/ads/googleads/v25/resources/campaign.proto`),
 * not the rendered docs: Maximize Clicks is `target_spend` / `targetSpend`, and
 * there is no `maximize_clicks` field on Campaign.
 */
import { z } from "zod";
import blueprintJson from "../../../config/ads/blueprint.json";
import type { RsaCandidate } from "./copy-rules";

/** Google's match types for the keywords we are allowed to buy. */
export const PositiveMatchType = z.enum(["EXACT", "PHRASE"]);
/** Negatives may be broad — that is the point of a negative. */
export const NegativeMatchType = z.enum(["EXACT", "PHRASE", "BROAD"]);

const HeadlinePin = z.enum(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"]);
const DescriptionPin = z.enum(["DESCRIPTION_1", "DESCRIPTION_2"]);

const AssetSchema = z
  .object({
    text: z.string().min(1),
    pinnedField: z.union([HeadlinePin, DescriptionPin]).optional(),
  })
  .strict();

export const RsaSchema = z
  .object({
    /** `control` is the incumbent; `challenger` is the ad the engine tests against it. */
    role: z.enum(["control", "challenger"]),
    /** One sentence naming the angle, so a later reader knows what was being tested. */
    angle: z.string().min(1),
    headlines: z.array(AssetSchema).min(1),
    descriptions: z.array(AssetSchema).min(1),
    path1: z.string().optional(),
    path2: z.string().optional(),
    finalUrl: z.string().url(),
  })
  .strict();

export const KeywordSchema = z
  .object({
    text: z.string().min(1),
    matchType: PositiveMatchType,
    /** Monthly searches measured by KeywordPlanIdeaService, when the seed was measured. */
    volume: z.number().int().nonnegative().optional(),
    /** Free-text provenance: which pull, which report, which research note. */
    source: z.string().optional(),
  })
  .strict();

export const NegativeSchema = z
  .object({ text: z.string().min(1), matchType: NegativeMatchType })
  .strict();

export const AdGroupSchema = z
  .object({
    name: z.string().min(1),
    finalUrl: z.string().url(),
    /** Written into every ad's display path; Google allows 15 characters each. */
    path1: z.string().max(15).optional(),
    path2: z.string().max(15).optional(),
    /**
     * The ad group's default bid. Only meaningful under MANUAL_CPC, where the
     * bid lives on the ad group rather than on a campaign-level ceiling.
     */
    cpcBidMicros: z.string().regex(/^\d+$/).optional(),
    keywords: z.array(KeywordSchema).min(1),
    ads: z.array(RsaSchema),
  })
  .strict();

export const BudgetSchema = z
  .object({
    name: z.string().min(1),
    amountMicros: z.string().regex(/^\d+$/),
    deliveryMethod: z.enum(["STANDARD", "ACCELERATED"]),
  })
  .strict();

export const BiddingSchema = z
  .object({
    type: z.enum(["MANUAL_CPC", "MAXIMIZE_CLICKS"]),
    cpcBidCeilingMicros: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

export const CampaignSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["brand", "core", "competitor"]),
    /** The schema itself refuses to describe an enabled campaign (spec §4, hard rule). */
    status: z.literal("PAUSED"),
    budget: BudgetSchema,
    bidding: BiddingSchema,
    network: z
      .object({
        targetGoogleSearch: z.boolean(),
        targetSearchNetwork: z.boolean(),
        targetContentNetwork: z.boolean(),
      })
      .strict(),
    geo: z
      .object({
        locations: z.array(z.string().min(1)).min(1),
        positiveGeoTargetType: z.enum([
          "PRESENCE",
          "PRESENCE_OR_INTEREST",
          "SEARCH_INTEREST",
        ]),
      })
      .strict(),
    languages: z.array(z.string().min(1)).min(1),
    /** Names of shared negative lists to attach; every name must exist in the file. */
    negativeLists: z.array(z.string().min(1)),
    /**
     * Negatives that vary per campaign. A shared set is atomic in Google's
     * model — you attach the whole list or none of it — so a term that must
     * apply to some campaigns and not others (`free`, `servicetitan`) lives
     * here rather than in a list with a per-campaign exclusion, which Google
     * cannot express.
     */
    campaignNegatives: z.array(NegativeSchema).default([]),
    adGroups: z.array(AdGroupSchema).min(1),
  })
  .strict();

export const SharedNegativeListSchema = z
  .object({
    name: z.string().min(1),
    /** Why the list exists, in one line — it ends up in the runbook. */
    purpose: z.string().min(1),
    keywords: z.array(NegativeSchema).min(1),
  })
  .strict();

export const BlueprintSchema = z
  .object({
    version: z.string().min(1),
    customerId: z.string().regex(/^\d{10}$/),
    currency: z.string().length(3),
    /** Where the demand numbers came from; cited, never assumed. */
    evidence: z.array(z.string()).default([]),
    sharedNegativeLists: z.array(SharedNegativeListSchema),
    labels: z.array(z.string().min(1)),
    campaigns: z.array(CampaignSchema).min(1),
  })
  .strict();

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type BlueprintCampaign = z.infer<typeof CampaignSchema>;
export type BlueprintAdGroup = z.infer<typeof AdGroupSchema>;
export type BlueprintRsa = z.infer<typeof RsaSchema>;
export type BlueprintNegative = z.infer<typeof NegativeSchema>;

/** The blueprint's ad shape as the copy rules want it. */
export function toRsaCandidate(ad: BlueprintRsa): RsaCandidate {
  return {
    headlines: ad.headlines,
    descriptions: ad.descriptions,
    ...(ad.path1 ? { path1: ad.path1 } : {}),
    ...(ad.path2 ? { path2: ad.path2 } : {}),
    finalUrl: ad.finalUrl,
  };
}

export class BlueprintError extends Error {
  constructor(
    public readonly code:
      | "BLUEPRINT_INVALID"
      | "UNKNOWN_NEGATIVE_LIST"
      | "DUPLICATE_CAMPAIGN"
      | "DUPLICATE_AD_GROUP"
      | "MISSING_CPC_CEILING",
    message: string
  ) {
    super(message);
    this.name = "BlueprintError";
  }
}

/**
 * Structural checks zod cannot express: names are unique, every referenced
 * negative list exists, and Maximize Clicks always carries a ceiling — an
 * uncapped Maximize Clicks campaign is how a $50/day account spends $50 on
 * four clicks.
 */
export function assertBlueprintCoherent(blueprint: Blueprint): void {
  const listNames = new Set(blueprint.sharedNegativeLists.map((l) => l.name));
  const seenCampaigns = new Set<string>();
  for (const campaign of blueprint.campaigns) {
    if (seenCampaigns.has(campaign.name))
      throw new BlueprintError(
        "DUPLICATE_CAMPAIGN",
        `Two campaigns are named "${campaign.name}".`
      );
    seenCampaigns.add(campaign.name);
    for (const list of campaign.negativeLists)
      if (!listNames.has(list))
        throw new BlueprintError(
          "UNKNOWN_NEGATIVE_LIST",
          `"${campaign.name}" attaches "${list}", which no sharedNegativeLists entry defines.`
        );
    if (
      campaign.bidding.type === "MAXIMIZE_CLICKS" &&
      !campaign.bidding.cpcBidCeilingMicros
    )
      throw new BlueprintError(
        "MISSING_CPC_CEILING",
        `"${campaign.name}" uses Maximize Clicks with no cpcBidCeilingMicros.`
      );
    const seenGroups = new Set<string>();
    for (const group of campaign.adGroups) {
      if (seenGroups.has(group.name))
        throw new BlueprintError(
          "DUPLICATE_AD_GROUP",
          `"${campaign.name}" has two ad groups named "${group.name}".`
        );
      seenGroups.add(group.name);
    }
  }
}

/** Parse and check an arbitrary object; throws `BlueprintError` on any failure. */
export function parseBlueprint(input: unknown): Blueprint {
  const parsed = BlueprintSchema.safeParse(input);
  if (!parsed.success)
    throw new BlueprintError(
      "BLUEPRINT_INVALID",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")
    );
  assertBlueprintCoherent(parsed.data);
  return parsed.data;
}

let cached: Blueprint | null = null;

/** The committed blueprint, parsed once. */
export function loadBlueprint(): Blueprint {
  if (!cached) cached = parseBlueprint(blueprintJson);
  return cached;
}

/** Every landing page the blueprint points at — the copy rules' URL allowlist. */
export function blueprintFinalUrls(blueprint: Blueprint): string[] {
  const urls = new Set<string>();
  for (const campaign of blueprint.campaigns)
    for (const group of campaign.adGroups) {
      urls.add(group.finalUrl);
      for (const ad of group.ads) urls.add(ad.finalUrl);
    }
  return [...urls].sort();
}
