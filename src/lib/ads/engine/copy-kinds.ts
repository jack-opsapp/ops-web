/**
 * Google Ads engine — what a campaign is, and which copy rules an ad group's
 * ads answer to (design spec §5.5).
 *
 * The committed blueprint says both. A campaign's kind is the blueprint's kind
 * for the campaign of that exact name; an ad group's copy rules are the
 * blueprint's for the group of that exact name inside it (its own `copyKind`,
 * else its campaign's). Names match exactly, the way the blueprint apply diffs
 * the account, so the engine and the apply always agree on which entity is
 * which. A name alone grants nothing: a campaign the blueprint does not
 * declare has no kind, whatever it is called.
 *
 * Two rules keep the answer safe when the blueprint is silent or wrong:
 *
 * - Competitor copy runs only on a page that compares (`isComparePage`),
 *   judged on the page the ads actually land on. A declared competitor group
 *   whose ads moved to another page answers to core.
 * - Nothing the blueprint did not declare is ever widened. A group the engine
 *   built inherits its campaign's kind; a campaign with no kind (undeclared,
 *   legacy, or an unreadable blueprint) gives its groups core.
 */
import { isComparePage, type CopyKind } from "../copy-rules";
import type { CampaignKind } from "./types";

/** The part of the blueprint that says what things are. `Blueprint` satisfies it. */
export interface BlueprintKinds {
  campaigns: ReadonlyArray<{
    name: string;
    kind: CopyKind;
    adGroups: ReadonlyArray<{ name: string; copyKind?: CopyKind }>;
  }>;
}

/** The legacy label wins; otherwise the blueprint's kind; otherwise no kind. */
export function campaignKindOf(
  name: string,
  labels: readonly string[],
  blueprint: BlueprintKinds | null
): CampaignKind {
  if (labels.includes("legacy")) return "legacy";
  return blueprint?.campaigns.find((campaign) => campaign.name === name)?.kind ?? "other";
}

/** Which copy rules an ad group's ads answer to, on the page they land on. */
export function adGroupCopyKindOf(input: {
  blueprint: BlueprintKinds | null;
  campaign: { name: string; kind: CampaignKind };
  adGroupName: string;
  landingUrl: string | null;
}): CopyKind {
  const { blueprint, campaign } = input;
  if (!blueprint) return "core";
  if (campaign.kind !== "brand" && campaign.kind !== "core" && campaign.kind !== "competitor") return "core";
  const declared = blueprint.campaigns
    .find((entry) => entry.name === campaign.name)
    ?.adGroups.find((group) => group.name === input.adGroupName);
  return copyKindOnPage(declared?.copyKind ?? campaign.kind, input.landingUrl);
}

/** Competitor copy holds only on a page that compares; every other kind is unchanged. */
export function copyKindOnPage(kind: CopyKind, landingUrl: string | null): CopyKind {
  return kind === "competitor" && !isComparePage(landingUrl) ? "core" : kind;
}

/**
 * The blueprint, or null when it cannot be read. Null, never a guess: without
 * the blueprint no campaign has a kind and no ad may name a competitor.
 */
export function blueprintKindsFrom(load: () => BlueprintKinds): BlueprintKinds | null {
  try {
    return load();
  } catch (error) {
    console.error("[ads-engine] the blueprint cannot be read; no campaign has a kind and no ad may name a competitor", error);
    return null;
  }
}
