#!/usr/bin/env node
/**
 * Stamp the measured demand onto every keyword in the blueprint.
 *
 * The blueprint claims a monthly search volume next to each seed. Typing those
 * numbers by hand is how a file starts lying, so this reads them straight out
 * of the committed `keyword-demand-<date>.json` pull and rewrites the
 * `volume` and `source` fields. A keyword the pull never measured loses its
 * numbers rather than keeping a stale one.
 *
 * The country is the campaign's own: a US campaign gets US volume, `CORE · CA`
 * gets Canadian volume. `BRAND · NA` targets both, and brand terms are not in
 * the pull, so its keywords are left alone.
 *
 *   node scripts/ads/annotate-blueprint-demand.mjs
 *   node scripts/ads/annotate-blueprint-demand.mjs --demand config/ads/keyword-demand-2026-09-09.json
 *
 * It also writes the file back in the compact shape the repo keeps: one line
 * per keyword, so a diff shows what actually changed.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};

const BLUEPRINT = flag("blueprint") ?? "config/ads/blueprint.json";
const demandPath =
  flag("demand") ??
  `config/ads/${readdirSync("config/ads")
    .filter((f) => /^keyword-demand-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .pop()}`;

const demand = JSON.parse(readFileSync(demandPath, "utf8"));
const blueprint = JSON.parse(readFileSync(BLUEPRINT, "utf8"));
const measured = new Map(demand.terms.map((t) => [t.term.toLowerCase(), t]));

/** US-only, CA-only, or both (brand) — read off the campaign's own geo. */
function countryOf(campaign) {
  const us = campaign.geo.locations.includes("geoTargetConstants/2840");
  const ca = campaign.geo.locations.includes("geoTargetConstants/2124");
  if (us && !ca) return "US";
  if (ca && !us) return "CA";
  return null;
}

/** Rewrite an object in place so its keys read in a fixed, sensible order. */
function reorder(target, order) {
  const copy = { ...target };
  for (const key of Object.keys(target)) delete target[key];
  for (const key of order) if (key in copy) target[key] = copy[key];
  for (const [key, value] of Object.entries(copy))
    if (!(key in target)) target[key] = value;
}

const label = demandPath.replace(/^config\/ads\//, "").replace(/\.json$/, "");
let stamped = 0;
let cleared = 0;

for (const campaign of blueprint.campaigns) {
  const country = countryOf(campaign);
  if (!country) continue;
  for (const group of campaign.adGroups)
    for (const keyword of group.keywords) {
      const term = measured.get(keyword.text.toLowerCase());
      const metrics = term?.[country];
      if (!metrics) {
        if (keyword.volume != null) cleared += 1;
        delete keyword.volume;
        if (!keyword.source?.startsWith("brand")) delete keyword.source;
        continue;
      }
      keyword.volume = metrics.monthlySearches;
      reorder(keyword, ["text", "matchType", "volume", "source"]);
      const bid =
        metrics.lowTopOfPageBid != null && metrics.highTopOfPageBid != null
          ? ` · $${metrics.lowTopOfPageBid}–${metrics.highTopOfPageBid} top of page`
          : "";
      keyword.source = `${label} · ${country} ${metrics.monthlySearches}/mo${bid}`;
      stamped += 1;
    }
}

// ─── Compact writer ──────────────────────────────────────────────────────────
// Leaf objects (a keyword, a negative, a headline) read as one line; structure
// stays expanded. `JSON.stringify` cannot express that, so serialise by hand.
const LEAF = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v !== "object" || v === null) &&
  JSON.stringify(value).length <= 150;

function write(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => typeof v === "string") && JSON.stringify(value).length <= 90)
      return JSON.stringify(value);
    return `[\n${value.map((v) => inner + write(v, indent + 1)).join(",\n")}\n${pad}]`;
  }
  if (typeof value === "object" && value !== null) {
    if (LEAF(value))
      return `{ ${Object.entries(value)
        .map(([key, v]) => `${JSON.stringify(key)}: ${JSON.stringify(v)}`)
        .join(", ")} }`;
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries
      .map(([key, v]) => `${inner}${JSON.stringify(key)}: ${write(v, indent + 1)}`)
      .join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

writeFileSync(BLUEPRINT, `${write(blueprint)}\n`);
process.stderr.write(
  `Annotated ${BLUEPRINT} from ${demandPath}: ${stamped} keywords stamped, ${cleared} unmeasured numbers cleared.\n`
);
