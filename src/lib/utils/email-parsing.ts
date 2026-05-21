/**
 * Email parsing utilities — shared between AI classification and UI rendering.
 *
 * Display-path layering (thread detail). Each layer is a fallback for the
 * previous; first one that fires wins. Layers are additive — the route
 * composes them in this order:
 *   1. Provider-native (M365 uniqueBody / Gmail HTML-first stripping in the
 *      provider), yielding `bodyTextClean` on NormalizedEmail.
 *   2. `stripQuotedContent` — regex over plain text (this file).
 *   3. `stripPriorMessageOverlap` — cross-message diff across the thread.
 *
 * - htmlToPlainText: strips HTML (including <style>/<script> blocks with contents)
 * - stripQuotedHtml: removes quoted-block HTML markers BEFORE text conversion
 * - stripQuotedContent: removes quoted reply chains from PLAIN text
 *     (>, >>, "On ... wrote:", Outlook headers, etc.)
 * - stripPriorMessageOverlap: safety net — subtracts verbatim older message
 *     bodies that got inlined into a later message
 * - extractEmailAddress: pulls raw email from RFC822 "Name <email>" format
 * - isCommonEmailDomain: identifies shared providers where domain matching is meaningless
 */

// ─── HTML → plain text ─────────────────────────────────────────────────────
// Email bodies often arrive as marketing-grade HTML: inline <style> blocks,
// Outlook conditional comments, zero-width entities. A naive tag strip leaves
// the CSS content behind because `<[^>]+>` only matches the `<style>` and
// `</style>` tags themselves, not the rule block between them.

/**
 * Convert an HTML email body to plain text.
 *
 * Strips `<script>`, `<style>`, `<head>`, `<noscript>` blocks *with their
 * contents*, HTML comments (including Outlook conditionals), and all remaining
 * tags. Preserves paragraph structure by converting block-level closing tags
 * and `<br>` to newlines, and `<li>` to `- ` bullets.
 *
 * Idempotent on plain text: returns the input unchanged if no `<` is present.
 */
