"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDictionary } from "@/i18n/client";
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
import { usePortalData } from "@/lib/hooks/use-portal-data";
import { PortalEstimateView } from "@/components/portal/portal-estimate-view";
import { getFieldVisibility } from "@/lib/portal/resolve-template-branding";
import type { DocumentPartyInfo } from "@/components/portal/portal-invoice-view";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Statuses that allow the client to take action */
const ACTIONABLE_STATUSES = new Set(["sent", "viewed", "changes_requested"]);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EstimateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { t } = useDictionary("portal");

  // ── Data ────────────────────────────────────────────────────────────────
  const {
    data: estimateData,
    isLoading,
    error,
  } = usePortalEstimate(id);

  const { data: questionsData } = usePortalQuestions(id);
  const { data: portalData } = usePortalData();

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
  // The API now returns { ...estimate, template } — extract the template
  const estimate = estimateData ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = (estimateData as any)?.template ?? null;

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

  // Build company/client info for From/To sections
  const companyInfo: DocumentPartyInfo | null = portalData?.company
    ? {
        name: portalData.company.name,
        phone: portalData.company.phone,
        email: portalData.company.email,
      }
    : null;

  const clientInfo: DocumentPartyInfo | null = portalData?.client
    ? {
        name: portalData.client.name,
        email: portalData.client.email,
        phone: portalData.client.phoneNumber,
        address: portalData.client.address,
      }
    : null;

  const fieldVisibility = getFieldVisibility(template);

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleApprove() {
    approveMutation.mutate(id, {
      onSuccess: () => {
        setShowApproveDialog(false);
        if (hasQuestions) {
          router.push(`/portal/estimates/${id}/questions`);
        } else {
          setSuccessMessage(
            t("estimate.approved")
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
              ? t("estimate.changesSent")
              : t("estimate.declined")
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
          {t("estimate.loadError")}
        </p>
        <Link
          href="/portal/home"
          className="inline-flex items-center gap-2 mt-4 text-sm"
          style={{ color: "var(--portal-accent)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          {t("estimate.backToPortal")}
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
          {t("estimate.backToPortal")}
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
            {t("estimate.returnHome")}
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
        {t("estimate.backToPortal")}
      </Link>

      {/* Estimate content */}
      <PortalEstimateView
        estimate={estimate}
        questions={questions}
        lineItemIdsWithQuestions={lineItemIdsWithQuestions}
        fieldVisibility={fieldVisibility}
        companyInfo={companyInfo}
        clientInfo={clientInfo}
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
                  {t("estimate.answerQuestions")}
                </p>
                <p className="text-xs" style={{ color: "var(--portal-text-secondary)" }}>
                  {questions.length} question{questions.length !== 1 ? "s" : ""}{" "}
                  {t("estimate.questionsFromProvider")}
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
            {t("estimate.approve")}
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
            {t("estimate.requestChanges")}
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
            {t("estimate.decline")}
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
              {t("estimate.approveConfirmTitle")}
            </h3>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              {t("estimate.approveConfirmDesc")}
              {estimate.depositAmount != null && estimate.depositAmount > 0 && (
                <span>
                  {" "}
                  {t("estimate.depositNote")}
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
                {approveMutation.isPending ? t("estimate.approving") : t("estimate.approve")}
              </button>
            </div>

            {approveMutation.isError && (
              <p
                className="text-xs mt-3 text-center"
                style={{ color: "var(--portal-error)" }}
              >
                {(approveMutation.error as Error).message ??
                  t("estimate.actionError")}
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
                ? t("estimate.changesDialogTitle")
                : t("estimate.declineEstimate")}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: "var(--portal-text-secondary)" }}
            >
              {declineMode === "changes"
                ? t("estimate.changesDialogDesc")
                : t("estimate.declineDialogDesc")}
            </p>

            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder={
                declineMode === "changes"
                  ? t("estimate.changesPlaceholder")
                  : t("estimate.declinePlaceholder")
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
                  ? t("estimate.sending")
                  : declineMode === "changes"
                    ? t("estimate.sendChangeRequest")
                    : t("estimate.declineEstimate")}
              </button>
            </div>

            {declineMutation.isError && (
              <p
                className="text-xs mt-3 text-center"
                style={{ color: "var(--portal-error)" }}
              >
                {(declineMutation.error as Error).message ??
                  t("estimate.actionError")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
