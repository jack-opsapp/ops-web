/**
 * Google Ads engine — the entity snapshot, normalised.
 *
 * Phase 1 writes one `ads_entities` row per Google resource with the camelCase
 * resource JSON as `payload` and label names resolved into `labels`. This
 * mapper turns those rows into the engine's `EntitySnapshot`. The stable
 * contract is Google's resource shape, so the mapper reads the resource
 * fields directly and infers the entity type from the resource name — never
 * from a storage convention that might drift.
 */
import type {
  BiddingStrategy,
  CampaignKind,
  EntitySnapshot,
  EntityStatus,
  MatchType,
  PinnedField,
  RsaAsset,
  SnapshotAd,
  SnapshotAdGroup,
  SnapshotCampaign,
  SnapshotCampaignNegative,
  SnapshotKeyword,
  SnapshotLabel,
  SnapshotSharedSet,
} from "./types";

export interface EntityRow {
  resource_name: string;
  entity_type: string | null;
  parent_resource_name: string | null;
  name: string | null;
  status: string | null;
  payload: Record<string, unknown> | null;
  labels: string[] | null;
  snapshot_at: string | null;
}

type Kind =
  | "campaign"
  | "budget"
  | "ad_group"
  | "ad"
  | "keyword"
  | "campaign_negative"
  | "shared_set"
  | "shared_criterion"
  | "campaign_shared_set"
  | "label"
  | "other";

const COLLECTIONS: Record<string, Kind> = {
  campaigns: "campaign",
  campaignBudgets: "budget",
  adGroups: "ad_group",
  adGroupAds: "ad",
  adGroupCriteria: "keyword",
  campaignCriteria: "campaign_negative",
  sharedSets: "shared_set",
  sharedCriteria: "shared_criterion",
  campaignSharedSets: "campaign_shared_set",
  labels: "label",
};

const RESOURCE_KEYS: Record<Kind, string | null> = {
  campaign: "campaign",
  budget: "campaignBudget",
  ad_group: "adGroup",
  ad: "adGroupAd",
  keyword: "adGroupCriterion",
  campaign_negative: "campaignCriterion",
  shared_set: "sharedSet",
  shared_criterion: "sharedCriterion",
  campaign_shared_set: "campaignSharedSet",
  label: "label",
  other: null,
};

function kindOf(row: EntityRow): Kind {
  const collection = row.resource_name.split("/")[2];
  return COLLECTIONS[collection ?? ""] ?? "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The bare resource, whether the row stored it or the whole searchStream row. */
function resourceOf(row: EntityRow, kind: Kind): Record<string, unknown> {
  const payload = isRecord(row.payload) ? row.payload : {};
  const key = RESOURCE_KEYS[kind];
  if (key && isRecord(payload[key]) && !("resourceName" in payload && Object.keys(payload).length > 3))
    return payload[key] as Record<string, unknown>;
  return payload;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : null;
}

function micros(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
}

function statusOf(value: unknown): EntityStatus {
  return value === "ENABLED" || value === "PAUSED" || value === "REMOVED" ? value : "UNKNOWN";
}

function matchTypeOf(value: unknown): MatchType {
  return value === "EXACT" || value === "PHRASE" ? value : "BROAD";
}

function biddingOf(value: unknown): BiddingStrategy {
  switch (value) {
    // Google calls Maximize Clicks TARGET_SPEND, on the campaign field and in
    // the strategy enum alike (v25 campaign.proto:1043). MAXIMIZE_CLICKS is
    // accepted too so a hand-written fixture still reads.
    case "TARGET_SPEND":
      return "MAXIMIZE_CLICKS";
    case "MANUAL_CPC":
    case "MAXIMIZE_CLICKS":
    case "MAXIMIZE_CONVERSIONS":
    case "TARGET_CPA":
      return value;
    default:
      return "OTHER";
  }
}

const PINS: ReadonlySet<string> = new Set([
  "HEADLINE_1",
  "HEADLINE_2",
  "HEADLINE_3",
  "DESCRIPTION_1",
  "DESCRIPTION_2",
]);

function assetsOf(value: unknown): RsaAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: RsaAsset[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.text !== "string") continue;
    const pin = typeof entry.pinnedField === "string" && PINS.has(entry.pinnedField)
      ? (entry.pinnedField as PinnedField)
      : undefined;
    assets.push(pin ? { text: entry.text, pinnedField: pin } : { text: entry.text });
  }
  return assets;
}

