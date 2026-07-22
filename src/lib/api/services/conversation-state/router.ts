// src/lib/api/services/conversation-state/router.ts
//
// The deterministic ROUTER. Given a fully-resolved ConversationState (minus the
// three fields this module computes), it decides whether Phase C may draft, may
// only quietly update the lead, or must hold the thread for a human.
//
// This is a PURE function: no DB, no network, no AI. It reasons only over data
// the upstream resolver already produced (contact, messages, accept, attachment
// inspection state). Phase C consumes `routing` to gate autonomy; the inbox
// surfaces `routingReasons` + `confidence` so a held thread is explainable.
//
// See docs/inbox/clean-state-layer-spec.md § "Routing rules (deterministic)".

import type {
  AttachmentRef,
  ConversationState,
  RoutingDecision,
} from "./types";

/** Everything the router reads — the resolved state minus what it computes. */
export type RouteInput = Omit<
  ConversationState,
  "routing" | "routingReasons" | "confidence"
>;

export interface RouteResult {
  routing: RoutingDecision;
  routingReasons: string[];
  confidence: number; // 0..1
}

/** Below this, a thread is never auto-acted on — it is held for a human. */
export const CONFIDENCE_FLOOR = 0.5;

// ---------------------------------------------------------------------------
// Predicates — each isolates one rule so the reasons stay 1:1 with the logic.
// ---------------------------------------------------------------------------

/**
 * Identity is too weak to act when we have NO verified name AND no email AND no
 * phone. Any single one of those makes the lead actionable (we can address /
 * reach the customer); zero of them means we'd be drafting into a void.
 */
function hasActionableIdentity(input: RouteInput): boolean {
  const { contact } = input;
  const hasVerifiedName = contact.nameIsVerified && !!contact.name;
  const hasEmail = !!contact.email;
  const hasPhone = !!contact.phone;
  return hasVerifiedName || hasEmail || hasPhone;
}

/**
 * An attachment blocks autonomy when it requires inspection but inspection is
 * absent (null) or failed. A "failed" inspection is one that produced no usable
 * summary — the drafter would otherwise ignore a customer's photo/diagram/PDF.
 */
function isUnresolvedInspection(att: AttachmentRef): boolean {
  if (!att.requiresInspection) return false;
  const inspection = att.inspection;
  if (inspection === null || inspection === undefined) return true; // not yet inspected
  return inspection.summary.trim().length === 0; // inspected but empty → failed
}

function unresolvedAttachments(input: RouteInput): AttachmentRef[] {
  return input.attachmentsRequiringInspection.filter(isUnresolvedInspection);
}

/**
 * Accept signals conflict only when HIGH evidence is mixed with a soft/verbal
 * basis. Negotiation and follow-up are normal places for a customer to accept;
 * the stage itself is never contradictory evidence.
 */
function hasConflictingAccept(input: RouteInput): boolean {
  const { accept } = input;
  if (!accept.detected || accept.confidence !== "high") return false;
  return accept.basis.includes("verbal_soft");
}

/**
 * The ball is in the operator's court when the latest message in the thread is a
 * real customer inbound — i.e. the customer spoke last and is awaiting a reply.
 * Ordered by sentAt so out-of-order arrays still resolve "who spoke last".
 */
function customerAwaitsReply(input: RouteInput): boolean {
  if (input.messages.length === 0) return false;
  const latest = [...input.messages].sort((a, b) =>
    a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0
  )[input.messages.length - 1];
  return latest.direction === "inbound" && latest.isRealCustomerInbound;
}

// ---------------------------------------------------------------------------
// Confidence — a transparent equal-weight blend of three 0..1 components.
// ---------------------------------------------------------------------------

/** Fraction of the four contact fields that are present (verified name counts). */
function contactCompleteness(input: RouteInput): number {
  const { contact } = input;
  const filled = [
    contact.nameIsVerified && !!contact.name,
    !!contact.email,
    !!contact.phone,
    !!contact.address,
  ].filter(Boolean).length;
  return filled / 4;
}

/** Share of messages with a known (non-'unknown') party role. */
function classifiedShare(input: RouteInput): number {
  if (input.messages.length === 0) return 0;
  const classified = input.messages.filter(
    (m) => m.partyRole !== "unknown"
  ).length;
  return classified / input.messages.length;
}

/** 1 when no attachment inspection is unresolved, else degrades by the share resolved. */
function attachmentResolvedShare(input: RouteInput): number {
  const required = input.attachmentsRequiringInspection.filter(
    (a) => a.requiresInspection
  );
  if (required.length === 0) return 1;
  const resolved = required.filter((a) => !isUnresolvedInspection(a)).length;
  return resolved / required.length;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeConfidence(input: RouteInput): number {
  const blend =
    (contactCompleteness(input) +
      classifiedShare(input) +
      attachmentResolvedShare(input)) /
    3;
  return round2(clamp01(blend));
}

// ---------------------------------------------------------------------------
// route — the pure core.
// ---------------------------------------------------------------------------

export function route(input: RouteInput): RouteResult {
  const reasons: string[] = [];
  let mustReview = false;

  if (!hasActionableIdentity(input)) {
    mustReview = true;
    reasons.push(
      "Contact identity is too weak to act on (no verified name, email, or phone)."
    );
  }

  const blocked = unresolvedAttachments(input);
  if (blocked.length > 0) {
    mustReview = true;
    const names = blocked.map((a) => a.filename).join(", ");
    reasons.push(
      `${blocked.length} attachment${blocked.length === 1 ? "" : "s"} require inspection but ${
        blocked.length === 1 ? "is" : "are"
      } uninspected or failed (${names}).`
    );
  }

  if (hasConflictingAccept(input)) {
    mustReview = true;
    reasons.push(
      "Accept signals conflict: a high-confidence acceptance coincides with an unresolved follow-up."
    );
  }

  const confidence = computeConfidence(input);
  if (confidence < CONFIDENCE_FLOOR) {
    mustReview = true;
    reasons.push(
      `Computed confidence ${confidence.toFixed(2)} is below the ${CONFIDENCE_FLOOR} review floor.`
    );
  }

  if (mustReview) {
    return {
      routing: "require_human_review",
      routingReasons: reasons,
      confidence,
    };
  }

  // Not held for review. If the customer is not awaiting a reply (operator spoke
  // last, or there is no inbound to answer), there is nothing to draft — only
  // keep the lead's state fresh.
  if (!customerAwaitsReply(input)) {
    reasons.push(
      "Customer thread with no inbound awaiting a reply — updating the lead without drafting."
    );
    return { routing: "update_lead_only", routingReasons: reasons, confidence };
  }

  reasons.push(
    "Customer is awaiting a reply with sufficient identity and no unresolved attachments — drafting."
  );
  return { routing: "draft", routingReasons: reasons, confidence };
}
