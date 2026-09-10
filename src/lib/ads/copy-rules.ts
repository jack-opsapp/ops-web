/**
 * Google Ads copy rules — deterministic, server-side (design spec §5.5).
 *
 * Shared by the phase 2 account rebuild (every blueprint ad) and the phase 3
 * engine (every challenger the routine proposes). The rules are the OPS voice
 * as hard constraints: lengths Google enforces, the brand-facts allowlist for
 * every number, the copywriter brief's banned words, no shouting, no
 * exclamation, competitor names only in the sanctioned forms and only in the
 * competitor campaign, and a pin plan of two or three headlines on position
 * one and nothing else pinned.
 */
import brandFacts from "../../../config/ads/brand-facts.json";

export interface BrandFacts {
  version: string;
  numbers: Array<{ token: string; context: string }>;
  phrases: string[];
  competitors: { names: string[]; forms: string[] };
  bannedWords: string[];
  audienceWords: { banned: string[]; approved: string[] };
  allowedFinalUrls: string[];
}

export const BRAND_FACTS: BrandFacts = brandFacts as BrandFacts;

export type HeadlinePin = "HEADLINE_1" | "HEADLINE_2" | "HEADLINE_3";
export type DescriptionPin = "DESCRIPTION_1" | "DESCRIPTION_2";

export interface RsaCandidate {
  headlines: Array<{ text: string; pinnedField?: HeadlinePin | DescriptionPin }>;
  descriptions: Array<{ text: string; pinnedField?: HeadlinePin | DescriptionPin }>;
  path1?: string;
  path2?: string;
  finalUrl: string;
}

export interface CopyContext {
  campaignKind: "brand" | "core" | "competitor";
  allowedFinalUrls: string[];
}

export type CopyIssueCode =
  | "HEADLINE_TOO_LONG"
  | "DESCRIPTION_TOO_LONG"
  | "TOO_FEW_HEADLINES"
  | "TOO_MANY_HEADLINES"
  | "TOO_FEW_DESCRIPTIONS"
  | "TOO_MANY_DESCRIPTIONS"
  | "DUPLICATE_ASSET"
  | "EXCLAMATION"
  | "EMOJI"
  | "REPEATED_PUNCTUATION"
  | "ALL_CAPS"
  | "BANNED_WORD"
  | "CONTRACTOR"
  | "LEADS_WITH_AI"
  | "UNSUPPORTED_NUMBER"
  | "TRADEMARK_FORM"
  | "TRADEMARK_CAMPAIGN"
  | "URL_NOT_ALLOWED"
  | "PATH_TOO_LONG"
  | "PIN_PLAN";

export interface CopyIssue {
  code: CopyIssueCode;
  field: string;
  message: string;
}

export const COPY_LIMITS = {
  headline: 30,
  description: 90,
  headlines: { min: 8, max: 12 },
  descriptions: { min: 3, max: 4 },
  path: 15,
  pinnedHeadlines: { min: 2, max: 3 },
  nearDuplicateDistance: 2,
} as const;

const EMOJI = /\p{Extended_Pictographic}/u;
const REPEATED_PUNCTUATION = /(!!|\?\?|\.\.\.|…|,,)/;
// A comma only belongs to a number when it groups thousands. Matching
// `[\d,]*` swallowed the comma in prose ("$90, $140 or $190"), so a good
// price read as the unsupported number "$90,".
const NUMBER_TOKEN = /\$?\d+(?:,\d{3})*(?:\.\d+)?/g;
const ALLOWED_NUMBERS = new Set(BRAND_FACTS.numbers.map((n) => n.token));
const BANNED_WORDS = BRAND_FACTS.bannedWords.map(
  (word) => new RegExp(`(^|[^a-z0-9-])${escape(word)}(?=$|[^a-z0-9-])`, "i")
);
const CONTRACTOR = /\bcontractors?\b/i;
const LEADS_WITH_AI = /^[^a-z0-9]*ai\b/i;

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Classic Levenshtein distance, bounded to the small strings RSAs carry. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\/[^/]+$/.test(trimmed)) return `${trimmed}/`;
  return trimmed.endsWith("/") && trimmed.split("/").length > 4
    ? trimmed.slice(0, -1)
    : trimmed;
}

