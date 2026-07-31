/**
 * OPS Web — Lead disposition feedback mutations (Phase C).
 *
 * Deliberately thin: `mutationFn` only. Cache reconciliation is the CALLER's
 * job, because the discard controller runs these through `mutateAsync` inside
 * plain async closures that must survive the component unmounting mid-toast
 * (the operator can navigate away while the capture toast is still up).
 * Mutation lifecycle callbacks are gated on the owning component still being
 * mounted, so they cannot be trusted for the write-then-invalidate sequence.
 */

import { useMutation } from "@tanstack/react-query";
import {
  applyLeadDispositionFeedback,
  undoLeadDispositionFeedback,
  type LeadDispositionFeedbackResult,
  type LeadDispositionReasonCode,
} from "../api/services/lead-disposition-feedback-service";

export interface ApplyLeadDispositionFeedbackInput {
  opportunityId: string;
  reasonCode: LeadDispositionReasonCode;
  optionalNote?: string | null;
  /** Fresh `crypto.randomUUID()` per capture; reused only to retry it. */
  idempotencyKey: string;
}

export interface UndoLeadDispositionFeedbackInput {
  feedbackId: string;
  idempotencyKey: string;
}

/** Apply a discard reason + its server-mapped lifecycle change atomically. */
export function useApplyLeadDispositionFeedback() {
  return useMutation<
    LeadDispositionFeedbackResult,
    Error,
    ApplyLeadDispositionFeedbackInput
  >({
    mutationFn: (input) => applyLeadDispositionFeedback(input),
  });
}

/** Retract a feedback row and restore the pre-discard lifecycle. */
export function useUndoLeadDispositionFeedback() {
  return useMutation<
    LeadDispositionFeedbackResult,
    Error,
    UndoLeadDispositionFeedbackInput
  >({
    mutationFn: (input) => undoLeadDispositionFeedback(input),
  });
}
