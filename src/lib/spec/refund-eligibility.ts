/**
 * OPS Web — SPEC refund eligibility (server-only)
 *
 * Computes whether a customer's refund request invokes the 30-day Guarantee
 * Refund or is a post-window goodwill request. Server-side only — the customer
 * MUST NOT influence this computation. Per bible 04_CUSTOMER_UX.md
 * § /account/spec/[id]/request-refund.
 *
 * Bible: 01_BUSINESS_MODEL.md § 3 (refund policy + exclusions),
 *        02_DATA_MODEL.md § spec_refund_requests, spec_payments.
 */

import { GUARANTEE_REFUND_WINDOW_DAYS } from "./constants";

export interface RefundEligibilityInput {
  /** spec_projects.walkthrough_completed_at — canonical Guarantee anchor */
  walkthroughCompletedAt: string | null;
  /** Current spec_projects.status */
  status: string;
  /** True if any spec_payments row for this project is in 'disputed' status */
  hasActiveDispute: boolean;
  /** Server clock at the moment of evaluation */
  now: Date;
}

export interface RefundEligibility {
  /**
   * True if the request invokes the 30-day Guarantee Refund. The single
   * idempotent invocation per engagement is enforced by the partial-unique
   * index spec_refund_one_guarantee_per_project_idx.
   */
  isGuaranteeInvocation: boolean;
  /**
   * True when the request is outside the Guarantee window or otherwise not
   * a Guarantee invocation — treated as a goodwill request reviewed at OPS
   * discretion.
   */
  isGoodwill: boolean;
  /**
   * Human-readable label for the read-only eligibility context shown on the
   * customer page. Server-computed so the customer cannot manipulate it.
   */
  windowState: "active" | "expired" | "no_walkthrough" | "terminal" | "disputed";
  /**
   * ISO timestamp when the Guarantee window closes for this engagement, or
   * null when the walkthrough has not happened yet.
   */
  windowClosesAt: string | null;
}

const TERMINAL_REFUND_BLOCKED_STATUSES = new Set([
  "refunded",
  "cancelled",
]);

export function computeRefundEligibility(
  input: RefundEligibilityInput
): RefundEligibility {
  const { walkthroughCompletedAt, status, hasActiveDispute, now } = input;

  if (TERMINAL_REFUND_BLOCKED_STATUSES.has(status)) {
    return {
      isGuaranteeInvocation: false,
      isGoodwill: true,
      windowState: "terminal",
      windowClosesAt: null,
    };
  }

  if (hasActiveDispute) {
    return {
      isGuaranteeInvocation: false,
      isGoodwill: true,
      windowState: "disputed",
      windowClosesAt: null,
    };
  }

  if (!walkthroughCompletedAt) {
    return {
      isGuaranteeInvocation: false,
      isGoodwill: true,
      windowState: "no_walkthrough",
      windowClosesAt: null,
    };
  }

  const walkthroughDate = new Date(walkthroughCompletedAt);
  const closesAt = new Date(walkthroughDate);
  closesAt.setUTCDate(closesAt.getUTCDate() + GUARANTEE_REFUND_WINDOW_DAYS);

  const isActive = closesAt.getTime() > now.getTime();

  return {
    isGuaranteeInvocation: isActive,
    isGoodwill: !isActive,
    windowState: isActive ? "active" : "expired",
    windowClosesAt: closesAt.toISOString(),
  };
}
