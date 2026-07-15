"use client";

/**
 * Books — EXPENSES segment: the batch review console.
 *
 * The operator's two jobs, in order:
 *   1. Know the spend — the expense instrument row (stacked under the shared
 *      LedgerStrip in the scroll-away metrics tier).
 *   2. Clear the queue — lifecycle buckets in the pinned workbar
 *      (TO REVIEW / TO PAY / PAID / WITH CREW), person-grouped master list,
 *      sticky detail panel, per-batch + bulk actions.
 *
 * URL contract: /books?segment=expenses&view=review|pay|paid|crew&batch=<id>
 * (`batch` deep-links arrive from expense_submitted notifications via the
 * /accounting 308 redirect — consumed once, then the operator roams free.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useExpenseBatches,
  useAllExpenses,
  useExpenseSettings,
  useExpenseRealtime,
  useApproveBatch,
  useMarkBatchPaid,
  useUnmarkBatchPaid,
} from "@/lib/hooks";
import {
  TableShell,
  Workbar,
  WorkbarButton,
  WorkbarCount,
} from "@/components/ui/table-shell";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import {
  batchOwedAmount,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";
import {
  bucketForBatch,
  batchLineStats,
  groupForReview,
  groupForPay,
  groupPaidByMonth,
  sortCrewBatches,
  type ExpenseBucket,
  type PersonGroup,
} from "@/lib/utils/expense-buckets";
import { computeExpenseMetrics } from "@/lib/utils/expense-metrics";
import { ExpenseInstrumentRow } from "@/components/expenses/expense-instrument-row";
import { BatchList } from "@/components/expenses/batch-list";
import { BatchDetailPanel } from "@/components/expenses/batch-detail-panel";
import {
  BulkActionModal,
  type BulkActionKind,
} from "@/components/expenses/bulk-action-modal";

const BUCKETS: ExpenseBucket[] = ["review", "pay", "paid", "crew"];

function isBucket(value: string | null): value is ExpenseBucket {
  return !!value && (BUCKETS as string[]).includes(value);
}

export function ExpensesSegment({
  metrics,
  segmentControl,
}: {
  /** The shared LedgerStrip node — stacked with the expense instrument row. */
  metrics: React.ReactNode;
  segmentControl: React.ReactNode;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = usePermissionStore((s) => s.can);
  const canReview = can("expenses.approve");
  const { currentUser } = useAuthStore();
  const userId = currentUser?.id ?? "";

  // ── Data (live-wired) ──────────────────────────────────────────────────────
  const { data: batches = [], isLoading: batchesLoading } = useExpenseBatches();
  const { data: allExpenses = [], isLoading: expensesLoading } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  useExpenseRealtime();

  const approveMutation = useApproveBatch();
  const markPaidMutation = useMarkBatchPaid();
  const unmarkPaidMutation = useUnmarkBatchPaid();

  // ── URL state: bucket + deep-linked batch ──────────────────────────────────
  const viewParam = searchParams.get("view");
  const bucket: ExpenseBucket = isBucket(viewParam) ? viewParam : "review";
  const batchParam = searchParams.get("batch");

  const setBucket = useCallback(
    (next: ExpenseBucket) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "review") params.delete("view");
      else params.set("view", next);
      params.delete("batch");
      const qs = params.toString();
      router.replace(qs ? `/books?${qs}` : "/books", { scroll: false });
    },
    [router, searchParams]
  );

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // ── Derivations ────────────────────────────────────────────────────────────
  const lineStats = useMemo(() => batchLineStats(allExpenses), [allExpenses]);

  const lineIdsByBatch = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const line of allExpenses) {
      if (!line.batchId) continue;
      const ids = map.get(line.batchId) ?? [];
      ids.push(line.id);
      map.set(line.batchId, ids);
    }
    return map;
  }, [allExpenses]);

  const bucketed = useMemo(() => {
    const byBucket: Record<ExpenseBucket, ExpenseBatch[]> = {
      review: [],
      pay: [],
      paid: [],
      crew: [],
    };
    for (const batch of batches) {
      const b = bucketForBatch(batch, lineStats.get(batch.id)?.count);
      if (b) byBucket[b].push(batch);
    }
    return byBucket;
  }, [batches, lineStats]);

  const reviewGroups = useMemo(() => groupForReview(bucketed.review), [bucketed.review]);
  const payGroups = useMemo(() => groupForPay(bucketed.pay), [bucketed.pay]);
  const paidMonths = useMemo(() => groupPaidByMonth(bucketed.paid), [bucketed.paid]);
  const crewBatches = useMemo(() => sortCrewBatches(bucketed.crew), [bucketed.crew]);

  const metricsData = useMemo(
    () => computeExpenseMetrics(batches, allExpenses, new Date()),
    [batches, allExpenses]
  );

  const fmtMoney = useCallback(
    (value: number) =>
      new Intl.NumberFormat(numLocale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value),
    [numLocale]
  );

  // The visible batches, in on-screen order — drives keyboard nav + counts.
  const visibleBatches = useMemo(() => {
    switch (bucket) {
      case "review":
        return reviewGroups.flatMap((g) => g.batches);
      case "pay":
        return payGroups.flatMap((g) => g.batches);
      case "paid":
        return paidMonths.flatMap((m) => m.batches);
      case "crew":
        return crewBatches;
    }
  }, [bucket, reviewGroups, payGroups, paidMonths, crewBatches]);

  const bucketTotal = useMemo(() => {
    switch (bucket) {
      case "review":
        return reviewGroups.reduce((s, g) => s + g.total, 0);
      case "pay":
        return payGroups.reduce((s, g) => s + g.total, 0);
      case "paid":
        return paidMonths.reduce((s, m) => s + m.total, 0);
      case "crew":
        return crewBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
    }
  }, [bucket, reviewGroups, payGroups, paidMonths, crewBatches]);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  // ── Deep link: open the notified batch once it loads ───────────────────────
  const consumedBatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!batchParam || consumedBatchRef.current === batchParam) return;
    const target = batches.find((b) => b.id === batchParam);
    if (!target) return; // still loading, or not this company's batch
    consumedBatchRef.current = batchParam;
    setSelectedBatchId(target.id);
    const home = bucketForBatch(target, lineStats.get(target.id)?.count);
    if (home && home !== bucket) {
      const params = new URLSearchParams(searchParams.toString());
      if (home === "review") params.delete("view");
      else params.set("view", home);
      router.replace(`/books?${params.toString()}`, { scroll: false });
    }
  }, [batchParam, batches, lineStats, bucket, router, searchParams]);

  // ── Mutations (single source for rows, panel, and bulk) ────────────────────
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const trackBusy = useCallback(async (id: string, run: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await run();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const doApprove = useCallback(
    (batch: ExpenseBatch, { quiet = false } = {}) =>
      trackBusy(batch.id, async () => {
        try {
          await approveMutation.mutateAsync({
            batchId: batch.id,
            reviewedBy: userId,
            approvedAmount: batch.totalAmount ?? 0,
            expenseIds: lineIdsByBatch.get(batch.id) ?? [],
            submittedBy: batch.submittedBy,
            companyId: batch.companyId,
            batchNumber: batch.batchNumber,
          });
          if (!quiet) {
            toast.success(
              t("expenses.toast.approved", { total: fmtMoney(batch.totalAmount ?? 0) })
            );
          }
        } catch (err) {
          if (!quiet) toast.error(t("expenses.toast.approveFailed"));
          throw err;
        }
      }),
    [approveMutation, userId, lineIdsByBatch, trackBusy, fmtMoney, t]
  );

  const doUndoPaid = useCallback(
    (batch: ExpenseBatch) =>
      trackBusy(batch.id, async () => {
        try {
          await unmarkPaidMutation.mutateAsync({ batchId: batch.id });
          toast.success(t("expenses.toast.undonePaid"));
        } catch {
          toast.error(t("expenses.toast.undoFailed"));
        }
      }),
    [unmarkPaidMutation, trackBusy, t]
  );

  const doMarkPaid = useCallback(
    (batch: ExpenseBatch, { quiet = false } = {}) =>
      trackBusy(batch.id, async () => {
        try {
          await markPaidMutation.mutateAsync({
            batchId: batch.id,
            submittedBy: batch.submittedBy,
            companyId: batch.companyId,
            batchNumber: batch.batchNumber,
          });
          if (!quiet) {
            const owed = batchOwedAmount(batch);
            toast.success(t("expenses.toast.markedPaid", { total: fmtMoney(owed) }), {
              action: {
                label: t("expenses.toast.undo"),
                onClick: () => void doUndoPaid(batch),
              },
            });
          }
        } catch (err) {
          if (!quiet) toast.error(t("expenses.toast.markPaidFailed"));
          throw err;
        }
      }),
    [markPaidMutation, trackBusy, fmtMoney, t, doUndoPaid]
  );

  // ── Bulk runs ──────────────────────────────────────────────────────────────
  const [bulkKind, setBulkKind] = useState<BulkActionKind | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(
    null
  );

  // Approve runs never touch flagged batches — those need eyes, not a sweep.
  const bulkEligible = useMemo(() => {
    if (bulkKind === "approve") {
      const clean = bucketed.review.filter(
        (b) => (lineStats.get(b.id)?.flagged ?? 0) === 0
      );
      return groupForReview(clean);
    }
    if (bulkKind === "pay") return payGroups;
    return [];
  }, [bulkKind, bucketed.review, lineStats, payGroups]);

  const bulkBatches = useMemo(
    () => bulkEligible.flatMap((g) => g.batches),
    [bulkEligible]
  );
  const bulkTotal = useMemo(
    () => bulkEligible.reduce((s, g) => s + g.total, 0),
    [bulkEligible]
  );
  const skippedFlagged =
    bulkKind === "approve" ? bucketed.review.length - bulkBatches.length : 0;

  const runBulk = useCallback(async () => {
    if (!bulkKind || bulkBatches.length === 0) return;
    const targets = [...bulkBatches];
    setBulkProgress({ done: 0, total: targets.length });
    let ok = 0;
    let failed = 0;
    for (const batch of targets) {
      try {
        if (bulkKind === "approve") await doApprove(batch, { quiet: true });
        else await doMarkPaid(batch, { quiet: true });
        ok += 1;
      } catch {
        failed += 1;
      }
      setBulkProgress((prev) =>
        prev ? { done: prev.done + 1, total: prev.total } : prev
      );
    }
    setBulkProgress(null);
    setBulkKind(null);
    if (failed === 0) {
      toast.success(
        t(bulkKind === "approve" ? "expenses.toast.approved" : "expenses.toast.markedPaid", {
          total: fmtMoney(bulkTotal),
        })
      );
    } else {
      toast.error(t("expenses.bulk.partial", { ok, failed }));
    }
  }, [bulkKind, bulkBatches, bulkTotal, doApprove, doMarkPaid, fmtMoney, t]);

  // Person-group actions reuse the same primitives.
  const approvePerson = useCallback(
    async (group: PersonGroup) => {
      const clean = group.batches.filter(
        (b) => (lineStats.get(b.id)?.flagged ?? 0) === 0
      );
      let total = 0;
      for (const batch of clean) {
        try {
          await doApprove(batch, { quiet: true });
          total += batch.totalAmount ?? 0;
        } catch {
          toast.error(t("expenses.toast.approveFailed"));
          return;
        }
      }
      if (total > 0) toast.success(t("expenses.toast.approved", { total: fmtMoney(total) }));
    },
    [lineStats, doApprove, fmtMoney, t]
  );

  const payPerson = useCallback(
    async (group: PersonGroup) => {
      let total = 0;
      for (const batch of group.batches) {
        try {
          await doMarkPaid(batch, { quiet: true });
          total += batchOwedAmount(batch);
        } catch {
          toast.error(t("expenses.toast.markPaidFailed"));
          return;
        }
      }
      if (total > 0) toast.success(t("expenses.toast.markedPaid", { total: fmtMoney(total) }));
    },
    [doMarkPaid, fmtMoney, t]
  );

  // ── Keyboard nav — ↑/↓ across visible rows, Esc clears ─────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (bulkKind) return; // the dialog owns keys while open

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedBatchId(null);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (visibleBatches.length === 0) return;
        const currentIndex = selectedBatchId
          ? visibleBatches.findIndex((b) => b.id === selectedBatchId)
          : -1;
        const nextIndex =
          e.key === "ArrowDown"
            ? currentIndex < visibleBatches.length - 1
              ? currentIndex + 1
              : 0
            : currentIndex > 0
              ? currentIndex - 1
              : visibleBatches.length - 1;
        setSelectedBatchId(visibleBatches[nextIndex].id);
      }
    },
    [visibleBatches, selectedBatchId, bulkKind]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Workbar ────────────────────────────────────────────────────────────────
  const chipOptions = useMemo<FilterChipOption<ExpenseBucket>[]>(() => {
    const reviewN = bucketed.review.length;
    const payN = bucketed.pay.length;
    const crewN = bucketed.crew.length;
    return [
      {
        value: "review",
        label:
          reviewN > 0
            ? t("expenses.chip.review", { n: reviewN })
            : t("expenses.chip.review.empty"),
      },
      {
        value: "pay",
        label: payN > 0 ? t("expenses.chip.pay", { n: payN }) : t("expenses.chip.pay.empty"),
      },
      { value: "paid", label: t("expenses.chip.paid") },
      {
        value: "crew",
        label:
          crewN > 0 ? t("expenses.chip.crew", { n: crewN }) : t("expenses.chip.crew.empty"),
      },
    ];
  }, [bucketed.review.length, bucketed.pay.length, bucketed.crew.length, t]);

  const bulkCta = useMemo(() => {
    if (!canReview) return null;
    if (bucket === "review") {
      const clean = bucketed.review.filter(
        (b) => (lineStats.get(b.id)?.flagged ?? 0) === 0
      );
      if (clean.length < 2) return null;
      const total = clean.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
      return (
        <WorkbarButton onClick={() => setBulkKind("approve")}>
          {t("expenses.bulk.approveConfirm", { n: clean.length, total: fmtMoney(total) })}
        </WorkbarButton>
      );
    }
    if (bucket === "pay") {
      if (bucketed.pay.length < 2) return null;
      const total = payGroups.reduce((s, g) => s + g.total, 0);
      return (
        <WorkbarButton onClick={() => setBulkKind("pay")}>
          {t("expenses.bulk.payConfirm", { n: bucketed.pay.length, total: fmtMoney(total) })}
        </WorkbarButton>
      );
    }
    return null;
  }, [canReview, bucket, bucketed.review, bucketed.pay.length, lineStats, payGroups, fmtMoney, t]);

  const isLoading = batchesLoading || expensesLoading;

  // Auto-send foresight for the selected filling envelope.
  const graceDays = settings?.autoSubmitGraceDays ?? 7;
  const selectedAutoSends = useMemo(() => {
    if (!selectedBatch?.periodEnd) return null;
    const [y, m, d] = selectedBatch.periodEnd.split("-").map(Number);
    const date = new Date(y, (m ?? 1) - 1, d ?? 1);
    date.setDate(date.getDate() + graceDays);
    return new Intl.DateTimeFormat(numLocale, { month: "short", day: "numeric" })
      .format(date)
      .toUpperCase();
  }, [selectedBatch, graceDays, numLocale]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <TableShell
        metrics={
          <>
            {metrics}
            <ExpenseInstrumentRow data={isLoading ? null : metricsData} isLoading={isLoading} />
          </>
        }
        toolbar={
          <Workbar
            filters={<FilterChips options={chipOptions} value={bucket} onChange={setBucket} />}
            meta={
              <WorkbarCount>
                {t(visibleBatches.length === 1 ? "expenses.count.one" : "expenses.count", {
                  n: visibleBatches.length,
                  total: fmtMoney(bucketTotal),
                })}
              </WorkbarCount>
            }
            create={bulkCta}
            tabStrip={segmentControl}
          />
        }
        bottomFade={false}
      >
        {isLoading ? (
          <div className="animate-pulse space-y-[2px] p-3 motion-reduce:animate-none">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-surface h-[48px]" />
            ))}
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(360px,420px)_1fr]">
            {/* Master list */}
            <div className="lg:border-r lg:border-line">
              <BatchList
                bucket={bucket}
                reviewGroups={reviewGroups}
                payGroups={payGroups}
                paidMonths={paidMonths}
                crewBatches={crewBatches}
                lineStats={lineStats}
                selectedId={selectedBatchId}
                onSelect={setSelectedBatchId}
                actions={{
                  onApproveBatch: (b) => void doApprove(b),
                  onMarkPaid: (b) => void doMarkPaid(b),
                  onApprovePerson: (g) => void approvePerson(g),
                  onPayPerson: (g) => void payPerson(g),
                }}
                canReview={canReview}
                busyIds={busyIds}
                fillingCount={
                  bucketed.crew.filter((b) => b.status === "open").length
                }
                graceDays={graceDays}
              />
            </div>

            {/* Detail — sticky under the pinned workbar on desktop */}
            <div className="hidden lg:block">
              <div
                className="lg:sticky lg:overflow-y-auto"
                style={{
                  top: "var(--shell-header-top, 0px)",
                  maxHeight: "calc(100vh - var(--shell-header-top, 0px) - 96px)",
                }}
              >
                {selectedBatch ? (
                  <BatchDetailPanel
                    batch={selectedBatch}
                    canReview={canReview}
                    onApprove={(b) => void doApprove(b)}
                    onMarkPaid={(b) => void doMarkPaid(b)}
                    onUndoPaid={(b) => void doUndoPaid(b)}
                    busy={busyIds.has(selectedBatch.id)}
                    autoSendsOn={selectedAutoSends}
                  />
                ) : (
                  <div className="flex flex-col items-start gap-1 px-6 py-12">
                    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                      <span aria-hidden className="text-text-mute">{"// "}</span>
                      {t("expenses.detail.select")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile: detail below the list */}
            {selectedBatch && (
              <div className="border-t border-line lg:hidden">
                <BatchDetailPanel
                  batch={selectedBatch}
                  canReview={canReview}
                  onApprove={(b) => void doApprove(b)}
                  onMarkPaid={(b) => void doMarkPaid(b)}
                  onUndoPaid={(b) => void doUndoPaid(b)}
                  busy={busyIds.has(selectedBatch.id)}
                  autoSendsOn={selectedAutoSends}
                />
              </div>
            )}
          </div>
        )}
      </TableShell>

      {/* Bulk confirm — portaled overlay, outside the shell */}
      {bulkKind && (
        <BulkActionModal
          kind={bulkKind}
          open
          groups={bulkEligible}
          total={bulkTotal}
          batchCount={bulkBatches.length}
          skippedFlagged={skippedFlagged}
          progress={bulkProgress}
          onConfirm={() => void runBulk()}
          onClose={() => setBulkKind(null)}
        />
      )}
    </>
  );
}