export function htmlToPlainText(raw: string): string {
  if (!raw || !raw.includes("<")) return raw;
  return raw
    // Block-level content containers — must strip with their contents,
    // otherwise CSS/JS/metadata leaks through the general tag regex below.
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    // Structural tags become newlines so paragraphs don't merge into a blob
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    // Strip any other remaining tag (including Outlook `<![if]>` / `<![endif]>`)
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    // Zero-width joiners used to obscure text in promotional emails
    .replace(/&#x200[cdef];/gi, "")
    .replace(/&zwnj;/gi, "")
    .replace(/&zwj;/gi, "")
    // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

// ─── HTML quote stripping ──────────────────────────────────────────────────
// Runs BEFORE htmlToPlainText so structural quote markers survive. Every
// major mail client wraps the prior-message chain in an identifiable element:
// <blockquote> (RFC-ish), <div class="gmail_quote"> (Gmail), <div
// id="divRplyFwdMsg"> (Outlook web), <div id="OLK_SRC_BODY_SECTION"> (Outlook
// desktop), <div class="yahoo_quoted"> (Yahoo), <div class="protonmail_quote">
// (ProtonMail), <div class="moz-cite-prefix"> (Thunderbird).
//
// Non-greedy regex fails on nested <div> because it halts at the first
// </div>, so we walk the string counting depth on matched element types.

/**
 * True when the char immediately after a prospective tag needle is a real
 * tag-boundary character — i.e. the match is `<div>` / `<div ` / `<div\n`
 * / `</div>` and NOT `<divider>` / `</divx>` / other word-continuations.
 * Critical for both opens and closes: without this the depth counter
 * ticks on bogus matches like `</divider>` and we silently eat body text.
 */
function isTagBoundary(ch: string | undefined, isOpen: boolean): boolean {
  if (ch === undefined) return false;
  if (ch === ">" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  // Opens only: `<div/>` is a (rare) self-closing form; `/` is a boundary.
  if (isOpen && ch === "/") return true;
  return false;
}

/**
 * Find the next real occurrence of `needle` in `lower` starting at `from`,
 * where "real" means the char after the needle is a tag boundary (per
 * isTagBoundary). Returns -1 when no valid match remains. Walks past
 * false matches one character at a time — cheap because false matches
 * are rare in practice.
 */
function findTagNeedle(
  lower: string,
  needle: string,
  from: number,
  isOpen: boolean
): number {
  let pos = from;
  while (pos < lower.length) {
    const idx = lower.indexOf(needle, pos);
    if (idx === -1) return -1;
    if (isTagBoundary(lower[idx + needle.length], isOpen)) return idx;
    pos = idx + 1;
  }
  return -1;
}

function stripElementByTagName(html: string, tagName: string): string {
  const tag = tagName.toLowerCase();
  const openNeedle = `<${tag}`;
  const closeNeedle = `</${tag}`;

  let result = "";
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    const openIdx = findTagNeedle(lower, openNeedle, i, true);
    if (openIdx === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, openIdx);

    // Walk forward to find the matching close, respecting depth.
    const tagEnd = lower.indexOf(">", openIdx);
    if (tagEnd === -1) {
      // Malformed — drop the rest.
      break;
    }
    let depth = 1;
    let pos = tagEnd + 1;
    while (pos < html.length && depth > 0) {
      const nextOpen = findTagNeedle(lower, openNeedle, pos, true);
      const nextClose = findTagNeedle(lower, closeNeedle, pos, false);
      if (nextClose === -1) {
        // Unclosed — eat to end.
        pos = html.length;
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openNeedle.length;
      } else {
        depth--;
        const closeEnd = lower.indexOf(">", nextClose);
        pos = closeEnd === -1 ? html.length : closeEnd + 1;
      }
    }
    i = pos;
  }

  return result;
}

function stripDivByAttribute(
  html: string,
  attrName: "id" | "class",
  attrValueTest: (value: string) => boolean
): string {
  const openNeedle = "<div";
  const closeNeedle = "</div";
  let result = "";
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    const openIdx = findTagNeedle(lower, openNeedle, i, true);
    if (openIdx === -1) {
      result += html.slice(i);
      break;
    }
    const tagEnd = html.indexOf(">", openIdx);
    if (tagEnd === -1) {
      result += html.slice(i);
      break;
    }
    const openTag = html.slice(openIdx, tagEnd + 1);
    // Extract the target attribute value, tolerating single- or double-quoted.
    const attrRE = new RegExp(`\\b${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
    const m = openTag.match(attrRE);
    const value = m ? (m[2] ?? m[3] ?? "") : "";

    result += html.slice(i, openIdx);

    if (value && attrValueTest(value)) {
      // Strip this div and everything until its matching </div>.
      let depth = 1;
      let pos = tagEnd + 1;
      while (pos < html.length && depth > 0) {
        const nextOpen = findTagNeedle(lower, openNeedle, pos, true);
        const nextClose = findTagNeedle(lower, closeNeedle, pos, false);
        if (nextClose === -1) {
          pos = html.length;
          break;
        }
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + openNeedle.length;
        } else {
          depth--;
          const closeEnd = lower.indexOf(">", nextClose);
          pos = closeEnd === -1 ? html.length : closeEnd + 1;
        }
      }
      i = pos;
    } else {
      // Keep this div open tag, advance past it so nested divs are still scanned.
      result += openTag;
      i = tagEnd + 1;
    }
  }

  return result;
}

/**
 * Strip quoted-content HTML markers BEFORE running htmlToPlainText.
 * Idempotent on plain text (returns input unchanged if no `<` present).
 *
 * Known markers handled:
 *   - <blockquote>           — generic RFC-style quote
 *   - <div class="gmail_quote*"> — Gmail web + mobile
 *   - <div id="divRplyFwdMsg">    — Outlook web reply/forward
 *   - <div id="OLK_SRC_BODY_SECTION"> — Outlook desktop
 *   - <div class="*OutlookMessageHeader*"> — Outlook headers
 *   - <div class="*yahoo_quoted*">
 *   - <div class="*protonmail_quote*">
 *   - <div class="*moz-cite-prefix*">      — Thunderbird cite line
 */
export function stripQuotedHtml(html: string): string {
  if (!html || !html.includes("<")) return html;

  let result = html;

  // Element-by-tag: blockquote (and its entire contents).
  result = stripElementByTagName(result, "blockquote");

  // Class-based div strippers — match if attribute contains token.
  const classMatchers: Array<(v: string) => boolean> = [
    (v) => /\bgmail_quote\b/i.test(v),
    (v) => /\bOutlookMessageHeader\b/i.test(v),
    (v) => /\byahoo_quoted\b/i.test(v),
    (v) => /\bprotonmail_quote\b/i.test(v),
    (v) => /\bmoz-cite-prefix\b/i.test(v),
  ];
  for (const test of classMatchers) {
    result = stripDivByAttribute(result, "class", test);
  }

  // ID-based div strippers — exact match.
  const idMatchers: Array<(v: string) => boolean> = [
    (v) => v === "divRplyFwdMsg",
    (v) => v === "OLK_SRC_BODY_SECTION",
  ];
  for (const test of idMatchers) {
    result = stripDivByAttribute(result, "id", test);
  }

  return result;
}

// ─── Common email domains ──────────────────────────────────────────────────
// Domain matching for outbound detection is meaningless on shared providers —
// everyone has @gmail.com. Only match domains for custom/business addresses.

const COMMON_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.ca", "yahoo.co.uk", "yahoo.com.au",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "ymail.com",
  "shaw.ca", "telus.net", "rogers.com", "bell.net",
]);

export function isCommonEmailDomain(domain: string): boolean {
  return COMMON_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// ─── Quote markers ─────────────────────────────────────────────────────────
// All patterns run against \n-normalized text (no \r).

const QUOTE_MARKERS = [
  // Gmail: "On Mon, Jan 15, 2026 at 3:45 PM John Smith <john@example.com> wrote:"
  /^On .{10,80} wrote:\s*$/m,
  // Gmail line-wrapped: "On ... <email>\nwrote:" (wrote: on next line)
  /^On .{10,120}>[ \t]*\nwrote:/m,
  // Outlook: "-----Original Message-----"
  /^-{3,}\s*Original Message\s*-{3,}/mi,
  // Outlook: "From: ... Sent: ... To: ..."
  /^From:\s.+\nSent:\s.+\nTo:\s/m,
  // Apple Mail: "On Jan 15, 2026, at 3:45 PM, John Smith wrote:"
  /^On .{10,60}, at .{5,20}, .{2,60} wrote:/m,
  // Forwarded message
  /^-{5,}\s*Forwarded message\s*-{5,}/mi,
  // Begin forwarded message
  /^Begin forwarded message:/mi,
  // Generic ">" quote blocks (3+ consecutive lines starting with >)
  /(?:^>.*\n){3,}/m,
  // Outlook web: "________________________________\nFrom:"
  /^_{10,}\s*\nFrom:/m,
  // "Get Outlook for iOS/Android" footer
  /^Get Outlook for (?:iOS|Android)/m,
];

/**
 * Strip quoted reply content from an email body.
 * Returns only the NEW content from this specific message.
 */
export function stripQuotedContent(body: string): string {
  if (!body) return body;

  // Normalize line endings — Gmail/M365 APIs may return \r\n
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let earliest = normalized.length;

  for (const marker of QUOTE_MARKERS) {
    const match = normalized.match(marker);
    if (match?.index !== undefined && match.index < earliest) {
      earliest = match.index;
    }
  }

  // If we found a quote marker, trim to just the content before it
  if (earliest < normalized.length) {
    const stripped = normalized.slice(0, earliest).trimEnd();
    // Don't return empty — if the entire message IS a quote, keep a small preview
    return stripped.length > 20 ? stripped : normalized.slice(0, 500);
  }

  return normalized;
}

// ─── Cross-message overlap stripping ───────────────────────────────────────
// Safety net for cases where HTML + regex passes miss a quoted chain. If a
// newer message's body contains a chunk of an older message verbatim (modulo
// whitespace), that chunk is a quoted reply and should be removed from the
// display body.
//
// We signature-match on the first ~140 chars of the older body rather than
// full-body diff because (a) senders sometimes tweak the quoted block (>
// prefixes, indent tweaks) and (b) first-N-chars is a strong uniqueness
// signal with cheap scanning.

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Map a position in a whitespace-normalized string back to the equivalent
 * position in the original. Walks the original counting "normalized
 * characters" (each non-space char is 1; each whitespace run is 1) until it
 * has consumed `normalizedIdx` of them.
 */
function mapNormalizedIndex(original: string, normalizedIdx: number): number {
  if (normalizedIdx <= 0) return 0;
  let origPos = 0;
  let normCount = 0;
  let inSpace = false;
  // Skip leading whitespace in original — `trim()` removes it from normalized.
  while (origPos < original.length && /\s/.test(original[origPos])) origPos++;
  while (origPos < original.length && normCount < normalizedIdx) {
    const c = original[origPos];
    if (/\s/.test(c)) {
      if (!inSpace) {
        normCount++;
        inSpace = true;
      }
    } else {
      normCount++;
      inSpace = false;
    }
    origPos++;
  }
  return origPos;
}

/**
 * Trim `body` at the earliest point where it repeats a verbatim signature
 * from any message in `priorBodies`. Returns `body` unchanged if no overlap
 * is found or overlap starts too close to the top (we won't leave an empty
 * message).
 *
 * Guardrails against false positives on boilerplate openers
 * ("Hi [name], hope you're well…") which easily hit 60-char matches:
 *   - MIN_SIGNATURE_LEN is high enough (120) that shared openers alone
 *     can't trigger a cut; the prior body must be substantively similar.
 *   - The match must land in the *latter half* of the current body.
 *     A real quoted chain sits BELOW the new reply; a coincidental
 *     opener-match in the top half means the user is writing fresh
 *     content that happens to start the same way.
 */
export function stripPriorMessageOverlap(
  body: string,
  priorBodies: string[]
): string {
  if (!body || priorBodies.length === 0) return body;

  const MIN_SIGNATURE_LEN = 120;
  const SIGNATURE_LEN = 180;
  const MIN_REMAINING = 20;

  const normBody = normalizeWhitespace(body);
  // Invariant: only strip when the overlap starts in the second half of
  // the normalized body. Below that, we're almost certainly looking at a
  // false match (shared opener phrase) rather than a real quoted chain.
  const minNormIdx = Math.floor(normBody.length / 2);

  let earliestCut = body.length;

  for (const prior of priorBodies) {
    if (!prior) continue;
    const normPrior = normalizeWhitespace(prior);
    if (normPrior.length < MIN_SIGNATURE_LEN) continue;

    const sig = normPrior.slice(0, Math.min(SIGNATURE_LEN, normPrior.length));
    const normIdx = normBody.indexOf(sig);
    if (normIdx === -1) continue;
    if (normIdx < minNormIdx) continue;

    const origIdx = mapNormalizedIndex(body, normIdx);
    if (origIdx >= MIN_REMAINING && origIdx < earliestCut) {
      earliestCut = origIdx;
    }
  }

  if (earliestCut < body.length) {
    return body.slice(0, earliestCut).trimEnd();
  }
  return body;
}

// ─── Email address extraction ──────────────────────────────────────────────

/**
 * Extract the raw email address from an RFC822 "Display Name <email>" string.
 * If the string is already a plain email, returns it as-is.
 *
 * Examples:
 *   "Jackson Sweet <jack@ops.com>"  →  "jack@ops.com"
 *   "jack@ops.com"                  →  "jack@ops.com"
 *   "<jack@ops.com>"                →  "jack@ops.com"
 */
export function extractEmailAddress(from: string | null | undefined): string {
  if (!from) return "";
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

// ─── Forward detection (shared by deterministic-internal-rule) ──────────────

const FORWARD_SUBJECT_RE = /^\s*fwd?:\s*/i;
// Each marker tolerates leading "> " quote prefixes — when a forward gets
// re-forwarded (or replied to with quoting on), every line of the inlined
// block ends up with `> ` in front and the bare anchored regex misses.
const FORWARDED_MESSAGE_BODY_RE = /^>?\s*-{5,}\s*Forwarded message\s*-{5,}/mi;
const BEGIN_FORWARDED_BODY_RE = /^>?\s*Begin forwarded message:/mi;
// Outlook/M365: a contiguous "From: …\nSent: …\nTo: …" block at the start
// of the inlined upstream message. Gmail produces this shape too when the
// user picks "Show original" before forwarding. Same `> `-tolerant prefix.
const OUTLOOK_FORWARD_HEADER_BLOCK_RE =
  /^>?\s*From:\s.+\n>?\s*Sent:\s.+\n>?\s*To:\s/m;

/**
 * True when the thread's subject or first-message body indicates a
 * forward — subject starts with "Fwd:" / "FW:" / "Fw:" (case-insensitive,
 * whitespace-tolerant), OR body contains a standard forward marker.
 *
 * Used by tryDeterministicInternal to bail out of the "all participants are
 * internal → INTERNAL" shortcut when the thread's semantic content comes
 * from a forwarded message rather than the participants themselves.
 */
export function isForwardMarker(subject: string, bodyText: string): boolean {
  if (FORWARD_SUBJECT_RE.test(subject)) return true;
  if (FORWARDED_MESSAGE_BODY_RE.test(bodyText)) return true;
  if (BEGIN_FORWARDED_BODY_RE.test(bodyText)) return true;
  return false;
}

// ─── Contact-form / forwarded-sender extraction ────────────────────────────
//
// When the operator forwards a lead from one of their own mailboxes (e.g.
// victoria@canprodeckandrail.com auto-forwards to canprojack@gmail.com), the
// outer From header on the inbound copy is the operator's own address — the
// real customer email is buried in the body of the forward as "From: Name
// <customer@example.com>". `latest_sender_email` ends up pointing at the
// operator instead of the customer, which silently filters the thread out
// of every "is this from a real lead" check (Phase C drafts, the inbox
// FROM_NEW_SENDER label, the lead-archive prompt).
//
// Detection is permissive — three independent markers each suffice:
//   1. Subject starts with Fwd: / FW: / Forwarded:
//   2. Body has "---------- Forwarded message ---------" (Gmail) or
//      "Begin forwarded message:" (Apple Mail) preamble
//   3. Body has a header block "From: …\nSent: …\nTo: …" near the top
//      (Outlook desktop / M365 inline forward)
//
// Extraction parses the FIRST `From:` line that appears after the forward
// marker (or — if no marker is present — the first one in the first 2000
// chars, which is the conservative reach for an Outlook-style block).

/** Plain `<email>` extractor over a single From: line. Tolerates "Name
 *  <email>" (RFC822), bare `email`, and "Name (Title) <email>". */
function parseAddressFromHeaderLine(line: string): string | null {
  if (!line) return null;
  const angle = line.match(/<([^>\s]+@[^>\s]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = line.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare ? bare[0].trim().toLowerCase() : null;
}

function parseDisplayNameFromHeaderLine(line: string): string | null {
  if (!line) return null;
  const angle = line.match(/^\s*"?([^"<]+?)"?\s*<[^>]+@[^>]+>/);
  const candidate = angle?.[1]?.trim();
  if (!candidate || candidate.includes("@")) return null;
  return candidate;
}

const FORM_SUBMISSION_SUBJECT_RE =
  /\b(?:got a new submission|new form entry|new contact form|new submission|form submission|new inquiry|new lead|contact us form|quote request|free quote form)\b/i;
const FORM_SUBMISSION_BODY_MARKERS = [
  /\bsubmission summary\b/i,
  /\bsite visitor just submitted your form\b/i,
  /\bsubmitted your form\b/i,
  /\bnew contact form submission\b/i,
  /\bcontact form submission\b/i,
  /\bview submissions\b/i,
  /\bthis email was sent as a notification from this site\b/i,
];

const CONTACT_FORM_NAME_LABELS = [
  "full name",
  "name",
  "your name",
  "contact name",
  "first and last name",
];
const CONTACT_FORM_FIRST_NAME_LABELS = ["first name", "given name"];
const CONTACT_FORM_LAST_NAME_LABELS = ["last name", "surname", "family name"];
const CONTACT_FORM_EMAIL_LABELS = [
  "email",
  "email address",
  "e-mail",
  "e-mail address",
  "your email",
  "reply-to",
];
const CONTACT_FORM_PHONE_LABELS = [
  "phone",
  "phone number",
  "telephone",
  "mobile",
  "cell",
  "contact number",
];
const CONTACT_FORM_MESSAGE_LABELS = [
  "message",
  "comments",
  "comment",
  "how can we help?",
  "project details",
  "tell us about your project",
  "description",
  "details",
  "inquiry",
];
const CONTACT_FORM_STOP_LABELS = [
  ...CONTACT_FORM_NAME_LABELS,
  ...CONTACT_FORM_FIRST_NAME_LABELS,
  ...CONTACT_FORM_LAST_NAME_LABELS,
  ...CONTACT_FORM_EMAIL_LABELS,
  ...CONTACT_FORM_PHONE_LABELS,
  ...CONTACT_FORM_MESSAGE_LABELS,
  "address",
  "company",
  "subject",
  "view submissions",
  "if you think this submission is suspicious",
  "this email was sent as a notification from this site",
];

export interface ContactFormSubmissionIdentity {
  name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
}

export interface EffectiveSenderIdentity {
  email: string;
  source: "contact_form" | "forwarded" | "from_header";
  name?: string | null;
  phone?: string | null;
  message?: string | null;
}

function normalizeFormSubmissionText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/[^\S\n]+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderedContactFormLabels(labels: string[]): string[] {
  return [...labels].sort((a, b) => b.length - a.length);
}

function lineStartsWithLabel(line: string, labels: string[]): boolean {
  const trimmed = line.trim();
  return orderedContactFormLabels(labels).some((label) => {
    const labelRe = new RegExp(`^${escapeRegExp(label)}(?:\\s*:|\\s*$)`, "i");
    return labelRe.test(trimmed);
  });
}

function cleanContactFormValue(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\s+\n/g, "\n")
    .trim();
  return cleaned || null;
}

function extractFormField(text: string, labels: string[]): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    for (const label of orderedContactFormLabels(labels)) {
      const labelRe = new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*(.*)$`, "i");
      const match = line.match(labelRe);
      if (!match) continue;

      const inline = cleanContactFormValue(match[1] ?? "");
      if (inline) return inline;

      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) {
          if (collected.length > 0) collected.push("");
          continue;
        }
        if (lineStartsWithLabel(next, CONTACT_FORM_STOP_LABELS)) break;
        collected.push(next);
      }
      return cleanContactFormValue(collected.join("\n"));
    }
  }
  return null;
}