/** Legacy label wins; otherwise the blueprint's name prefixes; otherwise other. */
export function campaignKindOf(name: string, labels: string[]): CampaignKind {
  if (labels.includes("legacy")) return "legacy";
  const upper = name.trim().toUpperCase();
  if (upper.startsWith("BRAND")) return "brand";
  if (upper.startsWith("CORE")) return "core";
  if (upper.startsWith("COMPETITOR")) return "competitor";
  return "other";
}

export function mapEntitySnapshot(rows: EntityRow[]): EntitySnapshot {
  const labelNames = new Map<string, string>();
  const labels: SnapshotLabel[] = [];
  for (const row of rows) {
    if (kindOf(row) !== "label") continue;
    const resource = resourceOf(row, "label");
    const name = str(resource.name) ?? row.name ?? "";
    labelNames.set(row.resource_name, name);
    labels.push({ resourceName: row.resource_name, name });
  }
  const resolveLabels = (row: EntityRow, resource: Record<string, unknown>): string[] => {
    const raw = [
      ...(Array.isArray(row.labels) ? row.labels : []),
      ...(Array.isArray(resource.labels) ? (resource.labels as unknown[]) : []),
    ];
    const names = new Set<string>();
    for (const value of raw) {
      if (typeof value !== "string") continue;
      names.add(labelNames.get(value) ?? value);
    }
    return [...names];
  };

  const budgets = new Map<string, number | null>();
  for (const row of rows) {
    if (kindOf(row) !== "budget") continue;
    budgets.set(row.resource_name, micros(resourceOf(row, "budget").amountMicros));
  }

  const campaigns: SnapshotCampaign[] = [];
  const adGroups: SnapshotAdGroup[] = [];
  const ads: SnapshotAd[] = [];
  const keywords: SnapshotKeyword[] = [];
  const campaignNegatives: SnapshotCampaignNegative[] = [];
  const sharedSets = new Map<string, SnapshotSharedSet>();
  const sharedMembers: Array<{ set: string; member: SnapshotSharedSet["members"][number] }> = [];
  const attachments: Array<{ set: string; campaign: string }> = [];
  let snapshotAt: string | null = null;

  for (const row of rows) {
    if (row.snapshot_at && (!snapshotAt || row.snapshot_at > snapshotAt)) snapshotAt = row.snapshot_at;
    const kind = kindOf(row);
    const resource = resourceOf(row, kind);
    switch (kind) {
      case "campaign": {
        const name = str(resource.name) ?? row.name ?? "";
        const campaignLabels = resolveLabels(row, resource);
        const strategy = biddingOf(resource.biddingStrategyType);
        // The bid ceiling lives on target_spend; maximizeClicks is read as a
        // fallback only because older fixtures spell it that way.
        const maximizeClicks = isRecord(resource.targetSpend)
          ? resource.targetSpend
          : isRecord(resource.maximizeClicks)
            ? resource.maximizeClicks
            : null;
        const targetCpa = isRecord(resource.targetCpa) ? resource.targetCpa : null;
        const maximizeConversions = isRecord(resource.maximizeConversions) ? resource.maximizeConversions : null;
        const budgetResourceName = str(resource.campaignBudget);
        campaigns.push({
          resourceName: row.resource_name,
          id: str(resource.id) ?? row.resource_name.split("/").pop() ?? "",
          name,
          status: statusOf(resource.status ?? row.status),
          labels: campaignLabels,
          kind: campaignKindOf(name, campaignLabels),
          budgetResourceName,
          dailyBudget: budgetResourceName ? (budgets.get(budgetResourceName) ?? null) : null,
          biddingStrategy: strategy,
          cpcCeiling: micros(maximizeClicks?.cpcBidCeilingMicros),
          targetCpa: micros(targetCpa?.targetCpaMicros ?? maximizeConversions?.targetCpaMicros),
        });
        break;
      }
      case "ad_group":
        adGroups.push({
          resourceName: row.resource_name,
          id: str(resource.id) ?? row.resource_name.split("/").pop() ?? "",
          name: str(resource.name) ?? row.name ?? "",
          campaignResourceName: str(resource.campaign) ?? row.parent_resource_name ?? "",
          status: statusOf(resource.status ?? row.status),
          labels: resolveLabels(row, resource),
          finalUrl: null,
        });
        break;
      case "ad": {
        const ad = isRecord(resource.ad) ? resource.ad : {};
        const rsa = isRecord(ad.responsiveSearchAd) ? ad.responsiveSearchAd : {};
        const policy = isRecord(resource.policySummary) ? resource.policySummary : {};
        const adLabels = resolveLabels(row, resource);
        ads.push({
          resourceName: row.resource_name,
          id: str(ad.id) ?? row.resource_name.split("~").pop() ?? "",
          adGroupResourceName: str(resource.adGroup) ?? row.parent_resource_name ?? "",
          status: statusOf(resource.status ?? row.status),
          labels: adLabels,
          role: adLabels.includes("role-control") ? "control" : adLabels.includes("role-challenger") ? "challenger" : null,
          approvalStatus: str(policy.approvalStatus),
          reviewStatus: str(policy.reviewStatus),
          finalUrls: Array.isArray(ad.finalUrls) ? ad.finalUrls.filter((u): u is string => typeof u === "string") : [],
          headlines: assetsOf(rsa.headlines),
          descriptions: assetsOf(rsa.descriptions),
          path1: str(rsa.path1),
          path2: str(rsa.path2),
        });
        break;
      }
      case "keyword": {
        const keyword = isRecord(resource.keyword) ? resource.keyword : null;
        if (!keyword) break;
        keywords.push({
          resourceName: row.resource_name,
          criterionId: str(resource.criterionId) ?? row.resource_name.split("~").pop() ?? "",
          adGroupResourceName: str(resource.adGroup) ?? row.parent_resource_name ?? "",
          text: str(keyword.text) ?? row.name ?? "",
          matchType: matchTypeOf(keyword.matchType),
          status: statusOf(resource.status ?? row.status),
          negative: resource.negative === true,
        });
        break;
      }
      case "campaign_negative": {
        const keyword = isRecord(resource.keyword) ? resource.keyword : null;
        if (!keyword || resource.negative !== true) break;
        campaignNegatives.push({
          resourceName: row.resource_name,
          campaignResourceName: str(resource.campaign) ?? row.parent_resource_name ?? "",
          text: str(keyword.text) ?? row.name ?? "",
          matchType: matchTypeOf(keyword.matchType),
        });
        break;
      }
      case "shared_set":
        sharedSets.set(row.resource_name, {
          resourceName: row.resource_name,
          id: str(resource.id) ?? row.resource_name.split("/").pop() ?? "",
          name: str(resource.name) ?? row.name ?? "",
          type: str(resource.type) ?? "NEGATIVE_KEYWORDS",
          members: [],
          campaignResourceNames: [],
        });
        break;
      case "shared_criterion": {
        const keyword = isRecord(resource.keyword) ? resource.keyword : null;
        if (!keyword) break;
        sharedMembers.push({
          set: str(resource.sharedSet) ?? row.parent_resource_name ?? "",
          member: {
            resourceName: row.resource_name,
            text: str(keyword.text) ?? row.name ?? "",
            matchType: matchTypeOf(keyword.matchType),
          },
        });
        break;
      }
      case "campaign_shared_set":
        attachments.push({
          set: str(resource.sharedSet) ?? "",
          campaign: str(resource.campaign) ?? row.parent_resource_name ?? "",
        });
        break;
      default:
        break;
    }
  }

  for (const { set, member } of sharedMembers) sharedSets.get(set)?.members.push(member);
  for (const { set, campaign } of attachments) {
    const target = sharedSets.get(set);
    if (target && campaign && !target.campaignResourceNames.includes(campaign))
      target.campaignResourceNames.push(campaign);
  }

  // An ad group's landing page is what its ads point at; enabled ads first.
  for (const adGroup of adGroups) {
    const own = ads.filter((ad) => ad.adGroupResourceName === adGroup.resourceName);
    const preferred = own.find((ad) => ad.status === "ENABLED" && ad.finalUrls.length > 0) ?? own.find((ad) => ad.finalUrls.length > 0);
    adGroup.finalUrl = preferred?.finalUrls[0] ?? null;
  }

  return {
    snapshotAt,
    campaigns,
    adGroups,
    ads,
    keywords,
    sharedSets: [...sharedSets.values()],
    campaignNegatives,
    labels,
  };
}
