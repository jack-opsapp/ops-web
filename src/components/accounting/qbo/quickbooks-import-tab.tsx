"use client";

import { useMemo, useState } from "react";
import { Loader2, AlertCircle, Link2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useAccountingConnections,
  useInitiateOAuth,
} from "@/lib/hooks/use-accounting";
import { AccountingProvider } from "@/lib/types/pipeline";
import {
  useStartImport,
  useImportReview,
  useApplyImport,
  type ApplyDecision,
} from "@/lib/hooks/use-qbo-import";
import { ReconciliationStrip } from "./reconciliation-strip";
import { CustomerMatchTable, type RowDecision } from "./customer-match-table";
import {
  ImportRunHeader,
  ImportRecordsPanel,
  ImportApplyPanel,
  PanelTitle,
  type ApplyPhase,
} from "./import-panels";

/** Format an ISO/Date pull timestamp as a local HH:MM (tabular, 24h). */
function formatPulledTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A bare `// TITLE` glass panel wrapper for the review sections. */
function ReviewPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-surface rounded-panel p-3">
      <PanelTitle>{title}</PanelTitle>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function QuickBooksImportTab() {
  const { t } = useDictionary("accounting");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [runId, setRunId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});

  const startImport = useStartImport();
  const applyImport = useApplyImport();
  const { data: review, isLoading, isError } = useImportReview(runId);

  // Connection status for the run header. The owner connects QuickBooks on the
  // Sync tab; until then the Import tab shows a not-connected state.
  const { data: connections } = useAccountingConnections();
  const qbConnection =
    connections?.find((c) => c.provider === AccountingProvider.QuickBooks && c.isConnected) ??
    connections?.find((c) => c.provider === AccountingProvider.QuickBooks);
  const isConnected = qbConnection?.isConnected ?? false;
  const needsReconnect = !!qbConnection && !isConnected;

  const initiateOAuth = useInitiateOAuth();
  const handleReconnect = () => {
    if (!companyId) return;
    initiateOAuth.mutate({ companyId, provider: AccountingProvider.QuickBooks });
  };

  const handlePull = async () => {
    if (!companyId) return;
    setDecisions({});
    const res = await startImport.mutateAsync({ companyId });
    setRunId(res.runId);
  };

  const handleDecisionChange = (qbId: string, decision: RowDecision) => {
    setDecisions((prev) => ({ ...prev, [qbId]: decision }));
  };

  // Assemble the apply payload from every staged match's resolved decision.
  const applyDecisions: ApplyDecision[] = useMemo(() => {
    if (!review) return [];
    return review.matches.map((m) => {
      const d =
        decisions[m.customerQbId] ?? {
          action: m.proposedAction,
          client_id: m.matchedClientId ?? undefined,
        };
      return {
        customer_qb_id: m.customerQbId,
        action: d.action,
        client_id: d.client_id,
      };
    });
  }, [review, decisions]);

  const applyRunId = review?.run.id ?? runId;

  const handleApply = async () => {
    if (!applyRunId) return;
    await applyImport.mutateAsync({ runId: applyRunId, decisions: applyDecisions });
  };

  const stagedCounts = review?.stagedCounts;
  const matchCounts = review?.matchCounts;

  // Customer counts from the operator's RESOLVED decisions (not the server's
  // proposed matchCounts) so action overrides are reflected in the confirm copy
  // and the post-apply total.
  const decisionCounts = useMemo(() => {
    const c = { link: 0, create: 0, skip: 0, needs_review: 0 };
    for (const d of applyDecisions) c[d.action] += 1;
    return c;
  }, [applyDecisions]);

  const customersToWrite = decisionCounts.link + decisionCounts.create;

  // ── Apply lifecycle (background job) ───────────────────────────────────────
  // The apply route returns immediately (202) and runs the write in the
  // background; the run's status drives this surface while it polls, and a
  // persistent rail notification tracks it if the operator navigates away.
  const runStatus = review?.run.status;
  const applied = runStatus === "applied";
  const errored = runStatus === "error" || applyImport.isError;
  const applying =
    !applied &&
    !errored &&
    (applyImport.isPending || applyImport.isSuccess || runStatus === "applying");
  const applyPhase: ApplyPhase = applied
    ? "applied"
    : errored
      ? "error"
      : applying
        ? "applying"
        : "idle";

  const appliedCount = stagedCounts
    ? stagedCounts.estimates +
      stagedCounts.invoices +
      stagedCounts.payments +
      stagedCounts.lineItems +
      customersToWrite
    : 0;

  return (
    <div className="space-y-3">
      <ImportRunHeader
        isConnected={isConnected}
        pulling={startImport.isPending}
        canPull={!!companyId && isConnected}
        onPull={handlePull}
        lastPulled={
          review
            ? formatPulledTime(review.run.finishedAt ?? review.run.createdAt) ??
              t("qbo.never")
            : null
        }
        writeCalls={review ? review.run.qbWriteCalls : null}
      />

      {/* Reconnect prompt (token expired / revoked). */}
      {needsReconnect && !review && !startImport.isPending && (
        <div className="glass-surface rounded-panel p-3" data-testid="qbo-reconnect-prompt">
          <PanelTitle>{t("qbo.reconnectTitle")}</PanelTitle>
          <p className="mt-2 font-mono text-caption-sm text-text-mute">
            {t("qbo.reconnectPrompt")}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={handleReconnect}
            disabled={initiateOAuth.isPending || !companyId}
            className="mt-2.5 gap-1.5"
          >
            <Link2 size={14} />
            {t("qbo.reconnect")}
          </Button>
        </div>
      )}

      {/* Never-connected empty state */}
      {!isConnected && !needsReconnect && !review && !startImport.isPending && (
        <div className="glass-surface rounded-panel p-3">
          <PanelTitle>{t("qbo.notConnected")}</PanelTitle>
          <p className="mt-2 font-mono text-caption-sm text-text-mute">
            {t("qbo.connectFirst")}
          </p>
        </div>
      )}

      {/* Connected, nothing pulled yet */}
      {isConnected && !applyRunId && !review && !startImport.isPending && (
        <div className="glass-surface rounded-panel p-3">
          <PanelTitle>{t("qbo.empty.noRun")}</PanelTitle>
          <p className="mt-2 font-mono text-caption-sm text-text-mute">
            {t("qbo.empty.startPrompt")}
          </p>
        </div>
      )}

      {runId && isLoading && (
        <div className="glass-surface flex items-center justify-center rounded-panel py-6">
          <Loader2 size={20} className="animate-spin text-text-mute motion-reduce:animate-none" />
        </div>
      )}

      {runId && isError && (
        <div className="glass-surface flex items-center gap-1.5 rounded-panel p-3">
          <AlertCircle size={14} className="text-rose" />
          <span className="font-mono text-caption-sm text-rose">{t("qbo.error")}</span>
        </div>
      )}

      {/* Review body */}
      {review && stagedCounts && matchCounts && (
        <>
          {/* The strip carries its own `// RECONCILIATION` header, so it sits in
              a bare glass panel (no doubled title). */}
          <div className="glass-surface rounded-panel p-3">
            <ReconciliationStrip recon={review.reconciliation} />
          </div>

          <ImportRecordsPanel counts={stagedCounts} />

          <ReviewPanel title={t("qbo.customers.title")}>
            <CustomerMatchTable
              matches={review.matches}
              decisions={decisions}
              onDecisionChange={handleDecisionChange}
            />
          </ReviewPanel>

          <ImportApplyPanel
            status={applyPhase}
            customersToWrite={customersToWrite}
            invoices={stagedCounts.invoices}
            payments={stagedCounts.payments}
            needsReviewCount={decisionCounts.needs_review}
            appliedCount={appliedCount}
            onApply={handleApply}
          />
        </>
      )}
    </div>
  );
}