function looksLikeContactFormSubmission(subject: string, body: string): boolean {
  if (FORM_SUBMISSION_SUBJECT_RE.test(subject ?? "")) return true;
  return FORM_SUBMISSION_BODY_MARKERS.some((marker) => marker.test(body));
}

function isPlatformOrSystemEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.startsWith("noreply@") ||
    lower.startsWith("no-reply@") ||
    lower.startsWith("donotreply@") ||
    lower.startsWith("mailer-daemon@") ||
    lower.startsWith("postmaster@") ||
    lower.includes("notifications@") ||
    lower.includes("wix-forms.com") ||
    lower.includes("wixforms.com") ||
    lower.includes("jotform.com") ||
    lower.includes("typeform.com") ||
    lower.includes("formstack.com") ||
    lower.includes("wpforms.com") ||
    lower.includes("squarespace.com")
  );
}

function extractHeaderLine(text: string, header: string): string | null {
  const re = new RegExp(`^>?\\s*${escapeRegExp(header)}\\s*:\\s*(.+)$`, "im");
  return text.match(re)?.[1]?.trim() ?? null;
}

function localPartName(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Extract the real submitter from common website/contact-form notification
 * bodies. Handles Wix-style forwarded notifications (`Reply-To:` plus a
 * "Submission summary" block) and simpler label/value bodies from WordPress,
 * Squarespace, Jotform, Typeform, and custom forms.
 */
export function extractContactFormSubmission(
  subject: string,
  bodyText: string,
): ContactFormSubmissionIdentity | null {
  if (!bodyText) return null;
  const body = normalizeFormSubmissionText(bodyText);
  if (!looksLikeContactFormSubmission(subject ?? "", body)) return null;

  const emailField = extractFormField(body, CONTACT_FORM_EMAIL_LABELS);
  const replyToLine = extractHeaderLine(body, "Reply-To");
  const replyToEmail = replyToLine ? parseAddressFromHeaderLine(replyToLine) : null;
  const fieldEmail = emailField ? parseAddressFromHeaderLine(emailField) : null;

  let email = fieldEmail ?? replyToEmail ?? null;
  if (!email) {
    const candidates = Array.from(
      body.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g),
      (match) => match[0].toLowerCase(),
    ).filter((candidate) => !isPlatformOrSystemEmail(candidate));
    email = candidates[0] ?? null;
  }
  if (!email || isPlatformOrSystemEmail(email)) return null;

  const firstName = extractFormField(body, CONTACT_FORM_FIRST_NAME_LABELS);
  const lastName = extractFormField(body, CONTACT_FORM_LAST_NAME_LABELS);
  const fullName = extractFormField(body, CONTACT_FORM_NAME_LABELS);
  const replyToName = replyToLine ? parseDisplayNameFromHeaderLine(replyToLine) : null;
  const name =
    cleanContactFormValue(fullName) ??
    cleanContactFormValue([firstName, lastName].filter(Boolean).join(" ")) ??
    cleanContactFormValue(replyToName) ??
    localPartName(email) ??
    null;

  return {
    name,
    email,
    phone: cleanContactFormValue(extractFormField(body, CONTACT_FORM_PHONE_LABELS)),
    message: cleanContactFormValue(extractFormField(body, CONTACT_FORM_MESSAGE_LABELS)),
  };
}