export function isAllowedFinalUrl(url: string, allowed: string[]): boolean {
  const target = normalizeUrl(url);
  return allowed.some((candidate) => normalizeUrl(candidate) === target);
}

function checkText(
  text: string,
  field: string,
  limit: number,
  tooLong: "HEADLINE_TOO_LONG" | "DESCRIPTION_TOO_LONG",
  ctx: CopyContext,
  issues: CopyIssue[]
) {
  if (text.length > limit)
    issues.push({
      code: tooLong,
      field,
      message: `${text.length} characters; the limit is ${limit}.`,
    });
  if (text.includes("!"))
    issues.push({
      code: "EXCLAMATION",
      field,
      message: "Confidence does not shout. Remove the exclamation mark.",
    });
  if (EMOJI.test(text))
    issues.push({ code: "EMOJI", field, message: "No emoji in ad copy." });
  if (REPEATED_PUNCTUATION.test(text))
    issues.push({
      code: "REPEATED_PUNCTUATION",
      field,
      message: "No repeated punctuation or ellipses.",
    });
  const shouting = text.match(/\b[A-Z]{4,}\b/g) ?? [];
  for (const word of shouting) {
    if (word === "OPS") continue;
    issues.push({
      code: "ALL_CAPS",
      field,
      message: `"${word}" is all caps; only OPS may be.`,
    });
  }
  for (const [index, pattern] of BANNED_WORDS.entries()) {
    if (pattern.test(text))
      issues.push({
        code: "BANNED_WORD",
        field,
        message: `"${BRAND_FACTS.bannedWords[index]}" is on the banned list.`,
      });
  }
  if (CONTRACTOR.test(text))
    issues.push({
      code: "CONTRACTOR",
      field,
      message:
        "Never call the audience contractors. Use trades, crews, owner-operators or business owners.",
    });
  if (LEADS_WITH_AI.test(text))
    issues.push({
      code: "LEADS_WITH_AI",
      field,
      message: "Never lead with AI. Describe the behaviour instead.",
    });
  for (const token of text.match(NUMBER_TOKEN) ?? []) {
    if (!ALLOWED_NUMBERS.has(token))
      issues.push({
        code: "UNSUPPORTED_NUMBER",
        field,
        message: `"${token}" is not in the brand-facts allowlist (${[...ALLOWED_NUMBERS].join(", ")}).`,
      });
  }
  checkTrademarks(text, field, ctx, issues);
}

function checkTrademarks(
  text: string,
  field: string,
  ctx: CopyContext,
  issues: CopyIssue[]
) {
  const lower = text.toLowerCase();
  for (const brand of BRAND_FACTS.competitors.names) {
    const name = brand.toLowerCase();
    if (!lower.includes(name)) continue;
    if (ctx.campaignKind !== "competitor") {
      issues.push({
        code: "TRADEMARK_CAMPAIGN",
        field,
        message: `"${brand}" may only appear in the competitor campaign.`,
      });
      continue;
    }
    const forms = BRAND_FACTS.competitors.forms.map((form) =>
      form.replace("{brand}", brand).toLowerCase()
    );
    const covered: Array<[number, number]> = [];
    for (const form of forms) {
      let from = lower.indexOf(form);
      while (from >= 0) {
        covered.push([from, from + form.length]);
        from = lower.indexOf(form, from + 1);
      }
    }
    let at = lower.indexOf(name);
    while (at >= 0) {
      const end = at + name.length;
      if (!covered.some(([start, stop]) => at >= start && end <= stop))
        issues.push({
          code: "TRADEMARK_FORM",
          field,
          message: `"${brand}" may only appear as ${BRAND_FACTS.competitors.forms
            .map((form) => `"${form.replace("{brand}", brand)}"`)
            .join(", ")}.`,
        });
      at = lower.indexOf(name, at + 1);
    }
  }
}

function checkDuplicates(
  assets: Array<{ text: string }>,
  prefix: string,
  issues: CopyIssue[]
) {
  const seen: Array<{ text: string; index: number }> = [];
  assets.forEach((asset, index) => {
    const normalized = asset.text.trim().toLowerCase().replace(/\s+/g, " ");
    const clash = seen.find(
      (entry) =>
        entry.text === normalized ||
        levenshtein(entry.text, normalized) <= COPY_LIMITS.nearDuplicateDistance
    );
    if (clash)
      issues.push({
        code: "DUPLICATE_ASSET",
        field: `${prefix}[${index}]`,
        message: `Reads as a duplicate of ${prefix}[${clash.index}].`,
      });
    seen.push({ text: normalized, index });
  });
}

