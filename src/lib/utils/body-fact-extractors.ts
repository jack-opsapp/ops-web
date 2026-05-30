// src/lib/utils/body-fact-extractors.ts
//
// Conservative free-text scanners for ordinary inbound/outbound email bodies.
//
// These run on the raw message body (NOT the header sender) and contribute
// ONLY non-identity facts: address, estimated value, and a body-derived phone.
// They never set customer identity (name/email) — identity continues to come
// exclusively from the parsed contact-form submitter / forwarded From / safe
// header sender path gated by safeCustomerEmail in lead-enrichment.ts.
//
// Design constraint: precision over recall. A false positive (writing a wrong
// address or value) is worse than a miss, because the canonical fill-blank gate
// will treat the extracted value as ground-truth for an otherwise-blank field.
// Every pattern here requires a strong structural signal:
//   - address: an explicit address/location label, OR a street-number+street
//     line, OR a recognizable CA/US postal/ZIP code.
//   - value: a currency-prefixed figure ($ / CAD / USD), OR an explicit
//     budget/value label followed by a currency-shaped figure.
//   - phone: a digit run with 10..15 digits that survives the contact-form
//     phone token gate.

const ADDRESS_LABEL_RE =
  /^\s*(?:project address|site address|service address|property address|job location|job site|address|location)\s*[:\-]\s*(.+)$/i;

// Canadian postal code: A1A 1A1 (optional space). Highly distinctive, so safe
// as a standalone address signal. A bare US 5-digit ZIP is intentionally NOT a
// standalone signal (too easily a false positive against invoice/order numbers);
// a US address still matches via the street-suffix line path below.
const CA_POSTAL_RE = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i;

const STREET_SUFFIX =
  "(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|rd|road|dr(?:ive)?|lane|ln|way|court|ct|place|pl|crescent|cres|terrace|terr|trail|trl|highway|hwy|cir(?:cle)?|sq(?:uare)?|row|close|grove|gardens|gdns|loop|run|pass|parkway|pkwy)";

// "123 Main Street", "1220 Wharf St", "47B Maple Ave" — number + words + suffix.
const STREET_LINE_RE = new RegExp(
  `\\b\\d{1,6}[a-z]?\\s+(?:[\\w'.-]+\\s+){0,5}${STREET_SUFFIX}\\b`,
  "i"
);

// A figure that is unambiguously money: currency symbol/code prefix, or a
// label-prefixed amount. Captures the numeric portion (with optional k/m).
const CURRENCY_FIGURE_RE =
  /(?:\$|cad\s*\$?|usd\s*\$?)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?\b/i;

const VALUE_LABEL_RE =
  /\b(?:budget|project budget|estimated budget|estimated value|estimate value|approximate budget|approx budget|price range|ballpark)\b[^\n$0-9]{0,20}(\$?\s*\d{1,3}(?:,\d{3})+|\$?\s*\d+(?:\.\d+)?)\s*([kKmM])?/i;

const PHONE_LABEL_RE = /\b(?:phone|tel|telephone|mobile|cell|call|contact (?:number|no))\b/i;
const PHONE_TOKEN_RE = /\(?\+?\d[\d\s().\-]{6,}\d/g;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extract a single best-guess address from a free-text email body.
 * Returns null unless a strong structural signal is present.
 */
export function extractAddressFromBody(
  body: string | null | undefined
): string | null {
  if (!body) return null;
  const lines = body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // 1) Explicit label line ("Address: ...") — highest confidence.
  for (const line of lines) {
    const labelled = line.match(ADDRESS_LABEL_RE);
    if (labelled) {
      const value = cleanLine(labelled[1]);
      // Require the labelled value to itself look address-shaped (has a digit
      // and is not a bare URL/email) to avoid "Location: remote".
      if (
        value.length >= 6 &&
        value.length <= 200 &&
        /\d/.test(value) &&
        !/@/.test(value) &&
        !/^https?:\/\//i.test(value)
      ) {
        return value;
      }
    }
  }

  // 2) A street-number + street-suffix line.
  for (const line of lines) {
    if (line.length > 200) continue;
    if (/@/.test(line) || /^https?:\/\//i.test(line)) continue;
    if (STREET_LINE_RE.test(line)) {
      return cleanLine(line);
    }
  }

  // 3) A line containing a postal/ZIP code (and at least one word + a number,
    //    to avoid matching a lone 5-digit invoice number).
  for (const line of lines) {
    if (line.length > 200) continue;
    if (/@/.test(line) || /^https?:\/\//i.test(line)) continue;
    if (CA_POSTAL_RE.test(line)) {
      return cleanLine(line);
    }
  }

  return null;
}

function figureToNumber(
  digits: string,
  suffix: string | undefined
): number | null {
  const amount = Number(digits.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const s = suffix?.toLowerCase();
  const multiplier = s === "m" ? 1_000_000 : s === "k" ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

/**
 * Extract a single estimated dollar value from a free-text email body.
 * Requires a currency-prefixed figure or an explicit budget/value label.
 */
export function extractEstimatedValueFromBody(
  body: string | null | undefined
): number | null {
  if (!body) return null;
  const text = body.replace(/ /g, " ");

  // 1) Explicit budget/value label.
  const labelled = text.match(VALUE_LABEL_RE);
  if (labelled) {
    const value = figureToNumber(labelled[1], labelled[2]);
    if (value != null) return value;
  }

  // 2) Currency-prefixed figure anywhere in the body.
  const currency = text.match(CURRENCY_FIGURE_RE);
  if (currency) {
    const value = figureToNumber(currency[1], currency[2]);
    if (value != null) return value;
  }

  return null;
}

/**
 * Extract a single phone number from a free-text email body.
 * Prefers a labelled phone line; otherwise takes the first valid token.
 */
export function extractPhoneFromBody(
  body: string | null | undefined
): string | null {
  if (!body) return null;
  const text = body.replace(/ /g, " ");

  const fromTokens = (segment: string): string | null => {
    for (const match of segment.matchAll(PHONE_TOKEN_RE)) {
      const token = cleanLine(match[0]);
      const digits = digitCount(token);
      if (digits >= 10 && digits <= 15) return token;
    }
    return null;
  };

  // 1) A line that mentions phone/tel/mobile — highest confidence.
  const lines = text.split(/\n+/);
  for (const line of lines) {
    if (PHONE_LABEL_RE.test(line)) {
      const found = fromTokens(line);
      if (found) return found;
    }
  }

  // 2) First valid phone-shaped token anywhere.
  return fromTokens(text);
}
