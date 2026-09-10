/**
 * Google Ads account blueprint — the planner (spec §4.1).
 *
 * Pure: blueprint + entity snapshot → mutate operations in dependency order.
 * No network, no clock, no randomness, so the same pair always plans the same
 * operations and the tests can assert on them exactly.
 *
 * Two rules make re-running safe. It only ever creates or updates — nothing is
 * ever removed, so the legacy account stays queryable. And it diffs by name,
 * so a second apply against an account it already built plans nothing.
 *
 * Labels are attached only to entities that already exist in the snapshot. A
 * campaign created in this pass has no id yet, so its `engine` label lands on
 * the next pass — the apply route runs two passes with a snapshot refresh
 * between them. That is deliberate: it keeps every temporary resource name a
 * single simple segment and avoids composite `adGroupId~adId` temporary names.
 */
import type {
  Blueprint,
  BlueprintAdGroup,
  BlueprintCampaign,
  BlueprintNegative,
  BlueprintRsa,
} from "./blueprint";
import type { EntitySnapshot, SnapshotAd } from "./engine/types";

export interface MutateOperation {
  [service: `${string}Operation`]: Record<string, unknown>;
}

/**
 * Stages are Google's dependency order. Everything in stage N may reference
 * anything created in stages 1..N, and the apply sends them in this order in
 * one `googleAds:mutate` call.
 */
export const STAGES = {
  BUDGETS: 1,
  CAMPAIGNS: 2,
  CAMPAIGN_CRITERIA: 3,
  AD_GROUPS: 4,
  KEYWORDS: 5,
  ADS: 6,
  SHARED_SETS: 7,
  LABELS: 8,
} as const;

export type Stage = (typeof STAGES)[keyof typeof STAGES];

export interface PlannedOperation {
  stage: Stage;
  op: MutateOperation;
  /** The temporary resource name this operation creates, when it creates one. */
  temporaryId?: string;
  /** One line a person can read in the artifact without decoding JSON. */
  describe: string;
}

export type PlannerErrorCode =
  | "BROAD_MATCH_REJECTED"
  | "NEGATIVE_BLOCKS_KEYWORD"
  | "CUSTOMER_MISMATCH";

