"use client";

/**
 * Settings → Expenses → RECURRING REIMBURSEMENTS
 *
 * The one place to see every fixed monthly amount the company pays with
 * expenses (vehicle advertising, phone plans…), what that adds up to each
 * month, and who receives it. Day to day these are handled from a person's
 * batch; this list is for the overview and for setting one up for someone
 * who has no batch yet. Rows open the same dialog the batch console uses.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useExpenseBatches,
  useRecurringReimbursements,
  useTeamMembers,
} from "@/lib/hooks";
import type { ExpenseRecurringReimbursement } from "@/lib/types/expense-approval";
import {
  currentMonthIn,
  formatRecurringMoney,
  formatRecurringMonth,
} from "@/lib/utils/expense-recurring";
import {
  RecurringReimbursementDialog,
  type RecurringDialogMode,
  type RecurringPerson,
} from "@/components/expenses/recurring-reimbursement-dialog";

const TABULAR = { fontFeatureSettings: '"tnum" 1, "zero" 1' } as const;

function personLabel(setup: ExpenseRecurringReimbursement): string {
  const full = `${setup.person?.firstName ?? ""} ${setup.person?.lastName ?? ""}`.trim();
  return full || setup.person?.email || "—";
}

export function RecurringReimbursementsCard() {
  const { t } = useDictionary("settings");
  const canManage = usePermissionStore((s) => s.can("expenses.approve"));
  const { data, isLoading } = useRecurringReimbursements();
  const { data: batches = [] } = useExpenseBatches();
  const { data: team } = useTeamMembers();
  const [dialog, setDialog] = useState<RecurringDialogMode | null>(null);

  const currentMonth = currentMonthIn(data?.timeZone ?? null);
  const setups = useMemo(
    () =>
      [...(data?.setups ?? [])].sort(
        (a, b) => personLabel(a).localeCompare(personLabel(b)) || a.name.localeCompare(b.name)
      ),
    [data]
  );

  // What goes out this month: setups that have started and not yet ended.
  const running = setups.filter(
    (s) => s.firstPeriod <= currentMonth && (s.lastPeriod == null || s.lastPeriod >= currentMonth)
  );
  const currency = data?.currency ?? "USD";
  const monthlyTotal = running
    .filter((s) => s.currency === currency)
    .reduce((sum, s) => sum + s.amount, 0);
  const peopleCount = new Set(running.map((s) => s.userId)).size;

  const people = useMemo<RecurringPerson[]>(
    () =>
      (team?.users ?? [])
        .filter((u) => u.isActive !== false && !u.deletedAt)
        .map((u) => ({
          id: u.id,
          name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "—",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [team]
  );

  if (!canManage) return null;

  return (
    <Card className="lg:col-span-2">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("expenses.recurring")}
        </span>
        {running.length > 0 && (
          <span className="font-mono text-micro uppercase tracking-wider text-text-2" style={TABULAR}>
            {t(peopleCount === 1 ? "expenses.recurringTotalOne" : "expenses.recurringTotal", {
              amount: formatRecurringMoney(monthlyTotal, currency),
              n: peopleCount,
            })}
          </span>
        )}
      </div>

      <CardContent className="space-y-2">
        <p className="font-mono text-micro text-text-3">{t("expenses.recurringDesc")}</p>

        {isLoading ? (
          <div className="flex py-2">
            <Loader2 className="h-icon-16 w-icon-16 animate-spin text-text-3 motion-reduce:animate-none" />
          </div>
        ) : setups.length === 0 ? (
          <p className="py-1 font-mono text-caption-sm text-text-3">{t("expenses.recurringEmpty")}</p>
        ) : (
          <div>
            {setups.map((setup) => (
              <button
                key={setup.id}
                type="button"
                onClick={() => setDialog({ kind: "edit", setup })}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-line px-1 py-1.5 text-left transition-colors duration-150 ease-smooth last:border-b-0 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mohave text-body-sm text-text">{setup.name}</span>
                  <span className="block truncate font-mono text-micro uppercase tracking-wider text-text-3">
                    {personLabel(setup)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-data-sm text-text" style={TABULAR}>
                    {t("expenses.recurringMonthly", {
                      amount: formatRecurringMoney(setup.amount, setup.currency),
                    })}
                  </span>
                  <span
                    className="block font-mono text-micro uppercase tracking-wider text-text-3"
                    style={TABULAR}
                  >
                    {setup.lastPeriod
                      ? t("expenses.recurringLast", { month: formatRecurringMonth(setup.lastPeriod) })
                      : t("expenses.recurringSince", { month: formatRecurringMonth(setup.firstPeriod) })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setDialog({ kind: "create", person: null, firstPeriod: null })}
          className="font-mono text-caption-sm uppercase tracking-wider text-text-2 transition-colors duration-150 ease-smooth hover:text-text"
        >
          {t("expenses.recurringAdd")}
        </button>
      </CardContent>

      {dialog && (
        <RecurringReimbursementDialog
          open
          mode={dialog}
          currency={currency}
          timeZone={data?.timeZone ?? null}
          batches={batches}
          people={people}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}
