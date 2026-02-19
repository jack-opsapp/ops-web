/**
 * OPS Web - Portal Questions Hooks
 *
 * TanStack Query hooks for fetching and submitting line-item question
 * answers from the client portal. Uses session cookies for authentication.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { portalKeys, portalFetch } from "./use-portal-data";
import type { LineItemQuestion, LineItemAnswer } from "../types/portal";

// ─── Response Types ───────────────────────────────────────────────────────────

interface PortalQuestionsResponse {
  questions: LineItemQuestion[];
  answers: LineItemAnswer[];
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all line-item questions and existing answers for an estimate.
 * Enabled only when `estimateId` is truthy.
 */
export function usePortalQuestions(estimateId: string | undefined) {
  return useQuery<PortalQuestionsResponse>({
    queryKey: portalKeys.estimateQuestions(estimateId ?? ""),
    queryFn: () =>
      portalFetch<PortalQuestionsResponse>(
        `/api/portal/estimates/${estimateId}/questions`
      ),
    enabled: !!estimateId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

interface SubmitAnswersInput {
  estimateId: string;
  answers: Array<{
    questionId: string;
    answerValue: string;
  }>;
}

/**
 * Submit answers to line-item questions for an estimate.
 * Invalidates the questions query and portal data (the
 * hasUnansweredQuestions flag on the estimate may change).
 */
export function useSubmitPortalAnswers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ estimateId, answers }: SubmitAnswersInput) =>
      portalFetch<void>(
        `/api/portal/estimates/${estimateId}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      ),
    onSuccess: (_data, { estimateId }) => {
      // Invalidate the questions for this estimate
      queryClient.invalidateQueries({
        queryKey: portalKeys.estimateQuestions(estimateId),
      });
      // Invalidate the estimate detail (answered status may have changed)
      queryClient.invalidateQueries({
        queryKey: portalKeys.estimate(estimateId),
      });
      // Invalidate portal data — hasUnansweredQuestions flag may have changed
      queryClient.invalidateQueries({ queryKey: portalKeys.data() });
    },
  });
}