export class PlannerError extends Error {
  constructor(
    public readonly code: PlannerErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

// ─── Text helpers ────────────────────────────────────────────────────────────

const normalize = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

const tokens = (text: string): string[] =>
  normalize(text)
    .replace(/[^a-z0-9\s.']/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Would this negative stop that keyword from ever serving?
 *
 * Google does not apply close variants to negatives, so the comparison is
 * literal: BROAD blocks when every negative token appears somewhere in the
 * keyword, PHRASE when the tokens appear contiguously and in order, EXACT when
 * the whole keyword is the negative.
 */
export function negativeBlocks(
  negative: BlueprintNegative,
  keywordText: string
): boolean {
  const keyword = tokens(keywordText);
  const needle = tokens(negative.text);
  if (needle.length === 0) return false;
  if (negative.matchType === "EXACT")
    return keyword.join(" ") === needle.join(" ");
  if (negative.matchType === "PHRASE")
    return keyword.join(" ").includes(needle.join(" "));
  return needle.every((token) => keyword.includes(token));
}

const micros = (value: string): number => Number.parseInt(value, 10) / 1_000_000;

/** Temporary resource ids: one decreasing counter across the whole request. */
class TempIds {
  private next = -1;
  take(): number {
    const id = this.next;
    this.next -= 1;
    return id;
  }
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * The two structural refusals. Broad positive keywords are how a $50/day
 * account buys "signature generator" — the historical waste in this very
 * account. A negative that blocks a keyword the same campaign bids on is the
 * subtler failure: the money is committed, the ad can never serve, and nothing
 * in Google's interface says so.
 */
export function assertKeywordSafety(blueprint: Blueprint): void {
  const lists = new Map(
    blueprint.sharedNegativeLists.map((list) => [list.name, list])
  );
  for (const campaign of blueprint.campaigns) {
    const negatives: Array<{ negative: BlueprintNegative; from: string }> = [];
    for (const name of campaign.negativeLists)
      for (const negative of lists.get(name)?.keywords ?? [])
        negatives.push({ negative, from: name });
    for (const negative of campaign.campaignNegatives)
      negatives.push({ negative, from: `${campaign.name} campaign negatives` });

    for (const group of campaign.adGroups)
      for (const keyword of group.keywords) {
        if ((keyword.matchType as string) === "BROAD")
          throw new PlannerError(
            "BROAD_MATCH_REJECTED",
            `"${keyword.text}" in ${campaign.name} › ${group.name} is broad match. Positive keywords are exact or phrase only.`
          );
        for (const { negative, from } of negatives)
          if (negativeBlocks(negative, keyword.text))
            throw new PlannerError(
              "NEGATIVE_BLOCKS_KEYWORD",
              `"${negative.text}" [${negative.matchType}] in ${from} blocks "${keyword.text}" in ${campaign.name} › ${group.name}.`
            );
      }
  }
}

// ─── Snapshot lookups ────────────────────────────────────────────────────────

/** An ad's identity for diffing: its assets, order-independent, case-folded. */
function adFingerprint(
  headlines: Array<{ text: string }>,
  descriptions: Array<{ text: string }>
): string {
  const fold = (assets: Array<{ text: string }>) =>
    assets.map((a) => normalize(a.text)).sort().join("|");
  return `${fold(headlines)}//${fold(descriptions)}`;
}

function findSnapshotAd(
  snapshot: EntitySnapshot,
  adGroupResourceName: string,
  ad: BlueprintRsa
): SnapshotAd | undefined {
  const target = adFingerprint(ad.headlines, ad.descriptions);
  return snapshot.ads.find(
    (candidate) =>
      candidate.adGroupResourceName === adGroupResourceName &&
      adFingerprint(candidate.headlines, candidate.descriptions) === target
  );
}

// ─── The plan ────────────────────────────────────────────────────────────────

export function planBlueprint(
  blueprint: Blueprint,
  snapshot: EntitySnapshot
): PlannedOperation[] {
  assertKeywordSafety(blueprint);

  const customerId = blueprint.customerId;
  const temp = new TempIds();
  const planned: PlannedOperation[] = [];
  const push = (
    stage: Stage,
    describe: string,
    op: MutateOperation,
    temporaryId?: string
  ) => planned.push(temporaryId ? { stage, op, temporaryId, describe } : { stage, op, describe });

  // Labels resolve to a resource name; missing ones are created in stage 8
  // before any assignment references them.
  const labelResource = new Map(
    snapshot.labels.map((label) => [label.name, label.resourceName])
  );
  const labelCreates: PlannedOperation[] = [];
  const ensureLabel = (name: string): string => {
    const known = labelResource.get(name);
    if (known) return known;
    const resourceName = `customers/${customerId}/labels/${temp.take()}`;
    labelResource.set(name, resourceName);
    labelCreates.push({
      stage: STAGES.LABELS,
      op: { labelOperation: { create: { resourceName, name } } },
      temporaryId: resourceName,
      describe: `Create label "${name}"`,
    });
    return resourceName;
  };
  const labelAssignments: PlannedOperation[] = [];

  // ─── Shared negative lists (stage 7) ──────────────────────────────────────
  // Planned first so campaign attachments can reference the resource names,
  // then emitted at stage 7; ordering inside the returned array is by stage.
  const sharedSetResource = new Map<string, string>();
  const sharedSetOps: PlannedOperation[] = [];
  for (const list of blueprint.sharedNegativeLists) {
    const existing = snapshot.sharedSets.find((set) => set.name === list.name);
    const resourceName =
      existing?.resourceName ?? `customers/${customerId}/sharedSets/${temp.take()}`;
    sharedSetResource.set(list.name, resourceName);
    if (!existing)
      sharedSetOps.push({
        stage: STAGES.SHARED_SETS,
        op: {
          sharedSetOperation: {
            create: { resourceName, name: list.name, type: "NEGATIVE_KEYWORDS" },
          },
        },
        temporaryId: resourceName,
        describe: `Create shared negative list "${list.name}"`,
      });
    const present = new Set(
      (existing?.members ?? []).map(
        (member) => `${normalize(member.text)} ${member.matchType}`
      )
    );
    for (const keyword of list.keywords) {
      if (present.has(`${normalize(keyword.text)} ${keyword.matchType}`))
        continue;
      sharedSetOps.push({
        stage: STAGES.SHARED_SETS,
        op: {
          sharedCriterionOperation: {
            create: {
              sharedSet: resourceName,
              keyword: { text: keyword.text, matchType: keyword.matchType },
            },
          },
        },
        describe: `"${list.name}" += ${keyword.text} [${keyword.matchType}]`,
      });
    }
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────
  const blueprintNames = new Set(blueprint.campaigns.map((c) => c.name));

  for (const campaign of blueprint.campaigns) {
    const existing = snapshot.campaigns.find((c) => c.name === campaign.name);
    const campaignResource =
      existing?.resourceName ?? `customers/${customerId}/campaigns/${temp.take()}`;

    if (!existing) {
      const budgetResource = `customers/${customerId}/campaignBudgets/${temp.take()}`;
      push(
        STAGES.BUDGETS,
        `Create budget "${campaign.budget.name}" at $${micros(campaign.budget.amountMicros).toFixed(2)}/day`,
        {
          campaignBudgetOperation: {
            create: {
              resourceName: budgetResource,
              name: campaign.budget.name,
              amountMicros: campaign.budget.amountMicros,
              deliveryMethod: campaign.budget.deliveryMethod,
              explicitlyShared: false,
            },
          },
        },
        budgetResource
      );
      push(
        STAGES.CAMPAIGNS,
        `Create campaign "${campaign.name}" (PAUSED, ${campaign.bidding.type})`,
        {
          campaignOperation: {
            create: {
              resourceName: campaignResource,
              name: campaign.name,
              status: "PAUSED",
              advertisingChannelType: "SEARCH",
              campaignBudget: budgetResource,
              networkSettings: {
                targetGoogleSearch: campaign.network.targetGoogleSearch,
                targetSearchNetwork: campaign.network.targetSearchNetwork,
                targetContentNetwork: campaign.network.targetContentNetwork,
                targetPartnerSearchNetwork: false,
              },
              geoTargetTypeSetting: {
                positiveGeoTargetType: campaign.geo.positiveGeoTargetType,
                negativeGeoTargetType: "PRESENCE",
              },
              ...biddingFields(campaign),
            },
          },
        },
        campaignResource
      );
      for (const location of campaign.geo.locations)
        push(STAGES.CAMPAIGN_CRITERIA, `${campaign.name}: target ${location}`, {
          campaignCriterionOperation: {
            create: {
              campaign: campaignResource,
              location: { geoTargetConstant: location },
            },
          },
        });
      for (const language of campaign.languages)
        push(STAGES.CAMPAIGN_CRITERIA, `${campaign.name}: language ${language}`, {
          campaignCriterionOperation: {
            create: {
              campaign: campaignResource,
              language: { languageConstant: language },
            },
          },
        });
    } else {
      // Budget and bid ceiling are the only campaign fields the blueprint
      // owns after creation. Status is never touched here — the enable route
      // is the only path that changes it.
      const wanted = micros(campaign.budget.amountMicros);
      if (existing.budgetResourceName && existing.dailyBudget !== wanted)
        push(
          STAGES.BUDGETS,
          `"${campaign.name}" budget $${existing.dailyBudget ?? 0} → $${wanted.toFixed(2)}/day`,
          {
            campaignBudgetOperation: {
              update: {
                resourceName: existing.budgetResourceName,
                amountMicros: campaign.budget.amountMicros,
              },
              updateMask: "amountMicros",
            },
          }
        );
      const wantedCeiling = campaign.bidding.cpcBidCeilingMicros
        ? micros(campaign.bidding.cpcBidCeilingMicros)
        : null;
      if (
        campaign.bidding.type === "MAXIMIZE_CLICKS" &&
        wantedCeiling != null &&
        existing.cpcCeiling !== wantedCeiling
      )
        push(
          STAGES.CAMPAIGNS,
          `"${campaign.name}" CPC ceiling $${existing.cpcCeiling ?? 0} → $${wantedCeiling.toFixed(2)}`,
          {
            campaignOperation: {
              update: {
                resourceName: campaignResource,
                targetSpend: {
                  cpcBidCeilingMicros: campaign.bidding.cpcBidCeilingMicros,
                },
              },
              updateMask: "target_spend.cpc_bid_ceiling_micros",
            },
          }
        );
    }

    // Campaign-level negatives.
    const haveNegatives = new Set(
      snapshot.campaignNegatives
        .filter((n) => n.campaignResourceName === campaignResource)
        .map((n) => `${normalize(n.text)} ${n.matchType}`)
    );
    for (const negative of campaign.campaignNegatives) {
      if (haveNegatives.has(`${normalize(negative.text)} ${negative.matchType}`))
        continue;
      push(
        STAGES.CAMPAIGN_CRITERIA,
        `${campaign.name}: negative ${negative.text} [${negative.matchType}]`,
        {
          campaignCriterionOperation: {
            create: {
              campaign: campaignResource,
              negative: true,
              keyword: { text: negative.text, matchType: negative.matchType },
            },
          },
        }
      );
    }

    // Shared negative list attachments.
    for (const listName of campaign.negativeLists) {
      const setResource = sharedSetResource.get(listName);
      if (!setResource) continue;
      const attached = snapshot.sharedSets.find(
        (set) => set.name === listName
      )?.campaignResourceNames;
      if (attached?.includes(campaignResource)) continue;
      sharedSetOps.push({
        stage: STAGES.SHARED_SETS,
        op: {
          campaignSharedSetOperation: {
            create: { campaign: campaignResource, sharedSet: setResource },
          },
        },
        describe: `Attach "${listName}" to ${campaign.name}`,
      });
    }

    // The engine label, once the campaign is real.
    if (existing && !existing.labels.includes("engine"))
      labelAssignments.push({
        stage: STAGES.LABELS,
        op: {
          campaignLabelOperation: {
            create: { campaign: campaignResource, label: ensureLabel("engine") },
          },
        },
        describe: `Label "${campaign.name}" engine`,
      });

    // ─── Ad groups, keywords, ads ───────────────────────────────────────────
    for (const group of campaign.adGroups)
      planAdGroup({
        blueprintCampaign: campaign,
        group,
        campaignResource,
        snapshot,
        customerId,
        temp,
        push,
        ensureLabel,
        labelAssignments,
      });
  }

  // ─── Legacy labelling ─────────────────────────────────────────────────────
  for (const campaign of snapshot.campaigns) {
    if (blueprintNames.has(campaign.name)) continue;
    if (campaign.labels.includes("legacy")) continue;
    labelAssignments.push({
      stage: STAGES.LABELS,
      op: {
        campaignLabelOperation: {
          create: {
            campaign: campaign.resourceName,
            label: ensureLabel("legacy"),
          },
        },
      },
      describe: `Label "${campaign.name}" legacy`,
    });
  }

  planned.push(...sharedSetOps, ...labelCreates, ...labelAssignments);
  return planned.sort((a, b) => a.stage - b.stage);
}

function biddingFields(campaign: BlueprintCampaign): Record<string, unknown> {
  // v25 proto: Maximize Clicks is `target_spend`; there is no `maximize_clicks`
  // field on Campaign (google/ads/googleads/v25/resources/campaign.proto:1043).
  if (campaign.bidding.type === "MANUAL_CPC")
    return { manualCpc: { enhancedCpcEnabled: false } };
  return {
    targetSpend: campaign.bidding.cpcBidCeilingMicros
      ? { cpcBidCeilingMicros: campaign.bidding.cpcBidCeilingMicros }
      : {},
  };
}

interface AdGroupPlanArgs {
  blueprintCampaign: BlueprintCampaign;
  group: BlueprintAdGroup;
  campaignResource: string;
  snapshot: EntitySnapshot;
  customerId: string;
  temp: TempIds;
  push: (
    stage: Stage,
    describe: string,
    op: MutateOperation,
    temporaryId?: string
  ) => void;
  ensureLabel: (name: string) => string;
  labelAssignments: PlannedOperation[];
}

function planAdGroup({
  blueprintCampaign,
  group,
  campaignResource,
  snapshot,
  customerId,
  temp,
  push,
  ensureLabel,
  labelAssignments,
}: AdGroupPlanArgs): void {
  const existing = snapshot.adGroups.find(
    (candidate) =>
      candidate.campaignResourceName === campaignResource &&
      candidate.name === group.name
  );
  const adGroupResource =
    existing?.resourceName ?? `customers/${customerId}/adGroups/${temp.take()}`;

  if (!existing)
    push(
      STAGES.AD_GROUPS,
      `Create ad group "${blueprintCampaign.name} › ${group.name}" → ${group.finalUrl}`,
      {
        adGroupOperation: {
          create: {
            resourceName: adGroupResource,
            campaign: campaignResource,
            name: group.name,
            status: "ENABLED",
            type: "SEARCH_STANDARD",
            ...(group.cpcBidMicros ? { cpcBidMicros: group.cpcBidMicros } : {}),
          },
        },
      },
      adGroupResource
    );

  const haveKeywords = new Set(
    snapshot.keywords
      .filter((k) => k.adGroupResourceName === adGroupResource && !k.negative)
      .map((k) => `${normalize(k.text)} ${k.matchType}`)
  );
  for (const keyword of group.keywords) {
    if (haveKeywords.has(`${normalize(keyword.text)} ${keyword.matchType}`))
      continue;
    push(
      STAGES.KEYWORDS,
      `${group.name} += ${keyword.text} [${keyword.matchType}]`,
      {
        adGroupCriterionOperation: {
          create: {
            adGroup: adGroupResource,
            status: "ENABLED",
            keyword: { text: keyword.text, matchType: keyword.matchType },
          },
        },
      }
    );
  }

  for (const ad of group.ads) {
    const live = findSnapshotAd(snapshot, adGroupResource, ad);
    if (!live) {
      push(STAGES.ADS, `${group.name}: create ${ad.role} ad — ${ad.angle}`, {
        adGroupAdOperation: {
          create: {
            adGroup: adGroupResource,
            status: "ENABLED",
            ad: {
              finalUrls: [ad.finalUrl],
              responsiveSearchAd: {
                headlines: ad.headlines.map(asset),
                descriptions: ad.descriptions.map(asset),
                ...(ad.path1 ?? group.path1
                  ? { path1: ad.path1 ?? group.path1 }
                  : {}),
                ...(ad.path2 ?? group.path2
                  ? { path2: ad.path2 ?? group.path2 }
                  : {}),
              },
            },
          },
        },
      });
      continue;
    }
    // The ad exists: give it the labels the engine reads its role from.
    for (const name of ["engine", `role-${ad.role}`]) {
      if (live.labels.includes(name)) continue;
      labelAssignments.push({
        stage: STAGES.LABELS,
        op: {
          adGroupAdLabelOperation: {
            create: { adGroupAd: live.resourceName, label: ensureLabel(name) },
          },
        },
        describe: `Label ${group.name} ${ad.role} ad "${name}"`,
      });
    }
  }
}

function asset(a: { text: string; pinnedField?: string }): Record<string, unknown> {
  return a.pinnedField ? { text: a.text, pinnedField: a.pinnedField } : { text: a.text };
}

/** The operations, stage-ordered, as `mutateGoogleAds` wants them. */
export function toMutateOperations(plan: PlannedOperation[]): MutateOperation[] {
  return plan.map((entry) => entry.op);
}

/** A human-readable plan for the artifact and the runbook. */
export function describePlan(plan: PlannedOperation[]): string[] {
  return plan.map((entry) => `[${entry.stage}] ${entry.describe}`);
}
