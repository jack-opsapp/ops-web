// src/lib/api/services/conversation-state/message-cleaner.ts
//
// The "thread text pollution" fix for the conversation-state layer.
//
// Produces CleanMessage.cleanBody: the NEW text of a single message with the
// quoted reply chain, any cross-message overlap, AND a trailing signature /
// footer block removed. Quote/overlap stripping reuses the shared helpers in
// `email-parsing.ts` (the documented 3-layer order). The SIGNATURE stripper is
// new — no signature stripper existed anywhere in the codebase before this.
//
// PURE: `cleanMessageBody` takes already-fetched plain data and calls no DB /
// network. It is the unit-tested core. (There is no `fetchX` wrapper here — the
// orchestrator passes the provider's pre-computed clean body + prior bodies in.)
//
// Design rule (conservative signature stripping): a signature cut must NEVER eat
// the customer's actual message. Every heuristic below is anchored to a strong
// trailing delimiter and bounded to a short "name + contact" tail. When in
// doubt, we keep the text.

import {
  htmlToPlainText,
  stripOutlookReplyHeaderBlock,
  stripPriorMessageOverlap,
  stripQuotedContentStrict,
  stripQuotedHtml,
} from "@/lib/utils/email-parsing";

// ─── Body normalization ────────────────────────────────────────────────────
//
// Every heuristic in this module and in `email-parsing.ts` is line-anchored.
// Outlook's plain-text conversion defeats line anchoring two ways at once
// (bug 7ca126d2):
//
//   1. Separator lines that LOOK blank are a single space ("\n \n \n"), so a
//      `^…$` anchor expecting an empty line never fires; and
//   2. invisible formatting marks arrive double-encoded — a UTF-8 zero-width
//      character read back through a single-byte codepage — landing mid-
//      sentence as "â€چ" and surviving all the way into a lead summary as if
//      it were evidence.
//
// Normalization therefore runs FIRST, before any stripper gets a turn.

/** Zero-width, bidi-control, and BOM code points. */
const INVISIBLE_FORMATTING_RE =
  /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * The same marks after a UTF-8 → single-byte round trip. Every form opens with
 * "â€" (the E2 80 prefix); the third character depends on the codepage the
 * mangling client used — Latin-1 leaves a C1 control, CP1252 leaves ‹ Œ Ž,
 * CP1256 leaves چ ژ, and a dropped third byte leaves the bare pair.
 *
 * Matched by EXACT third character, never a wildcard: "â€œ", "â€”" and "â€™"
 * are a mangled quote, dash and apostrophe that carry real text and must
 * survive. No bare-pair fallback: a closing quote whose third byte was
 * dropped in transit is exactly "â€" before whitespace, and eating it
 * deletes real punctuation — an invisible mark that lost its third byte is
 * indistinguishable, and keeping a stray "â€" is the cheaper error.
 */
const MOJIBAKE_INVISIBLE_RE =
  /\u00E2\u20AC[\u008B-\u008F\u0152\u017D\u2039\u0686\u0698]/g;

/**
 * Remove invisible formatting marks (encoded or double-encoded), right-trim
 * every line so a space-only line becomes a real blank, and collapse runs of
 * blank lines. Idempotent.
 */
