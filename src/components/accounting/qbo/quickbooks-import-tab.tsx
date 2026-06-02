"use client";

import { useMemo, useState } from "react";
import {
  DownloadCloud,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useStartImport,
  useImportReview,
  useApplyImport,
  type ApplyDecision,
} from "@/lib/hooks/use-qbo-import";
import { ReconciliationStrip } from "./reconciliation-strip";
import { CustomerMatchTable, type RowDecision } from "./customer-match-table";

function RecordStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 p-1.5 rounded bg-[rgba(255,255,255,0.02)] border border-border">
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
            disabled={startImport.isPending || !companyId}
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

        {review && (
          <div
            data-testid="qbo-write-calls"
            className={cn(
              "flex items-center gap-1.5 font-mono text-caption-sm tabular-nums",
              writeCalls === 0 ? "text-status-success" : "text-[#B58289]"
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

      {/* Empty / loading / error */}
      {!applyRunId && !review && !startImport.isPending && (
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
          <AlertCircle className="w-[14px] h-[14px] text-[#B58289]" />
          <span className="font-mono text-caption-sm text-[#B58289]">
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
                customers: matchCounts.link + matchCounts.create,
                invoices: stagedCounts.invoices,
                payments: stagedCounts.payments,
              })}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={applyImport.isPending || applied}
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
                      matchCounts.link +
                      matchCounts.create,
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
