"use client";

/**
 * AccountingTotals — compact ACCOUNTING tab summary banner.
 *
 * Top line gives document totals (estimate value + invoice value). Bottom
 * line gives receivables state. `null` means the source rows did not carry a
 * numeric value, so the metric renders as the OPS empty numeric state: `—`.
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface AccountingTotalsProps {
  estimatesTotal: number | null;
  invoicesTotal: number | null;
  outstanding: number | null;
  paid: number | null;
  overdue: number | null;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-$${abs}` : `$${abs}`;
}

export function AccountingTotals({
  estimatesTotal,
  invoicesTotal,
  outstanding,
  paid,
  overdue,
  className,
}: AccountingTotalsProps) {
  const { t } = useDictionary("inbox");
  const overdueMuted = overdue === null || overdue === 0;

  return (
    <div
      data-testid="accounting-totals"
      className={cn(
        "border-y border-line bg-inbox-panel px-3 py-2.5",
        className
      )}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-line/60 pb-2">
        <Cell
          label={t("rail.totalEstimates", "[ESTIMATES]")}
          value={formatCurrency(estimatesTotal)}
          valueClassName={
            estimatesTotal === null ? "text-text-mute" : "text-text-2"
          }
          testId="accounting-totals-estimates"
        />
        <Cell
          label={t("rail.totalInvoices", "[INVOICES]")}
          value={formatCurrency(invoicesTotal)}
          valueClassName={
            invoicesTotal === null ? "text-text-mute" : "text-text"
          }
          testId="accounting-totals-invoices"
        />
      </div>
      <div className="grid grid-cols-3 gap-x-2 pt-2">
        <Cell
          label={t("rail.totalOutstanding", "[OUTSTANDING]")}
          value={formatCurrency(outstanding)}
          valueClassName={outstanding === null ? "text-text-mute" : "text-tan"}
          testId="accounting-totals-outstanding"
        />
        <Cell
          label={t("rail.totalPaid", "[PAID]")}
          value={formatCurrency(paid)}
          valueClassName={paid === null ? "text-text-mute" : "text-olive"}
          testId="accounting-totals-paid"
        />
        <Cell
          label={t("rail.totalOverdue", "[OVERDUE]")}
          value={formatCurrency(overdue)}
          valueClassName={overdueMuted ? "text-text-mute" : "text-rose"}
          labelClassName={overdueMuted ? "text-text-mute" : undefined}
          testId="accounting-totals-overdue"
        />
      </div>
    </div>
  );
}

interface CellProps {
  label: string;
  value: string;
  /** Tone class on the value (text-tan / text-olive / text-rose /
   *  text-text-mute when overdue is zero). */
  valueClassName: string;
  /** Optional override on the label — used to mute the OVERDUE label
   *  alongside the value when the metric is zero. Default keeps the
   *  shared `text-text-mute` label tone. */
  labelClassName?: string;
  testId?: string;
}

function Cell({
  label,
  value,
  valueClassName,
  labelClassName,
  testId,
}: CellProps) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          "truncate font-mono text-[11px] uppercase tracking-[0.02em]",
          labelClassName ?? "text-text-mute"
        )}
        style={TNUM_ZERO}
      >
        {label}
      </span>
      <span
        className={cn(
          "truncate font-mono text-[13px] font-medium",
          valueClassName
        )}
        style={TNUM_ZERO}
      >
        {value}
      </span>
    </div>
  );
}
