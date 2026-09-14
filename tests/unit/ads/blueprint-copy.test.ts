import { describe, expect, it } from "vitest";
import {
  blueprintFinalUrls,
  copyKindFor,
  loadBlueprint,
  toRsaCandidate,
} from "@/lib/ads/blueprint";
import { ASSET_LIMITS, validateAssetText, validateRsa, type CopyIssue } from "@/lib/ads/copy-rules";

/**
 * Every ad in the account, through the same rules the engine will hold its own
 * challengers to. This is the gate that stops a headline reaching Google — and
 * a customer — with an exclamation mark, an invented price, a banned word, or
 * a competitor's name outside the forms trademark policy allows.
 */
const blueprint = loadBlueprint();
const allowedFinalUrls = blueprintFinalUrls(blueprint);

const ads = blueprint.campaigns.flatMap((campaign) =>
  campaign.adGroups.flatMap((group) =>
    group.ads.map((ad) => ({
      campaign,
      group,
      ad,
      label: `${campaign.name} › ${group.name} › ${ad.role}`,
    }))
  )
);

const format = (issues: CopyIssue[]) =>
  issues.map((i) => `${i.code} at ${i.field}: ${i.message}`).join("\n");

describe("every ad in the blueprint", () => {
  it("gives every ad group a control and a challenger", () => {
    for (const campaign of blueprint.campaigns)
      for (const group of campaign.adGroups)
        expect(
          group.ads.map((ad) => ad.role).sort(),
          `${campaign.name} › ${group.name}`
        ).toEqual(["challenger", "control"]);
    expect(ads).toHaveLength(24);
  });

  it.each(ads.map((entry) => [entry.label, entry] as const))(
    "%s passes every copy rule",
    (_label, entry) => {
      const issues = validateRsa(toRsaCandidate(entry.ad), {
        campaignKind: copyKindFor(entry.campaign, entry.group),
        allowedFinalUrls,
      });
      expect(format(issues)).toBe("");
    }
  );

  it("sends each ad to its own ad group's landing page", () => {
    for (const entry of ads) expect(entry.ad.finalUrl).toBe(entry.group.finalUrl);
  });

  it("never prints the word we bid on but do not say", () => {
    // `contractor scheduling app` is a keyword. It is never ad copy.
    const bidsOnIt = blueprint.campaigns.some((c) =>
      c.adGroups.some((g) => g.keywords.some((k) => /contractor/i.test(k.text)))
    );
    expect(bidsOnIt).toBe(true);
    for (const entry of ads)
      for (const asset of [...entry.ad.headlines, ...entry.ad.descriptions])
        expect(asset.text, entry.label).not.toMatch(/contractor/i);
  });

  it("names a competitor only where the page compares", () => {
    const brands = ["Jobber", "Housecall Pro", "ServiceTitan"];
    for (const entry of ads) {
      const text = [...entry.ad.headlines, ...entry.ad.descriptions]
        .map((a) => a.text)
        .join(" ");
      if (!brands.some((brand) => text.includes(brand))) continue;
      expect(
        new URL(entry.ad.finalUrl).pathname,
        entry.label
      ).toMatch(/^\/compare\//);
    }
  });

  it("gives the control and the challenger genuinely different angles", () => {
    for (const campaign of blueprint.campaigns)
      for (const group of campaign.adGroups) {
        const [a, b] = group.ads;
        expect(a.angle, `${campaign.name} › ${group.name}`).not.toBe(b.angle);
        // A challenger that only reshuffles the control's words tests nothing:
        // require the two ads to differ in most of their pinned headlines.
        const pinned = (ad: (typeof group.ads)[number]) =>
          new Set(
            ad.headlines
              .filter((headline) => headline.pinnedField)
              .map((headline) => headline.text)
          );
        const shared = [...pinned(a)].filter((text) => pinned(b).has(text));
        expect(shared.length, `${campaign.name} › ${group.name}`).toBeLessThan(2);
      }
  });
});

describe("every asset in the blueprint", () => {
  const withAssets = blueprint.campaigns.filter((c) => c.assets);

  it("dresses all five campaigns", () => {
    expect(withAssets.map((c) => c.name).sort()).toEqual(blueprint.campaigns.map((c) => c.name).sort());
  });

  it.each(withAssets.map((c) => [c.name, c] as const))("%s — asset text passes every copy rule", (_n, campaign) => {
    const a = campaign.assets!;
    const ctx = { campaignKind: campaign.kind, allowedFinalUrls };
    const lines: Array<[string, string, number]> = [
      ...a.sitelinks.flatMap((s, i): Array<[string, string, number]> => [
        [s.text, `sitelinks[${i}].text`, ASSET_LIMITS.sitelinkText],
        [s.description1, `sitelinks[${i}].description1`, ASSET_LIMITS.sitelinkDescription],
        [s.description2, `sitelinks[${i}].description2`, ASSET_LIMITS.sitelinkDescription],
      ]),
      ...a.callouts.map((c, i): [string, string, number] => [c.text, `callouts[${i}]`, ASSET_LIMITS.callout]),
      ...(a.snippet?.values ?? []).map((v, i): [string, string, number] => [v, `snippet[${i}]`, ASSET_LIMITS.snippetValue]),
      ...(a.businessName ? [[a.businessName, "businessName", ASSET_LIMITS.businessName] as [string, string, number]] : []),
      ...(a.price?.items ?? []).flatMap((item, i): Array<[string, string, number]> => [
        [item.header, `price[${i}].header`, ASSET_LIMITS.priceHeader],
        [item.description, `price[${i}].description`, ASSET_LIMITS.priceDescription],
      ]),
    ];
    const issues = lines.flatMap(([text, field, limit]) => validateAssetText(text, field, limit, ctx));
    expect(format(issues)).toBe("");
  });

  it("sends every sitelink and price tier to one of our own live pages", () => {
    for (const campaign of withAssets) {
      for (const s of campaign.assets!.sitelinks) expect(allowedFinalUrls, campaign.name).toContain(s.finalUrl);
      for (const item of campaign.assets!.price?.items ?? []) expect(allowedFinalUrls, campaign.name).toContain(item.finalUrl);
    }
  });

  it("keeps Google from writing its own ad text on every campaign", () => {
    for (const campaign of withAssets) expect(campaign.assets!.automation?.TEXT_ASSET_AUTOMATION, campaign.name).toBe("OPTED_OUT");
  });
});
