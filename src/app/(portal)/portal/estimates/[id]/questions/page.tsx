"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  ArrowLeft,
  Check,
  HelpCircle,
  Send,
} from "lucide-react";
import { usePortalEstimate } from "@/lib/hooks/use-portal-estimate";
import { usePortalQuestions, useSubmitPortalAnswers } from "@/lib/hooks/use-portal-questions";
import { PortalQuestionField } from "@/components/portal/portal-question-field";
import type { LineItemQuestion, LineItemAnswer } from "@/lib/types/portal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuestionGroup {
  lineItemId: string;
  lineItemName: string;
  questions: LineItemQuestion[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EstimateQuestionsPage() {
  const params = useParams();
  const id = params.id as string;

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: estimate, isLoading: estimateLoading } = usePortalEstimate(id);
  const {
    data: questionsData,
    isLoading: questionsLoading,
    error,
  } = usePortalQuestions(id);
  const submitMutation = useSubmitPortalAnswers();

  // ── Answers state ───────────────────────────────────────────────────────
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Pre-fill answers from existing data
  const existingAnswers = questionsData?.answers ?? [];
  const questions = questionsData?.questions ?? [];

  // Initialize answers from server data on first load
  useMemo(() => {
    if (existingAnswers.length > 0 && Object.keys(answers).length === 0) {
      const prefilled: Record<string, string> = {};
      for (const ans of existingAnswers) {
        prefilled[ans.questionId] = ans.answerValue;
      }
      // Only set if we haven't already touched the form
      if (Object.keys(answers).length === 0) {
        setAnswers(prefilled);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAnswers]);

  // ── Group questions by line item ────────────────────────────────────────
  const groups: QuestionGroup[] = useMemo(() => {
    if (!estimate || questions.length === 0) return [];

    const lineItemMap = new Map<string, string>();
    for (const li of estimate.lineItems) {
      lineItemMap.set(li.id, li.name);
    }

    const groupMap = new Map<string, QuestionGroup>();
    for (const q of questions) {
      if (!groupMap.has(q.lineItemId)) {
        groupMap.set(q.lineItemId, {
          lineItemId: q.lineItemId,
          lineItemName: lineItemMap.get(q.lineItemId) ?? "General",
          questions: [],
        });
      }
      groupMap.get(q.lineItemId)!.questions.push(q);
    }

    // Sort questions within each group by sortOrder
    for (const group of groupMap.values()) {
      group.questions.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return Array.from(groupMap.values());
  }, [estimate, questions]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleAnswerChange = useCallback(
    (questionId: string, value: string) => {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
      // Clear error on change
      setErrors((prev) => {
        if (!prev[questionId]) return prev;
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    },
    []
  );

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    for (const q of questions) {
      if (q.isRequired) {
        const val = (answers[q.id] ?? "").trim();
        if (!val) {
          newErrors[q.id] = "This question requires an answer";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;

    const payload = Object.entries(answers)
      .filter(([, value]) => value.trim() !== "")
      .map(([questionId, answerValue]) => ({
        questionId,
        answerValue: answerValue.trim(),
      }));

    submitMutation.mutate(
      { estimateId: id, answers: payload },
      {
        onSuccess: () => {
          setSubmitted(true);
        },
      }
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  const isLoading = estimateLoading || questionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: "var(--portal-accent)" }}
        />
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (error || !questionsData) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          Unable to load questions. Please try refreshing the page.
        </p>
        <Link
          href={`/portal/estimates/${id}`}
          className="inline-flex items-center gap-2 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to estimate
        </Link>
      </div>
    );
  }

  // ── No questions ────────────────────────────────────────────────────────
  if (questions.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          href={`/portal/estimates/${id}`}
          className="inline-flex items-center gap-2 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to estimate
        </Link>

        <div
          className="rounded-xl text-center"
          style={{
            padding: "48px var(--portal-card-padding, 24px)",
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
          }}
        >
          <p
            className="text-sm"
            style={{ color: "var(--portal-text-secondary)" }}
          >
            There are no questions for this estimate.
          </p>
        </div>
      </div>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="space-y-6">
        <Link
          href={`/portal/estimates/${id}`}
          className="inline-flex items-center gap-2 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to estimate
        </Link>

        <div
          className="rounded-xl text-center"
          style={{
            padding: "48px var(--portal-card-padding, 24px)",
            backgroundColor: "var(--portal-card)",
            border: "1px solid var(--portal-border)",
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: "rgba(157,181,130,0.15)" }}
          >
            <Check className="w-7 h-7" style={{ color: "#9DB582" }} />
          </div>
          <p
            className="text-lg font-semibold mb-2"
            style={{
              fontFamily: "var(--portal-heading-font)",
              fontWeight: "var(--portal-heading-weight)",
              color: "var(--portal-text)",
            }}
          >
            Thanks! Your answers have been submitted.
          </p>
          <p
            className="text-sm"
            style={{ color: "var(--portal-text-secondary)" }}
          >
            Your provider has been notified and will follow up if needed.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
            <Link
              href={`/portal/estimates/${id}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--portal-accent)",
                color: "var(--portal-accent-text, #fff)",
              }}
            >
              View Estimate
            </Link>
            <Link
              href="/portal/home"
              className="inline-flex items-center gap-2 text-sm"
              style={{ color: "var(--portal-accent)" }}
            >
              Return to portal home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────
  const requiredCount = questions.filter((q) => q.isRequired).length;
  const answeredRequiredCount = questions.filter(
    (q) => q.isRequired && (answers[q.id] ?? "").trim() !== ""
  ).length;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/portal/estimates/${id}`}
        className="inline-flex items-center gap-2 text-sm"
        style={{ color: "var(--portal-accent)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to estimate
      </Link>

      {/* Header */}
      <div
        className="rounded-xl"
        style={{
          padding: "var(--portal-card-padding, 24px)",
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <HelpCircle
            className="w-5 h-5 shrink-0"
            style={{ color: "var(--portal-accent)" }}
          />
          <h1
            className="text-xl"
            style={{
              fontFamily: "var(--portal-heading-font)",
              fontWeight: "var(--portal-heading-weight)",
              textTransform:
                "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
            }}
          >
            Questions
          </h1>
        </div>
        <p
          className="text-sm ml-8"
          style={{ color: "var(--portal-text-secondary)" }}
        >
          {estimate && `For Estimate #${estimate.estimateNumber}`}
          {estimate?.title && ` — ${estimate.title}`}
        </p>
        {requiredCount > 0 && (
          <p
            className="text-xs ml-8 mt-1"
            style={{ color: "var(--portal-text-tertiary)" }}
          >
            {answeredRequiredCount} of {requiredCount} required question
            {requiredCount !== 1 ? "s" : ""} answered
          </p>
        )}
      </div>

      {/* Question groups */}
      {groups.map((group) => (
        <div key={group.lineItemId}>
          {/* Section header: line item name */}
          <div
            className="flex items-center gap-2 mb-4"
            style={{
              paddingBottom: "8px",
              borderBottom: "1px solid var(--portal-border)",
            }}
          >
            <div
              className="w-1 h-5 rounded-full"
              style={{ backgroundColor: "var(--portal-accent)" }}
            />
            <h2
              className="text-base font-semibold"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                color: "var(--portal-text)",
              }}
            >
              {group.lineItemName}
            </h2>
          </div>

          {/* Questions */}
          <div
            className="rounded-xl"
            style={{
              padding: "var(--portal-card-padding, 24px)",
              backgroundColor: "var(--portal-card)",
              border: "1px solid var(--portal-border)",
              marginBottom: "24px",
            }}
          >
            {group.questions.map((q) => (
              <PortalQuestionField
                key={q.id}
                questionId={q.id}
                questionText={q.questionText}
                answerType={q.answerType}
                options={q.options}
                isRequired={q.isRequired}
                value={answers[q.id] ?? ""}
                onChange={(val) => handleAnswerChange(q.id, val)}
                error={errors[q.id] ?? null}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Submit button */}
      <div style={{ paddingBottom: "24px" }}>
        {Object.keys(errors).length > 0 && (
          <p
            className="text-sm mb-3 text-center"
            style={{ color: "var(--portal-error)" }}
          >
            Please answer all required questions before submitting.
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{
            backgroundColor: "var(--portal-accent)",
            color: "var(--portal-accent-text, #fff)",
            opacity: submitMutation.isPending ? 0.6 : 1,
          }}
        >
          {submitMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitMutation.isPending ? "Submitting..." : "Submit Answers"}
        </button>

        {submitMutation.isError && (
          <p
            className="text-xs mt-3 text-center"
            style={{ color: "var(--portal-error)" }}
          >
            {(submitMutation.error as Error).message ??
              "Something went wrong. Please try again."}
          </p>
        )}
      </div>
    </div>
  );
}
