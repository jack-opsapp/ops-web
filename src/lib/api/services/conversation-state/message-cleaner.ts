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
  stripQuotedContent,
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
  /^[ \t]*(?:sent from my\b.*|sent via\b.*|get outlook for (?:ios|android)\b.*|get the outlook app\b.*)$/i;

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
  if (nonBlank.length > MAX_SIGNOFF_TAIL_LINES) return false;
  if (nonBlank.some((l) => l.trim().length > MAX_SIG_LINE_LEN)) return false;
  if (nonBlank.some((l) => CONTACT_SHAPE_RE.test(l))) return true;
  // No contact data: only treat as a signature when it's a single short line
  // (a bare name like "Mike Chen"). Multiple short non-contact lines are
  // ambiguous, so we keep them rather than risk eating content.
  return nonBlank.length === 1;
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

    // 1 + 2: hard delimiters — drop from here to the end.
    if (SIG_DELIMITER_RE.test(line) || CLIENT_FOOTER_RE.test(line)) {
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

  if (cutAt >= lines.length) return body;

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
  return stripQuotedContent(plain, subject);
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
      ? opts.providerCleanBody
      : quoteStripRaw(rawBody, subject);

  // 2. Cross-message overlap strip.
  const overlapStripped =
    opts.priorBodies && opts.priorBodies.length > 0
      ? stripPriorMessageOverlap(quoteStripped, opts.priorBodies)
      : quoteStripped;

  return overlapStripped.trim();
}
