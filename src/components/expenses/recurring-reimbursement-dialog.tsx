"use client";

/**
 * Recurring reimbursement dialog — add one, or change / end / delete one.
 *
 * A recurring reimbursement is a fixed monthly amount paid to a crew member
 * with their expenses (e.g. vehicle advertising). Setting one up is rare, so it
 * lives behind a quiet action; the dialog's job is to say exactly what will
 * happen before anything commits:
 *
 *   create → which months are filed right now, and which of those were already
 *            paid out (their line lands on the next batch)
 *   edit   → unpaid months follow the change; paid months stay as paid
 *   end    → last-month picker floored at the latest month already filed
 *   delete → only while no month has been paid (a setup made in error)
 *
 * The database is the authority for every rule; refusals map to copy.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateRecurringReimbursement,
  useDeleteRecurringReimbursement,
  useEndRecurringReimbursement,
  useUpdateRecurringReimbursement,
} from "@/lib/hooks";
import type {
  ExpenseBatch,
  ExpenseRecurringReimbursement,
} from "@/lib/types/expense-approval";
import {
  canDeleteRecurring,
  currentMonthIn,
  endMonthOptions,
  formatRecurringMoney,
  formatRecurringMonth,
  latestFiledPeriod,
  monthOptions,
  monthStart,
  placementPreview,
  recurringErrorKey,
} from "@/lib/utils/expense-recurring";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecurringPerson {
  id: string;
  name: string;
}

export type RecurringDialogMode =
  | {
      kind: "create";
      /** Fixed when opened from a person's batch; chosen in the dialog otherwise. */
      person: RecurringPerson | null;
      /** Defaults to this month; a batch passes its own period month. */
      firstPeriod: string | null;
    }
  | { kind: "edit"; setup: ExpenseRecurringReimbursement };

type Stage = "form" | "end" | "delete";

const LABEL = "block font-mono text-micro uppercase tracking-wider text-text-3";
const TABULAR = { fontFeatureSettings: '"tnum" 1, "zero" 1' } as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses typed money. Null when it is not a positive amount with at most two decimals. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 10000) return null;
  return value;
}

