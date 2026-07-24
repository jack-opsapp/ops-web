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
  stripPriorMessageOverlap,
  stripQuotedContentStrict,
  stripQuotedHtml,
} from "@/lib/utils/email-parsing";

export interface CleanMessageOptions {
  /** Subject line — forwarded to the contact-form-aware quote stripper. */
  subject?: string;
  /** Earlier message bodies in the thread, for cross-message overlap stripping. */
  priorBodies?: string[];
  /**
   * Provider-native clean body (M365 `uniqueBody` / Gmail HTML-first strip).
   * When present this is the authoritative quote-stripped text and is preferred
   * over re-deriving from the raw body — but it is still signature-stripped.
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
//   4. A run of trailing labelled footer lines ("Phone:", "Address:", …) at the
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
const CORPORATE_SIGNATURE_SHAPE_RE =
  /\b(?:owner|principal|president|director|designer|architect|manager|business hours?|office hours?|studio closure|suite|inc\.?|ltd\.?|corp\.?|corporation|company|collective|canpro|deck\s*&\s*rail)\b/i;
const BARE_NAME_LINE_RE =
  /^[A-Z][A-Za-z.'’-]{1,39}(?:\s+[A-Z][A-Za-z.'’-]{1,39}){0,3}$/;
const ADDRESS_SHAPE_RE =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'’-]+\s+){0,6}(?:avenue|ave|boulevard|blvd|circle|court|ct|crescent|cr|drive|dr|highway|hwy|lane|ln|place|pl|road|rd|street|st|terrace|trail|way|suite)\b/i;
const POSTSCRIPT_RE = /^\s*(?:p\.?\s*s\.?|postscript)\b/i;
const INLINE_CORPORATE_SIGNATURE_RE =
  /[.!?]\s*(?:(?:kind|best|warm)\s+regards|regards|sincerely|cheers)?\s*,?\s*(?:[A-Z][A-Za-z.'’()-]*\s+){1,4}(?:(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})[\s\S]{0,320}\b(?:inc\.?|ltd\.?|corp\.?|corporation|company|owner|principal|business hours?|studio closure|canpro)\b[.!]?\s*$/i;
const COMMERCIAL_VETO_OR_REVERSAL_RE =
  /\b(?:do not|don['’]?t)\s+proceed\b|\bchanged\s+(?:my|our)\s+minds?\b|\b(?:cancel\w*|declin\w*|reject\w*|withdraw\w*|stop\w*)\b.{0,80}\b(?:quote|estimate|proposal|work|job|project|installation)\b|\b(?:deposit|payment)\b.{0,80}\b(?:revers\w*|refund\w*|chargeback|returned|sent back)\b|\b(?:revers\w*|refund\w*|chargeback|returned|sent back)\b.{0,80}\b(?:deposit|payment)\b|\b(?:postpon\w*|defer\w*|delay\w*|hold(?:ing)? off)\b.{0,80}\b(?:work|job|project|installation|until|next year)\b/i;

/** Longest a single line of a name/contact block may be before it reads as prose. */
const MAX_SIG_LINE_LEN = 60;
/** A sign-off tail this many non-blank lines or fewer reads as a signature. */
const MAX_SIGNOFF_TAIL_LINES = 6;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

function isSignatureShapedLine(line: string): boolean {
  return (
    CONTACT_SHAPE_RE.test(line) ||
    LABELLED_FOOTER_RE.test(line) ||
    CORPORATE_SIGNATURE_SHAPE_RE.test(line) ||
    ADDRESS_SHAPE_RE.test(line) ||
    BARE_NAME_LINE_RE.test(line.trim())
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
  const lastContactIndex = nonBlank.findLastIndex((line) =>
    CONTACT_SHAPE_RE.test(line)
  );
  const hasAuthoredTextAfterContact =
    lastContactIndex >= 0 &&
    nonBlank
      .slice(lastContactIndex + 1)
      .some((line) => !isSignatureShapedLine(line));
  const extendedCorporateTail =
    nonBlank.length <= 20 &&
    nonBlank.join("\n").length <= 1_500 &&
    nonBlank.every((line) => line.trim().length <= 180) &&
    nonBlank.some((line) => CONTACT_SHAPE_RE.test(line)) &&
    nonBlank.some((line) => CORPORATE_SIGNATURE_SHAPE_RE.test(line)) &&
    !hasAuthoredTextAfterContact;
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
  }

  // 4: a run of labelled footer lines at the very end (no other anchor hit).
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
 * Produce the clean body for one message: quote-stripped + overlap-stripped +
 * signature-stripped. Pure — no DB / network.
 *
 * Layer order:
 *   1. Quote strip — prefer the provider's pre-computed clean body when given,
 *      else run the shared HTML/plain-text quote pipeline on the raw body.
 *   2. Cross-message overlap strip — subtract any verbatim prior-message body
 *      inlined into this one (safety net the quote pass can miss).
 *   3. Signature strip — remove the trailing sig / footer block.
 */
export function cleanMessageBody(
  rawBody: string,
  opts: CleanMessageOptions
): string {
  return stripSignatureBlock(authoredMessageBody(rawBody, opts)).trim();
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

  // 1. Quote strip (provider-clean preferred).
  const quoteStripped =
    opts.providerCleanBody != null
      ? stripQuotedContentStrict(opts.providerCleanBody, subject)
      : quoteStripRaw(rawBody, subject);

  // 2. Cross-message overlap strip.
  const overlapStripped =
    opts.priorBodies && opts.priorBodies.length > 0
      ? stripPriorMessageOverlap(quoteStripped, opts.priorBodies)
      : quoteStripped;

  return overlapStripped.trim();
}
