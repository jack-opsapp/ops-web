#!/usr/bin/env node
/**
 * Render every ad in the blueprint the way a person reads it, not the way JSON
 * stores it. This is what goes in front of Jackson for approval.
 *
 *   node scripts/ads/ad-previews.mjs            # readable text
 *   node scripts/ads/ad-previews.mjs --json     # the same data, structured
 *
 * Google rotates headlines and descriptions, so no single rendering is "the"
 * ad. The preview shows the pinned headlines first (those always take position
 * one) and then everything else it may choose from.
 */
import { readFileSync } from "node:fs";

const blueprint = JSON.parse(readFileSync("config/ads/blueprint.json", "utf8"));
const asJson = process.argv.includes("--json");

const ads = [];
for (const campaign of blueprint.campaigns)
  for (const group of campaign.adGroups)
    for (const ad of group.ads) {
      const pinned = ad.headlines.filter((h) => h.pinnedField);
      const rotating = ad.headlines.filter((h) => !h.pinnedField);
      ads.push({
        campaign: campaign.name,
        adGroup: group.name,
        role: ad.role,
        angle: ad.angle,
        displayUrl: `${ad.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}${ad.path1 ?? group.path1 ? `/${ad.path1 ?? group.path1}` : ""}${ad.path2 ?? group.path2 ? `/${ad.path2 ?? group.path2}` : ""}`,
        finalUrl: ad.finalUrl,
        pinnedHeadlines: pinned.map((h) => h.text),
        rotatingHeadlines: rotating.map((h) => h.text),
        descriptions: ad.descriptions.map((d) => d.text),
        keywords: group.keywords.map((k) => `${k.text} [${k.matchType}]`),
      });
    }

if (asJson) {
  process.stdout.write(`${JSON.stringify({ blueprintVersion: blueprint.version, ads }, null, 2)}\n`);
} else {
  const out = [];
  out.push(`# Ads awaiting approval — blueprint ${blueprint.version}`);
  out.push("");
  out.push(`${ads.length} ads across ${new Set(ads.map((a) => `${a.campaign}/${a.adGroup}`)).size} ad groups. Every campaign is PAUSED.`);
  out.push("");
  out.push("Google rotates the assets, so an ad is a pool, not a fixed sentence. The");
  out.push("pinned headlines always take position one; the rest rotate behind them.");
  out.push("");
  let lastGroup = "";
  for (const ad of ads) {
    const groupKey = `${ad.campaign} › ${ad.adGroup}`;
    if (groupKey !== lastGroup) {
      out.push("");
      out.push(`## ${groupKey}`);
      out.push("");
      out.push(`Bidding on: ${ad.keywords.join(", ")}`);
      out.push(`Lands on: ${ad.finalUrl}`);
      lastGroup = groupKey;
    }
    out.push("");
    out.push(`### ${ad.role.toUpperCase()} — ${ad.angle}`);
    out.push("");
    out.push("```");
    out.push(`Ad · ${ad.displayUrl}`);
    out.push(`${ad.pinnedHeadlines.join(" | ")}`);
    out.push("");
    for (const description of ad.descriptions) out.push(description);
    out.push("");
    out.push(`Also rotates: ${ad.rotatingHeadlines.join(" · ")}`);
    out.push("```");
  }
  process.stdout.write(`${out.join("\n")}\n`);
}