function listMonths(months: string[]): string {
  return months.map(formatRecurringMonth).join(", ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecurringReimbursementDialog({
  open,
  mode,
  currency,
  timeZone,
  batches,
  people,
  onClose,
}: {
  open: boolean;
  mode: RecurringDialogMode;
  /** Company currency — new setups are filed in it. Edits use the setup's own. */
  currency: string;
  timeZone: string | null;
  /** The company's batches, for the placement preview. */
  batches: ExpenseBatch[];
  /** Active people, when the person is chosen in the dialog. */
  people: RecurringPerson[];
  onClose: () => void;
}) {
  const { t } = useDictionary("books");
  const createMutation = useCreateRecurringReimbursement();
  const updateMutation = useUpdateRecurringReimbursement();
  const endMutation = useEndRecurringReimbursement();
  const deleteMutation = useDeleteRecurringReimbursement();

  const editing = mode.kind === "edit" ? mode.setup : null;
  const currentMonth = currentMonthIn(timeZone);
  const moneyCurrency = editing?.currency ?? currency;

  const [stage, setStage] = useState<Stage>("form");
  const [personId, setPersonId] = useState<string>("");
  const [name, setName] = useState("");
  const [amountText, setAmountText] = useState("");
  const [firstPeriod, setFirstPeriod] = useState(currentMonth);
  const [lastPeriod, setLastPeriod] = useState(currentMonth);

  // Reset the form each time the dialog opens for a new subject.
  useEffect(() => {
    if (!open) return;
    setStage("form");
    if (mode.kind === "edit") {
      setPersonId(mode.setup.userId);
      setName(mode.setup.name);
      setAmountText(mode.setup.amount.toFixed(2));
      setFirstPeriod(mode.setup.firstPeriod);
    } else {
      setPersonId(mode.person?.id ?? "");
      setName("");
      setAmountText("");
      setFirstPeriod(mode.firstPeriod ? monthStart(mode.firstPeriod) : currentMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only on open / subject change
  }, [open, mode.kind === "edit" ? mode.setup.id : mode.person?.id, mode.kind === "create" ? mode.firstPeriod : null]);

  const amount = parseAmount(amountText);
  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 80;

  const personName = useMemo(() => {
    if (editing) {
      const person = editing.person;
      const full = `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim();
      return full || person?.email || null;
    }
    if (mode.kind === "create" && mode.person) return mode.person.name;
    return people.find((p) => p.id === personId)?.name ?? null;
  }, [editing, mode, people, personId]);

  const firstMonthChoices = useMemo(() => monthOptions(currentMonth), [currentMonth]);

  const preview = useMemo(
    () =>
      mode.kind === "create" && personId
        ? placementPreview({ firstPeriod, currentMonth, userId: personId, batches })
        : null,
    [mode.kind, personId, firstPeriod, currentMonth, batches]
  );

  const latestFiled = editing ? latestFiledPeriod(editing.lines) : null;
  const endChoices = useMemo(
    () =>
      editing
        ? endMonthOptions({ firstPeriod: editing.firstPeriod, latestFiled, currentMonth })
        : [],
    [editing, latestFiled, currentMonth]
  );
  const deletable = editing ? canDeleteRecurring(editing.lines) : false;

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    endMutation.isPending ||
    deleteMutation.isPending;

  const unchanged =
    !!editing && trimmedName === editing.name && amount != null && amount === editing.amount;
  const canSubmit =
    !busy && nameValid && amount != null && (mode.kind === "create" ? !!personId : !unchanged);

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : undefined;
    toast.error(t(`expenses.recurring.error.${recurringErrorKey(message)}`));
  };

  // ── Commands ────────────────────────────────────────────────────────────────

  const submit = () => {
    if (!canSubmit || amount == null) return;
    if (mode.kind === "create") {
      createMutation.mutate(
        { userId: personId, name: trimmedName, amount, firstPeriod, categoryId: null },
        {
          onSuccess: (setup) => {
            toast.success(
              t("expenses.recurring.toast.added", {
                amount: formatRecurringMoney(setup.amount, setup.currency),
              })
            );
            onClose();
          },
          onError: fail,
        }
      );
      return;
    }
    if (!editing) return;
    updateMutation.mutate(
      {
        id: editing.id,
        name: trimmedName,
        amount,
        categoryId: editing.categoryId,
        expectedUpdatedAt: editing.updatedAt,
      },
      {
        onSuccess: () => {
          toast.success(t("expenses.recurring.toast.updated"));
          onClose();
        },
        onError: fail,
      }
    );
  };

  const confirmEnd = () => {
    if (!editing) return;
    endMutation.mutate(
      { id: editing.id, lastPeriod, expectedUpdatedAt: editing.updatedAt },
      {
        onSuccess: () => {
          toast.success(t("expenses.recurring.toast.ended", { month: formatRecurringMonth(lastPeriod) }));
          onClose();
        },
        onError: fail,
      }
    );
  };

  const removeEnd = () => {
    if (!editing) return;
    endMutation.mutate(
      { id: editing.id, lastPeriod: null, expectedUpdatedAt: editing.updatedAt },
      {
        onSuccess: () => {
          toast.success(t("expenses.recurring.toast.resumed"));
          onClose();
        },
        onError: fail,
      }
    );
  };

  const confirmDelete = () => {
    if (!editing) return;
    deleteMutation.mutate(
      { id: editing.id, expectedUpdatedAt: editing.updatedAt },
      {
        onSuccess: () => {
          toast.success(t("expenses.recurring.toast.deleted"));
          onClose();
        },
        onError: fail,
      }
    );
  };

  const openEnd = () => {
    const floor = endChoices[0] ?? currentMonth;
    setLastPeriod(currentMonth >= floor ? currentMonth : floor);
    setStage("end");
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-heading font-light uppercase text-text">
            {t("expenses.recurring.title")}
          </DialogTitle>
          {personName && (
            <p className="font-mohave text-body-sm text-text-3">
              {t("expenses.recurring.for", { name: personName })}
            </p>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-2 pb-2">
          {/* Person — only when not already fixed by the batch */}
          {mode.kind === "create" && !mode.person && (
            <div>
              <span className={LABEL}>{t("expenses.recurring.field.person")}</span>
              <Select value={personId} onValueChange={setPersonId} disabled={busy}>
                <SelectTrigger className="mt-0.5 h-control-36">
                  <SelectValue placeholder={t("expenses.recurring.field.personPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="z-[calc(var(--z-modal)+1)]">
                  {people.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {stage === "form" && (
            <>
              <div>
                <label htmlFor="recurring-name" className={LABEL}>
                  {t("expenses.recurring.field.name")}
                </label>
                <div className="mt-0.5">
                  <Input
                    id="recurring-name"
                    value={name}
                    maxLength={80}
                    autoComplete="off"
                    placeholder={t("expenses.recurring.field.namePlaceholder")}
                    onChange={(e) => setName(e.target.value)}
                    className="py-0"
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="recurring-amount" className={LABEL}>
                    {t("expenses.recurring.field.amount")}
                  </label>
                  <div className="mt-0.5">
                    <Input
                      id="recurring-amount"
                      value={amountText}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      prefixIcon={
                        <span className="font-mono text-caption-sm text-text-3">{moneyCurrency}</span>
                      }
                      onChange={(e) => setAmountText(e.target.value)}
                      onBlur={() => {
                        const parsed = parseAmount(amountText);
                        if (parsed != null) setAmountText(parsed.toFixed(2));
                      }}
                      // The 36px control ladder (DESIGN.md §9 inputs), level with the month select.
                      className="py-0 font-mono"
                      style={TABULAR}
                      disabled={busy}
                    />
                  </div>
                </div>

                <div>
                  {mode.kind === "create" ? (
                    <>
                      <span className={LABEL}>{t("expenses.recurring.field.firstMonth")}</span>
                      <Select value={firstPeriod} onValueChange={setFirstPeriod} disabled={busy}>
                        <SelectTrigger className="mt-0.5 h-control-36 font-mono" style={TABULAR}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[calc(var(--z-modal)+1)]">
                          {firstMonthChoices.map((month) => (
                            <SelectItem key={month} value={month} className="font-mono">
                              {formatRecurringMonth(month)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <span className={LABEL}>{t("expenses.recurring.field.since")}</span>
                      <p
                        className="mt-0.5 flex min-h-9 items-center font-mono text-data-sm text-text-2"
                        style={TABULAR}
                      >
                        {editing ? formatRecurringMonth(editing.firstPeriod) : "—"}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* What happens — stated before commit */}
              {mode.kind === "create" && preview && (
                <div className="space-y-0.5 font-mono text-micro tracking-wider" style={TABULAR}>
                  <p className="text-text-3">
                    {"[ "}
                    {preview.startsLater
                      ? t("expenses.recurring.preview.later", { month: formatRecurringMonth(firstPeriod) })
                      : t("expenses.recurring.preview.now", {
                          amount: amount != null ? formatRecurringMoney(amount, moneyCurrency) : "—",
                          months: listMonths(preview.filedNow),
                        })}
                    {" ]"}
                  </p>
                  {preview.paidOut.length > 0 && (
                    <p className="text-tan">
                      {"[ "}
                      {t("expenses.recurring.preview.paidOut", { months: listMonths(preview.paidOut) })}
                      {" ]"}
                    </p>
                  )}
                </div>
              )}

              {editing && (
                <div className="space-y-0.5 font-mono text-micro tracking-wider text-text-3" style={TABULAR}>
                  <p>
                    {"[ "}
                    {t("expenses.recurring.preview.update")}
                    {" ]"}
                  </p>
                  <p className="flex items-center gap-1">
                    <span>
                      {"[ "}
                      {editing.lastPeriod
                        ? t("expenses.recurring.preview.ends", {
                            month: formatRecurringMonth(editing.lastPeriod),
                          })
                        : t("expenses.recurring.preview.running")}
                      {" ]"}
                    </span>
                    {editing.lastPeriod && (
                      <button
                        type="button"
                        onClick={removeEnd}
                        disabled={busy}
                        className="uppercase text-text-2 transition-colors duration-150 ease-smooth hover:text-text disabled:opacity-40"
                      >
                        {t("expenses.recurring.action.removeEnd")}
                      </button>
                    )}
                  </p>
                </div>
              )}
            </>
          )}

          {/* End — choose the last month paid */}
          {stage === "end" && editing && (
            <div>
              <span className={LABEL}>{t("expenses.recurring.field.lastMonth")}</span>
              <Select value={lastPeriod} onValueChange={setLastPeriod} disabled={busy}>
                <SelectTrigger className="mt-0.5 h-control-36 font-mono" style={TABULAR}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[calc(var(--z-modal)+1)]">
                  {endChoices.map((month) => (
                    <SelectItem key={month} value={month} className="font-mono">
                      {formatRecurringMonth(month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Delete — only for a setup made in error */}
          {stage === "delete" && editing && (
            <p className="font-mono text-caption-sm text-rose">
              {t("expenses.recurring.deleteWarning")}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1 border-t border-line pt-2">
          {stage === "form" && editing && (
            <>
              <Button type="button" variant="ghost" onClick={openEnd} disabled={busy}>
                {t("expenses.recurring.action.end")}
              </Button>
              {deletable && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStage("delete")}
                  disabled={busy}
                  className="hover:text-rose"
                >
                  {t("expenses.recurring.action.delete")}
                </Button>
              )}
            </>
          )}

          <span className="min-w-0 flex-1" />

          <Button
            type="button"
            variant="secondary"
            onClick={() => (stage === "form" ? onClose() : setStage("form"))}
            disabled={busy}
          >
            {t("expenses.recurring.action.cancel")}
          </Button>

          {stage === "form" && (
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              disabled={!canSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {t(mode.kind === "create" ? "expenses.recurring.action.add" : "expenses.recurring.action.save")}
            </Button>
          )}

          {stage === "end" && (
            <Button
              type="button"
              variant="primary"
              onClick={confirmEnd}
              disabled={busy}
              loading={endMutation.isPending}
            >
              {t("expenses.recurring.action.endAfter", { month: formatRecurringMonth(lastPeriod) })}
            </Button>
          )}

          {stage === "delete" && (
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={busy}
              loading={deleteMutation.isPending}
            >
              {t("expenses.recurring.action.deleteConfirm")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
