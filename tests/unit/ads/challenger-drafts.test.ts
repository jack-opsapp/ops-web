import { describe, expect, it } from "vitest";
import drafts from "../../../config/ads/drafts/2026-09-10-challengers.json";
import {
  RsaSchema,
  blueprintFinalUrls,
  copyKindFor,
  loadBlueprint,
  toRsaCandidate,
} from "@/lib/ads/blueprint";
import { validateRsa } from "@/lib/ads/copy-rules";

/**
 * The challenger drafts built from the legacy lines that earned their clicks.
 * They are held to exactly the rules the live ads are, before Jackson sees
 * them — a draft he approves must be one Google can take unchanged.
 */
const blueprint = loadBlueprint();
const allowedFinalUrls = blueprintFinalUrls(blueprint);

const entries = drafts.drafts.map((draft) => {
  const campaign = blueprint.campaigns.find((c) => c.name === draft.campaign)!;
  const group = campaign?.adGroups.find((g) => g.name === draft.adGroup)!;
  return { draft, campaign, group, label: `${draft.campaign} › ${draft.adGroup}` };
});

describe("challenger drafts (2026-09-10)", () => {
  it("covers every ad group except the brand pair, which Google already approved", () => {
    const covered = entries.map((e) => e.label).sort();
    const expected = blueprint.campaigns
      .filter((c) => c.name !== "BRAND · NA")
      .flatMap((c) => c.adGroups.map((g) => `${c.name} › ${g.name}`))
      .sort();
    expect(covered).toEqual(expected);
    for (const e of entries) expect(e.group, e.label).toBeDefined();
  });

  it.each(entries.map((e) => [e.label, e] as const))("%s parses as a blueprint ad", (_l, e) => {
    expect(RsaSchema.safeParse(e.draft.ad).success).toBe(true);
    expect(e.draft.ad.role).toBe("challenger");
  });

  it.each(entries.map((e) => [e.label, e] as const))("%s passes every copy rule", (_l, e) => {
    const issues = validateRsa(toRsaCandidate(RsaSchema.parse(e.draft.ad)), {
      campaignKind: copyKindFor(e.campaign, e.group),
      allowedFinalUrls,
    });
    expect(issues.map((i) => `${i.code} ${i.field}: ${i.message}`).join("\n")).toBe("");
  });

  it.each(entries.map((e) => [e.label, e] as const))(
    "%s lands on its group's page and tests a different angle from the control",
    (_l, e) => {
      expect(e.draft.ad.finalUrl).toBe(e.group.finalUrl);
      const control = e.group.ads.find((ad) => ad.role === "control")!;
      expect(e.draft.ad.angle).not.toBe(control.angle);
      const pinned = (list: Array<{ text: string; pinnedField?: string }>) =>
        new Set(list.filter((x) => x.pinnedField).map((x) => x.text));
      const shared = [...pinned(e.draft.ad.headlines)].filter((t) => pinned(control.headlines).has(t));
      expect(shared.length).toBeLessThan(2);
    }
  );

  it("names the live challenger each draft replaces", () => {
    for (const e of entries) expect(e.draft.replacesAdId, e.label).toMatch(/^\d+$/);
    expect(new Set(entries.map((e) => e.draft.replacesAdId)).size).toBe(entries.length);
  });

  it("sources every line — nothing reaches Jackson without saying where it came from", () => {
    for (const e of entries) {
      const lines = [...e.draft.ad.headlines, ...e.draft.ad.descriptions].map((x) => x.text);
      for (const line of lines) {
        const source = (e.draft.evidence as Record<string, string>)[line];
        expect(source, `${e.label}: "${line}"`).toBeTruthy();
        expect(source, `${e.label}: "${line}"`).not.toBe("UNSOURCED");
      }
    }
  });

  it("carries no price, so the test isolates the angle", () => {
    for (const e of entries)
      for (const line of [...e.draft.ad.headlines, ...e.draft.ad.descriptions])
        expect(line.text, e.label).not.toMatch(/\$\d/);
  });
});
