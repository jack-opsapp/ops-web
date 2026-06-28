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

// "123 Main Street", "1220 Wharf St", "47B Maple Ave" — number + at
// least one street-name word + suffix. Requiring the name word prevents project
// measurements such as "224 sq ft" from matching the "sq" street suffix.
const STREET_LINE_RE = new RegExp(
  `\\b\\d{1,6}[a-z]?\\s+(?:[\\w'.-]+\\s+){1,5}${STREET_SUFFIX}\\b`,
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

export interface PhoneExtractionOptions {
  /**
   * Numbers that must never be returned as a client phone. Feed this with
   * company/user/operator numbers so outbound signatures cannot pollute leads.
   */
  excludedPhones?: Array<string | null | undefined>;
}

// Lines that are almost always a company footer / list-management boilerplate
// rather than a customer job-site address. We refuse to harvest an address from
// any line that smells like one of these, so a sender's own footer or an
// unsubscribe block never fills the customer address field.
const FOOTER_LINE_RE =
  /\b(?:unsubscribe|opt[\s-]?out|manage (?:your )?preferences|view (?:this|in) browser|privacy policy|all rights reserved|©|\(c\)|reg\.?(?:istered)? office|head office|mailing address|return address|no longer wish to receive|update your (?:email )?preferences)\b/i;

// A currency figure that fills a blank value should look like a real job/quote
// amount. The unlabelled-currency fallback only fires when the surrounding text
// carries one of these intent words, killing marketing ("save up to $5,000") and
// receipt ("order total: $1,299") false positives.
const VALUE_CONTEXT_RE =
  /\b(?:quote|quoted|estimate|estimated|budget|project|job|scope|proposal|bid|cost(?:s|ing)?|invoice for the (?:work|job|project)|to complete|labou?r and materials?|all[\s-]?in)\b/i;

// Below this, a figure is almost certainly a fee/tax/line-item, not a job value.
const ESTIMATED_VALUE_FLOOR = 100;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanAddressCandidate(value: string): string {
  return cleanLine(value)
    .replace(/\s+([,])/g, "$1")
    .replace(/[.;:,\s]+$/g, "")
    .trim();
}

function sanitizeAddressTail(value: string): string {
  const withoutPhones = value.replace(PHONE_TOKEN_RE, " ");
  const beforeClosingNoise = withoutPhones.split(
    /\b(?:thanks|thank you|cell|mobile|phone|tel|telephone|sent from|regards|cheers|sincerely)\b/i
  )[0];
  return cleanAddressCandidate(beforeClosingNoise);
}

function addressTail(afterStreet: string): string {
  const commaTail = afterStreet.match(/^\s*,\s*([^.!?\n]{2,100})/);
  if (commaTail) {
    const tail = sanitizeAddressTail(commaTail[1]);
    return tail ? `, ${tail}` : "";
  }

  const localityTail = afterStreet.match(
    /^\s+(in|at|near)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4})\b/
  );
  if (localityTail) {
    const tail = sanitizeAddressTail(localityTail[2]);
    return tail ? ` ${localityTail[1].toLowerCase()} ${tail}` : "";
  }

  return "";
}

function extractStreetAddressCandidate(line: string): string | null {
  const match = STREET_LINE_RE.exec(line);
  if (!match) return null;
  const start = match.index ?? 0;
  const end = start + match[0].length;
  const candidate = `${match[0]}${addressTail(line.slice(end))}`;
  const cleaned = cleanAddressCandidate(candidate);
  return cleaned.length >= 6 ? cleaned : null;
}

function addressShapedCandidate(value: string): string | null {
  const street = extractStreetAddressCandidate(value);
  if (street) return street;
  if (!CA_POSTAL_RE.test(value)) return null;
  return cleanAddressCandidate(value);
}

function normalizePhoneForComparison(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function excludedPhoneSet(options: PhoneExtractionOptions | undefined): Set<string> {
  const excluded = new Set<string>();
  for (const raw of options?.excludedPhones ?? []) {
    const normalized = normalizePhoneForComparison(raw);
    if (normalized) excluded.add(normalized);
  }
  return excluded;
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
      const value = cleanAddressCandidate(labelled[1]);
      const shaped = addressShapedCandidate(value);
      // Require the labelled value to itself look address-shaped. A bare digit
      // is not enough; AI sometimes echoes project measurements into the
      // address field ("224 sq ft"), and fill-blank enrichment would then
      // persist the bad value as canonical.
      if (
        shaped &&
        value.length >= 6 &&
        value.length <= 200 &&
        !/@/.test(value) &&
        !/^https?:\/\//i.test(value)
      ) {
        return shaped;
      }
    }
  }

  // 2) A street-number + street-suffix line — skip footer/unsubscribe lines so
  //    a sender's own office address or list-management block is not harvested
  //    as the customer's job-site address.
  for (const line of lines) {
    if (line.length > 200) continue;
    if (/@/.test(line) || /^https?:\/\//i.test(line)) continue;
    if (FOOTER_LINE_RE.test(line)) continue;
    const candidate = extractStreetAddressCandidate(line);
    if (candidate) return candidate;
  }

  // 3) A line containing a postal/ZIP code (and at least one word + a number,
  //    to avoid matching a lone 5-digit invoice number) — same footer guard.
  for (const line of lines) {
    if (line.length > 200) continue;
    if (/@/.test(line) || /^https?:\/\//i.test(line)) continue;
    if (FOOTER_LINE_RE.test(line)) continue;
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

  // 1) Explicit budget/value label — the label itself is the intent signal, so
  //    this path stands alone.
  const labelled = text.match(VALUE_LABEL_RE);
  if (labelled) {
    const value = figureToNumber(labelled[1], labelled[2]);
    if (value != null && value >= ESTIMATED_VALUE_FLOOR) return value;
  }

  // 2) Currency-prefixed figure anywhere in the body — only trusted when the
  //    body also carries job/quote intent. Without that gate, marketing copy
  //    ("save up to $5,000") and receipts ("order total: $1,299") would harvest
  //    a bogus value into the blank field. A sub-$100 figure is treated as a
  //    fee/tax line item, not a job value, and rejected.
  if (VALUE_CONTEXT_RE.test(text)) {
    const currency = text.match(CURRENCY_FIGURE_RE);
    if (currency) {
      const value = figureToNumber(currency[1], currency[2]);
      if (value != null && value >= ESTIMATED_VALUE_FLOOR) return value;
    }
  }

  return null;
}

/**
 * Extract a single phone number from a free-text email body.
 * Prefers a labelled phone line; otherwise takes the first valid token.
 */
export function extractPhoneFromBody(
  body: string | null | undefined,
  options?: PhoneExtractionOptions
): string | null {
  if (!body) return null;
  const text = body.replace(/ /g, " ");
  const excluded = excludedPhoneSet(options);

  const fromTokens = (segment: string): string | null => {
    for (const match of segment.matchAll(PHONE_TOKEN_RE)) {
      const token = cleanLine(match[0]);
      const digits = digitCount(token);
      const comparable = normalizePhoneForComparison(token);
      if (
        digits >= 10 &&
        digits <= 15 &&
        comparable &&
        !excluded.has(comparable)
      ) {
        return token;
      }
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