/**
 * Extract the upstream sender email from a forwarded message body.
 *
 * Returns the lowercased email address found in the FIRST `From:` line that
 * lives inside (or near) a forwarded block. Returns null when no forward
 * marker is detected, or when a marker exists but no parseable email
 * follows it.
 *
 * Bodies are normalized to LF newlines before scanning so Gmail/M365's
 * mixed CRLF/LF output doesn't break the multi-line regexes. The search
 * is bounded to the first 4000 chars after the marker — well past where any
 * real "From:" line would appear and short enough that pathological bodies
 * can't pin a CPU.
 */
export function extractForwardedSender(
  subject: string,
  bodyText: string,
): string | null {
  if (!bodyText) return null;
  const body = bodyText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Locate where the forwarded block starts. Each marker has its own
  // anchor so we can begin scanning AFTER the preamble for the upstream
  // From: line — important on Outlook bodies where the operator's own
  // commentary may sit above the forwarded block and contain a stray
  // From: their-name reference that we want to skip past.
  const markers: RegExp[] = [
    FORWARDED_MESSAGE_BODY_RE,
    BEGIN_FORWARDED_BODY_RE,
    OUTLOOK_FORWARD_HEADER_BLOCK_RE,
  ];

  let scanFrom = -1;
  for (const m of markers) {
    const match = body.match(m);
    if (match?.index !== undefined && (scanFrom === -1 || match.index < scanFrom)) {
      scanFrom = match.index;
    }
  }

  // If subject says forward but no body marker fired, scan from the top —
  // some clients send a forward with the subject set to "Fwd: …" but no
  // explicit body preamble (just a header block at the very top).
  if (scanFrom === -1 && FORWARD_SUBJECT_RE.test(subject ?? "")) {
    scanFrom = 0;
  }
  if (scanFrom === -1) return null;

  const window = body.slice(scanFrom, scanFrom + 4000);
  // First "From:" line inside the window. The leading-anchor `^` is
  // important — bodies often contain "from:" inside prose ("a note from:
  // the field crew") that should not match. The optional `>?\s*` lets us
  // also pick up `> From: …` for re-forwarded / quoted bodies.
  const fromLineMatch = window.match(/^>?\s*From:\s*(.+)$/m);
  if (!fromLineMatch) return null;
  return parseAddressFromHeaderLine(fromLineMatch[1]);
}

