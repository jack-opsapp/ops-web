import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import drafts from "../../../config/ads/drafts/2026-09-10-assets.json";
import { blueprintFinalUrls, loadBlueprint } from "@/lib/ads/blueprint";
import { ASSET_LIMITS, validateAssetText } from "@/lib/ads/copy-rules";

/**
 * The asset drafts — sitelinks, callouts, the snippet, price tiers, business
 * name, logo and images — held to the same rules as the ads before Jackson
 * sees them. Asset text is ad text: it shows under every ad in the campaign.
 */
const blueprint = loadBlueprint();
const allowed = blueprintFinalUrls(blueprint);
type Campaign = (typeof drafts.campaigns)[keyof typeof drafts.campaigns];
const campaigns = Object.entries(drafts.campaigns) as Array<[string, Campaign]>;

const kindOf = (name: string) => blueprint.campaigns.find((c) => c.name === name)!.kind;
const check = (text: string, field: string, limit: number, campaign: string) =>
  validateAssetText(text, field, limit, { campaignKind: kindOf(campaign), allowedFinalUrls: allowed })
    .map((i) => `${campaign} ${i.code} ${field}: ${i.message}`);

describe("asset drafts (2026-09-10)", () => {
  it("covers exactly the five engine campaigns", () => {
    expect(campaigns.map(([name]) => name).sort()).toEqual(blueprint.campaigns.map((c) => c.name).sort());
  });

  it.each(campaigns)("%s — every line of asset text passes the copy rules", (name, c) => {
    const issues: string[] = [];
    c.sitelinks.forEach((s, i) => {
      issues.push(...check(s.text, `sitelinks[${i}].text`, ASSET_LIMITS.sitelinkText, name));
      issues.push(...check(s.description1, `sitelinks[${i}].description1`, ASSET_LIMITS.sitelinkDescription, name));
      issues.push(...check(s.description2, `sitelinks[${i}].description2`, ASSET_LIMITS.sitelinkDescription, name));
    });
    c.callouts.forEach((x, i) => issues.push(...check(x.text, `callouts[${i}]`, ASSET_LIMITS.callout, name)));
    c.snippet.values.forEach((v, i) => issues.push(...check(v, `snippet[${i}]`, ASSET_LIMITS.snippetValue, name)));
    issues.push(...check(c.businessName, "businessName", ASSET_LIMITS.businessName, name));
    for (const [i, item] of (c.price?.items ?? []).entries()) {
      issues.push(...check(item.header, `price[${i}].header`, ASSET_LIMITS.priceHeader, name));
      issues.push(...check(item.description, `price[${i}].description`, ASSET_LIMITS.priceDescription, name));
    }
    expect(issues.join("\n")).toBe("");
  });

  it.each(campaigns)("%s — four sitelinks, each to a different live page we own", (name, c) => {
    expect(c.sitelinks).toHaveLength(4);
    expect(new Set(c.sitelinks.map((s) => s.finalUrl)).size).toBe(4);
    for (const s of c.sitelinks) expect(allowed, `${name}: ${s.finalUrl}`).toContain(s.finalUrl);
  });

  it("prices only what the plans page publishes", () => {
    for (const [name, c] of campaigns) {
      if (!c.price) continue;
      expect(c.price.currency, name).toBe("CAD");
      expect(c.price.items.map((i) => i.price), name).toEqual([90, 140, 190]);
      for (const item of c.price.items) expect(allowed, name).toContain(item.finalUrl);
    }
  });

  it("uses no image that is not in the review set, and every review image exists", () => {
    const known = new Set(Object.keys(drafts.images));
    for (const [name, c] of campaigns) {
      for (const key of c.images) expect(known.has(key), `${name}: ${key}`).toBe(true);
      expect(Object.keys(drafts.businessLogo), name).toContain(c.businessLogo);
    }
    for (const [key, image] of Object.entries(drafts.images) as Array<[string, { file?: string; existingAssetId?: string }]>)
      expect(Boolean(image.existingAssetId) || (image.file ? existsSync(image.file) : false), key).toBe(true);
  });

  it("stops Google choosing images from our pages behind Jackson's back", () => {
    for (const [name, c] of campaigns) {
      expect(c.automation.GENERATE_IMAGE_EXTRACTION, name).toBe("OPTED_OUT");
      expect(c.automation.GENERATE_IMAGE_ENHANCEMENT, name).toBe("OPTED_OUT");
    }
  });

  it("pauses every account-level sitelink rather than removing it", () => {
    expect(drafts.accountLevel.pause.length).toBeGreaterThan(0);
    for (const p of drafts.accountLevel.pause) expect(p.reason, p.text).toBeTruthy();
    expect(drafts.onApproval).toMatch(/pause — not remove/);
  });
});
