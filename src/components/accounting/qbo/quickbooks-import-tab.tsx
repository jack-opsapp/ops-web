"use client";

import { useMemo, useState } from "react";
import {
  DownloadCloud,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Link2Off,
  Link2,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
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

function RecordStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 p-1.5 rounded bg-fill-neutral-dim border border-border">
      <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-data text-text tabular-nums">{value}</span>
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

  // Connection status for the run header (I6). The owner connects QuickBooks on
  // the Integrations tab; until then the Import tab shows a not-connected state.
  const { data: connections } = useAccountingConnections();
  // Prefer the live QuickBooks row (a company can hold both sandbox + production
  // rows); fall back to any QB row so the reconnect prompt still surfaces when
  // none is connected. Matches the SYNC segment's active-connection selection.
  const qbConnection =
    connections?.find((c) => c.provider === AccountingProvider.QuickBooks && c.isConnected) ??
    connections?.find((c) => c.provider === AccountingProvider.QuickBooks);
  const isConnected = qbConnection?.isConnected ?? false;
  // A connection row that exists but is no longer connected means the token
  // expired or was revoked (invalid_grant flips is_connected=false): the
  // operator must re-run OAuth. Distinguish that from "never connected".
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

  // The run id the apply targets: prefer the staged review's authoritative id
  // (it equals `runId` in production, where the review query is keyed by it),
  // falling back to local state so apply works the moment a review is present.
  const applyRunId = review?.run.id ?? runId;

  const handleApply = async () => {
    if (!applyRunId) return;
    await applyImport.mutateAsync({ runId: applyRunId, decisions: applyDecisions });
  };

  const writeCalls = review?.run.qbWriteCalls ?? 0;
  const stagedCounts = review?.stagedCounts;
  const matchCounts = review?.matchCounts;
  const applied = review?.run.status === "applied";

  // Customer counts from the operator's RESOLVED decisions, not the server's
  // proposed matchCounts — so action overrides (link/create/skip/needs_review)
  // are reflected in both the confirm copy and the post-apply total (I5).
  const decisionCounts = useMemo(() => {
    const c = { link: 0, create: 0, skip: 0, needs_review: 0 };
    for (const d of applyDecisions) c[d.action] += 1;
    return c;
  }, [applyDecisions]);

  // Customers actually written to OPS = link + create (skip excluded).
  const customersToWrite = decisionCounts.link + decisionCounts.create;

  // APPLY is blocked while ANY customer is still unresolved (needs_review):
  // the operator must resolve each to link / create / skip first (I7).
  const hasUnresolved = decisionCounts.needs_review > 0;

  return (
    <div className="space-y-3">
      {/* Run header */}
      <Card variant="default" className="p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-mohave text-body-lg text-text uppercase tracking-wider">
              {t("qbo.title")}
            </h2>
            <p className="font-mono text-caption-sm text-text-3 mt-0.5">
              {t("qbo.readOnlyNote")}
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={handlePull}
            disabled={startImport.isPending || !companyId || !isConnected}
            className="gap-1"
          >
            {startImport.isPending ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <DownloadCloud className="w-[14px] h-[14px]" />
            )}
            {startImport.isPending ? t("qbo.pulling") : t("qbo.pull")}
          </Button>
        </div>

        {/* Connection status + last-pulled time (I6) */}
        <div
          data-testid="qbo-connection-status"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-caption-sm tabular-nums",
            isConnected ? "text-status-success" : "text-text-mute"
          )}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block w-[6px] h-[6px] rounded-full",
                isConnected ? "bg-status-success" : "bg-text-mute"
              )}
            />
            <span className="uppercase tracking-wider text-micro">
              {isConnected
                ? t("integrations.connected")
                : t("integrations.notConnected")}
            </span>
          </span>
          {review && (
            <span className="flex items-center gap-1.5 text-text-3">
              <span className="uppercase tracking-wider text-micro text-text-mute">
                {t("qbo.lastPulled")}
              </span>
              <span>
                {formatPulledTime(
                  review.run.finishedAt ?? review.run.createdAt
                ) ?? t("qbo.never")}
              </span>
            </span>
          )}
        </div>

        {review && (
          <div
            data-testid="qbo-write-calls"
            className={cn(
              "flex items-center gap-1.5 font-mono text-caption-sm tabular-nums",
              writeCalls === 0 ? "text-status-success" : "text-rose"
            )}
          >
            {writeCalls === 0 ? (
              <ShieldCheck className="w-[12px] h-[12px]" />
            ) : (
              <ShieldAlert className="w-[12px] h-[12px]" />
            )}
            <span className="uppercase tracking-wider text-micro text-text-mute">
              {t("qbo.writeCalls")}
            </span>
            <span>
              {writeCalls === 0
                ? t("qbo.writeCallsOk")
                : t("qbo.writeCallsFail", { count: writeCalls })}
            </span>
          </div>
        )}
      </Card>

      {/* Reconnect prompt (token expired / revoked → is_connected=false on an
          existing connection). Shows a direct CTA instead of pull controls. */}
      {needsReconnect && !review && !startImport.isPending && (
        <Card
          variant="default"
          className="p-3 space-y-2"
          data-testid="qbo-reconnect-prompt"
        >
          <p className="font-mohave text-body text-text uppercase tracking-wider">
            {t("qbo.reconnectTitle")}
          </p>
          <p className="font-mono text-caption-sm text-text-mute">
            {t("qbo.reconnectPrompt")}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={handleReconnect}
            disabled={initiateOAuth.isPending || !companyId}
            className="gap-1"
          >
            <Link2 className="w-[14px] h-[14px]" />
            {t("qbo.reconnect")}
          </Button>
        </Card>
      )}

      {/* Never-connected empty state (I6) */}
      {!isConnected && !needsReconnect && !review && !startImport.isPending && (
        <Card variant="default" className="p-3">
          <p className="font-mohave text-body text-text uppercase tracking-wider">
            {t("qbo.notConnected")}
          </p>
          <p className="font-mono text-caption-sm text-text-mute mt-1">
            {t("qbo.connectFirst")}
          </p>
        </Card>
      )}

      {/* No-run empty state (connected, nothing pulled yet) */}
      {isConnected && !applyRunId && !review && !startImport.isPending && (
        <Card variant="default" className="p-3">
          <p className="font-mohave text-body text-text uppercase tracking-wider">
            {t("qbo.empty.noRun")}
          </p>
          <p className="font-mono text-caption-sm text-text-mute mt-1">
            {t("qbo.empty.startPrompt")}
          </p>
        </Card>
      )}

      {runId && isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-text-mute animate-spin" />
        </div>
      )}

      {runId && isError && (
        <Card variant="default" className="p-3 flex items-center gap-1.5">
          <AlertCircle className="w-[14px] h-[14px] text-rose" />
          <span className="font-mono text-caption-sm text-rose">
            {t("qbo.error")}
          </span>
        </Card>
      )}

      {/* Review body */}
      {review && stagedCounts && matchCounts && (
        <>
          <Card variant="default" className="p-3 space-y-2">
            <ReconciliationStrip recon={review.reconciliation} />
          </Card>

          <Card variant="default" className="p-3 space-y-2">
            <h3 className="font-mohave text-body text-text uppercase tracking-wider">
              {t("qbo.records.title")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <RecordStat
                label={t("qbo.records.estimates")}
                value={stagedCounts.estimates}
              />
              <RecordStat
                label={t("qbo.records.invoices")}
                value={stagedCounts.invoices}
              />
              <RecordStat
                label={t("qbo.records.payments")}
                value={stagedCounts.payments}
              />
              <RecordStat
                label={t("qbo.records.lineItems")}
                value={stagedCounts.lineItems}
              />
              <RecordStat
                label={t("qbo.records.skippedInvoices")}
                value={stagedCounts.skippedInvoices}
              />
              <RecordStat
                label={t("qbo.records.orphanPayments")}
                value={stagedCounts.orphanPayments}
              />
            </div>
            {stagedCounts.jobsDetected > 0 && (
              <p className="font-mono text-caption-sm text-text-3">
                {t("qbo.jobsDetected", { count: stagedCounts.jobsDetected })}
              </p>
            )}
          </Card>

          <Card variant="default" className="p-3 space-y-2">
            <h3 className="font-mohave text-body text-text uppercase tracking-wider">
              {t("qbo.customers.title")}
            </h3>
            <CustomerMatchTable
              matches={review.matches}
              decisions={decisions}
              onDecisionChange={handleDecisionChange}
            />
          </Card>

          {/* Apply */}
          <Card variant="default" className="p-3 space-y-2">
            <p className="font-mono text-caption-sm text-text-3">
              {t("qbo.applyConfirm", {
                customers: customersToWrite,
                invoices: stagedCounts.invoices,
                payments: stagedCounts.payments,
              })}
            </p>
            {hasUnresolved && !applied && (
              <p
                data-testid="qbo-needs-review-hint"
                className="flex items-center gap-1.5 font-mono text-caption-sm text-tan"
              >
                <Link2Off className="w-[12px] h-[12px]" />
                {t("qbo.needsReviewBlock", {
                  count: decisionCounts.needs_review,
                })}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={applyImport.isPending || applied || hasUnresolved}
                className="gap-1"
              >
                {applyImport.isPending && (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                )}
                {applyImport.isPending ? t("qbo.apply.applying") : t("qbo.apply.all")}
              </Button>
              {applied && (
                <span className="font-mono text-caption-sm text-status-success">
                  {t("qbo.applied", {
                    count:
                      stagedCounts.estimates +
                      stagedCounts.invoices +
                      stagedCounts.payments +
                      stagedCounts.lineItems +
                      customersToWrite,
                  })}
                </span>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
