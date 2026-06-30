// src/lib/api/services/conversation-state/accept-detector.ts
//
// Deterministic won/accepted detection — runs BEFORE any AI.
// (docs/inbox/clean-state-layer-spec.md, Phase 2 + the "acceptance → split by
// confidence" product decision, Jackson 2026-06-29.)
//
// Why this exists: the legacy pipeline let "clear won language" slip because the
// only accept detection lived in an LLM prompt (email-ai-classifier.ts) that the
// model could miss, and the StageEvaluator was count/timing-only. This module is
// the deterministic floor: an unambiguous "yes, go ahead" or a customer-attached
// *inspected* signed estimate is HIGH confidence (auto-advance to Won); soft /
// verbal-only acknowledgements ("sounds good", "ok") are LOW confidence (surface a
// one-tap "Mark Won" with the evidence). AI runs on top of this for nuance — it
// never owns the hard rule.
//
// PURE-CORE: `detectAccept(customerMessages)` takes already-cleaned CleanMessage[]
// (quote/signature stripped upstream by message-cleaner.ts) and returns an
// AcceptSignal. No DB, no network, no model. Callers pre-filter to real customer
// inbound messages (state.customerMessages); this module does not re-derive that.
//
// The keyword/filename pattern lists are exported + commented so the sweet spot can
// be tuned without spelunking the matching code.

import type { AcceptSignal, CleanMessage } from "./types";

/**
 * HIGH-confidence explicit accept language. A match in a real customer inbound is
 * an unambiguous award of the job. Matched against a normalized (lowercased,
 * punctuation-stripped, single-spaced) copy of the clean body so "Let's do it." and
 * "lets do it" both hit. Order is not significant; first match short-circuits.
 *
 * Tuning notes:
 * - Keep these tight enough that they do NOT fire on questions or soft acks. Avoid
 *   bare "yes" (too ambiguous: "yes I have a question"); require an accept verb /
 *   commitment phrase.
 * - Word-boundary anchored so "approved" matches but "unapproved"/"disapproved" do not.
 */
