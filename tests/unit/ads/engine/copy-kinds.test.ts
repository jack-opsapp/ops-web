import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBlueprint } from "@/lib/ads/blueprint";
import {
  adGroupCopyKindOf,
  blueprintKindsFrom,
  campaignKindOf,
  type BlueprintKinds,
} from "@/lib/ads/engine/copy-kinds";
import type { CampaignKind } from "@/lib/ads/engine/types";

const COMPARE = "https://try.opsapp.co/compare/jobber";
const CATEGORY = "https://try.opsapp.co/job-management";

/** The committed blueprint: the names Google holds today. */
const committed = loadBlueprint();

const groupKind = (
  blueprint: BlueprintKinds | null,
  campaign: { name: string; kind: CampaignKind },
  adGroupName: string,
  landingUrl: string | null
) => adGroupCopyKindOf({ blueprint, campaign, adGroupName, landingUrl });

describe("campaignKindOf — the blueprint says what a campaign is", () => {
  it("reads every phase 2 campaign's kind from the blueprint, whatever its name looks like", () => {
    expect(campaignKindOf("BRAND · NA", ["engine"], committed)).toBe("brand");
    expect(campaignKindOf("PRICING · US", ["engine"], committed)).toBe("competitor");
    expect(campaignKindOf("SWITCH · US", ["engine"], committed)).toBe("competitor");
    expect(campaignKindOf("TRADE · US", ["engine"], committed)).toBe("core");
    expect(campaignKindOf("CORE · CA", ["engine"], committed)).toBe("core");
  });

  it("lets the legacy label win over the blueprint", () => {
    expect(campaignKindOf("PRICING · US", ["engine", "legacy"], committed)).toBe("legacy");
    expect(campaignKindOf("Search - Bubble 2024", ["legacy"], committed)).toBe("legacy");
  });

  it("gives a campaign the blueprint does not declare no kind, even one named like a declared kind", () => {
    // The old spec names. A name is a string anyone can type; it grants nothing.
    expect(campaignKindOf("COMPETITOR · CA", ["engine"], committed)).toBe("other");
    expect(campaignKindOf("BRAND · CA", ["engine"], committed)).toBe("other");
    expect(campaignKindOf("pricing · us", ["engine"], committed)).toBe("other");
  });

  it("gives every campaign no kind when the blueprint cannot be read", () => {
    expect(campaignKindOf("PRICING · US", ["engine"], null)).toBe("other");
    expect(campaignKindOf("Old", ["legacy"], null)).toBe("legacy");
  });
});

describe("adGroupCopyKindOf — which copy rules a group's ads answer to", () => {
  const pricing = { name: "PRICING · US", kind: "competitor" as const };
  const switching = { name: "SWITCH · US", kind: "competitor" as const };
  const trade = { name: "TRADE · US", kind: "core" as const };
  const coreCa = { name: "CORE · CA", kind: "core" as const };
  const brand = { name: "BRAND · NA", kind: "brand" as const };

  it("answers competitor for all seven competitor-intent groups the blueprint built", () => {
    expect(groupKind(committed, pricing, "Jobber pricing", COMPARE)).toBe("competitor");
    expect(groupKind(committed, pricing, "Housecall Pro pricing", "https://try.opsapp.co/compare/housecall-pro")).toBe("competitor");
    expect(groupKind(committed, switching, "Jobber alternative", COMPARE)).toBe("competitor");
    expect(groupKind(committed, switching, "Housecall Pro alternative", "https://try.opsapp.co/compare/housecall-pro")).toBe("competitor");
    expect(groupKind(committed, switching, "ServiceTitan alternative", "https://try.opsapp.co/compare/servicetitan")).toBe("competitor");
    // A core campaign whose groups bid on competitor terms: the group's own override.
    expect(groupKind(committed, coreCa, "Pricing", COMPARE)).toBe("competitor");
    expect(groupKind(committed, coreCa, "Switching", COMPARE)).toBe("competitor");
  });

  it("answers the campaign's kind for the other five", () => {
    expect(groupKind(committed, brand, "Brand", "https://try.opsapp.co/")).toBe("brand");
    expect(groupKind(committed, trade, "Cleaning", "https://try.opsapp.co/for/cleaning")).toBe("core");
    expect(groupKind(committed, trade, "Landscaping", "https://try.opsapp.co/for/landscaping")).toBe("core");
    expect(groupKind(committed, trade, "Roofing", "https://try.opsapp.co/for/roofing")).toBe("core");
    expect(groupKind(committed, coreCa, "Category", CATEGORY)).toBe("core");
  });

  it("lets a group the engine built inherit its campaign's kind, competitor only on a compare page", () => {
    expect(groupKind(committed, pricing, "ServiceTitan pricing", "https://try.opsapp.co/compare/servicetitan")).toBe("competitor");
    expect(groupKind(committed, pricing, "Pricing, general", CATEGORY)).toBe("core");
  });

  it("never widens a group the blueprint did not declare: a core campaign stays core on a compare page", () => {
    expect(groupKind(committed, coreCa, "Jobber reviews", COMPARE)).toBe("core");
    expect(groupKind(committed, brand, "Brand vs Jobber", COMPARE)).toBe("brand");
  });

  it("holds a declared competitor group to core once its ads no longer land on a compare page", () => {
    expect(groupKind(committed, coreCa, "Switching", CATEGORY)).toBe("core");
    expect(groupKind(committed, switching, "Jobber alternative", null)).toBe("core");
  });

  it("answers core under a campaign with no kind, legacy or unknown", () => {
    expect(groupKind(committed, { name: "COMPETITOR · CA", kind: "other" }, "Jobber alternative", COMPARE)).toBe("core");
    expect(groupKind(committed, { name: "Old Search 2025", kind: "legacy" }, "Legacy group", COMPARE)).toBe("core");
    expect(groupKind(null, { name: "PRICING · US", kind: "other" }, "Jobber pricing", COMPARE)).toBe("core");
  });

  it("answers core everywhere when the blueprint cannot be read, whatever the campaign claims", () => {
    expect(groupKind(null, pricing, "Jobber pricing", COMPARE)).toBe("core");
    expect(groupKind(null, brand, "Brand", "https://try.opsapp.co/")).toBe("core");
  });

  it("matches a group by its exact name inside its own campaign, as the blueprint apply does", () => {
    const blueprint: BlueprintKinds = {
      campaigns: [
        { name: "A · US", kind: "core", adGroups: [{ name: "Versus", copyKind: "competitor" }] },
        { name: "B · US", kind: "core", adGroups: [] },
      ],
    };
    expect(groupKind(blueprint, { name: "A · US", kind: "core" }, "Versus", COMPARE)).toBe("competitor");
    expect(groupKind(blueprint, { name: "A · US", kind: "core" }, "versus", COMPARE)).toBe("core");
    expect(groupKind(blueprint, { name: "B · US", kind: "core" }, "Versus", COMPARE)).toBe("core");
  });
});

describe("blueprintKindsFrom", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns what the loader reads", () => {
    expect(blueprintKindsFrom(loadBlueprint)).toBe(committed);
  });

  it("returns null, never a guess, when the blueprint cannot be read", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      blueprintKindsFrom(() => {
        throw new Error("BLUEPRINT_INVALID");
      })
    ).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
