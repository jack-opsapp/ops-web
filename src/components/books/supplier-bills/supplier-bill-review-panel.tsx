"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import {
  isSharedSupplierCharge,
  suggestSharedChargeAllocations,
} from "@/lib/accounting/supplier-bills/canpro-reconciliation";
import type {
  SupplierBillCheckOutcome,
  SupplierBillCheckDisposition,
} from "@/lib/accounting/supplier-bills/intake-contracts";
import {
  useCommitSupplierBillWrite,
  usePrepareSupplierBillAction,
  type SupplierBillExpenseCategory,
  type SupplierBillIntakeCheck,
  type SupplierBillIntakeDetail,
} from "@/lib/hooks/use-supplier-bill-intakes";
import type { Project, User } from "@/lib/types/models";
import { cn } from "@/lib/utils/cn";
import { suggestProjectForJobHint } from "./supplier-bill-presenter";

type DraftCheck = Pick<
  SupplierBillIntakeCheck,
  | "check_key"
  | "outcome"
  | "disposition"
  | "observed_value"
  | "policy_limit"
  | "evidence"
  | "note"
>;

type DraftAllocation = {
  projectId: string;
  amount: string;
  basis: "confirmed_suggestion" | "manual";
};

function cents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function money(centsValue: number): string {
  return (centsValue / 100).toFixed(2);
}

function allocationsAreExact(
  total: string,
  allocations: readonly DraftAllocation[]
): boolean {
  return (
    allocations.length > 0 &&
    allocations.every(
      (allocation) => allocation.projectId && cents(allocation.amount) > 0
    ) &&
    new Set(allocations.map((allocation) => allocation.projectId)).size ===
      allocations.length &&
    allocations.reduce(
      (sum, allocation) => sum + cents(allocation.amount),
      0
    ) === cents(total)
  );
}

