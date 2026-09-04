"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { SupplierBillCaptureDialog } from "@/components/books/supplier-bills/supplier-bill-capture-dialog";
import { countSupplierBillStages } from "@/components/books/supplier-bills/supplier-bill-presenter";
import { SupplierBillReviewPanel } from "@/components/books/supplier-bills/supplier-bill-review-panel";
import {
  FilterChips,
  type FilterChipOption,
} from "@/components/ui/filter-chip";
import {
  TableShell,
  Workbar,
  WorkbarButton,
  WorkbarCount,
} from "@/components/ui/table-shell";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { SupplierBillIntakeStage } from "@/lib/accounting/supplier-bills/intake-contracts";
import {
  useProjects,
  useSupplierBillExpenseCategories,
  useSupplierBillIntake,
  useSupplierBillIntakes,
  useTeamMembers,
} from "@/lib/hooks";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";

const STAGES: SupplierBillIntakeStage[] = [
  "review",
  "to_pay",
  "paid",
  "held",
  "payroll",
];

function isStage(value: string | null): value is SupplierBillIntakeStage {
  return Boolean(value && STAGES.includes(value as SupplierBillIntakeStage));
}

export function BillsSegment({
  metrics,
  segmentControl,
}: {
  metrics: React.ReactNode;
  segmentControl: React.ReactNode;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = usePermissionStore((state) => state.can);
  const canCapture = can("accounting.bills.capture");
  const canApprove = can("accounting.bills.approve");
  const canPay = can("accounting.bills.pay");

  const stageParam = searchParams.get("stage");
  const stage: SupplierBillIntakeStage = isStage(stageParam)
    ? stageParam
    : "review";
  const billParam = searchParams.get("bill");
  const [selectedId, setSelectedId] = useState<string | null>(billParam);
  const [captureOpen, setCaptureOpen] = useState(false);

  const {
    data: bills = [],
    isLoading,
    isError,
    refetch,
  } = useSupplierBillIntakes();
  const visible = useMemo(
    () => bills.filter((bill) => bill.review_stage === stage),
    [bills, stage]
  );
  const counts = useMemo(() => countSupplierBillStages(bills), [bills]);
  const { data: detail, isLoading: detailLoading } =
    useSupplierBillIntake(selectedId);
  const { data: projectsData } = useProjects();
  const { data: teamData } = useTeamMembers();
  const { data: categories = [] } = useSupplierBillExpenseCategories();

  useEffect(() => {
    if (billParam && bills.some((bill) => bill.id === billParam)) {
      setSelectedId(billParam);
      return;
    }
    if (!selectedId || !visible.some((bill) => bill.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [billParam, bills, selectedId, visible]);

  const replaceParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      router.replace(`/books?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const selectBill = (id: string) => {
    setSelectedId(id);
    replaceParams({ bill: id });
  };

  const chipOptions = useMemo<FilterChipOption<SupplierBillIntakeStage>[]>(
    () =>
      STAGES.map((value) => ({
        value,
        label:
          counts[value] > 0
            ? t(`bills.stage.${value}.count`, { n: counts[value] })
            : t(`bills.stage.${value}`),
      })),
    [counts, t]
  );

  const fmtMoney = (value: string, currency: string) =>
    new Intl.NumberFormat(numLocale, {
      style: "currency",
      currency,
    }).format(Number(value));

  return (
    <>
      <TableShell
        metrics={metrics}
        toolbar={
          <Workbar
            filters={
              <FilterChips
                options={chipOptions}
                value={stage}
                onChange={(next) =>
                  replaceParams({
                    stage: next === "review" ? null : next,
                    bill: null,
                  })
                }
              />
            }
            meta={
              <WorkbarCount>
                {t(visible.length === 1 ? "bills.count.one" : "bills.count", {
                  n: visible.length,
                })}
              </WorkbarCount>
            }
            create={
              canCapture ? (
                <WorkbarButton onClick={() => setCaptureOpen(true)}>
                  {t("bills.capture.open")}
                </WorkbarButton>
              ) : null
            }
            tabStrip={segmentControl}
          />
        }
        bottomFade={false}
      >
        {isLoading ? (
          <div className="animate-pulse space-y-0.5 p-3 motion-reduce:animate-none">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="glass-surface min-h-9" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-start gap-1 p-3">
            <span className="font-mono text-micro uppercase tracking-widest text-rose">
              {t("bills.error")}
            </span>
            <WorkbarButton onClick={() => void refetch()}>
              {t("ledger.retry")}
            </WorkbarButton>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-2">
            <div className="lg:border-r lg:border-line">
              {visible.length === 0 ? (
                <div className="flex flex-col items-start gap-0.5 p-3">
                  <span className="font-mono text-micro uppercase tracking-widest text-text-2">
                    <span aria-hidden className="text-text-mute">
                      {"// "}
                    </span>
                    {t(`bills.empty.${stage}`)}
                  </span>
                  <span className="font-mohave text-body-sm text-text-3">
                    {t(`bills.empty.${stage}.hint`)}
                  </span>
                </div>
              ) : (
                <div role="list">
                  {visible.map((bill) => {
                    const selected = bill.id === selectedId;
                    const attention =
                      bill.review_stage === "review" ||
                      bill.review_stage === "held";
                    return (
                      <button
                        key={bill.id}
                        type="button"
                        role="listitem"
                        onClick={() => selectBill(bill.id)}
                        className={cn(
                          "flex min-h-9 w-full items-start gap-1.5 border-b border-line px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ops-accent",
                          selected
                            ? "bg-surface-active"
                            : "hover:bg-surface-hover"
                        )}
                      >
                        {attention ? (
                          <AlertTriangle
                            className={cn(
                              "mt-0.5 h-icon-16 w-icon-16 shrink-0",
                              bill.review_stage === "held"
                                ? "text-rose"
                                : "text-ops-amber"
                            )}
                          />
                        ) : (
                          <ShieldCheck className="mt-0.5 h-icon-16 w-icon-16 shrink-0 text-olive" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-1">
                            <span className="truncate font-mohave text-body text-text">
                              {bill.supplier_name}
                            </span>
                            <span className="shrink-0 font-mono text-body-sm tabular-nums text-text">
                              {fmtMoney(bill.total, bill.currency)}
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-1 font-mono text-caption-sm uppercase tracking-wider text-text-3">
                            <span className="truncate">
                              {bill.invoice_number} · {bill.invoice_date}
                            </span>
                            <span>{t(`bills.stage.${bill.review_stage}`)}</span>
                          </span>
                          {bill.hold_reason ? (
                            <span className="mt-0.5 block truncate font-mohave text-body-sm text-rose">
                              {bill.hold_reason}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <div className="sticky top-[var(--shell-header-top,0px)] max-h-[calc(100vh-var(--shell-header-top,0px))] overflow-y-auto">
                {detailLoading ? (
                  <div className="animate-pulse space-y-1 p-3 motion-reduce:animate-none">
                    <div className="glass-surface min-h-9" />
                    <div className="glass-surface min-h-20" />
                  </div>
                ) : detail ? (
                  <SupplierBillReviewPanel
                    detail={detail}
                    projects={projectsData?.projects ?? []}
                    users={teamData?.users ?? []}
                    categories={categories}
                    canCapture={canCapture}
                    canApprove={canApprove}
                    canPay={canPay}
                  />
                ) : (
                  <div className="flex flex-col items-start gap-1 p-3">
                    <FileText className="h-icon-20 w-icon-20 text-text-mute" />
                    <span className="font-mono text-micro uppercase tracking-widest text-text-3">
                      {t("bills.detail.select")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {detail ? (
              <div className="border-t border-line lg:hidden">
                <SupplierBillReviewPanel
                  detail={detail}
                  projects={projectsData?.projects ?? []}
                  users={teamData?.users ?? []}
                  categories={categories}
                  canCapture={canCapture}
                  canApprove={canApprove}
                  canPay={canPay}
                />
              </div>
            ) : null}
          </div>
        )}
      </TableShell>

      <SupplierBillCaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
      />
    </>
  );
}
