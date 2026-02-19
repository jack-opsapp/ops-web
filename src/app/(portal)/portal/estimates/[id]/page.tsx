"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  ArrowLeft,
  Check,
  Edit3,
  X,
  HelpCircle,
} from "lucide-react";
import { usePortalEstimate, useApproveEstimate, useDeclineEstimate } from "@/lib/hooks/use-portal-estimate";
import { usePortalQuestions } from "@/lib/hooks/use-portal-questions";
import { PortalEstimateView } from "@/components/portal/portal-estimate-view";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Statuses that allow the client to take action */
const ACTIONABLE_STATUSES = new Set(["sent", "viewed", "changes_requested"]);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EstimateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // ── Data ────────────────────────────────────────────────────────────────
  const {
    data: estimate,
    isLoading,
    error,
  } = usePortalEstimate(id);

  const { data: questionsData } = usePortalQuestions(id);

  // ── Mutations ───────────────────────────────────────────────────────────
  const approveMutation = useApproveEstimate();
  const declineMutation = useDeclineEstimate();

  // ── Dialog state ────────────────────────────────────────────────────────
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  /** Whether the decline dialog is for "request changes" or "decline" */
  const [declineMode, setDeclineMode] = useState<"changes" | "decline">("decline");
  const [declineReason, setDeclineReason] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────
  const questions = questionsData?.questions ?? [];
  const hasQuestions = questions.length > 0;

  const lineItemIdsWithQuestions = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) {
      set.add(q.lineItemId);
    }
    return set;
  }, [questions]);

  const canTakeAction = estimate
    ? ACTIONABLE_STATUSES.has(estimate.status)
    : false;

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleApprove() {
    approveMutation.mutate(id, {
      onSuccess: () => {
        setShowApproveDialog(false);
        if (hasQuestions) {
          router.push(`/portal/estimates/${id}/questions`);
        } else {
          setSuccessMessage(
            "Estimate approved! Thank you for your confirmation."
          );
        }
      },
    });
  }

  function handleDecline() {
    const reason =
      declineMode === "changes" && declineReason
        ? `[Change Request] ${declineReason}`
        : declineReason || undefined;

    declineMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          setShowDeclineDialog(false);
          setDeclineReason("");
          setSuccessMessage(
            declineMode === "changes"
              ? "Change request sent! Your provider will prepare an updated estimate."
              : "Estimate declined. We've notified your provider."
          );
        },
      }
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
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
  if (error || !estimate) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          Unable to load this estimate. Please try refreshing the page.
        </p>
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-2 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to portal
        </Link>
      </div>
    );
  }

  // ── Success message ─────────────────────────────────────────────────────
  if (successMessage) {
    return (
      <div className="space-y-6">
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-2 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to portal
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
            {successMessage}
          </p>
          <Link
            href="/portal/home"
            className="inline-flex items-center gap-2 text-sm mt-4"
            style={{ color: "var(--portal-accent)" }}
          >
            Return to portal home
          </Link>
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/portal/home"
        className="inline-flex items-center gap-2 text-sm"
        style={{ color: "var(--portal-accent)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to portal
      </Link>

      {/* Estimate content */}
      <PortalEstimateView
        estimate={estimate}
        questions={questions}
        lineItemIdsWithQuestions={lineItemIdsWithQuestions}
      />

      {/* Questions link */}
      {hasQuestions && (
        <Link href={`/portal/estimates/${id}/questions`}>
          <div
            className="flex items-center justify-between rounded-xl cursor-pointer transition-colors"
            style={{
              padding: "16px var(--portal-card-padding, 24px)",
              backgroundColor: "rgba(65,115,148,0.08)",
              border: "1px solid var(--portal-accent)",
            }}
          >
            <div className="flex items-center gap-3">
              <HelpCircle
                className="w-5 h-5 shrink-0"
                style={{ color: "var(--portal-accent)" }}
              />
              <div>
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--portal-text)" }}
                >
                  Answer questions about this estimate
                </p>
                <p className="text-xs" style={{ color: "var(--portal-text-secondary)" }}>
                  {questions.length} question{questions.length !== 1 ? "s" : ""}{" "}
                  from your provider
                </p>
              </div>
            </div>
            <ArrowLeft
              className="w-4 h-4 rotate-180"
              style={{ color: "var(--portal-accent)" }}
            />
          </div>
        </Link>
      )}

      {/* ── Action Buttons ───────────────────────────────────────────────── */}
      {canTakeAction && (
        <div
          className="flex flex-col sm:flex-row gap-3"
          style={{ paddingBottom: "16px" }}
        >
          {/* Approve */}
          <button
            type="button"
            onClick={() => setShowApproveDialog(true)}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--portal-success, #9DB582)",
              color: "#fff",
            }}
          >
            <Check className="w-4 h-4" />
            Approve Estimate
          </button>

          {/* Request Changes */}
          <button
            type="button"
            onClick={() => {
              setDeclineMode("changes");
              setDeclineReason("");
              setShowDeclineDialog(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "rgba(196,168,104,0.15)",
              color: "#C4A868",
              border: "1px solid rgba(196,168,104,0.3)",
            }}
          >
            <Edit3 className="w-4 h-4" />
            Request Changes
          </button>

          {/* Decline */}
          <button
            type="button"
            onClick={() => {
              setDeclineMode("decline");
              setDeclineReason("");
              setShowDeclineDialog(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "rgba(181,130,137,0.15)",
              color: "#B58289",
              border: "1px solid rgba(181,130,137,0.3)",
            }}
          >
            <X className="w-4 h-4" />
            Decline
          </button>
        </div>
      )}

      {/* ── Approve Confirmation Dialog ──────────────────────────────────── */}
      {showApproveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="w-full max-w-md rounded-xl"
            style={{
              padding: "var(--portal-card-padding, 24px)",
              backgroundColor: "var(--portal-card)",
              border: "1px solid var(--portal-border)",
            }}
          >
            <h3
              className="text-lg font-semibold mb-2"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                color: "var(--portal-text)",
              }}
            >
              Approve Estimate?
            </h3>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              By approving estimate #{estimate.estimateNumber}, you are
              confirming acceptance of the scope and pricing detailed above.
              {estimate.depositAmount != null && estimate.depositAmount > 0 && (
                <span>
                  {" "}
                  A deposit of{" "}
                  <strong style={{ color: "var(--portal-text)" }}>
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(estimate.depositAmount)}
                  </strong>{" "}
                  may be required.
                </span>
              )}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowApproveDialog(false)}
                disabled={approveMutation.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "transparent",
                  color: "var(--portal-text-secondary)",
                  border: "1px solid var(--portal-border)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={approveMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "var(--portal-success, #9DB582)",
                  color: "#fff",
                  opacity: approveMutation.isPending ? 0.6 : 1,
                }}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {approveMutation.isPending ? "Approving..." : "Approve"}
              </button>
            </div>

            {approveMutation.isError && (
              <p
                className="text-xs mt-3 text-center"
                style={{ color: "var(--portal-error)" }}
              >
                {(approveMutation.error as Error).message ??
                  "Something went wrong. Please try again."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Decline Dialog ───────────────────────────────────────────────── */}
      {showDeclineDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="w-full max-w-md rounded-xl"
            style={{
              padding: "var(--portal-card-padding, 24px)",
              backgroundColor: "var(--portal-card)",
              border: "1px solid var(--portal-border)",
            }}
          >
            <h3
              className="text-lg font-semibold mb-2"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
                color: "var(--portal-text)",
              }}
            >
              {declineMode === "changes"
                ? "Request Changes"
                : "Decline Estimate"}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              {declineMode === "changes"
                ? "Describe the changes you'd like and we'll prepare an updated estimate for you."
                : "Let your provider know why this estimate doesn't work for you. This is optional but helps them prepare a better quote."}
            </p>

            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder={
                declineMode === "changes"
                  ? "What changes would you like?..."
                  : "Reason for declining (optional)..."
              }
              rows={4}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "var(--portal-radius, 8px)",
                border: "1px solid var(--portal-border)",
                backgroundColor: "var(--portal-bg)",
                color: "var(--portal-text)",
                fontSize: "14px",
                lineHeight: "1.5",
                resize: "vertical",
                outline: "none",
              }}
            />

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowDeclineDialog(false);
                  setDeclineReason("");
                }}
                disabled={declineMutation.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: "transparent",
                  color: "var(--portal-text-secondary)",
                  border: "1px solid var(--portal-border)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDecline}
                disabled={declineMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor:
                    declineMode === "changes"
                      ? "rgba(196,168,104,0.15)"
                      : "rgba(181,130,137,0.15)",
                  color: declineMode === "changes" ? "#C4A868" : "#B58289",
                  border: `1px solid ${
                    declineMode === "changes"
                      ? "rgba(196,168,104,0.3)"
                      : "rgba(181,130,137,0.3)"
                  }`,
                  opacity: declineMutation.isPending ? 0.6 : 1,
                }}
              >
                {declineMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : declineMode === "changes" ? (
                  <Edit3 className="w-4 h-4" />
                ) : (
                  <X className="w-4 h-4" />
                )}
                {declineMutation.isPending
                  ? "Sending..."
                  : declineMode === "changes"
                    ? "Send Change Request"
                    : "Decline Estimate"}
              </button>
            </div>

            {declineMutation.isError && (
              <p
                className="text-xs mt-3 text-center"
                style={{ color: "var(--portal-error)" }}
              >
                {(declineMutation.error as Error).message ??
                  "Something went wrong. Please try again."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