function persistedClearanceReady(detail: SupplierBillIntakeDetail): boolean {
  const intake = detail.intake;
  const checksReady = detail.checks.every(
    (check) =>
      check.outcome !== "pending" &&
      check.disposition === "accepted" &&
      (check.outcome !== "exception" || Boolean(check.note?.trim()))
  );
  const allocationsReady = detail.lines.every((line) => {
    const allocations = line.supplier_bill_intake_allocations.filter(
      (allocation) => allocation.confirmed_by
    );
    return (
      allocations.length > 0 &&
      allocations.reduce(
        (sum, allocation) => sum + cents(allocation.amount),
        0
      ) === cents(line.total)
    );
  });
  return Boolean(
    intake.category_id &&
    intake.payment_owner_id &&
    intake.planned_payment_date &&
    checksReady &&
    allocationsReady
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierBillReviewPanel({
  detail,
  projects,
  users,
  categories,
  canCapture,
  canApprove,
  canPay,
}: {
  detail: SupplierBillIntakeDetail;
  projects: Project[];
  users: User[];
  categories: SupplierBillExpenseCategory[];
  canCapture: boolean;
  canApprove: boolean;
  canPay: boolean;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const prepare = usePrepareSupplierBillAction();
  const commit = useCommitSupplierBillWrite();
  const intake = detail.intake;
  const busy = prepare.isPending || commit.isPending;

  const [categoryId, setCategoryId] = useState(intake.category_id ?? "");
  const [paymentOwnerId, setPaymentOwnerId] = useState(
    intake.payment_owner_id ?? ""
  );
  const [plannedPaymentDate, setPlannedPaymentDate] = useState(
    intake.planned_payment_date ?? ""
  );
  const [checks, setChecks] = useState<DraftCheck[]>([]);
  const [allocations, setAllocations] = useState<
    Record<number, DraftAllocation[]>
  >({});
  const [holdReason, setHoldReason] = useState(intake.hold_reason ?? "");
  const [nextAction, setNextAction] = useState(intake.next_action ?? "");
  const [paymentAmount, setPaymentAmount] = useState(
    intake.supplier_bills?.balance ?? intake.total
  );
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("eft");
  const [paymentReference, setPaymentReference] = useState("");

  useEffect(() => {
    setCategoryId(intake.category_id ?? "");
    setPaymentOwnerId(intake.payment_owner_id ?? "");
    setPlannedPaymentDate(intake.planned_payment_date ?? "");
    setHoldReason(intake.hold_reason ?? "");
    setNextAction(intake.next_action ?? "");
    setPaymentAmount(intake.supplier_bills?.balance ?? intake.total);
    setChecks(
      detail.checks.map((check) => ({
        check_key: check.check_key,
        outcome: check.outcome,
        disposition: check.disposition,
        observed_value: check.observed_value,
        policy_limit: check.policy_limit,
        evidence: check.evidence,
        note: check.note,
      }))
    );

    const nextAllocations: Record<number, DraftAllocation[]> = {};
    for (const line of detail.lines) {
      const stored = line.supplier_bill_intake_allocations;
      if (stored.length > 0) {
        nextAllocations[line.position] = stored.map((allocation) => ({
          projectId: allocation.project_id,
          amount: allocation.amount,
          basis:
            allocation.allocation_basis === "manual"
              ? "manual"
              : "confirmed_suggestion",
        }));
        continue;
      }
      const suggestion = suggestProjectForJobHint(line.job_hint, projects);
      nextAllocations[line.position] = suggestion
        ? [
            {
              projectId: suggestion,
              amount: line.total,
              basis: "confirmed_suggestion",
            },
          ]
        : [];
    }
    setAllocations(nextAllocations);
  }, [detail, intake, projects]);

  const fmtMoney = (value: string) =>
    new Intl.NumberFormat(numLocale, {
      style: "currency",
      currency: intake.currency,
    }).format(Number(value));

  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.title ??
    t("bills.job.unknown");

  const updateCheck = (
    key: SupplierBillIntakeCheck["check_key"],
    patch: Partial<{
      outcome: SupplierBillCheckOutcome;
      disposition: SupplierBillCheckDisposition;
      note: string | null;
    }>
  ) =>
    setChecks((current) =>
      current.map((check) =>
        check.check_key === key ? { ...check, ...patch } : check
      )
    );

  const run = async (
    command: Record<string, unknown>,
    successKey: string,
    needsConfirmation = false
  ) => {
    try {
      const prepared = await prepare.mutateAsync({
        intakeId: intake.id,
        command,
      });
      if (
        needsConfirmation &&
        !window.confirm(
          t("bills.confirm.body", { confirmation: prepared.confirmationText })
        )
      ) {
        return;
      }
      await commit.mutateAsync({ intakeId: intake.id, prepared });
      toast.success(t(successKey));
    } catch {
      toast.error(t("bills.toast.failed"));
    }
  };

  const serializedChecks = checks.map((check) => ({
    key: check.check_key,
    outcome: check.outcome,
    disposition: check.disposition,
    observedValue: check.observed_value,
    policyLimit: check.policy_limit,
    evidence: check.evidence,
    note: check.note,
  }));

  const serializedAllocations = detail.lines.flatMap((line) =>
    (allocations[line.position] ?? [])
      .filter(
        (allocation) => allocation.projectId && cents(allocation.amount) > 0
      )
      .map((allocation) => ({
        linePosition: line.position,
        projectId: allocation.projectId,
        amount: money(cents(allocation.amount)),
        basis: allocation.basis,
      }))
  );

  const draftReady = Boolean(
    categoryId &&
    paymentOwnerId &&
    plannedPaymentDate &&
    checks.every(
      (check) =>
        check.outcome !== "pending" &&
        check.disposition === "accepted" &&
        (check.outcome !== "exception" || Boolean(check.note?.trim()))
    ) &&
    detail.lines.every((line) =>
      allocationsAreExact(line.total, allocations[line.position] ?? [])
    )
  );
  const storedReady = persistedClearanceReady(detail);

  const saveReview = () =>
    run(
      {
        kind: "save_review",
        expectedRevision: intake.revision,
        idempotencyKey: `save-review:${intake.id}:v${intake.revision}`,
        categoryId: categoryId || null,
        paymentOwnerId: paymentOwnerId || null,
        plannedPaymentDate: plannedPaymentDate || null,
        checks: serializedChecks,
        allocations: serializedAllocations,
      },
      draftReady ? "bills.toast.cleared" : "bills.toast.saved"
    );

  const splitSharedLine = (position: number, total: string) => {
    const weights = new Map<string, number>();
    for (const line of detail.lines) {
      if (
        line.position === position ||
        isSharedSupplierCharge(line.description)
      )
        continue;
      const first = allocations[line.position]?.[0];
      if (!first?.projectId) continue;
      weights.set(
        first.projectId,
        (weights.get(first.projectId) ?? 0) + cents(line.subtotal)
      );
    }
    if (weights.size === 0) {
      toast.error(t("bills.allocation.splitNeedsJobs"));
      return;
    }
    const suggested = suggestSharedChargeAllocations(
      total,
      [...weights].map(([projectId, materialSubtotal]) => ({
        projectId,
        materialSubtotal: money(materialSubtotal),
      }))
    );
    setAllocations((current) => ({
      ...current,
      [position]: suggested.map((allocation) => ({
        ...allocation,
        basis: "confirmed_suggestion",
      })),
    }));
  };

  const addSplit = (position: number, total: string) => {
    setAllocations((current) => {
      const existing = current[position] ?? [];
      const unused = projects.find(
        (project) =>
          !existing.some((allocation) => allocation.projectId === project.id)
      );
      if (!unused) return current;
      const remaining = Math.max(
        0,
        cents(total) -
          existing.reduce(
            (sum, allocation) => sum + cents(allocation.amount),
            0
          )
      );
      return {
        ...current,
        [position]: [
          ...existing,
          {
            projectId: unused.id,
            amount: money(remaining),
            basis: "manual",
          },
        ],
      };
    });
  };

  return (
    <div className="space-y-3 p-3">
      <header className="border-b border-line pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-micro uppercase tracking-widest text-text-3">
              {t(`bills.kind.${intake.document_kind}`)} ·{" "}
              {intake.invoice_number}
            </p>
            <h2 className="truncate font-mohave text-heading text-text">
              {intake.supplier_name}
            </h2>
          </div>
          <p className="font-mono text-heading tabular-nums text-text">
            {fmtMoney(intake.total)}
          </p>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-caption-sm uppercase tracking-wider text-text-3">
          <span>{intake.invoice_date}</span>
          <span>
            {intake.due_date
              ? t("bills.detail.due", { date: intake.due_date })
              : t("bills.detail.noDueDate")}
          </span>
          {intake.purchase_order ? <span>{intake.purchase_order}</span> : null}
        </div>
      </header>

      {detail.document ? (
        <a
          href={detail.document.public_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded border border-line bg-surface-input px-2 py-1.5 text-text-2 transition-colors hover:border-line-hi hover:text-text"
        >
          <span className="inline-flex min-w-0 items-center gap-1 font-mono text-caption-sm uppercase tracking-wider">
            <FileText className="h-icon-16 w-icon-16 shrink-0" />
            <span className="truncate">
              {detail.document.original_filename}
            </span>
          </span>
          <ExternalLink className="h-icon-16 w-icon-16 shrink-0" />
        </a>
      ) : null}

      {intake.review_stage === "held" ? (
        <section className="rounded border border-rose-line bg-rose-soft p-2">
          <p className="font-mono text-micro uppercase tracking-widest text-rose">
            {t("bills.hold.title")}
          </p>
          <p className="mt-0.5 font-mohave text-body text-text">
            {intake.hold_reason}
          </p>
          <p className="font-mohave text-body-sm text-text-2">
            {intake.next_action}
          </p>
          {canCapture ? (
            <Button
              className="mt-1"
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() =>
                void run(
                  {
                    kind: "release_hold",
                    expectedRevision: intake.revision,
                    idempotencyKey: `release-hold:${intake.id}:v${intake.revision}`,
                  },
                  "bills.toast.released",
                  true
                )
              }
            >
              {t("bills.hold.release")}
            </Button>
          ) : null}
        </section>
      ) : null}

      {intake.review_stage === "review" || intake.review_stage === "held" ? (
        <>
          <section className="space-y-1.5">
            <p className="font-mono text-micro uppercase tracking-widest text-text-3">
              {t("bills.clearance.title")}
            </p>
            {checks.map((check) => {
              const accepted = check.disposition === "accepted";
              const exception = check.outcome === "exception";
              return (
                <div
                  key={check.check_key}
                  className={cn(
                    "rounded border p-1.5",
                    accepted
                      ? "border-olive-line bg-olive-soft"
                      : exception
                        ? "border-rose-line bg-rose-soft"
                        : "border-line bg-surface-input"
                  )}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <span className="inline-flex min-w-0 items-center gap-1 font-mono text-caption-sm uppercase tracking-wider text-text">
                      {accepted ? (
                        <Check className="h-icon-16 w-icon-16 shrink-0 text-olive" />
                      ) : exception ? (
                        <AlertTriangle className="h-icon-16 w-icon-16 shrink-0 text-rose" />
                      ) : (
                        <ShieldCheck className="h-icon-16 w-icon-16 shrink-0 text-text-3" />
                      )}
                      {t(`bills.check.${check.check_key}`)}
                    </span>
                    {canCapture ? (
                      <Button
                        size="sm"
                        variant={accepted ? "ghost" : "secondary"}
                        disabled={exception && !check.note?.trim()}
                        onClick={() =>
                          updateCheck(check.check_key, {
                            outcome:
                              check.outcome === "pending"
                                ? "clear"
                                : check.outcome,
                            disposition: accepted ? "unresolved" : "accepted",
                          })
                        }
                      >
                        {accepted
                          ? t("bills.check.reopen")
                          : exception
                            ? t("bills.check.acceptException")
                            : t("bills.check.confirm")}
                      </Button>
                    ) : null}
                  </div>
                  {check.observed_value ? (
                    <p className="mt-0.5 font-mono text-caption-sm text-text-2">
                      {check.observed_value}
                      {check.policy_limit
                        ? ` · ${t("bills.check.limit", { limit: check.policy_limit })}`
                        : ""}
                    </p>
                  ) : null}
                  {exception ? (
                    <Textarea
                      className="mt-1 min-h-control-40"
                      value={check.note ?? ""}
                      placeholder={t("bills.check.exceptionNote")}
                      onChange={(event) =>
                        updateCheck(check.check_key, {
                          note: event.target.value || null,
                        })
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="space-y-1.5">
            <p className="font-mono text-micro uppercase tracking-widest text-text-3">
              {t("bills.allocation.title")}
            </p>
            {detail.lines.map((line) => {
              const shared = isSharedSupplierCharge(line.description);
              const lineAllocations = allocations[line.position] ?? [];
              const exact = allocationsAreExact(line.total, lineAllocations);
              return (
                <div
                  key={line.id}
                  className="space-y-1 rounded border border-line bg-surface-input p-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mohave text-body text-text">
                        {line.description}
                      </p>
                      <p className="font-mono text-caption-sm uppercase tracking-wider text-text-3">
                        {line.job_hint ?? t("bills.job.noHint")}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-body-sm tabular-nums text-text">
                      {fmtMoney(line.total)}
                    </span>
                  </div>

                  {lineAllocations.map((allocation, index) => (
                    <div
                      key={`${line.position}-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1"
                    >
                      <Select
                        value={allocation.projectId}
                        onValueChange={(projectId) =>
                          setAllocations((current) => ({
                            ...current,
                            [line.position]: lineAllocations.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, projectId, basis: "manual" }
                                  : item
                            ),
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("bills.job.confirm")} />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label={t("bills.allocation.amount")}
                        inputMode="decimal"
                        value={allocation.amount}
                        onChange={(event) =>
                          setAllocations((current) => ({
                            ...current,
                            [line.position]: lineAllocations.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      amount: event.target.value,
                                      basis: "manual",
                                    }
                                  : item
                            ),
                          }))
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("bills.allocation.remove")}
                        onClick={() =>
                          setAllocations((current) => ({
                            ...current,
                            [line.position]: lineAllocations.filter(
                              (_, itemIndex) => itemIndex !== index
                            ),
                          }))
                        }
                      >
                        <Trash2 className="h-icon-16 w-icon-16" />
                      </Button>
                    </div>
                  ))}

                  {lineAllocations.length === 0 ? (
                    <Select
                      onValueChange={(projectId) =>
                        setAllocations((current) => ({
                          ...current,
                          [line.position]: [
                            {
                              projectId,
                              amount: line.total,
                              basis: "manual",
                            },
                          ],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("bills.job.confirm")} />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span
                      className={cn(
                        "font-mono text-caption-sm uppercase tracking-wider",
                        exact ? "text-olive" : "text-rose"
                      )}
                    >
                      {exact
                        ? t("bills.allocation.exact")
                        : t("bills.allocation.mismatch")}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {shared ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            splitSharedLine(line.position, line.total)
                          }
                        >
                          {t("bills.allocation.split")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => addSplit(line.position, line.total)}
                      >
                        <Plus className="h-icon-16 w-icon-16" />
                        {t("bills.allocation.add")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="grid gap-1.5 border-t border-line pt-2 sm:grid-cols-3">
            <div className="space-y-0.5">
              <label className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
                {t("bills.plan.category")}
              </label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("bills.plan.chooseCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <label className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
                {t("bills.plan.owner")}
              </label>
              <Select value={paymentOwnerId} onValueChange={setPaymentOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("bills.plan.chooseOwner")} />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {[user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="date"
              label={t("bills.plan.date")}
              value={plannedPaymentDate}
              onChange={(event) => setPlannedPaymentDate(event.target.value)}
            />
          </section>

          {canCapture ? (
            <div className="flex flex-wrap justify-end gap-1 border-t border-line pt-2">
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void saveReview()}
              >
                {draftReady
                  ? t("bills.action.saveClearance")
                  : t("bills.action.saveReview")}
              </Button>
              {canApprove && intake.review_stage === "review" ? (
                <Button
                  variant="primary"
                  disabled={!storedReady}
                  loading={busy}
                  onClick={() =>
                    void run(
                      {
                        kind: "approve",
                        expectedRevision: intake.revision,
                        idempotencyKey: `approve:${intake.id}:v${intake.revision}`,
                      },
                      "bills.toast.approved",
                      true
                    )
                  }
                >
                  {t("bills.action.approve")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {canCapture && intake.review_stage === "review" ? (
            <section className="space-y-1.5 border-t border-line pt-2">
              <p className="font-mono text-micro uppercase tracking-widest text-text-3">
                {t("bills.hold.title")}
              </p>
              <Textarea
                label={t("bills.hold.reason")}
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
              />
              <Textarea
                label={t("bills.hold.next")}
                value={nextAction}
                onChange={(event) => setNextAction(event.target.value)}
              />
              <Button
                variant="destructive"
                disabled={!holdReason.trim() || !nextAction.trim()}
                loading={busy}
                onClick={() =>
                  void run(
                    {
                      kind: "hold",
                      expectedRevision: intake.revision,
                      idempotencyKey: `hold:${intake.id}:v${intake.revision}`,
                      holdReason,
                      nextAction,
                    },
                    "bills.toast.held",
                    true
                  )
                }
              >
                {t("bills.hold.cta")}
              </Button>
            </section>
          ) : null}
        </>
      ) : null}

      {intake.review_stage === "to_pay" ? (
        <section className="space-y-2">
          <div className="rounded border border-olive-line bg-olive-soft p-2">
            <p className="font-mono text-micro uppercase tracking-widest text-olive">
              {t("bills.payment.approved")}
            </p>
            <p className="mt-0.5 font-mohave text-body text-text">
              {t("bills.payment.balance", {
                total: fmtMoney(intake.supplier_bills?.balance ?? intake.total),
              })}
            </p>
          </div>

          {canPay ? (
            <>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <div className="space-y-0.5">
                  <label className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
                    {t("bills.plan.owner")}
                  </label>
                  <Select
                    value={paymentOwnerId}
                    onValueChange={setPaymentOwnerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("bills.plan.chooseOwner")} />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {[user.firstName, user.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  type="date"
                  label={t("bills.plan.date")}
                  value={plannedPaymentDate}
                  onChange={(event) =>
                    setPlannedPaymentDate(event.target.value)
                  }
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!paymentOwnerId || !plannedPaymentDate}
                loading={busy}
                onClick={() =>
                  void run(
                    {
                      kind: "schedule_payment",
                      expectedRevision: intake.revision,
                      idempotencyKey: `schedule-payment:${intake.id}:v${intake.revision}`,
                      paymentOwnerId,
                      plannedPaymentDate,
                    },
                    "bills.toast.scheduled"
                  )
                }
              >
                {t("bills.payment.savePlan")}
              </Button>

              <div className="grid gap-1.5 border-t border-line pt-2 sm:grid-cols-2">
                <Input
                  label={t("bills.payment.amount")}
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
                <Input
                  type="date"
                  label={t("bills.payment.date")}
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
                <div className="space-y-0.5">
                  <label className="font-mohave text-caption-sm uppercase tracking-wide text-text-3">
                    {t("bills.payment.method")}
                  </label>
                  <Select
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          "eft",
                          "check",
                          "credit_card",
                          "cash",
                          "other",
                        ] as const
                      ).map((method) => (
                        <SelectItem key={method} value={method}>
                          {t(`bills.payment.method.${method}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  label={t("bills.payment.reference")}
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </div>
              <Button
                variant="primary"
                disabled={cents(paymentAmount) <= 0 || !paymentDate}
                loading={busy}
                onClick={() =>
                  void run(
                    {
                      kind: "record_payment",
                      expectedRevision: intake.revision,
                      idempotencyKey: `record-payment:${intake.id}:v${intake.revision}`,
                      payment: {
                        amount: money(cents(paymentAmount)),
                        paymentDate,
                        paymentMethod,
                        reference: paymentReference || null,
                      },
                    },
                    "bills.toast.paid",
                    true
                  )
                }
              >
                {t("bills.payment.record")}
              </Button>
            </>
          ) : null}
        </section>
      ) : null}

      {intake.review_stage === "paid" ? (
        <section className="rounded border border-olive-line bg-olive-soft p-2">
          <p className="font-mono text-micro uppercase tracking-widest text-olive">
            {t("bills.payment.paid")}
          </p>
          <p className="font-mohave text-body text-text">
            {intake.paid_at
              ? new Intl.DateTimeFormat(numLocale, {
                  dateStyle: "medium",
                }).format(new Date(intake.paid_at))
              : "—"}
          </p>
        </section>
      ) : null}

      {intake.review_stage === "payroll" ? (
        <section className="rounded border border-line bg-surface-input p-2">
          <p className="font-mono text-micro uppercase tracking-widest text-text-2">
            {t("bills.payroll.title")}
          </p>
          <p className="font-mohave text-body-sm text-text-3">
            {t("bills.payroll.body")}
          </p>
        </section>
      ) : null}

      {detail.lines.length > 0 &&
      intake.review_stage !== "review" &&
      intake.review_stage !== "held" ? (
        <section className="space-y-1.5 border-t border-line pt-2">
          <p className="font-mono text-micro uppercase tracking-widest text-text-3">
            {t("bills.detail.lines")}
          </p>
          {detail.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start justify-between gap-2 border-b border-line pb-1"
            >
              <div>
                <p className="font-mohave text-body-sm text-text">
                  {line.description}
                </p>
                <p className="font-mono text-caption-sm uppercase tracking-wider text-text-3">
                  {line.supplier_bill_intake_allocations
                    .map((allocation) => projectName(allocation.project_id))
                    .join(" · ") || "—"}
                </p>
              </div>
              <span className="shrink-0 font-mono text-body-sm tabular-nums text-text-2">
                {fmtMoney(line.total)}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