export function normalizeBodyLines(body: string): string {
  if (!body) return body;
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(MOJIBAKE_INVISIBLE_RE, "")
    .replace(INVISIBLE_FORMATTING_RE, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00A0]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove invisible formatting marks from a single text fragment — a resolved
 * fact clause or a composed summary, where line structure is irrelevant but
 * mojibake bleed is not. Shared with the lead-summary output guard so the
 * character list lives in exactly one place.
 */
export function stripInvisibleFormatting(value: string): string {
  if (!value) return value;
  return value
    .replace(MOJIBAKE_INVISIBLE_RE, "")
    .replace(INVISIBLE_FORMATTING_RE, "");
}

export interface CleanMessageOptions {
  /** Subject line — forwarded to the contact-form-aware quote stripper. */
  subject?: string;
  /** Earlier message bodies in the thread, for cross-message overlap stripping. */
  priorBodies?: string[];
  /**
   * Provider-native clean body (M365 `uniqueBody` / Gmail HTML-first strip).
   * When present this is the authoritative quote-stripped text and is preferred
   * over re-deriving from the raw body — but it is still normalized, reply-
   * header-stripped, and signature-stripped. "Provider-clean" means the quote
   * chain is gone; it does NOT mean the reply header block, the signature card,
   * or double-encoded formatting marks are (bug 7ca126d2).
   */
  providerCleanBody?: string | null;
}

// ─── Signature / footer stripping ──────────────────────────────────────────
//
// A trailing signature block is detected by an anchor on its own line, after
// which everything is dropped. Anchors, in priority order:
//
//   1. The RFC 3676 `-- ` / `--` sig delimiter on its own line.
//   2. A device / client footer line ("Sent from my iPhone", "Get Outlook…").
//   3. A closing-word sign-off ("Thanks,", "Regards,", "Best,", …) IMMEDIATELY
//      followed by a short name + contact tail (not a long prose paragraph).
//   4. A pipe-delimited ALL-CAPS contact card ("JANE DOE | INSIDE SALES REP |")
//      whose tail is entirely card-shaped.
//   5. A run of trailing labelled footer lines ("Phone:", "Address:", …) at the
//      very end of the message.
//
// Each anchor is conservative: #3 requires the sign-off to sit on its own line
// and the following block to look like a name/contact block (short lines, or a
// line carrying a phone/email/url), so a conversational "Thanks for getting back
// to me…" mid-sentence never triggers a cut.

/** Hard sig delimiter: a line that is exactly "--" or "-- " (trailing space). */
const SIG_DELIMITER_RE = /^[ \t]*--[ \t]*$/;

/** Device / mail-client footers that begin a non-content tail. */
const CLIENT_FOOTER_RE =
  /^[ \t]*(?:sent from my (?:iphone|ipad|ipod|android|samsung|galaxy|pixel|mobile device|phone)\b.*|sent from (?:outlook for (?:ios|android)|samsung mobile|yahoo mail for (?:iphone|ipad|android))\b.*|sent via (?:outlook|gmail|yahoo mail|samsung email)\b.*|get outlook for (?:ios|android)\b.*|get the outlook app\b.*)$/i;

/** Closing words that, on their own line, open a sign-off block. */
const SIGNOFF_WORDS = [
  "thanks",
  "thank you",
  "thanks so much",
  "many thanks",
  "thanks again",
  "regards",
  "best regards",
  "kind regards",
  "warm regards",
  "best",
  "best wishes",
  "all the best",
  "cheers",
  "sincerely",
  "respectfully",
  "talk soon",
  "speak soon",
];

/** A line that is exactly a sign-off word (optionally trailed by a comma/dash). */
const SIGNOFF_LINE_RE = new RegExp(
  `^[ \\t]*(?:${SIGNOFF_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})[ \\t]*[,\\-—–]?[ \\t]*$`,
  "i"
);

/** Labelled trailing footer line: "Phone: …", "Address: …", "Mobile: …", etc. */
const LABELLED_FOOTER_RE =
  /^[ \t]*(?:phone|tel|telephone|mobile|cell|fax|address|email|e-mail|web|website|office|direct|toll[- ]?free)[ \t]*:/i;

/** A line carrying contact-shaped data (phone digits / email / url). */
const CONTACT_SHAPE_RE =
  /(?:\+?\d[\d().\s-]{6,}\d|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bhttps?:\/\/|\bwww\.)/i;
const BARE_DOMAIN_LINE_RE = /^\s*(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?\s*$/i;
const CORPORATE_SIGNATURE_KEYWORD_RE =
  /\b(?:owner|principal|president|director|designer|architect|manager|business hours?|office hours?|studio closure|suite|inc\.?|ltd\.?|corp\.?|corporation|company|collective|canpro|deck\s*&\s*rail)\b/i;
const CORPORATE_SIGNATURE_ACTION_RE =
  /\b(?:please|call|reply|respond|send|share|confirm|schedule|book|need|want|could|would|should|will|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[?!]/i;
const BARE_NAME_LINE_RE =
  /^[A-Z][A-Za-z.'’-]{1,39}(?:\s+[A-Z][A-Za-z.'’-]{1,39}){0,3}$/;
const FULL_SIGNED_NAME_RE =
  /^\p{L}[\p{L}.'’()-]{0,39}(?:\s+\p{L}[\p{L}.'’()-]{0,39}){1,3}$/u;
const NON_PERSON_NAME_TOKEN_RE =
  /^(?:and|the|this|that|these|those|should|would|could|work|works|working|team|everyone|folks|customer|client|owner|principal|president|director|designer|architect|manager|sales|support|office|admin|administrator|company|corporation|corp|inc|incorporated|ltd|limited|llc|group|collective|deck|rail|construction|services?)$/i;
const ADDRESS_SHAPE_RE =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'’-]+\s+){0,6}(?:avenue|ave|boulevard|blvd|circle|court|ct|crescent|cr|drive|dr|highway|hwy|lane|ln|place|pl|road|rd|street|st|terrace|trail|way|suite)\b/i;
const POSTSCRIPT_RE = /^\s*(?:p\.?\s*s\.?|postscript)\b/i;
const EXTENDED_SIGNATURE_FOOTER_RE =
  /^\s*(?:(?:closed weekends?)(?:\s+(?:and|&)\s+holidays?)?[.!]?|holidays?[.!]?|holiday hours?(?:\s*[:—–-].*)?|we['’]?(?:re| are)\s+social(?:\s*[:|—–-].*)?[.!]?|(?:make sure to\s+)?follow our adventures\b.{0,200}|(?:instagram|facebook|linkedin)(?:\s*[:|@—–-].*)?|(?:(?:with gratitude,\s*)?(?:we|i)\s+(?:(?:respectfully\s+)?(?:acknowledge|recognize)|(?:live|work)\b).{0,280}\b(?:traditional territory|first nations)\b.{0,160}|traditional territory acknowledgement(?:\s*[:—–-].*)?|territory (?:i|we) (?:live|work)(?:\s*[:—–-].*)?))\s*$/i;
const SPACED_BRAND_MARK_RE =
  /^\s*(?:[A-Z]\s+){3,}[A-Z](?:\s+[A-Z][A-Za-z&.'’()-]*){0,8}\s*$/;
const CREDENTIALLED_NAME_LINE_RE =
  /^\s*[A-Z][A-Za-z.'’()-]{1,39}(?:\s+[A-Z][A-Za-z.'’()-]{1,39}){1,3}(?:\s+[A-Z]{2,10}){1,4}\s*$/;
const SIGNATURE_DATE_RANGE_RE =
  /^\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:to|through|until|[-–—])\s+(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?\d{1,2}(?:st|nd|rd|th)?\s*$/i;
const INLINE_CORPORATE_SIGNATURE_RE =
  /[.!?]\s*(?:(?:kind|best|warm)\s+regards|regards|sincerely|cheers)?\s*,?\s*(?:[A-Z][A-Za-z.'’()-]*\s+){1,4}(?:(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})[\s\S]{0,320}\b(?:inc\.?|ltd\.?|corp\.?|corporation|company|owner|principal|business hours?|studio closure|canpro)\b[.!]?\s*$/i;
const COMMERCIAL_VETO_OR_REVERSAL_RE =
  /\b(?:do not|don['’]?t)\s+proceed\b|\bchanged\s+(?:my|our)\s+minds?\b|\b(?:cancel\w*|declin\w*|reject\w*|withdraw\w*|stop\w*)\b.{0,80}\b(?:quote|estimate|proposal|work|job|project|installation)\b|\b(?:deposit|payment)\b.{0,80}\b(?:revers\w*|refund\w*|chargeback|returned|sent back)\b|\b(?:revers\w*|refund\w*|chargeback|returned|sent back)\b.{0,80}\b(?:deposit|payment)\b|\b(?:postpon\w*|defer\w*|delay\w*|hold(?:ing)? off)\b.{0,80}\b(?:work|job|project|installation|until|next year)\b/i;

/** Longest a single line of a name/contact block may be before it reads as prose. */
const MAX_SIG_LINE_LEN = 60;
/** A sign-off tail this many non-blank lines or fewer reads as a signature. */
const MAX_SIGNOFF_TAIL_LINES = 6;

// ─── Pipe-delimited contact cards ──────────────────────────────────────────
//
// The Outlook corporate card that defeated every anchor above (bug 7ca126d2):
//
//   JANE DOE | INSIDE SALES REP |
//   jdoe@supplier.com
//   T:
//   604-555-3513 ext. 8723 |
//   9785 201 St Sample Twp, BC V1M 3E7 |
//   www.supplier.ca
//
// There is no `--` delimiter, no device footer, no sign-off word, and no
// labelled "Phone:" line — so anchors 1-4 all walked past it and the whole card
// stayed in `body_text_clean`, later surfacing as a lead summary reading
// "Scope: 8723 | 9785 201 St …". The card's ALL-CAPS name-then-pipe opening is
// itself the anchor; the cut only happens when everything below it is card-
// shaped too, so an authored sentence that merely contains a pipe survives.

/** An ALL-CAPS name (or role) immediately followed by a pipe: "JANE DOE | …". */
const PIPE_CONTACT_CARD_ANCHOR_RE = /^[ \t]*[A-Z][A-Z .'’-]{2,40}\|/;
/** A pipe-delimited ALL-CAPS segment anywhere in the line: "… | SALES | …". */
const PIPE_CONTACT_CARD_SEGMENT_RE = /\|[ \t]*[A-Z][A-Z ]{2,}[ \t]*\|/;
/** A line that is only a labelled contact fragment, a URL, or a phone number. */
const CONTACT_FRAGMENT_LINE_RE =
  /^[ \t]*(?:T:|M:|C:|www\.|https?:|\+?\d[\d ().-]{6,})/;

/**
 * A positively-identified card runs longer than a bare sign-off tail — six
 * lines is a short card, not a long one — so it gets its own cap rather than
 * loosening `MAX_SIGNOFF_TAIL_LINES` for every other anchor.
 */
const MAX_CONTACT_CARD_TAIL_LINES = 10;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Extract a full customer name from an explicit authored sign-off before the
 * signature block is removed from `cleanBody`. Quote stripping runs first, so
 * a name found only in quoted history can never become current-message identity.
 */
export function extractAuthoredSignatureName(
  rawBody: string,
  opts: CleanMessageOptions = {}
): string | null {
  const authored = authoredMessageBody(rawBody, opts)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = authored.split("\n");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!SIGNOFF_LINE_RE.test(lines[index] ?? "")) continue;
    const tail = lines
      .slice(index + 1)
      .map((line) => line.trim())
      .filter(Boolean);
    const candidate = tail[0] ?? "";
    if (candidate.length > MAX_SIG_LINE_LEN) continue;
    if (!FULL_SIGNED_NAME_RE.test(candidate)) continue;
    const tokens = candidate.split(/\s+/);
    if (tokens.some((token) => NON_PERSON_NAME_TOKEN_RE.test(token))) continue;
    return candidate.replace(/\s+/g, " ").trim();
  }

  return null;
}

function isCorporateSignatureShapedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 320) return false;
  if (/^(?:business|office) hours?\s*:/i.test(trimmed)) return true;
  if (
    /^please note (?:our|the) upcoming studio closure dates?\s*:?\s*$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (!CORPORATE_SIGNATURE_KEYWORD_RE.test(trimmed)) return false;
  if (CORPORATE_SIGNATURE_ACTION_RE.test(trimmed)) return false;
  return (
    /^canpro\b.{0,100}\bdeck\s+(?:&|and)\s+rail\b/i.test(trimmed) ||
    /^(?:owner|principal|president|director|designer|architect|manager)\b/i.test(
      trimmed
    ) ||
    /^(?:project|office|operations|general|sales)\s+manager\s*$/i.test(
      trimmed
    ) ||
    /\b(?:inc\.?|ltd\.?|corp\.?|corporation|company|collective|canpro|deck\s*&\s*rail)\.?\s*$/i.test(
      trimmed
    )
  );
}

function isSignatureShapedLine(line: string): boolean {
  return (
    CONTACT_SHAPE_RE.test(line) ||
    BARE_DOMAIN_LINE_RE.test(line) ||
    LABELLED_FOOTER_RE.test(line) ||
    isCorporateSignatureShapedLine(line) ||
    ADDRESS_SHAPE_RE.test(line) ||
    BARE_NAME_LINE_RE.test(line.trim())
  );
}

function isExtendedSignatureShapedLine(line: string): boolean {
  return (
    isSignatureShapedLine(line) ||
    EXTENDED_SIGNATURE_FOOTER_RE.test(line) ||
    SPACED_BRAND_MARK_RE.test(line) ||
    CREDENTIALLED_NAME_LINE_RE.test(line) ||
    SIGNATURE_DATE_RANGE_RE.test(line)
  );
}

/**
 * Card-shaped: everything the existing signature predicates accept, plus the
 * pipe-card and bare contact-fragment forms an Outlook card is built from.
 * Deliberately scoped to the contact-card anchor so anchors 1-4 keep their
 * exact shipped behaviour.
 */
function isContactCardShapedLine(line: string): boolean {
  return (
    isSignatureShapedLine(line) ||
    PIPE_CONTACT_CARD_ANCHOR_RE.test(line) ||
    PIPE_CONTACT_CARD_SEGMENT_RE.test(line) ||
    CONTACT_FRAGMENT_LINE_RE.test(line)
  );
}

/**
 * True when every line below a card anchor is itself card-shaped. Blank lines
 * are ignored (Outlook interleaves them freely), so only non-blank lines count
 * against the cap.
 */
function looksLikeContactCardTail(tailLines: string[]): boolean {
  const nonBlank = tailLines.filter((line) => !isBlank(line));
  return (
    nonBlank.length > 0 &&
    nonBlank.length <= MAX_CONTACT_CARD_TAIL_LINES &&
    nonBlank.every(
      (line) =>
        line.trim().length <= MAX_SIG_LINE_LEN && isContactCardShapedLine(line)
    )
  );
}

function looksLikeBareSignatureTail(tailLines: string[]): boolean {
  const nonBlank = tailLines.filter((line) => !isBlank(line));
  return (
    nonBlank.length > 0 &&
    nonBlank.length <= MAX_SIGNOFF_TAIL_LINES &&
    nonBlank.every(
      (line) =>
        line.trim().length <= MAX_SIG_LINE_LEN && isSignatureShapedLine(line)
    )
  );
}

/**
 * True when the lines after a sign-off word look like a signature tail
 * (a short name + contact block) rather than a continued prose paragraph.
 *
 * Heuristic: the tail must be non-empty, short (≤ MAX_SIGNOFF_TAIL_LINES
 * non-blank lines), every line short (≤ MAX_SIG_LINE_LEN), and at least one
 * line must carry contact-shaped data OR the tail must be a single short name
 * line. A single long prose line (the false-positive case) fails on length.
 */
function looksLikeSignatureTail(tailLines: string[]): boolean {
  const nonBlank = tailLines.filter((l) => !isBlank(l));
  if (nonBlank.length === 0) return false;
  if (nonBlank.some((line) => POSTSCRIPT_RE.test(line))) return false;
  const shortTail =
    nonBlank.length <= MAX_SIGNOFF_TAIL_LINES &&
    nonBlank.every((line) => line.trim().length <= MAX_SIG_LINE_LEN);
  if (
    shortTail &&
    nonBlank.some((line) => CONTACT_SHAPE_RE.test(line)) &&
    nonBlank.every(isSignatureShapedLine)
  ) {
    return true;
  }
  const hasAuthoredTextInExtendedTail = nonBlank.some(
    (line) => !isExtendedSignatureShapedLine(line)
  );
  const extendedCorporateTail =
    nonBlank.length <= 40 &&
    nonBlank.join("\n").length <= 4_000 &&
    nonBlank.every((line) => line.trim().length <= 320) &&
    nonBlank.some((line) => CONTACT_SHAPE_RE.test(line)) &&
    nonBlank.some((line) => isCorporateSignatureShapedLine(line)) &&
    !hasAuthoredTextInExtendedTail;
  if (extendedCorporateTail) return true;
  // No contact data: only treat as a signature when it's a single short line
  // (a bare name like "Mike Chen"). Multiple short non-contact lines are
  // ambiguous, so we keep them rather than risk eating content.
  return (
    shortTail &&
    nonBlank.length === 1 &&
    BARE_NAME_LINE_RE.test(nonBlank[0]!.trim())
  );
}

/**
 * Conservatively remove a trailing signature / footer block from a single
 * plain-text message body. Returns the body unchanged when no confident
 * signature anchor is found.
 */
export function stripSignatureBlock(body: string): string {
  if (!body) return body;
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let cutAt = lines.length; // index of the first line to drop

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1: a hard delimiter is only authoritative when its tail is actually
    // signature-shaped. Untrusted prose can contain delimiter-looking lines.
    if (SIG_DELIMITER_RE.test(line)) {
      const tail = lines.slice(i + 1);
      if (
        tail.every(isBlank) ||
        looksLikeSignatureTail(tail) ||
        looksLikeBareSignatureTail(tail)
      ) {
        cutAt = Math.min(cutAt, i);
        break;
      }
    }

    // 2: real device/client footers are terminal. Any authored text after one
    // means the footer-looking line is part of the message and must be kept.
    if (CLIENT_FOOTER_RE.test(line) && lines.slice(i + 1).every(isBlank)) {
      cutAt = Math.min(cutAt, i);
      break;
    }

    // 3: sign-off word on its own line, followed by a signature-shaped tail.
    if (SIGNOFF_LINE_RE.test(line)) {
      const tail = lines.slice(i + 1);
      if (looksLikeSignatureTail(tail)) {
        cutAt = Math.min(cutAt, i);
        break;
      }
    }

    // 4: a pipe-delimited ALL-CAPS contact card. No sign-off word and no hard
    // delimiter precede it, so the card's own first line is the anchor — but
    // only when the whole tail below is card-shaped, or the anchor line is a
    // self-contained card (it carries the contact data itself and nothing but
    // blanks follow). "PLEASE NOTE | the gate swing has to change" therefore
    // never cuts, because the line after it is prose.
    if (PIPE_CONTACT_CARD_ANCHOR_RE.test(line)) {
      const tail = lines.slice(i + 1);
      const selfContainedCard =
        tail.every(isBlank) && CONTACT_SHAPE_RE.test(line);
      if (selfContainedCard || looksLikeContactCardTail(tail)) {
        cutAt = Math.min(cutAt, i);
        break;
      }
    }
  }

  // 5: a run of labelled footer lines at the very end (no other anchor hit).
  if (cutAt === lines.length) {
    let firstFooter = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (isBlank(lines[i])) continue;
      if (LABELLED_FOOTER_RE.test(lines[i])) {
        firstFooter = i;
        continue;
      }
      break;
    }
    if (firstFooter < lines.length) cutAt = firstFooter;
  }

  if (cutAt >= lines.length) {
    const inlineSignature = INLINE_CORPORATE_SIGNATURE_RE.exec(normalized);
    if (inlineSignature) {
      const punctuationOffset = inlineSignature[0].search(/[.!?]/);
      const inlineCutAt =
        (inlineSignature.index ?? 0) + Math.max(0, punctuationOffset) + 1;
      if (COMMERCIAL_VETO_OR_REVERSAL_RE.test(normalized.slice(inlineCutAt))) {
        return body;
      }
      const kept = normalized.slice(0, inlineCutAt).trimEnd();
      if (kept) return kept;
    }
    return body;
  }

  if (COMMERCIAL_VETO_OR_REVERSAL_RE.test(lines.slice(cutAt).join("\n"))) {
    return body;
  }
  const kept = trimTrailingBlankLines(lines.slice(0, cutAt));
  const result = kept.join("\n").trimEnd();
  // Never blank out the whole message: if stripping ate everything, the
  // "signature" was actually the content — keep the original.
  return result.length > 0 ? result : body;
}

// ─── Quote + overlap + signature composition ───────────────────────────────

/**
 * Convert (if HTML) and quote-strip a raw body via the shared 3-layer pipeline:
 *   1. stripQuotedHtml → htmlToPlainText (HTML inputs only)
 *   2. stripQuotedContent (plain-text quote markers)
 * htmlToPlainText / stripQuotedHtml are idempotent on plain text, so this is
 * safe to call on either shape.
 */
function quoteStripRaw(raw: string, subject: string): string {
  const plain = htmlToPlainText(stripQuotedHtml(raw));
  return stripQuotedContentStrict(plain, subject);
}

/**
 * Produce the clean body for one message: normalized + quote-stripped +
 * overlap-stripped + header-stripped + signature-stripped. Pure — no DB /
 * network.
 *
 * Layer order:
 *   0. Normalize — invisible/double-encoded formatting marks out, space-only
 *      lines collapsed to real blanks, so every line anchor below can fire.
 *   1. Quote strip — prefer the provider's pre-computed clean body when given,
 *      else run the shared HTML/plain-text quote pipeline on the raw body.
 *   2. Cross-message overlap strip — subtract any verbatim prior-message body
 *      inlined into this one (safety net the quote pass can miss).
 *   3. Outlook reply-header strip — the shapes the strict From/Sent/To quote
 *      marker misses.
 *   4. Signature strip — remove the trailing sig / footer / contact-card block.
 */
export function cleanMessageBody(
  rawBody: string,
  opts: CleanMessageOptions
): string {
  return stripSignatureBlock(authoredMessageBody(rawBody, opts)).trim();
}

/**
 * Re-clean a body that was persisted as `body_text_clean` before this module's
 * current boundary shipped. Those rows keep their reply header and signature
 * card at rest forever, and the lead-summary service prefers the stored value —
 * so the same normalization, header strip and signature strip have to run again
 * at read time. No quote-marker pass: the stored body is already the provider's
 * quote-stripped text, and re-running the markers on it risks nothing but has
 * nothing to add.
 */
export function sanitizeSummaryEvidenceBody(body: string): string {
  if (!body) return body;
  const normalized = normalizeBodyLines(
    stripOutlookReplyHeaderBlock(normalizeBodyLines(body))
  );
  const stripped = stripSignatureBlock(normalized).trim();
  // `stripSignatureBlock` refuses to blank a message: when the "signature" IS
  // the whole message it hands the body back untouched. That rule protects the
  // conversation layer, where an empty body would lose the fact that anything
  // was said at all. Summary evidence is the opposite case — a body that is
  // nothing but a contact card carries no deal fact, and handing it to the
  // model is how a phone extension became a job scope (bug 7ca126d2). The
  // malformed 17:21Z Vitrum send was ~90% signature card.
  if (stripped === normalized.trim() && isContactCardOnlyBody(normalized)) {
    return "";
  }
  return stripped;
}

/** Every non-blank line is card-shaped and at least one opens a pipe card. */
function isContactCardOnlyBody(body: string): boolean {
  const lines = body.split("\n").filter((line) => !isBlank(line));
  return (
    lines.length > 0 &&
    lines.length <= MAX_CONTACT_CARD_TAIL_LINES &&
    lines.some((line) => PIPE_CONTACT_CARD_ANCHOR_RE.test(line)) &&
    lines.every(
      (line) =>
        line.trim().length <= MAX_SIG_LINE_LEN && isContactCardShapedLine(line)
    )
  );
}

/**
 * Produce only the human-authored portion of a message: provider/regex quote
 * stripping plus optional prior-message overlap removal, while retaining the
 * operator's sign-off and signature. Writing-profile and AI-draft comparison
 * use this representation; factual memory uses `cleanMessageBody`.
 */
export function authoredMessageBody(
  rawBody: string,
  opts: CleanMessageOptions
): string {
  if (!rawBody) return rawBody;

  const subject = opts.subject ?? "";

  // 0. Normalize FIRST. Everything below is line-anchored, and Outlook's
  //    space-only "blank" lines plus double-encoded formatting marks defeat
  //    line anchors before they get a chance to run. Prior bodies are
  //    normalized on the same terms so the overlap match still lines up.
  const normalizedRaw = normalizeBodyLines(rawBody);
  const normalizedProviderClean =
    opts.providerCleanBody != null
      ? normalizeBodyLines(opts.providerCleanBody)
      : null;
  const normalizedPriors = opts.priorBodies?.map(normalizeBodyLines);

  // 1. Quote strip (provider-clean preferred).
  const quoteStripped =
    normalizedProviderClean != null
      ? stripQuotedContentStrict(normalizedProviderClean, subject)
      : quoteStripRaw(normalizedRaw, subject);

  // 2. Cross-message overlap strip.
  const overlapStripped =
    normalizedPriors && normalizedPriors.length > 0
      ? stripPriorMessageOverlap(quoteStripped, normalizedPriors)
      : quoteStripped;

  // 3. Outlook reply-header strip. A quoted header block is never authored
  //    text, so it leaves this representation too.
  const headerStripped = stripOutlookReplyHeaderBlock(overlapStripped);

  // 4. Re-normalize: the HTML path re-introduces space-only lines when it
  //    collapses runs of horizontal whitespace.
  return normalizeBodyLines(headerStripped).trim();
}