export const ACCEPT_LANGUAGE_PATTERNS: RegExp[] = [
  /\byes\b.{0,30}\b(lets|let us|go ahead|proceed|book it|do it)\b/, // "yes, let's go ahead"
  /\b(lets|let us)\b.{0,15}\b(do it|proceed|get started|book it|go)\b/, // "let's do it" / "let's proceed"
  /\bgo ahead\b.{0,20}\b(and )?(book|schedule|order|proceed|start|with it)?\b/, // "go ahead and book it"
  /\bwe (accept|approve|are good to go)\b/, // "we accept"
  /\bi(?: |')?(?:ll| will)? accept\b/, // "I accept" / "I'll accept"
  /\baccept the (quote|estimate|proposal|bid|offer)\b/, // "accept the quote"
  /\bapproved\b/, // "approved"
  /\byou(?:'| a)?re hired\b/, // "you're hired"
  /\b(please )?(send|draw up|prepare) (me )?the contract\b/, // "send the contract"
  /\b(consider )?(it )?(a )?(deal|done)\b/, // "it's a deal", "consider it done"
  /\bwhere do i sign\b/, // "where do I sign"
  /\blet'?s book it\b/, // "let's book it"
  /\b(we|i)(?:'| a)?re (good to go|ready to (proceed|start|book))\b/, // "we're good to go"
];

/**
 * LOW-confidence soft acknowledgements. Positive sentiment, but NO commitment —
 * could be acknowledging anything ("ok, I'll think about it"). Surfaces a manual
 * "Mark Won", never auto-advances. Anchored so "great" matches but "greater" does not.
 *
 * Tuning notes: deliberately small. A phrase only belongs here if, alone, it is
 * genuinely ambiguous about whether the job was awarded.
 */
export const SOFT_ACK_PATTERNS: RegExp[] = [
  /\bsounds? good\b/, // "sounds good"
  /\blooks? good\b/, // "looks good"
  /\bperfect\b/, // "perfect"
  /\bgreat\b/, // "great" / "great, thanks"
  /\bawesome\b/, // "awesome"
  /\bok(?:ay)?\b/, // "ok" / "okay"
  /\bthanks?\b/, // "thanks" (alone or trailing a soft ack)
];

/**
 * Filename patterns hinting a customer-attached PDF is a signed/accepted estimate.
 * Used ONLY as a pre-vision LOW-confidence hint when `attachment.inspection` is null
 * (the OpenAI vision step has not run yet). Once vision sets
 * `inspection.isSignedEstimate === true`, that becomes the HIGH-confidence basis and
 * the filename heuristic is irrelevant. Case-insensitive flag set at use.
 */
export const SIGNED_ESTIMATE_FILENAME_PATTERNS: RegExp[] = [
  /signed/i, // "signed-estimate.pdf"
  /estimate/i, // "Estimate-1042.pdf"
  /\bquote\b|quotation/i, // "quote.pdf"
  /proposal/i, // "proposal.pdf"
  /contract/i, // "contract.pdf"
  /agreement/i, // "service-agreement.pdf"
];

const ACCEPT_BASIS_EXPLICIT = "explicit_accept_language" as const;
const ACCEPT_BASIS_SIGNED = "signed_estimate_attachment" as const;
const ACCEPT_BASIS_SOFT = "verbal_soft" as const;

type AcceptBasis = AcceptSignal["basis"][number];

/**
 * Normalize a clean body for keyword matching: lowercase, strip apostrophes inside
 * words (so "let's" → "lets" / "you're" → "youre"), replace remaining punctuation
 * with spaces, and collapse whitespace. Scoped to this module — the existing
 * `normalize*` utils (name/title/phone) strip too aggressively to reuse here.
 */
function normalizeForMatch(body: string): string {
  return body
    .toLowerCase()
    .replace(/['’]/g, "") // contractions: don't insert a word boundary mid-word
    .replace(/[^a-z0-9\s]/g, " ") // other punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfAttachment(mimeType: string, kind: string): boolean {
  return kind === "pdf" || mimeType.toLowerCase().includes("pdf");
}

/** A confirmed (vision-inspected) signed estimate on a customer message. */
function hasInspectedSignedEstimate(message: CleanMessage): boolean {
  return message.attachments.some((att) => att.inspection?.isSignedEstimate === true);
}

/**
 * A pre-vision hint: a PDF attachment with no inspection yet whose filename looks
 * like a signed estimate. LOW-confidence only — the signature is unverified.
 */
function hasUninspectedSignedEstimateHint(message: CleanMessage): boolean {
  return message.attachments.some((att) => {
    if (att.inspection != null) return false; // inspected → handled by the HIGH path
    if (!isPdfAttachment(att.mimeType, att.kind)) return false;
    return SIGNED_ESTIMATE_FILENAME_PATTERNS.some((re) => re.test(att.filename));
  });
}

function matchesAny(patterns: RegExp[], normalized: string): boolean {
  return patterns.some((re) => re.test(normalized));
}

/**
 * Deterministically detect a won/accept signal from already-cleaned customer
 * inbound messages.
 *
 * Precedence: any HIGH signal (explicit accept language OR an inspected signed
 * estimate) makes the whole result HIGH and the evidence collapses to only the
 * HIGH-carrying messages — a soft "sounds good" from an earlier message is not
 * cited once a clear win exists. With no HIGH signal, soft acks and un-inspected
 * estimate-PDF hints produce a LOW signal. With neither, `detected: false`.
 */
export function detectAccept(customerMessages: CleanMessage[]): AcceptSignal {
  const highEvidenceIds: string[] = [];
  const highBasis = new Set<AcceptBasis>();

  const lowEvidenceIds: string[] = [];
  const lowBasis = new Set<AcceptBasis>();

  for (const message of customerMessages) {
    const normalized = normalizeForMatch(message.cleanBody);

    const explicitAccept = matchesAny(ACCEPT_LANGUAGE_PATTERNS, normalized);
    const signedEstimate = hasInspectedSignedEstimate(message);

    if (explicitAccept || signedEstimate) {
      if (explicitAccept) highBasis.add(ACCEPT_BASIS_EXPLICIT);
      if (signedEstimate) highBasis.add(ACCEPT_BASIS_SIGNED);
      highEvidenceIds.push(message.providerMessageId);
      continue; // a HIGH message is never also counted as a soft hint
    }

    // No HIGH signal on this message — collect any soft / pre-vision hints.
    let isLowHit = false;
    if (matchesAny(SOFT_ACK_PATTERNS, normalized)) {
      lowBasis.add(ACCEPT_BASIS_SOFT);
      isLowHit = true;
    }
    if (hasUninspectedSignedEstimateHint(message)) {
      lowBasis.add(ACCEPT_BASIS_SIGNED);
      isLowHit = true;
    }
    if (isLowHit) lowEvidenceIds.push(message.providerMessageId);
  }

  if (highEvidenceIds.length > 0) {
    return {
      detected: true,
      confidence: "high",
      basis: orderBasis(highBasis),
      evidenceMessageIds: highEvidenceIds,
    };
  }

  if (lowEvidenceIds.length > 0) {
    return {
      detected: true,
      confidence: "low",
      basis: orderBasis(lowBasis),
      evidenceMessageIds: lowEvidenceIds,
    };
  }

  return {
    detected: false,
    confidence: "low",
    basis: [],
    evidenceMessageIds: [],
  };
}

/**
 * Stable, deterministic basis ordering so callers (and tests) get a predictable
 * array: signed estimate, then explicit language, then verbal-soft.
 */
function orderBasis(basis: Set<AcceptBasis>): AcceptBasis[] {
  const order: AcceptBasis[] = [
    ACCEPT_BASIS_SIGNED,
    ACCEPT_BASIS_EXPLICIT,
    ACCEPT_BASIS_SOFT,
  ];
  return order.filter((b) => basis.has(b));
}
