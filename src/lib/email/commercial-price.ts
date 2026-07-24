/**
 * Deterministic deal-price extraction shared by lifecycle decisions and
 * summaries. Message text is untrusted: only direct price context is accepted,
 * while addresses, percentages, dimensions, durations, and item counts are
 * excluded even when they appear beside an actual quote amount.
 */

const PRICE_RE = /(?:\$\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)/g;
const DIRECT_PRICE_PREFIX_RE =
  /(?:\b(?:cad|usd)|\b(?:quote|estimate|proposal|price|cost|total|offer|discount(?:ed)?|promo|charge)(?:\s+(?:total|amount|price|is|was|of|at|comes? to|came to))?\s*[:=]?|\bbring it up to)\s*$/i;
const DIRECT_PRICE_SUFFIX_RE =
  /^\s*(?:cad|usd|dollars?\b|(?:would|will|is|was)?\s*(?:be\s+)?(?:the\s+)?(?:quote|estimate|proposal|price|cost|total|offer)\b|after\s+(?:the\s+)?discount\b)/i;
const NON_PRICE_QUANTITY_SUFFIX_RE =
  /^\s*(?:%|\/\s*(?:ft|lf)|(?:mil|mm|cm|m|ft|lf|sq\.?\s*ft|days?|weeks?|months?|years?|hours?|minutes?|stairs?|steps?|boards?|posts?|items?|units?|pieces?|pcs)\b)/i;
const NON_DEAL_AMOUNT_PREFIX_RE =
  /\b(?:(?:truck|engine|vehicle|car|medical|rent|mortgage|tax(?:es)?|insurance|personal debt|credit card)(?:\s+(?:repair|repairs|expense|expenses|bill|bills|cost|costs))?|(?:project\s+)?budget|available funds?|deposit|payment)(?:\s+(?:amount|cost|total))?(?:\s+(?:is|was|of|at|came to|comes? to|costs?))?\s*[:=]?\s*$/i;
const NON_DEAL_AMOUNT_SUFFIX_RE =
  /^\s*(?:deposit|payment|(?:project\s+)?budget|available funds?|for\s+(?:truck|engine|vehicle|car|medical|rent|mortgage|tax(?:es)?|insurance|personal debt|credit card)\b)/i;
const NON_DEAL_AMOUNT_ACTION_PREFIX_RE =
  /\b(?:spent|paid|sent|transferred|wired|lost|set\s+aside|can(?:not|['’]t)?\s+afford|could(?:\s+not|n['’]t)?\s+afford|only\s+have|have\s+only|(?:our|the)\s+(?:max|maximum)\s+is|(?:we|i)\s+(?:are|am)\s+short|need\s+another|remaining\s+balance\s+(?:is|was)|balance\s+(?:paid|sent)|receipt\s+for|(?:truck|engine|vehicle|car)(?:\s+repairs?)?\s+(?:ate|cost|costs|set\s+(?:us|me)\s+back))\s*[:=]?\s*$/i;
const NON_DEAL_AMOUNT_ACTION_SUFFIX_RE =
  /^\s*(?:as\s+(?:the\s+|a\s+)?(?:deposit|payment)|(?:deposit|payment|transfer|receipt|remaining\s+balance|(?:project\s+)?budget)\b|(?:on|for|toward(?:s)?|to\s+fix|fixing)\s+(?:the\s+|my\s+|our\s+)?(?:truck|engine|vehicle|car|medical|rent|mortgage|tax(?:es)?|insurance|personal debt|credit card)\b|(?:truck|engine|vehicle|car)\s+repairs?\b)/i;
const COMPONENT_AMOUNT_PREFIX_RE =
  /\b(?:gst|hst|pst|tax|discount|permit fee|delivery fee|shipping fee)\b.{0,24}$/i;
const COMPONENT_AMOUNT_SUFFIX_RE =
  /^\s*(?:gst|hst|pst|tax|discount|permit fee|delivery fee|shipping fee)\b/i;
const FINAL_TOTAL_PREFIX_RE =
  /\b(?:(?:final|grand)\s+)?total(?:\s+(?:including|after|with)\b.{0,30})?\s*(?:is|was|of|:|=)?\s*$/i;

export interface CommercialDealPriceMatch {
  value: number;
  matchIndex: number;
  segment: string;
}

function looksLikeStreetAddress(value: string): boolean {
  return /^\s+(?:[a-z0-9.'’-]+\s+){0,5}(?:avenue|ave|boulevard|blvd|circle|court|ct|crescent|cr|drive|dr|highway|hwy|lane|ln|place|pl|road|rd|street|st|terrace|trail|way)\b/i.test(
    value
  );
}

function sentenceAround(value: string, index: number): string {
  let left = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = value[cursor];
    const decimalPoint =
      char === "." &&
      /\d/.test(value[cursor - 1] ?? "") &&
      /\d/.test(value[cursor + 1] ?? "");
    if (!decimalPoint && (char === "." || char === "\n" || char === ";")) {
      left = cursor;
      break;
    }
  }
  let right = value.length;
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    const decimalPoint =
      char === "." &&
      /\d/.test(value[cursor - 1] ?? "") &&
      /\d/.test(value[cursor + 1] ?? "");
    if (!decimalPoint && (char === "." || char === "\n" || char === ";")) {
      right = cursor;
      break;
    }
  }
  return value.slice(left + 1, right).trim();
}

export function extractCommercialDealPriceMatches(
  body: string
): CommercialDealPriceMatch[] {
  const prices: CommercialDealPriceMatch[] = [];
  for (const match of body.matchAll(PRICE_RE)) {
    const value = Number((match[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;

    const matchIndex = match.index ?? 0;
    const prefix = body.slice(Math.max(0, matchIndex - 64), matchIndex);
    const suffix = body.slice(
      matchIndex + match[0].length,
      matchIndex + match[0].length + 80
    );
    const immediateSuffix = suffix.slice(0, 16);
    const segment = sentenceAround(body, matchIndex);
    const directPriceContext =
      match[0].includes("$") ||
      DIRECT_PRICE_PREFIX_RE.test(prefix) ||
      DIRECT_PRICE_SUFFIX_RE.test(suffix);
    const componentAmount =
      (COMPONENT_AMOUNT_PREFIX_RE.test(prefix) ||
        COMPONENT_AMOUNT_SUFFIX_RE.test(suffix)) &&
      !FINAL_TOTAL_PREFIX_RE.test(prefix) &&
      !/^\s*after\s+(?:the\s+)?discount\b/i.test(suffix);
    const nonDealAmount =
      NON_DEAL_AMOUNT_PREFIX_RE.test(prefix) ||
      NON_DEAL_AMOUNT_SUFFIX_RE.test(suffix) ||
      NON_DEAL_AMOUNT_ACTION_PREFIX_RE.test(prefix) ||
      NON_DEAL_AMOUNT_ACTION_SUFFIX_RE.test(suffix);

    if (
      !directPriceContext ||
      componentAmount ||
      nonDealAmount ||
      NON_PRICE_QUANTITY_SUFFIX_RE.test(immediateSuffix) ||
      looksLikeStreetAddress(suffix)
    ) {
      continue;
    }

    prices.push({ value, matchIndex, segment });
  }
  return prices;
}

export function extractCommercialDealPrices(body: string): number[] {
  return extractCommercialDealPriceMatches(body).map((price) => price.value);
}