/**
 * Every rule, every issue, in one pass. An empty array is the only pass.
 */
export function validateRsa(
  candidate: RsaCandidate,
  ctx: CopyContext
): CopyIssue[] {
  const issues: CopyIssue[] = [];
  const headlines = candidate.headlines ?? [];
  const descriptions = candidate.descriptions ?? [];

  if (headlines.length < COPY_LIMITS.headlines.min)
    issues.push({
      code: "TOO_FEW_HEADLINES",
      field: "headlines",
      message: `${headlines.length} headlines; write between ${COPY_LIMITS.headlines.min} and ${COPY_LIMITS.headlines.max}.`,
    });
  if (headlines.length > COPY_LIMITS.headlines.max)
    issues.push({
      code: "TOO_MANY_HEADLINES",
      field: "headlines",
      message: `${headlines.length} headlines; never pad past ${COPY_LIMITS.headlines.max}.`,
    });
  if (descriptions.length < COPY_LIMITS.descriptions.min)
    issues.push({
      code: "TOO_FEW_DESCRIPTIONS",
      field: "descriptions",
      message: `${descriptions.length} descriptions; write between ${COPY_LIMITS.descriptions.min} and ${COPY_LIMITS.descriptions.max}.`,
    });
  if (descriptions.length > COPY_LIMITS.descriptions.max)
    issues.push({
      code: "TOO_MANY_DESCRIPTIONS",
      field: "descriptions",
      message: `${descriptions.length} descriptions; the limit is ${COPY_LIMITS.descriptions.max}.`,
    });

  headlines.forEach((asset, index) =>
    checkText(
      asset.text,
      `headlines[${index}]`,
      COPY_LIMITS.headline,
      "HEADLINE_TOO_LONG",
      ctx,
      issues
    )
  );
  descriptions.forEach((asset, index) =>
    checkText(
      asset.text,
      `descriptions[${index}]`,
      COPY_LIMITS.description,
      "DESCRIPTION_TOO_LONG",
      ctx,
      issues
    )
  );
  checkDuplicates(headlines, "headlines", issues);
  checkDuplicates(descriptions, "descriptions", issues);

  for (const [field, value] of [
    ["path1", candidate.path1],
    ["path2", candidate.path2],
  ] as const) {
    if (value && value.length > COPY_LIMITS.path)
      issues.push({
        code: "PATH_TOO_LONG",
        field,
        message: `${value.length} characters; path fields hold ${COPY_LIMITS.path}.`,
      });
  }

  if (!isAllowedFinalUrl(candidate.finalUrl ?? "", ctx.allowedFinalUrls))
    issues.push({
      code: "URL_NOT_ALLOWED",
      field: "finalUrl",
      message: `Final URL must be one of ${ctx.allowedFinalUrls.join(", ")}.`,
    });

  const pinnedToOne = headlines.filter(
    (asset) => asset.pinnedField === "HEADLINE_1"
  ).length;
  const pinnedElsewhere = headlines.filter(
    (asset) => asset.pinnedField && asset.pinnedField !== "HEADLINE_1"
  ).length;
  const pinnedDescriptions = descriptions.filter(
    (asset) => asset.pinnedField
  ).length;
  if (
    pinnedToOne < COPY_LIMITS.pinnedHeadlines.min ||
    pinnedToOne > COPY_LIMITS.pinnedHeadlines.max ||
    pinnedElsewhere > 0 ||
    pinnedDescriptions > 0
  )
    issues.push({
      code: "PIN_PLAN",
      field: "pins",
      message: `Pin ${COPY_LIMITS.pinnedHeadlines.min} or ${COPY_LIMITS.pinnedHeadlines.max} headlines to HEADLINE_1 and nothing else (found ${pinnedToOne} on position one, ${pinnedElsewhere} elsewhere, ${pinnedDescriptions} descriptions pinned).`,
    });

  return issues;
}