/**
 * Pick the effective "real sender" of an inbound message.
 *
 * Priority:
 *   1. Forwarded upstream sender, when extractable AND not equal to the
 *      operator's own connection address — recovers the customer email
 *      buried in a forwarded lead.
 *   2. The raw From: header otherwise — current behavior for non-forwarded
 *      mail.
 *
 * `connectionEmail` is the connected mailbox (operator's own) and is used
 * only for the "don't return our own address as the upstream" guard. Pass
 * lowercased; the comparison is case-sensitive on the assumption the
 * caller normalized.
 */
export function resolveEffectiveSenderEmail(params: {
  fromHeader: string;
  subject: string;
  bodyText: string;
  connectionEmail: string | null;
}): EffectiveSenderIdentity {
  const headerEmail = extractEmailAddress(params.fromHeader).toLowerCase();
  const form = extractContactFormSubmission(
    params.subject ?? "",
    params.bodyText ?? "",
  );
  if (form && form.email !== params.connectionEmail?.toLowerCase()) {
    return {
      email: form.email,
      source: "contact_form",
      name: form.name,
      phone: form.phone,
      message: form.message,
    };
  }

  const fwd = extractForwardedSender(params.subject ?? "", params.bodyText ?? "");
  if (fwd && fwd !== params.connectionEmail?.toLowerCase()) {
    return { email: fwd, source: "forwarded" };
  }
  return { email: headerEmail, source: "from_header" };
}
